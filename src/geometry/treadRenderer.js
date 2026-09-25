// THE ONLY Three.js mesh builder for treads. Consumes a TreadModel (treadSolver.js) — it
// never decides where a tread's edge sits or whether nosing was applied; that already
// happened in the solver. This file only turns already-decided plan-space geometry into
// triangles.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { traceability } from '../scene/traceability.js';

// No true CSG (stringerRenderer.js builds a housed board's pockets the same way — layered extrusions, rule-11
// rationale — this project adds no boolean-geometry dependency without a concrete need): a
// tread with a notch (TreadModel.notch, treadSolver.js buildNotch) is instead built as TWO plain
// prisms glued together — a full-footprint slab ABOVE the notch's own height, and a
// reduced-footprint (notch-receded) slab BELOW it — which is exact for this specific shape (a
// straight-sided rabbet along one edge, never a curved or undercut groove), unlike the housing
// indicator's own deliberate approximation.
export function buildTreadMesh(treadModel) {
  const pts2D = treadModel.outline.map((p) => ({ u: p.x, v: p.y }));
  const up = new THREE.Vector3(0, 1, 0);
  if (!treadModel.notch) {
    return buildPrism(pts2D, (u, v) => planToWorld(u, v, treadModel.elevation.bottom), up, treadModel.thickness);
  }
  const { depthMm, outline: notchOutline } = treadModel.notch;
  const upperSlab = buildPrism(pts2D, (u, v) => planToWorld(u, v, treadModel.elevation.bottom + depthMm), up, treadModel.thickness - depthMm);
  const lowerSlab = buildPrism(
    notchOutline.map((p) => ({ u: p.x, v: p.y })),
    (u, v) => planToWorld(u, v, treadModel.elevation.bottom),
    up,
    depthMm
  );
  return mergeGeometries([upperSlab, lowerSlab]);
}

export function renderTreads(treadModels, material) {
  const group = new THREE.Group();
  group.name = 'Treads';
  for (const model of treadModels) {
    const mesh = new THREE.Mesh(buildTreadMesh(model), material);
    mesh.name = `Tread_${model.index}_${model.type}`;
    mesh.userData = traceability({ elementType: 'tread', stepId: model.stepId, geometrySourceId: `tread:${model.stepId}` });
    group.add(mesh);
  }
  return group;
}
