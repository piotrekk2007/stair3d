// THE Material Takeoff facade — mirrors src/validator/StaircaseValidator.js's shape on
// purpose: one small, documented entry point composing layers that stay independently
// swappable. Four layers, never merged into one function:
//
//   1. src/takeoff/validationGate.js — "Material Takeoff must NOT silently calculate from
//      invalid construction geometry." Runs the EXISTING Staircase Validator (never
//      reimplemented) before any quantity is computed.
//   2. src/takeoff/materialTakeoff.js — QUANTITIES, derived from the constructional model
//      (TreadModel[]/RiserModel[]/StringerModel+StringerConstructionGeometry/PostModel[]).
//      Never touches Three.js, never computes a cost.
//   3. src/takeoff/wasteFactors.js — the waste/reserve assumption per element type ("odpady" /
//      "zapas materiałowy") — a manufacturing assumption, swappable independently of both
//      geometry and price.
//   4. src/takeoff/pricing.js — COST, joined onto quantities by materialId. A price change is
//      an edit to a price list, never a change to this file or to materialTakeoff.js.
//
// src/takeoff/export/{toCSV,toJSON,toTextReport}.js consume the same MaterialTakeoffItem[]
// shape (src/takeoff/takeoffTypes.js) regardless of which stage produced it.

import { computeMaterialTakeoff } from './materialTakeoff.js';
import { applyPricing, totalCost, DEFAULT_PRICE_LIST } from './pricing.js';
import { runTakeoffValidationGate, GATE_STATUS } from './validationGate.js';
import { takeoffToCSV } from './export/toCSV.js';
import { takeoffToJSON } from './export/toJSON.js';
import { takeoffToTextReport } from './export/toTextReport.js';

/**
 * @typedef {import('./takeoffTypes.js').MaterialTakeoffItem} MaterialTakeoffItem
 */

/**
 * @typedef {Object} MaterialTakeoffResult
 * @property {keyof GATE_STATUS} status  BLOCKED -> items is always []. WARNING -> items were
 *   computed despite non-fatal validation findings. OK -> no findings at all.
 * @property {import('../diagnostics/diagnostic.js').Diagnostic[]} diagnostics  Every gate
 *   finding (Staircase Validator + stringer construction geometry diagnostics), regardless of
 *   status.
 * @property {import('../diagnostics/diagnostic.js').Diagnostic[]} activeDiagnostics  Findings that
 *   count toward the status (i.e. not waived by the user).
 * @property {import('../diagnostics/diagnostic.js').Diagnostic[]} waivedDiagnostics  Findings the
 *   user explicitly accepted (options.waivers) — still reported, never hidden, but they no longer
 *   block the takeoff.
 * @property {Array} staleWaivers  Waivers that currently match nothing.
 * @property {MaterialTakeoffItem[]} items
 */

/**
 * Quantities only — no cost. Runs the validation gate FIRST: an ERROR-level finding blocks the
 * takeoff (`status: 'BLOCKED'`, `items: []`) rather than computing a misleading quantity from
 * invalid geometry. Use this directly when you want to apply pricing yourself.
 *
 * @param {Object} models  The same shape buildStaircase() returns: { fullConfig|config,
 *   derived, planLayout, treadModels, riserModels, stringerModels, stringerConstruction,
 *   postModels }.
 * @param {{wasteFactors?: Object, profileId?: string, waivers?: import('../diagnostics/waivers.js').Waiver[]}} [options]
 *   `waivers` — findings the user explicitly accepted; they stop blocking the gate (see
 *   validationGate.js) but stay in the result.
 * @returns {MaterialTakeoffResult}
 */
export function buildMaterialTakeoff(models, options = {}) {
  const gate = runTakeoffValidationGate(models, { profileId: options.profileId, waivers: options.waivers });
  const findings = {
    diagnostics: gate.diagnostics,
    activeDiagnostics: gate.activeDiagnostics,
    waivedDiagnostics: gate.waivedDiagnostics,
    staleWaivers: gate.staleWaivers,
  };
  if (gate.status === GATE_STATUS.BLOCKED) {
    return { status: gate.status, ...findings, items: [] };
  }
  const config = models.fullConfig ?? models.config;
  const items = computeMaterialTakeoff(models, config, { wasteFactors: options.wasteFactors });
  return { status: gate.status, ...findings, items };
}

/**
 * Quantities + cost in one call — the common case for a UI/report that wants a fully-priced
 * bill of materials immediately. Same validation-gate behavior as `buildMaterialTakeoff`.
 *
 * @param {Object} models
 * @param {{wasteFactors?: Object, priceList?: import('./pricing.js').MaterialPrice[], profileId?: string}} [options]
 * @returns {MaterialTakeoffResult & { totalCost: number }}
 */
export function buildPricedMaterialTakeoff(models, options = {}) {
  const takeoff = buildMaterialTakeoff(models, options);
  if (takeoff.status === GATE_STATUS.BLOCKED) return { ...takeoff, totalCost: 0 };
  const priced = applyPricing(takeoff.items, options.priceList || DEFAULT_PRICE_LIST);
  return { ...takeoff, items: priced, totalCost: totalCost(priced) };
}

export { applyPricing, totalCost, DEFAULT_PRICE_LIST, GATE_STATUS, runTakeoffValidationGate, takeoffToCSV, takeoffToJSON, takeoffToTextReport };
