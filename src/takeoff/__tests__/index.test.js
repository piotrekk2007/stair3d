// Tests for the public facade (src/takeoff/index.js) — proves the three layers (quantities,
// waste, pricing) really do compose independently through it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { buildTakeoff, buildPricedTakeoff, DEFAULT_PRICE_CATALOG } from '../index.js';

function buildModels(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const postModels = buildPostModels(planLayout, fullConfig);
  return { config: fullConfig, models: { treadModels, riserModels, stringerModels, postModels } };
}

test('buildTakeoff returns unpriced items (quantities layer only)', () => {
  const { config, models } = buildModels({ stairType: 'straight', treadsLegA: 6 });
  const items = buildTakeoff(models, config);
  assert.ok(items.every((i) => i.calculatedCost === null));
});

test('buildPricedTakeoff returns priced items and a matching totalCost', () => {
  const { config, models } = buildModels({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true });
  const { items, totalCost } = buildPricedTakeoff(models, config);
  const sum = items.reduce((s, i) => s + (i.calculatedCost || 0), 0);
  assert.equal(Math.round(sum * 100) / 100, Math.round(totalCost * 100) / 100);
  assert.ok(totalCost > 0);
});

test('buildPricedTakeoff accepts a custom price catalog, layered independently of quantities', () => {
  const { config, models } = buildModels({ stairType: 'straight', treadsLegA: 6 });
  const defaultResult = buildPricedTakeoff(models, config);
  const customCatalog = { ...DEFAULT_PRICE_CATALOG, 'tread-straight': { ...DEFAULT_PRICE_CATALOG['tread-straight'], unitPrice: 1 } };
  const customResult = buildPricedTakeoff(models, config, { priceCatalog: customCatalog });
  const defaultTread = defaultResult.items.find((i) => i.itemId === 'tread-straight');
  const customTread = customResult.items.find((i) => i.itemId === 'tread-straight');
  assert.equal(defaultTread.netVolume, customTread.netVolume);
  assert.notEqual(defaultTread.calculatedCost, customTread.calculatedCost);
});
