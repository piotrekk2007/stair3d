import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { buildPricedMaterialTakeoff } from '../index.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { computeWinderBlank } from '../../geometry/winderBlank.js';
import {
  createDefaultBoardPricing,
  thicknessClassFor,
  lengthTierFor,
  lookupBoardPricePerMb,
  parseBoardsCSV,
  boardsToCSV,
  sanitizeBoardPricing,
  boardMaterialId,
  applyBoardPricing,
  RISER_MATERIALS,
} from '../boardPricing.js';

const table = () => createDefaultBoardPricing().table;
const ask = (over) => lookupBoardPricePerMb(table(), { species: 'Dąb', cls: 'Klasa Natura', thicknessMm: 40, depthMm: 320, lengthMm: 900, ...over });

// ---- wartości oczekiwane policzone ręcznie wg class-calculator.php (DREWEX) ----

test('thickness classes follow the DREWEX ranges 10–20 / 21–40 / 41–65', () => {
  assert.equal(thicknessClassFor(10), 20);
  assert.equal(thicknessClassFor(20), 20);
  assert.equal(thicknessClassFor(21), 40);
  assert.equal(thicknessClassFor(40), 40);
  assert.equal(thicknessClassFor(41), 60);
  assert.equal(thicknessClassFor(65), 60);
  assert.equal(thicknessClassFor(66), null);
  assert.equal(thicknessClassFor(0), null);
});

test('length tier boundaries: <=1500, <=2000, above', () => {
  assert.equal(lengthTierFor(1500).key, 'priceTo1500');
  assert.equal(lengthTierFor(1501).key, 'price1501to2000');
  assert.equal(lengthTierFor(2000).key, 'price1501to2000');
  assert.equal(lengthTierFor(2001).key, 'priceOver2000');
});

test('oak Natura 40 mm, depth 320 (range 300–360), length 900 -> 380 zł/mb', () => {
  const r = ask({});
  assert.equal(r.ok, true);
  assert.equal(r.pricePerMb, 380);
  assert.equal(r.chunks.length, 1);
});

test('the depth range is lower-inclusive, upper-exclusive (300 -> 300–360, 299.9 -> 240–300)', () => {
  assert.equal(ask({ depthMm: 300 }).pricePerMb, 380);
  assert.equal(ask({ depthMm: 299.9 }).pricePerMb, 320);
});

test('the price column follows the board LENGTH', () => {
  assert.equal(ask({ lengthMm: 1800 }).pricePerMb, 520);
  assert.equal(ask({ lengthMm: 2500 }).pricePerMb, 720);
});

test('species/class multiplier is applied as a percentage of the oak Natura base', () => {
  assert.equal(ask({ cls: 'Klasa Loft' }).pricePerMb, 323); // 380 * 85%
  assert.equal(ask({ species: 'Jesion', cls: 'Klasa Loft' }).pricePerMb, 296.4); // 380 * 78%
});

test('an unknown species/class falls back to the base price (like DREWEX)', () => {
  assert.equal(ask({ species: 'Buk', cls: 'X' }).pricePerMb, 380);
});

test('a riser-like depth below the smallest range uses the NEAREST range (20 mm: 195 -> 240–300)', () => {
  const r = ask({ thicknessMm: 20, depthMm: 195, lengthMm: 900 });
  assert.equal(r.pricePerMb, 220);
  assert.equal(r.viaNearestRange, true);
});

test('depth above the largest range = glued from several boards, summing FULL per-mb prices', () => {
  const r = ask({ depthMm: 500, lengthMm: 1000 });
  // 420 -> top range (440) ; remainder 80 mm is below every range -> priced like the top range (440)
  assert.equal(r.chunks.length, 2);
  assert.equal(r.pricePerMb, 880);
  const wide = ask({ depthMm: 1000, lengthMm: 1000 }); // 420 + 420 + 160
  assert.equal(wide.chunks.length, 3);
  assert.equal(wide.pricePerMb, 1320);
});

test('thickness above 65 mm cannot be priced from the table — reported, never guessed', () => {
  const r = ask({ thicknessMm: 80 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /65 mm/);
});

test('an empty table for a thickness class is reported', () => {
  const t = table();
  t.boards = t.boards.filter((b) => b.thickness !== 40);
  assert.equal(lookupBoardPricePerMb(t, { species: 'Dąb', cls: 'Klasa Natura', thicknessMm: 40, depthMm: 320, lengthMm: 900 }).ok, false);
});

// ---- CSV: format eksportu kalkulatora DREWEX ----

test('CSV export -> import round-trips the boards table', () => {
  const boards = table().boards;
  const parsed = parseBoardsCSV(boardsToCSV(boards));
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parsed.boards, boards);
});

test('CSV import reads the DREWEX export layout: BOM, header, ; delimiter, decimal comma', () => {
  const csv = '﻿grubość_mm;głębokość_od_mm;głębokość_do_mm;cena_do_1500mb;cena_1501_2000mb;cena_pow_2000mb\n40;240;300;320,50;440.00;600\n';
  const { boards } = parseBoardsCSV(csv);
  assert.deepEqual(boards, [{ thickness: 40, depthMin: 240, depthMax: 300, priceTo1500: 320.5, price1501to2000: 440, priceOver2000: 600 }]);
});

test('CSV import also accepts a comma delimiter, maps unknown thickness to 40 and skips short rows', () => {
  const { boards, skipped } = parseBoardsCSV('25,240,300,100,200,300\n40,1,2\n');
  assert.equal(boards[0].thickness, 40);
  assert.equal(skipped, 1);
});

test('sanitizeBoardPricing survives garbage and keeps valid parts', () => {
  const fresh = createDefaultBoardPricing();
  assert.deepEqual(sanitizeBoardPricing(null), fresh);
  assert.deepEqual(sanitizeBoardPricing({ table: { boards: [{ nope: 1 }] }, riserMaterial: 'gold' }), fresh);
  assert.equal(sanitizeBoardPricing({ species: 'Jesion' }).species, 'Jesion');
});

// ---- integracja z takeoffem ----

function models(configPatch = {}) {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, openingLength: 6000, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  return {
    fullConfig,
    derived,
    planLayout,
    treadModels: buildTreadModels(planLayout, fullConfig),
    riserModels: buildRiserModels(planLayout, fullConfig),
    stringerModels,
    stringerConstruction: {
      outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
      inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
    },
    postModels: buildPostModels(planLayout, fullConfig),
  };
}

test('treads are priced from the table: cost = table price/mb x board length', () => {
  const t = buildPricedMaterialTakeoff(models(), { boardPricing: createDefaultBoardPricing() });
  const tread = t.items.find((i) => i.sourceElementId === 'tread:step-0');
  const { lengthMm, widthMm } = tread.calculatedDimensions;
  const length = Math.max(lengthMm, widthMm);
  const depth = Math.min(lengthMm, widthMm);
  const expected = lookupBoardPricePerMb(table(), { species: 'Dąb', cls: 'Klasa Natura', thicknessMm: 40, depthMm: depth, lengthMm: length }).pricePerMb;
  assert.equal(tread.pricingSource, 'board-table');
  assert.equal(tread.priceUnit, 'mb');
  assert.equal(tread.unitPrice, expected);
  assert.equal(tread.calculatedCost, Math.round(expected * (length / 1000) * 100) / 100);
  assert.equal(tread.materialId, boardMaterialId('Dąb', 'Klasa Natura'));
  assert.equal(tread.wasteFactor, 0, 'waste is inside the table price — never added a second time');
  assert.ok(tread.notes.some((n) => n.startsWith('Cennik desek:')), 'the lookup is explained on the item');
});

test('a 900 wide, 305 deep oak tread costs 342.00 (380 zł/mb x 0.9 m)', () => {
  const t = buildPricedMaterialTakeoff(models(), { boardPricing: createDefaultBoardPricing() });
  const tread = t.items.find((i) => i.sourceElementId === 'tread:step-0');
  assert.deepEqual([Math.max(tread.calculatedDimensions.lengthMm, tread.calculatedDimensions.widthMm), Math.min(tread.calculatedDimensions.lengthMm, tread.calculatedDimensions.widthMm)], [900, 305]);
  assert.equal(tread.calculatedCost, 342);
});

// ---- wangi, stopnie zabiegowe, słupy, zakres kosztorysu ----

const synthetic = (over) => ({
  itemId: 'x',
  elementType: 'STRINGER',
  sourceElementId: 'stringer:outer:outer-seg-0',
  material: 'C24',
  materialId: 'timber-c24',
  quantity: 1,
  unit: 'szt',
  status: 'OK',
  notes: [],
  optional: false,
  wasteFactor: 0.15,
  wasteAdjustedUnit: 'm3',
  stockVolume: 0.01,
  stockArea: null,
  calculatedDimensions: { lengthMm: 2660, boardWidthMm: 330, thicknessMm: 40 },
  ...over,
});

test('a stringer 40 x 330 x 2660 mm is a normal board from the price list + 20%: 720 zł/mb x 2.66 m x 1.2 = 2298.24', () => {
  const [item] = applyBoardPricing([synthetic({})], createDefaultBoardPricing());
  assert.equal(item.pricingSource, 'board-table');
  assert.equal(item.priceBreakdown.thicknessClass, 40);
  assert.equal(item.priceBreakdown.chunks[0].rangeLabel, '300–360 mm');
  assert.equal(item.priceBreakdown.pricePerMb, 720);
  assert.equal(item.priceBreakdown.surchargePct, 20);
  assert.equal(item.calculatedCost, 2298.24);
  assert.equal(item.wasteFactor, 0, 'no separate waste on top of the price list');
});

test('the stringer surcharge is a setting (0% = plain board price)', () => {
  const bp = { ...createDefaultBoardPricing(), stringerSurchargePct: 0 };
  const [item] = applyBoardPricing([synthetic({})], bp);
  assert.equal(item.calculatedCost, 1915.2);
});

test('the surcharge applies to stringers ONLY, not to treads', () => {
  const t = buildPricedMaterialTakeoff(models(), { boardPricing: createDefaultBoardPricing() });
  const tread = t.items.find((i) => i.sourceElementId === 'tread:step-0');
  assert.equal(tread.priceBreakdown.surchargePct ?? 0, 0);
  assert.equal(tread.calculatedCost, 342);
});

test('real stringers are priced by their parameter width and true length', () => {
  const t = buildPricedMaterialTakeoff(models({ minimumStringerDepthMm: 330 }), { boardPricing: createDefaultBoardPricing() });
  const stringer = t.items.find((i) => i.elementType === 'STRINGER');
  assert.equal(stringer.calculatedDimensions.boardWidthMm, 330);
  assert.equal(stringer.priceBreakdown.chunks[0].rangeLabel, '300–360 mm');
  const expected = Math.round(720 * (stringer.calculatedDimensions.lengthMm / 1000) * 1.2 * 100) / 100;
  assert.equal(stringer.calculatedCost, expected);
});

test('a winder tread is priced from its PRODUCTION BLANK — the same one the 2D plan shows', () => {
  const m = models({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, treadGoing: 280, totalRise: 2800, openingLength: 6000, openingWidth: 3000 });
  // Realistic winder layouts are usually blocked by the validation gate; the quantities/pricing
  // layers are exercised directly here (the gate is not what is under test).
  const t = { items: applyBoardPricing(computeMaterialTakeoff(m, m.fullConfig), createDefaultBoardPricing()) };
  const winders = m.treadModels.filter((x) => x.type === 'winder');
  assert.ok(winders.length > 0);
  for (const w of winders) {
    const planTread = m.planLayout.treads[w.index];
    const shownOnPlan = computeWinderBlank(planTread, m.fullConfig.nosing); // exactly what plan2dRenderer draws
    assert.equal(w.winderBlank.length, shownOnPlan.length);
    assert.equal(w.winderBlank.depth, shownOnPlan.depth);
    const item = t.items.find((i) => i.sourceElementId === 'tread:' + w.stepId);
    assert.equal(item.calculatedDimensions.lengthMm, shownOnPlan.length, 'takeoff STOCK = the plan\'s blank');
    assert.equal(item.calculatedDimensions.widthMm, shownOnPlan.depth);
    assert.equal(item.priceBreakdown.lengthMm, Math.max(shownOnPlan.length, shownOnPlan.depth));
    assert.ok(item.calculatedCost > 0);
  }
});

test('posts: the smallest listed section >= the post section is used; a bigger post stays unpriced with an explanation', () => {
  const ok = buildPricedMaterialTakeoff(models({ postSize: 90 }), { boardPricing: createDefaultBoardPricing() });
  const post = ok.items.find((i) => i.elementType === 'POST');
  assert.equal(post.pricingSource, 'post-table');
  assert.equal(post.calculatedCost, 160, '90 mm post -> the 100x100 row (per piece)');

  const std = buildPricedMaterialTakeoff(models({ postSize: 110 }), { boardPricing: createDefaultBoardPricing() });
  const p110 = std.items.find((i) => i.elementType === 'POST');
  assert.equal(p110.priceUnit, 'mb');
  assert.equal(p110.calculatedCost, Math.round(200 * (p110.calculatedDimensions.heightMm / 1000) * 100) / 100, '110x110 = 200 zł/mb');

  const big = buildPricedMaterialTakeoff(models({ postSize: 120 }), { boardPricing: createDefaultBoardPricing() });
  const bigPost = big.items.find((i) => i.elementType === 'POST');
  assert.equal(bigPost.calculatedCost, null);
  assert.ok(bigPost.notes.some((n) => n.startsWith('Brak ceny słupa')));

  const bp = createDefaultBoardPricing();
  bp.postPrices.push({ sectionMm: 120, price: 30, unit: 'szt' });
  const priced = buildPricedMaterialTakeoff(models({ postSize: 120 }), { boardPricing: bp });
  assert.equal(priced.items.find((i) => i.elementType === 'POST').calculatedCost, 30);
});

test('the cost covers material only: housings are excluded, not priced', () => {
  const m = models({ stringerConstructionType: 'closed' });
  const t = buildPricedMaterialTakeoff(m, { boardPricing: createDefaultBoardPricing() });
  const extras = t.items.filter((i) => i.elementType === 'STRINGER_HOUSING');
  assert.ok(extras.length > 0, 'the scenario must actually produce housings');
  for (const i of extras) {
    assert.equal(i.pricingSource, 'excluded');
    assert.equal(i.calculatedCost, null);
  }
  const counted = t.items.filter((i) => i.calculatedCost !== null).map((i) => i.elementType);
  assert.ok(counted.every((type) => ['TREAD', 'LANDING', 'RISER', 'STRINGER', 'POST'].includes(type)));
  assert.equal(t.totalCost, Math.round(t.items.reduce((sum, i) => sum + (i.calculatedCost || 0), 0) * 100) / 100);
});

test('oak risers are priced from the 20 mm table; MDF risers keep the sheet price', () => {
  const m = models({ hasRiserBoards: true });
  const oak = buildPricedMaterialTakeoff(m, { boardPricing: { ...createDefaultBoardPricing(), riserMaterial: RISER_MATERIALS.OAK } });
  const mdf = buildPricedMaterialTakeoff(m, { boardPricing: { ...createDefaultBoardPricing(), riserMaterial: RISER_MATERIALS.MDF } });
  const oakRiser = oak.items.find((i) => i.elementType === 'RISER');
  const mdfRiser = mdf.items.find((i) => i.elementType === 'RISER');
  assert.equal(oakRiser.pricingSource, 'board-table');
  assert.equal(oakRiser.priceBreakdown.thicknessClass, 20);
  assert.equal(mdfRiser.pricingSource, undefined);
  assert.equal(mdfRiser.materialId, 'sheet-plywood-mdf');
  assert.ok(mdfRiser.calculatedCost > 0);
});

test('a tread thicker than 65 mm stays UNPRICED with an explanation (and is not re-priced generically)', () => {
  const t = buildPricedMaterialTakeoff(models({ treadThickness: 70 }), { boardPricing: createDefaultBoardPricing() });
  const tread = t.items.find((i) => i.sourceElementId === 'tread:step-0');
  assert.equal(tread.calculatedCost, null);
  assert.ok(tread.notes.some((n) => n.startsWith('Brak ceny z cennika desek')));
});

test('changing a price in the table changes only cost, never the quantities', () => {
  const a = buildPricedMaterialTakeoff(models(), { boardPricing: createDefaultBoardPricing() });
  const bp = createDefaultBoardPricing();
  bp.table.boards.forEach((r) => {
    r.priceTo1500 *= 2;
  });
  const b = buildPricedMaterialTakeoff(models(), { boardPricing: bp });
  const strip = (items) => items.map(({ calculatedCost, unitPrice, notes, priceBreakdown, ...rest }) => rest);
  assert.deepEqual(strip(b.items), strip(a.items));
  assert.ok(b.totalCost > a.totalCost);
});

test('without boardPricing the behaviour is exactly the previous generic pricing', () => {
  const t = buildPricedMaterialTakeoff(models());
  assert.ok(t.items.every((i) => !i.pricingSource));
});

// ---- nosek w formatce zabiegowej ----

test('the winder blank includes the nosing: depth grows by exactly the nosing, length and corners stay consistent', () => {
  const m = models({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, treadGoing: 280, totalRise: 2800, openingLength: 6000, openingWidth: 3000 });
  const winder = m.planLayout.treads.find((t) => t.type === 'winder');
  const bare = computeWinderBlank(winder, 0);
  const nosed = computeWinderBlank(winder, 25);
  assert.ok(Math.abs(nosed.depth - (bare.depth + 25)) < 1e-9);
  assert.ok(Math.abs(nosed.length - bare.length) < 1e-9);
  const side = (c) => Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
  assert.ok(Math.abs(side(nosed.corners) - nosed.length) < 1e-6);
  const other = Math.hypot(nosed.corners[3].x - nosed.corners[0].x, nosed.corners[3].y - nosed.corners[0].y);
  assert.ok(Math.abs(other - nosed.depth) < 1e-6);
});

test('the nosing is extended toward the FRONT: the blank still contains the whole tread outline', () => {
  const m = models({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, treadGoing: 280, totalRise: 2800, openingLength: 6000, openingWidth: 3000 });
  const winder = m.planLayout.treads.find((t) => t.type === 'winder');
  const { corners } = computeWinderBlank(winder, 25);
  const [c0, c1, , c3] = corners;
  const ux = (c1.x - c0.x) / Math.hypot(c1.x - c0.x, c1.y - c0.y);
  const uy = (c1.y - c0.y) / Math.hypot(c1.x - c0.x, c1.y - c0.y);
  const vx = (c3.x - c0.x) / Math.hypot(c3.x - c0.x, c3.y - c0.y);
  const vy = (c3.y - c0.y) / Math.hypot(c3.x - c0.x, c3.y - c0.y);
  const depth = Math.hypot(c3.x - c0.x, c3.y - c0.y);
  const length = Math.hypot(c1.x - c0.x, c1.y - c0.y);
  for (const p of winder.outline) {
    const u = (p.x - c0.x) * ux + (p.y - c0.y) * uy;
    const v = (p.x - c0.x) * vx + (p.y - c0.y) * vy;
    assert.ok(u >= -1e-6 && u <= length + 1e-6 && v >= -1e-6 && v <= depth + 1e-6);
  }
});
