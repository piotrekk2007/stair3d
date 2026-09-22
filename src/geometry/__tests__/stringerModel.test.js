// Tests for the stringer technical model (stringerModel.js / stringerSolver.js).
//
// The central thing under test: StringerReferenceGeometry (the physical board's straight
// axis) and StringerTreadBearingGeometry (where a tread's notch sits on that board) are two
// distinct concepts, and a manual tread edit must move the second without ever moving the
// first. Every test in the "reference vs bearing invariant" block exists to prove exactly
// that, with real numbers, not by inspection.
//
// Run with: npm test (node --test)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStringerModel } from '../stringerSolver.js';
import { checkParallelAndSpaced, CONSTRUCTION_TYPES, housingDepthFor } from '../stringerModel.js';

function buildModel(configPatch, side) {
  const config = { ...createDefaultConfig(), stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, derived, planLayout, model: buildStringerModel(planLayout, fullConfig, side) };
}

test('straight flight: reference line is a single straight run per side', () => {
  const { model: outer } = buildModel({ stairType: 'straight', treadsLegA: 6 }, 'outer');
  const { model: inner } = buildModel({ stairType: 'straight', treadsLegA: 6 }, 'inner');

  assert.equal(outer.segments.length, 1, 'a straight flight must produce exactly one reference-line run on the outer side');
  assert.equal(inner.segments.length, 1, 'a straight flight must produce exactly one reference-line run on the inner side');

  // The 6 treads must all be accounted for on the single segment.
  assert.equal(outer.segments[0].treadBearings.length, 6);
  assert.equal(inner.segments[0].treadBearings.length, 6);
});

test('straight flight: outer and inner reference lines are parallel and spaced by stairWidth', () => {
  const { model: outer } = buildModel({ stairType: 'straight', treadsLegA: 6, stairWidth: 950 }, 'outer');
  const { model: inner } = buildModel({ stairType: 'straight', treadsLegA: 6, stairWidth: 950 }, 'inner');

  const result = checkParallelAndSpaced(outer.segments[0], inner.segments[0], 950);
  assert.equal(result.parallel, true, `expected parallel reference lines, angle delta was ${result.angleDeltaDeg.toFixed(4)} deg`);
  assert.equal(result.spacingOk, true, `expected spacing ~950mm, got ${result.spacing.toFixed(3)}mm`);
});

test('L-shaped stair with winders: each reference-line run is straight, and a turn produces more than one run', () => {
  const { model: outer } = buildModel(
    { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 },
    'outer'
  );
  const { model: inner } = buildModel(
    { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 },
    'inner'
  );

  // buildStringerModel already throws (via assertReferenceLineIsStraight) if any run were not
  // straight, so simply having reached this point already proves straightness per segment.
  assert.ok(outer.segments.length >= 2, 'the outer board must bend at the winder corner, i.e. be split into >= 2 straight runs');
  assert.ok(inner.segments.length >= 1);

  const totalOuterBearings = outer.segments.reduce((n, s) => n + s.treadBearings.length, 0);
  const totalInnerBearings = inner.segments.reduce((n, s) => n + s.treadBearings.length, 0);
  assert.ok(totalOuterBearings >= 11, 'every tread (3 + 5 + 3) should be borne by the outer board across its runs');
  assert.ok(totalInnerBearings >= 11, 'every tread (3 + 5 + 3) should be borne by the inner board across its runs');
});

test('reference vs bearing invariant: a manual edge edit changes bearing geometry, never the reference line', () => {
  const base = buildModel({ stairType: 'straight', treadsLegA: 6 }, 'outer');
  const boundaryIndex = 3; // the shared edge between tread 2 and tread 3

  const edited = buildModel(
    {
      stairType: 'straight',
      treadsLegA: 6,
      manualEdgeOverrides: {
        [boundaryIndex]: { point: { x: -35, y: 3 * 270 + 12 }, movedEndpoint: 'outer' },
      },
    },
    'outer'
  );

  // 1. The reference line must be BIT-IDENTICAL before and after the edit.
  assert.equal(base.model.segments.length, edited.model.segments.length);
  base.model.segments.forEach((segBefore, i) => {
    const segAfter = edited.model.segments[i];
    assert.deepEqual(segAfter.referenceLine.start, segBefore.referenceLine.start, 'referenceLine.start must not move on a manual tread edit');
    assert.deepEqual(segAfter.referenceLine.end, segBefore.referenceLine.end, 'referenceLine.end must not move on a manual tread edit');
    assert.equal(segAfter.referenceLine.length, segBefore.referenceLine.length);
  });

  // 2. Before the edit, every bearing sits exactly on the (unedited) reference line.
  const bearingsBefore = base.model.segments[0].treadBearings;
  for (const b of bearingsBefore) {
    assert.ok(Math.abs(b.offsetStart) < 1e-6, `unedited bearing offsetStart should be ~0, got ${b.offsetStart}`);
    assert.ok(Math.abs(b.offsetEnd) < 1e-6, `unedited bearing offsetEnd should be ~0, got ${b.offsetEnd}`);
  }

  // 3. After the edit, EXACTLY the two bearings touching boundaryIndex show a nonzero offset
  //    on the edited side (tread (boundaryIndex-1)'s front edge, tread boundaryIndex's rear
  //    edge) — every other tread's bearing is untouched.
  const bearingsAfter = edited.model.segments[0].treadBearings;
  const treadBefore = bearingsAfter.find((b) => b.treadIndex === boundaryIndex - 1);
  const treadAfter = bearingsAfter.find((b) => b.treadIndex === boundaryIndex);

  assert.ok(Math.abs(treadBefore.offsetEnd) > 1, `tread ${boundaryIndex - 1}'s front bearing should have moved off the reference line, got offset ${treadBefore.offsetEnd}`);
  assert.ok(Math.abs(treadAfter.offsetStart) > 1, `tread ${boundaryIndex}'s rear bearing should have moved off the reference line, got offset ${treadAfter.offsetStart}`);

  for (const b of bearingsAfter) {
    if (b.treadIndex === boundaryIndex - 1 || b.treadIndex === boundaryIndex) continue;
    assert.ok(Math.abs(b.offsetStart) < 1e-6, `tread ${b.treadIndex} rear bearing should be unaffected by an edit elsewhere, got ${b.offsetStart}`);
    assert.ok(Math.abs(b.offsetEnd) < 1e-6, `tread ${b.treadIndex} front bearing should be unaffected by an edit elsewhere, got ${b.offsetEnd}`);
  }
});

test('reference vs bearing invariant: editing the INNER boundary point never affects the OUTER stringer model', () => {
  const boundaryIndex = 3;
  const patch = {
    stairType: 'straight',
    treadsLegA: 6,
    manualEdgeOverrides: {
      [boundaryIndex]: { point: { x: 940, y: 3 * 270 - 4 }, movedEndpoint: 'inner' },
    },
  };

  const outerBase = buildModel({ stairType: 'straight', treadsLegA: 6 }, 'outer');
  const outerEdited = buildModel(patch, 'outer');

  assert.deepEqual(outerEdited.model.segments[0].referenceLine, outerBase.model.segments[0].referenceLine);
  outerEdited.model.segments[0].treadBearings.forEach((b, i) => {
    const baseB = outerBase.model.segments[0].treadBearings[i];
    assert.equal(b.offsetStart, baseB.offsetStart);
    assert.equal(b.offsetEnd, baseB.offsetEnd);
  });
});

test('bearing elevation derives from riser height / tread thickness, unaffected by lateral edits', () => {
  const boundaryIndex = 3;
  const base = buildModel({ stairType: 'straight', treadsLegA: 6 }, 'outer');
  const edited = buildModel(
    {
      stairType: 'straight',
      treadsLegA: 6,
      manualEdgeOverrides: { [boundaryIndex]: { point: { x: -35, y: 3 * 270 + 12 }, movedEndpoint: 'outer' } },
    },
    'outer'
  );

  base.model.segments[0].treadBearings.forEach((b, i) => {
    const editedB = edited.model.segments[0].treadBearings[i];
    assert.equal(editedB.bearingElevation, b.bearingElevation, `bearingElevation for tread ${b.treadIndex} must not change from a lateral edit`);
  });
});

test('manufacturing constraints: housing depth follows max(12mm, 0.4*thickness) for a closed string', () => {
  const { model } = buildModel({ stairType: 'straight', treadsLegA: 4, stringerThickness: 40, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' }, 'outer');
  assert.equal(model.manufacturing.housingDepth, housingDepthFor(40));
  assert.equal(model.manufacturing.housingDepth, 16); // max(12, 0.4*40) = 16
});

test('manufacturing constraints: a cut string has no housing depth', () => {
  const { model } = buildModel({ stairType: 'straight', treadsLegA: 4, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' }, 'outer');
  assert.equal(model.constructionType === undefined, true); // constructionType lives per-segment, not on the model root
  assert.equal(model.segments[0].constructionType, CONSTRUCTION_TYPES.CUT);
  assert.equal(model.manufacturing.housingDepth, null);
});

test('material properties reflect the configured timber grade', () => {
  const { model } = buildModel({ stairType: 'straight', treadsLegA: 4, timberGrade: 'D40' }, 'outer');
  assert.equal(model.material.strengthClass, 'D40');
});

test('connections: bottom/top are newel tenons at the flight extremities', () => {
  const { model, planLayout } = buildModel({ stairType: 'straight', treadsLegA: 5 }, 'inner');
  assert.equal(model.bottomConnection.type, 'newel-tenon');
  assert.equal(model.topConnection.type, 'newel-tenon');
  assert.deepEqual(model.bottomConnection.position, planLayout.innerFullPath[0]);
  assert.deepEqual(model.topConnection.position, planLayout.innerFullPath[planLayout.innerFullPath.length - 1]);
});

test('intermediate support: an L-turn with a corner post adds one corner-post support on the inner side only', () => {
  const patch = { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, hasCornerPost: true };
  const { model: inner } = buildModel(patch, 'inner');
  const { model: outer } = buildModel(patch, 'outer');

  assert.equal(inner.intermediateSupports.length, 1);
  assert.equal(inner.intermediateSupports[0].type, 'corner-post');
  assert.equal(outer.intermediateSupports.length, 0, 'the outer board has no post — its corner is a bend between two reference-line runs');
});
