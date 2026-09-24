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
const REALISTIC_STRAIGHT_CUT = { ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };

// --- A. Straight overlay (cut) stringer -------------------------------------------------------

test('A. straight overlay: one continuous polygon, stepped top + single straight bottom edge, no disconnected blocks', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);

  assert.equal(geo.constructionType, CONSTRUCTION_TYPES.CUT);
  const bearingCount = model.segments[0].treadBearings.length;
  // Exactly 2 top points per bearing (the step) + 2 bottom corners + 1 floor-foot corner (the
  // board's foot is cut horizontally on the floor with a vertical start face) — ONE polygon, not N
  // disconnected rectangles (which would instead be 4*N unrelated points with no shared edges).
  assert.equal(geo.outerContour.length, bearingCount * 2 + 3);
  assert.equal(geo.diagnostics.length, 0, `expected no diagnostics on a realistic config, got: ${JSON.stringify(geo.diagnostics)}`);
  assert.ok(isSimplePolygon(geo.outerContour), 'outer contour must not self-intersect');
  assert.ok(geo.minRemainingSectionMm > 0, 'material thickness must be positive everywhere');

  // The bottom edge is a SINGLE straight line: its two endpoints' slope must match the pitch
  // line's own slope (continuity — not per-bearing steps on the bottom).
  const bottomEnd = geo.outerContour[geo.outerContour.length - 3];
  const bottomStart = geo.outerContour[geo.outerContour.length - 2];
  const bottomSlope = (bottomEnd.v - bottomStart.v) / (bottomEnd.u - bottomStart.u);
  assert.ok(Math.abs(bottomSlope - geo.pitchLine.slope) < 1e-9);

  // A cut string has NO separate support blocks (cleats were removed) and no housings.
  assert.equal(geo.cleats, undefined);
  assert.equal(geo.housings, undefined);
});

// --- B. Straight housed (closed) stringer -------------------------------------------------------

test('B. straight housed: outer contour is a plain 4-point parallelogram regardless of tread count, housings are separate', () => {
  // At the bottom of the flight the board's foot is cut HORIZONTALLY on the floor line with a vertical
  // start face, so the silhouette is a parallelogram plus that one foot corner (5 points).
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', stringerThickness: 50, minimumStringerDepthMm: 300 });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);

  assert.equal(geo.constructionType, CONSTRUCTION_TYPES.CLOSED);
  assert.equal(geo.outerContour.length, 5, 'a housed board is one plain parallelogram in profile + the floor foot, independent of how many treads it supports');
  assert.ok(isSimplePolygon(geo.outerContour));

  // Both top and bottom edges are straight and PARALLEL to the pitch line.
  const [p0, p1, p2, p3, foot] = geo.outerContour;
  // The foot: horizontal along the floor (v = 0), start face vertical (same u as the top start).
  assert.equal(p3.v, 0);
  assert.equal(foot.v, 0);
  assert.equal(foot.u, p0.u);
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

// Regression: a tread's nosing is milled into the SAME physical board as the tread, overhanging
// past its structural front edge — the housing that receives that board end-on must be as long as
// the whole board, nosing included, or a workshop cuts a slot too short for the real board
// (reported: a 3D view showing 25mm nosing next to a housing marking only the nominal going).
test('B2. housed: a housing extends by config.nosing on its own front (ownsStart) corner, never on the back', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', nosing: 25 });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  const bearings = model.segments[0].treadBearings;
  assert.equal(geo.housings.length, bearings.length);
  for (const h of geo.housings) {
    const b = bearings.find((bb) => bb.treadIndex === h.treadIndex);
    const nominalStart = b.finalUStart + (b.ownsStart && b.riserRecess > 0 ? b.riserRecess : 0);
    assert.equal(h.uStart, b.ownsStart ? nominalStart - config.nosing : nominalStart);
    assert.equal(h.uEnd, b.finalUEnd);
  }
  // With nosing=0 the housing is exactly the structural bearing width (no regression for the
  // existing, already-tested no-nosing case).
  const zeroNosing = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', nosing: 0 });
  const modelNoNosing = buildStringerModel(zeroNosing.planLayout, zeroNosing.config, 'outer');
  const [geoNoNosing] = buildStringerConstructionGeometry(modelNoNosing, zeroNosing.config);
  assert.equal(geoNoNosing.housings[0].uStart, modelNoNosing.segments[0].treadBearings[0].finalUStart);
});

// Regression: `effectiveBearings()` shifts a bearing's `uStart` forward by `riserRecess` (room for
// a riser board's plumb cut, a CUT-notch concern — see stringerSolver.js) whenever risers are
// enabled — and `riserRecess` happens to equal `nosing` exactly whenever it is nonzero. Subtracting
// `nosing` straight off that ALREADY-SHIFTED value silently cancelled the two out, snapping a
// housing's nosing extension back to zero the moment risers were switched on (reported: "housings/
// nosing disappear when I add risers" — riserRecess and nosing extension are unrelated concerns
// that happen to share config.nosing's value, not the same thing).
test('B2b. housed: the nosing extension survives switching on riser boards (a previously unrelated shift must not cancel it)', () => {
  const risersOff = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', nosing: 25, hasRiserBoards: false });
  const modelOff = buildStringerModel(risersOff.planLayout, risersOff.config, 'outer');
  const [geoOff] = buildStringerConstructionGeometry(modelOff, risersOff.config);

  const risersOn = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', nosing: 25, hasRiserBoards: true });
  const modelOn = buildStringerModel(risersOn.planLayout, risersOn.config, 'outer');
  const [geoOn] = buildStringerConstructionGeometry(modelOn, risersOn.config);

  assert.ok(geoOff.housings.length > 0 && geoOn.housings.length > 0);
  for (let i = 0; i < geoOff.housings.length; i++) {
    assert.equal(geoOn.housings[i].uStart, geoOff.housings[i].uStart, `housing ${i}: nosing extension must be identical whether risers are on or off`);
  }
});

// Regression: bearingElevation is world Z of the TOP OF THE BEARING SURFACE the tread rests on
// (the tread's own BOTTOM — see StringerTreadBearing's doc comment and stringerSolver.js's own
// `(index+1)*riserHeight - treadThickness` formula, matching TreadModel.elevation.bottom and
// stringerProfileView.js's `treads` array). A housing marking that same tread must span UP from
// bearingElevation, not down — spanning down put every housing/tread marker a whole treadThickness
// too low (worse the higher up a sloped board, since the misalignment compounds visually with the
// slope) — reported against a real project's DXF export where the board line ran through the
// wrong corner of every housing box.
test('B3. housed: a housing spans UP from bearingElevation (the tread\'s own bottom), matching TreadModel/stringerProfileView\'s own convention', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  for (const h of geo.housings) {
    const b = model.segments[0].treadBearings.find((bb) => bb.treadIndex === h.treadIndex);
    assert.equal(h.bottomV, b.bearingElevation);
    assert.equal(h.topV, b.bearingElevation + config.treadThickness);
  }
});

// Regression/feature: a housed wanga must also carry a real gniazdo (housing) for the RISER
// board, not just for the tread — reported: the profile editor drew a proper housing rectangle
// for the tread but only a thin line for the riser. Each tread-owning bearing must produce BOTH
// a 'tread' and a 'riser' housing, kept apart by `kind` (so every other consumer — profile
// editor, DXF export, the 3D indicator mesh — can tell them apart without a parallel array).
test('housed + riser boards: every ownsStart bearing also gets a kind:"riser" housing, positioned and elevated per riserSolver.js\'s own RiserModel formula', () => {
  const { config, planLayout } = build({
    ...REALISTIC_STRAIGHT,
    stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed',
    hasRiserBoards: true,
    riserBoardThickness: 22,
    riserTopOverlapMm: 12,
  });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  const bearings = model.segments[0].treadBearings;

  const treadHousings = geo.housings.filter((h) => h.kind === 'tread');
  const riserHousings = geo.housings.filter((h) => h.kind === 'riser');
  assert.equal(treadHousings.length, bearings.length);
  assert.equal(riserHousings.length, bearings.filter((b) => b.ownsStart).length);

  for (const h of riserHousings) {
    const b = bearings.find((bb) => bb.treadIndex === h.treadIndex);
    assert.equal(h.uStart, b.finalUStart);
    assert.equal(h.uEnd, b.finalUStart + config.riserBoardThickness);
    assert.equal(h.bottomV, b.bearingElevation - config.riserHeight);
    assert.equal(h.topV, b.bearingElevation + config.riserTopOverlapMm);
  }
});

test('housed, no riser boards: no riser housings are produced (kind:"riser" absent entirely)', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', hasRiserBoards: false });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  assert.equal(geo.housings.filter((h) => h.kind === 'riser').length, 0);
  assert.ok(geo.housings.every((h) => h.kind === 'tread'));
});

// --- C/D. L-winder, both construction types ----------------------------------------------------

for (const [label, constructionType] of [
  ['C. L-winder overlay', 'cut'],
  ['D. L-winder housed', 'closed'],
]) {
  test(`${label}: every segment produces a continuous, non-self-intersecting contour`, () => {
    const { config, planLayout } = build({ ...REALISTIC_WINDER, stringerConstructionTypeOuter: constructionType, stringerConstructionTypeInner: constructionType });
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
  // Board widths chosen small enough that the offset bottom corner near the first tread stays
  // above the floor (v >= 0) — clampFirstSegmentToFloor (a separate, deliberate behavior; see
  // its own tests) would otherwise trim that corner flush with the floor instead of keeping it
  // at a pure perpendicular offset, which is specifically what this test checks.
  const narrow = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', minimumStringerDepthMm: 80 });
  const wide = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', minimumStringerDepthMm: 100 });
  const geoNarrow = buildStringerConstructionGeometry(buildStringerModel(narrow.planLayout, narrow.config, 'outer'), narrow.config)[0];
  const geoWide = buildStringerConstructionGeometry(buildStringerModel(wide.planLayout, wide.config, 'outer'), wide.config)[0];

  assert.equal(geoNarrow.boardWidthMm, 80);
  assert.equal(geoWide.boardWidthMm, 100);

  // Every bearing's front corner sits exactly ON the (pre-offset) pitch profile by
  // construction, so its perpendicular distance to the offset bottom line must equal the
  // configured board width exactly, for both widths.
  const knotNarrow = geoNarrow.pitchProfile[0];
  const knotWide = geoWide.pitchProfile[0];
  assert.ok(Math.abs(distancePointToPolyline(knotNarrow, geoNarrow.bottomProfile) - 80) < 1e-6);
  assert.ok(Math.abs(distancePointToPolyline(knotWide, geoWide.bottomProfile) - 100) < 1e-6);
});

// --- H. Changed board thickness -------------------------------------------------------------

test('H. changed board thickness is reflected in thicknessMm and in the housed diagnostic (thinner board = less remaining section)', () => {
  const thin = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', stringerThickness: 30 });
  const thick = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', stringerThickness: 60 });
  const geoThin = buildStringerConstructionGeometry(buildStringerModel(thin.planLayout, thin.config, 'outer'), thin.config)[0];
  const geoThick = buildStringerConstructionGeometry(buildStringerModel(thick.planLayout, thick.config, 'outer'), thick.config)[0];

  assert.equal(geoThin.thicknessMm, 30);
  assert.equal(geoThick.thicknessMm, 60);
  assert.ok(geoThin.minRemainingSectionMm < geoThick.minRemainingSectionMm, 'a thinner board must leave less material behind the housing');
});

// --- Reference line / parallelism invariants must survive the new construction-geometry layer ---

test('paired stringers remain parallel and correctly spaced after building construction geometry (both construction types)', () => {
  for (const constructionType of ['cut', 'closed']) {
    const { config, planLayout } = build({ ...REALISTIC_STRAIGHT, stringerConstructionTypeOuter: constructionType, stringerConstructionTypeInner: constructionType, stairWidth: 1000 });
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
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerMinRemainingSectionMm: 320 });
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
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA, totalRise, treadGoing, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  const riserHeight = totalRise / (treadsLegA + 1);
  const expectedThroat = geo.boardWidthMm - (riserHeight * treadGoing) / Math.hypot(treadGoing, riserHeight);
  assert.ok(Math.abs(geo.minRemainingSectionMm - expectedThroat) < 1e-3, `expected ${expectedThroat}, got ${geo.minRemainingSectionMm}`);
  assert.ok(geo.minRemainingSectionMm > 0, 'must be a real positive thickness, not the old negative/self-intersecting reading');
});

// --- THE reported bug: winder tread widths must not disconnect the board from the treads --------

test('winder bug fix: every bearing on a winder segment is fully contained within the solved board envelope (no floating tread)', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
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

// Regression: lowerControl/upperControl's `u` is shifted from the GROUP's own u (all boards of a
// lap-jointed run solved together, see the joint-bug-fix tests above) to each board's own LOCAL u
// (`localControl()`, so a side view can draw/measure it against that one board alone) — but
// `nominal.u` (nested inside each control point) was left in the group's u, since it was only
// ever read as a NESTED object, easy to miss when writing the shift. For the group's FIRST board
// segStart is ~0, masking the bug entirely; a report ("editing board 1 works, board 2 doesn't
// move at all") traced to exactly this: stringerProfileView.js's offsetFromDrag() measures a drag
// from `nominal`, so a still-group-level nominal against a now-local `u` computed a wildly wrong
// (ds, dn) — off by roughly the previous boards' own combined length — which either silently
// folded the contour (rejected, point snapping back) or moved it somewhere absurd.
test('control point bug fix: nominal.u is shifted to the SAME local frame as u on every board, not just the first', () => {
  const { config, planLayout } = build(REALISTIC_WINDER);
  const model = buildStringerModel(planLayout, config, 'outer');
  const geometries = buildStringerConstructionGeometry(model, config);
  assert.ok(geometries.length > 1, 'need at least 2 boards for segStart to be nonzero anywhere');
  for (const g of geometries) {
    for (const list of [g.lowerControl, g.upperControl]) {
      for (const c of list || []) {
        if (!c.nominal) continue;
        // Every point here is unedited (no manualStringerProfileOverrides in this config), so its
        // CURRENT position must equal its NOMINAL position exactly — in whatever frame `u` is in.
        assert.ok(Math.abs(c.u - c.nominal.u) < 1e-6, `${g.segmentId}/${c.id}: u=${c.u} but nominal.u=${c.nominal.u} — different frames`);
      }
    }
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
    // A postless lap joint makes the boards OVERLAP by one board thickness, so the two ends are
    // not at the same place; the joint itself is the plane at a's length / b's u=0 — compare the
    // two lower edges THERE.
    const jointU = a.pitchProfile[a.pitchProfile.length - 1].u;
    const aAtJoint = valueAtU(a.bottomProfile, jointU);
    const bAtJoint = valueAtU(b.bottomProfile, 0);
    assert.ok(Math.abs(aAtJoint - bAtJoint) < 1e-6, `${a.segmentId}/${b.segmentId}: gap of ${(aAtJoint - bAtJoint).toFixed(1)}mm at the lap joint`);
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

// SUPERSEDED. This test used to assert the opposite — that such a board's bottom start is raised to
// the previous board's bottom end. That clamp turned the start of a steep board (narrow dusza treads
// after a winder post) into a beak and pushed the local depth below the minimum (reported with a
// screenshot of inner-seg-1). The lower edge now runs straight to the start face, lower than the
// neighbour's end if it must; the post covers the difference.
for (const constructionType of ['cut', 'closed']) {
  test(`start-of-board fix (${constructionType}): a post-jointed steep board's lower edge runs straight to its start face — no beak, never shallower than the minimum depth`, () => {
    const layouts = [
      build({ ...REALISTIC_WINDER, hasCornerPost: true, stringerConstructionTypeOuter: constructionType, stringerConstructionTypeInner: constructionType }),
      build({ stairType: 'L', treadsLegA: 5, treadsLegB: 5, windersPerTurn: 5, totalRise: 2800, treadGoing: 270, hasCornerPost: true, stringerConstructionTypeOuter: constructionType, stringerConstructionTypeInner: constructionType }),
    ];
    for (const { config, planLayout } of layouts) {
      const model = buildStringerModel(planLayout, config, 'inner');
      const geometries = buildStringerConstructionGeometry(model, config);
      assert.ok(geometries.length > 1);
      for (let i = 1; i < geometries.length; i++) {
        const g = geometries[i];
        // Measured from the pitch curve R (the reference the lower edge is generated from, through
        // bearingElevation — the tread's own BOTTOM). A housed board's upper edge sits topMarginMm
        // above the tread's own TOP, i.e. (topMarginMm + treadThickness) above R (see
        // stringerProfileSolver.js solveStringerProfile), so its lower edge is
        // (depth - topMarginMm - treadThickness) from R.
        const required = config.minimumStringerDepthMm - (constructionType === 'closed' ? config.stringerTopMarginMm + config.treadThickness : 0);
        // every point of the lower edge, INCLUDING the start face, keeps that depth
        for (const p of g.bottomProfile) {
          const depth = distancePointToPolyline(p, g.pitchProfile);
          assert.ok(depth >= required - 1e-3, `${g.segmentId}: lower edge point (${p.u.toFixed(0)},${p.v.toFixed(0)}) is only ${depth.toFixed(1)} mm deep`);
        }
        // the start of the lower edge is on the SAME straight line as the next control vertex (no kink at the start)
        if (g.bottomProfile.length >= 3) {
          const [a, b, c] = g.bottomProfile;
          const dirA = Math.atan2(b.v - a.v, b.u - a.u);
          const dirB = Math.atan2(c.v - b.v, c.u - b.u);
          const bendDeg = Math.abs(((dirB - dirA) * 180) / Math.PI);
          assert.ok(bendDeg < 45, `${g.segmentId}: the lower edge bends ${bendDeg.toFixed(0)} degrees right after its start (a beak)`);
        }
      }
    }
  });
}

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

// --- Sixth reported bug: the very first segment's own bottom-start extended below the floor ----
//
// Reaching the FIRST segment's own u=0 boundary (no preceding segment to clamp against)
// extrapolates its local pitch slope backward from the first real bearing, then offsets the
// result down by the full board width. Near the very bottom of a flight the first tread's own
// elevation (one riser height) is often smaller than the board's own width, so the offset point
// naturally lands below the floor (v < 0) — reported as the stringer's bottom visibly extending
// through the floor into a long pointed spike.

test('floor bug fix: the very first segment of a stringer never extends below the floor (v < 0)', () => {
  const { config, planLayout } = build({ ...REALISTIC_WINDER, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasRiserBoards: true, hasCornerPost: true });
  for (const side of ['outer', 'inner']) {
    const model = buildStringerModel(planLayout, config, side);
    const geometries = buildStringerConstructionGeometry(model, config);
    const first = geometries[0];
    const minV = Math.min(...first.outerContour.map((p) => p.v));
    assert.ok(minV >= -1e-6, `${side}/${first.segmentId}: outer contour dips to v=${minV}, below the floor`);
    assert.equal(first.diagnostics.some((d) => d.ruleId === 'STRINGER-CONTOUR-SELF-INTERSECTION'), false, 'trimming to the floor must not introduce a self-intersection');
  }
});

test('floor bug fix: trimming to the floor cuts the board off along its own line (not a vertical snap that crosses the notch pattern)', () => {
  const { config, planLayout } = build({ ...REALISTIC_STRAIGHT_CUT, hasRiserBoards: true, minimumStringerDepthMm: 380 });
  const model = buildStringerModel(planLayout, config, 'outer');
  const [geo] = buildStringerConstructionGeometry(model, config);
  assert.ok(geo.bottomProfile[0].v === 0 || geo.bottomProfile[0].v > 0, 'must not remain below the floor');
  assert.ok(isSimplePolygon(geo.outerContour), 'trimming to the floor must produce a simple, non-self-intersecting polygon');
});

test('floor bug fix: only the very first segment is trimmed — a later, already-elevated segment is untouched', () => {
  const { config, planLayout } = build(REALISTIC_WINDER);
  const model = buildStringerModel(planLayout, config, 'outer');
  const geometries = buildStringerConstructionGeometry(model, config);
  for (let i = 1; i < geometries.length; i++) {
    assert.ok(Math.min(...geometries[i].outerContour.map((p) => p.v)) > 0, `${geometries[i].segmentId} should be well above the floor already, no trim needed`);
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

// Regression: the wanga steps back for the riser by the riser board's own THICKNESS, whatever the
// nosing is (nosing is only an overhang measured forward from the riser face). It used to be
// `nosing`, so with nosing 0 a cut wanga collided with the riser and no riser showed in the profile.
test('cut wanga: riserRecess equals riserBoardThickness, independent of nosing', () => {
  for (const nosing of [0, 25, 40]) {
    const { config, planLayout } = build({ ...REALISTIC_STRAIGHT_CUT, hasRiserBoards: true, riserBoardThickness: 30, nosing });
    const model = buildStringerModel(planLayout, config, 'outer');
    for (const b of model.segments[0].treadBearings) assert.equal(b.riserRecess, 30, `nosing ${nosing}`);
  }
  const off = build({ ...REALISTIC_STRAIGHT_CUT, hasRiserBoards: false, nosing: 25 });
  const modelOff = buildStringerModel(off.planLayout, off.config, 'outer');
  for (const b of modelOff.segments[0].treadBearings) assert.equal(b.riserRecess, 0);
});

// Regression: a tight winder (3 winders per turn — the dusza treads are ~13 mm wide, the board's
// reference climbs almost vertically) got a STRINGER-MIN-DEPTH ERROR (21 mm) on a board whose FINAL
// lower edge is 350 mm deep: the finding was measured on the flat-capped slice BEFORE
// blendCappedStartsToPreviousEnd() deepened the board start down to the neighbour's end (the local
// widening a winder needs). The depth is now re-measured on the final edge.
test('tight winder (cut): the start blend\'s deepening is reflected in localDepthMm and no false MIN-DEPTH/MIN-SECTION is reported', () => {
  const { config, planLayout } = build({
    stairType: 'L',
    turn1Type: 'winder',
    treadsLegA: 4,
    treadsLegB: 4,
    windersPerTurn: 3,
    totalRise: 2600,
    treadGoing: 280,
    stringerConstructionTypeOuter: 'cut',
    stringerConstructionTypeInner: 'cut',
  });
  const model = buildStringerModelsForFlight(planLayout, config).inner;
  const geos = buildStringerConstructionGeometry(model, config);
  const blended = geos.filter((g) => g.ends.start.blendedToPreviousEnd);
  assert.ok(blended.length > 0, 'this scenario must actually exercise the start blend');
  for (const g of blended) {
    assert.ok(g.localDepthMm >= config.minimumStringerDepthMm - 1, `${g.segmentId}: depth ${g.localDepthMm}`);
    assert.ok(!g.diagnostics.some((d) => d.ruleId === 'STRINGER-MIN-DEPTH' || d.ruleId === 'STRINGER-MIN-SECTION'), `${g.segmentId}: ${g.diagnostics.map((d) => d.ruleId)}`);
  }
});
