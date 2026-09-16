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
// --- The method: the pitch line -------------------------------------------------------------
//
// Every StringerTreadBearing's `bearingElevation` is an EXACT affine function of tread index
// (`(index+1)*riserHeight - treadThickness` — see stringerSolver.js; never touched by manual
// edits, which only move `finalUStart`/`finalUEnd`). For a straight flight this means the
// (u, elevation) points of every bearing in one segment are already collinear. The "pitch
// line" here is struck through the FIRST and LAST bearing's own corner points — the same
// two-point method a joiner uses to strike a chalk line for a stringer layout (an established
// general construction principle, not a number invented for this codebase — see
// docs/architecture/STRINGER_CONSTRUCTION_MODEL.md). For a winder segment (going varies
// tread-to-tread) intermediate bearings may deviate slightly from this line; `minRemainingSectionMm`
// below is exactly the diagnostic that catches when that deviation threatens the board.
//
// --- Two construction types, two different contours ------------------------------------------
//
//   CUT (overlay/open-cleated, "wanga nakładana"): the TOP edge steps to match each tread's own
//   bearing region (the classic notched/sawtooth top of an open string — a REAL, correct
//   feature of this construction type, not a defect); the BOTTOM edge is the single straight
//   pitch-line-parallel line. A separate `cleats[]` array — small support blocks under each
//   tread's seat — is reported alongside, never merged into the board's own outer contour (see
//   requirement: "represent separately: structural board vs tread support/cleat geometry").
//
//   CLOSED (housed/recessed, "wanga wpuszczana"): the outer contour is a PLAIN PARALLELOGRAM —
//   both edges straight, parallel to the pitch line, the top offset above it by
//   `config.stringerTopMarginMm`. Tread locations are `housings[]` — recesses cut into the
//   board's INNER FACE, which never change the outer silhouette.
//
// stringerRenderer.js consumes this file's output and NEVER computes geometry itself; this
// file never touches Three.js.

import { pointsEqual, segmentsProperlyIntersect } from './pathUtils.js';
import { CONSTRUCTION_TYPES, housingDepthFor } from './stringerModel.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

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

function computePitchLine(effective) {
  const first = effective[0];
  const last = effective[effective.length - 1];
  const start = { u: first.uStart, v: first.bearingElevation };
  const end = { u: last.uEnd, v: last.bearingElevation };
  const du = end.u - start.u;
  const slope = du !== 0 ? (end.v - start.v) / du : 0;
  return { start, end, slope };
}

function pitchValueAt(pitchLine, u) {
  return pitchLine.start.v + pitchLine.slope * (u - pitchLine.start.u);
}

// --- CUT (overlay/open-cleated) --------------------------------------------------------------

function buildOverlayContour(effective, pitchLine, boardWidth) {
  const top = [];
  for (const b of effective) {
    top.push({ u: b.uStart, v: b.bearingElevation });
    top.push({ u: b.uEnd, v: b.bearingElevation });
  }
  const uStart = effective[0].uStart;
  const uEnd = effective[effective.length - 1].uEnd;
  const bottomEnd = { u: uEnd, v: pitchValueAt(pitchLine, uEnd) - boardWidth };
  const bottomStart = { u: uStart, v: pitchValueAt(pitchLine, uStart) - boardWidth };
  return [...top, bottomEnd, bottomStart];
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

function buildHousedContour(effective, pitchLine, boardWidth, topMarginMm) {
  const uStart = effective[0].uStart;
  const uEnd = effective[effective.length - 1].uEnd;
  const topAtStart = pitchValueAt(pitchLine, uStart) + topMarginMm;
  const topAtEnd = pitchValueAt(pitchLine, uEnd) + topMarginMm;
  return [
    { u: uStart, v: topAtStart },
    { u: uEnd, v: topAtEnd },
    { u: uEnd, v: topAtEnd - boardWidth },
    { u: uStart, v: topAtStart - boardWidth },
  ];
}

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

function computeMinRemainingSection(effective, pitchLine, boardWidth, constructionType, config) {
  if (constructionType === CONSTRUCTION_TYPES.CLOSED) {
    // Failure mode here is THROUGH the board's thickness (housing routed into the face), not
    // along its width — a direct, geometry-independent calculation.
    return config.stringerThickness - housingDepthFor(config.stringerThickness);
  }
  // CUT: failure mode is a notch coming too close to the single straight bottom edge — check
  // every bearing's own two corners against the bottom edge directly below them.
  let min = Infinity;
  for (const b of effective) {
    for (const u of [b.uStart, b.uEnd]) {
      const bottomV = pitchValueAt(pitchLine, u) - boardWidth;
      const gap = b.bearingElevation - bottomV;
      if (gap < min) min = gap;
    }
  }
  return Number.isFinite(min) ? min : boardWidth;
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
      outerContour: [],
      boardWidthMm: segment.width,
      thicknessMm: segment.thickness,
      minRemainingSectionMm: null,
      diagnostics,
    };
  }

  const effective = effectiveBearings(segment, extendStart, extendEnd);
  const pitchLine = computePitchLine(effective);
  const constructionType = segment.constructionType;
  const boardWidth = segment.width;

  let outerContour;
  let cleats;
  let housings;
  if (constructionType === CONSTRUCTION_TYPES.CUT) {
    outerContour = buildOverlayContour(effective, pitchLine, boardWidth);
    // Cleats are an optional support method, not a universal feature of a cut string — see
    // STAIR3D-STRINGER-CLEATS-OPTIONALITY (docs/STRINGER_CONSTRUCTION_SPEC.md §I). When
    // disabled, the tread rests on the notch alone: an empty array, never a hidden assumption.
    cleats = config.stringerCleatsEnabled === false ? [] : buildCleats(effective, config);
  } else {
    outerContour = buildHousedContour(effective, pitchLine, boardWidth, config.stringerTopMarginMm ?? 0);
    housings = buildHousings(effective, config);
  }

  const minRemainingSectionMm = computeMinRemainingSection(effective, pitchLine, boardWidth, constructionType, config);
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
