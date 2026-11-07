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

import { buildPricedMaterialTakeoff, DEFAULT_PRICE_LIST } from '../takeoff/index.js';
import { DEFAULT_WASTE_FACTORS } from '../takeoff/wasteFactors.js';
import { createDefaultBoardPricing, sanitizeBoardPricing } from '../takeoff/boardPricing.js';
import { createDefaultManualItems, sanitizeManualItems } from '../takeoff/manualItems.js';
import { summarizeByCategory } from '../ui/takeoffView.js';
import { stairFacts, buildOffer, sanitizeOfferSettings } from '../offer/offerModel.js';

// TWO KINDS of stair (user decision 2026-11-07): a self-supporting and a concrete floor price differently (the
// wangi in one, the richer installation labour in the other) — each is then priced from ITS OWN project file: its price
// list, its manual rows, its CNC + projekt and installation (a concrete one: its quote with its labour, its extras).
// The discount and the VAT are the offer's (applied once, to everything). Two floors of the same kind: this project's
// prices (the earlier decision).

/** A self-supporting project file's own prices (as main.js applyProjectFile reads them onto the defaults). */
export function stairFilePrices(file) {
  const t = file?.takeoffSettings || {};
  const priceList = DEFAULT_PRICE_LIST.map((p) => ({ ...p }));
  for (const incoming of t.priceList || []) {
    const price = priceList.find((p) => p.materialId === incoming?.materialId);
    if (price) Object.assign(price, incoming);
  }
  return {
    priceList,
    wasteFactors: { ...DEFAULT_WASTE_FACTORS, ...(t.wasteFactors || {}) },
    boardPricing: t.boardPricing ? sanitizeBoardPricing(t.boardPricing) : createDefaultBoardPricing(),
    manualItems: t.manualItems ? sanitizeManualItems(t.manualItems) : createDefaultManualItems(),
  };
}

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
 * A self-supporting floor as offer LINES for a CONCRETE offer (another kind of stair — its own file's prices): the lines
 * its own offer would print (its price list, manual rows, CNC + projekt spread over the material, installation), the
 * discount left to the concrete offer.
 */
export function stairFloorOfferLines(reference, { renderStairPlan = () => null } = {}) {
  const file = reference?.ref?.file;
  const own = stairFilePrices(file);
  const part = linkedFloorOfferPart(reference, { prices: own, renderStairPlan });
  if (!part || part.kind !== 'stair') return part;
  const settings = { ...sanitizeOfferSettings(file?.offer), discountPct: 0 };
  const lines = part.summary ? buildOffer({ summary: part.summary, manualItems: own.manualItems, settings }).lines : [];
  return { ...part, lines, ownPrices: true };
}
