// Tests for the export adapters — all consume the same MaterialTakeoffItem[] shape regardless
// of which stage (quantities-only or priced) produced it.

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
import { applyPricing } from '../pricing.js';
import { takeoffToCSV } from '../export/toCSV.js';
import { takeoffToJSON } from '../export/toJSON.js';
import { takeoffToTextReport } from '../export/toTextReport.js';
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
  const firstTread = items.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const treadRowIndex = 1 + items.findIndex((i) => i.itemId === firstTread.itemId);
  const row = lines[treadRowIndex].split(',');
  const quantityCol = header.indexOf('Quantity');
  assert.equal(row[quantityCol], String(firstTread.quantity));
});

test('takeoffToCSV: escapes commas/quotes in field values', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 3 });
  const withComma = items.map((i) => (i.elementType === ELEMENT_TYPES.TREAD ? { ...i, material: 'Świerk, klasa C24' } : i));
  const csv = takeoffToCSV(withComma);
  assert.ok(csv.includes('"Świerk, klasa C24"'));
});

test('takeoffToCSV: exposes the catalog order size for a stringer, blank for elements with no catalogStock', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerThickness: 50 });
  const csv = takeoffToCSV(items);
  const lines = csv.split('\n');
  const header = lines[0].split(',');
  const orderLenCol = header.indexOf('Order length (mm)');
  const stringerRowIndex = 1 + items.findIndex((i) => i.elementType === ELEMENT_TYPES.STRINGER);
  const treadRowIndex = 1 + items.findIndex((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.ok(Number(lines[stringerRowIndex].split(',')[orderLenCol]) >= 4610, 'stringer order length must be a real catalog size >= the computed requirement');
  // A tread has no materialCatalog-backed catalogStock computation (only stringers/posts do) —
  // its "Order length" column must be blank, never a fabricated number.
  assert.equal(lines[treadRowIndex].split(',')[orderLenCol], '');
});

test('takeoffToTextReport: includes every item id and a grand total when priced', () => {
  const items = applyPricing(buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true }));
  const report = takeoffToTextReport(items);
  for (const item of items) {
    assert.ok(report.includes(item.itemId), `report must mention "${item.itemId}"`);
  }
  assert.match(report, /RAZEM.*PLN/);
});

test('takeoffToTextReport: marks optional items and omits the grand total when nothing is priced', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true }); // unpriced
  const report = takeoffToTextReport(items);
  assert.ok(report.includes('(opcjonalny)'));
  assert.equal(/RAZEM/.test(report), false);
});

test('takeoffToTextReport: an INVALID item is reported without an invented quantity, listing its diagnostics', () => {
  const items = buildItems({ stairType: 'straight', treadsLegA: 5 });
  const corrupted = items.map((i) =>
    i.elementType === ELEMENT_TYPES.STRINGER
      ? { ...i, status: 'INVALID', netVolume: null, stockVolume: null, wasteAdjustedQuantity: null, diagnostics: [{ severity: 'ERROR', message: 'test forced invalid' }] }
      : i
  );
  const report = takeoffToTextReport(corrupted);
  assert.match(report, /BRAK WYLICZONEJ ILOŚCI/);
  assert.match(report, /test forced invalid/);
});
