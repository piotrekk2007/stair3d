// THE ONLY Three.js mesh builder for risers (podstopnie). Consumes a RiserModel
// (riserSolver.js) — it never decides panel positions/directions/count; that already
// happened in the solver (including the winder fan). This file only converts already-decided
// plan-space panels into triangles.

import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { outwardNormalFromForward } from './nosingUtils.js';
import { GEOMETRY_EPS } from './tolerances.js';
import { traceability } from '../scene/traceability.js';

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

// Returns {geometry, panelIndex} per panel — the traceability-carrying form. `panelIndex` is
// this panel's position within `riserModel.panels` (0 for a straight/landing riser's single
// panel; 0..WINDER_RISER_FAN_PANELS-1 for a winder's fan), used to build a stable
// geometrySourceId (see traceability.js) without inventing a new per-panel id in the model.
// `riserCuts` (jointSolver.js) — a panel cut around a structural post it passes through (stage 2 of the joints): its
// plan polygon, extruded vertically over the riser's height. Already decided there.
function buildRiserMeshEntries(riserModel, riserCuts = {}) {
  const entries = [];
  riserModel.panels.forEach((panel, panelIndex) => {
    const cut = riserCuts[`${riserModel.riserId}:${panelIndex}`];
    const geometry = cut
      ? buildPrism(
          cut.map((p) => ({ u: p.x, v: p.y })),
          (u, v) => planToWorld(u, v, riserModel.elevation.bottom),
          new THREE.Vector3(0, 1, 0),
          riserModel.elevation.top - riserModel.elevation.bottom
        )
      : buildPanelGeometry(panel, riserModel.elevation, riserModel.thickness, riserModel.inward);
    if (geometry) entries.push({ geometry, panelIndex });
  });
  return entries;
}

// Geometry-only form, kept for existing callers/tests that only ever needed the meshes
// themselves (e.g. src/geometry/__tests__/riserRenderer.test.js, winderStep.test.js) — a thin
// projection over buildRiserMeshEntries, never a second implementation of the panel loop.
export function buildRiserMeshGeometries(riserModel) {
  return buildRiserMeshEntries(riserModel).map((e) => e.geometry);
}

export function renderRisers(riserModels, material, riserCuts = {}) {
  const group = new THREE.Group();
  group.name = 'RiserBoards';
  let i = 0;
  for (const model of riserModels) {
    for (const { geometry, panelIndex } of buildRiserMeshEntries(model, riserCuts)) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `RiserBoard_${i++}`;
      // the top riser (under the fajkowy nosing tread) has no tread of its own: a click selects the last tread it stands behind
      mesh.userData = traceability({ elementType: 'riser', stepId: model.atTop ? model.belowStepId : model.stepId, geometrySourceId: `riser:${model.stepId}:panel-${panelIndex}` });
      group.add(mesh);
    }
  }
  return group;
}
