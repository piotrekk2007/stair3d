// The linked floor counted into an offer (user request 2026-11-07; decisions: this project's prices, all the items in
// ONE list, the technical page for both floors). The floor is the reference of geometry/referenceStair.js — its own
// project FILE, already built for the shared check:
//  - a self-supporting floor (`reference.other` = a buildStaircase result): its takeoff priced with THIS project's
//    price list / waste / board pricing (its own waivers — the findings accepted in its project), summarised by
//    category — the offer then merges the two summaries (offer/offerModel.js mergeSummaries), so the material, its
//    CNC + projekt share and the separate categories are one;
//  - a concrete floor (`reference.other.kind === 'cladding'`): quoted by the module (cladding/floorOffer.js — handed in
//    by main.js as `priceCladdingFloor`, the only place outside the module that imports it) with this
//    project's price list / board pricing and the floor's own labour (a self-supporting project has none) — its lines
//    added to the offer (offerModel.js appendOfferLines).
// Also used by the concrete module for a self-supporting floor (main.js hands it over — the module never imports the
// engine). Its facts and plan go to the offer's technical page.

import { buildPricedMaterialTakeoff } from '../takeoff/index.js';
import { summarizeByCategory } from '../ui/takeoffView.js';
import { stairFacts, buildOffer } from '../offer/offerModel.js';

/** A self-supporting floor's summary priced with `prices`; null when its validation gate blocks the takeoff. */
export function stairFloorSummary(other, prices, waivers = []) {
  const takeoff = buildPricedMaterialTakeoff(other, { priceList: prices.priceList, wasteFactors: prices.wasteFactors, boardPricing: prices.boardPricing, waivers });
  if (takeoff.status === 'BLOCKED') return { blocked: true, summary: null };
  const winders = new Set((other.treadModels || []).filter((t) => t.type === 'winder').map((t) => t.stepId));
  return { blocked: false, summary: summarizeByCategory(takeoff.items, { winderStepIds: winders }) };
}

/**
 * @param {Object} reference  built.reference (geometry/referenceStair.js buildReferenceModel)
 * @param {{prices: {priceList, wasteFactors?, boardPricing}, renderStairPlan?: (models) => string|null,
 *   priceCladdingFloor?: (file, prices) => {lines, facts, planSvg}}} o
 * @returns {null | {kind: 'stair'|'cladding', name, blocked?, summary?, lines?, facts, planSvg}}
 */
export function linkedFloorOfferPart(reference, { prices, renderStairPlan = () => null, priceCladdingFloor = null }) {
  if (!reference || reference.error || !reference.other) return null;
  const name = reference.name || (reference.level === 'above' ? 'piętro wyżej' : 'piętro niżej');
  const file = reference.ref?.file;
  if (reference.other.kind === 'cladding') {
    if (!priceCladdingFloor) return null;
    const part = priceCladdingFloor(file, { priceList: prices.priceList, boardPricing: prices.boardPricing });
    return { kind: 'cladding', name, lines: part.lines, facts: part.facts, planSvg: part.planSvg };
  }
  const other = reference.other;
  const { blocked, summary } = stairFloorSummary(other, prices, Array.isArray(file?.waivers) ? file.waivers : []);
  const material = [prices.boardPricing?.species, prices.boardPricing?.cls].filter(Boolean).join(', ');
  return { kind: 'stair', name, blocked, summary, facts: stairFacts(other.fullConfig, other.derived, { material }), planSvg: renderStairPlan(other) };
}

/**
 * The same self-supporting floor as offer LINES (for the concrete module, which has no takeoff summary): the floor's
 * material lines as buildOffer makes them, without CNC + projekt, installation or extras (the module's offer has its own).
 */
export function stairFloorOfferLines(reference, { prices, renderStairPlan = () => null }) {
  const part = linkedFloorOfferPart(reference, { prices, renderStairPlan });
  if (!part || part.kind !== 'stair') return part;
  const lines = part.summary ? buildOffer({ summary: part.summary, settings: { cncProjectCostNet: 0, installationCostNet: 0, discountPct: 0 } }).lines : [];
  return { ...part, lines };
}
