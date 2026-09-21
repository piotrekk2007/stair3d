// The deterministic VALIDATION PIPELINE — the one place these two distinct layers meet:
//
//   A. GEOMETRIC / STRUCTURAL CONSTRAINTS (src/constraints/) — what geometry is allowed to
//      exist. Always severity ERROR. Evaluated on already-built MODEL data.
//   B. TECHNICAL VALIDATION RULES (src/rules/) — whether an otherwise geometrically valid
//      staircase is acceptable under a selected profile (legal/best-practice/manufacturing/
//      user-preference). Severity varies (ERROR/WARNING/INFO) per rule.
//
// Order (see docs/architecture/CONSTRAINTS_AND_VALIDATION.md for the full rationale):
//   1. BASIC_NUMERIC          — is the raw config even numerically sane?
//   2. TOPOLOGY               — did buildPlanLayout produce a structurally sound plan?
//   3. GEOMETRIC_CONSTRAINTS  — does the solved geometry satisfy every hard invariant?
//   4. ERGONOMICS             — rule categories B (ergonomic) + D (headroom)
//   5. WINDER                 — rule category C (winder/walkline)
//   6. STRINGER               — rule category F (stringer/stringboard)
//   7. CONSTRUCTION           — rule categories E, G, H, I (construction/connections/structural)
//   8. MANUFACTURING          — rule category J (manufacturing constraints)
//
// A later stage never runs if an earlier stage reports a FATAL problem that makes the later
// stage's inputs meaningless (e.g. there is no plan to check topology on if the config itself
// is numerically broken) — this is what "a later rule must not conceal a failure of an earlier
// geometric rule" means in practice: earlier-stage failures are never silently papered over by
// later-stage output.
//
// This file is the ONLY place that builds a plan from a config for validation purposes AND
// resolves a rule profile — it is intentionally the seam between "geometry" and "rules".
// Manual edits need no separate code path: they are just a `config.manualEdgeOverrides` value,
// and re-running runValidationPipeline(config) re-solves and re-validates everything from
// scratch, exactly like any other config change (see requirement 8, "manual edits go through
// the same solve/validate pipeline").

import { deriveStairData } from '../config/schema.js';
import { buildPlanLayout } from '../geometry/planLayout.js';
import { buildTreadModels } from '../geometry/treadSolver.js';
import { buildRiserModels } from '../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../geometry/stringerSolver.js';
import { evaluateGeometricConstraints } from '../constraints/geometricConstraints.js';
import { resolveProfile } from '../rules/profiles/compose.js';
import { validateFacts } from '../rules/validator.js';
import { buildFacts } from './facts.js';
import { findingsToDiagnostics } from './toDiagnostics.js';
import { createDiagnostic, hasErrors as diagnosticsHaveErrors } from '../diagnostics/diagnostic.js';

export const VALIDATION_STAGES = Object.freeze([
  'BASIC_NUMERIC',
  'TOPOLOGY',
  'GEOMETRIC_CONSTRAINTS',
  'ERGONOMICS',
  'WINDER',
  'STRINGER',
  'CONSTRUCTION',
  'MANUFACTURING',
]);

// Rule categories A-K (src/rules/schema.js CATEGORIES) mapped onto the 8 fixed pipeline
// stages. Category A ("Geometric rules" in the catalogue's own sense — Blondel's formula,
// steps-per-flight limits, width/riser tables) is folded into ERGONOMICS: despite the name
// collision with this file's own GEOMETRIC_CONSTRAINTS stage, these are legal/ergonomic
// code-compliance thresholds (soft, profile-dependent numbers), not hard geometry invariants
// the solver must never violate — exactly the CONSTRAINT-vs-VALIDATION distinction this whole
// pipeline exists to preserve. Category K (validation meta-rules) is deliberately unmapped —
// it describes the rules layer itself, not a staircase property to check against facts.
const STAGE_RULE_CATEGORIES = Object.freeze({
  ERGONOMICS: ['A', 'B', 'D'],
  WINDER: ['C'],
  STRINGER: ['F'],
  CONSTRUCTION: ['E', 'G', 'H', 'I'],
  MANUFACTURING: ['J'],
});

function numericErr(field, message, extra = {}) {
  return createDiagnostic({ ruleId: `BASIC-NUMERIC-${field}`, severity: 'ERROR', elementType: 'config', elementId: field, message, ...extra });
}

// Stage 1 — is the raw config even numerically sane? This runs BEFORE any geometry is built,
// so it must never assume planLayout/derived exist.
export function checkBasicNumericValidity(config) {
  const diags = [];
  const positiveFields = ['totalRise', 'stairWidth', 'treadGoing', 'treadThickness', 'stringerThickness', 'minimumStringerDepthMm'];
  for (const field of positiveFields) {
    const value = config[field];
    if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      diags.push(numericErr(field, `Pole "${field}" musi być dodatnią liczbą skończoną.`, { value: value ?? null, expected: '> 0' }));
    }
  }
  const nonNegativeIntFields = ['treadsLegA', 'treadsLegB', 'treadsLegC', 'windersPerTurn'];
  for (const field of nonNegativeIntFields) {
    const value = config[field];
    if (!(Number.isInteger(value) && value >= 0)) {
      diags.push(numericErr(field, `Pole "${field}" musi być nieujemną liczbą całkowitą.`, { value: value ?? null, expected: '>= 0 (integer)' }));
    }
  }
  if (!(typeof config.walklineOffset === 'number' && config.walklineOffset >= 0)) {
    diags.push(numericErr('walklineOffset', 'Odsunięcie linii biegu nie może być ujemne.', { value: config.walklineOffset ?? null, expected: '>= 0' }));
  }
  return diags;
}

// Stage 2 — did buildPlanLayout produce a structurally sound plan? Assumes planLayout exists
// (the caller only reaches this stage once buildPlanLayout has NOT thrown).
export function checkTopologyValidity(planLayout, derived) {
  const diags = [];
  if (!planLayout.treads || planLayout.treads.length === 0) {
    diags.push(createDiagnostic({ ruleId: 'TOPOLOGY-EMPTY', severity: 'ERROR', elementType: 'stair', elementId: null, message: 'Plan schodów nie zawiera żadnych stopni.' }));
    return diags;
  }
  if (planLayout.treads.length !== derived.numTreads) {
    diags.push(
      createDiagnostic({
        ruleId: 'TOPOLOGY-TREAD-COUNT',
        severity: 'ERROR',
        elementType: 'stair',
        elementId: null,
        value: planLayout.treads.length,
        expected: derived.numTreads,
        message: 'Liczba wygenerowanych stopni nie zgadza się z liczbą wyliczoną z parametrów.',
      })
    );
  }
  planLayout.treads.forEach((t, i) => {
    if (t.index !== i) {
      diags.push(
        createDiagnostic({
          ruleId: 'TOPOLOGY-INDEX-SEQUENCE',
          severity: 'ERROR',
          elementType: 'tread',
          elementId: `step-${i}`,
          value: t.index,
          expected: i,
          message: 'Indeksy stopni w planie nie są kolejną, ciągłą sekwencją.',
        })
      );
    }
  });
  return diags;
}

function runTechnicalRuleStage(rules, facts, categories) {
  const scoped = rules.filter((r) => categories.includes(r.category));
  const findings = validateFacts(facts, scoped);
  return findingsToDiagnostics(findings);
}

/**
 * @param {Object} config      Full staircase config (NOT yet merged with a solved riserHeight —
 *                              this function does that itself, exactly like buildStaircase.js).
 * @param {string} [profileId] Defaults to config.designProfileId.
 * @returns {{
 *   diagnostics: import('../diagnostics/diagnostic.js').Diagnostic[],
 *   stages: Record<string, import('../diagnostics/diagnostic.js').Diagnostic[]>,
 *   hasErrors: boolean,
 *   models: {planLayout, derived, treadModels, riserModels, stringerModels}|null,
 * }}
 */
export function runValidationPipeline(config, profileId = config.designProfileId) {
  const diagnostics = [];
  const stages = {};

  const record = (stage, stageDiags) => {
    stages[stage] = stageDiags;
    diagnostics.push(...stageDiags);
  };

  // 1. BASIC_NUMERIC
  const numericDiags = checkBasicNumericValidity(config);
  record('BASIC_NUMERIC', numericDiags);
  if (diagnosticsHaveErrors(numericDiags)) {
    return { diagnostics, stages, hasErrors: true, models: null };
  }

  // Build geometry. A thrown error here means the config was numerically sane but still
  // geometrically infeasible in a way stage 1 can't detect in isolation (e.g. a winder turn
  // whose walkline offsets exceed its own path length) — reported as a TOPOLOGY-stage fatal
  // rather than propagating a raw exception to the caller.
  let derived, planLayout, fullConfig;
  try {
    derived = deriveStairData(config);
    fullConfig = { ...config, riserHeight: derived.riserHeight };
    planLayout = buildPlanLayout(fullConfig);
  } catch (e) {
    record('TOPOLOGY', [createDiagnostic({ ruleId: 'TOPOLOGY-BUILD-FAILURE', severity: 'ERROR', elementType: 'stair', elementId: null, message: `Nie udało się zbudować planu schodów: ${e.message}` })]);
    return { diagnostics, stages, hasErrors: true, models: null };
  }

  // 2. TOPOLOGY
  const topologyDiags = checkTopologyValidity(planLayout, derived);
  record('TOPOLOGY', topologyDiags);
  if (diagnosticsHaveErrors(topologyDiags)) {
    return { diagnostics, stages, hasErrors: true, models: { planLayout, derived, treadModels: null, riserModels: null, stringerModels: null } };
  }

  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const models = { planLayout, derived, treadModels, riserModels, stringerModels };

  // 3. GEOMETRIC_CONSTRAINTS
  const constraintDiags = evaluateGeometricConstraints({ treadModels, riserModels, stringerModels, config: fullConfig });
  record('GEOMETRIC_CONSTRAINTS', constraintDiags);

  // 4-8. Technical validation rules, scoped to the selected profile.
  const { rules } = resolveProfile(profileId);
  const facts = buildFacts(fullConfig, derived, planLayout, treadModels);

  for (const stage of ['ERGONOMICS', 'WINDER', 'STRINGER', 'CONSTRUCTION', 'MANUFACTURING']) {
    record(stage, runTechnicalRuleStage(rules, facts, STAGE_RULE_CATEGORIES[stage]));
  }

  return { diagnostics, stages, hasErrors: diagnosticsHaveErrors(diagnostics), models };
}
