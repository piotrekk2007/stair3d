// The client's offer of the module "Schody na beton" (stage 6 — docs/architecture/CONCRETE_CLADDING_MODULE.md): the
// quote (claddingQuote.js) turned into the offer's lines — per group, per element, or material + installation —, the
// lines the seller renamed / left out, the extra rows, a discount spread over the lines (internal, as in the
// self-supporting offer — no line of its own), the VAT; the stair's facts. Printed by the SHARED offer document
// (offer/offerDocument.js buildOfferHTML — the same look as the self-supporting offer) and an internal estimate
// (`buildEstimateHTML`, material and labour per line). Pure.

import { escapeHtml as esc } from '../../util/format.js';

export const OFFER_MODES = Object.freeze({ groups: 'pozycje zbiorcze (grupy)', detailed: 'każdy element osobno', split: 'materiał + montaż' });

export function createDefaultCladdingOffer() {
  return {
    mode: 'groups',
    client: { name: '', address: '', phone: '', email: '' },
    offerNumber: '',
    validityDays: 30,
    notes: '',
    discountPct: 0,
    // group / line id → {label?, hidden?}
    lineEdits: {},
    extras: [], // [{id, label, qty, unit, unitNet}]
    showComfort: true,
    // the printed style (user decision 2026-11-06 — as the self-supporting offer's offerModel.js): classic / modern
    offerStyle: 'classic',
    offerTitle: '',
    offerSubtitle: '',
    leadTime: '3–5 tygodni',
    leadTimeNote: 'gotowe schody na miejscu',
    deliveryIncluded: true,
    showContactQr: false, // (stage 2: a QR with the company's contact beside „Dostawa”)
  };
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const str = (v) => (typeof v === 'string' ? v : '');

export function sanitizeCladdingOffer(raw) {
  const d = createDefaultCladdingOffer();
  const s = raw && typeof raw === 'object' ? raw : {};
  const edits = {};
  for (const [k, v] of Object.entries(s.lineEdits && typeof s.lineEdits === 'object' ? s.lineEdits : {})) {
    if (!v || typeof v !== 'object') continue;
    const e = {};
    if (typeof v.label === 'string' && v.label.trim()) e.label = v.label;
    if (v.hidden === true) e.hidden = true;
    if (Object.keys(e).length) edits[k] = e;
  }
  return {
    mode: Object.keys(OFFER_MODES).includes(s.mode) ? s.mode : d.mode,
    client: { name: str(s.client?.name), address: str(s.client?.address), phone: str(s.client?.phone), email: str(s.client?.email) },
    offerNumber: str(s.offerNumber),
    validityDays: Math.max(1, Math.round(num(s.validityDays, d.validityDays))),
    notes: str(s.notes),
    discountPct: Math.min(100, Math.max(0, num(s.discountPct))),
    lineEdits: edits,
    extras: (Array.isArray(s.extras) ? s.extras : []).filter((x) => x && typeof x === 'object').map((x, i) => ({ id: str(x.id) || `extra-${i}`, label: str(x.label) || 'Pozycja', qty: Math.max(0, num(x.qty, 1)), unit: str(x.unit) || 'szt.', unitNet: Math.max(0, num(x.unitNet)) })),
    showComfort: s.showComfort !== false,
    offerStyle: s.offerStyle === 'modern' ? 'modern' : 'classic',
    offerTitle: str(s.offerTitle),
    offerSubtitle: str(s.offerSubtitle),
    leadTime: typeof s.leadTime === 'string' ? s.leadTime : d.leadTime,
    leadTimeNote: typeof s.leadTimeNote === 'string' ? s.leadTimeNote : d.leadTimeNote,
    deliveryIncluded: s.deliveryIncluded !== false,
    showContactQr: s.showContactQr === true,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {ReturnType<import('./claddingQuote.js').buildCladdingQuote>} quote
 * @param {object} offer  sanitizeCladdingOffer
 * @returns {{lines: {id, label, detail, qty, unit, unitNet, net}[], totals: {net, vatRatePct, vat, gross}, rows: object[]}}
 *   `rows` = every candidate line (shown in the editor, hidden ones too)
 */
export function buildCladdingOffer(quote, offer) {
  const k = 1 - offer.discountPct / 100;
  let rows;
  if (offer.mode === 'detailed') {
    rows = quote.lines.map((l) => ({ id: l.id, label: l.name, detail: l.dims, qty: l.qty, unit: l.unit, net: l.total }));
  } else if (offer.mode === 'split') {
    rows = [
      { id: 'material', label: 'Materiał — okładziny schodów wraz z przygotowaniem', detail: '', qty: null, unit: '', net: quote.totals.materialNet },
      { id: 'installation', label: 'Montaż', detail: '', qty: null, unit: '', net: quote.totals.labourNet },
    ];
  } else {
    const groups = new Map();
    for (const l of quote.lines) {
      if (!groups.has(l.group)) groups.set(l.group, { id: `group:${l.group}`, label: l.group, net: 0, count: 0, unit: l.unit });
      const g = groups.get(l.group);
      g.net += l.total;
      g.count += l.unit === 'szt.' ? l.qty : 0;
    }
    rows = [...groups.values()].map((g) => ({ id: g.id, label: g.label, detail: g.count ? `${g.count} szt.` : '', qty: null, unit: '', net: g.net }));
  }
  rows = rows.map((r) => ({ ...r, label: offer.lineEdits[r.id]?.label ?? r.label, hidden: !!offer.lineEdits[r.id]?.hidden, net: round2(r.net * k) }));
  rows.forEach((r) => (r.unitNet = r.qty ? round2(r.net / r.qty) : null));
  const extras = offer.extras.map((x) => ({ id: x.id, label: x.label, detail: '', qty: x.qty, unit: x.unit, unitNet: x.unitNet, net: round2(x.qty * x.unitNet), extra: true }));
  const lines = [...rows.filter((r) => !r.hidden && r.net > 0), ...extras.filter((x) => x.net > 0)];
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const vatRatePct = quote.totals.vatPct;
  const vat = round2((net * vatRatePct) / 100);
  return { lines, rows, extras, totals: { net, vatRatePct, vat, gross: round2(net + vat) } };
}

/** The stair's facts for the offer (the shared document's "Parametry schodów"), and its comfort table. */
/**
 * What the cladding does NOT have — the AI render's „never add it” list (keys of offer/aiRender.js AI_ABSENT, given as
 * plain strings: the module never imports it; user report 2026-11-06).
 */
export function claddingAiAbsent(built) {
  const config = built?.config || {};
  const sections = built?.balustrade?.sections || [];
  const out = [];
  if (!sections.some((s) => s.kind !== 'antresola')) out.push('stairRailing');
  if (!sections.some((s) => s.kind === 'antresola')) out.push('openingRailing');
  if (!(built?.balustrade?.wallRails || []).length) out.push('wallHandrail');
  if (!config.riserBoards) out.push('risers');
  if (!config.ledTreadEnabled && !config.ledSkirtingEnabled && !config.ledHandrailEnabled) out.push('led');
  return out;
}

export function claddingFacts(built, quoteSettings) {
  const { concrete, cladding, config } = built;
  const steps = concrete.elements.filter((e) => e.kind === 'step').length;
  const winders = concrete.elements.filter((e) => e.kind === 'winder').length;
  const landings = concrete.elements.filter((e) => e.kind === 'landing').length;
  const starters = cladding.treads.filter((t) => t.starter).length;
  const rises = cladding.heights.map((h) => h.finishedRiseMm);
  const goings = concrete.elements.filter((e) => e.kind === 'step').map((e) => e.goingMm);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const bp = quoteSettings.boardPricing || {};
  const rail = (built.balustrade?.sections || []).length;
  const rows = [
    ['Rodzaj', 'Okładziny drewniane na biegu betonowym'],
    ['Stopnie', `${steps} prostych${winders ? `, ${winders} zabiegowych` : ''}${landings ? `, ${landings} ${landings === 1 ? 'podest' : 'podesty'}` : ''}${starters ? `, ${starters} zapraszający` : ''}`],
    ['Wysokość całkowita', `${Math.round(built.totalRise)} mm`],
    ['Wysokość stopnia (po wykończeniu)', `${Math.round(Math.min(...rises))}–${Math.round(Math.max(...rises))} mm`],
    ['Materiał', [bp.species, bp.cls].filter(Boolean).join(', ') || '—'],
    ['Grubość stopnia', `${config.treadThicknessMm} mm${config.riserBoards ? (config.riserMount === 'carpet' ? `, podstopnice dywanowe ${config.treadThicknessMm} mm (na obce pióro)` : `, podstopnice ${config.riserThicknessMm} mm`) : ', bez podstopnic'}`],
    ['Krawędź stopni', { square: 'prosta', chamfer: `fazka ${config.edgeProfileMm} mm`, round: `zaokrąglenie R${config.edgeProfileMm}`, bullnose: 'półwałek' }[config.edgeProfile] || '—'],
    ['Balustrada', rail ? `${rail} ${rail === 1 ? 'odcinek' : 'odcinki'} (słupy: ${{ flat: 'czapka płaska', pyramid: 'czapka piramidka', ball: 'czapka kula', round: 'góra zaoblona (toczona)', none: 'bez czapki' }[config.postCap]})` : 'nie'],
    ['Montaż', quoteSettings.withInstallation ? 'tak (VAT 8%)' : 'nie — sam materiał (VAT 23%)'],
  ];
  const h = Math.round(avg(rises.slice(1, -1).length ? rises.slice(1, -1) : rises));
  const g = Math.round(avg(goings));
  const blondel = 2 * h + g;
  // (the same requirements and sources as the self-supporting offer — offer/offerModel.js stairFacts)
  const width = Math.min(...concrete.elements.filter((e) => e.kind === 'step').map((e) => e.widthMm));
  const pitch = (Math.atan2(h, g || 1) * 180) / Math.PI;
  const comfort = [
    { label: 'Wzór Blondela 2h + s', value: `${blondel} mm`, requirement: '600–650 mm', ok: blondel >= 600 && blondel <= 650, source: 'WT § 69 ust. 4' },
    { label: 'Wysokość stopnia', value: `${h} mm`, requirement: 'do 190 mm (dom jednorodzinny)', ok: h <= 190, source: 'WT § 68' },
    { label: 'Szerokość biegu', value: `${Math.round(width)} mm`, requirement: 'min. 800 mm (dom jednorodzinny)', ok: width >= 800, source: 'WT § 68' },
    { label: 'Kąt nachylenia', value: `${pitch.toFixed(1)}°`, requirement: 'do 36°', ok: pitch <= 36, source: 'WT § 69' },
  ];
  return { rows, comfort };
}

const moneyFmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v) => (v === null || v === undefined ? '—' : `${moneyFmt.format(v)} zł`);

/** The internal estimate (kosztorys): every line with its material and labour, the totals — one printable page. */
export function buildEstimateHTML({ quote, projectName = '', date = new Date() }) {
  let group = null;
  const rows = quote.lines
    .map((l) => {
      const head = l.group !== group ? `<tr class="g"><td colspan="5">${esc((group = l.group))}</td></tr>` : '';
      return `${head}<tr><td>${esc(l.name)}<div class="d">${esc(l.dims)}</div></td><td class="n">${l.qty} ${esc(l.unit)}</td><td class="n">${l.material ? money(l.material.value) : ''}</td><td class="n">${l.labour ? money(l.labour.value) : ''}</td><td class="n"><b>${money(l.total)}</b></td></tr>`;
    })
    .join('');
  const t = quote.totals;
  const d = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Kosztorys${projectName ? ` — ${esc(projectName)}` : ''}</title><style>
  @page { size: A4; margin: 12mm; } body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 9.5pt; color: #222; }
  h1 { font-size: 15pt; color: #5a3d24; margin: 0 0 2mm; } table { width: 100%; border-collapse: collapse; }
  td, th { padding: 1mm 2mm; border-bottom: 1px solid #eee5d9; vertical-align: top; } th { background: #f5ede3; text-align: left; }
  .n { text-align: right; white-space: nowrap; } .g td { background: #f2efe9; font-weight: 600; } .d { color: #777; font-size: 8pt; }
  .t { width: 80mm; margin: 4mm 0 0 auto; } .t td { border: 0; } .t tr:last-child td { font-weight: 700; border-top: 2px solid #8a5a34; }
  </style></head><body><h1>Kosztorys — schody na beton</h1><div>${projectName ? `${esc(projectName)} · ` : ''}${d}</div>
  <table><tr><th>Element</th><th class="n">Ilość</th><th class="n">Materiał</th><th class="n">Robocizna</th><th class="n">Razem netto</th></tr>${rows}</table>
  <table class="t"><tr><td>Materiał netto</td><td class="n">${money(t.materialNet)}</td></tr><tr><td>Robocizna netto</td><td class="n">${money(t.labourNet)}</td></tr><tr><td>Razem netto</td><td class="n">${money(t.net)}</td></tr><tr><td>VAT ${t.vatPct}%</td><td class="n">${money(t.vat)}</td></tr><tr><td>Razem brutto</td><td class="n">${money(t.gross)}</td></tr></table>
  ${quote.unpriced ? `<p>Pozycje bez ceny: ${quote.unpriced} (—).</p>` : ''}</body></html>`;
}

/** Offer number suggestion: OF/YYYY/MMDD-HHMM (as the self-supporting one). */
export function suggestOfferNumber(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `OF/${date.getFullYear()}/${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}
