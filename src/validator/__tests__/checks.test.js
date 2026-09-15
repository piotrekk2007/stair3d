// Tests for the previously-uncovered Validator checklist items (src/validator/checks.js):
// walkline consistency, collisions, invalid points, reversed normals, missing surfaces, and
// the manual-override INFO note. Every positive case runs against a REAL solved staircase;
// every negative case hand-builds a corrupted copy of that same real model — never Three.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildWalklineModel } from '../../geometry/walklineModel.js';
import {
  checkWalklineConsistency,
  checkCollisions,
  checkInvalidPoints,
  checkZeroLengthGeometry,
  checkOutlineWindingConsistency,
  checkRiserNormalOrientation,
  checkMissingRiserSurfaces,
  checkMissingStringerSupport,
  checkManualOverridesApplied,
  evaluateAdditionalChecks,
} from '../checks.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), hasRiserBoards: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const walklineModel = buildWalklineModel(planLayout, fullConfig);
  return { config: fullConfig, derived, planLayout, treadModels, riserModels, stringerModels, walklineModel };
}

// --- Walkline consistency ---

test('checkWalklineConsistency: passes for a real straight and a real winder flight', () => {
  for (const patch of [{ stairType: 'straight', treadsLegA: 6 }, { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 }]) {
    const { treadModels, walklineModel } = build(patch);
    assert.deepEqual(checkWalklineConsistency(walklineModel, treadModels), []);
  }
});

test('checkWalklineConsistency: catches a broken continuity between two points (negative, hand-built)', () => {
  const { treadModels, walklineModel } = build({ stairType: 'straight', treadsLegA: 6 });
  const broken = { ...walklineModel, points: walklineModel.points.map((p, i) => (i === 2 ? { ...p, front: { x: p.front.x + 999, y: p.front.y } } : p)) };
  const diags = checkWalklineConsistency(broken, treadModels);
  assert.ok(diags.some((d) => d.ruleId === 'VALIDATOR-WALKLINE-CONTINUITY'));
});

test('checkWalklineConsistency: catches a coverage mismatch (negative, hand-built)', () => {
  const { treadModels, walklineModel } = build({ stairType: 'straight', treadsLegA: 6 });
  const truncated = { ...walklineModel, points: walklineModel.points.slice(0, -1) };
  const diags = checkWalklineConsistency(truncated, treadModels);
  assert.equal(diags[0].ruleId, 'VALIDATOR-WALKLINE-COVERAGE');
});

// --- Collisions ---

test('checkCollisions: silent when the ceiling opening fits every tread', () => {
  const { config, derived, planLayout, treadModels } = build({ stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, openingLength: 6000, openingWidth: 900, minHeadroom: 1900 });
  assert.deepEqual(checkCollisions(config, planLayout, derived.riserHeight, treadModels), []);
});

test('checkCollisions: flags treads that collide with an undersized ceiling opening', () => {
  const { config, derived, planLayout, treadModels } = build({ stairType: 'straight', treadsLegA: 14, openingLength: 100, openingWidth: 100 });
  const diags = checkCollisions(config, planLayout, derived.riserHeight, treadModels);
  assert.ok(diags.length > 0);
  assert.equal(diags[0].ruleId, 'VALIDATOR-CEILING-COLLISION');
  assert.equal(diags[0].severity, 'ERROR');
});

// --- Invalid points ---

test('checkInvalidPoints: silent for real geometry', () => {
  const { treadModels, riserModels, stringerModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  assert.deepEqual(checkInvalidPoints(treadModels, riserModels, stringerModels), []);
});

test('checkInvalidPoints: catches a NaN coordinate in a tread outline (negative, hand-built)', () => {
  const { treadModels, riserModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const corrupted = treadModels.map((t, i) => (i === 1 ? { ...t, outline: [...t.outline.slice(0, -1), { x: NaN, y: 0 }] } : t));
  const diags = checkInvalidPoints(corrupted, riserModels, stringerModels);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'VALIDATOR-INVALID-POINT');
});

test('checkInvalidPoints: catches an Infinity riser panel endpoint (negative, hand-built)', () => {
  const { treadModels, riserModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const corrupted = riserModels.map((r, i) => (i === 0 ? { ...r, panels: [{ ...r.panels[0], p1: { x: Infinity, y: 0 } }] } : r));
  const diags = checkInvalidPoints(treadModels, corrupted, stringerModels);
  assert.equal(diags.length, 1);
});

// --- Zero-length geometry (riser panels / stringer segments) ---

test('checkZeroLengthGeometry: silent for real geometry', () => {
  const { riserModels, stringerModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  assert.deepEqual(checkZeroLengthGeometry(riserModels, stringerModels), []);
});

test('checkZeroLengthGeometry: catches a zero-width riser panel (negative, hand-built)', () => {
  const { riserModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const corrupted = riserModels.map((r, i) => (i === 1 ? { ...r, panels: [{ ...r.panels[0], p1: { ...r.panels[0].p0 }, width: 0 }] } : r));
  const diags = checkZeroLengthGeometry(corrupted, stringerModels);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'VALIDATOR-ZERO-LENGTH');
});

test('checkZeroLengthGeometry: catches a zero-length stringer reference line (negative, hand-built)', () => {
  const { riserModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const corrupted = {
    ...stringerModels,
    outer: { ...stringerModels.outer, segments: stringerModels.outer.segments.map((s) => ({ ...s, referenceLine: { ...s.referenceLine, length: 0 } })) },
  };
  const diags = checkZeroLengthGeometry(riserModels, corrupted);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].elementType, 'stringer');
});

// --- Reversed normals ---

test('checkOutlineWindingConsistency: passes for a real flight', () => {
  const { treadModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 });
  assert.deepEqual(checkOutlineWindingConsistency(treadModels), []);
});

test('checkOutlineWindingConsistency: catches one tread with reversed winding (negative, hand-built)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 5 });
  const flipped = treadModels.map((t, i) => (i === 2 ? { ...t, outline: [...t.outline].reverse() } : t));
  const diags = checkOutlineWindingConsistency(flipped);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].elementId, 'step-2');
});

test('checkRiserNormalOrientation: passes for a real flight', () => {
  const { treadModels, riserModels } = build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 3, treadsLegB: 3 });
  assert.deepEqual(checkRiserNormalOrientation(treadModels, riserModels), []);
});

test('checkRiserNormalOrientation: catches a riser panel extruding inward (negative, hand-built)', () => {
  const { treadModels, riserModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const flipped = riserModels.map((r, i) => (i === 1 ? { ...r, panels: r.panels.map((p) => ({ ...p, direction: { x: -p.direction.x, y: -p.direction.y } })) } : r));
  const diags = checkRiserNormalOrientation(treadModels, flipped);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'VALIDATOR-REVERSED-NORMAL');
});

test('checkRiserNormalOrientation: skips winder treads (nominal-direction, not a real defect)', () => {
  const { treadModels, riserModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  // Even after "flipping" a winder riser's fan directions, this check must stay silent about
  // it (it's explicitly scoped to straight/landing — see checks.js).
  const flipped = riserModels.map((r) => (r.type === 'winder' ? { ...r, panels: r.panels.map((p) => ({ ...p, direction: { x: -p.direction.x, y: -p.direction.y } })) } : r));
  assert.deepEqual(checkRiserNormalOrientation(treadModels, flipped), []);
});

// --- Missing surfaces ---

test('checkMissingRiserSurfaces: silent when every required riser is present', () => {
  const { treadModels, riserModels, config } = build({ stairType: 'straight', treadsLegA: 5 });
  assert.deepEqual(checkMissingRiserSurfaces(treadModels, riserModels, config), []);
});

test('checkMissingRiserSurfaces: silent when riser boards are disabled', () => {
  const { treadModels, riserModels, config } = build({ stairType: 'straight', treadsLegA: 5, hasRiserBoards: false });
  assert.deepEqual(checkMissingRiserSurfaces(treadModels, riserModels, config), []);
});

test('checkMissingRiserSurfaces: catches a tread with no corresponding riser (negative, hand-built)', () => {
  const { treadModels, riserModels, config } = build({ stairType: 'straight', treadsLegA: 5 });
  const dropped = riserModels.filter((r) => r.stepId !== 'step-2');
  const diags = checkMissingRiserSurfaces(treadModels, dropped, config);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].elementId, 'step-2');
});

test('checkMissingStringerSupport: silent when every tread is supported on both sides', () => {
  const { treadModels, stringerModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  assert.deepEqual(checkMissingStringerSupport(treadModels, stringerModels), []);
});

test('checkMissingStringerSupport: catches a gap in one stringer side (negative, hand-built)', () => {
  const { treadModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 5 });
  const gapped = {
    ...stringerModels,
    outer: { ...stringerModels.outer, segments: stringerModels.outer.segments.map((s) => ({ ...s, treadBearings: s.treadBearings.filter((b) => b.treadIndex !== 2) })) },
  };
  const diags = checkMissingStringerSupport(treadModels, gapped);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].elementId, 'step-2');
});

// --- Manual override INFO note ---

test('checkManualOverridesApplied: silent when nothing was edited', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 5 });
  assert.deepEqual(checkManualOverridesApplied(treadModels), []);
});

test('checkManualOverridesApplied: reports INFO for both treads sharing an actually-applied edit', () => {
  const boundaryIndex = 3;
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const outer = base.planLayout.treads[boundaryIndex - 1].backEdge[1];
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: { x: outer.x + 15, y: outer.y } } } });
  const diags = checkManualOverridesApplied(edited.treadModels);
  assert.equal(diags.length, 2);
  assert.ok(diags.every((d) => d.severity === 'INFO'));
  assert.deepEqual(diags.map((d) => d.elementId).sort(), ['step-2', 'step-3']);
});

test('checkManualOverridesApplied: derives the INFO purely from TreadModel.overridden, not from config.manualEdgeOverrides presence (hand-built)', () => {
  // A tread whose overridden flags are both false must produce no INFO, REGARDLESS of what
  // config says — this is the exact distinction that matters: an edit the solver's own
  // admission-time guard silently rejected (edgeOverrides.js's signedArea check) must never be
  // reported as "applied", because it wasn't.
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 6 });
  const requestedButRejected = treadModels.map((t, i) => (i === 2 ? { ...t, frontEdge: { ...t.frontEdge, overridden: false }, backEdge: { ...t.backEdge, overridden: false } } : t));
  assert.deepEqual(checkManualOverridesApplied(requestedButRejected), []);
});

// --- Aggregator ---

test('evaluateAdditionalChecks: runs cleanly end-to-end on a real winder scenario', () => {
  const { config, derived, planLayout, treadModels, riserModels, stringerModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, stairWidth: 1100 });
  const diags = evaluateAdditionalChecks({ config, derived, planLayout, treadModels, riserModels, stringerModels });
  for (const d of diags) {
    assert.ok(d.ruleId && d.severity && d.elementType && d.message);
  }
});
