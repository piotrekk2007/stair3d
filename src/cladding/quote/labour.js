// The price list of the module "Schody na beton" (stages 4 / 6 — docs/architecture/CONCRETE_CLADDING_MODULE.md):
// THE SAME material price list as the self-supporting takeoff (user, 2026-11-04: "cennik elementów powinien odnosić się
// do tego co jest już w schodach samonośnych") — the general list by material id (balusters, handrail, glass, fittings,
// LED, brackets…, takeoff/pricing.js) and the board pricing (DREWEX boards, species, the post table by section,
// takeoff/boardPricing.js), read / saved as the same „cały cennik” file — plus what only this module has: the labour of
// every installed element (user: "montaż każdego elementu ma swoją cenę") and a few materials per m² / mb (floor boards,
// OSB, skirting). 0 = not priced yet (flagged on the quote). Pure data.

import { DEFAULT_PRICE_LIST } from '../../takeoff/pricing.js';
import { createDefaultBoardPricing, sanitizeBoardPricing } from '../../takeoff/boardPricing.js';

export const LABOUR_UNITS = Object.freeze({ PIECE: 'szt', AREA: 'm2', LENGTH: 'mb', LUMP: 'ryczałt' });
export const UNIT_LABELS = Object.freeze({ szt: 'szt.', m2: 'm²', mb: 'mb', 'ryczałt': 'ryczałt' });

// (the user's list, 2026-11-04; the future elements — skirting, balustrade, finishing — already listed so their rates
// can be set before stage 5 draws them)
export const DEFAULT_LABOUR = Object.freeze([
  { id: 'tread-straight', label: 'Montaż stopnia prostego (bez podstopnicy)', unit: 'szt', rate: 0 },
  { id: 'tread-straight-riser', label: 'Montaż stopnia prostego z podstopnicą', unit: 'szt', rate: 0 },
  { id: 'tread-winder', label: 'Montaż stopnia zabiegowego (bez podstopnicy)', unit: 'szt', rate: 0 },
  { id: 'tread-winder-riser', label: 'Montaż stopnia zabiegowego z podstopnicą', unit: 'szt', rate: 0 },
  { id: 'tread-starter', label: 'Montaż stopnia zapraszającego (z podstopnicą giętą)', unit: 'szt', rate: 0 },
  { id: 'edge-profile', label: 'Profilowanie krawędzi stopni', unit: 'mb', rate: 0 },
  { id: 'landing-half', label: 'Montaż półpodestu', unit: 'szt', rate: 0 },
  { id: 'landing-wood', label: 'Montaż podestu z drewna', unit: 'szt', rate: 0 },
  { id: 'landing-floorboard', label: 'Montaż podestu z deski podłogowej (OSB + deska + nosek)', unit: 'm2', rate: 0 },
  { id: 'nosing', label: 'Montaż noska (antresola / podest)', unit: 'szt', rate: 0 },
  { id: 'skirting', label: 'Montaż listwy schodowej', unit: 'mb', rate: 0 },
  { id: 'cover-stringer', label: 'Montaż wangi obiciowej', unit: 'mb', rate: 0 },
  { id: 'post', label: 'Montaż słupa ozdobnego', unit: 'szt', rate: 0 },
  { id: 'railing-stairs', label: 'Montaż balustrady na schodach (za stopień)', unit: 'szt', rate: 0 },
  { id: 'railing-antresola', label: 'Montaż balustrady na antresoli', unit: 'mb', rate: 0 },
  { id: 'led', label: 'Montaż oświetlenia LED (profil + taśma)', unit: 'mb', rate: 0 },
  { id: 'measure', label: 'Pomiar', unit: 'ryczałt', rate: 0 },
  { id: 'transport', label: 'Transport', unit: 'ryczałt', rate: 0 },
]);

export function createDefaultQuoteSettings() {
  return {
    labour: DEFAULT_LABOUR.map((r) => ({ ...r })),
    // the lump-sum items on this quote (pomiar, transport): on / off
    lumps: { measure: true, transport: true },
    // materials outside the board price list (PLN per m², 0 = not priced yet)
    floorboardPerM2: 0,
    osbPerM2: 0,
    // the module's own materials per unit (stage 5)
    skirtingPerMb: 0,
    // the SHARED material list (as the self-supporting takeoff settings): by material id, and the board pricing
    priceList: DEFAULT_PRICE_LIST.map((p) => ({ ...p })),
    wasteFactors: {},
    // VAT: 8 % for a service with installation (residential), 23 % for material only (as the DREWEX calculator)
    withInstallation: true,
    // the board pricing (takeoff/boardPricing.js shape: boards, species, posts by section, LED supplies)
    boardPricing: createDefaultBoardPricing(),
  };
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

// the shared list: every known material with the file's price; a project from before stage 6 carried the handrail /
// baluster prices of its own — taken over
function mergePriceList(s) {
  const own = new Map((Array.isArray(s.priceList) ? s.priceList : []).filter((p) => p && typeof p.materialId === 'string').map((p) => [p.materialId, p]));
  const legacy = { 'railing-handrail': s.handrailPerMb, 'railing-baluster': s.balusterPerPiece };
  return DEFAULT_PRICE_LIST.map((p) => {
    const price = Number(own.get(p.materialId)?.price);
    const old = Number(legacy[p.materialId]);
    return { ...p, price: Number.isFinite(price) && price >= 0 ? price : Number.isFinite(old) && old > 0 ? old : p.price };
  });
}

/** A material's price from the shared list (0 = not priced). */
export const priceOf = (settings, materialId) => Number(settings.priceList?.find((p) => p.materialId === materialId)?.price) || 0;

export function sanitizeQuoteSettings(raw) {
  const d = createDefaultQuoteSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  const own = new Map((Array.isArray(s.labour) ? s.labour : []).filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
  return {
    // every known item (with its rate from the file), then the user's own extra items
    labour: [
      ...d.labour.map((r) => ({ ...r, rate: Math.max(0, num(own.get(r.id)?.rate, r.rate)) })),
      ...[...own.values()].filter((r) => !d.labour.some((x) => x.id === r.id) && r.id.startsWith('own-')).map((r) => ({ id: r.id, label: String(r.label || 'Pozycja'), unit: Object.values(LABOUR_UNITS).includes(r.unit) ? r.unit : 'szt', rate: Math.max(0, num(r.rate, 0)), qty: Math.max(0, num(r.qty, 1)) })),
    ],
    lumps: { measure: s.lumps?.measure !== false, transport: s.lumps?.transport !== false },
    floorboardPerM2: Math.max(0, num(s.floorboardPerM2, 0)),
    osbPerM2: Math.max(0, num(s.osbPerM2, 0)),
    skirtingPerMb: Math.max(0, num(s.skirtingPerMb, 0)),
    priceList: mergePriceList(s),
    wasteFactors: s.wasteFactors && typeof s.wasteFactors === 'object' ? { ...s.wasteFactors } : {},
    withInstallation: s.withInstallation !== false,
    boardPricing: s.boardPricing && typeof s.boardPricing === 'object' ? sanitizeBoardPricing(s.boardPricing) : createDefaultBoardPricing(),
  };
}
