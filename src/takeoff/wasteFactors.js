// Default material waste/reserve factors ("odpady" / "zapas materiałowy") — a
// MANUFACTURING_ASSUMPTION-style figure (same category as src/rules/sets/manufacturingAssumptions.js
// in the technical-rules layer), NOT a physical constant or a building-code number. It lives in
// its own file, as plain overridable data, so a company can tune its own cutting-waste
// experience without touching materialTakeoff.js's geometry-derived quantities — exactly the
// same "swappable data layer, never hardcoded into the solver" principle requested for pricing.
//
// Values are fractions added on top of the NET (as-built) quantity to get the GROSS (purchase)
// quantity — e.g. 0.10 means "buy 10% more than what ends up in the finished staircase".

export const DEFAULT_WASTE_FACTORS = Object.freeze({
  tread: 0.1, // cutting treads from wider boards/panels — edge trim, knot avoidance
  stringer: 0.15, // long structural boards — cutting to length, avoiding defects, housing waste
  riser: 0.08, // sheet material (plywood/MDF) — panel layout offcuts
  post: 0.05, // short, simple square-section pieces — least waste-prone
});

/**
 * @param {string} itemType  'tread' | 'stringer' | 'riser' | 'post'
 * @param {Object} [overrides]  Partial override of DEFAULT_WASTE_FACTORS
 * @returns {number}
 */
export function wasteFactorFor(itemType, overrides = {}) {
  const value = overrides[itemType] ?? DEFAULT_WASTE_FACTORS[itemType];
  if (value === undefined) throw new Error(`wasteFactorFor: no waste factor defined for item type "${itemType}"`);
  return value;
}
