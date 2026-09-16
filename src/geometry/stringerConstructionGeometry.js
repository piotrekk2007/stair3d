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
import { simplifyCollinear, offsetPolylineByNormal, distancePointToPolyline, valueAtU, slicePolylineByU, sliceOffsetProfile } from './polylineProfile.js';
import { CONSTRUCTION_TYPES, CONNECTION_TYPES, housingDepthFor } from './stringerModel.js';
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

// --- Grouping segments that must share ONE continuous profile ---------------------------------
//
// stringerSolver.js already tells us exactly which adjacent segments are joined by a LAP_JOINT
// (board ends butted directly together, no post — see StringerModel.segmentJoints) versus a
// CORNER_POST (a newel physically interrupts the run, so the two boards' own profiles never
// need to meet: the post's own face covers whatever the two board ends do at their own
// elevations). Building each segment's pitch/offset profile in total isolation is only correct
// within one board — across a LAP_JOINT it produces a real, physical discontinuity: each side's
// profile is fit only from ITS OWN bearings, so their independently-offset bottom (or, for a
// closed board, top) edges generally do NOT meet at the shared corner point, however well each
// one behaves on its own. A CORNER_POST joint needs no such fix (verified: forcing continuity
// there is unnecessary and not how a real post-jointed corner is built).
function groupSegmentsByLapJoint(segments, segmentJoints) {
  const lapJointBefore = new Set(segmentJoints.filter((j) => j.type === CONNECTION_TYPES.LAP_JOINT).map((j) => j.beforeSegmentId));
  const groups = [];
  let current = [];
  for (const seg of segments) {
    current.push(seg);
    if (!lapJointBefore.has(seg.id)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
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
//
// Built across a WHOLE lap-joint group at once (see groupSegmentsByLapJoint): `effectiveByGroup`
// is one array of effective bearings PER SEGMENT in the group, and each segment's own u is
// shifted by its own cumulative offset (the sum of the PRECEDING segments' own
// `referenceLine.length` in the group) — an "unfold" of the group's own physically-joined
// reference lines into one continuous distance-traveled parameter, exactly so a board that
// bends at a real (postless) corner still gets ONE solved profile instead of two that don't
// meet. A single-segment group (the ordinary case — most corners in this codebase have a post)
// degenerates to exactly the old per-segment behavior, offset 0.
function buildPitchKnots(effectiveByGroup, segmentLengths) {
  const knots = [];
  const offsets = [];
  let offset = 0;
  for (let i = 0; i < effectiveByGroup.length; i++) {
    offsets.push(offset);
    for (const b of effectiveByGroup[i]) {
      // A `partial` bearing (a single tread whose support genuinely straddles a real corner —
      // see stringerSolver.js) appears TWICE in a lap-joint group: once in each segment. Only
      // the copy that `ownsStart` represents that tread's TRUE front corner; the other copy is
      // the SAME tread continuing into the next board, not a new tread. Including it here would
      // insert a spurious knot at the tread's own (unchanged) elevation, creating an artificial
      // flat plateau in the profile — and, worse, a following segment with an unrealistically
      // small u-span (since two consecutive knots end up almost on top of each other), giving an
      // extremely steep local slope. If that steep slope lands on the group's own last two
      // knots, closing-knot extrapolation amplifies it into the sharp overshoot spike reported
      // at the very ends of the board (see docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md §14).
      if (!b.ownsStart) continue;
      knots.push({ u: offset + b.uStart, v: b.bearingElevation });
    }
    offset += segmentLengths[i];
  }
  const lastSegBearings = effectiveByGroup[effectiveByGroup.length - 1];
  const last = lastSegBearings[lastSegBearings.length - 1];
  const lastOffset = offsets[offsets.length - 1];
  const lastKnot = knots[knots.length - 1];
  let closingV;
  if (knots.length >= 2) {
    const prev = knots[knots.length - 2];
    const du = lastKnot.u - prev.u;
    const slope = du !== 0 ? (lastKnot.v - prev.v) / du : 0;
    closingV = lastKnot.v + slope * (lastOffset + last.uEnd - lastKnot.u);
  } else {
    closingV = lastKnot.v; // a single-bearing group has no local slope to extrapolate — flat is the only option
  }
  const allKnots = simplifyCollinear([...knots, { u: lastOffset + last.uEnd, v: closingV }]);
  return { knots: allKnots, offsets };
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
// A tread's own bearing is flat (its front and back corner share one elevation) — the RISE to
// the next tread must therefore happen as a genuinely VERTICAL cut (constant u), never as a
// single diagonal line drawn straight from one bearing's back corner to the next bearing's
// front corner. Those two corners only coincide (u AND giving a naturally-vertical polygon
// edge) when there is no riser-board recess; `effectiveBearings()` shifts a riser-board tread's
// OWN front corner forward by `riserRecess`, opening a small horizontal gap between this
// bearing's raw back corner and the next one's (shifted) front corner. Left unfixed, the
// polygon's own edge across that gap is a straight line spanning BOTH the horizontal gap and
// the full riser height at once — a visibly slanted "riser face" instead of a plumb-cut one.
// The correct notch shape is an L: a short flat ledge at THIS tread's own elevation across the
// gap (the physical shoulder the riser board's edge sits against), then a true vertical rise at
// the next tread's own front corner.
function buildOverlayTop(effective) {
  const top = [];
  effective.forEach((b, i) => {
    top.push({ u: b.uStart, v: b.bearingElevation });
    top.push({ u: b.uEnd, v: b.bearingElevation });
    const next = effective[i + 1];
    if (next && next.uStart > b.uEnd) {
      top.push({ u: next.uStart, v: b.bearingElevation });
    }
  });
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

// Builds ONE result for a segment with no tread bearings at all (a real, if unusual, case —
// see stringerSolver.js) — nothing to solve, nothing to take off.
function emptySegmentGeometry(segment) {
  return {
    segmentId: segment.id,
    constructionType: segment.constructionType,
    pitchLine: null,
    pitchProfile: [],
    topProfile: null,
    bottomProfile: null,
    outerContour: [],
    boardWidthMm: segment.width,
    thicknessMm: segment.thickness,
    minRemainingSectionMm: null,
    diagnostics: [],
  };
}

// --- Group builder -------------------------------------------------------------------------
//
// Solves ONE continuous profile for every segment in a lap-joint group (see
// groupSegmentsByLapJoint), then slices it back into each segment's own LOCAL (u,v) — so a
// segment's own outerContour/pitchProfile/diagnostics look exactly like a single-segment
// result would, but a board that spans a postless corner now has edges that actually meet
// there, instead of two independently-fit profiles that happen to disagree at the join.
function buildGroupConstructionGeometry(group, extendInfo, config) {
  const withBearings = group.filter((s) => s.treadBearings.length > 0);
  if (withBearings.length === 0) return group.map(emptySegmentGeometry);

  const effectiveByGroup = withBearings.map((s) => effectiveBearings(s, extendInfo.get(s.id).extendStart, extendInfo.get(s.id).extendEnd));
  const segmentLengths = withBearings.map((s) => s.referenceLine.length);
  const { knots: groupKnots, offsets } = buildPitchKnots(effectiveByGroup, segmentLengths);
  const constructionType = withBearings[0].constructionType;
  const boardWidth = withBearings[0].width;

  let groupBottom;
  let groupTop = null;
  if (constructionType === CONSTRUCTION_TYPES.CUT) {
    groupBottom = offsetPolylineByNormal(groupKnots, boardWidth, 'down');
  } else {
    const topMarginMm = config.stringerTopMarginMm ?? 0;
    groupTop = offsetPolylineByNormal(groupKnots, topMarginMm, 'up');
    groupBottom = offsetPolylineByNormal(groupKnots, boardWidth - topMarginMm, 'down');
  }

  const bySegmentId = new Map();
  withBearings.forEach((segment, i) => {
    const effective = effectiveByGroup[i];
    const segStart = offsets[i];
    const segEnd = segStart + segmentLengths[i];
    // Slice the GROUP's solved profile/edges down to this segment's own span, then shift back
    // to this segment's own local u=0 origin — from here on, every calculation is exactly what
    // the old single-segment version did, just fed a profile that is now actually continuous
    // across the join.
    const toLocal = (p) => ({ u: p.u - segStart, v: p.v });
    const pitchProfile = slicePolylineByU(groupKnots, segStart, segEnd).map(toLocal);
    // groupBottom/groupTop are OFFSETS of groupKnots (see offsetPolylineByNormal) — their own
    // u values are shifted slightly off of groupKnots' own, so which points are genuinely
    // "interior" to this segment's span must be decided from groupKnots (the reference), not
    // from the offset line's own shifted u — see sliceOffsetProfile's own header.
    const bottomPolyline = sliceOffsetProfile(groupBottom, groupKnots, segStart, segEnd).map(toLocal);
    const topPolyline = groupTop ? sliceOffsetProfile(groupTop, groupKnots, segStart, segEnd).map(toLocal) : null;
    const pitchLine = computePitchLineFromKnots(pitchProfile);

    const diagnostics = [];
    let outerContour;
    let cleats;
    let housings;
    if (constructionType === CONSTRUCTION_TYPES.CUT) {
      const top = buildOverlayTop(effective);
      outerContour = [...top, ...bottomPolyline.slice().reverse()];
      // Cleats are an optional support method, not a universal feature of a cut string — see
      // STAIR3D-STRINGER-CLEATS-OPTIONALITY (docs/STRINGER_CONSTRUCTION_SPEC.md §I). When
      // disabled, the tread rests on the notch alone: an empty array, never a hidden assumption.
      cleats = config.stringerCleatsEnabled === false ? [] : buildCleats(effective, config);
      diagnostics.push(...checkCutSupportFailure(effective, bottomPolyline, segment.id));
    } else {
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

    bySegmentId.set(segment.id, {
      segmentId: segment.id,
      constructionType,
      pitchLine,
      // DEBUG DATA (see docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md §14) — the full solved
      // (u,Z) profile and its top/bottom envelope, exposed so a future debug view can show
      // exactly why the contour has its shape without recomputing anything. Not consumed by
      // stringerRenderer.js (it only reads outerContour/cleats/housings), so adding fields here
      // is safe and additive.
      pitchProfile,
      topProfile: topPolyline,
      bottomProfile: bottomPolyline,
      outerContour,
      cleats,
      housings,
      boardWidthMm: boardWidth,
      thicknessMm: segment.thickness,
      minRemainingSectionMm,
      diagnostics,
    });
  });

  return group.map((s) => bySegmentId.get(s.id) ?? emptySegmentGeometry(s));
}

/**
 * @param {import('./stringerModel.js').StringerModel} model  Already built by
 *   stringerSolver.js — never rebuilt or re-derived here.
 * @param {Object} config  Full config (post riserHeight merge) — read for
 *   stringerTopMarginMm/stringerMinRemainingSectionMm/stringerCleatThicknessMm/
 *   stringerCleatHeightMm/treadThickness/hasCornerPost; never mutated.
 * @returns {import('./stringerModel.js').StringerSegmentConstructionGeometry[]}
 */
// At a CORNER_POST joint (see groupSegmentsByLapJoint's header — a real post genuinely
// interrupts the run, so the two sides are deliberately solved independently, never forced
// into one continuous profile) each side's own boundary knot, right next to the post, is
// reached by extrapolating that side's OWN local slope backward/forward past its own real
// bearing data. For a segment whose first few treads are much NARROWER than the rest (the
// classic case: treads right next to the inner "dusza" on a winder are far narrower than
// straight-flight treads), that local slope is far steeper than the segment's overall pitch —
// and extrapolating a steep line, THEN extrapolating its own perpendicular OFFSET again
// (offsetting shifts a steep segment's own u-domain further, requiring an even larger backward
// extrapolation to reach u=0) compounds into a boundary point far below/above where it
// physically belongs — a real, reported symptom: one board's end visibly overshooting past
// where the post-jointed neighbour's own end already sits.
//
// A post can absorb SOME difference between the two sides (that is the whole reason
// CORNER_POST joints don't require exact continuity — see groupSegmentsByLapJoint) but not an
// unbounded one. This clamps each segment's own boundary elevation so it never overshoots PAST
// the immediately preceding segment's own corresponding boundary — a sanity bound, not a
// continuity requirement: the two sides may still legitimately differ (the post covers that),
// they just may not cross past each other.
// Re-checks the self-intersection diagnostic on `geo` after a post-hoc boundary clamp changed
// its outerContour — shared by every clamp below, since moving a boundary point can (rarely)
// fix or introduce a self-intersection. The min-section/support-containment numbers describe
// the tread supports themselves, which no boundary clamp here ever touches, so they are left
// exactly as originally computed.
function recheckSelfIntersection(geo) {
  const wasFlagged = geo.diagnostics.some((d) => d.ruleId === 'STRINGER-CONTOUR-SELF-INTERSECTION');
  const isNowSelfIntersecting = hasSelfIntersection(geo.outerContour);
  if (wasFlagged && !isNowSelfIntersecting) {
    geo.diagnostics = geo.diagnostics.filter((d) => d.ruleId !== 'STRINGER-CONTOUR-SELF-INTERSECTION');
  } else if (!wasFlagged && isNowSelfIntersecting) {
    geo.diagnostics.push(
      createDiagnostic({
        ruleId: 'STRINGER-CONTOUR-SELF-INTERSECTION',
        severity: 'ERROR',
        elementType: 'stringer',
        elementId: geo.segmentId,
        parameter: 'outerContour',
        message: `Kontur wangi (${geo.segmentId}) jest samoprzecinający się — geometria nieprawidłowa.`,
      })
    );
  }
}

function clampCrossSegmentOvershoot(orderedGeometries) {
  for (let i = 1; i < orderedGeometries.length; i++) {
    const prev = orderedGeometries[i - 1];
    const curr = orderedGeometries[i];
    if (!prev.bottomProfile || !curr.bottomProfile) continue;
    let changed = false;

    const prevBottomEnd = prev.bottomProfile[prev.bottomProfile.length - 1];
    const currBottomStart = curr.bottomProfile[0];
    if (currBottomStart.v < prevBottomEnd.v) {
      currBottomStart.v = prevBottomEnd.v; // mutates the shared point object — see outerContour note below
      changed = true;
    }

    if (prev.topProfile && curr.topProfile) {
      const prevTopEnd = prev.topProfile[prev.topProfile.length - 1];
      const currTopStart = curr.topProfile[0];
      if (currTopStart.v > prevTopEnd.v) {
        currTopStart.v = prevTopEnd.v;
        changed = true;
      }
    }

    // outerContour's bottom (and, for closed, top) points are the SAME object references as
    // bottomProfile/topProfile (see buildGroupConstructionGeometry: `bottomPolyline.slice().
    // reverse()` copies the ARRAY, not the points) — mutating the point above already updated
    // outerContour too.
    if (changed) recheckSelfIntersection(curr);
  }
}

// Finds where segment ab (the bottom/top boundary's own first two points) crosses v=0, and
// returns that point — NOT simply projecting the first point vertically up to v=0, which would
// leave its `u` unchanged and can swing the boundary across the OTHER edge's own notch
// pattern (a real, observed self-intersection). Trimming along the line's own true direction is
// what "cut flush with the floor" actually means geometrically.
function trimToFloor(a, b) {
  const t = (0 - a.v) / (b.v - a.v);
  return { u: a.u + (b.u - a.u) * t, v: 0 };
}

// The very FIRST segment of a stringer run (the one starting at the bottom of the flight, no
// preceding segment for clampCrossSegmentOvershoot to compare against) can have its own
// bottom-start boundary land BELOW the actual floor (v < 0): reaching that segment's own u=0
// extrapolates its local pitch slope backward from the first real bearing, then offsets that
// extrapolated point down by the full board width — and near the very bottom of a flight, the
// first tread's own elevation (one riser height) is often smaller than the board's own width,
// so the offset point naturally lands below the floor plane. A real board is physically cut
// off flush with the floor there, never extending through it — v=0 IS a real, meaningful floor
// reference here (bearingElevation is measured the same way: tread index 0 sits at exactly one
// riserHeight above v=0 — see stringerSolver.js). This trims ONLY the very first segment's own
// starting boundary (bottom, and — symmetrically, though not the reported case — top) to where
// it actually crosses v=0; every other, already-elevated segment is far above 0 and unaffected.
function clampFirstSegmentToFloor(orderedGeometries) {
  const first = orderedGeometries[0];
  if (!first || !first.bottomProfile || first.bottomProfile.length < 2) return;
  let changed = false;

  if (first.bottomProfile[0].v < 0) {
    const trimmed = trimToFloor(first.bottomProfile[0], first.bottomProfile[1]);
    const oc = first.outerContour;
    if (oc.length > 0 && oc[oc.length - 1] === first.bottomProfile[0]) oc[oc.length - 1] = trimmed;
    first.bottomProfile[0] = trimmed;
    changed = true;
  }

  if (first.topProfile && first.topProfile.length >= 2 && first.topProfile[0].v < 0) {
    const trimmed = trimToFloor(first.topProfile[0], first.topProfile[1]);
    const oc = first.outerContour;
    if (oc.length > 0 && oc[0] === first.topProfile[0]) oc[0] = trimmed;
    first.topProfile[0] = trimmed;
    changed = true;
  }

  if (changed) recheckSelfIntersection(first);
}

export function buildStringerConstructionGeometry(model, config) {
  const { extendStartOf, extendEndOf } = computeOpenCornerExtensions(model.segments, config.hasCornerPost);
  const extendInfo = new Map(
    model.segments.map((segment, segIdx) => [segment.id, { extendStart: extendStartOf.has(segIdx), extendEnd: extendEndOf.has(segIdx) }])
  );
  const groups = groupSegmentsByLapJoint(model.segments, model.segmentJoints);
  const results = groups.flatMap((group) => buildGroupConstructionGeometry(group, extendInfo, config));
  // Preserve the model's own segment order regardless of grouping.
  const bySegmentId = new Map(results.map((r) => [r.segmentId, r]));
  const ordered = model.segments.map((s) => bySegmentId.get(s.id));
  clampCrossSegmentOvershoot(ordered);
  clampFirstSegmentToFloor(ordered);
  return ordered;
}
