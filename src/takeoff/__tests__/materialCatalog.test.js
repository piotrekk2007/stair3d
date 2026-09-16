import test from 'node:test';
import assert from 'node:assert/strict';

import { roundUpToCatalogSize, getMaterialCatalogEntry, DEFAULT_MATERIAL_CATALOG } from '../materialCatalog.js';

test('roundUpToCatalogSize picks the smallest available size that is still >= the requirement', () => {
  const result = roundUpToCatalogSize(4610, [3000, 3600, 4200, 4800, 6000]);
  assert.equal(result.sizeMm, 4800);
  assert.equal(result.exact, false);
});

test('roundUpToCatalogSize never rounds DOWN, even when a smaller size is closer', () => {
  // 4199 is 1mm from 4200 (below) and 601mm from 4800 (above) — must still pick 4200 only
  // because 4200 >= 4199, never round down to something shorter than required.
  const result = roundUpToCatalogSize(4199, [3000, 3600, 4200, 4800, 6000]);
  assert.equal(result.sizeMm, 4200);
});

test('roundUpToCatalogSize reports exact:true when the requirement already matches a catalog size', () => {
  const result = roundUpToCatalogSize(4200, [3000, 3600, 4200, 4800, 6000]);
  assert.equal(result.sizeMm, 4200);
  assert.equal(result.exact, true);
});

test('roundUpToCatalogSize returns sizeMm:null (never an invented number) when nothing is big enough', () => {
  const result = roundUpToCatalogSize(9000, [3000, 3600, 4200, 4800, 6000]);
  assert.equal(result.sizeMm, null);
  assert.equal(result.exact, false);
});

test('roundUpToCatalogSize handles an unsorted list correctly', () => {
  const result = roundUpToCatalogSize(3500, [6000, 3000, 4800, 3600, 4200]);
  assert.equal(result.sizeMm, 3600);
});

test('roundUpToCatalogSize with no available sizes returns null, not a crash', () => {
  assert.deepEqual(roundUpToCatalogSize(1000, []), { sizeMm: null, exact: false });
  assert.deepEqual(roundUpToCatalogSize(1000, undefined), { sizeMm: null, exact: false });
});

test('the default catalog has real entries for the two materials the takeoff actually uses', () => {
  assert.ok(getMaterialCatalogEntry('timber-c24'));
  assert.ok(getMaterialCatalogEntry('sheet-plywood-mdf'));
  assert.equal(getMaterialCatalogEntry('no-such-material'), null);
});

test('the default catalog is exported and frozen (read-only)', () => {
  assert.throws(() => {
    DEFAULT_MATERIAL_CATALOG['timber-c24'] = null;
  }, TypeError);
});
