// PRICING — a data layer completely SEPARATE from src/takeoff/materialTakeoff.js's quantities.
// A TakeoffItem coming out of computeMaterialTakeoff() always has calculatedCost=null; this
// file is the ONLY place that fills it in, by joining items with a price list keyed by
// MATERIAL (materialId + unit), NOT by itemId — the same staircase geometry must work with any
// price list, and the same price list must work across every item made of that material,
// regardless of which specific tread/stringer/post it prices.
//
// Changing a price means editing/replacing the price list passed here — it never requires
// touching materialTakeoff.js, and no geometry change ever requires touching a price.

export const PRICE_UNITS = Object.freeze({
  VOLUME: 'volume', // unitPrice is per m³ — multiplies item.wasteAdjustedQuantity when its unit is 'm3'
  AREA: 'area', // unitPrice is per m² — multiplies item.wasteAdjustedQuantity when its unit is 'm2'
  PIECE: 'piece', // unitPrice is per szt — multiplies item.quantity
});

/**
 * @typedef {Object} MaterialPrice
 * @property {string} materialId    Matches TakeoffItem.materialId / materialCatalog.js entries.
 * @property {number} price
 * @property {string} currency      e.g. 'PLN' — see CURRENCY note below for future multi-currency support.
 * @property {keyof PRICE_UNITS} unit
 * @property {string} [validFrom]   ISO date string — informational, not enforced.
 * @property {string} [source]      Free text — where this price came from.
 */

// Illustrative example price list (PLN) — a real deployment replaces this with the workshop's
// own current price list, keyed by materialId, without touching any other file in src/takeoff/.
export const DEFAULT_PRICE_LIST = Object.freeze([
  { materialId: 'timber-c24', price: 4200, currency: 'PLN', unit: PRICE_UNITS.VOLUME, source: 'Illustrative example — not a real supplier quote.' },
  { materialId: 'sheet-plywood-mdf', price: 90, currency: 'PLN', unit: PRICE_UNITS.AREA, source: 'Illustrative example — not a real supplier quote.' },
]);

function indexByMaterialId(priceList) {
  const map = new Map();
  for (const entry of priceList) map.set(entry.materialId, entry);
  return map;
}

function measureFor(item, unit) {
  if (unit === PRICE_UNITS.VOLUME) return item.wasteAdjustedUnit === 'm3' ? item.wasteAdjustedQuantity : null;
  if (unit === PRICE_UNITS.AREA) return item.wasteAdjustedUnit === 'm2' ? item.wasteAdjustedQuantity : null;
  if (unit === PRICE_UNITS.PIECE) return item.quantity;
  throw new Error(`applyPricing: unknown price unit "${unit}"`);
}

/**
 * Joins TakeoffItem[] with a price list by `materialId` — pure, returns NEW items, never
 * mutates its input. An item whose material has no price list entry, or whose status isn't OK,
 * or whose measure doesn't match the price's unit (e.g. a volume price for an area-only item),
 * stays honestly unpriced (calculatedCost: null) rather than guessed.
 *
 * @param {import('./takeoffTypes.js').MaterialTakeoffItem[]} items
 * @param {MaterialPrice[]} [priceList]
 * @returns {import('./takeoffTypes.js').MaterialTakeoffItem[]}
 */
export function applyPricing(items, priceList = DEFAULT_PRICE_LIST) {
  const byMaterial = indexByMaterialId(priceList);
  return items.map((item) => {
    if (item.status !== 'OK') return { ...item };
    // Pozycje wycenione (albo świadomie niewycenione) z tabeli cennikowej desek — patrz
    // boardPricing.js — nie są wyceniane drugi raz ogólnym cennikiem po materialId.
    if (item.pricingSource) return { ...item };
    const price = byMaterial.get(item.materialId);
    if (!price) return { ...item };
    const measure = measureFor(item, price.unit);
    if (measure === null) return { ...item };
    return {
      ...item,
      unitPrice: price.price,
      priceUnit: price.unit,
      currency: price.currency,
      calculatedCost: Math.round(measure * price.price * 100) / 100,
    };
  });
}

/**
 * @param {import('./takeoffTypes.js').MaterialTakeoffItem[]} items
 * @returns {number} Sum of calculatedCost across every priced item (unpriced items contribute 0).
 */
export function totalCost(items) {
  // Rounded to whole grosze: a sum of many rounded item prices must not carry float noise
  // (13329.400000000001) into the total shown to the customer.
  return Math.round(items.reduce((sum, item) => sum + (item.calculatedCost || 0), 0) * 100) / 100;
}
