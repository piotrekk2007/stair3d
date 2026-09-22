// Test E from the manual-edit trace follow-up: riserRenderer.js must consume whatever
// RiserModel gives it — no independent geometry decisions (see .claude/RULES.md rule 14). This
// is the one deliberately Three.js-touching test for the riser fix: it proves the fix reaches
// all the way to the actual mesh, as a pure DOWNSTREAM consequence of the RiserModel change
// (never by asserting triangle counts — see riserModel.test.js for the geometry-level proof;
// this file only checks that the renderer doesn't drop or reinterpret what the model gives it).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildRiserModel } from '../riserSolver.js';
import { buildRiserMeshGeometries } from '../riserRenderer.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasRiserBoards: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

function bbox(geometry) {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  return { min: b.min.clone(), max: b.max.clone() };
}

test('Test E — a manual edge edit changes the RISER MESH bounding box, purely as a consequence of the RiserModel change', () => {
  const boundaryIndex = 7;
  const base = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5 });
  const baseOuter = base.planLayout.treads[boundaryIndex].frontEdge[1];
  const movedPoint = { x: baseOuter.x + 150, y: baseOuter.y + 50 };
  const edited = build({
    stairType: 'L',
    turn1Type: 'winder',
    treadsLegA: 5,
    windersPerTurn: 5,
    treadsLegB: 5,
    manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: movedPoint } },
  });

  const riser7Base = buildRiserModel(base.planLayout.treads[boundaryIndex], base.config);
  const riser7Edited = buildRiserModel(edited.planLayout.treads[boundaryIndex], edited.config);

  const geomsBase = buildRiserMeshGeometries(riser7Base);
  const geomsEdited = buildRiserMeshGeometries(riser7Edited);
  assert.equal(geomsBase.length, geomsEdited.length, 'the edit must not change how many panels this riser has');

  const lastBase = bbox(geomsBase[geomsBase.length - 1]);
  const lastEdited = bbox(geomsEdited[geomsEdited.length - 1]);
  assert.notEqual(lastBase.max.x, lastEdited.max.x, 'the outer panel mesh must actually move in X as a consequence of the edited RiserModel');

  // The true inner CORNER (riser7Edited.panels[0].p0 — never affected by moving the outer
  // endpoint) must be unchanged. Its containing panel's own bounding box legitimately DOES
  // shift slightly too, because a 2-panel fan's shared midpoint (lerp(inner,outer,0.5)) is a
  // function of BOTH endpoints — that is correct fan behaviour, not a leak of the edit into
  // the wrong side.
  assert.deepEqual(riser7Edited.panels[0].p0, riser7Base.panels[0].p0, 'the true inner corner must be unaffected by an edit to the outer endpoint');
});

test('Test E (unedited baseline): renderer output is unaffected when there is nothing to override', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 5 });
  const model = buildRiserModel(planLayout.treads[2], config);
  const geoms = buildRiserMeshGeometries(model);
  assert.equal(geoms.length, 1);
  const b = bbox(geoms[0]);
  assert.ok(Number.isFinite(b.min.x) && Number.isFinite(b.max.x));
});
