// Constraint tests operate on plain MODEL data (TreadModel[]/StringerModel), never on
// THREE.js — including the negative cases, which hand-build a deliberately corrupted model
// object rather than trying to coax the UI/solver into producing one (the solver's own
// edgeOverrides.js guard already rejects most obviously-degenerate manual edits before they
// ever reach a model — see its "signedArea guard" — so a corrupted model here demonstrates
// what the CONSTRAINT layer catches as defense-in-depth, independent of the solver's own
// admission-time defenses).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import {
  checkStepOrdering,
  checkEdgeDirectionSemantics,
  checkNoZeroLengthEdges,
  checkNoNegativeTreadWidth,
  checkOutlineNotSelfIntersecting,
  checkTopologicalContinuity,
  checkStringerPairInvariants,
  checkBearingAttachment,
  checkRiserFollowsFinalTreadEdge,
  evaluateGeometricConstraints,
} from '../geometricConstraints.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasRiserBoards: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  return { config: fullConfig, planLayout, treadModels, riserModels, stringerModels };
}

// --- Positive cases: every scenario used elsewhere in the project must be constraint-clean ---

for (const [label, patch] of [
  ['straight flight', { stairType: 'straight', treadsLegA: 6 }],
  ['L-winder', { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 }],
  ['L-landing', { stairType: 'L', turn1Type: 'landing', treadsLegA: 3, treadsLegB: 3 }],
  ['U-double-winder', { stairType: 'U', turn1Type: 'winder', turn2Type: 'winder', treadsLegA: 2, treadsLegB: 2, treadsLegC: 2, windersPerTurn: 5 }],
  ['asymmetric winder (walklineSplitOffset)', { stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, walklineSplitOffset: 700 }],
  ['manual edge override', { stairType: 'straight', treadsLegA: 6, manualEdgeOverrides: { 3: { movedEndpoint: 'outer', point: { x: -35, y: 3 * 270 } } } }],
  ['changed stair width', { stairType: 'straight', treadsLegA: 6, stairWidth: 1200 }],
  ['changed stringer spacing (stairWidth) with a winder', { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, stairWidth: 1100 }],
]) {
  test(`evaluateGeometricConstraints: ${label} produces zero violations`, () => {
    const { treadModels, riserModels, stringerModels, config } = build(patch);
    const diagnostics = evaluateGeometricConstraints({ treadModels, riserModels, stringerModels, config });
    assert.deepEqual(diagnostics, [], `expected no constraint violations, got: ${JSON.stringify(diagnostics, null, 2)}`);
  });
}

test('checkRiserFollowsFinalTreadEdge: passes for a normally-built flight (nominal === final)', () => {
  const { treadModels, riserModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 });
  assert.deepEqual(checkRiserFollowsFinalTreadEdge(treadModels, riserModels), []);
});

test('checkRiserFollowsFinalTreadEdge: catches a riser panel left on stale/nominal geometry (negative, hand-built)', () => {
  const { treadModels, riserModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const staleRiser = riserModels.map((r, i) => (i === 1 ? { ...r, panels: [{ ...r.panels[0], p1: { x: r.panels[0].p1.x + 999, y: r.panels[0].p1.y } }] } : r));
  const diags = checkRiserFollowsFinalTreadEdge(treadModels, staleRiser);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-RISER-FOLLOWS-FINAL-EDGE');
});

test('checkStepOrdering: passes for a normally-built flight', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 5 });
  assert.deepEqual(checkStepOrdering(treadModels), []);
});

test('checkStepOrdering: catches an out-of-order index (negative, hand-built)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const corrupted = treadModels.map((t, i) => (i === 2 ? { ...t, index: 99 } : t));
  const diags = checkStepOrdering(corrupted);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-STEP-ORDER');
  assert.equal(diags[0].severity, 'ERROR');
  assert.equal(diags[0].elementId, corrupted[2].stepId);
});

test('checkEdgeDirectionSemantics: catches a reversed front/back edge (negative, hand-built)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const swapped = treadModels.map((t, i) =>
    i === 1 ? { ...t, frontEdge: { ...t.frontEdge, final: t.backEdge.final }, backEdge: { ...t.backEdge, final: t.frontEdge.final } } : t
  );
  const diags = checkEdgeDirectionSemantics(swapped);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-EDGE-DIRECTION');
});

test('checkNoZeroLengthEdges: catches a degenerate (zero-width) frontEdge (negative, hand-built)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const collapsed = treadModels.map((t, i) => (i === 0 ? { ...t, frontEdge: { ...t.frontEdge, final: [t.frontEdge.final[0], t.frontEdge.final[0]] } } : t));
  const diags = checkNoZeroLengthEdges(collapsed);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-EDGE-NONDEGENERATE');
});

test('checkNoNegativeTreadWidth: catches a negative width field (negative, hand-built)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 3 });
  const negative = treadModels.map((t, i) => (i === 0 ? { ...t, widths: { atFront: -10, atBack: t.widths.atBack } } : t));
  const diags = checkNoNegativeTreadWidth(negative);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-TREAD-WIDTH-POSITIVE');
});

test('checkOutlineNotSelfIntersecting: passes for every real tread outline in a winder stair', () => {
  const { treadModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  assert.deepEqual(checkOutlineNotSelfIntersecting(treadModels), []);
});

test('checkOutlineNotSelfIntersecting: catches a hand-built bowtie quad (negative)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 3 });
  const bowtie = [
    { ...treadModels[0], outline: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] },
    ...treadModels.slice(1),
  ];
  const diags = checkOutlineNotSelfIntersecting(bowtie);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-TREAD-SIMPLE-POLYGON');
});

test('checkTopologicalContinuity: passes for a normally-built flight (including a winder turn)', () => {
  const { treadModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  assert.deepEqual(checkTopologicalContinuity(treadModels), []);
});

test('checkTopologicalContinuity: catches a gap between two treads (negative, hand-built)', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const shifted = treadModels.map((t, i) =>
    i === 2 ? { ...t, frontEdge: { ...t.frontEdge, final: [{ x: t.frontEdge.final[0].x + 50, y: t.frontEdge.final[0].y }, t.frontEdge.final[1]] } } : t
  );
  const diags = checkTopologicalContinuity(shifted);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-TOPOLOGY-CONTINUITY');
});

test('checkStringerPairInvariants: catches non-parallel stringers (negative, hand-built)', () => {
  const { stringerModels, config } = build({ stairType: 'straight', treadsLegA: 4 });
  const tiltedInner = {
    ...stringerModels.inner,
    segments: stringerModels.inner.segments.map((s) => ({
      ...s,
      referenceLine: { ...s.referenceLine, direction: { x: s.referenceLine.direction.x + 0.2, y: s.referenceLine.direction.y } },
    })),
  };
  const diags = checkStringerPairInvariants(stringerModels.outer, tiltedInner, config.stairWidth);
  assert.ok(diags.some((d) => d.ruleId === 'CONSTRAINT-STRINGER-PAIR-PARALLEL'));
});

test('checkStringerPairInvariants: catches wrong spacing (negative, hand-built)', () => {
  const { stringerModels, config } = build({ stairType: 'straight', treadsLegA: 4 });
  const shiftedInner = {
    ...stringerModels.inner,
    segments: stringerModels.inner.segments.map((s) => ({
      ...s,
      referenceLine: {
        ...s.referenceLine,
        start: { x: s.referenceLine.start.x + 300, y: s.referenceLine.start.y },
        end: { x: s.referenceLine.end.x + 300, y: s.referenceLine.end.y },
      },
    })),
  };
  const diags = checkStringerPairInvariants(stringerModels.outer, shiftedInner, config.stairWidth);
  assert.ok(diags.some((d) => d.ruleId === 'CONSTRAINT-STRINGER-PAIR-SPACING'));
});

test('checkBearingAttachment: catches a bearing pointing at a nonexistent tread (negative, hand-built)', () => {
  const { stringerModels, treadModels } = build({ stairType: 'straight', treadsLegA: 4 });
  const corrupted = {
    ...stringerModels.outer,
    segments: stringerModels.outer.segments.map((s, i) => (i === 0 ? { ...s, treadBearings: [{ ...s.treadBearings[0], treadIndex: 999 }, ...s.treadBearings.slice(1)] } : s)),
  };
  const diags = checkBearingAttachment(corrupted, treadModels.length, 'StringerOuter');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].ruleId, 'CONSTRAINT-BEARING-ATTACHMENT');
});
