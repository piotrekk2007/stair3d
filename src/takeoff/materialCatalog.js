// MATERIAL CATALOG — a deliberately thin abstraction, NOT an ERP. It exists so a company can
// eventually say "we stock C24 in these thicknesses/widths/lengths" without that knowledge
// living inside the takeoff solver itself.
//
// `roundUpToCatalogSize()` below is the one piece of "does this computed dimension correspond
// to a real, orderable size" logic this file owns — deliberately NOT the same thing as stock
// OPTIMIZATION (bin-packing, board nesting, cutting-plan generation are still explicitly out of
// scope): this only answers "what is the smallest catalog size that is >= what's needed", one
// dimension at a time, for a single linear member (a stringer, a cleat, a post) — never how to
// lay out several parts across one board.

/**
 * @typedef {Object} MaterialCatalogEntry
 * @property {string} materialId       Stable key — what TakeoffItem.materialId and
 *                                       MaterialPrice.materialId both reference.
 * @property {string} label            Human-readable name.
 * @property {string} [species]        e.g. 'Świerk/sosna' — free text, informational.
 * @property {number[]} [availableThicknessesMm]
 * @property {number[]} [availableWidthsMm]
 * @property {number[]} [availableLengthsMm]
 * @property {string} [notes]
 */

export const DEFAULT_MATERIAL_CATALOG = Object.freeze({
  'timber-c24': {
    materialId: 'timber-c24',
    label: 'Drewno konstrukcyjne C24',
    species: 'Świerk/sosna',
    availableThicknessesMm: [32, 40, 45, 50, 60],
    availableWidthsMm: [150, 200, 250, 300, 350],
    availableLengthsMm: [3000, 3600, 4200, 4800, 6000],
    notes: 'Placeholder catalog entry — illustrative stock sizes only, not a real supplier list.',
  },
  'sheet-plywood-mdf': {
    materialId: 'sheet-plywood-mdf',
    label: 'Sklejka / płyta MDF',
    availableThicknessesMm: [12, 15, 18, 20, 22, 25],
    availableWidthsMm: [1220, 2440], // standard sheet dimensions
    availableLengthsMm: [2440, 3050],
    notes: 'Sheet material — TakeoffItem area (m²), not board length, is the natural purchase measure.',
  },
});

/**
 * @param {string} materialId
 * @param {Record<string, MaterialCatalogEntry>} [catalog]
 * @returns {MaterialCatalogEntry|null}
 */
export function getMaterialCatalogEntry(materialId, catalog = DEFAULT_MATERIAL_CATALOG) {
  return catalog[materialId] ?? null;
}

/**
 * Finds the smallest available catalog size that is still >= `requiredMm` — "round up to the
 * next real board", never down (rounding down would silently make the part too short/thin/
 * narrow). Returns `{ sizeMm: null, exact: false }`, never an invented number, when even the
 * largest available size isn't enough — that case means the part must be joined/laminated from
 * more than one piece, which is a real manufacturing fact worth surfacing, not something to
 * paper over with a number that doesn't correspond to anything orderable.
 *
 * @param {number} requiredMm
 * @param {number[]} [availableSizesMm]  Needn't be pre-sorted.
 * @returns {{ sizeMm: number|null, exact: boolean }}  `exact` is true when `requiredMm` already
 *   matches an available size (within 1e-6mm) — i.e. no rounding was actually needed.
 */
export function roundUpToCatalogSize(requiredMm, availableSizesMm) {
  if (!availableSizesMm || availableSizesMm.length === 0) return { sizeMm: null, exact: false };
  const sorted = [...availableSizesMm].sort((a, b) => a - b);
  for (const size of sorted) {
    if (size >= requiredMm - 1e-6) return { sizeMm: size, exact: Math.abs(size - requiredMm) < 1e-6 };
  }
  return { sizeMm: null, exact: false }; // nothing in the catalog is long/wide/thick enough
}
