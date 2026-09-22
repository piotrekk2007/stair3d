// TreadModel tests — no Three.js anywhere in this file, per the requirement that the
// mathematical model must be testable without a renderer.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModel, buildTreadModels } from '../treadSolver.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

test('simple straight tread: elevation, direction, widths, and un-overridden edges', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 5 });
  const model = buildTreadModel(planLayout.treads[2], config);

  assert.equal(model.stepId, 'step-2');
  assert.equal(model.type, 'straight');
  assert.equal(model.elevation.top, 3 * config.riserHeight);
  assert.equal(model.elevation.bottom, model.elevation.top - config.treadThickness);
  assert.equal(model.thickness, config.treadThickness);

  assert.ok(Math.abs(Math.hypot(model.direction.x, model.direction.y) - 1) < 1e-9, 'direction must be unit length');
  assert.ok(model.widths.atFront > 0 && model.widths.atBack > 0);

  assert.equal(model.frontEdge.overridden, false);
  assert.equal(model.backEdge.overridden, false);
  assert.deepEqual(model.frontEdge.final, model.frontEdge.nominal);
  assert.deepEqual(model.backEdge.final, model.backEdge.nominal);
  assert.equal(model.winderInfo, null);
});

test('winder tread: winderInfo is passed through and widths/direction come from it', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const winderTread = planLayout.treads.find((t) => t.type === 'winder');
  const model = buildTreadModel(winderTread, config);

  assert.equal(model.type, 'winder');
  assert.ok(model.winderInfo, 'winder tread model must carry winderInfo');
  assert.deepEqual(model.widths, winderTread.winderInfo.widths);
  assert.deepEqual(model.direction, winderTread.winderInfo.direction);
});

test('manual edge override: frontEdge.overridden becomes true and final differs from nominal, backEdge is untouched', () => {
  const boundaryIndex = 3;
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const edited = build({
    stairType: 'straight',
    treadsLegA: 6,
    manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: { x: -35, y: 3 * 270 } } },
  });

  const baseModel = buildTreadModel(base.planLayout.treads[boundaryIndex], base.config);
  const editedModel = buildTreadModel(edited.planLayout.treads[boundaryIndex], edited.config);

  assert.equal(baseModel.frontEdge.overridden, false);
  assert.equal(editedModel.frontEdge.overridden, true, 'the edited tread\'s frontEdge must report overridden=true');
  assert.notDeepEqual(editedModel.frontEdge.final, editedModel.frontEdge.nominal);

  // The tread BEFORE the edited boundary owns that boundary as its backEdge — it must show
  // overridden there, while its own frontEdge (a different, untouched boundary) stays clean.
  const beforeModel = buildTreadModel(edited.planLayout.treads[boundaryIndex - 1], edited.config);
  assert.equal(beforeModel.backEdge.overridden, true);
  assert.equal(beforeModel.frontEdge.overridden, false);

  // Nominal geometry must be IDENTICAL before/after the edit — the override never touches it.
  assert.deepEqual(editedModel.frontEdge.nominal, baseModel.frontEdge.nominal);
});

test('buildTreadModels builds one model per tread, in order', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 4 });
  const models = buildTreadModels(planLayout, config);
  assert.equal(models.length, 4);
  models.forEach((m, i) => assert.equal(m.index, i));
});

test('landing tread has no nosing applied to its outline (outline == raw outline)', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 2, treadsLegB: 2 });
  const landing = planLayout.treads.find((t) => t.type === 'landing');
  const model = buildTreadModel(landing, config);
  assert.deepEqual(model.outline, landing.outline);
});
