// PRICING — a data layer completely SEPARATE from src/takeoff/materialTakeoff.js's quantities.
// A TakeoffItem coming out of computeMaterialTakeoff() always has calculatedCost=null; this
// file is the ONLY place that fills it in, by joining items with a PriceCatalog (itemId ->
// {unit, unitPrice, currency}). Changing a price means editing/replacing the catalog passed
// here — it never requires touching materialTakeoff.js, and no geometry change ever requires
// touching a price. This mirrors the same "swappable layer" principle already used for
// technical rules/profiles (src/rules/profiles/) and waste factors (wasteFactors.js).
//
// DEFAULT_PRICE_CATALOG below is an EXAMPLE catalog (illustrative PLN figures) — a real
// deployment would replace it with the workshop's own current price list, per material/element,
// without changing any other file in src/takeoff/ or src/geometry/.

export const PRICE_UNITS = Object.freeze({
  VOLUME: 'volume', // unitPrice is per m³ — multiplies item.grossVolume
  AREA: 'area', // unitPrice is per m² — multiplies item.grossArea
  PIECE: 'piece', // unitPrice is per szt — multiplies item.quantity
});

export const DEFAULT_PRICE_CATALOG = Object.freeze({
  'tread-straight': { unit: PRICE_UNITS.VOLUME, unitPrice: 4200, currency: 'PLN' },
  'tread-winder': { unit: PRICE_UNITS.VOLUME, unitPrice: 4600, currency: 'PLN' }, // more waste cutting irregular shapes
  'tread-landing': { unit: PRICE_UNITS.VOLUME, unitPrice: 3800, currency: 'PLN' },
  'stringer-outer': { unit: PRICE_UNITS.VOLUME, unitPrice: 3600, currency: 'PLN' },
  'stringer-inner': { unit: PRICE_UNITS.VOLUME, unitPrice: 3600, currency: 'PLN' },
  'riser-board': { unit: PRICE_UNITS.AREA, unitPrice: 90, currency: 'PLN' },
  'post-newel': { unit: PRICE_UNITS.VOLUME, unitPrice: 5200, currency: 'PLN' }, // visible element, better-grade stock
  'post-corner': { unit: PRICE_UNITS.VOLUME, unitPrice: 4800, currency: 'PLN' },
});

function measureFor(item, unit) {
  if (unit === PRICE_UNITS.VOLUME) return item.grossVolume;
  if (unit === PRICE_UNITS.AREA) return item.grossArea;
  if (unit === PRICE_UNITS.PIECE) return item.quantity;
  throw new Error(`applyPricing: unknown price unit "${unit}"`);
}

/**
 * Joins TakeoffItem[] with a price catalog — pure, returns NEW items, never mutates its input.
 * An item with no entry in the catalog is returned unchanged (cost fields stay null) rather
 * than guessing a price — a report can distinguish "priced" from "not yet priced" this way.
 *
 * @param {import('./takeoffTypes.js').TakeoffItem[]} items
 * @param {Record<string, {unit: string, unitPrice: number, currency: string}>} [priceCatalog]
 * @returns {import('./takeoffTypes.js').TakeoffItem[]}
 */
export function applyPricing(items, priceCatalog = DEFAULT_PRICE_CATALOG) {
  return items.map((item) => {
    const price = priceCatalog[item.itemId];
    if (!price) return { ...item };
    const measure = measureFor(item, price.unit);
    return {
      ...item,
      unitPrice: price.unitPrice,
      priceUnit: price.unit,
      currency: price.currency,
      calculatedCost: Math.round(measure * price.unitPrice * 100) / 100,
    };
  });
}

/**
 * @param {import('./takeoffTypes.js').TakeoffItem[]} items
 * @returns {number}  Sum of calculatedCost across every priced item (unpriced items contribute 0).
 */
export function totalCost(items) {
  return items.reduce((sum, item) => sum + (item.calculatedCost || 0), 0);
}
