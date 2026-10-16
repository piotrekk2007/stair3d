import test from 'node:test';
import assert from 'node:assert/strict';

import { minAreaRectUV } from '../stockGeometry.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';

test('minAreaRectUV: an axis-aligned rectangle is itself, in any point order', () => {
  const r = minAreaRectUV([{ u: 0, v: 0 }, { u: 400, v: 0 }, { u: 400, v: 100 }, { u: 0, v: 100 }]);
  assert.equal(r.lengthMm, 400);
  assert.equal(r.widthMm, 100);
});

test('minAreaRectUV: a rotated rectangle is found in its own frame (not its axis-aligned bounding box)', () => {
  const a = (30 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot = ([x, y]) => ({ u: x * c - y * s, v: x * s + y * c });
  const r = minAreaRectUV([[0, 0], [1000, 0], [1000, 350], [0, 350]].map(rot));
  assert.ok(Math.abs(r.lengthMm - 1000) < 0.01 && Math.abs(r.widthMm - 350) < 0.01, `${r.lengthMm} x ${r.widthMm}`);
});

test('minAreaRectUV: never smaller than the shape (covers every point) and deterministic', () => {
  const pts = [{ u: 0, v: 0 }, { u: 900, v: 400 }, { u: 950, v: 700 }, { u: 100, v: 380 }, { u: 500, v: 600 }];
  const a = minAreaRectUV(pts);
  assert.deepEqual(a, minAreaRectUV(pts));
  assert.ok(a.lengthMm * a.widthMm >= 0.5 * Math.abs(pts.reduce((s, p, i) => s + p.u * pts[(i + 1) % pts.length].v - pts[(i + 1) % pts.length].u * p.v, 0)));
});

function stringerItems(patch) {
  const config = { ...createDefaultConfig(), ...patch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const models = {
    fullConfig,
    derived,
    planLayout,
    treadModels: buildTreadModels(planLayout, fullConfig),
    riserModels: buildRiserModels(planLayout, fullConfig),
    stringerModels,
    stringerConstruction: { outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig), inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig) },
    postModels: buildPostModels(planLayout, fullConfig),
  };
  return computeMaterialTakeoff(models, fullConfig).filter((i) => i.elementType === 'STRINGER');
}

test('straight flight: the stringer blank is exactly the design depth wide (nothing hidden in the comb or the slanted ends)', () => {
  for (const type of ['cut', 'closed']) {
    for (const item of stringerItems({ stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, stringerConstructionTypeOuter: type, stringerConstructionTypeInner: type })) {
      assert.equal(item.calculatedDimensions.boardWidthMm, 350, type);
      assert.equal(item.nominalDimensions.boardWidthMm, 350, 'the nominal (design) depth is kept separately');
      assert.ok(item.notes.some((n) => /Formatka wangi/.test(n)));
    }
  }
});

test('winder: the stringer blank is deeper than the design depth — the real board that must be bought', () => {
  const items = stringerItems({ stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, totalRise: 2700, treadGoing: 280, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  assert.ok(items.length >= 2);
  assert.ok(items.every((i) => i.calculatedDimensions.boardWidthMm >= 350 - 0.01));
  assert.ok(items.some((i) => i.calculatedDimensions.boardWidthMm > 400), 'at least one winder board needs a wider blank than the design depth');
  for (const i of items) assert.ok(i.stockArea * 1e6 >= i.netArea * 1e6 - 1, 'STOCK never below NET');
});

// --- fairer stringer pricing (user decision 2026-10-16): whole blank | 400 mm strips | two blanks -----------------
import { stringerStrips, stringerSplitBlanks } from '../stockGeometry.js';
import { applyBoardPricing as priceBoards, createDefaultBoardPricing as defaultBoardPricing, sanitizeBoardPricing, STRINGER_PRICING_MODES } from '../boardPricing.js';

// A board 320 mm deep along 3000 mm, ending in a 650 mm deep piece over its last 300 mm.
const wideEnd = [
  { u: 0, v: 0 }, { u: 2700, v: 0 }, { u: 2700, v: -330 }, { u: 3000, v: -330 }, { u: 3000, v: 320 }, { u: 0, v: 320 },
];
// A board 350 mm deep that bends: 2000 mm at 30°, then 1200 mm at 45°.
const bend = (() => {
  const d = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const [c1, s1] = d(30);
  const [c2, s2] = d(45);
  const k = { u: 2000 * c1, v: 2000 * s1 };
  const e = { u: k.u + 1200 * c2, v: k.v + 1200 * s2 };
  const off = (p, deg) => ({ u: p.u - 350 * Math.sin((deg * Math.PI) / 180), v: p.v + 350 * Math.cos((deg * Math.PI) / 180) });
  return [{ u: 0, v: 0 }, k, e, off(e, 45), off(k, 37.5), off({ u: 0, v: 0 }, 30)];
})();

test('strips: the blank in 400 mm pieces, each as deep as the board is THERE (not the deepest place)', () => {
  const strips = stringerStrips(wideEnd);
  assert.ok(Math.abs(strips.reduce((s, x) => s + x.lengthMm, 0) - 3000) < 1e-6, 'the whole length');
  assert.ok(strips.every((x) => x.lengthMm <= 400 + 1e-6));
  assert.ok(strips.slice(0, 6).every((x) => Math.abs(x.depthMm - 320) < 1), strips.map((x) => x.depthMm).join(','));
  assert.ok(Math.abs(strips[strips.length - 1].depthMm - 650) < 1, 'the wide end');
  // a bending board: every strip about the board's own depth, far below its one straight blank
  const bent = stringerStrips(bend);
  assert.ok(bent.every((x) => x.depthMm < 350 / Math.cos((7.5 * Math.PI) / 180) + 400 * Math.tan((7.5 * Math.PI) / 180)), bent.map((x) => Math.round(x.depthMm)).join(','));
  assert.ok(Math.max(...bent.map((x) => x.depthMm)) < minAreaRectUV(bend).widthMm - 50);
});

test('split: two straight blanks where they save the most material; one blank when a split saves nothing', () => {
  const parts = stringerSplitBlanks(bend);
  assert.equal(parts.length, 2);
  const whole = minAreaRectUV(bend);
  assert.ok(parts.reduce((s, p) => s + p.lengthMm * p.depthMm, 0) < whole.lengthMm * whole.widthMm * 0.85);
  assert.ok(parts.every((p) => p.depthMm < whole.widthMm));
  // a straight board: nothing to gain
  const straight = [{ u: 0, v: 0 }, { u: 3000, v: 0 }, { u: 3000, v: 350 }, { u: 0, v: 350 }];
  assert.deepEqual(stringerSplitBlanks(straight), [{ lengthMm: 3000, depthMm: 350 }]);
});

test('pricing modes: the same wanga as ONE price — whole blank (default), strips, split; the note says what was priced', () => {
  const item = {
    itemId: 'stringer-outer-x',
    elementType: 'STRINGER',
    status: 'OK',
    quantity: 1,
    notes: [],
    stockArea: 1,
    wasteAdjustedUnit: 'm2',
    calculatedDimensions: { lengthMm: 3000, boardWidthMm: 650, thicknessMm: 40, stringerPricing: { strips: stringerStrips(wideEnd), split: stringerSplitBlanks(wideEnd) } },
  };
  const price = (mode) => priceBoards([item], { ...defaultBoardPricing(), stringerPricingMode: mode })[0];
  const whole = price(STRINGER_PRICING_MODES.WHOLE);
  const strips = price(STRINGER_PRICING_MODES.STRIPS);
  const split = price(STRINGER_PRICING_MODES.SPLIT);
  // whole: exactly as before — the 650 mm row over the full 3000 mm
  assert.deepEqual(priceBoards([item], defaultBoardPricing())[0].calculatedCost, whole.calculatedCost);
  assert.equal(whole.priceBreakdown.depthMm, 650);
  // strips: 320 mm rows for 2700 mm, the 650 mm row for 300 mm
  assert.ok(strips.calculatedCost < whole.calculatedCost * 0.75, `${strips.calculatedCost} vs ${whole.calculatedCost}`);
  assert.equal(strips.priceBreakdown.mode, 'strips');
  assert.match(strips.notes[strips.notes.length - 1], /pasy co 400 mm/);
  // split: the wide end as its own short blank (350 x 650 here — measured along the board, not its longer side)
  assert.deepEqual(split.priceBreakdown.pieces.map((p) => [Math.round(p.lengthMm), Math.round(p.depthMm)]), [[2650, 320], [350, 650]]);
  assert.ok(split.calculatedCost < whole.calculatedCost * 0.75, `${split.calculatedCost}`);
  assert.match(split.notes[split.notes.length - 1], /dwie formatki|jedna formatka/);
  // every mode prices with the whole board's length column (it is one board)
  assert.ok(strips.priceBreakdown.pieces.length > 1);
  // the setting is saved and read back; anything else means "whole"
  assert.equal(sanitizeBoardPricing({ stringerPricingMode: 'strips' }).stringerPricingMode, 'strips');
  assert.equal(sanitizeBoardPricing({ stringerPricingMode: 'nonsense' }).stringerPricingMode, 'whole');
  assert.equal(defaultBoardPricing().stringerPricingMode, 'whole');
});
