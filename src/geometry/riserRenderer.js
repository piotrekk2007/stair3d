// THE ONLY Three.js mesh builder for risers (podstopnie). Consumes a RiserModel
// (riserSolver.js) — it never decides panel positions/directions/count; that already
// happened in the solver (including the winder fan). This file only converts already-decided
// plan-space panels into triangles.

import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { outwardNormalFromForward } from './nosingUtils.js';
import { GEOMETRY_EPS } from './tolerances.js';

function buildPanelGeometry(panel, elevation, thickness, inward) {
  const { p0, p1, direction } = panel;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const width = Math.hypot(dx, dy);
  if (width < GEOMETRY_EPS || elevation.top <= elevation.bottom) return null;
  const ux = dx / width;
  const uy = dy / width;

  const toWorld = (u, v) => planToWorld(p0.x + ux * u, p0.y + uy * u, v);
  const pts2D = [
    { u: 0, v: elevation.bottom },
    { u: width, v: elevation.bottom },
    { u: width, v: elevation.top },
    { u: 0, v: elevation.top },
  ];

  const normal = outwardNormalFromForward(direction);
  const sign = inward ? -1 : 1;
  const extrudeDir = new THREE.Vector3(sign * normal.x, 0, -sign * normal.y);
  return buildPrism(pts2D, toWorld, extrudeDir, thickness);
}

export function buildRiserMeshGeometries(riserModel) {
  return riserModel.panels.map((panel) => buildPanelGeometry(panel, riserModel.elevation, riserModel.thickness, riserModel.inward)).filter(Boolean);
}

export function renderRisers(riserModels, material) {
  const group = new THREE.Group();
  group.name = 'RiserBoards';
  let i = 0;
  for (const model of riserModels) {
    for (const geo of buildRiserMeshGeometries(model)) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `RiserBoard_${i++}`;
      group.add(mesh);
    }
  }
  return group;
}
