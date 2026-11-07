import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeSummaries, appendOfferLines, buildOffer, createDefaultOfferSettings, sanitizeOfferSettings } from '../offerModel.js';
import { buildModernOfferHTML } from '../offerDocumentModern.js';
import { buildOfferHTML } from '../offerDocument.js';
import { createDefaultConfig } from '../../config/schema.js';
import { NEW_PROJECT_START } from '../../config/newProject.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { buildProjectPayload } from '../../project/projectIO.js';
import { createDefaultBoardPricing, DEFAULT_PRICE_LIST } from '../../takeoff/index.js';
import { linkedFloorOfferPart, stairFloorSummary, stairFloorOfferLines } from '../../app/linkedFloorOffer.js';
import { createDefaultCladdingConfig } from '../../cladding/schema.js';
import { buildCladdingStair } from '../../cladding/buildCladdingStair.js';
import { buildCladdingQuote } from '../../cladding/quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../../cladding/quote/labour.js';
import { buildCladdingOffer, createDefaultCladdingOffer, sanitizeCladdingOffer, mergeQuotes, quoteFromOfferLines } from '../../cladding/quote/claddingOffer.js';
import { claddingProjectToFile } from '../../cladding/projectFile.js';
import { claddingFloorOfferPart } from '../../cladding/floorOffer.js';
import { CLADDING_PROJECT_TYPE, buildCladdingFloorFromFile } from '../../cladding/floorStair.js';
import { registerReferenceBuilder } from '../../geometry/referenceStair.js';

// user request 2026-11-07: two floors counted into ONE offer — this project's prices, all the items in one list, the
// technical page for both floors
const prices = { priceList: DEFAULT_PRICE_LIST, boardPricing: createDefaultBoardPricing() };
// (a project as the app starts it — the opening derived from the stair, so its takeoff is not blocked by the ceiling)
const start = () => ({ ...createDefaultConfig(), ...NEW_PROJECT_START, stairPending: false });
const stairFile = (patch = {}) => JSON.parse(JSON.stringify(buildProjectPayload({ ...start(), ...patch })));

test('the switch: off by default in both modules', () => {
  assert.equal(createDefaultOfferSettings().includeLinkedFloor, false);
  assert.equal(sanitizeOfferSettings({ includeLinkedFloor: true }).includeLinkedFloor, true);
  assert.equal(createDefaultCladdingOffer().includeLinkedFloor, false);
  assert.equal(sanitizeCladdingOffer({ includeLinkedFloor: true }).includeLinkedFloor, true);
});

test('summaries merged by category (count, cost, unpriced); lines appended with the discount, merged, before the installation', () => {
  const a = { lines: [{ label: 'Stopnie', count: 10, cost: 1000, unpriced: 0 }, { label: 'Wangi', count: 2, cost: 500, unpriced: 1 }] };
  const b = { lines: [{ label: 'Stopnie', count: 12, cost: 1200.5, unpriced: 0 }, { label: 'Słupy', count: 1, cost: 300, unpriced: 0 }] };
  const m = mergeSummaries(a, b);
  assert.deepEqual(m.lines.map((l) => [l.label, l.count, l.cost, l.unpriced]), [['Stopnie', 22, 2200.5, 0], ['Wangi', 2, 500, 1], ['Słupy', 1, 300, 0]]);
  assert.equal(m.total, 3000.5);
  const settings = { ...createDefaultOfferSettings(), installationCostNet: 800, discountPct: 10, vatRatePct: 8 };
  const offer = buildOffer({ summary: a, settings });
  const both = appendOfferLines(offer, [{ label: 'Stopnie proste', net: 1000 }, { label: 'Stopnie proste', net: 500 }, { label: 'Podesty', net: 200 }], settings);
  assert.deepEqual(both.lines.map((l) => [l.label, l.net]).slice(-3), [['Stopnie proste', 1350], ['Podesty', 180], ['Montaż', 800]]);
  assert.equal(both.totals.net, Math.round(both.lines.reduce((s, l) => s + l.net, 0) * 100) / 100);
  assert.equal(both.totals.vatRatePct, 8);
});

test('a self-supporting floor above a self-supporting one: priced with THIS project’s prices, summed by category into one offer', () => {
  const own = buildStaircase({ ...start(), referenceStair: { name: 'Piętro', level: 'above', file: stairFile(), dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } });
  const part = linkedFloorOfferPart(own.reference, { prices });
  assert.equal(part.kind, 'stair');
  assert.equal(part.name, 'Piętro');
  assert.ok(part.summary.total > 0, 'priced');
  assert.ok(part.facts.rows.length > 0, 'its facts for the technical page');
  // the prices are ours: doubling our board prices changes the floor's total
  const dear = { ...prices, boardPricing: { ...prices.boardPricing, rows: (prices.boardPricing.rows || []).map((r) => ({ ...r, prices: r.prices?.map((p) => p * 2) })) } };
  if ((prices.boardPricing.rows || []).length) assert.notEqual(stairFloorSummary(own.reference.other, dear).summary.total, part.summary.total);
  // as lines for the concrete module: the material without CNC / installation
  const lines = stairFloorOfferLines(own.reference, { prices }).lines;
  assert.ok(lines.length > 0 && lines.every((l) => l.kind === 'material'));
  assert.ok(Math.abs(lines.reduce((s, l) => s + l.net, 0) - part.summary.lines.filter((l) => l.cost > 0).reduce((s, l) => s + l.cost, 0)) < 0.02);
});

test('a concrete floor: quoted by the module with the given prices; two concrete quotes as one (groups summed, ids / names apart)', () => {
  registerReferenceBuilder(CLADDING_PROJECT_TYPE, buildCladdingFloorFromFile);
  const qs = createDefaultQuoteSettings();
  qs.labour.forEach((r) => (r.rate = 40));
  const file = claddingProjectToFile({ config: createDefaultCladdingConfig(), quote: createDefaultQuoteSettings() });
  // our whole quote settings (a concrete project offering) — the labour ours
  const part = claddingFloorOfferPart(file, { quoteSettings: qs });
  const ownQ = buildCladdingQuote(buildCladdingStair(createDefaultCladdingConfig()), qs);
  assert.equal(part.quote.totals.net, ownQ.totals.net, 'the same stair, the same prices → the same quote');
  const both = mergeQuotes(ownQ, part.quote, 'Piętro');
  assert.equal(both.totals.net, Math.round((ownQ.totals.net * 2) * 100) / 100);
  assert.equal(new Set(both.lines.map((l) => l.id)).size, both.lines.length, 'ids apart');
  const offer = buildCladdingOffer(both, { ...createDefaultCladdingOffer(), mode: 'groups' });
  const single = buildCladdingOffer(ownQ, { ...createDefaultCladdingOffer(), mode: 'groups' });
  assert.equal(offer.lines.length, single.lines.length, 'the groups summed, not repeated');
  // a self-supporting floor's lines into a concrete offer
  const q2 = quoteFromOfferLines([{ label: 'Schody — materiał wraz z przygotowaniem', detail: 'w tym: stopnie', net: 1000 }], 8);
  assert.equal(mergeQuotes(ownQ, q2).totals.materialNet, Math.round((ownQ.totals.materialNet + 1000) * 100) / 100);
  // a self-supporting project offering with a concrete floor: our price list, the floor's own labour
  const fromStair = buildStaircase({ ...createDefaultConfig(), stairPending: false, referenceStair: { name: 'Beton', level: 'above', file, dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } });
  const p2 = linkedFloorOfferPart(fromStair.reference, { prices, priceCladdingFloor: claddingFloorOfferPart });
  assert.equal(p2.kind, 'cladding');
  assert.ok(p2.lines.length > 0 && p2.facts.rows.length > 0 && /<svg/.test(p2.planSvg));
});

test('the offer documents: the other floor’s plan and parameters on the technical page', () => {
  const offer = { lines: [{ kind: 'extra', label: 'X', net: 100 }], totals: { net: 100, vat: 23, gross: 123, vatRatePct: 23 } };
  const facts = { rows: [['Rodzaj', 'L']], comfort: [] };
  const floors = [{ name: 'Piętro', facts: { rows: [['Liczba stopni', '14']] }, planSvg: '<svg id="p2"></svg>' }];
  const modern = buildModernOfferHTML({ offer, facts, settings: createDefaultOfferSettings(), floors });
  assert.match(modern, /Piętro — rzut z góry<\/h2><figure class="plan"><svg id="p2"><\/svg>/);
  assert.match(modern, /Piętro — parametry schodów<\/h2><dl class="params"><div><dt>Liczba stopni<\/dt><dd>14<\/dd>/);
  const classic = buildOfferHTML({ offer, facts, settings: createDefaultOfferSettings(), floors });
  assert.match(classic, /Piętro — parametry schodów<\/h2>/);
  assert.match(classic, /<svg id="p2"><\/svg>/);
  assert.doesNotMatch(buildModernOfferHTML({ offer, facts, settings: createDefaultOfferSettings() }), /— parametry schodów/);
});

test('a linked floor whose own takeoff is blocked by its findings: reported, not counted', () => {
  const own = buildStaircase({ ...createDefaultConfig(), stairPending: false, referenceStair: { name: 'Proste', level: 'above', file: stairFile({ stairType: 'straight' }), dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } });
  const part = linkedFloorOfferPart(own.reference, { prices });
  assert.equal(part.blocked, true);
  assert.equal(part.summary, null);
});

// user decisions 2026-11-07: (1) the linked floor's placement (the passage under the upper stair) never blocks this
// project's takeoff; (2) two KINDS of stair are each priced from their own project file
test('a linked floor standing over the stair: its headroom error is reported but does not block the takeoff', async () => {
  const { runTakeoffValidationGate } = await import('../../takeoff/validationGate.js');
  const own = buildStaircase({ ...start(), referenceStair: { name: 'Piętro', level: 'above', file: stairFile(), dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } });
  const gate = runTakeoffValidationGate(own, {});
  assert.ok(gate.errors.some((d) => d.ruleId === 'REFERENCE-STAIR-HEADROOM'), 'the clash is there (the test means something)');
  assert.notEqual(gate.status, 'BLOCKED');
  assert.ok(gate.activeDiagnostics.some((d) => d.ruleId === 'REFERENCE-STAIR-HEADROOM'), 'still listed');
});

test('two kinds of stair: each floor priced from its own project file (its price list, labour, CNC + installation)', async () => {
  const { stairFilePrices } = await import('../../app/linkedFloorOffer.js');
  registerReferenceBuilder(CLADDING_PROJECT_TYPE, buildCladdingFloorFromFile);
  // a concrete floor with ITS OWN labour rates, linked to a self-supporting project
  const qs = createDefaultQuoteSettings();
  qs.labour.forEach((r) => (r.rate = 55));
  const file = claddingProjectToFile({ config: createDefaultCladdingConfig(), quote: qs });
  const own = claddingFloorOfferPart(file, { ownOffer: true });
  const fromStair = buildStaircase({ ...start(), referenceStair: { name: 'Beton', level: 'above', file, dxMm: 9000, dyMm: 0, rotationDeg: 0, mirror: false } });
  const part = linkedFloorOfferPart(fromStair.reference, { prices, priceCladdingFloor: (f) => claddingFloorOfferPart(f, { ownOffer: true }) });
  const sum = (ls) => Math.round(ls.reduce((s, l) => s + l.net, 0) * 100) / 100;
  assert.equal(sum(part.lines), sum(own.lines));
  assert.equal(own.quote.totals.labourNet > 0, true, 'its labour priced (55 zł per item)');
  // a self-supporting floor linked to a concrete project: its own file's prices, CNC + projekt and installation
  const stairPayload = stairFile();
  stairPayload.offer = { ...createDefaultOfferSettings(), cncProjectCostNet: 1000, installationCostNet: 700 };
  const fromConcrete = buildStaircase({ ...start(), referenceStair: { name: 'Drewno', level: 'above', file: stairPayload, dxMm: 9000, dyMm: 0, rotationDeg: 0, mirror: false } });
  const lines = stairFloorOfferLines(fromConcrete.reference).lines;
  assert.ok(lines.some((l) => l.kind === 'installation' && l.net === 700), 'its own installation');
  const filePrices = stairFilePrices(stairPayload);
  const material = stairFloorSummary(fromConcrete.reference.other, filePrices).summary.lines.filter((l) => l.cost > 0).reduce((s, l) => s + l.cost, 0);
  assert.ok(Math.abs(sum(lines.filter((l) => l.kind === 'material')) - (material + 1000)) < 0.02, 'its own material + its own CNC + projekt');
});

// user request 2026-11-07: frames chosen in the presentation — a gallery on the offer's last page
test('the gallery of frames on the last page of both documents (and a sheet 2 for it even without the technical data)', async () => {
  const { FRAME_FORMATS } = await import('../../app/offerFramesPanel.js');
  const offer = { lines: [{ kind: 'extra', label: 'X', net: 100 }], totals: { net: 100, vat: 23, gross: 123, vatRatePct: 23 } };
  const facts = { rows: [['Rodzaj', 'L']], comfort: [] };
  const gallery = ['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB'];
  const modern = buildModernOfferHTML({ offer, facts, settings: createDefaultOfferSettings(), gallery });
  assert.match(modern, /<h2>Wizualizacje<\/h2><div class="gallery"><figure><img src="data:image\/jpeg;base64,AA"[^>]*><\/figure><figure><img src="data:image\/jpeg;base64,BB"/);
  const lastSheet = modern.split('<section class="sheet').at(-1);
  assert.match(lastSheet, /Wizualizacje/, 'on the last sheet');
  const noTech = buildModernOfferHTML({ offer, facts, settings: { ...createDefaultOfferSettings(), technicalSheet: false }, gallery });
  assert.equal(noTech.split('<section class="sheet').length - 1, 2, 'a sheet 2 for the gallery');
  assert.match(buildOfferHTML({ offer, facts, settings: createDefaultOfferSettings(), gallery }), /<h2>Wizualizacje<\/h2><div class="gallery">/);
  assert.doesNotMatch(buildModernOfferHTML({ offer, facts, settings: createDefaultOfferSettings() }), /Wizualizacje/);
  // the formats: the gallery landscape 3:2, the hero ones at the hero's ratios
  assert.equal(FRAME_FORMATS.gallery.width / FRAME_FORMATS.gallery.height, 1.5);
  assert.ok(FRAME_FORMATS.heroFull.height > FRAME_FORMATS.heroFull.width * 2.5);
});
