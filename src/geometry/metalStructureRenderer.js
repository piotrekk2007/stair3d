// The steel members of a metal stair (metalStructureModel.js) as prisms — decides nothing: every member is the side
// outline the model gave, extruded across its plan piece from `nFrom` to `nTo`.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { traceability } from '../scene/traceability.js';

function memberGeometry(m) {
  // the prism is built from its face at nFrom towards nTo, wound so that every face looks outwards
  const at = (u, n) => ({ x: m.origin.x + m.dir.x * u + m.normal.x * n, y: m.origin.y + m.dir.y * u + m.normal.y * n });
  const clockwise = THREE.ShapeUtils.isClockWise(m.outline.map((p) => new THREE.Vector2(p.u, p.v)));
  const outline = clockwise ? m.outline : [...m.outline].reverse();
  const toWorld = (u, v) => {
    const p = at(u, m.nFrom);
    return planToWorld(p.x, p.y, v);
  };
  return buildPrism(outline, toWorld, new THREE.Vector3(m.normal.x, 0, -m.normal.y), m.nTo - m.nFrom);
}

/**
 * @param {Object|null} metal  buildMetalStructure()
 * @param {string[]} sides  which rows go into this group ('outer' | 'inner' | 'centre')
 */
export function renderMetalStructure(metal, sides, material, name) {
  const group = new THREE.Group();
  group.name = name;
  const members = (metal?.members || []).filter((m) => sides.includes(m.side));
  const byRow = new Map();
  for (const m of members) {
    if (!byRow.has(m.rowId)) byRow.set(m.rowId, []);
    byRow.get(m.rowId).push(memberGeometry(m));
  }
  for (const [rowId, geometries] of byRow) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.name = `${name}_${rowId}`;
    mesh.geometry.userData.woodGrainUV = true; // steel: no wood grain
    mesh.userData = traceability({ elementType: 'stringer', stringerId: rowId, geometrySourceId: `metal:${rowId}` });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
