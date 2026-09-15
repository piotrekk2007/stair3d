// Shape + factory for ONE Material Takeoff line item — pure data, no geometry, no Three.js, no
// pricing logic. Every quantity on a TakeoffItem is derived from the already-solved
// constructional model (TreadModel[]/RiserModel[]/StringerModel/PostModel[] — see
// materialTakeoff.js), never from Three.js meshes and never invented — this file only defines
// and validates the shape every item must have.

/**
 * @typedef {Object} TakeoffDimensions
 * Shape varies by item type (see materialTakeoff.js), but always has at least one length-like
 * field and a thickness — e.g. { avgWidthMm, avgDepthMm, thicknessMm } for a tread group, or
 * { totalLengthMm, heightMm, thicknessMm, boardCount } for a stringer.
 */

/**
 * @typedef {Object} TakeoffItem
 * @property {string} itemId        Stable id, e.g. "tread-straight", "stringer-outer", "riser-board".
 * @property {string} type          Category: 'tread' | 'stringer' | 'riser' | 'post'.
 * @property {string} subtype       e.g. 'straight' | 'winder' | 'landing' | 'outer' | 'inner' |
 *                                   'newel' | 'corner' | 'riser-board'.
 * @property {string} label         Human-readable Polish label, safe to show directly in a report.
 * @property {TakeoffDimensions} dimensions
 * @property {number} quantity      Discrete piece count (the purchase unit count).
 * @property {string} quantityUnit  'szt' (pieces) — the only unit quantity currently uses;
 *                                   length/area/volume are separate fields below.
 * @property {number} netArea       m², total surface area actually built (0 if not area-relevant).
 * @property {number} netVolume     m³, total actual (as-built) volume.
 * @property {string} material      e.g. config.timberGrade, or a generic material name (riser
 *                                   boards are panel material, not structural timber).
 * @property {number} wasteFactor   Fraction (e.g. 0.1 = 10%) — see wasteFactors.js; a
 *                                   MANUFACTURING_ASSUMPTION-style figure, not a physical constant.
 * @property {number} grossArea     netArea * (1 + wasteFactor) — what you'd actually need to buy.
 * @property {number} grossVolume   netVolume * (1 + wasteFactor).
 * @property {number} wasteArea     grossArea - netArea ("odpady", m²).
 * @property {number} wasteVolume   grossVolume - netVolume ("odpady", m³).
 * @property {boolean} optional     True for config-conditional elements (riser boards only when
 *                                   hasRiserBoards, corner posts only when hasCornerPost) — an
 *                                   item that doesn't apply to the current config simply isn't
 *                                   produced at all, rather than appearing with quantity 0.
 * @property {number|null} unitPrice      Filled in by pricing.js's applyPricing() — null until
 *                                         a price has actually been applied (see pricing.js —
 *                                         cost is a SEPARATE data layer from these quantities).
 * @property {string|null} priceUnit      'volume' | 'area' | 'piece' — which measure unitPrice multiplies.
 * @property {string|null} currency
 * @property {number|null} calculatedCost
 */

const REQUIRED_FIELDS = ['itemId', 'type', 'subtype', 'label', 'dimensions', 'quantity', 'quantityUnit', 'netArea', 'netVolume', 'material', 'wasteFactor', 'optional'];

/**
 * @param {Partial<TakeoffItem>} fields
 * @returns {TakeoffItem}
 */
export function createTakeoffItem(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined) throw new Error(`createTakeoffItem: missing required field "${key}"`);
  }
  if (!(fields.wasteFactor >= 0)) throw new Error(`createTakeoffItem: wasteFactor must be >= 0, got ${fields.wasteFactor}`);

  const grossArea = fields.netArea * (1 + fields.wasteFactor);
  const grossVolume = fields.netVolume * (1 + fields.wasteFactor);

  return {
    itemId: fields.itemId,
    type: fields.type,
    subtype: fields.subtype,
    label: fields.label,
    dimensions: fields.dimensions,
    quantity: fields.quantity,
    quantityUnit: fields.quantityUnit,
    netArea: fields.netArea,
    netVolume: fields.netVolume,
    material: fields.material,
    wasteFactor: fields.wasteFactor,
    grossArea,
    grossVolume,
    wasteArea: grossArea - fields.netArea,
    wasteVolume: grossVolume - fields.netVolume,
    optional: fields.optional,
    // Pricing is applied later, by a different layer (pricing.js) — never guessed here.
    unitPrice: null,
    priceUnit: null,
    currency: null,
    calculatedCost: null,
  };
}
