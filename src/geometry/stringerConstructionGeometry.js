// STRINGER CONSTRUCTION GEOMETRY — the physical board contour of a real timber stringer,
// derived FROM an already-solved StringerModel (stringerSolver.js). This is NOT a replacement
// for StringerModel/StringerSegment/StringerTreadBearing (those stay exactly as they are —
// the analytical bearing model, never touched here) — it is an ADDITIONAL layer on top of it,
// consumed only by stringerRenderer.js.
//
// --- Why this file exists -------------------------------------------------------------------
//
// Before this file, stringerRenderer.js built ONE independent rectangular panel PER TREAD
// BEARING, each with its own vertical bottom edge at `bearingElevation - boardWidth`. Since
// bearingElevation increases every tread, the panels' BOTTOM edges formed the same staircase
// pattern as their top edges — a stack of boxes, not a real board. A real cut/open string's
// lower edge is a single straight board edge running the full length of the flight; a closed/
// housed string is a plain rectangular board on both edges. This file builds that continuous
// contour instead.
//
// --- The method: an unfolded (S,Z) profile through EVERY bearing, not just the first/last ---
//
// An earlier version of this file struck a single straight "pitch line" through only the
// FIRST and LAST tread bearing of a segment (the traditional two-point carpenter's method —
// exact for a uniform straight flight, since every bearing is collinear with it anyway). On a
// winder, tread widths (and therefore the u-spacing between consecutive bearings) vary
// sharply while riser height stays constant, so intermediate bearings can sit 100-250mm away
// from that 2-point line — see docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md for a real
// measured example. The board's lower (and, for a closed string, upper) edge would then run in
// clean air past several treads, or cut through them, instead of tracking the stair.
//
// The fix: build a PROFILE KNOT for every bearing — (u, Z) = (the bearing's own front corner
// position along the board, its bearingElevation) — plus one closing knot at the last
// bearing's own back corner, extrapolated along the local slope so the very last tread isn't
// forced back to a flat corner (see buildPitchKnots below). For a uniform flight this is,
// after collinearity simplification, EXACTLY the old 2-point line (same output, proven by the
// existing straight-flight tests). For a winder it becomes a genuinely kinked polyline that
// passes through every real bearing position. The board's structural top/bottom edges are then
// solved as OFFSETS of this polyline along its own LOCAL NORMAL (see polylineProfile.js) —
// never as a raw vertical (world-elevation) shift, which is only correct where the profile is
// horizontal and otherwise both moves the edge the wrong distance and, worse, is what made
// "distance to the bottom edge" an inaccurate proxy for actual remaining timber section.
//
// --- Two construction types, two different contours ------------------------------------------
//
//   CUT (overlay/open-cleated, "wanga nakładana"): the TOP edge steps to match each tread's own
//   bearing region (the classic notched/sawtooth top of an open string — a REAL, correct
//   feature of this construction type, not a defect) — this part is UNCHANGED by this
//   refactor, since it already used every bearing's own position. The BOTTOM edge is the
//   knot-profile offset down by `boardWidth`. A separate `cleats[]` array — small support
//   blocks under each tread's seat — is reported alongside, never merged into the board's own
//   outer contour.
//
//   CLOSED (housed/recessed, "wanga wpuszczana"): the outer contour's top and bottom are BOTH
//   the knot-profile, offset up by `stringerTopMarginMm` and down by
//   `boardWidth - stringerTopMarginMm` respectively — continuous and non-stepped even through
//   a winder, per the construction type's own definition (an outer silhouette that never
//   sawtooths). Tread locations are `housings[]` — recesses cut into the board's INNER FACE,
//   which never change the outer silhouette. A new STRINGER-TREAD-SUPPORT diagnostic verifies
//   every housing's own (u, elevation) is actually contained within this solved envelope,
//   rather than silently trusting it.
//
// stringerRenderer.js consumes this file's output and NEVER computes geometry itself; this
// file never touches Three.js.

import { pointsEqual, segmentsProperlyIntersect } from './pathUtils.js';
import { simplifyCollinear, offsetPolylineByNormal, distancePointToPolyline, valueAtU } from './polylineProfile.js';
import { CONSTRUCTION_TYPES, housingDepthFor } from './stringerModel.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { GEOMETRY_EPS } from './tolerances.js';

function toXY(p) {
  return { x: p.u, y: p.v };
}

// --- Corner extension (moved here from stringerRenderer.js — a geometric decision, not a
// rendering one) — when there is no corner post, two segments meeting at a real corner must
// overlap by one board thickness (a simple lap-joint equivalent) so their extrusions don't
// leave a visible gap at the joint. See the original comment history in git for the full
// derivation; the logic itself is unchanged, only its home moved.
function computeOpenCornerExtensions(segments, hasCornerPost) {
  const extendEndOf = new Set();
  const extendStartOf = new Set();
  if (hasCornerPost) return { extendEndOf, extendStartOf };

  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i].referenceLine;
    const b = segments[i + 1].referenceLine;
    if (pointsEqual(a.end, b.start)) {
      extendEndOf.add(i);
      extendStartOf.add(i + 1);
    }
  }
  return { extendEndOf, extendStartOf };
}

// Applies riser-recess (owns-start only) and corner-extension (first/last bearing only) to get
// each bearing's EFFECTIVE [uStart, uEnd] — the exact same adjustments the old per-bearing
// renderer applied, now producing inputs to one continuous contour instead of N rectangles.
function effectiveBearings(segment, extendStart, extendEnd) {
  const bearings = segment.treadBearings;
  return bearings.map((b, i) => {
    let uStart = b.finalUStart;
    let uEnd = b.finalUEnd;
    if (b.ownsStart && b.riserRecess > 0) uStart = Math.min(uEnd, uStart + b.riserRecess);
    if (i === 0 && extendStart) uStart -= segment.thickness;
    if (i === bearings.length - 1 && extendEnd) uEnd += segment.thickness;
    return { ...b, uStart, uEnd };
  });
}

// --- Unfolded (u,Z) profile through every bearing (see file header) --------------------------
//
// One knot per bearing at its own FRONT corner (uStart, bearingElevation) — the traditional
// carpenter's reference point (the "nosing line" is struck through the point where riser meets
// tread, consistently on one side, never mixing a tread's front-flat and back-flat corners,
// which sit at the SAME u but different Z and would fabricate a vertical jump where none
// exists). The closing knot extrapolates the LAST real segment's own local slope out to the
// final bearing's own back corner (u), rather than using that bearing's flat elevation there —
// using the flat elevation would introduce an artificial kink at the very last tread even on a
// perfectly uniform straight flight (verified against this file's own straight-flight tests).
function buildPitchKnots(effective) {
  const front = effective.map((b) => ({ u: b.uStart, v: b.bearingElevation }));
  const last = effective[effective.length - 1];
  const lastKnot = front[front.length - 1];
  let closingV;
  if (front.length >= 2) {
    const prev = front[front.length - 2];
    const du = lastKnot.u - prev.u;
    const slope = du !== 0 ? (lastKnot.v - prev.v) / du : 0;
    closingV = lastKnot.v + slope * (last.uEnd - lastKnot.u);
  } else {
    closingV = lastKnot.v; // a single-bearing run has no local slope to extrapolate — flat is the only option
  }
  return simplifyCollinear([...front, { u: last.uEnd, v: closingV }]);
}

function computePitchLineFromKnots(knots) {
  const start = knots[0];
  const end = knots[knots.length - 1];
  const du = end.u - start.u;
  const slope = du !== 0 ? (end.v - start.v) / du : 0;
  return { start, end, slope };
}

// --- CUT (overlay/open-cleated) --------------------------------------------------------------

// Top edge unchanged from before this refactor — it already used every bearing's own position.
function buildOverlayTop(effective) {
  const top = [];
  for (const b of effective) {
    top.push({ u: b.uStart, v: b.bearingElevation });
    top.push({ u: b.uEnd, v: b.bearingElevation });
  }
  return top;
}

function buildCleats(effective, config) {
  const height = config.stringerCleatHeightMm;
  const thickness = config.stringerCleatThicknessMm;
  return effective.map((b) => ({
    treadIndex: b.treadIndex,
    uStart: b.uStart,
    uEnd: b.uEnd,
    topV: b.bearingElevation,
    height,
    thickness,
  }));
}

// --- CLOSED (housed/recessed) -----------------------------------------------------------------

// Housing height matches the tread's own thickness (a real parametric value already in the
// model, config.treadThickness) — the slot the tread's end actually sits in — never an
// invented number; housing DEPTH (how far it's routed into the board's face) reuses the
// existing BWF-cited housingDepthFor() (see stringerModel.js), unchanged from before this file.
function buildHousings(effective, config) {
  const depth = housingDepthFor(config.stringerThickness);
  return effective.map((b) => ({
    treadIndex: b.treadIndex,
    uStart: b.uStart,
    uEnd: b.uEnd,
    topV: b.bearingElevation,
    bottomV: b.bearingElevation - config.treadThickness,
    depth,
  }));
}

// --- Diagnostics -------------------------------------------------------------------------------

// PERPENDICULAR distance (not a raw vertical Z gap — see file header) from every bearing
// corner to the solved bottom contour — the true remaining material thickness at that point.
function computeMinRemainingSectionCut(effective, bottomPolyline) {
  let min = Infinity;
  for (const b of effective) {
    for (const u of [b.uStart, b.uEnd]) {
      const dist = distancePointToPolyline({ u, v: b.bearingElevation }, bottomPolyline);
      if (dist < min) min = dist;
    }
  }
  return min;
}

// A 'cut' bearing whose corner has crossed THROUGH the bottom edge (perpendicular distance
// <= 0) has no support at all there, not just thin material — a stronger statement than the
// WARNING-level STRINGER-MIN-SECTION check, and reported per affected tread rather than only
// as one aggregate minimum.
function checkCutSupportFailure(effective, bottomPolyline, segmentId) {
  const diags = [];
  for (const b of effective) {
    const distStart = distancePointToPolyline({ u: b.uStart, v: b.bearingElevation }, bottomPolyline);
    const distEnd = distancePointToPolyline({ u: b.uEnd, v: b.bearingElevation }, bottomPolyline);
    if (distStart <= GEOMETRY_EPS || distEnd <= GEOMETRY_EPS) {
      diags.push(
        createDiagnostic({
          ruleId: 'STRINGER-TREAD-SUPPORT',
          severity: 'ERROR',
          elementType: 'stringer',
          elementId: segmentId,
          parameter: 'treadSupport',
          value: b.treadIndex,
          message: `Stopień o indeksie ${b.treadIndex} nie ma podparcia na wandze (${segmentId}) — dolna krawędź przechodzi przez lub nad miejscem oparcia.`,
        })
      );
    }
  }
  return diags;
}

// A 'closed' bearing is recessed INSIDE the board via a housing — this verifies that housing's
// own elevation actually falls within the solved [bottom,top] envelope at its own position,
// rather than trusting that a per-bearing housing and a profile-derived envelope agree. This is
// exactly the check that would have caught the original bug: on the un-fixed 2-point pitch
// line, an intermediate winder bearing's true elevation could fall OUTSIDE the naive
// (uStart/uEnd-only) envelope, i.e. a tread the solved board doesn't actually reach.
function checkClosedSupportContainment(effective, topPolyline, bottomPolyline, segmentId) {
  const diags = [];
  for (const b of effective) {
    for (const u of [b.uStart, b.uEnd]) {
      const top = valueAtU(topPolyline, u);
      const bottom = valueAtU(bottomPolyline, u);
      if (b.bearingElevation > top + GEOMETRY_EPS || b.bearingElevation < bottom - GEOMETRY_EPS) {
        diags.push(
          createDiagnostic({
            ruleId: 'STRINGER-TREAD-SUPPORT',
            severity: 'ERROR',
            elementType: 'stringer',
            elementId: segmentId,
            parameter: 'treadSupport',
            value: b.treadIndex,
            message: `Stopień o indeksie ${b.treadIndex} wykracza poza bryłę wangi (${segmentId}) — brak podparcia w tym miejscu.`,
          })
        );
        break;
      }
    }
  }
  return diags;
}

function hasSelfIntersection(polygon) {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = toXY(polygon[i]);
    const a2 = toXY(polygon[(i + 1) % n]);
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i || (j + 1) % n === i || (i + 1) % n === j;
      if (adjacent) continue;
      const b1 = toXY(polygon[j]);
      const b2 = toXY(polygon[(j + 1) % n]);
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// --- Per-segment builder -----------------------------------------------------------------------

function buildSegmentConstructionGeometry(segment, { config, extendStart, extendEnd }) {
  const diagnostics = [];
  if (segment.treadBearings.length === 0) {
    return {
      segmentId: segment.id,
      constructionType: segment.constructionType,
      pitchLine: null,
      pitchProfile: [],
      outerContour: [],
      boardWidthMm: segment.width,
      thicknessMm: segment.thickness,
      minRemainingSectionMm: null,
      diagnostics,
    };
  }

  const effective = effectiveBearings(segment, extendStart, extendEnd);
  const pitchKnots = buildPitchKnots(effective);
  const pitchLine = computePitchLineFromKnots(pitchKnots);
  const constructionType = segment.constructionType;
  const boardWidth = segment.width;

  let outerContour;
  let cleats;
  let housings;
  let bottomPolyline;
  let topPolyline = null;

  if (constructionType === CONSTRUCTION_TYPES.CUT) {
    bottomPolyline = offsetPolylineByNormal(pitchKnots, boardWidth, 'down');
    const top = buildOverlayTop(effective);
    outerContour = [...top, ...bottomPolyline.slice().reverse()];
    // Cleats are an optional support method, not a universal feature of a cut string — see
    // STAIR3D-STRINGER-CLEATS-OPTIONALITY (docs/STRINGER_CONSTRUCTION_SPEC.md §I). When
    // disabled, the tread rests on the notch alone: an empty array, never a hidden assumption.
    cleats = config.stringerCleatsEnabled === false ? [] : buildCleats(effective, config);
    diagnostics.push(...checkCutSupportFailure(effective, bottomPolyline, segment.id));
  } else {
    const topMarginMm = config.stringerTopMarginMm ?? 0;
    topPolyline = offsetPolylineByNormal(pitchKnots, topMarginMm, 'up');
    bottomPolyline = offsetPolylineByNormal(pitchKnots, boardWidth - topMarginMm, 'down');
    outerContour = [...topPolyline, ...bottomPolyline.slice().reverse()];
    housings = buildHousings(effective, config);
    diagnostics.push(...checkClosedSupportContainment(effective, topPolyline, bottomPolyline, segment.id));
  }

  const minRemainingSectionMm =
    constructionType === CONSTRUCTION_TYPES.CLOSED
      ? config.stringerThickness - housingDepthFor(config.stringerThickness)
      : computeMinRemainingSectionCut(effective, bottomPolyline);
  const minRequired = config.stringerMinRemainingSectionMm ?? 0;
  if (minRemainingSectionMm < minRequired) {
    diagnostics.push(
      createDiagnostic({
        ruleId: 'STRINGER-MIN-SECTION',
        severity: 'WARNING',
        elementType: 'stringer',
        elementId: segment.id,
        parameter: 'minRemainingSectionMm',
        value: Math.round(minRemainingSectionMm * 10) / 10,
        expected: `>= ${minRequired}`,
        unit: 'mm',
        message: `Wanga (${segment.id}) ma za mało materiału w najcieńszym miejscu — ryzyko osłabienia konstrukcji.`,
      })
    );
  }

  if (hasSelfIntersection(outerContour)) {
    diagnostics.push(
      createDiagnostic({
        ruleId: 'STRINGER-CONTOUR-SELF-INTERSECTION',
        severity: 'ERROR',
        elementType: 'stringer',
        elementId: segment.id,
        parameter: 'outerContour',
        message: `Kontur wangi (${segment.id}) jest samoprzecinający się — geometria nieprawidłowa.`,
      })
    );
  }

  return {
    segmentId: segment.id,
    constructionType,
    pitchLine,
    // DEBUG DATA (see docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md §14) — the full solved
    // (u,Z) profile and its top/bottom envelope, exposed so a future debug view can show
    // exactly why the contour has its shape without recomputing anything. Not consumed by
    // stringerRenderer.js (it only reads outerContour/cleats/housings), so adding fields here
    // is safe and additive.
    pitchProfile: pitchKnots,
    topProfile: topPolyline,
    bottomProfile: bottomPolyline,
    outerContour,
    cleats,
    housings,
    boardWidthMm: boardWidth,
    thicknessMm: segment.thickness,
    minRemainingSectionMm,
    diagnostics,
  };
}

/**
 * @param {import('./stringerModel.js').StringerModel} model  Already built by
 *   stringerSolver.js — never rebuilt or re-derived here.
 * @param {Object} config  Full config (post riserHeight merge) — read for
 *   stringerTopMarginMm/stringerMinRemainingSectionMm/stringerCleatThicknessMm/
 *   stringerCleatHeightMm/treadThickness/hasCornerPost; never mutated.
 * @returns {import('./stringerModel.js').StringerSegmentConstructionGeometry[]}
 */
export function buildStringerConstructionGeometry(model, config) {
  const { extendStartOf, extendEndOf } = computeOpenCornerExtensions(model.segments, config.hasCornerPost);
  return model.segments.map((segment, segIdx) =>
    buildSegmentConstructionGeometry(segment, {
      config,
      extendStart: extendStartOf.has(segIdx),
      extendEnd: extendEndOf.has(segIdx),
    })
  );
}
