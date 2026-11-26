// The client's offer of the module "Schody na beton" (stage 6 — docs/architecture/CONCRETE_CLADDING_MODULE.md): the
// quote (claddingQuote.js) turned into the offer's lines — per group, per element, or material + installation —, the
// lines the seller renamed / left out, the extra rows, a discount spread over the lines (internal, as in the
// self-supporting offer — no line of its own), the VAT; the stair's facts. Printed by the SHARED offer document
// (offer/offerDocument.js buildOfferHTML — the same look as the self-supporting offer) and an internal estimate
// (`buildEstimateHTML`, material and labour per line). Pure.

import { escapeHtml as esc } from '../../util/format.js';

export const OFFER_MODES = Object.freeze({ groups: 'pozycje zbiorcze (grupy)', detailed: 'każdy element osobno', split: 'materiał + montaż', 'groups-split': 'grupy towarów: materiał, a osobno montaż w grupach' });

// the installation's groups of the 'groups-split' offer (user request 2026-11-23: "materiał w grupach towarów (stopnie,
// podstopnie, balustrada, podesty…) i montaż — też grupowo: stopnie i podstopnice, balustrada, listwowanie…") — the
// quote's group of a line → its installation group (a group not listed: „Montaż — <group>”)
export const LABOUR_GROUPS = Object.freeze({
  'Stopnie zapraszające': 'Montaż stopni i podstopnic',
  'Stopnie proste': 'Montaż stopni i podstopnic',
  'Stopnie zabiegowe': 'Montaż stopni i podstopnic',
  Podstopnice: 'Montaż stopni i podstopnic',
  Noski: 'Montaż stopni i podstopnic',
  Profilowanie: 'Profilowanie krawędzi stopni',
  Podesty: 'Montaż podestów',
  'Listwy i wangi': 'Listwowanie (listwy i wangi obiciowe)',
  Balustrada: 'Montaż balustrady',
  'Oświetlenie LED': 'Montaż oświetlenia LED',
  Usługi: 'Pomiar i transport',
  'Pozycje własne': 'Pozycje własne',
});

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
    intro: '', // the offer's opening paragraph (both styles) — typed or written by the AI (user request 2026-11-26)
    showComfort: true,
    // the printed style (user decision 2026-11-06 — as the self-supporting offer's offerModel.js): classic / modern
    offerStyle: 'classic',
    offerTitle: '',
    offerSubtitle: '',
    offerEyebrow: '', // the line above the title ('' = automatic — user request 2026-11-13)
    leadTime: '3–5 tygodni',
    leadTimeNote: 'gotowe schody na miejscu',
    deliveryIncluded: true,
    showContactQr: false, // (stage 2: a QR with the company's contact beside „Dostawa”)
    includeLinkedFloor: false, // the linked floor counted into this offer (user request 2026-11-07)
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
    intro: str(s.intro),
    discountPct: Math.min(100, Math.max(0, num(s.discountPct))),
    lineEdits: edits,
    extras: (Array.isArray(s.extras) ? s.extras : []).filter((x) => x && typeof x === 'object').map((x, i) => ({ id: str(x.id) || `extra-${i}`, label: str(x.label) || 'Pozycja', qty: Math.max(0, num(x.qty, 1)), unit: str(x.unit) || 'szt.', unitNet: Math.max(0, num(x.unitNet)) })),
    showComfort: s.showComfort !== false,
    offerStyle: s.offerStyle === 'modern' ? 'modern' : 'classic',
    offerTitle: str(s.offerTitle),
    offerSubtitle: str(s.offerSubtitle),
    offerEyebrow: str(s.offerEyebrow),
    leadTime: typeof s.leadTime === 'string' ? s.leadTime : d.leadTime,
    leadTimeNote: typeof s.leadTimeNote === 'string' ? s.leadTimeNote : d.leadTimeNote,
    deliveryIncluded: s.deliveryIncluded !== false,
    showContactQr: s.showContactQr === true,
    includeLinkedFloor: s.includeLinkedFloor === true,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {ReturnType<import('./claddingQuote.js').buildCladdingQuote>} quote
 * @param {object} offer  sanitizeCladdingOffer
 * @returns {{lines: {id, label, detail, qty, unit, unitNet, net}[], totals: {net, vatRatePct, vat, gross}, rows: object[]}}
 *   `rows` = every candidate line (shown in the editor, hidden ones too)
 */
/**
 * Two quotes as one (the linked floor counted into this offer — user decisions 2026-11-07: this project's prices, all
 * the items in ONE list): the other floor's lines added (their ids prefixed, their element names marked with the
 * floor's name — two „Stopień 3” would read as one), the groups then sum by themselves; the totals added, the VAT this
 * quote's.
 */
export function mergeQuotes(a, b, floorName = '') {
  const mark = floorName ? ` (${floorName})` : '';
  const lines = [...a.lines, ...b.lines.map((l) => ({ ...l, id: `floor2:${l.id}`, name: `${l.name}${mark}` }))];
  const materialNet = round2(a.totals.materialNet + b.totals.materialNet);
  const labourNet = round2(a.totals.labourNet + b.totals.labourNet);
  const net = round2(a.totals.net + b.totals.net);
  const vat = round2((net * a.totals.vatPct) / 100);
  return { lines, totals: { materialNet, labourNet, net, vatPct: a.totals.vatPct, vat, gross: round2(net + vat) }, unpriced: (a.unpriced || 0) + (b.unpriced || 0) };
}

/**
 * Offer lines of another kind of stair (a self-supporting floor priced by the app — app/linkedFloorOffer.js) as quote
 * lines, so they flow through every mode (groups by their label, detailed one by one, split = material).
 */
export function quoteFromOfferLines(lines, vatPct) {
  const q = lines.map((l, k) => ({ id: `floor2:stair-${k}`, name: l.label, group: l.label, dims: l.detail || '', qty: 1, unit: 'kpl', total: round2(l.net) }));
  const net = round2(q.reduce((s, l) => s + l.total, 0));
  return { lines: q, totals: { materialNet: net, labourNet: 0, net, vatPct, vat: round2((net * vatPct) / 100), gross: round2(net + (net * vatPct) / 100) }, unpriced: 0 };
}

export function buildCladdingOffer(quote, offer) {
  const k = 1 - offer.discountPct / 100;
  let rows;
  if (offer.mode === 'detailed') {
    rows = quote.lines.map((l) => ({ id: l.id, label: l.name, detail: l.dims, qty: l.qty, unit: l.unit, net: l.total }));
  } else if (offer.mode === 'groups-split') {
    // the material per group of goods, then the installation per its own group (LABOUR_GROUPS); a line of another
    // stair's offer (quoteFromOfferLines: no material / labour of its own) counts as material
    const mat = new Map();
    const lab = new Map();
    const add = (map, id, label, v, count = 0) => {
      if (!map.has(id)) map.set(id, { id, label, net: 0, count: 0 });
      const g = map.get(id);
      g.net += v;
      g.count += count;
    };
    for (const l of quote.lines) {
      const m = l.material ? (l.material.value ?? 0) : l.labour ? 0 : l.total;
      if (m) add(mat, `mat:${l.group}`, l.group, m, l.unit === 'szt.' ? l.qty : 0);
      const w = l.labour?.value ?? 0;
      if (w) {
        const g = LABOUR_GROUPS[l.group] || `Montaż — ${l.group}`;
        add(lab, `lab:${g}`, g, w);
      }
    }
    rows = [
      ...[...mat.values()].map((g) => ({ id: g.id, label: g.label, detail: `materiał${g.count ? `, ${g.count} szt.` : ''}`, qty: null, unit: '', net: g.net, kind: 'material' })),
      ...[...lab.values()].map((g) => ({ id: g.id, label: g.label, detail: '', qty: null, unit: '', net: g.net, kind: 'installation' })),
    ];
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

// the offer's „Balustrada” row: one kind = as before; several (user request 2026-11-18 — a harp on one flight, balusters on
// another) = each section with its own infill
const INFILL_NAMES = { balusters: 'tralki', 'glass-posts': 'szkło między słupami', 'glass-side': 'szkło na boku betonu', harp: 'harfa', 'metal-loop': 'tralki metalowe z oczkiem' };
const CAP_NAMES = { flat: 'czapka płaska', pyramid: 'czapka piramidka', ball: 'czapka kula', round: 'góra zaoblona (toczona)', none: 'bez czapki' };
function railingFact(built) {
  const { config } = built;
  const secs = built.balustrade?.sections || [];
  if (!secs.length) return 'nie';
  const harpText = (h) => `harfa — ${h.material === 'wood' ? 'tralki drewniane' : `rurki metalowe Ø${Math.round(h.sizeMm)} mm`} od ${h.mount === 'side' ? 'boku schodów' : 'stopni'} do sufitu${h.strips.length ? ', listwa montażowa na suficie' : ''}`;
  const kinds = new Set(secs.map((s) => s.infill));
  const count = `${secs.length} ${secs.length === 1 ? 'odcinek' : 'odcinki'}`;
  // (the Socha type — user request 2026-11-24: its posts and its handrail)
  const sochaText = config.railingStyle === 'socha' ? 'typ Socha (słupy z podstawą, frezami i czapką, poręcz profilowana)' : null;
  if (kinds.size === 1) return secs[0].harp ? `${harpText(secs[0].harp)} (${count})` : `${count} (${INFILL_NAMES[secs[0].infill] || 'tralki'}; ${sochaText || `słupy: ${CAP_NAMES[config.postCap]}`})`;
  const where = (s) => (s.kind === 'antresola' ? 'antresola' : `bieg ${s.key.flight + 1} ${s.key.side === 'left' ? 'L' : 'P'}`);
  return secs.map((s) => `${where(s)}: ${s.harp ? harpText(s.harp) : INFILL_NAMES[s.infill] || 'tralki'}`).join('; ');
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
  const rows = [
    ['Rodzaj', 'Okładziny drewniane na biegu betonowym'],
    ['Stopnie', `${steps} prostych${winders ? `, ${winders} zabiegowych` : ''}${landings ? `, ${landings} ${landings === 1 ? 'podest' : 'podesty'}` : ''}${starters ? `, ${starters} zapraszający` : ''}`],
    ['Wysokość całkowita', `${Math.round(built.totalRise)} mm`],
    ['Wysokość stopnia (po wykończeniu)', `${Math.round(Math.min(...rises))}–${Math.round(Math.max(...rises))} mm`],
    ['Materiał', [bp.species, bp.cls].filter(Boolean).join(', ') || '—'],
    ['Grubość stopnia', `${config.treadThicknessMm} mm${config.riserBoards ? (config.riserMount === 'carpet' ? `, podstopnice dywanowe ${config.treadThicknessMm} mm (na obce pióro)` : `, podstopnice ${config.riserThicknessMm} mm`) : ', bez podstopnic'}`],
    ['Krawędź stopni', { square: 'prosta', chamfer: `fazka ${config.edgeProfileMm} mm`, round: `zaokrąglenie R${config.edgeProfileMm}`, bullnose: 'półwałek' }[config.edgeProfile] || '—'],
    ['Balustrada', railingFact(built)],
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
