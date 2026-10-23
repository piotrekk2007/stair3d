import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildPlanLayout } from '../planLayout.js';
import { deriveStairData } from '../../config/schema.js';
import { wellSideState, wellMainSide, lineSides } from '../stairwell.js';

const base = (patch) => ({ ...createDefaultConfig(), stairwellRoomEnabled: true, turnDirection: 'left', windersPerTurn: 3, ...patch });
const sides = (b) => Object.fromEntries(b.stairwell.sides.map((s) => [s.side, s.achieved]));

test('side states: free / rigid / main — older projects read from "sztywny" (the exit side, else the first, is main); one main only', () => {
  const legacy = base({ stairType: 'U', stairwellSideAFixed: true, stairwellSideCFixed: true });
  assert.deepEqual(['A', 'B', 'C'].map((s) => wellSideState(legacy, s)), ['rigid', 'free', 'main']);
  assert.equal(wellMainSide({ ...legacy, stairwellSideAMm: 2000, stairwellSideCMm: 2000 }), 'C');
  const two = base({ stairType: 'U', stairwellSideAState: 'main', stairwellSideBState: 'main', stairwellSideCState: 'free', stairwellSideAMm: 2000, stairwellSideBMm: 2000 });
  assert.deepEqual(['A', 'B', 'C'].map((s) => wellSideState(two, s)), ['main', 'rigid', 'free']);
  assert.equal(wellMainSide(two), 'A');
});

test('regression (user, 2026-10-23): EVERY rigid side comes out exactly — not only the main one (L: A rigid, B main)', () => {
  const b = buildStaircase(base({ stairType: 'L', treadsLegA: 4, treadsLegB: 4, stairwellSideAMm: 2400, stairwellSideBMm: 2050, stairwellSideAState: 'rigid', stairwellSideBState: 'main' }));
  const s = sides(b);
  assert.ok(Math.abs(s.A - 2400) <= 1, `A ${s.A}`);
  assert.ok(Math.abs(s.B - 2050) <= 1, `B ${s.B}`);
  assert.equal(b.stairwell.diagnostics.length, 0);
  assert.equal(b.fullConfig.stairWidth, createDefaultConfig().stairWidth, 'met without narrowing the stair');
});

test("regression (user, 2026-10-23): the user's S — A 1150, B 1040, C 1202 all rigid — every side exact (each turn's winders shifted, the stair narrowed only as needed)", () => {
  const b = buildStaircase(base({ stairType: 'S', treadsLegA: 1, treadsLegB: 1, treadsLegC: 4, stairWidth: 800, totalRise: 3000, stairwellSideAMm: 1150, stairwellSideBMm: 1040, stairwellSideCMm: 1202, stairwellSideAState: 'rigid', stairwellSideBState: 'rigid', stairwellSideCState: 'main' }));
  const s = sides(b);
  for (const [x, v] of [['A', 1150], ['B', 1040], ['C', 1202]]) assert.ok(Math.abs(s[x] - v) <= 1, `${x} ${s[x]}`);
  assert.ok(b.fullConfig.stairWidth <= 800);
  // the two turns are shifted on their own
  const shifts = b.fullConfig.turnSplitOffsetsMm;
  assert.ok(Array.isArray(shifts) && shifts.length === 2);
});

test('U with all three sides rigid: exact, and the fit is stable — its values copied back (without the turn shifts) give the same stair', () => {
  const config = base({ stairType: 'U', treadsLegA: 4, treadsLegB: 2, treadsLegC: 4, stairwellSideAMm: 2300, stairwellSideBMm: 2500, stairwellSideCMm: 2100, stairwellSideAState: 'rigid', stairwellSideBState: 'rigid', stairwellSideCState: 'main' });
  const first = buildStaircase(config);
  for (const [x, v] of [['A', 2300], ['B', 2500], ['C', 2100]]) assert.ok(Math.abs(sides(first)[x] - v) <= 1, `${x}`);
  const { turnSplitOffsetsMm, ...copied } = first.stairwellFit.values;
  const again = buildStaircase({ ...config, ...copied });
  assert.deepEqual(again.stairwellFit.values, first.stairwellFit.values);
});

test("a turn's own split (turnSplitOffsetsMm) moves its winder zone: what one side gains the next loses", () => {
  const c = base({ stairType: 'L', treadsLegA: 4, treadsLegB: 4 });
  const at = (split) => {
    const L = buildPlanLayout({ ...c, turnSplitOffsetsMm: [split, null], riserHeight: deriveStairData(c).riserHeight });
    const s = lineSides(L, 'outer', 'L');
    return [s.A.length, s.B.length];
  };
  const [a0, b0] = at(350);
  const [a1, b1] = at(380);
  assert.ok(Math.abs(a1 - a0 - 30) < 0.5 && Math.abs(b0 - b1 - 30) < 0.5, `${a1 - a0} / ${b0 - b1}`);
});

test('a rigid side that cannot be met is an ERROR saying what to change (the user values stay)', () => {
  const b = buildStaircase(base({ stairType: 'L', treadsLegA: 4, treadsLegB: 4, stairwellSideAMm: 900, stairwellSideBMm: 6000, stairwellSideAState: 'rigid', stairwellSideBState: 'main' }));
  const d = b.stairwell.diagnostics.find((x) => x.ruleId === 'STAIRWELL-SIDE-FIXED');
  assert.ok(d, 'reported');
  assert.equal(d.severity, 'ERROR');
  assert.match(d.message, /Zmień liczbę stopni zabiegowych/);
});
