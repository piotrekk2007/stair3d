import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData, BLONDEL_RANGE_MM } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { solveStairwellFit, applyStairwellFit, outerSideLengths, stairwellDrivenFields, FIT_GOING_RANGE_MM } from '../stairwellFit.js';
import { getRuleById } from '../../rules/catalogue.js';

const SIDE_TOLERANCE_MM = 0.5;

function sidesOf(config) {
  const full = { ...config, riserHeight: deriveStairData(config).riserHeight };
  return outerSideLengths(buildPlanLayout(full));
}

function fitConfig(patch) {
  return { ...createDefaultConfig(), stairwellFitEnabled: true, ...patch };
}

test('outerSideLengths: one length per straight side of the outer line (collinear points merged)', () => {
  const d = createDefaultConfig();
  assert.deepEqual(sidesOf({ ...d, stairType: 'straight' }).map(Math.round), [d.treadsLegA * d.treadGoing]);
  assert.equal(sidesOf({ ...d, stairType: 'L' }).length, 2);
  assert.equal(sidesOf({ ...d, stairType: 'U' }).length, 3);
  assert.equal(sidesOf({ ...d, stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: true }).length, 3);
  assert.equal(sidesOf({ ...d, stairType: 'L', turnDirection: 'left' }).length, 2);
});

test('fit off: nothing changes, no findings', () => {
  const config = createDefaultConfig();
  const fit = solveStairwellFit(config);
  assert.equal(fit.status, 'OFF');
  assert.equal(fit.values, null);
  assert.deepEqual(fit.diagnostics, []);
  assert.equal(applyStairwellFit(config, fit), config);
  assert.deepEqual(stairwellDrivenFields(config), []);
});

test('the key side comes out exactly, for every stair type and every key side', () => {
  const cases = [
    { stairType: 'straight', stairwellSideAMm: 3600, stairwellKeySide: 'A' },
    { stairType: 'L', stairwellSideAMm: 2400, stairwellSideBMm: 2900, stairwellKeySide: 'A' },
    { stairType: 'L', stairwellSideAMm: 2400, stairwellSideBMm: 2900, stairwellKeySide: 'B' },
    { stairType: 'L', turn1Type: 'landing', stairwellSideAMm: 2600, stairwellSideBMm: 2300, stairwellKeySide: 'B' },
    { stairType: 'U', stairwellSideAMm: 2200, stairwellSideBMm: 2600, stairwellSideCMm: 2500, stairwellKeySide: 'C' },
    { stairType: 'U', stairwellSideAMm: 2200, stairwellSideBMm: 2600, stairwellSideCMm: 2500, stairwellKeySide: 'A' },
  ];
  for (const patch of cases) {
    const config = fitConfig(patch);
    const fit = solveStairwellFit(config);
    assert.ok(fit.values, `${JSON.stringify(patch)}: ${fit.message}`);
    const key = patch.stairwellKeySide;
    const letters = patch.stairType === 'U' ? ['A', 'B', 'C'] : patch.stairType === 'L' ? ['A', 'B'] : ['A'];
    const built = sidesOf(applyStairwellFit(config, fit));
    assert.ok(Math.abs(built[letters.indexOf(key)] - patch[`stairwellSide${key}Mm`]) <= SIDE_TOLERANCE_MM, `${JSON.stringify(patch)}: key side ${built[letters.indexOf(key)]}`);
    assert.ok(fit.values.treadGoing >= FIT_GOING_RANGE_MM.min && fit.values.treadGoing <= FIT_GOING_RANGE_MM.max);
    const derived = deriveStairData(applyStairwellFit(config, fit));
    assert.ok(derived.riserRangeOk, 'riser height stays within minRiser..maxRiser');
  }
});

test('2h+s only breaks a tie: with just the key side given, the variant closest to the band middle is taken', () => {
  const fit = solveStairwellFit(fitConfig({ stairType: 'straight', stairwellSideAMm: 3600 }));
  assert.ok(fit.blondel >= BLONDEL_RANGE_MM.min && fit.blondel <= BLONDEL_RANGE_MM.max, `2h+s = ${fit.blondel}`);
});

test('2h+s is informational: it never makes a given side come out further from its dimension', () => {
  // L, key B = 2900, A = 2100, floor height 3000 (walkline-arc winders). Inside the 600-650 band the best variant is
  // 127 mm short of side A; the closest to the dimension is +17 mm with 2h+s = 560 (checked by brute force over every
  // tread count, the key side solved for each). The dimension wins.
  const fit = solveStairwellFit(fitConfig({ totalRise: 3000, stairwellSideAMm: 2100, stairwellSideBMm: 2900, stairwellKeySide: 'B' }));
  const a = fit.sides.find((s) => s.side === 'A');
  assert.equal(Math.round(a.deviation), 17);
  assert.ok(fit.blondel < BLONDEL_RANGE_MM.min, 'the chosen variant is outside the band - reported by the validator, not avoided here');
  assert.ok(!fit.diagnostics.some((d) => d.parameter === 'blondel'));
});

test('the default L stair measured back into targets is reproduced exactly (going and counts)', () => {
  const d = createDefaultConfig();
  const [a, b] = sidesOf(d);
  const fit = solveStairwellFit(fitConfig({ stairwellSideAMm: a, stairwellSideBMm: b }));
  assert.equal(fit.status, 'OK');
  for (const s of fit.sides) assert.ok(Math.abs(s.deviation) <= SIDE_TOLERANCE_MM);
});

test('a non-key side that cannot be met is reported as a WARNING with its deviation, never silently', () => {
  const fit = solveStairwellFit(fitConfig({ stairwellSideAMm: 2400, stairwellSideBMm: 2900, stairwellKeySide: 'B' }));
  assert.equal(fit.status, 'APPROX');
  const a = fit.sides.find((s) => s.side === 'A');
  assert.ok(Math.abs(a.deviation) > SIDE_TOLERANCE_MM);
  const warning = fit.diagnostics.find((d) => d.parameter === 'stairwellSideAMm');
  assert.equal(warning.severity, 'WARNING');
  assert.equal(warning.ruleId, 'STAIR3D-FIT-01');
  assert.equal(warning.expected, 2400);
});

test('a side without a target keeps the user\'s own tread count', () => {
  const config = fitConfig({ stairwellSideAMm: 1800, treadsLegB: 7 });
  const fit = solveStairwellFit(config);
  assert.equal(fit.values.treadsLegB, 7);
  assert.deepEqual(stairwellDrivenFields(config), ['treadGoing', 'treadsLegA']);
});

test('no key dimension / no solution: ERROR, and the stair is built from the user\'s own values', () => {
  const noKey = fitConfig({ stairwellSideAMm: 2250, stairwellKeySide: 'B' });
  const f1 = solveStairwellFit(noKey);
  assert.equal(f1.status, 'NO_KEY');
  assert.equal(f1.values, null);
  assert.equal(f1.diagnostics[0].severity, 'ERROR');

  const impossible = fitConfig({ stairwellSideAMm: 500 });
  const f2 = solveStairwellFit(impossible);
  assert.equal(f2.status, 'NO_SOLUTION');
  assert.equal(f2.diagnostics[0].severity, 'ERROR');
  const built = buildStaircase(impossible);
  assert.equal(built.fullConfig.treadGoing, impossible.treadGoing);
  assert.equal(built.fullConfig.treadsLegA, impossible.treadsLegA);
});

test('buildStaircase builds from the fitted values, and writing them back into config is a fixed point', () => {
  const config = fitConfig({ stairwellSideAMm: 2400, stairwellSideBMm: 3000 });
  const built = buildStaircase(config);
  assert.ok(built.stairwellFit.values);
  assert.equal(built.fullConfig.treadGoing, built.stairwellFit.values.treadGoing);
  const again = solveStairwellFit({ ...config, ...built.stairwellFit.values });
  assert.deepEqual(again.values, built.stairwellFit.values);
});

test('the fit\'s findings reach the takeoff validation gate', async () => {
  const { runTakeoffValidationGate } = await import('../../takeoff/validationGate.js');
  const built = buildStaircase(fitConfig({ stairwellSideAMm: 2400, stairwellSideBMm: 2900, stairwellKeySide: 'B' }));
  const gate = runTakeoffValidationGate(built);
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'STAIR3D-FIT-01'));
});

test('STAIR3D-FIT-01 is in the rules catalogue as a SOFTWARE_DESIGN_CHOICE', () => {
  const rule = getRuleById('STAIR3D-FIT-01');
  assert.ok(rule);
  assert.equal(rule.ruleType, 'SOFTWARE_DESIGN_CHOICE');
});

test('regression: a straight stair\'s plan bounds include its width (the outer line alone has zero width)', () => {
  const d = createDefaultConfig();
  const config = { ...d, stairType: 'straight' };
  const layout = buildPlanLayout({ ...config, riserHeight: deriveStairData(config).riserHeight });
  assert.equal(Math.round(layout.bounds.maxX - layout.bounds.minX), d.stairWidth);
});

// The user's project (2026-10-10): a tight stairwell, 2810 mm to climb. Side B (key) 1610, side A 1320.
const tight = { stairType: 'L', totalRise: 2810, stairWidth: 890, windersPerTurn: 4, stairwellSideAMm: 1320, stairwellSideBMm: 1610, stairwellKeySide: 'B', treadsLegA: 2, treadsLegB: 4, treadGoing: 180 };

test('the given dimensions come first: a stairwell too short for a regular riser still gets a stair that fits it', () => {
  const config = fitConfig(tight);
  const fit = solveStairwellFit(config);
  assert.ok(fit.values, fit.message);
  const [a, b] = fit.sides;
  assert.ok(Math.abs(b.achieved - 1610) < SIDE_TOLERANCE_MM, 'the key side is exact');
  // (the old fit kept the riser in range at any price: 7 treads on side A, 2410 mm in a 1320 mm room)
  assert.ok(Math.abs(a.deviation) <= fit.values.treadGoing + SIDE_TOLERANCE_MM, `side A is within one going of its dimension (${Math.round(a.achieved)} mm)`);
  assert.ok(fit.values.treadsLegA <= 3);
  // the riser this forces is out of range — said so, as a WARNING, and the sides are reproduced by a real layout
  const riser = fit.diagnostics.find((d) => d.parameter === 'stairwellFit');
  assert.ok(riser && riser.severity === 'WARNING' && riser.value > config.maxRiser, 'the out-of-range riser is reported');
  assert.ok(fit.diagnostics.every((d) => d.severity !== 'ERROR'));
  const sides = sidesOf(applyStairwellFit(config, fit));
  assert.ok(Math.abs(sides[1] - 1610) < SIDE_TOLERANCE_MM && Math.abs(sides[0] - a.achieved) < SIDE_TOLERANCE_MM);
  // a going below the former 180 mm minimum is found (the winder zone is laid out differently there, so the side is
  // not one straight line of the going)
  assert.ok(fit.values.treadGoing < 180 && fit.values.treadGoing >= FIT_GOING_RANGE_MM.min);

  // with room for a regular stair nothing changes: the riser stays in range and no riser warning appears
  const roomy = solveStairwellFit(fitConfig({ stairType: 'L', stairwellSideAMm: 2400, stairwellSideBMm: 2900, stairwellKeySide: 'B' }));
  assert.ok(roomy.values && roomy.riserHeight >= 150 && roomy.riserHeight <= 200);
  assert.ok(!roomy.diagnostics.some((d) => d.parameter === 'stairwellFit'));
});

test('manual counts: the tread counts stay the user\'s (and editable), only the going is fitted to the key side', () => {
  const config = fitConfig({ ...tight, stairwellManualCounts: true });
  assert.deepEqual(stairwellDrivenFields(config), ['treadGoing']);
  assert.deepEqual(stairwellDrivenFields({ ...config, stairwellManualCounts: false }), ['treadGoing', 'treadsLegA', 'treadsLegB']);
  const fit = solveStairwellFit(config);
  assert.equal(fit.manualCounts, true);
  assert.deepEqual([fit.values.treadsLegA, fit.values.treadsLegB], [2, 4]);
  assert.ok(Math.abs(fit.sides[1].achieved - 1610) < SIDE_TOLERANCE_MM);
  // one more tread on A: the same going (B decides it), side A one going longer, reported
  const more = solveStairwellFit({ ...config, treadsLegA: 3 });
  assert.equal(more.values.treadsLegA, 3);
  assert.ok(Math.abs(more.values.treadGoing - fit.values.treadGoing) < 1e-6);
  assert.ok(Math.abs(more.sides[0].achieved - fit.sides[0].achieved - fit.values.treadGoing) < SIDE_TOLERANCE_MM);
  assert.ok(more.diagnostics.some((d) => d.parameter === 'stairwellSideAMm' && d.severity === 'WARNING'));
  // counts that cannot give the key side at any allowed going: ERROR, the user's values stay
  const none = solveStairwellFit({ ...config, treadsLegB: 15 });
  assert.equal(none.status, 'NO_SOLUTION');
  assert.equal(none.values, null);
  assert.match(none.message, /ręcznie ustawionych liczbach stopni/);
});

test('a U laid out as one 180° winder zone: side B (two widths + the gap between A and C) is met EXACTLY by the axis gap', () => {
  // the user's project (2026-10-14): width 920, B = 1886 — no tread count can change B, only the axis gap
  const config = fitConfig({ stairType: 'U', totalRise: 3070, stairWidth: 920, treadsLegA: 5, treadsLegB: 0, treadsLegC: 5, uSingleWinderZone: true, uWindersTotal: 6, uAxisGapMm: 95, stairwellSideAMm: 2000, stairwellSideBMm: 1886, stairwellSideCMm: 2350, stairwellKeySide: 'C', stairwellManualCounts: true });
  const fit = solveStairwellFit(config);
  assert.ok(fit.values);
  assert.equal(fit.values.uAxisGapMm, 1886 - 2 * 920 + config.stringerThickness);
  const b = fit.sides.find((s) => s.side === 'B');
  assert.ok(Math.abs(b.achieved - 1886) < SIDE_TOLERANCE_MM, `${b.achieved}`);
  assert.ok(Math.abs(sidesOf(applyStairwellFit(config, fit))[1] - 1886) < SIDE_TOLERANCE_MM);
  assert.ok(!fit.diagnostics.some((d) => d.parameter === 'stairwellSideBMm'), 'B is not reported as missed');
  // the axis gap is shown as derived (AUTO); without a B dimension it stays the user's
  assert.ok(stairwellDrivenFields(config).includes('uAxisGapMm'));
  assert.ok(!stairwellDrivenFields({ ...config, stairwellSideBMm: 0 }).includes('uAxisGapMm'));
  assert.equal(solveStairwellFit({ ...config, stairwellSideBMm: 0 }).values.uAxisGapMm, undefined);
});
