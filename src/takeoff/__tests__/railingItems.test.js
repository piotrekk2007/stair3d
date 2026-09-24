import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { buildMaterialTakeoff, buildPricedMaterialTakeoff, DEFAULT_PRICE_LIST } from '../index.js';
import { summarizeByCategory } from '../../ui/takeoffView.js';

function models(patch = {}) {
  const config = {
    ...createDefaultConfig(),
    stairType: 'straight',
    treadsLegA: 14,
    totalRise: 2600,
    treadGoing: 280,
    openingLength: 4500, // a ceiling opening the whole flight fits through, so the takeoff is not blocked
    railingEnabled: true,
    stringerConstructionTypeOuter: 'cut',
    stringerConstructionTypeInner: 'cut',
    railingSections: [{ id: 's', side: 'outer', fromStep: 0, toStep: null }],
    ...patch,
  };
  return buildStaircase(config);
}

// The takeoff is gated on validation ERRORs of the stair itself; this stair is deliberately plain so it is not blocked.
const takeoffOf = (m, options) => buildMaterialTakeoff(m, options);

test('no balustrade items when the balustrade is off', () => {
  const items = takeoffOf(models({ railingEnabled: false })).items;
  assert.equal(items.filter((i) => i.elementType === 'HANDRAIL' || i.elementType === 'BALUSTER').length, 0);
});

test('handrail: one item per straight piece with its true 3D length; balusters: a cut list grouped by length with quantities', () => {
  const m = models();
  const takeoff = takeoffOf(m);
  assert.notEqual(takeoff.status, 'BLOCKED');
  const section = m.railingModel.sections[0];
  const handrails = takeoff.items.filter((i) => i.elementType === 'HANDRAIL');
  assert.equal(handrails.length, section.handrail.pieces.length);
  assert.ok(Math.abs(handrails.reduce((sum, i) => sum + i.nominalDimensions.lengthMm, 0) - section.handrail.totalLengthMm) < 1e-6);
  assert.deepEqual(handrails[0].nominalDimensions.widthMm, m.fullConfig.railingHandrailWidthMm);

  const balusters = takeoff.items.filter((i) => i.elementType === 'BALUSTER');
  assert.equal(balusters.reduce((sum, i) => sum + i.quantity, 0), section.balusters.length, 'every baluster is in the cut list');
  const lengths = balusters.map((i) => i.nominalDimensions.lengthMm);
  assert.deepEqual(lengths, [...lengths].sort((a, b) => a - b), 'sorted by length');
  assert.equal(new Set(lengths).size, lengths.length, 'one line per distinct length');
  for (const item of balusters) assert.ok(item.sourceElementId.startsWith('railing:s:baluster:'));
});

test('the balustrade end posts are counted as ordinary posts', () => {
  const m = models();
  const items = takeoffOf(m).items.filter((i) => i.elementType === 'POST' && i.sourceElementId.startsWith('post:railing-post-'));
  assert.equal(items.length, m.railingModel.posts.length);
  assert.ok(items.every((i) => i.notes.includes('Słupek balustrady') && i.optional));
});

test('pricing: no invented prices — unpriced until the user types a price; then per piece and per running metre', () => {
  const m = models();
  const unpriced = buildPricedMaterialTakeoff(m);
  const base = unpriced.items.filter((i) => i.elementType === 'HANDRAIL' || i.elementType === 'BALUSTER');
  assert.ok(base.length > 0);
  assert.ok(base.every((i) => i.calculatedCost === null), 'default price 0 = not priced');

  const priceList = DEFAULT_PRICE_LIST.map((p) => (p.materialId === 'railing-baluster' ? { ...p, price: 10 } : p.materialId === 'railing-handrail' ? { ...p, price: 100 } : { ...p }));
  const priced = buildPricedMaterialTakeoff(m, { priceList });
  const balusters = priced.items.filter((i) => i.elementType === 'BALUSTER');
  const handrails = priced.items.filter((i) => i.elementType === 'HANDRAIL');
  const balusterCost = balusters.reduce((sum, i) => sum + i.calculatedCost, 0);
  const handrailCost = handrails.reduce((sum, i) => sum + i.calculatedCost, 0);
  assert.ok(Math.abs(balusterCost - 10 * m.railingModel.sections[0].balusters.length) < 0.05);
  assert.ok(Math.abs(handrailCost - (100 * m.railingModel.sections[0].handrail.totalLengthMm) / 1000) < 0.05 * handrails.length);
});

test('the cost summary lists the balustrade under its own categories (distinct from manual rows)', () => {
  const m = models();
  const priceList = DEFAULT_PRICE_LIST.map((p) => (p.materialId.startsWith('railing') ? { ...p, price: 5 } : { ...p }));
  const priced = buildPricedMaterialTakeoff(m, { priceList });
  const labels = summarizeByCategory(priced.items).lines.map((l) => l.label);
  assert.ok(labels.includes('Poręcze (z modelu)'));
  assert.ok(labels.includes('Tralki (z modelu)'));
});

test('an invalid balustrade section contributes no items', () => {
  const m = models({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 8, toStep: 2 }] });
  const items = takeoffOf(m).items.filter((i) => i.elementType === 'HANDRAIL' || i.elementType === 'BALUSTER');
  assert.equal(items.length, 0);
});
