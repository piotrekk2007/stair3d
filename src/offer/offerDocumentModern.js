// OFFER DOCUMENT, MODERN STYLE (user decisions 2026-11-06 — the design docs/design/oferta-nowoczesna-wzor.html, carried
// over 1:1): two A4 sheets printed by the browser's print-to-PDF like the classic one (offerDocument.js, unchanged).
//  * sheet 1 — FIXED A4 (nothing may spill out of it): on the left the 3D render in a portrait box (84 × 150 mm) on the
//    studio background, the logo over it; on the right the number, the date, „Ważna do”, the client and the offer's
//    handler, the title, a short specification, the lines (≤ MAX_P1_LINES — else one line „Szczegółowa wycena (N
//    pozycji) — strona 2”), the totals, the gross amount, the notes (long ones go to sheet 2), the lead time and the
//    delivery;
//  * sheet 2 — grows with its content: the detailed price table (when the lines moved there), the notes (when moved),
//    the plan, the stair's parameters, the comfort table.
// The SAME input as buildOfferHTML (offer, facts, settings, company, logoDataUrl, image3d, planSvg, projectName, date)
// — used by both modules (the concrete module's facts come from cladding/quote/claddingOffer.js). Pure: a string out;
// every text through escapeHtml. Never shows the CNC + projekt amount (it is inside the material lines).
// Stage 2 (2026-11-06): `settings.showContactQr` — a QR code with the company's / handler's contact (contactCard.js,
// util/qrCode.js) beside „Dostawa”. Optional texts for an offer made by hand (each absent = the text below; '' = none):
// `heroCaption`, `offerEyebrow`, `deliveryNote`, `closingNote`; `technicalSheet: false` = no plan / parameters / comfort
// (sheet 2 then only when the lines or the notes moved there); `heroFull: true` = the picture over the hero's whole
// height (HERO_FULL_MM) instead of the 84 × 150 mm box.

import { escapeHtml as esc } from '../util/format.js';
import { money } from './offerDocument.js';
import { contactCardText } from './contactCard.js';
import { qrSvg } from '../util/qrCode.js';

/** At most this many lines on sheet 1; more → one line pointing to sheet 2 and the full table there. */
export const MAX_P1_LINES = 6;
const NOTES_P1_MAX_CHARS = 280;
const NOTES_P1_MAX_LINES = 4;
const LONG_TITLE_CHARS = 60;
const SPEC_MAX_LINES = 7;
/** The hero box's background — the 3D render is made on exactly this colour (it melts into the box). */
export const HERO_BACKGROUND = '#ECECEB';
/** The hero render's box (mm) — render the 3D picture at this ratio. */
export const HERO_BOX_MM = Object.freeze({ width: 84, height: 150 });
/** `settings.heroFull`: the picture over the hero's whole height (the sheet less the footer) — render it at this ratio. */
export const HERO_FULL_MM = Object.freeze({ width: 84, height: 297 - 21 });
/** The contact QR's side (mm, its quiet zone of 2 modules included). */
export const QR_MM = 24;
const QR_QUIET = 2;
const textOr = (v, fallback) => (typeof v === 'string' ? v.trim() : fallback);

const qtyFmt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
const dateFmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const nb = (s) => esc(s).replace(/ /g, '&nbsp;');

const CSS = `
  @page { size: A4; margin: 0; }
  :root {
    --ink: #141414; --muted: #5E5F61; --line: #D8D9DB; --surface: #F2F2F2;
    --brand: #2B2A29; --accent: #97BB3D; --on-dark-muted: #C4C4C2; --warn: #B3261E;
    --display: "Inter Tight", Inter, "Segoe UI", Arial, sans-serif;
    --text: Inter, "Segoe UI", Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; }
  body { font-family: var(--text); color: var(--ink); font-size: 9pt; line-height: 1.45;
         font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 210mm; height: 297mm; display: flex; flex-direction: column; overflow: hidden; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .sheet.flow { height: auto; min-height: 296mm; overflow: visible; }
  .muted { color: var(--muted); }
  .display { font-family: var(--display); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }

  .p1 { flex: 1; display: flex; min-height: 0; }
  .hero { width: 84mm; flex-shrink: 0; position: relative; background: ${HERO_BACKGROUND}; overflow: hidden; }
  .hero .logo { position: absolute; left: 8.5mm; top: 10.5mm; width: 53mm; height: auto; z-index: 1; }
  .hero .brand { position: absolute; left: 8.5mm; top: 10.5mm; right: 8.5mm; z-index: 1; background: var(--brand); color: #fff; font-family: var(--display); font-weight: 600; font-size: 13pt; padding: 2mm 3mm; border-radius: 1mm; }
  .hero .render { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); width: 84mm; height: 150mm; object-fit: cover; display: block; }
  .hero .render.full { top: 0; transform: none; height: 100%; }
  .hero .caption { position: absolute; left: 8.5mm; bottom: 5.5mm; font-size: 9pt; color: #fff; background: var(--brand); padding: 0.8mm 2.2mm; border-radius: 1mm; }
  .main { flex: 1; min-width: 0; padding: 10.5mm 11.5mm 7.5mm; display: flex; flex-direction: column; overflow: hidden; }

  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 4mm; }
  .num-label, .label { font-size: 9pt; color: var(--muted); }
  .num { font-size: 21pt; margin-top: 1mm; }
  .valid { text-align: right; }
  .valid strong { display: inline-block; font-size: 11pt; font-weight: 600; margin-top: 1mm; padding-bottom: 0.8mm; border-bottom: 0.8mm solid var(--accent); }

  .people { margin-top: 4.8mm; padding-top: 3.2mm; border-top: 0.26mm solid var(--line); display: grid; grid-template-columns: 1fr 1fr; column-gap: 5mm; color: var(--muted); }
  .people b { display: block; color: var(--ink); font-weight: 500; }

  .eyebrow { margin-top: 6.8mm; font-size: 9.75pt; font-weight: 500; color: var(--muted); }
  h1 { margin: 2mm 0 0; font-size: 22.5pt; text-wrap: balance; }
  h1.long { font-size: 18pt; }
  h1 .sub { font-weight: 400; color: var(--muted); }
  .spec { margin-top: 3.7mm; color: var(--muted); }
  .spec div { line-height: 1.45; }

  .lines { margin-top: 5.8mm; border-top: 0.26mm solid var(--ink); }
  .line { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; padding: 2.4mm 0; border-bottom: 0.26mm solid var(--line); }
  .line .name { font-size: 10.5pt; font-weight: 500; }
  .line .detail { display: block; font-size: 9pt; color: var(--muted); font-weight: 400; }
  .line .net { font-size: 10.5pt; white-space: nowrap; }
  .more { padding: 2.4mm 0; border-bottom: 0.26mm solid var(--line); color: var(--muted); }
  .sum { display: flex; justify-content: space-between; color: var(--muted); margin-top: 1mm; }
  .sum:first-of-type { margin-top: 2.4mm; }

  .gross { margin-top: 3.7mm; background: var(--brand); color: #fff; border-radius: 1.6mm; padding: 3.7mm 4.8mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 4mm; }
  .gross .label { color: var(--on-dark-muted); }
  .gross .amount { font-size: 24pt; line-height: 1; white-space: nowrap; }

  .notes { margin-top: 3.2mm; border: 0.26mm solid var(--line); border-radius: 1.6mm; padding: 2.6mm 3.7mm; }
  .notes b { display: block; font-weight: 600; margin-bottom: 0.6mm; }
  .notes p { margin: 0; color: var(--muted); white-space: pre-wrap; }

  .facts { margin-top: auto; padding-top: 4mm; display: grid; grid-template-columns: 1fr 1.25fr; column-gap: 6mm; }
  .facts .big { font-family: var(--display); font-size: 15pt; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; }
  .facts .strong { font-size: 9.75pt; font-weight: 500; }
  .facts.with-qr { grid-template-columns: 1fr 1.25fr ${QR_MM}mm; column-gap: 4mm; }
  .facts .qr .label { margin-left: 1mm; }
  .facts .qr svg { width: ${QR_MM}mm; height: ${QR_MM}mm; display: block; }

  footer { height: 21mm; flex-shrink: 0; background: var(--brand); color: #fff; padding: 0 11.5mm 0 8.5mm; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 6mm; align-items: center; font-size: 9pt; line-height: 1.45; }
  footer span { display: block; }
  footer .dim { color: var(--on-dark-muted); }
  footer .www { color: var(--accent); font-weight: 600; }
  footer .right { text-align: right; }

  .p2 { flex: 1; min-height: 0; padding: 10.5mm 11.5mm 8mm; display: flex; flex-direction: column; }
  .p2-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 3mm; border-bottom: 0.26mm solid var(--ink); }
  .p2-head img { height: 7mm; width: auto; display: block; }
  .p2-head .name { font-family: var(--display); font-weight: 600; font-size: 11pt; }
  .p2-head .t { text-align: right; color: var(--muted); }
  .p2-head .t b { color: var(--ink); font-weight: 600; }
  h2 { font-family: var(--display); font-size: 13.5pt; font-weight: 600; letter-spacing: -0.01em; margin: 7mm 0 2.6mm; break-after: avoid; }
  .plan { margin: 0; background: var(--surface); border-radius: 1.6mm; padding: 4mm; break-inside: avoid; }
  .plan svg, .plan img { width: 100%; height: 90mm; display: block; }
  .plan figcaption { margin-top: 2mm; color: var(--muted); }
  .params { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; margin: 0; }
  .params div { display: flex; justify-content: space-between; gap: 4mm; padding: 1.8mm 0; border-bottom: 0.26mm solid var(--line); }
  .params dt, .params dd { margin: 0; }
  .params dt { color: var(--muted); }
  .params dd { text-align: right; font-weight: 500; }
  .notes2 { margin: 0; color: var(--muted); white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; }
  tr { break-inside: avoid; }
  th { text-align: left; font-weight: 400; color: var(--muted); padding: 0 0 1.8mm; border-bottom: 0.26mm solid var(--ink); }
  td { padding: 1.8mm 0; border-bottom: 0.26mm solid var(--line); vertical-align: top; }
  td + td, th + th { padding-left: 3mm; }
  td.src { color: var(--muted); }
  .num-r { text-align: right; white-space: nowrap; }
  .detail2 { display: block; color: var(--muted); }
  .ok, .bad { white-space: nowrap; font-weight: 500; }
  .ok::before, .bad::before { content: ""; display: inline-block; width: 2mm; height: 2mm; border-radius: 50%; margin-right: 1.5mm; vertical-align: 0.1mm; }
  .ok::before { background: var(--accent); }
  .bad { color: var(--warn); }
  .bad::before { background: var(--warn); }
`;

/** Is the offer's installation in it (a line „Montaż…”, or the concrete module's facts saying so)? */
function hasInstallation(offer, facts) {
  return offer.lines.some((l) => l.kind === 'installation' || /montaż/i.test(l.label || '')) || (facts.rows || []).some(([k, v]) => k === 'Montaż' && /^tak/i.test(String(v)));
}

const factValue = (facts, ...keys) => (facts.rows || []).find(([k]) => keys.includes(k))?.[1] || '';

/** The default title when the seller left it empty: from the module and the material. */
function defaultTitle(facts) {
  const concrete = /betonow/i.test(factValue(facts, 'Rodzaj'));
  const material = factValue(facts, 'Drewno', 'Materiał');
  const base = concrete ? 'Okładziny schodów betonowych' : 'Schody';
  return material && material !== '—' ? `${base} — ${material}` : base;
}

/** Up to SPEC_MAX_LINES of the stair's facts (not „Montaż”): the shortest ones when there are more, in their order. */
function specLines(facts) {
  const rows = (facts.rows || []).filter(([k]) => k !== 'Montaż').map(([k, v], i) => ({ i, text: `${k}: ${v}` }));
  if (rows.length <= SPEC_MAX_LINES) return rows.map((r) => r.text);
  const keep = new Set([...rows].sort((a, b) => a.text.length - b.text.length).slice(0, SPEC_MAX_LINES).map((r) => r.i));
  return rows.filter((r) => keep.has(r.i)).map((r) => r.text);
}

const notesGoToP2 = (notes) => notes.length > NOTES_P1_MAX_CHARS || notes.split('\n').length > NOTES_P1_MAX_LINES;

// --- sheet 1's height budget (mm) — sheet 1 is a FIXED A4, nothing may spill out of it (measured in the browser
// 2026-11-06: the default concrete title wraps to 3 lines, so 4 lines + 7 facts + notes already overflowed by 8 mm —
// a fixed MAX_P1_LINES alone cannot keep it on the sheet). The estimate follows the CSS below: the text lines from
// the characters per line at each size (Inter, measured widths rounded down), the blocks' paddings and margins.
const MAIN_HEIGHT_MM = 297 - 21 - 10.5 - 7.5; // the sheet less the footer and .main's paddings
const SAFETY_MM = 5;
const LINE_MM = { text: 4.6, name: 5.4, title: 8.7, titleLong: 7.0 };
const CHARS = { spec: 58, name: 36, detail: 44, notes: 54, title: 22, titleLong: 28, people: 30 };
const wrapped = (text, perLine) => String(text || '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);

export function page1Height({ titleText, long, peopleRows, spec, lines, linesOnP1, notes, notesOnP1, leadTime, qr = false }) {
  let h = 19; // number, its label, the date
  if (peopleRows) h += 8 + (peopleRows + 1) * LINE_MM.text;
  h += 6.8 + 4.9; // the eyebrow
  h += 2 + wrapped(titleText, long ? CHARS.titleLong : CHARS.title) * (long ? LINE_MM.titleLong : LINE_MM.title);
  if (spec.length) h += 3.7 + spec.reduce((n, t) => n + wrapped(t, CHARS.spec), 0) * LINE_MM.text;
  h += 5.8; // the lines' top rule
  if (linesOnP1) for (const l of lines) h += 4.8 + wrapped(l.label, CHARS.name) * LINE_MM.name + (l.detail ? wrapped(l.detail, CHARS.detail) * LINE_MM.text : 0);
  else h += 4.8 + LINE_MM.text;
  h += 2.4 + 1 + 2 * LINE_MM.text; // the sums
  h += 3.7 + 7.4 + 2 * LINE_MM.text; // the gross amount
  if (notes) h += 3.2 + 5.2 + LINE_MM.text + (notesOnP1 ? wrapped(notes, CHARS.notes) * LINE_MM.text : 0);
  // the lead time / delivery (its tallest column; the QR's column is taller than either)
  h += 4 + Math.max(LINE_MM.text + (leadTime ? 6.4 : 0) + 2 * LINE_MM.text, qr ? LINE_MM.text + QR_MM : 0);
  return h;
}

/**
 * What sheet 1 carries so it fits: the lines (≤ MAX_P1_LINES), the notes (short ones), the specification (≤ 7 lines)
 * — when the estimate says it would spill, the notes go to sheet 2 first, then the specification shortens (to 4
 * lines), then the lines go to sheet 2 (and what was taken off comes back where it fits again). A title over 2 lines
 * (or > LONG_TITLE_CHARS) is set one size smaller.
 */
export function planPage1({ titleText, peopleRows, spec, lines, notes, leadTime, qr = false }) {
  const long = titleText.length > LONG_TITLE_CHARS || wrapped(titleText, CHARS.title) > 2;
  const plan = { long, linesOnP1: lines.length <= MAX_P1_LINES, notesOnP1: !!notes && !notesGoToP2(notes), spec: [...spec] };
  const fits = () => page1Height({ titleText, long, peopleRows, spec: plan.spec, lines, linesOnP1: plan.linesOnP1, notes, notesOnP1: plan.notesOnP1, leadTime, qr }) + SAFETY_MM <= MAIN_HEIGHT_MM;
  if (!fits() && plan.notesOnP1) plan.notesOnP1 = false;
  while (!fits() && plan.spec.length > 4) plan.spec.pop();
  if (!fits() && plan.linesOnP1) {
    // the lines to sheet 2 free a lot: the specification and the short notes come back where they fit again
    plan.linesOnP1 = false;
    while (plan.spec.length < spec.length) {
      plan.spec.push(spec[plan.spec.length]);
      if (!fits()) {
        plan.spec.pop();
        break;
      }
    }
    if (notes && !notesGoToP2(notes) && !plan.notesOnP1) {
      plan.notesOnP1 = true;
      if (!fits()) plan.notesOnP1 = false;
    }
  }
  return plan;
}

function footerHTML(company) {
  const c = company || {};
  const col1 = [c.name ? `<span style="font-weight:600">${esc(c.name)}</span>` : '', c.address ? `<span class="dim">${esc(c.address)}</span>` : '', c.nip ? `<span class="dim">NIP ${esc(c.nip)}</span>` : ''].join('');
  const col2 = [c.phone ? `<span>${esc(c.phone)}</span>` : '', c.email ? `<span>${esc(c.email)}</span>` : '', c.www ? `<span class="www">${esc(c.www)}</span>` : ''].join('');
  const hours = String(c.hours || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const col3 = hours.length ? `<span style="font-weight:600">Godziny otwarcia</span>${hours.map((h) => `<span class="dim">${esc(h)}</span>`).join('')}` : '';
  return `<footer><div>${col1}</div><div>${col2}</div><div class="right">${col3}</div></footer>`;
}

const lineDetail = (l) => [l.detail, l.qty != null ? `${qtyFmt.format(l.qty)} ${l.unit || ''}`.trim() : ''].filter(Boolean).join(' · ');

/**
 * @param {{offer: {lines: Array<{label, detail?, qty?, unit?, unitNet?, net, kind?}>, totals: {net, vat, gross, vatRatePct}},
 *   facts: {rows: Array<[string, string]>, comfort: Array<{label, value, requirement, ok, source}>}, settings: Object,
 *   company?: Object, logoDataUrl?: string|null, image3d?: string|null, planSvg?: string|null, projectName?: string,
 *   date?: Date}} input
 * @returns {string} a complete HTML document (two sheets)
 */
export function buildModernOfferHTML({ offer, facts, settings, company = {}, logoDataUrl = null, image3d = null, planSvg = null, projectName = '', date = new Date() }) {
  const s = settings || {};
  const c = company || {};
  // calendar days (not 24 h steps — a DST change would move the date by a day), as the classic offer
  const valid = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (s.validityDays || 30));
  const client = s.client || {};
  const number = s.offerNumber ? esc(s.offerNumber) : '';
  const install = hasInstallation(offer, facts);
  const delivery = s.deliveryIncluded !== false;
  const title = (s.offerTitle || '').trim() || defaultTitle(facts);
  const subtitle = (s.offerSubtitle || '').trim();
  const notes = String(s.notes || '').trim();
  const clientRows = [client.name, client.address, client.phone, client.email].filter(Boolean).length;
  const handlerRows = [c.contactName, c.contactPhone, c.contactEmail].filter(Boolean).length;
  const card = s.showContactQr ? contactCardText(c) : null;
  const qr = card ? qrSvg(card.text, { quiet: QR_QUIET, color: '#141414' }) : null;
  const plan = planPage1({ titleText: `${title}${subtitle ? ` ${subtitle}` : ''}`, peopleRows: Math.max(clientRows, handlerRows), spec: specLines(facts), lines: offer.lines.map((l) => ({ label: l.label, detail: lineDetail(l) })), notes, leadTime: (s.leadTime || '').trim(), qr: !!qr });
  const notesP2 = !!notes && !plan.notesOnP1;
  const linesP2 = !plan.linesOnP1;

  const heroCaption = textOr(s.heroCaption, 'Wizualizacja poglądowa');
  const eyebrow = textOr(s.offerEyebrow, '') || (install ? 'Schody drewniane z montażem' : 'Schody drewniane');
  const deliveryNote = textOr(s.deliveryNote, 'Wycena po pomiarach i ocenie wykonawcy.');
  const closingNote = textOr(s.closingNote, 'Cena materiału obejmuje jego przygotowanie (projekt i obróbkę).');
  const technical = s.technicalSheet !== false;

  // --- sheet 1
  const hero = `<div class="hero">${logoDataUrl ? `<img class="logo" src="${esc(logoDataUrl)}" alt="logo">` : c.name ? `<div class="brand">${esc(c.name)}</div>` : ''}${image3d ? `<img class="render${s.heroFull ? ' full' : ''}" src="${esc(image3d)}" alt="wizualizacja">` : ''}${image3d && heroCaption ? `<span class="caption">${esc(heroCaption)}</span>` : ''}</div>`;
  const clientBlock = [client.name ? `<b>${esc(client.name)}</b>` : '', client.address ? `${esc(client.address)}<br>` : '', client.phone ? `tel. ${esc(client.phone)}<br>` : '', client.email ? esc(client.email) : ''].join('');
  const handlerBlock = [c.contactName ? `<b>${esc(c.contactName)}</b>` : '', c.contactPhone ? `tel. ${esc(c.contactPhone)}<br>` : '', c.contactEmail ? esc(c.contactEmail) : ''].join('');
  const people = clientBlock || handlerBlock ? `<div class="people"><div>${clientBlock ? `<span>Klient</span>${clientBlock}` : ''}</div><div>${handlerBlock ? `<span>Opiekun oferty</span>${handlerBlock}` : ''}</div></div>` : '';
  const lines1 = linesP2
    ? `<div class="more">Szczegółowa wycena (${offer.lines.length} pozycji) — strona 2</div>`
    : offer.lines.map((l) => `<div class="line"><span class="name">${esc(l.label)}${lineDetail(l) ? `<span class="detail">${esc(lineDetail(l))}</span>` : ''}</span><span class="net">${nb(money(l.net))}</span></div>`).join('');
  const grossNote = delivery && install ? 'z dostawą i montażem' : delivery ? 'z dostawą' : install ? 'z montażem' : '';
  const notesP1 = !notes ? '' : notesP2 ? '<div class="notes"><b>Istotne uwagi — strona 2</b></div>' : `<div class="notes"><b>Istotne uwagi</b><p>${esc(notes)}</p></div>`;
  const leadTime = (s.leadTime || '').trim();
  const qrCol = qr ? `<div class="qr"><div class="label">Zapisz kontakt</div>${qr}</div>` : '';
  const facts1 = `<div class="facts${qr ? ' with-qr' : ''}"><div>${leadTime ? `<div class="label">Termin realizacji</div><div class="big">${esc(leadTime)}</div>${s.leadTimeNote ? `<div class="muted">${esc(s.leadTimeNote)}</div>` : ''}` : ''}</div><div><div class="label">Dostawa</div>${delivery ? '<div class="strong">Ceny zawierają koszt dostawy na miejsce.</div>' : ''}${deliveryNote ? `<div class="muted">${esc(deliveryNote)}</div>` : ''}</div>${qrCol}</div>`;
  const sheet1 = `<section class="sheet"><div class="p1">${hero}<div class="main">
    <div class="top"><div><div class="num-label">${number ? 'Oferta nr' : ''}</div><div class="num display">${number || 'Oferta'}</div><div class="muted" style="margin-top:1mm">z dnia ${dateFmt(date)}</div></div>
      <div class="valid"><div class="label">Ważna do</div><strong>${dateFmt(valid)}</strong></div></div>
    ${people}
    <div class="eyebrow">${esc(eyebrow)}</div>
    <h1 class="display${plan.long ? ' long' : ''}">${esc(title)}${subtitle ? ` <span class="sub">${esc(subtitle)}</span>` : ''}</h1>
    <div class="spec">${plan.spec.map((t) => `<div>${esc(t)}</div>`).join('')}</div>
    <div class="lines">${lines1}</div>
    <div class="sum"><span>Razem netto</span><span>${nb(money(offer.totals.net))}</span></div>
    <div class="sum"><span>VAT ${offer.totals.vatRatePct}%</span><span>${nb(money(offer.totals.vat))}</span></div>
    <div class="gross"><div><div class="label">Razem brutto</div>${grossNote ? `<div class="label">${grossNote}</div>` : ''}</div><div class="amount display">${nb(money(offer.totals.gross))}</div></div>
    ${notesP1}
    ${facts1}
  </div></div>${footerHTML(c)}</section>`;

  // --- sheet 2
  const head = `<div class="p2-head">${logoDataUrl ? `<img src="${esc(logoDataUrl)}" alt="logo">` : `<span class="name">${esc(c.name || '')}</span>`}<div class="t"><b>${number ? `Oferta nr ${number}` : 'Oferta'}</b> · dane techniczne</div></div>`;
  const table = linesP2
    ? `<h2>Szczegółowa wycena</h2><table><tr><th>Lp.</th><th>Pozycja</th><th class="num-r">Ilość</th><th class="num-r">Cena netto</th><th class="num-r">Wartość netto</th></tr>${offer.lines
        .map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.label)}${l.detail ? `<span class="detail2">${esc(l.detail)}</span>` : ''}</td><td class="num-r">${l.qty != null ? `${qtyFmt.format(l.qty)} ${esc(l.unit || '')}` : '1 kpl.'}</td><td class="num-r">${nb(money(l.unitNet != null ? l.unitNet : l.net))}</td><td class="num-r">${nb(money(l.net))}</td></tr>`)
        .join('')}</table>`
    : '';
  const notes2 = notesP2 ? `<h2>Istotne uwagi</h2><p class="notes2">${esc(notes)}</p>` : '';
  const planFig = technical && planSvg ? `<h2>Rzut z góry</h2><figure class="plan">${planSvg}<figcaption>Wymiary w mm</figcaption></figure>` : '';
  const params = !technical || !(facts.rows || []).length ? '' : `<h2>Parametry schodów</h2><dl class="params">${(facts.rows || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  const comfort =
    technical && s.showComfort !== false && facts.comfort?.length
      ? `<h2>Wygoda i zgodność z przepisami</h2><table><tr><th>Parametr</th><th>Wartość</th><th>Wymaganie</th><th class="num-r">Ocena</th></tr>${facts.comfort
          .map((x) => `<tr><td>${esc(x.label)}</td><td>${esc(x.value)}</td><td>${esc(x.requirement)} <span class="muted">(${esc(x.source)})</span></td><td class="num-r"><span class="${x.ok ? 'ok' : 'bad'}">${x.ok ? 'spełnia' : 'poza zakresem'}</span></td></tr>`)
          .join('')}</table>`
      : '';
  const body2 = `${table}${notes2}${planFig}${params}${comfort}`;
  const sheet2 = body2 ? `<section class="sheet flow"><div class="p2">${head}${body2}${closingNote ? `<p class="muted" style="margin:5mm 0 0">${esc(closingNote)}</p>` : ''}</div>${footerHTML(c)}</section>` : '';

  const docTitle = `Oferta${number ? ` nr ${number}` : ''}${projectName ? ` — ${esc(projectName)}` : ''}`;
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>${docTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Inter:wght@400;500;600&display=swap">
<style>${CSS}</style></head>
<body>${sheet1}${sheet2}</body></html>`;
}
