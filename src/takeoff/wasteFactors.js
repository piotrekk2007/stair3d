// Default material waste/reserve factors ("odpady" / "zapas materiałowy") — a
// MANUFACTURING_ASSUMPTION-style figure (same category as
// src/rules/sets/manufacturingAssumptions.js in the technical-rules layer), NOT a physical
// constant or a building-code number. This is a PURCHASING/MANUFACTURING assumption, not a
// property of the material itself — documented explicitly, never presented as "recommended".
//
// Supports waste factor per ELEMENT TYPE (the default) and, when given, a more specific
// override per (elementType, materialId) pair — e.g. a company might waste more offcutting an
// expensive hardwood tread than a cheap softwood one, even though both are "TREAD" items.

export const DEFAULT_WASTE_FACTORS = Object.freeze({
  TREAD: 0.1, // cutting treads from wider boards/panels — edge trim, knot avoidance
  LANDING: 0.1, // same panel-cutting logic as a tread
  STRINGER: 0.15, // long structural boards — cutting to length, avoiding defects, housing waste
  RISER: 0.08, // sheet material (plywood/MDF) — panel layout offcuts
  POST: 0.05, // short, simple square-section pieces — least waste-prone
  HANDRAIL: 0.1, // cut to length with mitres at the ends
  BASERAIL: 0.1, // same as the handrail
  BALUSTER: 0.03, // short identical pieces, little offcut
});

/**
 * @param {keyof import('./takeoffTypes.js').ELEMENT_TYPES} elementType
 * @param {string} [materialId]
 * @param {Object} [overrides]  Keys are either an elementType ('TREAD') for a broad override,
 *   or `${elementType}:${materialId}` (e.g. 'TREAD:timber-oak') for a material-specific one.
 *   The material-specific key wins when both are present.
 * @returns {number}
 */
export function wasteFactorFor(elementType, materialId, overrides = {}) {
  const specificKey = `${elementType}:${materialId}`;
  if (overrides[specificKey] !== undefined) return overrides[specificKey];
  if (overrides[elementType] !== undefined) return overrides[elementType];
  const value = DEFAULT_WASTE_FACTORS[elementType];
  if (value === undefined) throw new Error(`wasteFactorFor: no waste factor defined for element type "${elementType}"`);
  return value;
}
