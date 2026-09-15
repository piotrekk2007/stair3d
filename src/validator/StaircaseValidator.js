// THE independent Staircase Validator — the single, product-facing entry point for "is this
// staircase okay?". It NEVER changes geometry: every function here is read-only, consuming
// already-solved model data (or, for the convenience entry point, a config it solves internally
// exactly the same way buildStaircase.js does) and returning structured findings — it never
// writes back into config, never mutates a model, and never touches Three.js.
//
// It does not reimplement checking logic that already exists — it COMPOSES three layers that
// were each built independently, in their own architectural stage, and never duplicated here:
//
//   1. src/constraints/geometricConstraints.js — hard geometric/structural invariants (always
//      ERROR): step ordering, frontEdge/backEdge direction semantics, non-degenerate edges/
//      widths, simple tread polygons, topological continuity, stringer straightness/
//      parallelism/spacing, bearing attachment, riser-follows-final-edge.
//   2. src/rules/ (catalogue + profiles) + src/validation/facts.js — technical/ergonomic/legal
//      rules (ERROR/WARNING/INFO, profile-dependent): riser height, tread-going range and
//      consistency, Blondel, winder minimum width, and so on.
//   3. src/validator/checks.js — the remaining checklist items that had no home in either layer
//      above: walkline consistency, collisions (headroom/ceiling), invalid points (NaN/
//      Infinity), reversed normals, missing surfaces, and an informational note for every
//      manually-edited boundary.
//
// --- Extending with norm/building-code-specific rules -----------------------------------------
//
// This Validator does NOT invent its own plugin/registration framework for that — one already
// exists, on purpose, from an earlier architecture stage: src/rules/sets/*.js (one rule set per
// source — a jurisdiction's law, a trade body's guidance, a company's manufacturing standard)
// and src/rules/profiles/ (which bundles rule sets into a named, swappable profile such as
// `POLAND_RESIDENTIAL_TIMBER_DEFAULT`). To add a new norm:
//
//   1. Add a new rule-set file under src/rules/sets/ (see plWarunkiTechniczne.js for the shape:
//      ruleId/category/description/ruleType/jurisdiction/source/severity/blocksGeneration).
//   2. If the rule needs a numeric check (not every rule does — see src/rules/README.md), add
//      one predicate to src/rules/checks.js, reading from the `facts` object built in
//      src/validation/facts.js (extend that adapter if the rule needs a fact nothing computes
//      yet — e.g. a new per-tread measurement).
//   3. Reference the new rule set from a profile in src/rules/profiles/definitions.js (a new
//      profile, or an additional layer on an existing one).
//
// No change to StaircaseValidator.js, geometricConstraints.js, or any geometry solver is ever
// needed to add a norm-specific rule — this is the "independent change" property the whole
// profile system exists to provide (see docs/rules/PROFILES.md).

import { deriveStairData } from '../config/schema.js';
import { buildPlanLayout } from '../geometry/planLayout.js';
import { buildTreadModels } from '../geometry/treadSolver.js';
import { buildRiserModels } from '../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../geometry/stringerSolver.js';
import { evaluateGeometricConstraints } from '../constraints/geometricConstraints.js';
import { resolveProfile } from '../rules/profiles/compose.js';
import { validateFacts } from '../rules/validator.js';
import { buildFacts } from '../validation/facts.js';
import { findingsToDiagnostics } from '../validation/toDiagnostics.js';
import { runValidationPipeline } from '../validation/pipeline.js';
import { evaluateAdditionalChecks } from './checks.js';
import { hasErrors, hasWarnings, filterBySeverity } from '../diagnostics/diagnostic.js';

/**
 * @typedef {import('../diagnostics/diagnostic.js').Diagnostic} StaircaseFinding
 */

/**
 * @typedef {Object} StaircaseValidationResult
 * @property {StaircaseFinding[]} diagnostics  Every finding, in pipeline stage order.
 * @property {StaircaseFinding[]} errors
 * @property {StaircaseFinding[]} warnings
 * @property {StaircaseFinding[]} info
 * @property {boolean} hasErrors
 * @property {boolean} hasWarnings
 * @property {Object|null} models   The models the Validator built/consumed (null only when a
 *   BASIC_NUMERIC-stage error made it unsafe to build any geometry at all).
 */

/**
 * The main convenience entry point: give it a config, get back every finding. Builds geometry
 * internally (the same solvers `buildStaircase.js` uses) purely to READ it — nothing here is
 * kept, mutated, or reused as a rendering side-effect.
 *
 * @param {Object} config
 * @param {{profileId?: string}} [options]
 * @returns {StaircaseValidationResult}
 */
export function validateStaircase(config, options = {}) {
  const profileId = options.profileId ?? config.designProfileId;
  const pipelineResult = runValidationPipeline(config, profileId);
  const additional = pipelineResult.models?.treadModels
    ? evaluateAdditionalChecks({
        config,
        derived: pipelineResult.models.derived,
        planLayout: pipelineResult.models.planLayout,
        treadModels: pipelineResult.models.treadModels,
        riserModels: pipelineResult.models.riserModels,
        stringerModels: pipelineResult.models.stringerModels,
      })
    : [];

  const diagnostics = [...pipelineResult.diagnostics, ...additional];
  return {
    diagnostics,
    errors: filterBySeverity(diagnostics, 'ERROR'),
    warnings: filterBySeverity(diagnostics, 'WARNING'),
    info: filterBySeverity(diagnostics, 'INFO'),
    hasErrors: hasErrors(diagnostics),
    hasWarnings: hasWarnings(diagnostics),
    models: pipelineResult.models,
  };
}

const RULE_CATEGORIES_BY_STAGE = Object.freeze({
  ERGONOMICS: ['A', 'B', 'D'],
  WINDER: ['C'],
  STRINGER: ['F'],
  CONSTRUCTION: ['E', 'G', 'H', 'I'],
  MANUFACTURING: ['J'],
});

// Reuses the exact building blocks src/validation/pipeline.js's own stages 3-8 use
// (evaluateGeometricConstraints, resolveProfile, buildFacts, findingsToDiagnostics) — never a
// second implementation of any of them. Stages 1-2 (BASIC_NUMERIC/TOPOLOGY) don't apply here:
// they exist to decide whether it's safe to BUILD models at all, and validateModels' caller has
// already built them.
function runRuleAndConstraintChecks({ config, derived, planLayout, treadModels, riserModels, stringerModels }, profileId) {
  const diagnostics = [...evaluateGeometricConstraints({ treadModels, riserModels, stringerModels, config })];
  const { rules } = resolveProfile(profileId);
  const facts = buildFacts(config, derived, planLayout, treadModels);
  for (const categories of Object.values(RULE_CATEGORIES_BY_STAGE)) {
    diagnostics.push(...findingsToDiagnostics(validateFacts(facts, rules.filter((r) => categories.includes(r.category)))));
  }
  return diagnostics;
}

/**
 * The "already have models" variant — for a caller (e.g. a future UI panel, or a test) that
 * built `planLayout`/`treadModels`/`riserModels`/`stringerModels` itself and wants to validate
 * those EXACT objects without paying to rebuild them a second time.
 *
 * @param {Object} models  { config, derived, planLayout, treadModels, riserModels, stringerModels }
 * @param {{profileId?: string}} [options]
 * @returns {StaircaseValidationResult}
 */
export function validateModels(models, options = {}) {
  const { config, derived, planLayout, treadModels, riserModels, stringerModels } = models;
  const profileId = options.profileId ?? config.designProfileId;

  const diagnostics = [
    ...runRuleAndConstraintChecks({ config, derived, planLayout, treadModels, riserModels, stringerModels }, profileId),
    ...evaluateAdditionalChecks({ config, derived, planLayout, treadModels, riserModels, stringerModels }),
  ];

  return {
    diagnostics,
    errors: filterBySeverity(diagnostics, 'ERROR'),
    warnings: filterBySeverity(diagnostics, 'WARNING'),
    info: filterBySeverity(diagnostics, 'INFO'),
    hasErrors: hasErrors(diagnostics),
    hasWarnings: hasWarnings(diagnostics),
    models,
  };
}

// Convenience formatter matching the Validator's own display convention — LEVEL / step /
// message — for a caller with no UI of its own yet (a CLI, a quick console report). Structured
// consumers should use the `diagnostics` array directly (element/step/parameter/value/expected
// are all there); this is purely a human-readable rendering of the same data.
export function formatFinding(diagnostic) {
  const location = diagnostic.elementId || diagnostic.elementType;
  return `${diagnostic.severity}\n${location}\n${diagnostic.message}`;
}

export function formatReport(diagnostics) {
  return diagnostics.map(formatFinding).join('\n\n');
}

// Re-exported so a caller can build models itself (e.g. to feed validateModels) using exactly
// the same solvers this file uses internally, without importing five separate modules.
export { deriveStairData, buildPlanLayout, buildTreadModels, buildRiserModels, buildStringerModelsForFlight };
