// OFFER MODEL — the price offer for the client, as plain data (no DOM). Built from what the takeoff already priced
// (ui/takeoffView.js summarizeByCategory: material cost per category) plus the offer settings. Nothing here prices a
// material or reads geometry — it only arranges numbers already computed, the way the company presents them
// (user decisions 2026-09-28):
//
//  * CNC + projekt: a lump sum (net) that is NEVER shown to the client as its own line — it is spread over the
//    material lines in proportion to their cost ("materiał wraz z przygotowaniem");
//  * the material is ONE line ("Schody — materiał wraz z przygotowaniem"), unless the seller ticks categories to show
//    separately (e.g. risers) — such a line carries its own share of the CNC + projekt sum;
//  * the manual extra items (Kosztorys → "Pozycje dodatkowe", e.g. white lacquer on the stringers) are separate lines;
//  * installation: a manual net amount, its own line;
//  * net, VAT (rate chosen per project), gross.
//
// Company data (name, address, NIP, …) is a COMPANY setting — kept in the browser like the presentation logo, not in
// the project; the offer settings (client, number, amounts) are PROJECT data, saved in the project file.

import { BLONDEL_RANGE_MM } from '../config/schema.js';
import { glassType } from '../geometry/railingGlass.js';

export const OFFER_VAT_RATES = Object.freeze([23, 8, 0]);
const MAIN_LINE_LABEL = 'Schody — materiał wraz z przygotowaniem';
const round2 = (v) => Math.round(v * 100) / 100;

export function createDefaultOfferSettings() {
  return {
    cncProjectCostNet: 0,
    installationCostNet: 0,
    vatRatePct: 23,
    separateCategories: [],
    client: { name: '', address: '', phone: '', email: '' },
    offerNumber: '',
    validityDays: 30,
    notes: '',
    showComfort: true,
  };
}

const num = (v, def = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : def);
const str = (v) => (typeof v === 'string' ? v : '');

export function sanitizeOfferSettings(value) {
  const d = createDefaultOfferSettings();
  if (!value || typeof value !== 'object') return d;
  return {
    cncProjectCostNet: num(value.cncProjectCostNet),
    installationCostNet: num(value.installationCostNet),
    vatRatePct: OFFER_VAT_RATES.includes(Number(value.vatRatePct)) ? Number(value.vatRatePct) : d.vatRatePct,
    separateCategories: Array.isArray(value.separateCategories) ? value.separateCategories.filter((c) => typeof c === 'string') : [],
    client: { name: str(value.client?.name), address: str(value.client?.address), phone: str(value.client?.phone), email: str(value.client?.email) },
    offerNumber: str(value.offerNumber),
    validityDays: Math.round(num(value.validityDays, d.validityDays)) || d.validityDays,
    notes: str(value.notes),
    showComfort: value.showComfort !== false,
  };
}

export function createDefaultCompany() {
  return { name: '', address: '', nip: '', phone: '', email: '', www: '' };
}

export function sanitizeCompany(value) {
  const d = createDefaultCompany();
  if (!value || typeof value !== 'object') return d;
  return Object.fromEntries(Object.keys(d).map((k) => [k, str(value[k])]));
}

/** Material categories the seller may show separately (priced, from the model — not the manual rows). */
export function separableCategories(summary) {
  return (summary?.lines || []).filter((l) => !l.manual && l.cost > 0).map((l) => l.label);
}

/**
 * @param {{summary: {lines: Array}, manualItems?: Array<{name, qty, unit, price}>, settings: Object, blocked?: boolean}} input
 * @returns {{lines: Array<{label, detail?, qty?, unit?, unitNet?, net, kind}>, totals: {net, vat, gross, vatRatePct},
 *   materialNet: number, cncProjectNet: number, warnings: string[]}}
 */
export function buildOffer({ summary, manualItems = [], settings, blocked = false }) {
  const s = sanitizeOfferSettings(settings);
  const warnings = [];
  if (blocked) warnings.push('Kosztorys jest zablokowany przez błędy walidacji — brak ceny materiału. Rozwiąż błędy albo dodaj wyjątki w zakładce Walidacja.');
  const material = (summary?.lines || []).filter((l) => !l.manual);
  const unpriced = material.reduce((n, l) => n + (l.unpriced || 0), 0);
  if (unpriced > 0) warnings.push(`${unpriced} poz. kosztorysu nie ma ceny (np. łączniki) — nie są wliczone w ofertę.`);
  const priced = material.filter((l) => l.cost > 0);
  const materialNet = round2(priced.reduce((sum, l) => sum + l.cost, 0));
  const cnc = round2(s.cncProjectCostNet);
  const share = (cost) => (materialNet > 0 ? (cnc * cost) / materialNet : 0);

  const lines = [];
  const separate = priced.filter((l) => s.separateCategories.includes(l.label));
  const rest = priced.filter((l) => !s.separateCategories.includes(l.label));
  const restNet = rest.reduce((sum, l) => sum + l.cost + share(l.cost), 0) + (materialNet > 0 ? 0 : cnc);
  if (rest.length > 0 || restNet > 0) {
    lines.push({ kind: 'material', label: MAIN_LINE_LABEL, detail: rest.length ? `w tym: ${rest.map((l) => l.label.replace(' (z modelu)', '').toLowerCase()).join(', ')}` : '', net: round2(restNet) });
  }
  for (const l of separate) lines.push({ kind: 'material', label: `${l.label.replace(' (z modelu)', '')} — materiał wraz z przygotowaniem`, net: round2(l.cost + share(l.cost)) });
  // rounding each share must not change the total: the difference goes to the first material line
  const materialLines = lines.filter((l) => l.kind === 'material');
  if (materialLines.length) {
    const diff = round2(materialNet + cnc - materialLines.reduce((sum, l) => sum + l.net, 0));
    materialLines[0].net = round2(materialLines[0].net + diff);
  }
  for (const r of manualItems || []) {
    if (!(r.qty > 0) || !(r.price > 0)) continue;
    lines.push({ kind: 'extra', label: r.name, qty: r.qty, unit: r.unit, unitNet: r.price, net: round2(r.qty * r.price) });
  }
  if (s.installationCostNet > 0) lines.push({ kind: 'installation', label: 'Montaż', net: round2(s.installationCostNet) });

  const net = round2(lines.reduce((sum, l) => sum + l.net, 0));
  const vat = round2((net * s.vatRatePct) / 100);
  return { lines, totals: { net, vat, gross: round2(net + vat), vatRatePct: s.vatRatePct }, materialNet, cncProjectNet: cnc, warnings };
}

const RAILING_INFILL_LABELS = {
  balusters: () => 'tak (tralki)',
  'glass-side': (c) => `szkło ${glassType(c).label} na rotulach, poręcz na szkle`,
  'glass-posts': (c) => `szkło ${glassType(c).label} między słupkami`,
};
const TYPE_LABELS = { straight: 'Proste (jednobiegowe)', L: 'Zabiegowe / kątowe L', U: 'Zabiegowe / kątowe U' };
const CONSTRUCTION = { closed: 'wpuszczana', cut: 'nakładana' };

/**
 * The stair's basic data and comfort for the offer — read off the config and deriveStairData(); the limits quoted are
 * the catalogue's own rules (src/rules/sets/plWarunkiTechniczne.js), with their source.
 */
export function stairFacts(config, derived, extras = {}) {
  const h = derived.riserHeight;
  const g = config.treadGoing;
  const blondel = 2 * h + g;
  const pitchDeg = (Math.atan2(h, g) * 180) / Math.PI;
  const turn = config.stairType === 'straight' ? '' : `, skręt w ${config.turnDirection === 'left' ? 'lewo' : 'prawo'}`;
  const rows = [
    ['Rodzaj schodów', `${TYPE_LABELS[config.stairType] || config.stairType}${turn}`],
    ['Wysokość do pokonania', `${Math.round(config.totalRise)} mm`],
    ['Liczba stopni', `${derived.numTreads} (wzniosów: ${derived.numRisers})`],
    ['Wysokość stopnia (wznios)', `${h.toFixed(1)} mm`],
    ['Głębokość stopnia (na linii biegu)', `${Math.round(g)} mm`],
    ['Szerokość biegu', `${Math.round(config.stairWidth)} mm`],
    ['Kąt nachylenia', `${pitchDeg.toFixed(1)}°`],
    config.stairType !== 'straight' ? ['Stopnie zabiegowe', `${config.windersPerTurn} na zakręcie`] : null,
    ['Grubość stopnia / nosek', `${config.treadThickness} mm / ${config.nosing} mm`],
    ['Podstopnie', config.hasRiserBoards ? `tak (${config.riserBoardThickness} mm)` : 'nie (schody otwarte)'],
    config.stairConstruction === 'cantilever'
      ? ['Konstrukcja', 'schody wspornikowe — okładziny drewniane na profilach stalowych w ścianie']
      : ['Wangi', `zewn. ${CONSTRUCTION[config.stringerConstructionTypeOuter] || '-'}, wewn. ${CONSTRUCTION[config.stringerConstructionTypeInner] || '-'}`],
    ['Balustrada', !config.railingEnabled ? 'nie' : RAILING_INFILL_LABELS[config.railingInfill]?.(config) || 'tak (tralki)'],
    extras.material ? ['Drewno', extras.material] : null,
  ].filter(Boolean);
  const comfort = [
    { label: 'Wzór Blondela 2h + s', value: `${Math.round(blondel)} mm`, requirement: `${BLONDEL_RANGE_MM.min}–${BLONDEL_RANGE_MM.max} mm`, ok: blondel >= BLONDEL_RANGE_MM.min && blondel <= BLONDEL_RANGE_MM.max, source: 'WT § 69 ust. 4' },
    { label: 'Wysokość stopnia', value: `${h.toFixed(1)} mm`, requirement: 'do 190 mm (dom jednorodzinny)', ok: h <= 190, source: 'WT § 68' },
    { label: 'Szerokość biegu', value: `${Math.round(config.stairWidth)} mm`, requirement: 'min. 800 mm (dom jednorodzinny)', ok: config.stairWidth >= 800, source: 'WT § 68' },
    { label: 'Kąt nachylenia', value: `${pitchDeg.toFixed(1)}°`, requirement: 'do 36°', ok: pitchDeg <= 36, source: 'WT § 69' },
  ];
  return { rows, comfort, blondel, pitchDeg };
}

/** Offer number suggestion: OF/YYYY/MMDD-HHMM. */
export function suggestOfferNumber(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `OF/${date.getFullYear()}/${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}
