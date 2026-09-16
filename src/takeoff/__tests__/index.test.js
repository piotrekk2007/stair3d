// Tests for the public facade (src/takeoff/index.js) — proves the layers (validation gate,
// quantities, waste, pricing) really do compose independently through it, and that the
// validation gate genuinely blocks a takeoff computed from invalid geometry rather than
// silently producing a misleading quantity.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { buildMaterialTakeoff, buildPricedMaterialTakeoff, DEFAULT_PRICE_LIST, GATE_STATUS } from '../index.js';
import { ELEMENT_TYPES } from '../takeoffTypes.js';

function buildModels(configPatch) {
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
  return { fullConfig, derived, planLayout, treadModels, riserModels, stringerModels, stringerConstruction, postModels };
}

// A legally-compliant, ceiling-fitting straight flight (same scenario
// StaircaseValidator.test.js uses for its "zero findings" case) — the one config in this file
// guaranteed to reach GATE_STATUS.OK, since most other patches trip a real profile/legal rule
// (that's the validator working correctly, not a takeoff bug). stringerThickness is bumped
// from the project default (40mm) to 50mm — at 40mm this exact flight legitimately trips
// STRINGER-MIN-SECTION (a real, correct WARNING: not enough housing material remains), which
// is exactly the kind of finding scenario L below tests deliberately.
const CLEAN_CONFIG = { stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, stairWidth: 900, hasRiserBoards: true, openingLength: 6000, openingWidth: 900, minHeadroom: 1900, stringerThickness: 50 };

test('buildMaterialTakeoff returns unpriced OK items for a normal, valid staircase', () => {
  const models = buildModels(CLEAN_CONFIG);
  const result = buildMaterialTakeoff(models);
  assert.equal(result.status, GATE_STATUS.OK);
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((i) => i.calculatedCost === null));
});

test('buildPricedMaterialTakeoff returns priced items and a matching totalCost', () => {
  const models = buildModels(CLEAN_CONFIG);
  const { items, totalCost } = buildPricedMaterialTakeoff(models);
  const sum = items.reduce((s, i) => s + (i.calculatedCost || 0), 0);
  assert.equal(Math.round(sum * 100) / 100, Math.round(totalCost * 100) / 100);
  assert.ok(totalCost > 0);
});

test('buildPricedMaterialTakeoff accepts a custom price list, layered independently of quantities', () => {
  const models = buildModels(CLEAN_CONFIG);
  const defaultResult = buildPricedMaterialTakeoff(models);
  const treadMaterialId = defaultResult.items.find((i) => i.elementType === ELEMENT_TYPES.TREAD).materialId;
  const customList = DEFAULT_PRICE_LIST.map((p) => (p.materialId === treadMaterialId ? { ...p, price: 1 } : p));
  const customResult = buildPricedMaterialTakeoff(models, { priceList: customList });
  const defaultTread = defaultResult.items.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const customTread = customResult.items.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.equal(defaultTread.netVolume, customTread.netVolume);
  assert.notEqual(defaultTread.calculatedCost, customTread.calculatedCost);
});

// --- Validation gate (scenario K / L) -----------------------------------------------------------

test('scenario K (validation gate): an ERROR-level stringer construction diagnostic BLOCKS the whole takeoff — never a partial, misleading result', () => {
  const models = buildModels(CLEAN_CONFIG);
  const corrupted = {
    ...models,
    stringerConstruction: {
      ...models.stringerConstruction,
      outer: [{ ...models.stringerConstruction.outer[0], diagnostics: [{ ruleId: 'TEST-FORCED-ERROR', severity: 'ERROR', elementType: 'stringer', elementId: 'x', message: 'forced' }] }],
    },
  };
  const result = buildMaterialTakeoff(corrupted);
  assert.equal(result.status, GATE_STATUS.BLOCKED);
  assert.deepEqual(result.items, []);
  assert.ok(result.diagnostics.some((d) => d.ruleId === 'TEST-FORCED-ERROR'));
});

test('scenario L (validation gate): a WARNING-only finding lets the takeoff compute normally, but the result carries GATE_STATUS.WARNING', () => {
  const models = buildModels(CLEAN_CONFIG);
  const withWarning = {
    ...models,
    stringerConstruction: {
      ...models.stringerConstruction,
      outer: [{ ...models.stringerConstruction.outer[0], diagnostics: [{ ruleId: 'TEST-FORCED-WARNING', severity: 'WARNING', elementType: 'stringer', elementId: 'x', message: 'forced warning' }] }],
    },
  };
  const result = buildMaterialTakeoff(withWarning);
  assert.equal(result.status, GATE_STATUS.WARNING);
  assert.ok(result.items.length > 0, 'a WARNING-only finding must not block computation');
  assert.ok(result.diagnostics.some((d) => d.ruleId === 'TEST-FORCED-WARNING'));
});

test('buildPricedMaterialTakeoff on a BLOCKED takeoff returns zero totalCost and no items, never a partial priced result', () => {
  const models = buildModels(CLEAN_CONFIG);
  const corrupted = {
    ...models,
    stringerConstruction: {
      ...models.stringerConstruction,
      outer: [{ ...models.stringerConstruction.outer[0], diagnostics: [{ ruleId: 'TEST-FORCED-ERROR', severity: 'ERROR', elementType: 'stringer', elementId: 'x', message: 'forced' }] }],
    },
  };
  const result = buildPricedMaterialTakeoff(corrupted);
  assert.equal(result.status, GATE_STATUS.BLOCKED);
  assert.deepEqual(result.items, []);
  assert.equal(result.totalCost, 0);
});
