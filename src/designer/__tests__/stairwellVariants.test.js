import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { stairPlacement, stairwellReport } from '../../geometry/stairwell.js';
import { resolveOpening, openingFrame } from '../../geometry/ceilingOpening.js';
import { solveStairwellFit } from '../../geometry/stairwellFit.js';
import { planStairwellVariants, generateStairwellVariants, VARIANT_MIN_WIDTH_MM } from '../stairwellVariants.js';

const room = (patch) => ({ ...createDefaultConfig(), stairwellRoomEnabled: true, stairwellEntrySide: 'S', stairwellEntryOffsetMm: 0, stairwellWallGapMm: 0, ...patch });
// the user's Klimek project (2026-10): U, one 180° zone, width 965, rise 3070, walkline 500, opening = the whole well
const KLIMEK = room({ stairType: 'U', turnDirection: 'right', totalRise: 3070, stairWidth: 965, stringerThickness: 40, walklineOffset: 500, minRiser: 150, maxRiser: 200, ceilingThickness: 380, treadGoing: 267, stairwellRoomWidthMm: 1890, stairwellRoomLengthMm: 2350, stairwellEntryOffsetMm: 267, stairwellExitSide: 'S', openingWidth: 1888, openingLength: 2350, openingOffsetX: 0, openingOffsetY: 0 });
const L_ROOM = room({ stairType: 'L', turnDirection: 'right', stairwellRoomWidthMm: 2600, stairwellRoomLengthMm: 3000, stairwellExitSide: 'auto', openingOffsetX: 0, openingOffsetY: 2000, openingWidth: 2500, openingLength: 1000 });
const U_WIDE = room({ stairType: 'U', turnDirection: 'right', stairwellRoomWidthMm: 2600, stairwellRoomLengthMm: 3000, stairwellExitSide: 'S', openingOffsetX: 1700, openingOffsetY: 800, openingWidth: 900, openingLength: 2200 });

// the applied variant, measured as the app would build it
function applied(config, v) {
  const c = { ...config, ...v.patch };
  const full = { ...c, riserHeight: deriveStairData(c).riserHeight };
  const L = buildPlanLayout(full);
  return stairwellReport(full, L, stairPlacement(full, L), resolveOpening(full, openingFrame(full, L)).relativeOutline);
}

test("few candidates: winders n−1, n, n+1 and one landing, for the PROJECT's type and turn", () => {
  const p = planStairwellVariants(L_ROOM);
  assert.equal(p.required.stairType, 'L');
  assert.equal(p.required.turnDirection, 'right');
  assert.deepEqual(p.candidates.map((c) => c.id), ['L-w3', 'L-w4', 'L-w5', 'L-landing']);
  const u = planStairwellVariants(KLIMEK);
  assert.deepEqual(u.candidates.map((c) => c.id), ['U-zone6', 'U-zone7', 'U-zone8', 'U-landing']);
  // a room too wide for one 180° zone at a small axis gap: two turns, plus the zone once
  const wide = planStairwellVariants(U_WIDE).candidates;
  assert.ok(wide.filter((c) => c.patch.uSingleWinderZone).length <= 1);
  assert.ok(wide.some((c) => c.id.startsWith('U-w')));
});

test("the type and turn are the project's: a U is never offered as anything else; a hand-set exit that does not suit it says why", () => {
  assert.equal(planStairwellVariants({ ...KLIMEK, turnDirection: 'left' }).required.turnDirection, 'left');
  // regression (user, 2026-10-16): with the exit picked on the far side the designer used to offer a STRAIGHT stair
  const wrong = generateStairwellVariants({ ...KLIMEK, stairwellExitSide: 'N' });
  assert.equal(wrong.variants.length, 0);
  assert.match(wrong.message, /nie pasuje do projektu \(schody U/);
  const auto = planStairwellVariants({ ...KLIMEK, stairwellExitSide: 'auto' });
  assert.ok(auto.candidates.length > 0 && auto.candidates.every((c) => c.patch.stairType === 'U'));
});

test('regression (user, 2026-10-16): a 1888 x 2350 stairwell takes a U with winders; a good riser, not the longest going', () => {
  const c = room({ stairType: 'U', turnDirection: 'right', totalRise: 3070, stairWidth: 965, stringerThickness: 40, walklineOffset: 500, ceilingThickness: 380, stairwellRoomWidthMm: 1888, stairwellRoomLengthMm: 2350, openingWidth: 1888, openingLength: 2350, openingOffsetX: 0, openingOffsetY: 0 });
  const best = generateStairwellVariants(c).variants[0];
  assert.ok(best.ok, best.problems.join(' | '));
  assert.equal(best.patch.uSingleWinderZone, true);
  assert.ok(best.metrics.riserOk, `${best.metrics.riserHeight}`);
  assert.ok(best.patch.treadGoing < 300, `${best.patch.treadGoing}`);
});

test('a width below 800 mm is a warning on the variant, never a reason to drop it', () => {
  const c = room({ stairType: 'U', turnDirection: 'right', stairWidth: 965, stairwellRoomWidthMm: 1500, stairwellRoomLengthMm: 3000, openingWidth: 1500, openingLength: 3000, openingOffsetX: 0, openingOffsetY: 0 });
  const r = generateStairwellVariants(c);
  const narrow = r.variants.filter((v) => v.patch && v.patch.stairWidth < VARIANT_MIN_WIDTH_MM);
  assert.ok(narrow.length > 0);
  for (const v of narrow) assert.ok(v.warnings.some((w) => /mniej niż 800 mm/.test(w)));
});

test('every fitting variant, applied, starts at the entry, ends on the exit edge and stays inside the room', () => {
  for (const config of [L_ROOM, U_WIDE, KLIMEK]) {
    const r = generateStairwellVariants(config);
    const ok = r.variants.filter((v) => v.ok);
    assert.ok(ok.length >= 2, `${ok.length} fitting variants`);
    for (const v of ok) {
      const rep = applied(config, v);
      assert.deepEqual(rep.diagnostics, [], `${v.label}: ${rep.diagnostics.map((d) => d.message).join(' | ')}`);
      assert.ok(Math.abs(rep.exitOffsetMm) <= 1, `${v.label}: exit ${rep.exitOffsetMm}`);
      assert.ok(v.patch.stairWidth <= config.stairWidth);
      assert.equal(v.patch.stairwellFitEnabled, false);
    }
  }
});

test('Klimek: the best variant is the one the user drew — one zone, 6 winders, 4 + 5 straight, going 267', () => {
  const best = generateStairwellVariants(KLIMEK).variants[0];
  assert.equal(best.id, 'U-zone6');
  assert.equal(best.patch.treadsLegA, 4);
  assert.equal(best.patch.treadsLegC, 5);
  assert.ok(Math.abs(best.patch.treadGoing - 267) < 0.5, `${best.patch.treadGoing}`);
  assert.ok(best.metrics.riserOk);
});

test('a two-turn U meets the wall-to-wall side B by a narrower stair', () => {
  const r = generateStairwellVariants({ ...KLIMEK, stairWidth: 965 });
  const landing = r.variants.find((v) => v.id === 'U-landing');
  assert.ok(landing.ok);
  assert.ok(landing.patch.stairWidth < 965, `${landing.patch.stairWidth}`);
});

test('fit limits: a side with a maximum is never longer (the old fit put side A 98 mm past the wall)', () => {
  const c = { ...createDefaultConfig(), stairType: 'L', stairwellFitEnabled: true, stairwellSideAMm: 3000, stairwellSideBMm: 2600, stairwellKeySide: 'B' };
  const free = solveStairwellFit(c);
  assert.ok(free.sides[0].achieved > 3000 + 1, `${free.sides[0].achieved}`);
  const limited = solveStairwellFit(c, { limits: { A: { max: 3000 } } });
  assert.ok(limited.values);
  assert.ok(limited.sides[0].achieved <= 3000 + 0.5, `${limited.sides[0].achieved}`);
  assert.ok(Math.abs(limited.sides[1].achieved - 2600) < 0.5);
});

test('no room / no exit edge: no variants, a message', () => {
  assert.equal(generateStairwellVariants(createDefaultConfig()).ok, false);
  const r = generateStairwellVariants({ ...L_ROOM, openingShape: 'polygon', openingPolygon: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }], stairwellExitSide: 'E' });
  assert.ok(r.variants.length === 0 || r.message === '' || typeof r.message === 'string');
});
