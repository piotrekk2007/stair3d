import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOffer, sanitizeOfferSettings, createDefaultOfferSettings, stairFacts, separableCategories, suggestOfferNumber, sanitizeCompany } from '../offerModel.js';
import { buildOfferHTML, money } from '../offerDocument.js';
import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildProjectPayload, parseProjectFile } from '../../project/projectIO.js';

const summary = {
  lines: [
    { label: 'Stopnie', count: 10, cost: 1000, unpriced: 0, manual: false },
    { label: 'Stopnie zabiegowe', count: 3, cost: 500, unpriced: 0, manual: false },
    { label: 'Podstopnie', count: 14, cost: 200, unpriced: 0, manual: false },
    { label: 'Wangi', count: 3, cost: 500, unpriced: 0, manual: false },
    { label: 'Łączniki (bez ceny)', count: 10, cost: 0, unpriced: 5, manual: false },
    { label: 'Lakierowanie wang na biało', count: 1, cost: 300, unpriced: 0, manual: true },
  ],
};
const manualItems = [
  { name: 'Lakierowanie wang na biało', qty: 1, unit: 'szt', price: 300 },
  { name: 'Tralki', qty: 0, unit: 'szt', price: 35 },
];
const settings = { ...createDefaultOfferSettings(), cncProjectCostNet: 440, installationCostNet: 800, vatRatePct: 8, separateCategories: ['Podstopnie'] };

test('CNC + projekt is spread over the material lines (never its own line); picked categories shown separately with their share', () => {
  const o = buildOffer({ summary, manualItems, settings });
  const main = o.lines.find((l) => l.label.startsWith('Schody'));
  const risers = o.lines.find((l) => l.label.startsWith('Podstopnie'));
  assert.equal(main.net, 2400, '(1000 + 500 + 500) x (1 + 440 / 2200)');
  assert.equal(risers.net, 240, '200 x 1.2 — its own share of CNC + projekt');
  assert.match(main.detail, /stopnie, stopnie zabiegowe, wangi/);
  assert.ok(!o.lines.some((l) => /cnc|projekt/i.test(l.label)), 'CNC + projekt never a line');
  assert.equal(o.lines.find((l) => l.label === 'Lakierowanie wang na biało').net, 300, 'manual extra item is its own line');
  assert.ok(!o.lines.some((l) => l.label === 'Tralki'), 'an empty manual row is left out');
  assert.equal(o.lines.find((l) => l.kind === 'installation').net, 800);
  assert.deepEqual(o.totals, { net: 3740, vat: 299.2, gross: 4039.2, vatRatePct: 8 });
  assert.equal(o.materialNet, 2200);
  assert.equal(o.cncProjectNet, 440);
  assert.ok(o.warnings.some((w) => /5 poz\. kosztorysu nie ma ceny/.test(w)));
  assert.deepEqual(separableCategories(summary), ['Stopnie', 'Stopnie zabiegowe', 'Podstopnie', 'Wangi']);
});

test('rounding never changes the total; CNC with no material still lands in the material line; a blocked takeoff warns', () => {
  const three = { lines: ['A', 'B', 'C'].map((label) => ({ label, cost: 1, unpriced: 0, manual: false })) };
  const o = buildOffer({ summary: three, settings: { ...createDefaultOfferSettings(), cncProjectCostNet: 100, separateCategories: ['A', 'B'] } });
  assert.equal(Math.round(o.lines.reduce((s, l) => s + l.net, 0) * 100) / 100, 103);
  const only = buildOffer({ summary: { lines: [] }, settings: { ...createDefaultOfferSettings(), cncProjectCostNet: 500 } });
  assert.equal(only.lines[0].net, 500);
  const blocked = buildOffer({ summary: { lines: [] }, settings: createDefaultOfferSettings(), blocked: true });
  assert.equal(blocked.lines.length, 0);
  assert.match(blocked.warnings[0], /zablokowany/);
});

test('settings and company are sanitized; offer number suggestion', () => {
  const s = sanitizeOfferSettings({ vatRatePct: 17, cncProjectCostNet: -5, client: { name: 7 }, separateCategories: ['Wangi', 3], showComfort: false });
  assert.equal(s.vatRatePct, 23);
  assert.equal(s.cncProjectCostNet, 0);
  assert.equal(s.client.name, '');
  assert.deepEqual(s.separateCategories, ['Wangi']);
  assert.equal(s.showComfort, false);
  assert.deepEqual(sanitizeCompany({ name: 'DREWEX', x: 1 }), { name: 'DREWEX', address: '', nip: '', phone: '', email: '', www: '' });
  assert.equal(suggestOfferNumber(new Date(2026, 8, 28, 9, 5)), 'OF/2026/0928-0905');
});

test('stair facts: basic data and comfort against the catalogue rules', () => {
  const config = createDefaultConfig();
  const derived = deriveStairData(config);
  const f = stairFacts(config, derived, { material: 'Dąb, Klasa Natura' });
  assert.ok(f.rows.some(([k, v]) => k === 'Wysokość stopnia (wznios)' && v === `${derived.riserHeight.toFixed(1)} mm`));
  assert.ok(f.rows.some(([k]) => k === 'Drewno'));
  assert.equal(Math.round(f.blondel), Math.round(2 * derived.riserHeight + config.treadGoing));
  const blondel = f.comfort.find((c) => c.label.startsWith('Wzór Blondela'));
  assert.equal(blondel.ok, f.blondel >= 600 && f.blondel <= 650);
  assert.ok(f.comfort.every((c) => c.source.startsWith('WT')));
});

test('offer HTML: header, client, lines and totals; escapes input; never shows the CNC amount; optional parts', () => {
  const offer = buildOffer({ summary, manualItems, settings });
  const config = createDefaultConfig();
  const facts = stairFacts(config, deriveStairData(config));
  const html = buildOfferHTML({
    offer,
    facts,
    settings: { ...settings, offerNumber: 'OF/1', client: { name: 'Jan <b>Kowalski</b>', address: '', phone: '', email: '' }, notes: 'Termin: 6 tygodni' },
    company: { name: 'DREWEX', nip: '123' },
    image3d: 'data:image/jpeg;base64,AAAA',
    planSvg: '<svg id="plan"></svg>',
    date: new Date(2026, 8, 28),
  });
  assert.match(html, /<title>Oferta nr OF\/1/);
  assert.ok(html.includes('Jan &lt;b&gt;Kowalski&lt;/b&gt;'), 'client input is escaped');
  assert.ok(html.includes(money(4039.2)) && html.includes('VAT 8%'));
  assert.ok(html.includes('Ważna do: 28.10.2026'));
  assert.ok(!/CNC/i.test(html), 'no CNC anywhere in the client document');
  assert.ok(!html.includes(money(440)), 'the CNC + projekt amount is not printed');
  assert.ok(html.includes('<svg id="plan"></svg>') && html.includes('data:image/jpeg;base64,AAAA'));
  assert.ok(html.includes('Termin: 6 tygodni') && html.includes('NIP: 123'));
  assert.ok(html.includes('Wygoda i zgodność'));
  const plain = buildOfferHTML({ offer, facts, settings: { ...settings, showComfort: false }, date: new Date(2026, 8, 28) });
  assert.ok(!plain.includes('Wygoda i zgodność') && !plain.includes('<img'));
});

test('project file: the offer settings survive save and load; an older file gets defaults', () => {
  const offerIn = { ...createDefaultOfferSettings(), cncProjectCostNet: 1500, client: { name: 'Nowak', address: 'Kraków', phone: '', email: '' } };
  const payload = buildProjectPayload(createDefaultConfig(), { offer: offerIn });
  const { meta } = parseProjectFile(JSON.stringify(payload));
  assert.deepEqual(sanitizeOfferSettings(meta.offer), sanitizeOfferSettings(offerIn));
  const old = buildProjectPayload(createDefaultConfig(), {});
  assert.equal(parseProjectFile(JSON.stringify(old)).meta.offer, null);
});
