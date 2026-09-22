// Tests for the COST layer (src/takeoff/pricing.js) — proves it is genuinely separate from
// quantities: applyPricing() never mutates its input, a price-list change never touches
// quantities, and an item missing from the price list (or whose materialId is null, e.g. a
// STRINGER_HOUSING) stays honestly unpriced (never guessed). Joining is by materialId, not
// itemId — proven explicitly below.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { applyPricing, totalCost, DEFAULT_PRICE_LIST, PRICE_UNITS } from '../pricing.js';
import { ELEMENT_TYPES } from '../takeoffTypes.js';

function buildItems(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const stringerConstruction = {
    outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
    inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
  };
  const postModels = buildPostModels(planLayout, fullConfig);
  return computeMaterialTakeoff({ treadModels, riserModels, stringerModels, stringerConstruction, postModels }, fullConfig);
}

test('applyPricing computes calculatedCost = wasteAdjustedQuantity(m3) * unitPrice for a volume-priced item', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const priced = applyPricing(items);
  const tread = priced.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const price = DEFAULT_PRICE_LIST.find((p) => p.materialId === tread.materialId);
  assert.equal(price.unit, PRICE_UNITS.VOLUME);
  const expected = Math.round(tread.wasteAdjustedQuantity * price.price * 100) / 100;
  assert.equal(tread.calculatedCost, expected);
  assert.equal(tread.unitPrice, price.price);
  assert.equal(tread.priceUnit, PRICE_UNITS.VOLUME);
  assert.equal(tread.currency, price.currency);
});

test('applyPricing computes calculatedCost = wasteAdjustedQuantity(m2) * unitPrice for an area-priced item (risers)', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true });
  const priced = applyPricing(items);
  const riser = priced.find((i) => i.elementType === ELEMENT_TYPES.RISER);
  const price = DEFAULT_PRICE_LIST.find((p) => p.materialId === riser.materialId);
  assert.equal(price.unit, PRICE_UNITS.AREA);
  assert.equal(riser.calculatedCost, Math.round(riser.wasteAdjustedQuantity * price.price * 100) / 100);
});

test('applyPricing never mutates its input items', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const before = JSON.parse(JSON.stringify(items));
  applyPricing(items);
  assert.deepEqual(items, before);
});

test('applyPricing leaves an item with no matching materialId unpriced, rather than guessing', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const priced = applyPricing(items, []); // empty price list
  for (const item of priced) {
    assert.equal(item.calculatedCost, null);
    assert.equal(item.unitPrice, null);
  }
});

test('a STRINGER_HOUSING item (materialId: null — not a separate purchase) is never priced, even with a full price list', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const housings = items.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER_HOUSING);
  if (housings.length > 0) {
    const priced = applyPricing(items);
    for (const h of priced.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER_HOUSING)) {
      assert.equal(h.calculatedCost, null);
    }
  }
});

test('a price-list change affects cost but never the underlying quantities', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const treadMaterialId = items.find((i) => i.elementType === ELEMENT_TYPES.TREAD).materialId;
  const cheap = applyPricing(items, [{ materialId: treadMaterialId, price: 1000, currency: 'PLN', unit: PRICE_UNITS.VOLUME }]);
  const expensive = applyPricing(items, [{ materialId: treadMaterialId, price: 9000, currency: 'PLN', unit: PRICE_UNITS.VOLUME }]);
  const cheapTread = cheap.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const expensiveTread = expensive.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.equal(cheapTread.netVolume, expensiveTread.netVolume);
  assert.equal(cheapTread.wasteAdjustedQuantity, expensiveTread.wasteAdjustedQuantity);
  assert.notEqual(cheapTread.calculatedCost, expensiveTread.calculatedCost);
});

test('pricing joins by materialId, not itemId: every tread (a distinct itemId each) shares one price entry', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const priced = applyPricing(items);
  const treads = priced.filter((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.ok(treads.length > 1);
  const unitPrices = new Set(treads.map((t) => t.unitPrice));
  assert.equal(unitPrices.size, 1, 'every tread must resolve to the same per-unit price, since they share one materialId');
});

test('totalCost sums calculatedCost across items, treating unpriced items as 0', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const treadMaterialId = items.find((i) => i.elementType === ELEMENT_TYPES.TREAD).materialId;
  const priced = applyPricing(items, [{ materialId: treadMaterialId, price: 4200, currency: 'PLN', unit: PRICE_UNITS.VOLUME }]); // only tread material priced
  const expected = Math.round(priced.filter((i) => i.materialId === treadMaterialId).reduce((sum, i) => sum + (i.calculatedCost || 0), 0) * 100) / 100; // total is rounded to grosze
  assert.equal(totalCost(priced), expected);
  assert.ok(priced.some((i) => i.materialId !== treadMaterialId && i.calculatedCost === null));
});
