import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings, sanitizeQuoteSettings } from '../quote/labour.js';
import { createDefaultBoardPricing, lookupBoardPricePerMb } from '../../takeoff/boardPricing.js';

// stage 4 (user decisions 2026-11-04): every installed element its material (the board price list) and its own labour
const rated = (rates = {}) => {
  const s = createDefaultQuoteSettings();
  s.labour.forEach((r) => (r.rate = rates[r.id] ?? 100));
  return s;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg}: ${a} vs ${b}`);

test('a line per tread / riser / nosing / lump sum; the tread labour by its kind and riser', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'winders', count: 3, riseMm: 180, turn: 'right' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
    stepOverrides: { 1: { riser: false } },
  });
  const q = buildCladdingQuote(b, rated());
  const treads = q.lines.filter((l) => l.group === 'Stopnie proste' || l.group === 'Stopnie zabiegowe');
  assert.equal(treads.length, 7);
  assert.equal(treads[0].labour.id, 'tread-straight-riser');
  assert.equal(treads[1].labour.id, 'tread-straight', 'its riser switched off');
  assert.deepEqual(treads.filter((l) => l.group === 'Stopnie zabiegowe').map((l) => l.labour.id), ['tread-winder-riser', 'tread-winder-riser', 'tread-winder-riser']);
  assert.equal(q.lines.filter((l) => l.group === 'Podstopnice').length, b.cladding.risers.length);
  assert.equal(q.lines.filter((l) => l.group === 'Noski').length, 1);
  assert.deepEqual(q.lines.filter((l) => l.group === 'Usługi').map((l) => l.id), ['lump-measure', 'lump-transport']);
  // each group one block
  const order = q.lines.map((l) => l.group).filter((g, k, all) => k === 0 || all[k - 1] !== g);
  assert.equal(new Set(order).size, order.length, `groups in blocks: ${order.join(', ')}`);
});

test('material from the board price list: the tread blank priced per running metre of its length', () => {
  const b = buildCladdingStair(createDefaultCladdingConfig());
  const q = buildCladdingQuote(b, rated());
  const t = b.cladding.treads[0];
  const line = q.lines.find((l) => l.id === t.id);
  const p = createDefaultBoardPricing();
  const r = lookupBoardPricePerMb(p.table, { species: p.species, cls: p.cls, thicknessMm: t.thicknessMm, depthMm: t.depthMm, lengthMm: t.lengthMm });
  assert.ok(r.ok);
  near(line.material.value, (r.pricePerMb * t.lengthMm) / 1000, 'tread material');
  assert.match(line.dims, /^\d+ × \d+ × 40 mm$/);
});

test('totals and VAT: 8 % with installation, 23 % material only; a missing rate leaves the line unpriced, never invented', () => {
  const b = buildCladdingStair(createDefaultCladdingConfig());
  const q = buildCladdingQuote(b, rated());
  near(q.totals.net, q.lines.reduce((s, l) => s + l.total, 0), 'net = the lines');
  near(q.totals.net, q.totals.materialNet + q.totals.labourNet, 'net = material + labour');
  assert.equal(q.totals.vatPct, 8);
  near(q.totals.gross, q.totals.net * 1.08, 'gross');
  const mat = buildCladdingQuote(b, { ...rated(), withInstallation: false });
  assert.equal(mat.totals.vatPct, 23);
  // no rates at all: the labour unpriced on every installed line, the material still priced
  const none = buildCladdingQuote(b, createDefaultQuoteSettings());
  assert.equal(none.totals.labourNet, 0);
  assert.ok(none.unpriced > 0);
  assert.ok(none.lines.filter((l) => l.labour).every((l) => l.labour.value === null && l.labour.note === 'brak stawki robocizny'));
  assert.equal(none.totals.materialNet, q.totals.materialNet);
});

test('a floor-board landing: labour per m², the boards and the OSB per m², its nosing as a board', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'right', finish: 'floorboard' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
  });
  const s = { ...rated({ 'landing-floorboard': 150 }), floorboardPerM2: 200, osbPerM2: 40 };
  const q = buildCladdingQuote(b, s);
  const main = q.lines.find((l) => l.id === 'landing-2');
  assert.match(main.name, /Półpodest 3 — deska podłogowa/);
  near(main.labour.value, 150 * main.qty, 'labour per m²');
  const boards = q.lines.find((l) => l.id === 'landing-2-boards');
  const osb = q.lines.find((l) => l.id === 'landing-2-osb');
  near(boards.material.value, 200 * boards.qty, 'boards per m²');
  near(osb.material.value, 40 * osb.qty, 'OSB per m²');
  assert.ok(q.lines.find((l) => l.id === 'landing-2-nosing').material.value > 0);
  // without the m² prices: unpriced, said so
  const bare = buildCladdingQuote(b, rated());
  assert.equal(bare.lines.find((l) => l.id === 'landing-2-boards').material.note, 'brak ceny deski za m²');
});

test('settings: the known items kept with their rates, own items (own-…) with a quantity, the rest dropped', () => {
  const s = sanitizeQuoteSettings({ labour: [{ id: 'tread-straight', rate: '120' }, { id: 'own-1', label: 'Demontaż starych okładzin', unit: 'mb', rate: 30, qty: 12 }, { id: 'hack', rate: 1 }], withInstallation: false });
  assert.equal(s.labour.find((r) => r.id === 'tread-straight').rate, 120);
  assert.deepEqual(s.labour.find((r) => r.id === 'own-1'), { id: 'own-1', label: 'Demontaż starych okładzin', unit: 'mb', rate: 30, qty: 12 });
  assert.equal(s.labour.some((r) => r.id === 'hack'), false);
  assert.equal(s.withInstallation, false);
  const q = buildCladdingQuote(buildCladdingStair(createDefaultCladdingConfig()), s);
  near(q.lines.find((l) => l.id === 'own-1').labour.value, 360, 'own line: 12 mb × 30');
});

test('the project file carries the quote settings (rates, VAT, own items)', async () => {
  const { claddingProjectToFile, parseCladdingProjectFile } = await import('../projectFile.js');
  const quote = rated({ 'tread-straight-riser': 250 });
  quote.withInstallation = false;
  const back = parseCladdingProjectFile(JSON.stringify(claddingProjectToFile({ config: createDefaultCladdingConfig(), quote })));
  assert.equal(back.quote.labour.find((r) => r.id === 'tread-straight-riser').rate, 250);
  assert.equal(back.quote.withInstallation, false);
  // an older file without a quote: the defaults
  const old = parseCladdingProjectFile(JSON.stringify({ _type: 'schody3d-beton', _version: 1, cladding: createDefaultCladdingConfig() }));
  assert.equal(old.quote.labour.every((r) => r.rate === 0), true);
});
