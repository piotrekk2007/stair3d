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
  // L, key B = 2900, A = 2400, floor height 3000. Inside the 600-650 band the best is side A = 2580 (+180); the
  // closest to the dimension is 6+6 treads at a 254.5 mm going, side A = 2427 (+27) with 2h+s = 588. The dimension wins.
  const fit = solveStairwellFit(fitConfig({ totalRise: 3000, stairwellSideAMm: 2400, stairwellSideBMm: 2900, stairwellKeySide: 'B' }));
  const a = fit.sides.find((s) => s.side === 'A');
  assert.equal(Math.round(a.deviation), 27);
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
