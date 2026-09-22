// End-to-end tests for the validation pipeline: config -> geometry -> constraints ->
// technical rules -> structured diagnostics. Covers every scenario in the task's test matrix
// (A-J) plus negative cases where the pipeline must report (not silently accept, and never
// crash on) an invalid configuration.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { runValidationPipeline, VALIDATION_STAGES, checkBasicNumericValidity, checkTopologyValidity } from '../pipeline.js';

function config(patch) {
  return { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', ...patch };
}

test('VALIDATION_STAGES is the documented, deterministic 8-stage order', () => {
  assert.deepEqual(VALIDATION_STAGES, ['BASIC_NUMERIC', 'TOPOLOGY', 'GEOMETRIC_CONSTRAINTS', 'ERGONOMICS', 'WINDER', 'STRINGER', 'CONSTRUCTION', 'MANUFACTURING']);
});

// --- A-J: valid scenarios all reach every stage with zero geometric-constraint violations ---

for (const [label, patch] of [
  ['A. straight flight', { stairType: 'straight', treadsLegA: 6 }],
  ['B. L-winder', { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 }],
  ['C. L-landing', { stairType: 'L', turn1Type: 'landing', treadsLegA: 3, treadsLegB: 3 }],
  ['D. U-double-winder', { stairType: 'U', turn1Type: 'winder', turn2Type: 'winder', treadsLegA: 2, treadsLegB: 2, treadsLegC: 2, windersPerTurn: 5 }],
  ['E. asymmetric winder', { stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, walklineSplitOffset: 900 }],
  ['F. manual edge override', { stairType: 'straight', treadsLegA: 6, manualEdgeOverrides: { 3: { movedEndpoint: 'outer', point: { x: -35, y: 3 * 270 } } } }],
  ['G. changed stair width', { stairType: 'straight', treadsLegA: 6, stairWidth: 1100 }],
  ['H. changed riser height (via totalRise)', { stairType: 'straight', treadsLegA: 6, totalRise: 3000 }],
  ['I. changed walkline offset', { stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, walklineOffset: 350 }],
  ['J. changed stringer spacing (stairWidth) with a winder', { stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, stairWidth: 1200 }],
]) {
  test(`runValidationPipeline: ${label} runs every stage and reports zero GEOMETRIC_CONSTRAINTS violations`, () => {
    const result = runValidationPipeline(config(patch));
    assert.ok(result.models, 'models must have been built for a valid scenario');
    for (const stage of VALIDATION_STAGES) {
      assert.ok(Object.prototype.hasOwnProperty.call(result.stages, stage), `stage ${stage} must have run`);
    }
    assert.deepEqual(result.stages.GEOMETRIC_CONSTRAINTS, [], `expected no constraint violations for "${label}"`);
    // Every diagnostic (from any stage) must be well-formed.
    for (const d of result.diagnostics) {
      assert.ok(d.ruleId && d.severity && d.elementType && d.message, `malformed diagnostic: ${JSON.stringify(d)}`);
    }
  });
}

test('runValidationPipeline: a legally-compliant residential straight flight has zero ERROR-severity diagnostics', () => {
  // treadGoing/riserHeight chosen to satisfy PL-LEGAL-A-01 (Blondel 600-650) and
  // PL-LEGAL-A-05a (stairWidth>=800, riserHeight<=190) under the default profile's context.
  const result = runValidationPipeline(config({ stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, stairWidth: 900 }));
  const errors = result.diagnostics.filter((d) => d.severity === 'ERROR');
  assert.deepEqual(errors, [], `expected a compliant staircase to have zero ERROR diagnostics, got: ${JSON.stringify(errors, null, 2)}`);
});

// --- Winder-width validation is actually wired end-to-end (PL-LEGAL-C-01) ---

test('runValidationPipeline: WINDER stage flags a winder tread narrower than 250mm at 400mm from the inner edge', () => {
  // A tight turn (few winders, small offsets) squeezes the inner part of each winder tread.
  const result = runValidationPipeline(
    config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 3, walklineOffset: 400, walklineSplitOffset: 400, stairWidth: 700 })
  );
  const winderDiags = result.stages.WINDER;
  const c01 = winderDiags.find((d) => d.ruleId === 'PL-LEGAL-C-01');
  assert.ok(c01, `expected a PL-LEGAL-C-01 diagnostic for a tight winder turn, got WINDER stage: ${JSON.stringify(winderDiags, null, 2)}`);
  assert.equal(c01.severity, 'ERROR');
  assert.ok(c01.elementId?.startsWith('step-'));
});

test('runValidationPipeline: WINDER stage is silent on PL-LEGAL-C-01 for a straight flight (no winder treads)', () => {
  const result = runValidationPipeline(config({ stairType: 'straight', treadsLegA: 6 }));
  assert.ok(!result.stages.WINDER.some((d) => d.ruleId === 'PL-LEGAL-C-01'));
});

// --- Negative tests: the pipeline must REPORT, never crash on or silently accept, bad input ---

test('checkBasicNumericValidity: catches a negative stairWidth before any geometry is built', () => {
  const diags = checkBasicNumericValidity(config({ stairWidth: -100 }));
  assert.ok(diags.some((d) => d.ruleId === 'BASIC-NUMERIC-stairWidth'));
});

test('checkBasicNumericValidity: catches a non-integer treadsLegA', () => {
  const diags = checkBasicNumericValidity(config({ treadsLegA: 2.5 }));
  assert.ok(diags.some((d) => d.ruleId === 'BASIC-NUMERIC-treadsLegA'));
});

test('runValidationPipeline: a negative stairWidth is reported at BASIC_NUMERIC and stops before TOPOLOGY', () => {
  const result = runValidationPipeline(config({ stairWidth: -100 }));
  assert.equal(result.hasErrors, true);
  assert.equal(result.models, null);
  assert.ok(result.stages.BASIC_NUMERIC.some((d) => d.severity === 'ERROR'));
  assert.equal(result.stages.TOPOLOGY, undefined, 'TOPOLOGY must not run once BASIC_NUMERIC has a fatal error');
});

test('runValidationPipeline: zero treads is reported, not crashed on', () => {
  const result = runValidationPipeline(config({ stairType: 'straight', treadsLegA: 0 }));
  assert.equal(result.hasErrors, true);
  assert.ok(result.diagnostics.some((d) => d.severity === 'ERROR'));
});

test('runValidationPipeline: an absurdly small flight (too few risers for the total rise) builds without crashing and is caught by ERGONOMICS (Blondel), not silently accepted', () => {
  // Very few treads over a normal totalRise forces a huge riserHeight (700mm here) — the
  // solver still builds valid, non-degenerate geometry (no constraint violation), but it is
  // legally/ergonomically absurd. This proves category-A technical rules (Blondel) are
  // actually wired into the pipeline, not just the hard geometric constraints.
  const result = runValidationPipeline(config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 1, treadsLegB: 1, windersPerTurn: 1, treadGoing: 50, walklineOffset: 400, walklineSplitOffset: 400 }));
  assert.deepEqual(result.stages.GEOMETRIC_CONSTRAINTS, []);
  assert.equal(result.hasErrors, true);
  assert.ok(result.stages.ERGONOMICS.some((d) => d.ruleId === 'PL-LEGAL-A-01' && d.severity === 'ERROR'), 'expected the Blondel formula violation to be reported');
});

test('checkTopologyValidity: catches a tread-count mismatch (negative, hand-built)', () => {
  const planLayout = { treads: [{ index: 0 }, { index: 1 }] };
  const derived = { numTreads: 3 };
  const diags = checkTopologyValidity(planLayout, derived);
  assert.ok(diags.some((d) => d.ruleId === 'TOPOLOGY-TREAD-COUNT'));
});

test('checkTopologyValidity: catches a non-sequential tread index (negative, hand-built)', () => {
  const planLayout = { treads: [{ index: 0 }, { index: 5 }] };
  const derived = { numTreads: 2 };
  const diags = checkTopologyValidity(planLayout, derived);
  assert.ok(diags.some((d) => d.ruleId === 'TOPOLOGY-INDEX-SEQUENCE'));
});
