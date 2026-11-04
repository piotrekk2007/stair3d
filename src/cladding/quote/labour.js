// The labour price list of the module "Schody na beton" (stage 4 — docs/architecture/CONCRETE_CLADDING_MODULE.md):
// every installed element has its own labour price (user, 2026-11-04: "montaż każdego elementu ma swoją cenę"). The
// rates are the user's — 0 = not priced yet (flagged on the quote). Plus the module's own material prices that are not
// boards (floor boards, OSB per m²). Pure data.

export const LABOUR_UNITS = Object.freeze({ PIECE: 'szt', AREA: 'm2', LENGTH: 'mb', LUMP: 'ryczałt' });
export const UNIT_LABELS = Object.freeze({ szt: 'szt.', m2: 'm²', mb: 'mb', 'ryczałt': 'ryczałt' });

// (the user's list, 2026-11-04; the future elements — skirting, balustrade, finishing — already listed so their rates
// can be set before stage 5 draws them)
export const DEFAULT_LABOUR = Object.freeze([
  { id: 'tread-straight', label: 'Montaż stopnia prostego (bez podstopnicy)', unit: 'szt', rate: 0 },
  { id: 'tread-straight-riser', label: 'Montaż stopnia prostego z podstopnicą', unit: 'szt', rate: 0 },
  { id: 'tread-winder', label: 'Montaż stopnia zabiegowego (bez podstopnicy)', unit: 'szt', rate: 0 },
  { id: 'tread-winder-riser', label: 'Montaż stopnia zabiegowego z podstopnicą', unit: 'szt', rate: 0 },
  { id: 'landing-half', label: 'Montaż półpodestu', unit: 'szt', rate: 0 },
  { id: 'landing-wood', label: 'Montaż podestu z drewna', unit: 'szt', rate: 0 },
  { id: 'landing-floorboard', label: 'Montaż podestu z deski podłogowej (OSB + deska + nosek)', unit: 'm2', rate: 0 },
  { id: 'nosing', label: 'Montaż noska (antresola / podest)', unit: 'szt', rate: 0 },
  { id: 'skirting', label: 'Montaż listwy schodowej', unit: 'mb', rate: 0 },
  { id: 'railing-stairs', label: 'Montaż balustrady na schodach (za stopień)', unit: 'szt', rate: 0 },
  { id: 'railing-antresola', label: 'Montaż balustrady na antresoli', unit: 'mb', rate: 0 },
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
    // VAT: 8 % for a service with installation (residential), 23 % for material only (as the DREWEX calculator)
    withInstallation: true,
    // the board price list (takeoff/boardPricing.js shape) — null = the default DREWEX table; a whole price list file
    // read in replaces it (takeoff/priceListFile.js)
    boardPricing: null,
  };
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

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
    withInstallation: s.withInstallation !== false,
    boardPricing: s.boardPricing && typeof s.boardPricing === 'object' ? s.boardPricing : null,
  };
}
