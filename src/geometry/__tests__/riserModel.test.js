// RiserModel tests — no Three.js anywhere in this file. The whole point of RiserModel is
// that "this winder riser is too wide or rotated" must be detectable from `panels` and
// `directionSpreadDeg` alone, before any THREE.BufferGeometry exists — see
// docs/architecture/CONSOLIDATION.md for the history of this exact bug.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildRiserModel, buildRiserModels, angleBetweenDeg, WINDER_RISER_FAN_PANELS } from '../riserSolver.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasRiserBoards: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

test('straight tread: one panel, zero direction spread', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 5 });
  const model = buildRiserModel(planLayout.treads[2], config);

  assert.equal(model.riserId, 'riser-2');
  assert.equal(model.stepId, 'step-2');
  assert.equal(model.type, 'straight');
  assert.equal(model.panels.length, 1);
  assert.equal(model.directionSpreadDeg, 0);
  assert.ok(model.panels[0].width > 0);
  assert.equal(model.inward, true);
});

test('landing tread: riser thickness/direction use the landing-specific config, inward=false', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 2, treadsLegB: 2, riserBoardThickness: 22 });
  const landing = planLayout.treads.find((t) => t.type === 'landing');
  const model = buildRiserModel(landing, config);

  assert.equal(model.type, 'landing');
  assert.equal(model.thickness, 22);
  assert.equal(model.inward, false);
  assert.equal(model.panels.length, 1);
});

test('winder tread: builds a fan of WINDER_RISER_FAN_PANELS panels', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const winderTread = planLayout.treads.find((t) => t.type === 'winder');
  const model = buildRiserModel(winderTread, config);

  assert.equal(model.type, 'winder');
  assert.equal(model.panels.length, WINDER_RISER_FAN_PANELS);
  for (const panel of model.panels) {
    assert.ok(panel.width > 0 && Number.isFinite(panel.width));
    assert.ok(Math.abs(Math.hypot(panel.direction.x, panel.direction.y) - 1) < 1e-9);
  }
  // Panels must be contiguous: panel[i].p1 === panel[i+1].p0.
  for (let i = 0; i < model.panels.length - 1; i++) {
    assert.deepEqual(model.panels[i].p1, model.panels[i + 1].p0);
  }
});

test('THE PROBLEMATIC CASE: at least one winder tread has a genuinely divergent inner/outer direction, caught by directionSpreadDeg BEFORE any mesh exists', () => {
  // Somewhere inside a proportional-method turn, the inner side has "already turned" (dusza
  // corners immediately, see planLayout.js) while the outer side has not yet reached its own
  // bend (or vice-versa) — a real, expected divergence, not a bug — but it is EXACTLY the
  // condition that made a single flat panel geometrically wrong before the fan fix. This test
  // proves the divergence is visible as plain data (an angle in degrees) for at least one
  // tread in the turn, not just as a "looks wrong in the 3D view" symptom. It deliberately
  // does NOT assume WHICH tread shows it (that depends on where the outer bend point Oc falls
  // relative to walkline stations — see planLayout.js) — only that the phenomenon is real and
  // model-visible somewhere in a typical turn.
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const winderModels = planLayout.treads.filter((t) => t.type === 'winder').map((t) => buildRiserModel(t, config));

  const maxSpread = Math.max(...winderModels.map((m) => m.directionSpreadDeg));
  assert.ok(maxSpread > 45, `expected at least one winder riser with a large direction spread, got max ${maxSpread.toFixed(1)}° across ${winderModels.length} winder treads`);

  // And yet every individual panel stays a sane, bounded width — the fan absorbs the
  // divergence instead of producing one oversized/rotated panel.
  for (const model of winderModels) {
    assert.ok(model.maxPanelWidth < config.stairWidth * 1.5, `expected fan panels to stay reasonably sized even with a ${model.directionSpreadDeg.toFixed(1)}° direction spread, got maxPanelWidth=${model.maxPanelWidth.toFixed(0)}mm`);
  }
});

test('angleBetweenDeg: 0° for identical directions, 90° for perpendicular, near 180° for opposite', () => {
  assert.equal(angleBetweenDeg({ x: 1, y: 0 }, { x: 1, y: 0 }), 0);
  assert.equal(angleBetweenDeg({ x: 1, y: 0 }, { x: 0, y: 1 }), 90);
  assert.ok(Math.abs(angleBetweenDeg({ x: 1, y: 0 }, { x: -1, y: 0 }) - 180) < 1e-9);
});

test('buildRiserModels: empty when hasRiserBoards is false, one model per tread otherwise', () => {
  const { config: withRisers, planLayout } = build({ stairType: 'straight', treadsLegA: 4 });
  assert.equal(buildRiserModels(planLayout, { ...withRisers, hasRiserBoards: false }).length, 0);
  assert.equal(buildRiserModels(planLayout, withRisers).length, 4);
});

test('buildRiserModels: riserBoardThickness=0 is filtered out, not returned as degenerate models', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 3, riserBoardThickness: 0 });
  assert.equal(buildRiserModels(planLayout, config).length, 0);
});

// Regression: nosing and riser board thickness are two INDEPENDENT physical quantities —
// nosing=0 (a "carpeted stair" look, tread flush with the riser, no overhang) must never make
// the riser board itself disappear. This was a real reported bug: riserSolver.js used to read
// `thickness = nosing` for a non-landing tread, so setting nosing to 0 also zeroed (and thus
// filtered out) the riser board even with hasRiserBoards on and a nonzero riserBoardThickness.
test('nosing=0 does not remove the riser board — thickness comes ONLY from riserBoardThickness', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 3, nosing: 0, riserBoardThickness: 40 });
  const models = buildRiserModels(planLayout, config);
  assert.equal(models.length, 3);
  for (const m of models) assert.equal(m.thickness, 40);
});

test('changing nosing never changes riser board thickness, and changing riserBoardThickness never changes it either way around', () => {
  const thin = build({ stairType: 'straight', treadsLegA: 3, nosing: 10, riserBoardThickness: 20 });
  const thick = build({ stairType: 'straight', treadsLegA: 3, nosing: 40, riserBoardThickness: 20 });
  const modelsThin = buildRiserModels(thin.planLayout, thin.config);
  const modelsThick = buildRiserModels(thick.planLayout, thick.config);
  assert.equal(modelsThin[0].thickness, 20);
  assert.equal(modelsThick[0].thickness, 20, 'riser board thickness must not depend on nosing');
});

// --- Regression tests for the manual-edit trace finding: RiserModel used to silently ignore
// edgeOverrides entirely (it read tread.innerChain/outerChain or tread.winderInfo.frontEdge —
// both NOMINAL, never touched by an edit) — see riserSolver.js's module header and
// docs/architecture/CONSTRAINTS_AND_VALIDATION.md for the full nominal/final design this
// proves. Every test below builds the SAME base scenario twice (once unedited, once with one
// manualEdgeOverrides entry) and compares the resulting RiserModel — never Three.js.

test('RiserModel exposes an explicit frontEdge.nominal/final/overridden split, unedited case: nominal === final', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 5 });
  const model = buildRiserModel(planLayout.treads[2], config);
  assert.equal(model.frontEdge.overridden, false);
  assert.deepEqual(model.frontEdge.final, model.frontEdge.nominal);
});

test('Test A — straight tread: a manual edge override moves the corresponding riser panel endpoint', () => {
  const boundaryIndex = 3; // step2.backEdge === step3.frontEdge
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const baseOuter = base.planLayout.treads[boundaryIndex].frontEdge[1];
  const movedPoint = { x: baseOuter.x - 120, y: baseOuter.y + 40 };
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: movedPoint } } });

  const baseModel = buildRiserModel(base.planLayout.treads[boundaryIndex], base.config);
  const editedModel = buildRiserModel(edited.planLayout.treads[boundaryIndex], edited.config);

  assert.equal(baseModel.frontEdge.overridden, false);
  assert.equal(editedModel.frontEdge.overridden, true);
  // Nominal (construction reference) must be untouched by the edit...
  assert.deepEqual(editedModel.frontEdge.nominal, baseModel.frontEdge.nominal);
  // ...but the FINAL edge, and therefore the riser panel's own outer endpoint, must move to it.
  assert.deepEqual(editedModel.frontEdge.final[1], movedPoint);
  assert.deepEqual(editedModel.panels[0].p1, movedPoint, 'the riser panel outer endpoint must follow the final (edited) tread edge, not silently stay on the raw/nominal chain');
  // The untouched (inner) endpoint must not have moved.
  assert.deepEqual(editedModel.panels[0].p0, baseModel.panels[0].p0);
});

test('Test B — winder: a manual edge override on the outer point moves only the outer riser endpoint; inner stays put; the neighbouring tread across the SAME boundary is unaffected on its own (different) boundary', () => {
  // treadsLegA=5, windersPerTurn=5 -> winder treads are indices 5..9; boundary 7 is the shared
  // edge step6.backEdge === step7.frontEdge, inside the turn.
  const base = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5 });
  const baseOuter = base.planLayout.treads[7].frontEdge[1];
  const movedPoint = { x: baseOuter.x + 120, y: baseOuter.y + 40 };
  const edited = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5, manualEdgeOverrides: { 7: { movedEndpoint: 'outer', point: movedPoint } } });

  const step7Base = buildRiserModel(base.planLayout.treads[7], base.config);
  const step7Edited = buildRiserModel(edited.planLayout.treads[7], edited.config);
  assert.equal(step7Base.type, 'winder');

  // Outer riser endpoint (last panel's p1, per the fan construction in riserSolver.js) follows
  // the final edited edge...
  assert.deepEqual(step7Edited.panels[step7Edited.panels.length - 1].p1, movedPoint);
  // ...while the inner endpoint (first panel's p0) — untouched by this edit — does not move.
  assert.deepEqual(step7Edited.panels[0].p0, step7Base.panels[0].p0);
  // Directions stay the nominal construction reference for a winder fan (see riserSolver.js
  // header) — computed independently per panel from the tread's own inner/outer directions,
  // never forced to a single shared value (they may legitimately coincide at some boundaries —
  // see "different phases" in planLayout.js — but must never be silently collapsed into one).
  assert.deepEqual(step7Edited.panels[0].direction, step7Base.panels[0].direction, 'panel direction is a nominal construction reference — unaffected by the edit');

  // Step 6's riser is built from its OWN frontEdge (a DIFFERENT boundary, index 6) — it must
  // legitimately stay unchanged, since this edit never touches boundary 6. This is the
  // "where applicable" case: not every neighbouring element depends on every edited boundary.
  const step6Base = buildRiserModel(base.planLayout.treads[6], base.config);
  const step6Edited = buildRiserModel(edited.planLayout.treads[6], edited.config);
  assert.deepEqual(step6Edited.panels, step6Base.panels, "step 6's riser (frontEdge = boundary 6) must be unaffected by an edit to boundary 7");
});

test('Test C — no override: RiserModel is bit-identical to the pre-fix nominal-only behaviour', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5 });
  for (const tread of planLayout.treads) {
    const model = buildRiserModel(tread, config);
    assert.equal(model.frontEdge.overridden, false);
    assert.deepEqual(model.frontEdge.final, model.frontEdge.nominal);
  }
});

test('Test topology — a shared boundary edited via ONE tread\'s override is seen identically by both stringer bearings and the owning riser', () => {
  const boundaryIndex = 7;
  const base = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5 });
  const movedPoint = { x: base.planLayout.treads[boundaryIndex].frontEdge[1].x + 90, y: base.planLayout.treads[boundaryIndex].frontEdge[1].y + 15 };
  const edited = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: movedPoint } } });

  // The tread BEFORE the boundary (step6.backEdge) and the tread AT the boundary
  // (step7.frontEdge) must see the exact same final point — ONE canonical boundary, not two
  // independently-edited copies.
  assert.deepEqual(edited.planLayout.treads[boundaryIndex - 1].backEdge[1], movedPoint);
  assert.deepEqual(edited.planLayout.treads[boundaryIndex].frontEdge[1], movedPoint);

  // ...and the owning riser (step7, whose frontEdge IS this boundary) reads that same point.
  const riser7 = buildRiserModel(edited.planLayout.treads[boundaryIndex], edited.config);
  assert.deepEqual(riser7.frontEdge.final[1], movedPoint);
});
