// Tests for the COST layer (src/takeoff/pricing.js) — proves it is genuinely separate from
// quantities: applyPricing() never mutates its input, a price-catalog change never touches
// quantities, and an item missing from the catalog stays honestly unpriced (never guessed).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { applyPricing, totalCost, DEFAULT_PRICE_CATALOG, PRICE_UNITS } from '../pricing.js';

function buildItems(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const postModels = buildPostModels(planLayout, fullConfig);
  return computeMaterialTakeoff({ treadModels, riserModels, stringerModels, postModels }, fullConfig);
}

test('applyPricing computes calculatedCost = grossVolume * unitPrice for a volume-priced item', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const priced = applyPricing(items);
  const treads = priced.find((i) => i.itemId === 'tread-straight');
  const price = DEFAULT_PRICE_CATALOG['tread-straight'];
  assert.equal(price.unit, PRICE_UNITS.VOLUME);
  const expected = Math.round(treads.grossVolume * price.unitPrice * 100) / 100;
  assert.equal(treads.calculatedCost, expected);
  assert.equal(treads.unitPrice, price.unitPrice);
  assert.equal(treads.priceUnit, PRICE_UNITS.VOLUME);
});

test('applyPricing computes calculatedCost = grossArea * unitPrice for an area-priced item (risers)', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true });
  const priced = applyPricing(items);
  const riser = priced.find((i) => i.itemId === 'riser-board');
  const price = DEFAULT_PRICE_CATALOG['riser-board'];
  assert.equal(price.unit, PRICE_UNITS.AREA);
  assert.equal(riser.calculatedCost, Math.round(riser.grossArea * price.unitPrice * 100) / 100);
});

test('applyPricing never mutates its input items', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const before = JSON.parse(JSON.stringify(items));
  applyPricing(items);
  assert.deepEqual(items, before);
});

test('applyPricing leaves an item with no catalog entry unpriced, rather than guessing', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const priced = applyPricing(items, {}); // empty catalog
  for (const item of priced) {
    assert.equal(item.calculatedCost, null);
    assert.equal(item.unitPrice, null);
  }
});

test('a price-catalog change affects cost but never the underlying quantities', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const cheap = applyPricing(items, { 'tread-straight': { unit: PRICE_UNITS.VOLUME, unitPrice: 1000, currency: 'PLN' } });
  const expensive = applyPricing(items, { 'tread-straight': { unit: PRICE_UNITS.VOLUME, unitPrice: 9000, currency: 'PLN' } });
  const cheapTread = cheap.find((i) => i.itemId === 'tread-straight');
  const expensiveTread = expensive.find((i) => i.itemId === 'tread-straight');
  assert.equal(cheapTread.netVolume, expensiveTread.netVolume);
  assert.equal(cheapTread.grossVolume, expensiveTread.grossVolume);
  assert.notEqual(cheapTread.calculatedCost, expensiveTread.calculatedCost);
});

test('totalCost sums calculatedCost across items, treating unpriced items as 0', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6 });
  const priced = applyPricing(items, { 'tread-straight': DEFAULT_PRICE_CATALOG['tread-straight'] }); // only one item priced
  const expected = priced.find((i) => i.itemId === 'tread-straight').calculatedCost;
  assert.equal(totalCost(priced), expected);
});
