// Extreme-case tests for the winder-turn architecture fix (planLayout.js's per-boundary
// direction tracking + riserSolver.js's buildWinderPanels fan construction).
//
// These tests do NOT assert exact pixel coordinates — the point of this fix is that the
// riser fan degrades gracefully across a huge parameter space, so the invariants checked
// here are structural: finiteness, positivity, unit-length directions, continuity between
// consecutive treads, and the deterministic panel count. See
// docs/model/STAIRCASE_DATA_MODEL.md §4.3/§4.6 for the Step/WinderGroup vocabulary these
// tests are named after (frontEdge/backEdge/direction/widths/walklinePosition).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildRiserModels, WINDER_RISER_FAN_PANELS } from '../riserSolver.js';
import { buildRiserMeshGeometries } from '../riserRenderer.js';
import { buildStringerModel } from '../stringerSolver.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), hasRiserBoards: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, derived, planLayout };
}

function unitLength(v) {
  return Math.hypot(v.x, v.y);
}

// Runs the full battery of structural invariants against one built layout. Every extreme
// scenario below funnels through this single checklist so the assertions themselves are
// never duplicated per scenario (only the input parameters vary).
function assertWinderArchitectureIsSound(planLayout, config, label) {
  const winderTreads = planLayout.treads.filter((t) => t.type === 'winder');
  assert.ok(winderTreads.length > 0, `${label}: expected at least one winder tread`);

  for (const tread of winderTreads) {
    const { frontEdge, backEdge, direction, widths, stationStart, stationEnd, walklinePosition } = tread.winderInfo;

    for (const edge of [frontEdge, backEdge]) {
      assert.ok(Number.isFinite(edge.inner.x) && Number.isFinite(edge.inner.y), `${label}: tread ${tread.index} edge.inner must be finite`);
      assert.ok(Number.isFinite(edge.outer.x) && Number.isFinite(edge.outer.y), `${label}: tread ${tread.index} edge.outer must be finite`);
      assert.ok(Math.abs(unitLength(edge.innerDirection) - 1) < 1e-6, `${label}: tread ${tread.index} innerDirection must be unit length`);
      assert.ok(Math.abs(unitLength(edge.outerDirection) - 1) < 1e-6, `${label}: tread ${tread.index} outerDirection must be unit length`);
    }

    assert.ok(Math.abs(unitLength(direction) - 1) < 1e-6, `${label}: tread ${tread.index} winderInfo.direction must be unit length`);
    assert.ok(Number.isFinite(widths.atFront) && widths.atFront > 0, `${label}: tread ${tread.index} widths.atFront must be positive finite, got ${widths.atFront}`);
    assert.ok(Number.isFinite(widths.atBack) && widths.atBack > 0, `${label}: tread ${tread.index} widths.atBack must be positive finite, got ${widths.atBack}`);
    assert.ok(stationEnd > stationStart, `${label}: tread ${tread.index} station range must be increasing`);
    assert.ok(walklinePosition.fractionEnd > walklinePosition.fractionStart, `${label}: tread ${tread.index} walkline fraction range must be increasing`);
  }

  // Continuity: consecutive winder treads must share the exact same boundary points —
  // tread i's backEdge IS tread i+1's frontEdge (same physical cut, no gap, no overlap).
  for (let i = 0; i < winderTreads.length - 1; i++) {
    const a = winderTreads[i].winderInfo.backEdge;
    const b = winderTreads[i + 1].winderInfo.frontEdge;
    assert.equal(a.inner.x, b.inner.x, `${label}: winder tread boundary continuity (inner.x) broken between consecutive treads`);
    assert.equal(a.inner.y, b.inner.y, `${label}: winder tread boundary continuity (inner.y) broken between consecutive treads`);
    assert.equal(a.outer.x, b.outer.x, `${label}: winder tread boundary continuity (outer.x) broken between consecutive treads`);
    assert.equal(a.outer.y, b.outer.y, `${label}: winder tread boundary continuity (outer.y) broken between consecutive treads`);
  }

  // Riser fan: every winder tread contributes exactly WINDER_RISER_FAN_PANELS geometries,
  // built uniformly (no per-case branching on "how bad" the direction mismatch is).
  const risers = buildRiserModels(planLayout, config).flatMap(buildRiserMeshGeometries);
  const nonWinderRiserCount = planLayout.treads.filter((t) => t.type !== 'winder').length;
  const expectedCount = winderTreads.length * WINDER_RISER_FAN_PANELS + nonWinderRiserCount;
  assert.equal(risers.length, expectedCount, `${label}: expected ${expectedCount} riser panels (${winderTreads.length} winder treads x ${WINDER_RISER_FAN_PANELS} fan panels + ${nonWinderRiserCount} straight/landing panels), got ${risers.length}`);

  for (const geo of risers) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const values = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z];
    assert.ok(values.every(Number.isFinite), `${label}: a riser panel produced a non-finite bounding box`);
    const size = new (bb.min.constructor)().subVectors(bb.max, bb.min);
    assert.ok(size.length() > 1e-6, `${label}: a riser panel is degenerate (near-zero size)`);
  }

  // Regression net: the stringer model from the previous session must still build cleanly
  // (straight reference lines, no throw) on top of this same, now-corrected plan layout.
  for (const side of ['outer', 'inner']) {
    const model = buildStringerModel(planLayout, config, side);
    assert.ok(model.segments.length > 0, `${label}: stringer model (${side}) produced no segments`);
  }
}

// A turn is only geometrically FEASIBLE (see deriveStairData/checkTurnFeasibility in
// config/schema.js) when walklineOffset + walklineSplitOffset < windersPerTurn*treadGoing —
// otherwise the inner ("dusza") boundary would need negative length. Every scenario below
// picks offset/splitOffset as fractions of the turn's own total path length specifically so
// that sweeping windersPerTurn down to very small counts never accidentally wanders into
// infeasible territory — an infeasible turn is a legitimate thing for the VALIDATOR to flag
// (out of scope here), but it is not the "small radius" extreme this test suite targets, and
// asserting geometric soundness against a self-contradictory input would test the wrong thing.
function feasibleTurnOffsets(windersPerTurn, treadGoing) {
  const total = windersPerTurn * treadGoing;
  return { walklineOffset: 0.3 * total, walklineSplitOffset: 0.4 * total };
}

test('90° turn (L stairs): winder architecture is sound across a range of winder counts', () => {
  const treadGoing = 270;
  for (const windersPerTurn of [2, 3, 4, 5, 6, 8, 12]) {
    const { walklineOffset, walklineSplitOffset } = feasibleTurnOffsets(windersPerTurn, treadGoing);
    const { planLayout, config } = build({
      stairType: 'L',
      turn1Type: 'winder',
      treadsLegA: 2,
      treadsLegB: 2,
      windersPerTurn,
      treadGoing,
      walklineOffset,
      walklineSplitOffset,
    });
    assertWinderArchitectureIsSound(planLayout, config, `L-turn, windersPerTurn=${windersPerTurn}`);
  }
});

test('180° effective turn (U stairs, two sequential 90° winders, no middle straight run)', () => {
  const { planLayout, config } = build({
    stairType: 'U',
    turn1Type: 'winder',
    turn2Type: 'winder',
    treadsLegA: 2,
    treadsLegB: 0,
    treadsLegC: 2,
    windersPerTurn: 5,
  });
  assertWinderArchitectureIsSound(planLayout, config, '180° (U, double winder, treadsLegB=0)');
});

test('small effective winder radius: many winders packed into a narrow turn', () => {
  // Large windersPerTurn + walklineOffset close to stairWidth => small inner ("dusza")
  // segment per step, i.e. a tight-radius turn — exactly the regime the audit flagged as
  // producing unnaturally wide/rotated risers under the old fraction-matching method.
  const { planLayout, config } = build({
    stairType: 'L',
    turn1Type: 'winder',
    treadsLegA: 2,
    treadsLegB: 2,
    stairWidth: 800,
    walklineOffset: 380,
    windersPerTurn: 9,
    minInnerWidth: 50, // relaxed on purpose — this test is about robustness, not legal feasibility
  });
  assertWinderArchitectureIsSound(planLayout, config, 'small radius (windersPerTurn=9, walklineOffset=380, stairWidth=800)');
});

test('large effective winder radius: few winders, gentle offset', () => {
  const windersPerTurn = 2;
  const treadGoing = 270;
  const { walklineOffset, walklineSplitOffset } = feasibleTurnOffsets(windersPerTurn, treadGoing);
  const { planLayout, config } = build({
    stairType: 'L',
    turn1Type: 'winder',
    treadsLegA: 2,
    treadsLegB: 2,
    stairWidth: 1200,
    windersPerTurn,
    treadGoing,
    walklineOffset,
    walklineSplitOffset,
  });
  assertWinderArchitectureIsSound(planLayout, config, `large radius (windersPerTurn=${windersPerTurn}, stairWidth=1200)`);
});

test('asymmetric walklineSplitOffset: bend point pushed to either extreme of the turn', () => {
  const windersPerTurn = 5;
  const treadGoing = 270;
  const totalTurnPathLength = windersPerTurn * treadGoing; // 1350
  const walklineOffset = 150; // kept small and fixed so offset+splitOffset stays feasible even near the upper extreme

  for (const walklineSplitOffset of [10, 200, totalTurnPathLength - 200, totalTurnPathLength - 160]) {
    assert.ok(walklineOffset + walklineSplitOffset < totalTurnPathLength, 'sanity: test parameters must stay within the feasible region (offset + splitOffset < total)');
    const { planLayout, config } = build({
      stairType: 'L',
      turn1Type: 'winder',
      treadsLegA: 2,
      treadsLegB: 2,
      windersPerTurn,
      treadGoing,
      walklineOffset,
      walklineSplitOffset,
    });
    assertWinderArchitectureIsSound(planLayout, config, `asymmetric walklineSplitOffset=${walklineSplitOffset}`);
  }
});

test('turnDirection="left": winder architecture stays sound under the mirrorX transform', () => {
  // Item 3 of the consolidation pass explicitly calls out mirrorX as a case to verify: every
  // direction vector on a winder tread (winderInfo.frontEdge/backEdge/direction) must be
  // mirrored consistently alongside the points, or a left-turning stair would silently carry
  // wrong-handed direction data into the riser fan / stringer renderer.
  const { planLayout, config } = build({
    stairType: 'L',
    turn1Type: 'winder',
    turnDirection: 'left',
    treadsLegA: 2,
    treadsLegB: 2,
    windersPerTurn: 5,
  });
  assertWinderArchitectureIsSound(planLayout, config, 'turnDirection=left');

  // Mirroring negates X only — every winder direction vector's Y component must match what a
  // right-turning stair with otherwise identical parameters produces, and every X component
  // must be exactly negated (not just "different").
  const { planLayout: rightPlanLayout } = build({
    stairType: 'L',
    turn1Type: 'winder',
    turnDirection: 'right',
    treadsLegA: 2,
    treadsLegB: 2,
    windersPerTurn: 5,
  });
  const leftWinders = planLayout.treads.filter((t) => t.type === 'winder');
  const rightWinders = rightPlanLayout.treads.filter((t) => t.type === 'winder');
  assert.equal(leftWinders.length, rightWinders.length);
  leftWinders.forEach((leftTread, i) => {
    const rightTread = rightWinders[i];
    for (const edgeKey of ['frontEdge', 'backEdge']) {
      for (const dirKey of ['innerDirection', 'outerDirection']) {
        const l = leftTread.winderInfo[edgeKey][dirKey];
        const r = rightTread.winderInfo[edgeKey][dirKey];
        assert.ok(Math.abs(l.x - -r.x) < 1e-9, `${edgeKey}.${dirKey}.x should be the exact mirror`);
        assert.ok(Math.abs(l.y - r.y) < 1e-9, `${edgeKey}.${dirKey}.y should be unchanged by mirroring`);
      }
    }
  });
});

test('winder count sweep 2..12: front/back edge direction vectors always well-defined', () => {
  for (const windersPerTurn of [2, 3, 4, 5, 7, 10, 12]) {
    const { planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 1, treadsLegB: 1, windersPerTurn });
    const winderTreads = planLayout.treads.filter((t) => t.type === 'winder');
    assert.equal(winderTreads.length, windersPerTurn, `windersPerTurn=${windersPerTurn}: expected exactly that many winder treads`);
    for (const tread of winderTreads) {
      const { frontEdge, backEdge } = tread.winderInfo;
      // Direction is always axis-aligned in this local frame (either the entry (0,1) or the
      // exit (1,0) direction, or the still-unit blend of the two) — never a NaN or zero vector.
      for (const dir of [frontEdge.innerDirection, frontEdge.outerDirection, backEdge.innerDirection, backEdge.outerDirection]) {
        assert.ok(Number.isFinite(dir.x) && Number.isFinite(dir.y), `windersPerTurn=${windersPerTurn}, tread ${tread.index}: direction has non-finite component`);
        assert.ok(unitLength(dir) > 0.99 && unitLength(dir) < 1.01, `windersPerTurn=${windersPerTurn}, tread ${tread.index}: direction is not unit length`);
      }
    }
  }
});
