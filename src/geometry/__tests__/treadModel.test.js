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

// user report 2026-11-17: the landings had no nosing (a flat plate by an old decision) — their front is a tread's front
test('a landing is nosed at its front edge like a tread (L landing; U with two landings, each one)', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 2, treadsLegB: 2 });
  const landing = planLayout.treads.find((t) => t.type === 'landing');
  const model = buildTreadModel(landing, config);
  const [a, b] = landing.frontEdge;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // the farthest outline point in front of the front edge (towards the tread below) = the nosing
  const below = planLayout.treads[landing.index - 1];
  const cb = below.outline.reduce((s, q) => ({ x: s.x + q.x, y: s.y + q.y }), { x: 0, y: 0 });
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  if ((cb.x / below.outline.length - a.x) * n.x + (cb.y / below.outline.length - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const ahead = (o) => Math.max(...o.map((q) => (q.x - a.x) * n.x + (q.y - a.y) * n.y));
  assert.ok(Math.abs(ahead(landing.outline)) < 1e-6, 'the raw outline ends at the front edge');
  assert.ok(Math.abs(ahead(model.outline) - config.nosing) < 1e-6, `nosed by ${config.nosing} mm`);

  const u = build({ stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', treadsLegA: 4, treadsLegB: 1, treadsLegC: 4, mergeLandings: false, uSingleWinderZone: false });
  const landings = buildTreadModels(u.planLayout, u.config).filter((m) => m.type === 'landing');
  assert.equal(landings.length, 2);
  for (const m of landings) {
    const raw = u.planLayout.treads[m.index].outline;
    assert.notDeepEqual(m.outline, raw, `landing ${m.index} nosed`);
  }
});

// TreadModel.notch: a groove cut into a tread's own underside so the riser below it can overlap
// riserTopOverlapMm UP into it (see riserSolver.js RiserModel.elevation.top) without a wood-
// movement light gap. Only exists when there is something to notch for.
test('notch is null with no riser boards and with overlap/riser-thickness at 0; a landing has one (its riser under it)', () => {
  const noRisers = build({ stairType: 'straight', treadsLegA: 3, hasRiserBoards: false });
  assert.equal(buildTreadModel(noRisers.planLayout.treads[1], noRisers.config).notch, null);

  const landingCase = build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 2, treadsLegB: 2, hasRiserBoards: true });
  const landing = landingCase.planLayout.treads.find((t) => t.type === 'landing');
  const notch = buildTreadModel(landing, landingCase.config).notch;
  assert.ok(notch, 'the landing gets the groove for its riser (user report 2026-11-17)');
  assert.equal(notch.strip.length, 4);

  const zeroOverlap = build({ stairType: 'straight', treadsLegA: 3, hasRiserBoards: true, riserTopOverlapMm: 0 });
  assert.equal(buildTreadModel(zeroOverlap.planLayout.treads[1], zeroOverlap.config).notch, null);

  const zeroThickness = build({ stairType: 'straight', treadsLegA: 3, hasRiserBoards: true, riserBoardThickness: 0 });
  assert.equal(buildTreadModel(zeroThickness.planLayout.treads[1], zeroThickness.config).notch, null);
});

test('notch depth matches riserTopOverlapMm and its outline recedes the front edge by riserBoardThickness', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 3, hasRiserBoards: true, riserTopOverlapMm: 12, riserBoardThickness: 22 });
  const model = buildTreadModel(planLayout.treads[1], config);
  assert.ok(model.notch, 'expected a notch on an ordinary tread with risers enabled');
  assert.equal(model.notch.depthMm, 12);
  assert.equal(model.notch.outline.length, model.outline.length, 'notch outline replaces only the front corners, never adds/removes points');
  assert.notDeepEqual(model.notch.outline, model.outline, 'the notch outline must actually differ from the visible (nosed) outline');
});
