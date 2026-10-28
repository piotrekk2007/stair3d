import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { applyPricing, DEFAULT_PRICE_LIST } from '../pricing.js';
import { applyBoardPricing, createDefaultBoardPricing, sanitizeBoardPricing } from '../boardPricing.js';

const withPrices = (prices) => DEFAULT_PRICE_LIST.map((p) => (p.materialId in prices ? { ...p, price: prices[p.materialId] } : p));
const priced = (items, prices, supplies) => {
  const bp = createDefaultBoardPricing();
  if (supplies) bp.ledSupplyPrices = supplies;
  return applyPricing(applyBoardPricing(items, bp), withPrices(prices));
};
const ledStair = () => buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, ledTreadEnabled: true });

test('accessory prices (user decisions 2026-10-28): the LED strip and profile per running metre — 0 leaves them unpriced', () => {
  const b = ledStair();
  const items = computeMaterialTakeoff(b, b.fullConfig);
  const metres = items.find((i) => i.itemId === 'led-tread-strip').quantity;
  const none = priced(items, {});
  assert.equal(none.find((i) => i.itemId === 'led-tread-strip').calculatedCost, null);
  const out = priced(items, { 'led-strip': 20, 'led-profile': 35 });
  assert.ok(Math.abs(out.find((i) => i.itemId === 'led-tread-strip').calculatedCost - metres * 20) < 0.01);
  assert.ok(Math.abs(out.find((i) => i.itemId === 'led-tread-profile').calculatedCost - metres * 35) < 0.01);
});

test('the LED power supply from the table by power: the smallest priced one that is enough, else several of the largest', () => {
  const b = ledStair();
  const items = computeMaterialTakeoff(b, b.fullConfig);
  const need = b.led.supplyW; // 13 strips × 0.8 m × 9.6 W/m × 1.2 ≈ 120 W
  assert.ok(need > 100 && need < 150);
  const supply = (rows) => priced(items, {}, rows).find((i) => i.itemId === 'led-supply');
  const s1 = supply([{ powerW: 60, price: 80 }, { powerW: 100, price: 110 }, { powerW: 150, price: 140 }, { powerW: 240, price: 200 }]);
  assert.equal(s1.calculatedCost, 140);
  assert.equal(s1.material, 'Zasilacz LED 150 W');
  // none big enough: several of the largest priced one
  const s2 = supply([{ powerW: 60, price: 80 }, { powerW: 240, price: 0 }]);
  assert.equal(s2.quantity, Math.ceil(need / 60));
  assert.equal(s2.calculatedCost, Math.ceil(need / 60) * 80);
  assert.equal(s2.material, `Zasilacz LED 60 W × ${Math.ceil(need / 60)}`);
  // no prices: unpriced, with a note
  const s3 = supply(createDefaultBoardPricing().ledSupplyPrices);
  assert.equal(s3.calculatedCost ?? null, null);
  assert.match(s3.notes.at(-1), /Brak ceny zasilacza/);
  // a project saved before: the default table
  assert.deepEqual(sanitizeBoardPricing({}).ledSupplyPrices, createDefaultBoardPricing().ledSupplyPrices);
});

test('steel per kg (the item’s whole mass), wall brackets per piece', () => {
  const b = buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, stairConstruction: 'metal-profile' });
  const items = computeMaterialTakeoff(b, b.fullConfig).filter((i) => i.elementType === 'STEEL');
  assert.ok(items.length > 0);
  const out = priced(items, { 'steel-structure': 15 });
  for (const it of out) assert.ok(Math.abs(it.calculatedCost - it.calculatedDimensions.massKg * 15) < 0.01, it.itemId);
  const kg = items.reduce((s, i) => s + i.calculatedDimensions.massKg, 0);
  assert.ok(Math.abs(kg - b.metalStructure.totalMassKg) < 1e-6, 'the items’ masses add up to the structure');
  const bracket = { itemId: 'x', elementType: 'HANDRAIL', materialId: 'railing-wall-bracket', status: 'OK', quantity: 4, unit: 'szt', calculatedDimensions: {}, notes: [] };
  assert.equal(applyPricing([bracket], withPrices({ 'railing-wall-bracket': 30 }))[0].calculatedCost, 120);
});

test('the takeoff’s category line counts pieces only — the LED strip / profile in running metres are not pieces', async () => {
  const { summarizeByCategory } = await import('../../ui/takeoffView.js');
  const b = ledStair();
  const items = computeMaterialTakeoff(b, b.fullConfig);
  const line = summarizeByCategory(items).lines.find((l) => l.label === 'Oświetlenie LED');
  assert.equal(line.count, 1, 'the power supply');
});
