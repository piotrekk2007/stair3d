import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PRICE_LIST } from '../pricing.js';
import { DEFAULT_WASTE_FACTORS } from '../wasteFactors.js';
import { createDefaultBoardPricing } from '../boardPricing.js';
import { priceListToFile, applyPriceListFile, PRICE_LIST_FILE_TYPE } from '../priceListFile.js';

const fresh = () => ({ priceList: DEFAULT_PRICE_LIST.map((p) => ({ ...p })), wasteFactors: { ...DEFAULT_WASTE_FACTORS }, boardPricing: createDefaultBoardPricing(), manualItems: [{ name: 'montaż', qty: 1, unit: 'szt', price: 500 }] });

test('regression (user, 2026-11-03): the whole price list goes to another project — balusters, handrail, post profiles added by hand, LED supplies, species, waste; not the project’s own rows', () => {
  const mine = fresh();
  const set = (id, price) => (mine.priceList.find((p) => p.materialId === id).price = price);
  set('railing-baluster', 45);
  set('railing-handrail', 180);
  set('railing-wall-bracket', 25);
  mine.boardPricing.postPrices.push({ sectionMm: 140, price: 320, unit: 'mb' });
  mine.boardPricing.ledSupplyPrices[0].price = 99;
  mine.boardPricing.species = 'Jesion';
  mine.boardPricing.table.boards[0].priceTo1500 = 999;
  mine.wasteFactors.TREAD = 0.2;
  const text = JSON.stringify(priceListToFile(mine));
  assert.equal(JSON.parse(text)._type, PRICE_LIST_FILE_TYPE);

  const other = fresh();
  other.manualItems = [];
  const read = applyPriceListFile(other, text);
  const price = (id) => other.priceList.find((p) => p.materialId === id).price;
  assert.equal(price('railing-baluster'), 45);
  assert.equal(price('railing-handrail'), 180);
  assert.equal(price('railing-wall-bracket'), 25);
  assert.deepEqual(other.boardPricing.postPrices.at(-1), { sectionMm: 140, price: 320, unit: 'mb' });
  assert.equal(other.boardPricing.ledSupplyPrices[0].price, 99);
  assert.equal(other.boardPricing.species, 'Jesion');
  assert.equal(other.boardPricing.table.boards[0].priceTo1500, 999);
  assert.equal(other.wasteFactors.TREAD, 0.2);
  assert.deepEqual(other.manualItems, [], 'a job’s own extra rows stay in its project');
  assert.ok(read.prices >= 3 && read.posts === mine.boardPricing.postPrices.length);
});

test('a project file’s price list can be read too; anything else is refused', () => {
  const mine = fresh();
  mine.priceList.find((p) => p.materialId === 'railing-baluster').price = 33;
  const project = { _type: 'schody3d-project', takeoffSettings: { priceList: mine.priceList, wasteFactors: mine.wasteFactors, boardPricing: mine.boardPricing } };
  const other = fresh();
  applyPriceListFile(other, JSON.stringify(project));
  assert.equal(other.priceList.find((p) => p.materialId === 'railing-baluster').price, 33);
  assert.throws(() => applyPriceListFile(fresh(), '{"foo": 1}'), /nie jest plik/);
  assert.throws(() => applyPriceListFile(fresh(), 'grubość;od;do'), /nie jest plik/);
});
