// MATERIAL CATALOG — a deliberately thin abstraction, NOT an ERP. It exists so a company can
// eventually say "we stock C24 in these thicknesses/widths/lengths" without that knowledge
// living inside the takeoff solver itself. Nothing here enforces or validates a computed stock
// size against the catalog yet (no "round up to nearest available board width" logic) — that
// is exactly the kind of stock-optimization feature explicitly deferred by this stage.

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
