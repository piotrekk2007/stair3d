// Test D from the manual-edit trace follow-up: after ONE manual edge edit, every dependent
// model must change (or stay fixed) EXACTLY where the architecture says it should —
// StringerModel's reference line never moves, its bearing does; RiserModel's frontEdge.final
// (and therefore its panel endpoint) moves, its frontEdge.nominal never does. This is the
// single test that checks StringerModel and RiserModel TOGETHER, against the SAME edit, so a
// future change can't silently make one of them regress while the other still passes its own
// isolated test file.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildRiserModel } from '../riserSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasRiserBoards: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

function findBearing(stringerModel, treadIndex) {
  for (const seg of stringerModel.segments) {
    const b = seg.treadBearings.find((tb) => tb.treadIndex === treadIndex);
    if (b) return { seg, b };
  }
  return null;
}

test('Test D — after a manual edge edit, StringerModel and RiserModel change exactly where expected, and nowhere else', () => {
  const boundaryIndex = 7; // inside the winder turn — step6.backEdge === step7.frontEdge
  const base = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5 });
  const baseOuter = base.planLayout.treads[boundaryIndex].frontEdge[1];
  const movedPoint = { x: baseOuter.x + 100, y: baseOuter.y + 30 };
  const edited = build({
    stairType: 'L',
    turn1Type: 'winder',
    treadsLegA: 5,
    windersPerTurn: 5,
    treadsLegB: 5,
    manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: movedPoint } },
  });

  const stringerBase = buildStringerModelsForFlight(base.planLayout, base.config);
  const stringerEdited = buildStringerModelsForFlight(edited.planLayout, edited.config);

  // --- StringerModel: reference line fixed, bearing moves ---
  const outerBearingBase = findBearing(stringerBase.outer, boundaryIndex);
  const outerBearingEdited = findBearing(stringerEdited.outer, boundaryIndex);
  assert.deepEqual(outerBearingEdited.seg.referenceLine, outerBearingBase.seg.referenceLine, 'StringerModel: the board axis must never move');
  assert.notEqual(outerBearingEdited.b.finalUStart, outerBearingBase.b.finalUStart, 'StringerModel: the bearing MUST move to track the edited boundary');

  // The inner stringer is untouched by an edit to the OUTER endpoint.
  const innerBearingBase = findBearing(stringerBase.inner, boundaryIndex);
  const innerBearingEdited = findBearing(stringerEdited.inner, boundaryIndex);
  assert.equal(innerBearingEdited.b.finalUStart, innerBearingBase.b.finalUStart, 'StringerModel: the INNER stringer bearing must be unaffected by an edit to the OUTER point');

  // --- RiserModel: frontEdge.nominal fixed, frontEdge.final (and the panel) moves ---
  const riser7Base = buildRiserModel(base.planLayout.treads[boundaryIndex], base.config);
  const riser7Edited = buildRiserModel(edited.planLayout.treads[boundaryIndex], edited.config);
  assert.deepEqual(riser7Edited.frontEdge.nominal, riser7Base.frontEdge.nominal, 'RiserModel: the construction-reference (nominal) edge must never move');
  assert.deepEqual(riser7Edited.frontEdge.final[1], movedPoint, 'RiserModel: the FINAL edge must track the edit');
  assert.deepEqual(riser7Edited.panels[riser7Edited.panels.length - 1].p1, movedPoint, 'RiserModel: the physical panel boundary must track the FINAL edge');

  // --- Everything NOT touching this boundary stays bit-identical ---
  const treadModelsBase = buildTreadModels(base.planLayout, base.config);
  const treadModelsEdited = buildTreadModels(edited.planLayout, edited.config);
  for (let i = 0; i < treadModelsBase.length; i++) {
    if (i === boundaryIndex - 1 || i === boundaryIndex) continue; // the two treads that share the edited boundary
    assert.deepEqual(treadModelsEdited[i].outline, treadModelsBase[i].outline, `tread ${i} is unrelated to boundary ${boundaryIndex} and must be untouched`);
  }
});
