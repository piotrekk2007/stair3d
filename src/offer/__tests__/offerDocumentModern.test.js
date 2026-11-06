import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModernOfferHTML, MAX_P1_LINES, HERO_BACKGROUND } from '../offerDocumentModern.js';
import { createDefaultOfferSettings, sanitizeOfferSettings, sanitizeCompany } from '../offerModel.js';
import { createDefaultCladdingOffer, sanitizeCladdingOffer } from '../../cladding/quote/claddingOffer.js';
import { qrVersionFor as qrVersionForCard } from '../../util/qrCode.js';

// the modern offer style (user decisions 2026-11-06 — docs/design/oferta-nowoczesna-wzor.html)
const facts = {
  rows: [
    ['Rodzaj schodów', 'Zabiegowe / kątowe L, skręt w prawo'],
    ['Wysokość do pokonania', '2800 mm'],
    ['Liczba stopni', '15 (wzniosów: 16)'],
    ['Drewno', 'Dąb, Klasa Natura'],
    ['Montaż', 'tak'],
  ],
  comfort: [
    { label: 'Wzór Blondela 2h + s', value: '620 mm', requirement: '600–650 mm', ok: true, source: 'WT § 69 ust. 4' },
    { label: 'Szerokość biegu', value: '750 mm', requirement: 'min. 800 mm', ok: false, source: 'WT § 68' },
  ],
};
const offerOf = (n, extra = {}) => {
  const lines = Array.from({ length: n }, (_, i) => ({ kind: 'extra', label: `Pozycja ${i + 1}`, detail: i === 0 ? 'w tym: stopnie, wangi' : '', qty: i === 1 ? 2 : null, unit: i === 1 ? 'szt.' : '', unitNet: i === 1 ? 50 : null, net: 100 * (i + 1) }));
  const net = lines.reduce((s, l) => s + l.net, 0);
  return { lines, totals: { net, vat: Math.round(net * 23) / 100, gross: net + Math.round(net * 23) / 100, vatRatePct: 23 }, cncProjectNet: 1234.56, ...extra };
};
const settings = (patch = {}) => ({ ...createDefaultOfferSettings(), offerStyle: 'modern', offerNumber: 'DRX-2026-0003', validityDays: 14, client: { name: 'Jan Kowalski', address: '', phone: '600 100 200', email: 'jan@example.pl' }, ...patch });
const company = { name: 'Drewex sp.j.', address: 'ul. Wawrzyna 2', nip: '125', phone: '+48 22 786 62 98', email: 'drewex@drewex.net.pl', www: 'www.drewex.net.pl', contactName: 'Anna Nowak', contactPhone: '501 000 000', contactEmail: 'anna@drewex.net.pl', hours: 'pn–pt 7:00–16:00\nsob. 7:00–14:00' };
const html = (patch = {}, n = 3, extra = {}) => buildModernOfferHTML({ offer: offerOf(n), facts, settings: settings(patch), company, date: new Date(2026, 10, 6), ...extra });
const page = (h, k) => h.split('<section class="sheet')[k];

test('sheet 1: the number, the date, „Ważna do” (calendar days), the client and the offer\'s handler', () => {
  const h = html();
  const p1 = page(h, 1);
  assert.match(p1, /Oferta nr<\/div><div class="num display">DRX-2026-0003/);
  assert.match(p1, /z dnia 06\.11\.2026/);
  assert.match(p1, /Ważna do<\/div><strong>20\.11\.2026/);
  assert.match(p1, /<span>Klient<\/span><b>Jan Kowalski<\/b>tel\. 600 100 200<br>jan@example\.pl/);
  assert.match(p1, /<span>Opiekun oferty<\/span><b>Anna Nowak<\/b>tel\. 501 000 000<br>anna@drewex\.net\.pl/);
  assert.match(h, /<section class="sheet flow">/, 'sheet 2 grows');
  assert.match(h, new RegExp(`background: ${HERO_BACKGROUND}`));
  // the footer on both sheets, the hours as lines
  assert.equal((h.match(/<footer>/g) || []).length, 2);
  assert.match(h, /<span class="dim">pn–pt 7:00–16:00<\/span><span class="dim">sob\. 7:00–14:00<\/span>/);
});

test('every text escaped; the CNC + projekt amount never shown; the totals as the offer\'s', () => {
  const h = html({ offerTitle: 'Schody <b>dębowe</b>', notes: 'a & b <script>', client: { name: '<i>X</i>' } });
  assert.ok(!h.includes('<b>dębowe</b>') && h.includes('Schody &lt;b&gt;dębowe&lt;/b&gt;'));
  assert.ok(!h.includes('<script>') && h.includes('a &amp; b &lt;script&gt;'));
  assert.ok(h.includes('&lt;i&gt;X&lt;/i&gt;'));
  assert.ok(!h.includes('1&nbsp;234,56') && !h.includes('1 234,56') && !/CNC/.test(h));
  const o = offerOf(3);
  assert.match(h, /Razem netto<\/span><span>600,00&nbsp;zł/);
  assert.match(h, /VAT 23%<\/span><span>138,00&nbsp;zł/);
  assert.match(h, new RegExp(`<div class="amount display">${'738,00'}&nbsp;zł`));
  assert.equal(o.totals.gross, 738);
});

test(`≤ ${MAX_P1_LINES} lines on sheet 1 (with detail and quantity); more → one line „strona 2” and the table there`, () => {
  const few = html({}, MAX_P1_LINES);
  assert.equal((page(few, 1).match(/<div class="line">/g) || []).length, MAX_P1_LINES);
  assert.match(page(few, 1), /Pozycja 1<span class="detail">w tym: stopnie, wangi<\/span>/);
  assert.match(page(few, 1), /Pozycja 2<span class="detail">2 szt\.<\/span>/);
  assert.doesNotMatch(few, /Szczegółowa wycena/);
  const many = html({}, 12);
  assert.equal((page(many, 1).match(/<div class="line">/g) || []).length, 0);
  assert.match(page(many, 1), /<div class="more">Szczegółowa wycena \(12 pozycji\) — strona 2<\/div>/);
  assert.match(page(many, 2), /<h2>Szczegółowa wycena<\/h2><table><tr><th>Lp\.<\/th><th>Pozycja<\/th><th class="num-r">Ilość<\/th><th class="num-r">Cena netto<\/th><th class="num-r">Wartość netto<\/th>/);
  assert.equal((page(many, 2).match(/<tr><td>\d+<\/td>/g) || []).length, 12);
  // the sums and the gross always on sheet 1
  assert.match(page(many, 1), /Razem brutto/);
});

test('the notes: only when given; long ones (> 280 characters or > 4 lines) on sheet 2', () => {
  assert.doesNotMatch(html({ notes: '' }), /Istotne uwagi/);
  const short = html({ notes: 'Płatność 50% zaliczki.' });
  assert.match(page(short, 1), /<b>Istotne uwagi<\/b><p>Płatność 50% zaliczki\.<\/p>/);
  const long = html({ notes: 'x'.repeat(300) });
  assert.match(page(long, 1), /Istotne uwagi — strona 2/);
  assert.match(page(long, 2), /<h2>Istotne uwagi<\/h2><p class="notes2">x{300}<\/p>/);
  const lines = html({ notes: 'a\nb\nc\nd\ne' });
  assert.match(page(lines, 1), /Istotne uwagi — strona 2/);
});

test('the delivery and installation wording; the eyebrow; the default title; a long title smaller', () => {
  assert.match(html(), /<div class="label">z dostawą i montażem<\/div>/, 'facts say: installation');
  assert.match(html(), /Ceny zawierają koszt dostawy na miejsce\./);
  assert.match(html({ deliveryIncluded: false }), /<div class="label">z montażem<\/div>/);
  assert.doesNotMatch(html({ deliveryIncluded: false }), /Ceny zawierają koszt dostawy/);
  const noInstall = { ...facts, rows: facts.rows.filter(([k]) => k !== 'Montaż') };
  const h = buildModernOfferHTML({ offer: offerOf(2), facts: noInstall, settings: settings(), company, date: new Date(2026, 10, 6) });
  assert.match(h, /<div class="label">z dostawą<\/div>/);
  assert.match(h, /<div class="eyebrow">Schody drewniane<\/div>/);
  assert.match(html(), /<div class="eyebrow">Schody drewniane z montażem<\/div>/);
  assert.match(html(), /<h1 class="display">Schody — Dąb, Klasa Natura<\/h1>/, 'the default title: „Schody” + the material');
  assert.match(html({ offerTitle: 'Schody dębowe', offerSubtitle: 'podstopnie czarny MDF' }), /<h1 class="display">Schody dębowe <span class="sub">podstopnie czarny MDF<\/span>/);
  assert.match(html({ offerTitle: 'Schody dębowe kl. AB, klasyczne z noskiem i podstopniami ze sklejki szczotkowanej' }), /<h1 class="display long">/);
  // the concrete module's facts: its own default title
  const concrete = { rows: [['Rodzaj', 'Okładziny drewniane na biegu betonowym'], ['Materiał', 'Dąb, Klasa Natura']], comfort: [] };
  assert.match(buildModernOfferHTML({ offer: offerOf(1), facts: concrete, settings: settings(), company, date: new Date(2026, 10, 6) }), /Okładziny schodów betonowych — Dąb, Klasa Natura/);
});

test('sheet 1\'s specification: the facts but „Montaż”, at most 7; sheet 2: the parameters, the plan, the comfort', () => {
  const p1 = page(html(), 1);
  const spec = p1.split('<div class="spec">')[1].split('<div class="lines">')[0];
  assert.equal((spec.match(/<div>/g) || []).length, 4);
  assert.doesNotMatch(spec, /Montaż/);
  const many = { ...facts, rows: Array.from({ length: 12 }, (_, i) => [`Pozycja ${i}`, 'x'.repeat(i + 1)]) };
  const p1b = page(buildModernOfferHTML({ offer: offerOf(1), facts: many, settings: settings(), company, date: new Date(2026, 10, 6) }), 1);
  assert.equal((p1b.split('<div class="spec">')[1].split('<div class="lines">')[0].match(/<div>/g) || []).length, 7);
  const p2 = page(html({}, 3, { planSvg: '<svg id="plan"></svg>' }), 2);
  assert.match(p2, /<h2>Rzut z góry<\/h2><figure class="plan"><svg id="plan"><\/svg>/);
  assert.match(p2, /<div><dt>Montaż<\/dt><dd>tak<\/dd><\/div>/, 'the full parameters there');
  assert.match(p2, /<span class="bad">poza zakresem<\/span>/);
  assert.doesNotMatch(page(html({ showComfort: false }), 2), /Wygoda/);
});

test('no logo → the company\'s name in the hero; no 3D picture → the plain panel', () => {
  const h = html();
  assert.match(page(h, 1), /<div class="hero"><div class="brand">Drewex sp\.j\.<\/div><\/div>/);
  const withPics = html({}, 3, { logoDataUrl: 'data:image/png;base64,AAA', image3d: 'data:image/jpeg;base64,BBB' });
  assert.match(page(withPics, 1), /<img class="logo" src="data:image\/png;base64,AAA"[^>]*><img class="render" src="data:image\/jpeg;base64,BBB"/);
  assert.match(page(withPics, 1), /Wizualizacja poglądowa/);
});

test('sanitize: an older project gets the classic style and the defaults; company data without the handler works', () => {
  const s = sanitizeOfferSettings({ offerNumber: 'A' });
  assert.equal(s.offerStyle, 'classic');
  assert.equal(s.leadTime, '3–5 tygodni');
  assert.equal(s.leadTimeNote, 'gotowe schody na miejscu');
  assert.equal(s.deliveryIncluded, true);
  assert.equal(sanitizeOfferSettings({ offerStyle: 'fancy' }).offerStyle, 'classic');
  assert.equal(sanitizeOfferSettings({ offerStyle: 'modern', deliveryIncluded: false, leadTime: '2 tygodnie' }).leadTime, '2 tygodnie');
  const c = sanitizeCladdingOffer({});
  assert.deepEqual([c.offerStyle, c.leadTime, c.deliveryIncluded, c.offerTitle], ['classic', '3–5 tygodni', true, '']);
  assert.equal(createDefaultCladdingOffer().offerStyle, 'classic');
  assert.equal(sanitizeCladdingOffer({ offerStyle: 'modern' }).offerStyle, 'modern');
  const co = sanitizeCompany({ name: 'X' });
  assert.equal(co.contactName, undefined);
  assert.match(buildModernOfferHTML({ offer: offerOf(1), facts, settings: settings(), company: co, date: new Date(2026, 10, 6) }), /<div class="people"><div><span>Klient<\/span>/);
  assert.equal(sanitizeCompany({ name: 'X', contactName: 'Anna', hours: 'pn' }).contactName, 'Anna');
});

// measured 2026-11-06: the default concrete title (3 lines) + 7 facts + the client + notes + 4 lines spilled by 8 mm —
// sheet 1's height budget moves what does not fit (notes → shorter specification → the lines) and brings back what fits
test('sheet 1\'s budget: what does not fit goes to sheet 2, what fits again after that comes back', async () => {
  const { planPage1, page1Height } = await import('../offerDocumentModern.js');
  const spec = Array.from({ length: 7 }, (_, i) => `Parametr ${i}: wartość ${i}`);
  const lines = (n) => Array.from({ length: n }, (_, i) => ({ label: `Pozycja numer ${i + 1} — stopnie zabiegowe i proste`, detail: 'w tym: stopnie, podstopnice, noski, listwy przyścienne, fajki' }));
  const base = { titleText: 'Schody dębowe kl. AB, klasyczne z noskiem', peopleRows: 3, spec, notes: 'Płatność: 50% zaliczki, reszta po montażu.', leadTime: '3–5 tygodni' };
  // three short lines: everything stays
  const short = [1, 2, 3].map(() => ({ label: 'Schody — komplet', detail: '' }));
  const few = planPage1({ ...base, lines: short });
  assert.deepEqual([few.linesOnP1, few.notesOnP1, few.spec.length], [true, true, 7]);
  // six two-line lines with details do not fit: they go, the notes and the full specification come back
  const many = planPage1({ ...base, lines: lines(6) });
  assert.equal(many.linesOnP1, false);
  assert.equal(many.spec.length, 7, 'the specification back');
  assert.equal(many.notesOnP1, true, 'the notes back');
  // whatever it decides fits the sheet (the CSS less the safety margin)
  for (const [p, ls] of [[few, short], [many, lines(6)]]) assert.ok(page1Height({ ...base, long: p.long, spec: p.spec, lines: ls, linesOnP1: p.linesOnP1, notesOnP1: p.notesOnP1 }) <= 297 - 21 - 18 - 5);
  // a title over two lines is set one size smaller
  assert.equal(planPage1({ ...base, titleText: 'Okładziny schodów betonowych — Dąb, Klasa Natura', lines: [] }).long, true);
});

// ---- stage 2 (2026-11-06): the contact QR beside „Dostawa”, switched on in the offer's settings
test('the contact QR: off by default, on → beside „Dostawa” with the handler\'s vCard; none without a phone / e-mail', async () => {
  const { contactCardText } = await import('../contactCard.js');
  assert.equal(createDefaultOfferSettings().showContactQr, false);
  assert.equal(sanitizeOfferSettings({ showContactQr: true }).showContactQr, true);
  assert.equal(createDefaultCladdingOffer().showContactQr, false);
  assert.equal(sanitizeCladdingOffer({ showContactQr: true }).showContactQr, true);
  assert.doesNotMatch(html(), /class="qr"/);
  const p1 = page(html({ showContactQr: true }), 1);
  assert.match(p1, /<div class="facts with-qr">.*Dostawa.*<div class="qr"><div class="label">Zapisz kontakt<\/div><svg [^>]*viewBox/s);
  const card = contactCardText(company).text;
  assert.equal(card, ['BEGIN:VCARD', 'VERSION:3.0', 'N:Nowak;Anna;;;', 'FN:Anna Nowak', 'ORG:Drewex sp.j.', 'TEL:501000000', 'TEL:+48227866298', 'EMAIL:anna@drewex.net.pl', 'URL:www.drewex.net.pl', 'ADR:;;ul. Wawrzyna 2;;;;', 'END:VCARD'].join('\r\n'));
  // the company alone (no handler): its name is the contact; its own phone / e-mail
  assert.ok(contactCardText({ name: 'Drewex', phone: '22 786', email: 'a@b.pl' }).text.includes('N:;;;;\r\nFN:Drewex\r\nORG:Drewex\r\nTEL:22786\r\nEMAIL:a@b.pl'));
  // nothing to call or write to → no code
  assert.equal(contactCardText({ name: 'Drewex' }), null);
  assert.doesNotMatch(buildModernOfferHTML({ offer: offerOf(2), facts, settings: settings({ showContactQr: true }), company: { name: 'Drewex' } }), /class="qr"/);
  // too long for a version-10 code → the vCard without the address, then MECARD (no address, then no www)
  const long = { ...company, address: 'ul. Bardzo Długa Nazwa Ulicy Przy Której Stoi Zakład Stolarski 123/45, 05-123 Wólka Kosowska' };
  assert.deepEqual([contactCardText(long).format, contactCardText(long).dropped], ['vcard', ['adres']]);
  const longer = { ...long, name: 'Przedsiębiorstwo Produkcyjno-Handlowo-Usługowe Drewex spółka jawna', contactName: 'Anna Maria Nowak-Kowalska', contactEmail: 'anna.maria.nowak-kowalska@drewex.net.pl' };
  const r = contactCardText(longer);
  assert.equal(r.format, 'mecard');
  assert.ok(r.text.startsWith('MECARD:N:Nowak-Kowalska,Anna Maria;ORG:Przedsiębiorstwo Produkcyjno-Handlowo-Usługowe Drewex spółka jawna;TEL:501000000;TEL:+48227866298;EMAIL:anna.maria.nowak-kowalska@drewex.net.pl;'), r.text);
  for (const c of [company, long, longer]) assert.ok(qrVersionForCard(contactCardText(c).text), 'every card fits a code');
  // escaping: vCard \; \, — MECARD the same per part (the N separator itself not)
  assert.ok(contactCardText({ name: 'A; B, C', phone: '1' }).text.includes('ORG:A\\; B\\, C'));
});

test('sheet 1\'s budget counts the QR\'s column (taller than the lead time / delivery)', async () => {
  const { page1Height } = await import('../offerDocumentModern.js');
  const base = { titleText: 'Schody', long: false, peopleRows: 3, spec: ['a'], lines: [], linesOnP1: true, notes: '', notesOnP1: false, leadTime: '3–5 tygodni' };
  assert.ok(page1Height({ ...base, qr: true }) > page1Height(base) + 7);
});

test('texts for an offer made by hand: the caption, eyebrow, delivery note, closing note, sheet 2 off — absent = as before', () => {
  const before = html({}, 3, { image3d: 'data:image/jpeg;base64,AA' });
  assert.match(before, /<span class="caption">Wizualizacja poglądowa<\/span>/);
  assert.match(before, /<div class="eyebrow">Schody drewniane z montażem<\/div>/);
  assert.match(before, /Wycena po pomiarach i ocenie wykonawcy\./);
  assert.match(before, /Cena materiału obejmuje jego przygotowanie/);
  const own = html({ heroCaption: 'Zdjęcie realizacji', offerEyebrow: 'Schody dywanowe', deliveryNote: '', closingNote: 'Dziękujemy.' }, 3, { image3d: 'data:image/jpeg;base64,AA' });
  assert.match(own, /<span class="caption">Zdjęcie realizacji<\/span>/);
  assert.match(own, /<div class="eyebrow">Schody dywanowe<\/div>/);
  assert.doesNotMatch(own, /Wycena po pomiarach/);
  assert.match(own, /Dziękujemy\./);
  assert.doesNotMatch(html({ heroCaption: '' }, 3, { image3d: 'data:image/jpeg;base64,AA' }), /class="caption"/);
  // sheet 2 off: one sheet only — unless the lines / long notes moved there (then only those)
  const one = html({ technicalSheet: false });
  assert.equal(one.split('<section class="sheet').length - 1, 1);
  const moved = html({ technicalSheet: false }, 12);
  assert.equal(moved.split('<section class="sheet').length - 1, 2);
  assert.match(page(moved, 2), /Szczegółowa wycena/);
  assert.doesNotMatch(page(moved, 2), /Parametry schodów|Rzut z góry|Wygoda/);
});

test('heroFull: the picture over the hero\'s whole height (the box as before when absent)', async () => {
  const { HERO_FULL_MM } = await import('../offerDocumentModern.js');
  assert.deepEqual({ ...HERO_FULL_MM }, { width: 84, height: 276 });
  const img = { image3d: 'data:image/jpeg;base64,AA' };
  assert.match(html({}, 3, img), /<img class="render" src=/);
  assert.match(html({ heroFull: true }, 3, img), /<img class="render full" src=/);
  assert.match(html({}, 3, img), /\.hero \.render\.full \{ top: 0; transform: none; height: 100%; \}/);
});
