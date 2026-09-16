// Tests for the STRINGER CONSTRUCTION GEOMETRY layer (stringerConstructionGeometry.js) — the
// real, continuous timber board contour built ON TOP OF (never replacing) the analytical
// StringerModel/StringerSegment/StringerTreadBearing model. Every test here works with plain
// data — no Three.js — per requirement 10 ("the analytical model must remain testable without
// Three.js").

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStringerModel, buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { checkParallelAndSpaced, assertReferenceLineIsStraight, CONSTRUCTION_TYPES } from '../stringerModel.js';
import { segmentsProperlyIntersect } from '../pathUtils.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

function toXY(p) {
  return { x: p.u, y: p.v };
}

function isSimplePolygon(polygon) {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = toXY(polygon[i]);
    const a2 = toXY(polygon[(i + 1) % n]);
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i || (j + 1) % n === i || (i + 1) % n === j;
      if (adjacent) continue;
      if (segmentsProperlyIntersect(a1, a2, toXY(polygon[j]), toXY(polygon[(j + 1) % n]))) return false;
    }
  }
  return true;
}

// A realistic, code-plausible straight flight (Blondel-friendly riser/going ratio) — chosen so
// the "single straight chord through the first/last bearing" pitch-line method (see
// stringerConstructionGeometry.js's header) stays valid; see the dedicated test further down
// for what happens on a deliberately unrealistic/steep configuration.
const REALISTIC_STRAIGHT = { stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280 };
const REALISTIC_WINDER = { stairType: 'L', turn1Type: 'winder', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, totalRise: 2600, treadGoing: 280 };
// 'cut' specifically — its outer contour reflects EVERY bearing's own u-range individually
// (the notched top edge), unlike 'closed' (a plain rectangle from only the first/last bearing)
// — the right construction type for proving a single interior tread's edit reaches the contour.
const REALISTIC_STRAIGHT_CUT = { ...REALISTIC_STRAIGHT, stringerConstructionType: 'cut' };

// --- A. Straight overlay (cut) stringer -------------------------------------------------------

test('A. straight overlay: one continuous polygon, stepped top + single straight bottom edge, no disconnected blocks', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: 'cut' });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);

  assert.equal(geo.constructionType, CONSTRUCTION_TYPES.CUT);
  const bearingCount = model.segments[0].treadBearings.length;
  // Exactly 2 top points per bearing (the step) + 2 bottom corners — ONE polygon, not N
  // disconnected rectangles (which would instead be 4*N unrelated points with no shared edges).
  assert.equal(geo.outerContour.length, bearingCount * 2 + 2);
  assert.equal(geo.diagnostics.length, 0, `expected no diagnostics on a realistic config, got: ${JSON.stringify(geo.diagnostics)}`);
  assert.ok(isSimplePolygon(geo.outerContour), 'outer contour must not self-intersect');
  assert.ok(geo.minRemainingSectionMm > 0, 'material thickness must be positive everywhere');

  // The bottom edge is a SINGLE straight line: its two endpoints' slope must match the pitch
  // line's own slope (continuity — not per-bearing steps on the bottom).
  const bottomEnd = geo.outerContour[geo.outerContour.length - 2];
  const bottomStart = geo.outerContour[geo.outerContour.length - 1];
  const bottomSlope = (bottomEnd.v - bottomStart.v) / (bottomEnd.u - bottomStart.u);
  assert.ok(Math.abs(bottomSlope - geo.pitchLine.slope) < 1e-9);

  // Cleats are reported SEPARATELY from the structural board contour (never merged into it).
  assert.equal(geo.cleats.length, bearingCount);
  assert.equal(geo.housings, undefined);
});

// --- B. Straight housed (closed) stringer -------------------------------------------------------

test('B. straight housed: outer contour is a plain 4-point parallelogram regardless of tread count, housings are separate', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: 'closed', stringerThickness: 50 });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);

  assert.equal(geo.constructionType, CONSTRUCTION_TYPES.CLOSED);
  assert.equal(geo.outerContour.length, 4, 'a housed board is one plain rectangle in profile, independent of how many treads it supports');
  assert.ok(isSimplePolygon(geo.outerContour));

  // Both top and bottom edges are straight and PARALLEL to the pitch line.
  const [p0, p1, p2, p3] = geo.outerContour;
  const topSlope = (p1.v - p0.v) / (p1.u - p0.u);
  const bottomSlope = (p2.v - p3.v) / (p2.u - p3.u);
  assert.ok(Math.abs(topSlope - geo.pitchLine.slope) < 1e-9);
  assert.ok(Math.abs(bottomSlope - geo.pitchLine.slope) < 1e-9);

  const bearingCount = model.segments[0].treadBearings.length;
  assert.equal(geo.housings.length, bearingCount);
  assert.equal(geo.cleats, undefined);
  // Housings never change the outer silhouette — their u-ranges lie within the board's own.
  for (const h of geo.housings) {
    assert.ok(h.uStart >= geo.outerContour[0].u - 1e-6 && h.uEnd <= geo.outerContour[1].u + 1e-6);
  }
});

// --- C/D. L-winder, both construction types ----------------------------------------------------

for (const [label, constructionType] of [
  ['C. L-winder overlay', 'cut'],
  ['D. L-winder housed', 'closed'],
]) {
  test(`${label}: every segment produces a continuous, non-self-intersecting contour`, () => {
    const { config, planLayout } = build({ ...REALISTIC_WINDER, stringerConstructionType: constructionType });
    for (const side of ['outer', 'inner']) {
      const model = buildStringerModel(planLayout, config, side);
      const geometries = buildStringerConstructionGeometry(model, config);
      assert.ok(geometries.length > 1, 'a winder flight has more than one straight reference-line run');
      for (const geo of geometries) {
        assert.ok(isSimplePolygon(geo.outerContour), `${side}/${geo.segmentId}: contour must not self-intersect`);
        const errors = geo.diagnostics.filter((d) => d.severity === 'ERROR');
        assert.deepEqual(errors, [], `${side}/${geo.segmentId}: no ERROR diagnostics expected on a realistic winder config`);
      }
    }
  });
}

// --- E/F. Manual tread-edge overrides propagate into the construction geometry -----------------

test('E. manual OUTER tread-edge override shifts the outer stringer\'s contour but leaves the inner stringer untouched', () => {
  // Moved ALONG the reference line's own direction (y, for this straight flight) — not
  // perpendicular to it — since only a shift along the board's length can move where a notch
  // is cut; a purely perpendicular edit legitimately changes `offsetStart`/`offsetEnd` only
  // (how far the tread now overhangs the board sideways), never the notch's position along it.
  const boundaryIndex = 5;
  const base = build(REALISTIC_STRAIGHT_CUT);
  const outerPoint = base.planLayout.treads[boundaryIndex - 1].backEdge[1];
  const edited = build({ ...REALISTIC_STRAIGHT_CUT, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: { x: outerPoint.x, y: outerPoint.y + 15 } } } });

  const outerBase = buildStringerConstructionGeometry(buildStringerModel(base.planLayout, base.config, 'outer'), base.config)[0];
  const outerEdited = buildStringerConstructionGeometry(buildStringerModel(edited.planLayout, edited.config, 'outer'), edited.config)[0];
  assert.notDeepEqual(outerEdited.outerContour, outerBase.outerContour, 'the OUTER contour must change');

  const innerBase = buildStringerConstructionGeometry(buildStringerModel(base.planLayout, base.config, 'inner'), base.config)[0];
  const innerEdited = buildStringerConstructionGeometry(buildStringerModel(edited.planLayout, edited.config, 'inner'), edited.config)[0];
  assert.deepEqual(innerEdited.outerContour, innerBase.outerContour, 'the INNER contour must be unaffected by an edit to the OUTER point');

  // Reference line invariant must still hold (requirement 2/7): unaffected by the edit.
  const modelEdited = buildStringerModel(edited.planLayout, edited.config, 'outer');
  assertReferenceLineIsStraight(modelEdited.segments[0]);
  assert.deepEqual(modelEdited.segments[0].referenceLine, buildStringerModel(base.planLayout, base.config, 'outer').segments[0].referenceLine);
});

test('F. manual INNER tread-edge override shifts the inner stringer\'s contour but leaves the outer stringer untouched', () => {
  const boundaryIndex = 5;
  const base = build(REALISTIC_STRAIGHT_CUT);
  const innerPoint = base.planLayout.treads[boundaryIndex - 1].backEdge[0];
  const edited = build({ ...REALISTIC_STRAIGHT_CUT, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'inner', point: { x: innerPoint.x, y: innerPoint.y - 15 } } } });

  const innerBase = buildStringerConstructionGeometry(buildStringerModel(base.planLayout, base.config, 'inner'), base.config)[0];
  const innerEdited = buildStringerConstructionGeometry(buildStringerModel(edited.planLayout, edited.config, 'inner'), edited.config)[0];
  assert.notDeepEqual(innerEdited.outerContour, innerBase.outerContour);

  const outerBase = buildStringerConstructionGeometry(buildStringerModel(base.planLayout, base.config, 'outer'), base.config)[0];
  const outerEdited = buildStringerConstructionGeometry(buildStringerModel(edited.planLayout, edited.config, 'outer'), edited.config)[0];
  assert.deepEqual(outerEdited.outerContour, outerBase.outerContour);
});

test('tread supports in the construction geometry correspond to FINAL (edited) tread geometry, not nominal', () => {
  const boundaryIndex = 5;
  const outerPointBase = build(REALISTIC_STRAIGHT_CUT).planLayout.treads[boundaryIndex - 1].backEdge[1];
  const movedPoint = { x: outerPointBase.x, y: outerPointBase.y + 15 };
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT_CUT, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: movedPoint } } });
  const model = buildStringerModel(planLayout, config, 'outer');
  const bearing = model.segments[0].treadBearings.find((b) => b.treadIndex === boundaryIndex - 1);
  const [geo] = buildStringerConstructionGeometry(model, config);

  // The bearing's own FINAL u-range (already proven correct by stringerSolver.js's own tests)
  // must appear verbatim as one of the contour's top step regions.
  const stepPoints = geo.outerContour.slice(0, model.segments[0].treadBearings.length * 2);
  const matchingStep = [];
  for (let i = 0; i < stepPoints.length; i += 2) matchingStep.push([stepPoints[i], stepPoints[i + 1]]);
  const found = matchingStep.some(([a, b]) => Math.abs(a.u - bearing.finalUStart) < 1e-6 && Math.abs(b.u - bearing.finalUEnd) < 1e-6);
  assert.ok(found, 'construction geometry must use the bearing\'s FINAL u-range, not a stale nominal one');
});

// --- G. Changed stringer width (board depth) ----------------------------------------------------

test('G. changed stringer width (board depth) changes the bottom edge offset by exactly the new width', () => {
  const narrow = build({ ...REALISTIC_STRAIGHT, stringerHeight: 220 });
  const wide = build({ ...REALISTIC_STRAIGHT, stringerHeight: 380 });
  const geoNarrow = buildStringerConstructionGeometry(buildStringerModel(narrow.planLayout, narrow.config, 'outer'), narrow.config)[0];
  const geoWide = buildStringerConstructionGeometry(buildStringerModel(wide.planLayout, wide.config, 'outer'), wide.config)[0];

  assert.equal(geoNarrow.boardWidthMm, 220);
  assert.equal(geoWide.boardWidthMm, 380);
  const bottomNarrow = geoNarrow.outerContour[geoNarrow.outerContour.length - 1];
  const bottomWide = geoWide.outerContour[geoWide.outerContour.length - 1];
  assert.ok(Math.abs(bottomNarrow.v - bottomWide.v - (380 - 220)) < 1e-6, 'the bottom edge must move down by exactly the width delta');
});

// --- H. Changed board thickness -------------------------------------------------------------

test('H. changed board thickness is reflected in thicknessMm and in the housed diagnostic (thinner board = less remaining section)', () => {
  const thin = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: 'closed', stringerThickness: 30 });
  const thick = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: 'closed', stringerThickness: 60 });
  const geoThin = buildStringerConstructionGeometry(buildStringerModel(thin.planLayout, thin.config, 'outer'), thin.config)[0];
  const geoThick = buildStringerConstructionGeometry(buildStringerModel(thick.planLayout, thick.config, 'outer'), thick.config)[0];

  assert.equal(geoThin.thicknessMm, 30);
  assert.equal(geoThick.thicknessMm, 60);
  assert.ok(geoThin.minRemainingSectionMm < geoThick.minRemainingSectionMm, 'a thinner board must leave less material behind the housing');
});

// --- Reference line / parallelism invariants must survive the new construction-geometry layer ---

test('paired stringers remain parallel and correctly spaced after building construction geometry (both construction types)', () => {
  for (const constructionType of ['cut', 'closed']) {
    const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: constructionType, stairWidth: 1000 });
    const models = buildStringerModelsForFlight(planLayout, config);
    // Building construction geometry must not mutate the underlying model.
    buildStringerConstructionGeometry(models.outer, config);
    buildStringerConstructionGeometry(models.inner, config);
    const result = checkParallelAndSpaced(models.outer.segments[0], models.inner.segments[0], 1000);
    assert.equal(result.parallel, true);
    assert.equal(result.spacingOk, true);
  }
});

// --- Diagnostics genuinely fire on a deliberately unrealistic/steep configuration ---------------

test('an unrealistically steep flight (tall risers, short goings) is flagged by the min-remaining-section diagnostic, not silently accepted', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 6, totalRise: 2800, treadGoing: 270, stringerConstructionType: 'cut' });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  assert.ok(geo.diagnostics.some((d) => d.ruleId === 'STRINGER-MIN-SECTION'), 'expected the naive pitch-line method\'s limits to be surfaced as a diagnostic, not hidden');
});

// --- Cleats are an optional support method, not a mandatory feature of 'cut' ---------------------

test('stringerCleatsEnabled: false produces an empty cleats array, never a hidden assumption; contour/pitchLine are unaffected', () => {
  const withCleats = build({ ...REALISTIC_STRAIGHT_CUT, stringerCleatsEnabled: true });
  const withoutCleats = build({ ...REALISTIC_STRAIGHT_CUT, stringerCleatsEnabled: false });
  const geoWith = buildStringerConstructionGeometry(buildStringerModel(withCleats.planLayout, withCleats.config, 'outer'), withCleats.config)[0];
  const geoWithout = buildStringerConstructionGeometry(buildStringerModel(withoutCleats.planLayout, withoutCleats.config, 'outer'), withoutCleats.config)[0];
  assert.ok(geoWith.cleats.length > 0);
  assert.deepEqual(geoWithout.cleats, []);
  assert.deepEqual(geoWithout.outerContour, geoWith.outerContour, 'disabling cleats must not change the structural board contour');
  assert.deepEqual(geoWithout.pitchLine, geoWith.pitchLine);
});
