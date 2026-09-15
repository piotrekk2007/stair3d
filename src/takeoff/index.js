// THE Material Takeoff facade (src/takeoff/index.js) — mirrors src/validator/
// StaircaseValidator.js's shape for the same reason: one small, documented entry point
// composing layers that stay independently swappable. Three layers, on purpose, never merged
// into one function:
//
//   1. src/takeoff/materialTakeoff.js — QUANTITIES, derived from the constructional model
//      (TreadModel[]/RiserModel[]/StringerModel/PostModel[]). Never touches Three.js, never
//      computes a cost.
//   2. src/takeoff/wasteFactors.js — the waste/reserve assumption per element type ("odpady" /
//      "zapas materiałowy") — a manufacturing assumption, swappable independently of both
//      geometry and price.
//   3. src/takeoff/pricing.js — COST, joined onto quantities by itemId. A price change is an
//      edit to a price catalog, never a change to this file or to materialTakeoff.js.
//
// src/takeoff/export/{toCSV,toJSON,toTextReport}.js consume the same TakeoffItem[] shape
// (src/takeoff/takeoffTypes.js) regardless of which stage produced it — CSV/JSON are ready now;
// toTextReport.js's plain-text lines are the intended PDF export point (see that file's header
// for why no PDF library is wired in yet).

import { computeMaterialTakeoff } from './materialTakeoff.js';
import { applyPricing, totalCost, DEFAULT_PRICE_CATALOG } from './pricing.js';
import { takeoffToCSV } from './export/toCSV.js';
import { takeoffToJSON } from './export/toJSON.js';
import { takeoffToTextReport } from './export/toTextReport.js';

/**
 * @typedef {import('./takeoffTypes.js').TakeoffItem} TakeoffItem
 */

/**
 * Quantities only — no cost. Use this directly when you want to apply pricing yourself, or
 * inspect/export quantities independent of any price catalog.
 *
 * @param {Object} models  { treadModels, riserModels, stringerModels, postModels }
 * @param {Object} config  Full config (post riserHeight merge)
 * @param {{wasteFactors?: Object}} [options]
 * @returns {TakeoffItem[]}
 */
export function buildTakeoff(models, config, options = {}) {
  return computeMaterialTakeoff(models, config, options);
}

/**
 * Quantities + cost in one call — the common case for a UI/report that wants a fully-priced
 * bill of materials immediately.
 *
 * @param {Object} models
 * @param {Object} config
 * @param {{wasteFactors?: Object, priceCatalog?: Object}} [options]
 * @returns {{ items: TakeoffItem[], totalCost: number }}
 */
export function buildPricedTakeoff(models, config, options = {}) {
  const items = computeMaterialTakeoff(models, config, options);
  const priced = applyPricing(items, options.priceCatalog || DEFAULT_PRICE_CATALOG);
  return { items: priced, totalCost: totalCost(priced) };
}

export { applyPricing, totalCost, DEFAULT_PRICE_CATALOG, takeoffToCSV, takeoffToJSON, takeoffToTextReport };
