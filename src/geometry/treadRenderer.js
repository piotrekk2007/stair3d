// THE ONLY Three.js mesh builder for treads. Consumes a TreadModel (treadSolver.js) — it
// never decides where a tread's edge sits or whether nosing was applied; that already
// happened in the solver. This file only turns already-decided plan-space geometry into
// triangles.

import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { traceability } from '../scene/traceability.js';

export function buildTreadMesh(treadModel) {
  const pts2D = treadModel.outline.map((p) => ({ u: p.x, v: p.y }));
  return buildPrism(pts2D, (u, v) => planToWorld(u, v, treadModel.elevation.bottom), new THREE.Vector3(0, 1, 0), treadModel.thickness);
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
