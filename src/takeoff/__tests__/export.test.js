// Tests for the export adapters — all consume the same TakeoffItem[] shape regardless of which
// stage (quantities-only or priced) produced it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { applyPricing } from '../pricing.js';
import { takeoffToCSV } from '../export/toCSV.js';
import { takeoffToJSON } from '../export/toJSON.js';
import { takeoffToTextReport } from '../export/toTextReport.js';

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

test('takeoffToJSON round-trips every item field', () => {
  const items = applyPricing(buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true }));
  const parsed = JSON.parse(takeoffToJSON(items));
  assert.deepEqual(parsed, items);
});

test('takeoffToJSON: pretty:false produces compact (single-line-per-value) output', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 3 });
  const compact = takeoffToJSON(items, { pretty: false });
  assert.equal(compact.includes('\n'), false);
});

test('takeoffToCSV: header + one row per item, values match the item fields', () => {
  const items = applyPricing(buildItems({ stairType: 'straight', treadsLegA: 4 }));
  const csv = takeoffToCSV(items);
  const lines = csv.split('\n');
  assert.equal(lines.length, items.length + 1); // header + rows
  const header = lines[0].split(',');
  const treadRowIndex = 1 + items.findIndex((i) => i.itemId === 'tread-straight');
  const row = lines[treadRowIndex].split(',');
  const quantityCol = header.indexOf('quantity');
  assert.equal(row[quantityCol], String(items.find((i) => i.itemId === 'tread-straight').quantity));
});

test('takeoffToCSV: escapes commas/quotes in field values', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 3 });
  const withComma = items.map((i) => (i.itemId === 'tread-straight' ? { ...i, material: 'Świerk, klasa C24' } : i));
  const csv = takeoffToCSV(withComma);
  assert.ok(csv.includes('"Świerk, klasa C24"'));
});

test('takeoffToTextReport: includes every item label and a grand total when priced', () => {
  const items = applyPricing(buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true }));
  const report = takeoffToTextReport(items);
  for (const item of items) {
    assert.ok(report.includes(item.label), `report must mention "${item.label}"`);
  }
  assert.match(report, /RAZEM.*PLN/);
});

test('takeoffToTextReport: marks optional items and omits the grand total when nothing is priced', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true }); // unpriced
  const report = takeoffToTextReport(items);
  assert.ok(report.includes('(opcjonalny)'));
  assert.equal(/RAZEM/.test(report), false);
});
