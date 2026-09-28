// THE ONLY Three.js mesh builder for treads. Consumes a TreadModel (treadSolver.js) — it
// never decides where a tread's edge sits or whether nosing was applied; that already
// happened in the solver. This file only turns already-decided plan-space geometry into
// triangles.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPrism, buildPrismWithHoles, planToWorld } from './geometryUtils.js';
import { traceability } from '../scene/traceability.js';

// No true CSG (stringerRenderer.js builds a housed board's pockets the same way — layered extrusions, rule-11
// rationale — this project adds no boolean-geometry dependency without a concrete need): a
// tread with a notch (TreadModel.notch, treadSolver.js buildNotch) is instead built as TWO plain
// prisms glued together — a full-footprint slab ABOVE the notch's own height, and a
// reduced-footprint (notch-receded) slab BELOW it — which is exact for this specific shape (a
// straight-sided rabbet along one edge, never a curved or undercut groove), unlike the housing
// indicator's own deliberate approximation.
// `cut` (jointSolver.js treadCuts[stepId]) — the tread cut around a structural post it passes through (stage 2 of the
// joints): its outline, any hole (a post standing inside a landing) and the cut notch outline. Already decided there.
export function buildTreadMesh(treadModel, cut = null) {
  const toUV = (poly) => poly.map((p) => ({ u: p.x, v: p.y }));
  const pts2D = toUV(cut ? cut.outline : treadModel.outline);
  const holes = cut ? (cut.holes || []).map(toUV) : [];
  const up = new THREE.Vector3(0, 1, 0);
  const slab = (pts, z, depth) => (holes.length ? buildPrismWithHoles(pts, holes, (u, v) => planToWorld(u, v, z), up, depth) : buildPrism(pts, (u, v) => planToWorld(u, v, z), up, depth));
  if (!treadModel.notch) {
    return slab(pts2D, treadModel.elevation.bottom, treadModel.thickness);
  }
  const { depthMm } = treadModel.notch;
  const notchOutline = cut ? cut.notchOutline || cut.outline : treadModel.notch.outline;
  const upperSlab = slab(pts2D, treadModel.elevation.bottom + depthMm, treadModel.thickness - depthMm);
  const lowerSlab = slab(toUV(notchOutline), treadModel.elevation.bottom, depthMm);
  return mergeGeometries([upperSlab, lowerSlab]);
}

export function renderTreads(treadModels, material, treadCuts = {}) {
  const group = new THREE.Group();
  group.name = 'Treads';
  for (const model of treadModels) {
    const mesh = new THREE.Mesh(buildTreadMesh(model, treadCuts[model.stepId] || null), material);
    mesh.name = `Tread_${model.index}_${model.type}`;
    mesh.userData = traceability({ elementType: 'tread', stepId: model.stepId, geometrySourceId: `tread:${model.stepId}` });
    group.add(mesh);
  }
  return group;
}
