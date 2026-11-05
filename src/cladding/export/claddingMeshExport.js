// The module's 3D for SketchUp (DAE) and other programs (OBJ) — user requests 2026-11-04 / 2026-11-05. The module's own
// small writers (the shared export/daeExporter.js / objExporter.js have the self-supporting categories built in and an
// unknown group falls into "Stopnie" — so the concrete could not be a group of its own there). Every visible mesh with
// its world transform baked into a copy of its geometry, in one group per category:
//   Stopnie (treads, landings, noses), Podstopnice (riser boards), Listwy_i_wangi (skirting boards, cover stringers),
//   Balustrada (posts, handrail, balusters, glass, fixings), Beton (the concrete steps / landings, starter blocks).
// The room, the LED strips and a linked floor are not exported. Units: mm (DAE declares them, OBJ cannot — set
// millimetres on import). Text builders are pure (three only); `app/claddingApp.js` downloads the result.
import * as THREE from 'three';

/** [the renderer's group, the exported group] in the file's order */
export const EXPORT_GROUPS = [
  ['Treads', 'Stopnie'],
  ['Risers', 'Podstopnice'],
  ['Finish', 'Listwy_i_wangi'],
  ['Railing', 'Balustrada'],
  ['Concrete', 'Beton'],
];

/**
 * @param {THREE.Object3D} root  renderCladdingStair's result
 * @param {{concrete?: boolean}} [opts]  concrete: false leaves the concrete out
 * @returns {THREE.Group} one child group per exported category (named as in EXPORT_GROUPS), flat world-baked meshes
 */
export function claddingExportRoot(root, { concrete = true } = {}) {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = 'CladdingExport';
  for (const [from, to] of EXPORT_GROUPS) {
    if (from === 'Concrete' && !concrete) continue;
    const src = root.children.find((c) => c.name === from);
    const group = new THREE.Group();
    group.name = to;
    src?.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      const geometry = (obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone()).applyMatrix4(obj.matrixWorld);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, obj.material);
      mesh.name = obj.name || from;
      group.add(mesh);
    });
    if (group.children.length) out.add(group);
  }
  out.updateMatrixWorld(true);
  return out;
}

const idOf = (name, k) => `${String(name || 'mesh').replace(/[^a-zA-Z0-9_]/g, '_')}_${k}`;
const n4 = (x) => x.toFixed(4);

/** @param {THREE.Group} out  claddingExportRoot's result @returns {string} */
export function buildCladdingOBJ(out) {
  const lines = ['# schody3d - schody na beton - eksport OBJ, jednostki: mm'];
  let offset = 0;
  let k = 0;
  for (const group of out.children) {
    lines.push(`g ${group.name}`);
    for (const mesh of group.children) {
      const pos = mesh.geometry.attributes.position;
      const nor = mesh.geometry.attributes.normal;
      lines.push(`o ${idOf(mesh.name, k++)}`);
      for (let i = 0; i < pos.count; i++) lines.push(`v ${n4(pos.getX(i))} ${n4(pos.getY(i))} ${n4(pos.getZ(i))}`);
      for (let i = 0; i < nor.count; i++) lines.push(`vn ${n4(nor.getX(i))} ${n4(nor.getY(i))} ${n4(nor.getZ(i))}`);
      for (let i = 0; i < pos.count; i += 3) lines.push(`f ${offset + i + 1}//${offset + i + 1} ${offset + i + 2}//${offset + i + 2} ${offset + i + 3}//${offset + i + 3}`);
      offset += pos.count;
    }
  }
  return lines.join('\n') + '\n';
}

/** @param {THREE.Group} out  claddingExportRoot's result @returns {string} COLLADA 1.4.1, mm, Y up */
export function buildCladdingDAE(out) {
  const materials = new Map(); // rgba → id
  const effects = [];
  const mats = [];
  const geometries = [];
  const materialOf = (m) => {
    const c = m?.color || new THREE.Color(0xcccccc);
    const a = m?.transparent ? Math.max(0.05, m.opacity ?? 1) : 1;
    const rgba = `${n4(c.r)} ${n4(c.g)} ${n4(c.b)} ${n4(a)}`;
    if (!materials.has(rgba)) {
      const id = `material_${materials.size}`;
      materials.set(rgba, id);
      effects.push(`<effect id="effect_${materials.size - 1}"><profile_COMMON><technique sid="common"><phong><diffuse><color>${rgba}</color></diffuse>${a < 1 ? `<transparency><float>${n4(a)}</float></transparency>` : ''}</phong></technique></profile_COMMON></effect>`);
      mats.push(`<material id="${id}" name="${id}"><instance_effect url="#effect_${materials.size - 1}"/></material>`);
    }
    return materials.get(rgba);
  };
  let k = 0;
  const nodes = out.children.map((group) => {
    const children = group.children.map((mesh) => {
      const id = idOf(mesh.name, k++);
      const pos = mesh.geometry.attributes.position;
      const nor = mesh.geometry.attributes.normal;
      const p = [];
      const n = [];
      for (let i = 0; i < pos.count; i++) p.push(n4(pos.getX(i)), n4(pos.getY(i)), n4(pos.getZ(i)));
      for (let i = 0; i < nor.count; i++) n.push(n4(nor.getX(i)), n4(nor.getY(i)), n4(nor.getZ(i)));
      const g = `geom_${id}`;
      const acc = (src, count) => `<technique_common><accessor source="#${src}" count="${count}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>`;
      geometries.push(
        `<geometry id="${g}" name="${g}"><mesh>` +
          `<source id="${g}-positions"><float_array id="${g}-positions-array" count="${p.length}">${p.join(' ')}</float_array>${acc(`${g}-positions-array`, pos.count)}</source>` +
          `<source id="${g}-normals"><float_array id="${g}-normals-array" count="${n.length}">${n.join(' ')}</float_array>${acc(`${g}-normals-array`, nor.count)}</source>` +
          `<vertices id="${g}-vertices"><input semantic="POSITION" source="#${g}-positions"/></vertices>` +
          `<triangles material="mat" count="${pos.count / 3}"><input semantic="VERTEX" source="#${g}-vertices" offset="0"/><input semantic="NORMAL" source="#${g}-normals" offset="1"/><p>${Array.from({ length: pos.count }, (_, i) => `${i} ${i}`).join(' ')}</p></triangles>` +
          `</mesh></geometry>`,
      );
      return `<node id="node_${id}" name="${id}"><instance_geometry url="#${g}"><bind_material><technique_common><instance_material symbol="mat" target="#${materialOf(mesh.material)}"/></technique_common></bind_material></instance_geometry></node>`;
    });
    return `<node id="group_${group.name}" name="${group.name}">${children.join('')}</node>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="millimeter" meter="0.001"/><up_axis>Y_UP</up_axis></asset>
  <library_effects>${effects.join('')}</library_effects>
  <library_materials>${mats.join('')}</library_materials>
  <library_geometries>${geometries.join('')}</library_geometries>
  <library_visual_scenes><visual_scene id="Scene" name="Scene">${nodes.join('')}</visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
`;
}
