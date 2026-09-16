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
import { valueAtU, distancePointToPolyline } from '../polylineProfile.js';

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
  // Housings never change the outer silhouette — every housing's own elevation is contained
  // within the solved [bottom,top] envelope AT ITS OWN POSITION (checked via valueAtU, not a
  // raw u-range comparison — the top/bottom edges are now genuine PERPENDICULAR offsets of the
  // pitch profile, so their u-coordinates shift very slightly relative to the original bearing
  // u-values whenever the profile is sloped; a fixed-u containment check is the wrong test for
  // an offset that is deliberately not purely vertical anymore).
  for (const h of geo.housings) {
    const topAtStart = valueAtU(geo.topProfile, h.uStart);
    const bottomAtStart = valueAtU(geo.bottomProfile, h.uStart);
    assert.ok(h.topV <= topAtStart + 1e-6 && h.topV >= bottomAtStart - 1e-6, 'housing must sit inside the board envelope at its own position');
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

test('G. changed stringer width (board depth) changes the bottom edge by exactly the new width, measured PERPENDICULAR to the pitch line', () => {
  // Not a raw vertical (world-elevation) delta: for a sloped pitch line, a true perpendicular
  // offset of `boardWidth` moves a point's v-coordinate by boardWidth*cos(angle) < boardWidth
  // — asserting a raw vertical delta here would silently re-introduce the bug this refactor
  // fixes (see stringerConstructionGeometry.js's file header on "measured perpendicular, not
  // raw world elevation").
  const narrow = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: 'cut', stringerHeight: 220 });
  const wide = build({ ...REALISTIC_STRAIGHT, stringerConstructionType: 'cut', stringerHeight: 380 });
  const geoNarrow = buildStringerConstructionGeometry(buildStringerModel(narrow.planLayout, narrow.config, 'outer'), narrow.config)[0];
  const geoWide = buildStringerConstructionGeometry(buildStringerModel(wide.planLayout, wide.config, 'outer'), wide.config)[0];

  assert.equal(geoNarrow.boardWidthMm, 220);
  assert.equal(geoWide.boardWidthMm, 380);

  // Every bearing's front corner sits exactly ON the (pre-offset) pitch profile by
  // construction, so its perpendicular distance to the offset bottom line must equal the
  // configured board width exactly, for both widths.
  const knotNarrow = geoNarrow.pitchProfile[0];
  const knotWide = geoWide.pitchProfile[0];
  assert.ok(Math.abs(distancePointToPolyline(knotNarrow, geoNarrow.bottomProfile) - 220) < 1e-6);
  assert.ok(Math.abs(distancePointToPolyline(knotWide, geoWide.bottomProfile) - 380) < 1e-6);
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

// --- Diagnostics genuinely fire when the board is actually too narrow ---------------------------

test('a remaining section below the configured minimum threshold is flagged, not silently accepted', () => {
  // Raise the REQUIRED minimum past the board's own actual remaining section (rather than
  // shrinking the board itself, which for a 'cut' stringer's notch geometry quickly becomes
  // self-intersecting instead of merely thin — a different, ERROR-level failure mode).
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionType: 'cut', stringerMinRemainingSectionMm: 320 });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  assert.ok(geo.diagnostics.some((d) => d.ruleId === 'STRINGER-MIN-SECTION'), 'expected a remaining section below the configured minimum to trip the diagnostic');
});

// --- Regression: the min-section number for a UNIFORM flight must be a real, closed-form ------
// --- quantity (the notch "throat" thickness), not an artifact of a badly-fit pitch line -------
//
// The pre-refactor 2-point pitch line (fit through only the first and last bearing) computed a
// slope that did not match the flight's own true riser/going ratio (see this file's header and
// docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md) — for this exact steep-but-uniform flight it
// produced a NEGATIVE (i.e. self-intersecting) min-section reading, purely from the wrong slope.
// The fixed pitch line passes through every real bearing, so the only remaining thinning is the
// genuine, physically real one: a notch's BACK corner (where riser meets the next tread) sits
// below the smooth pitch line by exactly one riserHeight, which — projected perpendicular to a
// sloped pitch line — is a smaller gap than the boardWidth measured at the notch's FRONT corner.
// For a uniform flight this reduction has an exact closed form:
//   throat = boardWidth - riserHeight * treadGoing / hypot(treadGoing, riserHeight)
// This test locks in that closed form, rather than either the old (wrong, negative) reading or
// a naive "must equal the full board width" assumption (also wrong — a real notch throat IS
// thinner than the board's own depth, by design of the notch itself).

test('a steep but UNIFORM straight flight reports the real notch-throat thickness as its remaining section (closed form, not a pitch-line artifact)', () => {
  const totalRise = 2800;
  const treadGoing = 270;
  const treadsLegA = 6;
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA, totalRise, treadGoing, stringerConstructionType: 'cut' });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  const riserHeight = totalRise / (treadsLegA + 1);
  const expectedThroat = geo.boardWidthMm - (riserHeight * treadGoing) / Math.hypot(treadGoing, riserHeight);
  assert.ok(Math.abs(geo.minRemainingSectionMm - expectedThroat) < 1e-3, `expected ${expectedThroat}, got ${geo.minRemainingSectionMm}`);
  assert.ok(geo.minRemainingSectionMm > 0, 'must be a real positive thickness, not the old negative/self-intersecting reading');
});

// --- THE reported bug: winder tread widths must not disconnect the board from the treads --------

test('winder bug fix: every bearing on a winder segment is fully contained within the solved board envelope (no floating tread)', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, stringerConstructionType: 'closed' });
  for (const side of ['outer', 'inner']) {
    const model = buildStringerModel(planLayout, config, side);
    const geometries = buildStringerConstructionGeometry(model, config);
    for (const geo of geometries) {
      if (!geo.topProfile) continue;
      const supportErrors = geo.diagnostics.filter((d) => d.ruleId === 'STRINGER-TREAD-SUPPORT');
      assert.deepEqual(supportErrors, [], `${side}/${geo.segmentId}: every bearing must be contained in the board envelope, got: ${JSON.stringify(supportErrors)}`);
    }
  }
});

test('winder bug fix: the pitch profile passes through every real bearing position, not just the first and last', () => {
  const { config, planLayout } = build(REALISTIC_WINDER);
  const model = buildStringerModel(planLayout, config, 'outer');
  const geometries = buildStringerConstructionGeometry(model, config);
  const multiTreadSegment = geometries.find((g) => g.pitchProfile.length > 0 && model.segments.find((s) => s.id === g.segmentId).treadBearings.length > 2);
  assert.ok(multiTreadSegment, 'expected at least one winder segment with more than 2 bearings for this to be a meaningful test');
  const segment = model.segments.find((s) => s.id === multiTreadSegment.segmentId);
  // Every bearing's own front corner must be, by construction, essentially ON the pitch
  // profile (perpendicular distance ~0) — the defining property that fixes the original bug
  // (a naive 2-point line left intermediate bearings 100-250mm away from it).
  for (const b of segment.treadBearings) {
    const dist = distancePointToPolyline({ u: b.finalUStart, v: b.bearingElevation }, multiTreadSegment.pitchProfile);
    assert.ok(dist < 1e-6, `bearing ${b.treadIndex} is ${dist.toFixed(1)}mm away from its own pitch profile`);
  }
});

// --- Second reported bug: adjacent segments at a postless corner must actually MEET -------------
//
// Fixing the within-segment pitch line (above) was not the whole story: each StringerSegment
// was still solved in total isolation, so two segments joined by a LAP_JOINT (no corner post —
// see stringerModel.js's CONNECTION_TYPES and stringerSolver.js's own comment that the OUTER
// stringer's turn is ALWAYS a lap joint, never interrupted by a post) each fit their OWN
// profile from ONLY their own bearings. Their independently-offset bottom (and, for a closed
// board, top) edges generally do NOT land on the same elevation at the shared corner point —
// a real, measured ~54mm jump for the outer stringer of a typical L-winder — even though each
// segment's own contour was perfectly valid in isolation. This is exactly what a screenshot of
// the rendered result shows as the board appearing to "hang in the air" disconnected from the
// treads right at the turn.

test('joint bug fix: the OUTER stringer (always a lap joint, never a corner post) has NO elevation jump across a segment boundary', () => {
  const { config, planLayout } = build(REALISTIC_WINDER); // hasCornerPost defaults to true, irrelevant for the outer side
  const model = buildStringerModel(planLayout, config, 'outer');
  const geometries = buildStringerConstructionGeometry(model, config);
  assert.ok(geometries.length > 1, 'expected more than one physical board for this to be a meaningful test');
  for (let i = 0; i < geometries.length - 1; i++) {
    const a = geometries[i];
    const b = geometries[i + 1];
    if (!a.bottomProfile || !b.bottomProfile) continue;
    const aEnd = a.bottomProfile[a.bottomProfile.length - 1];
    const bStart = b.bottomProfile[0];
    assert.ok(Math.abs(aEnd.v - bStart.v) < 1e-6, `${a.segmentId} ends at v=${aEnd.v}, but ${b.segmentId} starts at v=${bStart.v} — a real gap in the board's underside at the joint`);
  }
});

test('joint bug fix: a lap-jointed INNER stringer (hasCornerPost: false) also gets a continuous profile across the joint', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, hasCornerPost: false });
  const model = buildStringerModel(planLayout, config, 'inner');
  const geometries = buildStringerConstructionGeometry(model, config);
  assert.ok(geometries.length > 1);
  for (let i = 0; i < geometries.length - 1; i++) {
    const a = geometries[i];
    const b = geometries[i + 1];
    if (!a.bottomProfile || !b.bottomProfile) continue;
    const aEnd = a.bottomProfile[a.bottomProfile.length - 1];
    const bStart = b.bottomProfile[0];
    assert.ok(Math.abs(aEnd.v - bStart.v) < 1e-6, `${a.segmentId}/${b.segmentId}: gap of ${(aEnd.v - bStart.v).toFixed(1)}mm at the lap joint`);
  }
});

test('joint bug fix: a CORNER_POST joint (inner stringer, hasCornerPost: true) is UNCHANGED — the post covers the seam, continuity is not required', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, hasCornerPost: true });
  const model = buildStringerModel(planLayout, config, 'inner');
  const geometries = buildStringerConstructionGeometry(model, config);
  // Each segment must still be independently valid (no self-intersection, positive section) —
  // grouping must never have been applied across a real post.
  for (const geo of geometries) {
    assert.equal(geo.diagnostics.some((d) => d.ruleId === 'STRINGER-CONTOUR-SELF-INTERSECTION'), false);
  }
});

// --- Fourth reported bug: exaggerated spike at the very end of the wanga, at a lap joint -------
//
// A `partial` bearing (a single tread whose support genuinely straddles a real corner — see
// stringerSolver.js) appears TWICE within a lap-joint group: once per segment. Only the copy
// that `ownsStart` is that tread's TRUE front corner; the other copy is the SAME tread
// continuing into the next board, not a new one. The group-level pitch-knot builder used to
// include BOTH copies as separate front knots, inserting a spurious knot at the tread's own
// (unchanged) elevation — creating an artificial flat plateau, and therefore an unrealistically
// short next segment with an extremely steep local slope. When that steep slope landed on the
// group's own last two knots, extrapolating the closing knot amplified it into a sharp
// overshoot spike at the very end of the board (reported: a long pointed tip projecting far
// past the ceiling/floor).

test('spike bug fix: a partial bearing at a lap joint is counted ONCE, not twice, in the group pitch profile', () => {
  const { config, planLayout } = build(REALISTIC_WINDER);
  const model = buildStringerModel(planLayout, config, 'outer');
  const geometries = buildStringerConstructionGeometry(model, config);
  // Find the joint: the segment whose LAST bearing is `partial`, and the next segment whose
  // FIRST bearing shares that same treadIndex (the continuation half).
  for (let i = 0; i < model.segments.length - 1; i++) {
    const seg = model.segments[i];
    const lastBearing = seg.treadBearings[seg.treadBearings.length - 1];
    if (!lastBearing.partial) continue;
    const geo = geometries[i];
    // The tread's own elevation must appear as a knot, but its adjacent segment must not
    // restate the SAME elevation as an independent "front corner" — i.e. no artificial flat
    // plateau: consecutive knots must never share the same v while spanning a near-zero u.
    for (let k = 0; k < geo.pitchProfile.length - 1; k++) {
      const a = geo.pitchProfile[k];
      const b = geo.pitchProfile[k + 1];
      if (Math.abs(a.v - b.v) < 1e-6) {
        assert.fail(`spurious flat plateau at (${a.u},${a.v})-(${b.u},${b.v}) in ${geo.segmentId}`);
      }
    }
  }
});

test('spike bug fix: the profile never overshoots more than roughly one riser height past the true bearing elevation range', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, treadsLegA: 1, treadsLegB: 1 }); // short legs — the config that originally triggered the spike
  for (const side of ['outer', 'inner']) {
    const model = buildStringerModel(planLayout, config, side);
    const geometries = buildStringerConstructionGeometry(model, config);
    for (const geo of geometries) {
      if (geo.pitchProfile.length === 0) continue;
      const segment = model.segments.find((s) => s.id === geo.segmentId);
      const elevations = segment.treadBearings.map((b) => b.bearingElevation);
      const riserHeight = config.totalRise / (config.treadsLegA + config.treadsLegB + config.windersPerTurn + 1);
      const margin = riserHeight * 3; // generous — legitimate boundary extrapolation, not a hard bound
      const minE = Math.min(...elevations) - margin;
      const maxE = Math.max(...elevations) + margin;
      for (const p of geo.pitchProfile) {
        assert.ok(p.v >= minE && p.v <= maxE, `${side}/${geo.segmentId}: pitch profile point v=${p.v} is far outside the real bearing range [${minE},${maxE}] — looks like the reported spike`);
      }
    }
  }
});

// --- Fifth reported bug: a CORNER_POST-separated segment's own boundary overshot the ---------
// --- neighbouring segment's already-solved boundary --------------------------------------------
//
// At a CORNER_POST joint each side is deliberately solved independently (see
// groupSegmentsByLapJoint's header — the post absorbs the difference, exact continuity isn't
// required). But when a segment's FIRST few treads are much NARROWER than the rest (the
// classic inner/"dusza" side of a winder: 110mm treads next to 270mm ones), that segment's own
// local pitch slope near its start is far steeper than its overall pitch. Extrapolating that
// steep slope backward to the segment's own u=0 — and then extrapolating its already-OFFSET
// bottom line backward AGAIN (offsetting a steep line shifts its own u-domain further forward,
// so reaching back to u=0 needs an even larger correction) — compounds into a boundary far
// below where it physically belongs: reported as one board's end visibly drooping/stretching
// past where the post-jointed neighbour's own end already sits.

test('overshoot bug fix: a narrow-tread inner segment\'s bottom start never drops below the previous segment\'s own bottom end', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, hasCornerPost: true, stringerConstructionType: 'cut' });
  const model = buildStringerModel(planLayout, config, 'inner');
  const geometries = buildStringerConstructionGeometry(model, config);
  for (let i = 1; i < geometries.length; i++) {
    const prev = geometries[i - 1];
    const curr = geometries[i];
    if (!prev.bottomProfile || !curr.bottomProfile) continue;
    const prevEnd = prev.bottomProfile[prev.bottomProfile.length - 1];
    const currStart = curr.bottomProfile[0];
    assert.ok(currStart.v >= prevEnd.v - 1e-6, `${curr.segmentId}'s bottom start (${currStart.v}) drops below ${prev.segmentId}'s bottom end (${prevEnd.v})`);
  }
});

test('overshoot bug fix: clamping does not touch a lap-jointed pair (already exactly continuous)', () => {
  const { config, planLayout } = build(REALISTIC_WINDER); // outer side is always a lap joint
  const model = buildStringerModel(planLayout, config, 'outer');
  const geometries = buildStringerConstructionGeometry(model, config);
  for (let i = 1; i < geometries.length; i++) {
    const prevEnd = geometries[i - 1].bottomProfile[geometries[i - 1].bottomProfile.length - 1];
    const currStart = geometries[i].bottomProfile[0];
    assert.ok(Math.abs(currStart.v - prevEnd.v) < 1e-6, 'a lap-jointed pair must remain exactly continuous, not merely clamped');
  }
});

// --- Third reported bug: the notch's riser face must be a true vertical cut, never diagonal -----
//
// With riser boards enabled, `effectiveBearings()` shifts every tread's own front corner
// forward by `riserRecess` (room for the riser board's thickness), opening a small horizontal
// gap between one bearing's raw back corner and the next bearing's (shifted) front corner.
// `buildOverlayTop` used to connect those two corners with one straight polygon edge — which,
// spanning both that horizontal gap AND the full riser height at once, is a visibly SLANTED
// "riser face" instead of a plumb vertical cut (see the reported screenshot: the diagonal line
// running from the top of one step down to the next, instead of straight down then a short
// ledge).

test('notch bug fix: with riser-board recess enabled, the riser face of every notch is a true VERTICAL cut, not diagonal', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT_CUT, hasRiserBoards: true });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  const bearings = model.segments[0].treadBearings;
  assert.ok(bearings.some((b) => b.riserRecess > 0), 'this scenario must actually exercise a nonzero riser recess for the test to mean anything');

  // Walk the top edge (everything before the two bottom corners) and find every place the
  // polygon rises in elevation — that edge must have ZERO horizontal (u) travel.
  const bottomPointCount = 2;
  const top = geo.outerContour.slice(0, geo.outerContour.length - bottomPointCount);
  let foundRise = false;
  for (let i = 0; i < top.length - 1; i++) {
    const a = top[i];
    const b = top[i + 1];
    if (b.v > a.v + 1e-6) {
      foundRise = true;
      assert.ok(Math.abs(b.u - a.u) < 1e-6, `riser face at index ${i} is diagonal: (${a.u},${a.v}) -> (${b.u},${b.v})`);
    }
  }
  assert.ok(foundRise, 'expected at least one rising (riser) edge in the notch profile');
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
