import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultQuoteSettings, sanitizeQuoteSettings, claddingPricesOf, applyCladdingPrices } from '../quote/labour.js';
import { priceListToFile, applyPriceListFile } from '../../takeoff/priceListFile.js';
import { claddingProjectToFile } from '../projectFile.js';
import { createDefaultCladdingConfig } from '../schema.js';

// user report 2026-11-07: „Zapisz cały cennik” in the concrete module lost the labour rates — the shared file carried
// only the price list / waste / board pricing
const priced = () => {
  const s = createDefaultQuoteSettings();
  s.labour.forEach((r, k) => (r.rate = 30 + k));
  s.labour.push({ id: 'own-x1', label: 'Demontaż starych okładzin', unit: 'm2', rate: 45, qty: 3 });
  Object.assign(s, { floorboardPerM2: 120, osbPerM2: 35, skirtingPerMb: 28, looseTonguePerMb: 17, edgeChannelsPerTread: 30, edgeChannels: true, withInstallation: false });
  s.lumps = { measure: false, transport: true };
  return sanitizeQuoteSettings(s);
};
// the module's save / load (claddingApp.js): the shared file + its own block
const save = (s) => JSON.parse(JSON.stringify({ ...priceListToFile(s), cladding: claddingPricesOf(s) }));
const load = (into, data) => {
  applyPriceListFile(into, data);
  return data.cladding ? applyCladdingPrices(into, data.cladding) : into;
};

test('the whole price list file round trip keeps the labour rates, own items and the module’s prices', () => {
  const src = priced();
  const back = load(createDefaultQuoteSettings(), save(src));
  assert.deepEqual(back.labour.map((r) => [r.id, r.rate]), src.labour.map((r) => [r.id, r.rate]));
  assert.deepEqual(back.labour.find((r) => r.id === 'own-x1'), { id: 'own-x1', label: 'Demontaż starych okładzin', unit: 'm2', rate: 45, qty: 3 });
  for (const k of ['floorboardPerM2', 'osbPerM2', 'skirtingPerMb', 'looseTonguePerMb', 'edgeChannelsPerTread']) assert.equal(back[k], src[k], k);
  assert.deepEqual(back.lumps, { measure: false, transport: true });
  // the job's own choices stay the job's
  assert.equal(back.edgeChannels, false);
  assert.equal(back.withInstallation, true);
});

test('a self-supporting price list file (no module block) leaves the labour as it is; a concrete project file gives it', () => {
  const mine = priced();
  const stairFile = JSON.parse(JSON.stringify(priceListToFile(createDefaultQuoteSettings())));
  const after = load(sanitizeQuoteSettings(mine), stairFile);
  assert.deepEqual(after.labour.map((r) => r.rate), mine.labour.map((r) => r.rate));
  // a concrete project file: its quote's prices + labour (as the module's „Wczytaj cały cennik” reads it)
  const project = JSON.parse(JSON.stringify(claddingProjectToFile({ config: createDefaultCladdingConfig(), quote: mine })));
  const into = createDefaultQuoteSettings();
  applyPriceListFile(into, { _type: 'schody3d-cennik', ...project.quote });
  const fromProject = applyCladdingPrices(into, claddingPricesOf(sanitizeQuoteSettings(project.quote)));
  assert.deepEqual(fromProject.labour.map((r) => r.rate), mine.labour.map((r) => r.rate));
  assert.equal(fromProject.floorboardPerM2, 120);
});
