// WalklineModel — the "linia biegu" (line of travel) as a first-class geometric object,
// independent of Three.js. Until now `walklineOffset`/`walklineSplitOffset` only existed as
// two numbers consumed deep inside planLayout.js's winder construction (buildTurnLocal) —
// there was no queryable object representing the walkline itself. This file builds one FROM
// the already-solved planLayout (never re-derives geometry independently of it), so winder
// width evaluation (see docs' PL-LEGAL-C-01) is computed from the walkline, not from
// arbitrary global coordinates.
//
// A walkline point for a tread is the point at `offsetMm` from that tread's INNER (dusza)
// boundary, linearly interpolated between the inner and outer points of its frontEdge/
// backEdge — i.e. "offsetMm across the tread's own local width", which is exactly what
// walklineOffset already means in planLayout.js/buildTurnLocal.

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function fractionAcrossWidth(edge, offsetMm) {
  const [inner, outer] = edge;
  const width = Math.hypot(outer.x - inner.x, outer.y - inner.y) || 1;
  return Math.min(1, Math.max(0, offsetMm / width));
}

/**
 * @typedef {Object} WalklinePoint
 * @property {string} stepId
 * @property {{x:number,y:number}} front  Walkline point on this tread's frontEdge
 * @property {{x:number,y:number}} back   Walkline point on this tread's backEdge
 */

/**
 * @typedef {Object} WalklineModel
 * @property {number} offset            mm from the inner (dusza) boundary — config.walklineOffset
 * @property {{x:number,y:number}|null} origin  The walkline point at the very start of the flight
 * @property {{x:number,y:number}} direction    Unit vector, origin -> next walkline point (null-safe)
 * @property {WalklinePoint[]} points   One entry per tread, in flight order
 */

/**
 * @param {import('./planLayout.js').PlanLayout} planLayout
 * @param {Object} config
 * @returns {WalklineModel}
 */
export function buildWalklineModel(planLayout, config) {
  const offset = config.walklineOffset;
  const points = planLayout.treads.map((tread) => walklinePointFor(tread, offset));

  const origin = points.length > 0 ? points[0].front : null;
  const next = points.length > 0 ? points[0].back : null;
  const direction =
    origin && next && !(origin.x === next.x && origin.y === next.y)
      ? normalize({ x: next.x - origin.x, y: next.y - origin.y })
      : { x: 0, y: 1 };

  return { offset, origin, direction, points };
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function walklinePointFor(tread, offsetMm) {
  const tFront = fractionAcrossWidth(tread.frontEdge, offsetMm);
  const tBack = fractionAcrossWidth(tread.backEdge, offsetMm);
  return {
    stepId: `step-${tread.index}`,
    front: lerp(tread.frontEdge[0], tread.frontEdge[1], tFront),
    back: lerp(tread.backEdge[0], tread.backEdge[1], tBack),
  };
}

// The tread's "going" (front-to-back depth) measured on a line parallel to its inner edge, at
// a FIXED distance from that inner edge — independent of config.walklineOffset, because a
// legal minimum (e.g. "measured 0.4m from the dusza") is a fixed measurement point regardless
// of where this project's own configured walkline happens to sit. Used by winder-width
// validation (see src/validation/facts.js).
export function treadGoingAtOffsetFromInner(tread, offsetMm) {
  const p = walklinePointFor(tread, offsetMm);
  return Math.hypot(p.back.x - p.front.x, p.back.y - p.front.y);
}
