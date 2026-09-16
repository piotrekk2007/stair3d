// VALIDATION GATE — "Material Takeoff must NOT silently calculate from invalid construction
// geometry." Runs the EXISTING, independent Staircase Validator (never reimplemented here)
// plus one additional diagnostic source the Validator doesn't yet see: each
// StringerConstructionGeometry segment's own `diagnostics` (self-intersection, insufficient
// remaining section — see stringerConstructionGeometry.js). Read-only, like the Validator
// itself: never mutates a model, never touches Three.js.
//
// Gate rule (literal, deliberately simple — see docs for the documented limitation this
// implies): ANY ERROR-severity diagnostic from either source blocks the takeoff entirely.
// WARNING-only lets the takeoff compute normally but reports GATE_STATUS.WARNING. No
// diagnostics at all (or INFO-only) reports GATE_STATUS.OK.

import { validateModels } from '../validator/StaircaseValidator.js';

export const GATE_STATUS = Object.freeze({
  OK: 'OK',
  WARNING: 'WARNING',
  BLOCKED: 'BLOCKED',
});

function collectStringerConstructionDiagnostics(stringerConstruction) {
  const all = [];
  for (const side of ['outer', 'inner']) {
    for (const geo of stringerConstruction[side] || []) {
      for (const d of geo.diagnostics || []) all.push(d);
    }
  }
  return all;
}

/**
 * @param {Object} models  { fullConfig|config, derived, planLayout, treadModels, riserModels,
 *   stringerModels, stringerConstruction, postModels } — the same shape buildStaircase()
 *   returns (accepts `fullConfig` OR `config` as the config field, matching that function's
 *   own naming).
 * @param {{profileId?: string}} [options]
 * @returns {{status: keyof GATE_STATUS, diagnostics: import('../diagnostics/diagnostic.js').Diagnostic[],
 *   errors: Array, warnings: Array, info: Array}}
 */
export function runTakeoffValidationGate(models, options = {}) {
  const config = models.fullConfig ?? models.config;
  const validatorResult = validateModels(
    {
      config,
      derived: models.derived,
      planLayout: models.planLayout,
      treadModels: models.treadModels,
      riserModels: models.riserModels,
      stringerModels: models.stringerModels,
    },
    options
  );

  const diagnostics = [...validatorResult.diagnostics, ...collectStringerConstructionDiagnostics(models.stringerConstruction || {})];
  const errors = diagnostics.filter((d) => d.severity === 'ERROR');
  const warnings = diagnostics.filter((d) => d.severity === 'WARNING');
  const info = diagnostics.filter((d) => d.severity === 'INFO');

  const status = errors.length > 0 ? GATE_STATUS.BLOCKED : warnings.length > 0 ? GATE_STATUS.WARNING : GATE_STATUS.OK;

  return { status, diagnostics, errors, warnings, info };
}
