// Builds the plain `facts` object src/rules/checks.js expects, from a REAL, already-solved
// staircase (config + derived + planLayout + treadModels). This is the adapter that wires the
// previously-standalone technical rules layer (src/rules/) into actual geometry — see
// CLAUDE.md "Tread / Riser / Post: MODEL/SOLVER split" and docs/rules/PROFILES.md "not yet
// wired into buildStaircase.js" (this file is that wiring, kept in its own layer, per
// .claude/RULES.md rule 10: validation must not live inside the geometry solver).
//
// This file imports src/geometry/ (read-only: it only reads already-built model data) and
// src/rules/ conventions (the Facts contract) — but nothing in src/geometry/ imports this
// file back. The geometry engine stays independent of jurisdiction/rules, exactly as
// required: swapping which profile is checked never requires touching planLayout.js or any
// solver.

import { treadGoingAtOffsetFromInner } from '../geometry/walklineModel.js';

const WINDER_WIDTH_LEGAL_OFFSET_MM = 400; // § 69 ust. 5 — fixed measurement point, not config.walklineOffset

/**
 * @param {Object} config       Full config, including `riserHeight` (as buildStaircase.js merges it)
 * @param {Object} derived      deriveStairData(config) result
 * @param {import('../geometry/planLayout.js').PlanLayout} planLayout
 * @param {import('../geometry/treadSolver.js').TreadModel[]} treadModels
 * @returns {Object} facts — see src/rules/checks.js "Facts contract"
 */
export function buildFacts(config, derived, planLayout, treadModels) {
  const winderTreads = treadModels
    .filter((t) => t.type === 'winder')
    .map((t) => ({
      stepId: t.stepId,
      goingAt400mm: treadGoingAtOffsetFromInner(planLayout.treads[t.index], WINDER_WIDTH_LEGAL_OFFSET_MM),
    }));

  const straightTreadGoings = treadModels
    .filter((t) => t.type === 'straight')
    .map((t) => ({
      stepId: t.stepId,
      going: treadGoingAtOffsetFromInner(planLayout.treads[t.index], config.walklineOffset),
    }));

  // Elevation is always (index+1)*riserHeight (see treadSolver.js) — riser height is therefore
  // always uniform TODAY, but computed from real per-tread elevation deltas (not just repeated
  // from derived.riserHeight) so this stays correct if that ever changes.
  const riserHeights = treadModels.map((t, i) => t.elevation.top - (i === 0 ? 0 : treadModels[i - 1].elevation.top));

  return {
    buildingType: config.buildingType || 'single_family',
    stairLocation: config.stairLocation || 'internal',
    stairMaterial: config.stairMaterial || 'timber',
    riserHeight: derived.riserHeight,
    treadGoing: config.treadGoing,
    stairWidth: config.stairWidth,
    numTreads: derived.numTreads,
    winderTreads,
    straightTreadGoings,
    riserHeights,
  };
}
