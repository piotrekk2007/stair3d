import * as THREE from 'three';
import { downloadTextFile } from './downloadTextFile.js';

// Ręczny, minimalny eksporter COLLADA 1.4.1 (three.js nie ma wbudowanego ColladaExporter).
// Jednostka zadeklarowana jako milimetr w <asset> — w przeciwieństwie do OBJ, COLLADA
// niesie tę informację w metadanych, więc poprawny importer powinien ją respektować
// bez ręcznego przeskalowywania.

function sanitizeId(name, index) {
  const base = (name || 'mesh').replace(/[^a-zA-Z0-9_]/g, '_');
  return `${base}_${index}`;
}

function colorToRGBA(material) {
  const c = material && material.color ? material.color : new THREE.Color(0xcccccc);
  return `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)} 1`;
}

function meshToGeometryXML(mesh, id) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const posAttr = geo.attributes.position;
  let normAttr = geo.attributes.normal;
  if (!normAttr) {
    geo.computeVertexNormals();
    normAttr = geo.attributes.normal;
  }

  // Siatki treadów/policzków mają współrzędne świata "wypieczone" wprost w geometrii
  // (mesh.position pozostaje w (0,0,0)), ale słupy (BoxGeometry + mesh.position.set(...))
  // polegają na transformacie obiektu — bez uwzględnienia matrixWorld trafiałyby do pliku
  // w swoich WŁASNYCH lokalnych współrzędnych, czyli wizualnie przy (0,0,0).
  mesh.updateMatrixWorld(true);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const posArr = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    posArr.push(v.x.toFixed(4), v.y.toFixed(4), v.z.toFixed(4));
  }
  const normArr = [];
  for (let i = 0; i < normAttr.count; i++) {
    v.fromBufferAttribute(normAttr, i).applyMatrix3(normalMatrix).normalize();
    normArr.push(v.x.toFixed(4), v.y.toFixed(4), v.z.toFixed(4));
  }
  const vertexCount = posAttr.count;
  const indices = Array.from({ length: vertexCount }, (_, i) => `${i} ${i}`).join(' ');

  return `
    <geometry id="${id}" name="${id}">
      <mesh>
        <source id="${id}-positions">
          <float_array id="${id}-positions-array" count="${posArr.length}">${posArr.join(' ')}</float_array>
          <technique_common>
            <accessor source="#${id}-positions-array" count="${vertexCount}" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="${id}-normals">
          <float_array id="${id}-normals-array" count="${normArr.length}">${normArr.join(' ')}</float_array>
          <technique_common>
            <accessor source="#${id}-normals-array" count="${vertexCount}" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="${id}-vertices">
          <input semantic="POSITION" source="#${id}-positions"/>
        </vertices>
        <triangles material="mat" count="${vertexCount / 3}">
          <input semantic="VERTEX" source="#${id}-vertices" offset="0"/>
          <input semantic="NORMAL" source="#${id}-normals" offset="1"/>
          <p>${indices}</p>
        </triangles>
      </mesh>
    </geometry>`;
}

const GROUP_LABEL_BY_PARENT = {
  Treads: 'Stopnie',
  StringerOuter: 'Wangi',
  StringerInner: 'Wangi',
  Posts: 'Slupy',
  RiserBoards: 'Podstopnie',
};
const GROUP_ORDER = ['Wangi', 'Slupy', 'Stopnie', 'Podstopnie'];

// categoryFilter: { Stopnie: bool, Wangi: bool, Slupy: bool } — pozwala wyeksportować
// tylko wybrane kategorie do osobnych plików (jeden import w SketchUp = jedna grupa,
// niezależnie od tego, czy importer respektuje hierarchię węzłów w środku pliku).
export function exportStaircaseToDAE(root, filename = 'schody.dae', categoryFilter = null) {
  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const parentName = obj.parent ? obj.parent.name : null;
    const label = GROUP_LABEL_BY_PARENT[parentName] || 'Stopnie';
    if (categoryFilter && !categoryFilter[label]) return;
    meshes.push(obj);
  });

  const materialIds = new Map(); // color string -> material id
  const effectsXML = [];
  const materialsXML = [];

  function getMaterialId(mesh) {
    const rgba = colorToRGBA(mesh.material);
    if (materialIds.has(rgba)) return materialIds.get(rgba);
    const matId = `material_${materialIds.size}`;
    const effectId = `effect_${materialIds.size}`;
    materialIds.set(rgba, matId);
    effectsXML.push(`
    <effect id="${effectId}">
      <profile_COMMON>
        <technique sid="common">
          <phong>
            <diffuse><color>${rgba}</color></diffuse>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>`);
    materialsXML.push(`
    <material id="${matId}" name="${matId}">
      <instance_effect url="#${effectId}"/>
    </material>`);
    return matId;
  }

  const geometriesXML = [];
  // groupLabel -> array of <node> XML strings (jeden node na siatkę)
  const nodesByGroup = new Map(GROUP_ORDER.map((g) => [g, []]));

  meshes.forEach((mesh, i) => {
    const id = sanitizeId(mesh.name, i);
    const geomId = `geom_${id}`;
    geometriesXML.push(meshToGeometryXML(mesh, geomId));
    const matId = getMaterialId(mesh);
    const parentName = mesh.parent ? mesh.parent.name : null;
    const groupLabel = GROUP_LABEL_BY_PARENT[parentName] || 'Stopnie';
    nodesByGroup.get(groupLabel).push(`
        <node id="node_${id}" name="${id}">
          <instance_geometry url="#${geomId}">
            <bind_material>
              <technique_common>
                <instance_material symbol="mat" target="#${matId}"/>
              </technique_common>
            </bind_material>
          </instance_geometry>
        </node>`);
  });

  // Trzy grupy nadrzędne w eksporcie: Wangi (policzki wew.+zew.), Słupy, Stopnie —
  // każda jako osobny <node> z dziećmi, gotowa do zaznaczenia/eksplozji jako jedna grupa w SketchUp.
  const groupNodesXML = GROUP_ORDER.map((label) => {
    const children = nodesByGroup.get(label);
    if (children.length === 0) return '';
    return `
      <node id="group_${label}" name="${label}">${children.join('')}
      </node>`;
  }).join('');

  const dae = `<?xml version="1.0" encoding="UTF-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <unit name="millimeter" meter="0.001"/>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_effects>${effectsXML.join('')}
  </library_effects>
  <library_materials>${materialsXML.join('')}
  </library_materials>
  <library_geometries>${geometriesXML.join('')}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">${groupNodesXML}
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#Scene"/>
  </scene>
</COLLADA>
`;

  downloadTextFile(dae, filename, 'model/vnd.collada+xml');
}
