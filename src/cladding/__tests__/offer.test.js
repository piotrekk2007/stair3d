import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings, sanitizeQuoteSettings, priceOf } from '../quote/labour.js';
import { createDefaultCladdingOffer, sanitizeCladdingOffer, buildCladdingOffer, claddingFacts, buildEstimateHTML } from '../quote/claddingOffer.js';
import { claddingProjectToFile, parseCladdingProjectFile } from '../projectFile.js';
import { buildOfferHTML } from '../../offer/offerDocument.js';
import { applyPriceListFile, priceListToFile } from '../../takeoff/priceListFile.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';

// stage 6 (user, 2026-11-04): the quote / offer / estimate; the price list shared with the self-supporting module
const built = () => buildCladdingStair({ ...createDefaultCladdingConfig(), railingSides: { 0: { right: true } } });
const priced = () => {
  const s = createDefaultQuoteSettings();
  s.labour.forEach((r) => (r.rate = 50));
  s.priceList.forEach((p) => (p.price = 30));
  return s;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: ${a} vs ${b}`);

test('the price list is the self-supporting one: the same file saved / read, posts by section', () => {
  const s = priced();
  s.boardPricing.postPrices = [{ sectionMm: 100, price: 420, unit: 'szt' }];
  const file = JSON.parse(JSON.stringify(priceListToFile(s)));
  assert.equal(file._type, 'schody3d-cennik');
  const fresh = createDefaultQuoteSettings();
  const read = applyPriceListFile(fresh, file);
  assert.ok(read.prices > 5);
  assert.equal(priceOf(fresh, 'railing-baluster'), 30);
  assert.deepEqual(fresh.boardPricing.postPrices, [{ sectionMm: 100, price: 420, unit: 'szt' }]);
  const q = buildCladdingQuote(built(), fresh);
  near(q.lines.find((l) => l.id === 'railing-0-right-posts').material.value, 840, 'two posts from the post table');
  // a project from before: its own handrail / baluster prices taken over into the shared list
  const old = sanitizeQuoteSettings({ handrailPerMb: 210, balusterPerPiece: 44 });
  assert.equal(priceOf(old, 'railing-handrail'), 210);
  assert.equal(priceOf(old, 'railing-baluster'), 44);
});

test('the offer: per group (default) / per element / material + installation, totals with the quote VAT', () => {
  const q = buildCladdingQuote(built(), priced());
  const groups = buildCladdingOffer(q, createDefaultCladdingOffer());
  near(groups.totals.net, q.totals.net, 'per group: the whole quote');
  assert.ok(groups.lines.some((l) => l.label === 'Stopnie proste'));
  assert.equal(groups.totals.vatRatePct, 8);
  const detailed = buildCladdingOffer(q, sanitizeCladdingOffer({ mode: 'detailed' }));
  assert.equal(detailed.lines.length, q.lines.filter((l) => l.total > 0).length);
  const split = buildCladdingOffer(q, sanitizeCladdingOffer({ mode: 'split' }));
  assert.deepEqual(split.lines.map((l) => l.id), ['material', 'installation']);
  near(split.totals.net, q.totals.net, 'split: material + labour');
});

test('the offer editor: a line renamed / left out, extra rows, a discount spread over the lines', () => {
  const q = buildCladdingQuote(built(), priced());
  const base = buildCladdingOffer(q, createDefaultCladdingOffer());
  const edited = buildCladdingOffer(
    q,
    sanitizeCladdingOffer({ lineEdits: { 'group:Usługi': { hidden: true }, 'group:Stopnie proste': { label: 'Stopnie dębowe' } }, extras: [{ label: 'Demontaż wykładziny', qty: 10, unit: 'm²', unitNet: 25 }], discountPct: 10 })
  );
  assert.ok(!edited.lines.some((l) => l.id === 'group:Usługi'), 'left out');
  assert.equal(edited.lines.find((l) => l.id === 'group:Stopnie proste').label, 'Stopnie dębowe');
  const extra = edited.lines.find((l) => l.extra);
  near(extra.net, 250, 'extra row');
  const services = base.lines.find((l) => l.id === 'group:Usługi').net;
  near(edited.totals.net, (base.totals.net - services) * 0.9 + 250, 'discount on the quote lines, not on the extras');
});

test('the offer printed by the shared document; the estimate; the facts; saved in the project file', () => {
  const b = built();
  const s = priced();
  const q = buildCladdingQuote(b, s);
  const o = sanitizeCladdingOffer({ client: { name: 'Jan Kowalski' }, offerNumber: 'OF/1' });
  const html = buildOfferHTML({ offer: buildCladdingOffer(q, o), facts: claddingFacts(b, s), settings: o, company: { name: 'Stolarnia' }, planSvg: renderCladdingPlanSVG(b, { clientView: true }), projectName: 'Test' });
  assert.match(html, /Oferta nr OF\/1/);
  assert.match(html, /Jan Kowalski/);
  assert.match(html, /Schody drewniane na biegu betonowym/);
  assert.doesNotMatch(html, /clad-edge-handle/, 'no editing aids on the client plan');
  const est = buildEstimateHTML({ quote: q, projectName: 'Test' });
  assert.match(est, /Kosztorys/);
  assert.match(est, /Robocizna/);
  const back = parseCladdingProjectFile(JSON.stringify(claddingProjectToFile({ config: createDefaultCladdingConfig(), offer: o, quote: s })));
  assert.equal(back.offer.client.name, 'Jan Kowalski');
  assert.equal(priceOf(back.quote, 'railing-baluster'), 30);
});

// user request 2026-11-23: the material per group of goods (stopnie, podstopnice, balustrada, podesty…) and, apart, the
// installation per its own group (stopnie i podstopnice, balustrada, listwowanie…)
test('the offer: groups of goods (material) and the installation in groups, apart', async () => {
  const { LABOUR_GROUPS } = await import('../quote/claddingOffer.js');
  const q = buildCladdingQuote(built(), priced());
  const o = buildCladdingOffer(q, sanitizeCladdingOffer({ mode: 'groups-split' }));
  near(o.totals.net, q.totals.net, 'the whole quote');
  const mat = o.lines.filter((l) => l.kind === 'material');
  const lab = o.lines.filter((l) => l.kind === 'installation');
  assert.ok(mat.length >= 3 && lab.length >= 2);
  near(mat.reduce((s, l) => s + l.net, 0), q.totals.materialNet, 'the material lines = the material');
  near(lab.reduce((s, l) => s + l.net, 0), q.totals.labourNet, 'the installation lines = the labour');
  assert.ok(o.lines.indexOf(mat.at(-1)) < o.lines.indexOf(lab[0]), 'the material first, then the installation');
  // the straight treads and the risers: material apart, one installation line „Montaż stopni i podstopnic”
  assert.ok(mat.some((l) => l.label === 'Stopnie proste') && mat.some((l) => l.label === 'Podstopnice'));
  const treads = lab.find((l) => l.label === 'Montaż stopni i podstopnic');
  const want = q.lines.filter((l) => LABOUR_GROUPS[l.group] === 'Montaż stopni i podstopnic').reduce((s, l) => s + (l.labour?.value ?? 0), 0);
  near(treads.net, want, 'the treads\' and risers\' installation together');
  assert.ok(lab.some((l) => l.label === 'Montaż balustrady'));
  // a renamed / hidden line as in every mode; a discount over all
  const edited = buildCladdingOffer(q, sanitizeCladdingOffer({ mode: 'groups-split', lineEdits: { 'lab:Montaż balustrady': { label: 'Montaż balustrady dębowej' } }, discountPct: 10 }));
  assert.ok(edited.lines.some((l) => l.label === 'Montaż balustrady dębowej'));
  near(edited.totals.net, q.totals.net * 0.9, 'the discount');
});
