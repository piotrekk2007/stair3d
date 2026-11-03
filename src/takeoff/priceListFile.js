// The WHOLE price list as one file (user report 2026-11-03: "Pobierz / Wczytaj CSV" carried only the board table in
// the DREWEX calculator's format, so the balusters', handrails', posts' prices and the post profiles added by hand had
// to be typed in again in every project). Saved: the general price list (balusters, handrail, base rail, glass,
// fittings, bolts, LED, brackets, steel, MDF), the waste factors and the whole board pricing (board table, species
// multipliers, post table, LED power supplies, the chosen species / class, riser material, wanga pricing mode). Not the
// project's own extra rows (`manualItems` — they belong to one job). Read back from such a file or from a project file
// (its price list). Pure: no DOM.

import { sanitizeBoardPricing } from './boardPricing.js';

export const PRICE_LIST_FILE_TYPE = 'schody3d-cennik';
const VERSION = 1;

/** The price list part of the takeoff settings as a file object (JSON-ready). */
export function priceListToFile(settings) {
  return {
    _type: PRICE_LIST_FILE_TYPE,
    _version: VERSION,
    savedAt: new Date().toISOString(),
    priceList: (settings.priceList || []).map(({ materialId, price, currency, unit }) => ({ materialId, price, currency, unit })),
    wasteFactors: { ...(settings.wasteFactors || {}) },
    boardPricing: JSON.parse(JSON.stringify(settings.boardPricing || {})),
  };
}

/**
 * Applies a price list file (or a project file's price list) to `settings`, IN PLACE: prices of the materials the app
 * knows (by `materialId`), waste factors it knows, the whole board pricing (sanitized). Throws on a file that is
 * neither.
 * @returns {{prices: number, posts: number, boards: number}}  what was read (for the message)
 */
export function applyPriceListFile(settings, text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('to nie jest plik cennika (JSON)');
  }
  const source = data?._type === PRICE_LIST_FILE_TYPE ? data : data?._type === 'schody3d-project' ? data.takeoffSettings : null;
  if (!source) throw new Error('to nie jest plik cennika ani projektu schodów');
  let prices = 0;
  for (const incoming of source.priceList || []) {
    const price = (settings.priceList || []).find((p) => p.materialId === incoming?.materialId);
    if (!price || !Number.isFinite(Number(incoming.price))) continue;
    price.price = Number(incoming.price);
    if (incoming.currency) price.currency = incoming.currency;
    prices++;
  }
  for (const [key, value] of Object.entries(source.wasteFactors || {})) {
    if (key in (settings.wasteFactors || {}) && Number.isFinite(Number(value))) settings.wasteFactors[key] = Number(value);
  }
  if (source.boardPricing) settings.boardPricing = sanitizeBoardPricing(source.boardPricing);
  return { prices, posts: settings.boardPricing?.postPrices?.length || 0, boards: settings.boardPricing?.table?.boards?.length || 0 };
}
