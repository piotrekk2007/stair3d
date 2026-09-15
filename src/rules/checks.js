// Declarative, evaluable checks for a curated subset of rules in src/rules/sets/.
//
// Every other file in src/rules/ is pure data (no functions that touch numbers). This file
// is the one deliberate exception: it holds small, pure predicate functions that turn a
// rule's free-text `condition` into something the validator (validator.js) can actually
// run against real numbers. This is NOT geometry — these functions take a plain `facts`
// object (see the Facts contract below) and return a pass/fail verdict with the actual
// value, never touch THREE.js, never import from src/geometry/, and are not wired into
// buildStaircase.js or any other geometry file.
//
// Not every rule in the catalogue has a check here. A rule with no entry in CHECKS is
// "informational only" — the validator reports it as not automatically evaluable rather
// than silently treating it as passed. Coverage should grow deliberately, rule by rule, not
// by guessing at conditions that were never confirmed against a primary source.
//
// --- Facts contract ---
// facts = {
//   buildingType:  'single_family' | 'multi_family' | 'public' | 'healthcare' | 'preschool',
//   stairLocation: 'internal' | 'external',
//   stairMaterial: 'timber' | ... ,
//   riserHeight:   number (mm),
//   treadGoing:    number (mm),
//   stairWidth:    number (mm),
//   winderTreads:  [{ stepId: string, goingAt400mm: number }]  — one entry per winder tread,
//                  "going" measured on a line parallel to the inner edge, 400mm from it (see
//                  src/geometry/walklineModel.js treadGoingAtOffsetFromInner) — this is what
//                  PL-LEGAL-C-01 actually requires, independent of this project's own
//                  configured walklineOffset.
//   straightTreadGoings: [{ stepId: string, going: number }]  — one entry per STRAIGHT tread,
//                  "going" measured on the project's own configured walkline (see
//                  src/geometry/walklineModel.js) — used for GEN-ERGO-B-04 (going consistency
//                  within a straight flight; naturally identical unless a manual edge override
//                  perturbed one boundary).
//   riserHeights:  [number]  — per-riser height in flight order — used for GEN-ERGO-B-03 (riser
//                  height consistency). Structurally uniform today (elevation is always
//                  (index+1)*riserHeight — see treadSolver.js), so this check currently always
//                  passes; it exists so the check is already wired for the day a per-tread
//                  riser height becomes editable.
// }
// Facts are computed by src/validation/facts.js from a real config+planLayout+treadModels —
// this file never computes them itself, never imports src/geometry/.

function pass(actual, expected, unit = 'mm') {
  return { passed: true, actual, expected, unit };
}
function fail(actual, expected, unit = 'mm') {
  return { passed: false, actual, expected, unit };
}

export const CHECKS = {
  'PL-LEGAL-A-01': (facts) => {
    const value = 2 * facts.riserHeight + facts.treadGoing;
    const ok = value >= 600 && value <= 650;
    return ok ? pass(value, '600–650') : fail(value, '600–650');
  },

  'PL-LEGAL-A-05a': (facts) => {
    const widthOk = facts.stairWidth >= 800;
    const riserOk = facts.riserHeight <= 190;
    return {
      passed: widthOk && riserOk,
      criteria: [
        widthOk ? pass(facts.stairWidth, '>= 800') : fail(facts.stairWidth, '>= 800'),
        riserOk ? pass(facts.riserHeight, '<= 190') : fail(facts.riserHeight, '<= 190'),
      ],
    };
  },

  'GEN-ERGO-B-05': (facts) => {
    const ok = facts.riserHeight >= 170 && facts.riserHeight <= 190;
    return ok ? pass(facts.riserHeight, '170–190') : fail(facts.riserHeight, '170–190');
  },

  'CO-STD-B-01': (facts) => {
    const ok = facts.riserHeight >= 150 && facts.riserHeight <= 180;
    return ok ? pass(facts.riserHeight, '150–180') : fail(facts.riserHeight, '150–180');
  },

  'USER-PREF-B-01': (facts) => {
    const ok = facts.riserHeight <= 170;
    return ok ? pass(facts.riserHeight, '<= 170') : fail(facts.riserHeight, '<= 170');
  },

  // Schody kręcone/zabiegowe: min. 250mm szerokości stopnia mierzone 400mm od duszy (§ 69
  // ust. 5) — one criterion PER winder tread, so a violating tread is individually
  // identifiable rather than collapsing the whole flight into one pass/fail.
  'PL-LEGAL-C-01': (facts) => {
    const winders = facts.winderTreads || [];
    const criteria = winders.map((w) => {
      const ok = w.goingAt400mm >= 250;
      const result = ok ? pass(w.goingAt400mm, '>= 250') : fail(w.goingAt400mm, '>= 250');
      return { ...result, elementId: w.stepId };
    });
    return { passed: criteria.every((c) => c.passed), criteria };
  },

  // Tread going should be consistent within a straight flight — a single flat pass/fail on the
  // SPREAD (max-min), rather than per-tread, since "consistent" is a property of the flight as
  // a whole, not of any one tread in isolation (a small named tolerance, not zero, absorbs
  // ordinary floating-point noise from the solver's own transforms).
  'GEN-ERGO-B-04': (facts) => {
    const goings = (facts.straightTreadGoings || []).map((t) => t.going);
    if (goings.length < 2) return pass(0, '<= 5', 'mm');
    const spread = Math.max(...goings) - Math.min(...goings);
    return spread <= 5 ? pass(spread, '<= 5', 'mm') : fail(spread, '<= 5', 'mm');
  },

  // Riser height should be consistent within a flight — see facts contract above: this is
  // structurally guaranteed today (one computed riserHeight applied uniformly), so this check
  // exists as a regression guard for a future per-tread-editable riser height, not because it
  // can currently fail.
  'GEN-ERGO-B-03': (facts) => {
    const heights = facts.riserHeights || [];
    if (heights.length < 2) return pass(0, '<= 1', 'mm');
    const spread = Math.max(...heights) - Math.min(...heights);
    return spread <= 1 ? pass(spread, '<= 1', 'mm') : fail(spread, '<= 1', 'mm');
  },
};

export function hasCheck(ruleId) {
  return Object.prototype.hasOwnProperty.call(CHECKS, ruleId);
}
