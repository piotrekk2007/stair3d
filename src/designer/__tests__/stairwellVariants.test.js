import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { solveStairwellFit } from '../../geometry/stairwellFit.js';
import { planStairwellVariants, generateStairwellVariants, VARIANT_MIN_WIDTH_MM } from '../stairwellVariants.js';

const well = (patch) => ({ ...createDefaultConfig(), stairwellRoomEnabled: true, totalRise: 3070, stairWidth: 965, stringerThickness: 40, walklineOffset: 500, ...patch });
// the user's case (2026-10-16): U, B = 1885 wall to wall and C = 2350 wall to the slab edge FIXED, A free
const USER_U = well({ stairType: 'U', turnDirection: 'right', stairwellSideBMm: 1885, stairwellSideBFixed: true, stairwellSideCMm: 2350, stairwellSideCFixed: true });
const L_B = well({ stairType: 'L', turnDirection: 'right', stairwellSideBMm: 2600, stairwellSideBFixed: true });
const U_WIDE = well({ stairType: 'U', turnDirection: 'right', stairwellSideBMm: 2600, stairwellSideBFixed: true, stairwellSideCMm: 2500, stairwellSideCFixed: true });

const side = (v, s) => v.sides.find((x) => x.side === s);

test('few candidates for the project\'s type: winders n−1..n+1 and one landing; the key is the fixed exit side', () => {
  const p = planStairwellVariants(L_B);
  assert.equal(p.key, 'B');
  assert.deepEqual(p.free, ['A']);
  assert.deepEqual(p.candidates.map((c) => c.id), ['L-w3', 'L-w4', 'L-w5', 'L-landing']);
  const u = planStairwellVariants(USER_U);
  assert.equal(u.key, 'C');
  assert.ok(u.candidates.every((c) => c.patch.stairType === 'U'));
  assert.deepEqual(u.candidates.map((c) => c.id), ['U-zone6', 'U-zone7', 'U-zone8', 'U-landing']);
  assert.ok(planStairwellVariants(U_WIDE).candidates.some((c) => c.id.startsWith('U-w')));
});

test('regression (user, 2026-10-16): B 1885 and C 2350 fixed come out EXACTLY; A floats with the counts', () => {
  const r = generateStairwellVariants(USER_U);
  const ok = r.variants.filter((v) => v.ok);
  assert.ok(ok.length >= 3);
  for (const v of ok) {
    assert.ok(Math.abs(side(v, 'B').achieved - 1885) <= 1, `${v.label}: B ${side(v, 'B').achieved}`);
    assert.ok(Math.abs(side(v, 'C').achieved - 2350) <= 1, `${v.label}: C ${side(v, 'C').achieved}`);
    // applied, the stair reports nothing off
    assert.deepEqual(buildStaircase({ ...USER_U, ...v.patch }).stairwell.diagnostics, [], v.label);
  }
  // A is free: the variants do not all share one A (the entry floats)
  assert.ok(new Set(ok.map((v) => Math.round(side(v, 'A').achieved))).size > 1);
  // one zone at a B under 2 × 965 − 40: the stair narrows to fit (axis gap 0)
  const zone = ok.find((v) => v.patch.uSingleWinderZone);
  assert.ok(Math.abs(zone.patch.stairWidth - 962.5) < 0.01, `${zone.patch.stairWidth}`);
  assert.ok(r.variants[0].metrics.riserOk);
});

test('a two-turn U meets a fixed wall-to-wall B by narrowing the stair', () => {
  const v = generateStairwellVariants(U_WIDE).variants.find((x) => x.id.startsWith('U-w') && x.ok);
  assert.ok(v);
  assert.ok(Math.abs(side(v, 'B').achieved - 2600) <= 1);
  assert.ok(v.patch.stairWidth <= 965);
});

test('a fixed side that cannot be met is listed with the problem, not hidden', () => {
  const c = well({ stairType: 'U', turnDirection: 'right', stairwellSideAMm: 2083, stairwellSideAFixed: true, stairwellSideBMm: 1885, stairwellSideBFixed: true, stairwellSideCMm: 2350, stairwellSideCFixed: true });
  const r = generateStairwellVariants(c);
  assert.ok(r.variants.some((v) => v.ok), 'some variant meets all three');
  for (const v of r.variants.filter((x) => x.metrics && !x.ok)) assert.ok(v.problems.some((p) => /Bok A \(sztywny\)/.test(p)), v.label);
});

test('a width below 800 mm is a warning on the variant, never a reason to drop it', () => {
  const c = well({ stairType: 'U', turnDirection: 'right', stairwellSideBMm: 1500, stairwellSideBFixed: true, stairwellSideCMm: 2500, stairwellSideCFixed: true });
  const narrow = generateStairwellVariants(c).variants.filter((v) => v.patch && v.patch.stairWidth < VARIANT_MIN_WIDTH_MM);
  assert.ok(narrow.length > 0);
  for (const v of narrow) assert.ok(v.warnings.some((w) => /mniej niż 800 mm/.test(w)));
});

test('no stairwell / no fixed side: no variants, a message', () => {
  assert.match(generateStairwellVariants(createDefaultConfig()).message, /Włącz wymiary klatki/);
  assert.match(generateStairwellVariants(well({ stairType: 'L' })).message, /co najmniej jeden wymiar/);
});

test('fit freeSides: a side with no target still gets its count chosen (for the riser), instead of keeping the config\'s', () => {
  const c = { ...createDefaultConfig(), stairType: 'L', treadsLegA: 1, stairwellFitEnabled: true, stairwellSideBMm: 2600, stairwellKeySide: 'B' };
  const kept = solveStairwellFit(c);
  assert.equal(kept.values.treadsLegA, 1);
  const chosen = solveStairwellFit(c, { freeSides: ['A'] });
  assert.ok(chosen.values.treadsLegA > 1, `${chosen.values.treadsLegA}`);
  assert.ok(chosen.riserHeight <= c.maxRiser);
});

test('fit limits: a side with a maximum is never longer (the old fit put side A 98 mm past the wall)', () => {
  const c = { ...createDefaultConfig(), stairType: 'L', stairwellFitEnabled: true, stairwellSideAMm: 3000, stairwellSideBMm: 2600, stairwellKeySide: 'B' };
  const free = solveStairwellFit(c);
  assert.ok(free.sides[0].achieved > 3000 + 1, `${free.sides[0].achieved}`);
  const limited = solveStairwellFit(c, { limits: { A: { max: 3000 } } });
  assert.ok(limited.values);
  assert.ok(limited.sides[0].achieved <= 3000 + 0.5, `${limited.sides[0].achieved}`);
});
