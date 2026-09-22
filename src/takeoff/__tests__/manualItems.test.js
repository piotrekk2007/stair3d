import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultManualItems, sanitizeManualItems, manualItemsToTakeoffItems, applyManualItems, manualRowCost } from '../manualItems.js';
import { summarizeByCategory } from '../../ui/takeoffView.js';
import { buildPricedMaterialTakeoff, createDefaultBoardPricing } from '../index.js';
import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';

function realTakeoff(patch = {}) {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, openingLength: 6000, hasRiserBoards: true, ...patch };
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
  return buildPricedMaterialTakeoff(models, { boardPricing: createDefaultBoardPricing() });
}

test('default manual rows (balusters, handrails) are empty and add nothing', () => {
  const rows = createDefaultManualItems();
  assert.deepEqual(rows.map((r) => [r.name, r.unit]), [['Tralki', 'szt'], ['Poręcze', 'mb']]);
  assert.deepEqual(manualItemsToTakeoffItems(rows), []);
});

test('manual balusters and handrails cost = quantity x unit price', () => {
  const rows = [
    { name: 'Tralki', qty: 24, unit: 'szt', price: 35 },
    { name: 'Poręcze', qty: 6.5, unit: 'mb', price: 120 },
  ];
  assert.equal(manualRowCost(rows[0]), 840);
  assert.equal(manualRowCost(rows[1]), 780);
  const items = manualItemsToTakeoffItems(rows);
  assert.deepEqual(items.map((i) => i.calculatedCost), [840, 780]);
  assert.deepEqual(items.map((i) => i.unit), ['szt', 'mb']);
});

test('manual items join the takeoff total and the category summary', () => {
  const base = realTakeoff();
  const rows = [{ name: 'Tralki', qty: 10, unit: 'szt', price: 50 }, { name: 'Poręcze', qty: 5, unit: 'mb', price: 100 }];
  const withManual = applyManualItems(base, rows);
  assert.equal(withManual.totalCost, Math.round((base.totalCost + 1000) * 100) / 100);
  const summary = summarizeByCategory(withManual.items);
  assert.equal(summary.total, withManual.totalCost, 'the category summary total equals the takeoff total');
  const labels = summary.lines.map((l) => l.label);
  assert.deepEqual(labels.slice(0, 4), ['Stopnie', 'Podstopnie', 'Wangi', 'Słupy']);
  assert.deepEqual(labels.slice(-2), ['Tralki', 'Poręcze']);
  assert.equal(summary.lines.find((l) => l.label === 'Tralki').cost, 500);
});

test('a BLOCKED takeoff stays untouched by manual items (no partial total from invalid geometry)', () => {
  const blocked = { status: 'BLOCKED', items: [], totalCost: 0 };
  assert.equal(applyManualItems(blocked, [{ name: 'Tralki', qty: 5, unit: 'szt', price: 10 }]), blocked);
});

test('category summary: housings are left out and winder treads are separate', () => {
  const t = realTakeoff({ stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  assert.ok(t.items.some((i) => i.elementType === 'STRINGER_HOUSING'));
  const s = summarizeByCategory(t.items);
  assert.ok(!s.lines.some((l) => /wpusty/i.test(l.label)));
  const separated = summarizeByCategory(t.items, { winderStepIds: new Set(['step-0']) });
  assert.equal(separated.lines.find((l) => l.label === 'Stopnie zabiegowe').count, 1);
  assert.equal(separated.lines.find((l) => l.label === 'Stopnie').count, s.lines.find((l) => l.label === 'Stopnie').count - 1);
  assert.equal(separated.total, s.total);
});

test('an unpriced item is counted, never silently added to a category cost', () => {
  const t = realTakeoff({ postSize: 130 }); // no table row for a 130 mm post
  const s = summarizeByCategory(t.items);
  const posts = s.lines.find((l) => l.label === 'Słupy');
  assert.equal(posts.cost, 0);
  assert.ok(posts.unpriced > 0);
  assert.ok(s.unpricedCount > 0);
});

test('sanitizeManualItems repairs bad input instead of throwing', () => {
  assert.deepEqual(sanitizeManualItems(undefined), createDefaultManualItems());
  assert.deepEqual(sanitizeManualItems([{ name: ' Szkło ', qty: -3, unit: 'kg', price: 'x' }, { nope: 1 }]), [{ name: 'Szkło', qty: 0, unit: 'szt', price: 0 }]);
});
