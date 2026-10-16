// Editing a tread boundary (edge) in the 2D plan, the way StairDesigner does it: every edge is anchored on the
// walkline — its PIVOT is its own walkline point (planLayout.walkline.points, the point the winder layout drew the
// edge through — geometry/winderArc.js) — and dragging one end turns the edge about
// that pivot. The dragged end slides along its own stringer line (the stair's inner or outer line), the other end
// follows on the opposite line, so the going measured on the walkline never changes. Pure: plan coordinates (mm), no
// DOM. The result is a plain `config.manualEdgeOverrides` entry {inner, outer} — both ends at once.

import { getBoundaryPoints, getNominalBoundaryPoints, edgeOverrideEndpoints } from '../geometry/edgeOverrides.js';
import { cumulativeDistances, pointAtDistance, segmentsProperlyIntersect, subPathPoints } from '../geometry/pathUtils.js';

const SLIDE_SNAP_MM = 5; // the dragged end lands on a 5 mm step along its stringer line (same step as the grid snap)

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Nearest point of a polyline to p, with its distance along the polyline. */
export function closestOnPolyline(path, p) {
  const cum = cumulativeDistances(path);
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const ab = sub(path[i], a);
    const len2 = dot(ab, ab);
    const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const d = dist(p, q);
    if (!best || d < best.distance) best = { point: q, distance: d, along: cum[i - 1] + Math.sqrt(len2) * t };
  }
  return best;
}

/** Every crossing of the infinite line through a and b with the polyline's segments. */
export function lineCrossings(a, b, path) {
  const d = sub(b, a);
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const e = sub(path[i], p);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9 * Math.hypot(d.x, d.y) * Math.hypot(e.x, e.y)) continue; // parallel
    const ap = sub(p, a);
    const s = (ap.x * d.y - ap.y * d.x) / den; // along the segment
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    out.push({ x: p.x + e.x * s, y: p.y + e.y * s });
  }
  return out;
}

/**
 * The points a boundary is edited by: its manual ends if it has them, otherwise its nominal chain ends (on the
 * stringer lines, before the housing recess), otherwise (a landing side without a chain) its current ends. The pivot
 * is the layout's own walkline point of that boundary (only where the edge has a nominal position to turn).
 * @param {{treads, walkline?: {points: Array<{x,y}|null>}}} planLayout
 * @returns {{inner, outer, nominal: [inner, outer]|null, pivot: {x,y}|null, manual: {inner?, outer?}} | null}
 */
export function boundaryEditPoints(planLayout, boundaryIndex, overrides) {
  const treads = planLayout.treads;
  const { current } = getBoundaryPoints(treads, boundaryIndex);
  if (!current) return null;
  const nominal = getNominalBoundaryPoints(treads, boundaryIndex);
  const manual = edgeOverrideEndpoints(overrides?.[boundaryIndex]);
  const base = nominal || current;
  return {
    inner: manual.inner || base[0],
    outer: manual.outer || base[1],
    nominal,
    pivot: nominal ? planLayout.walkline?.points?.[boundaryIndex] || null : null,
    manual,
  };
}

/**
 * Turns an edge about its walkline pivot so that the dragged end lies on its own stringer line at the pointer.
 * @param {{endpoint:'inner'|'outer', raw:{x,y}, pivot:{x,y}, innerPath:{x,y}[], outerPath:{x,y}[], nominal:[{x,y},{x,y}],
 *   neighbours?: {before?: {inner, outer}|null, after?: {inner, outer}|null}}} args  `neighbours` = the edit points of the
 *   edges before and after this one: an end never passes theirs (two edges would cross).
 * @returns {{inner:{x,y}, outer:{x,y}} | null}  null when the edge can't be turned there (pointer on the pivot, no
 *   crossing with the opposite line on the far side of the pivot) — the caller then leaves the edge as it was.
 */
export function pivotEdgeDrag({ endpoint, raw, pivot, innerPath, outerPath, nominal, neighbours = {} }) {
  const own = endpoint === 'inner' ? innerPath : outerPath;
  const other = endpoint === 'inner' ? outerPath : innerPath;
  if (!pivot || !nominal || !own?.length || !other?.length || own.length < 2 || other.length < 2) return null;
  const nominalOwn = nominal[endpoint === 'inner' ? 0 : 1];
  const nominalOther = nominal[endpoint === 'inner' ? 1 : 0];
  // Each end slides along its WHOLE stringer line, past its corners (the layout re-cuts the two treads' outlines
  // along the line: edgeOverrides.js applyManualEdgeOverrides), only never past the neighbouring edges' ends.
  const ownCum = cumulativeDistances(own);
  const otherCum = cumulativeDistances(other);
  const otherSide = endpoint === 'inner' ? 'outer' : 'inner';
  const whole = (cum) => ({ lo: cum[0], hi: cum[cum.length - 1] });
  const ownPiece = withinNeighbours(whole(ownCum), own, neighbours, endpoint);
  const otherPiece = withinNeighbours(whole(otherCum), other, neighbours, otherSide);
  if (!ownPiece || !otherPiece) return null;

  const hit = closestOnPolyline(own, raw);
  const nominalAlong = closestOnPolyline(own, nominalOwn).along;
  const along = offCorner(ownCum, clamp(Math.round(hit.along / SLIDE_SNAP_MM) * SLIDE_SNAP_MM, ownPiece), hit.along, nominalAlong, ownPiece);
  let moved = pointAtDistance(own, ownCum, along);
  if (dist(moved, pivot) < 1) return null;
  let opposite = farSideCrossing(moved, pivot, other, otherCum, nominalOther);
  if (!opposite) return null;
  const otherAlong = offCorner(otherCum, clamp(opposite.along, otherPiece), opposite.along, closestOnPolyline(other, nominalOther).along, otherPiece);
  if (Math.abs(otherAlong - opposite.along) > 1e-6) {
    // the opposite end would pass a neighbouring edge or sit on a corner of its line: it stops there, and the
    // dragged end goes to where the edge through that point and the pivot meets its own line
    const stop = pointAtDistance(other, otherCum, otherAlong);
    const back = farSideCrossing(stop, pivot, own, ownCum, nominalOwn);
    if (!back || back.along < ownPiece.lo - 1e-6 || back.along > ownPiece.hi + 1e-6) return null;
    moved = back.point;
    opposite = { point: stop };
  }
  const edge = endpoint === 'inner' ? { inner: moved, outer: opposite.point } : { inner: opposite.point, outer: moved };
  // an edge turned so far that it cuts through the piece of a line its two treads are bounded by (across the dusza
  // piece of a 180 degree zone) is not a tread edge
  const stretch = (path, cum, side) => {
    const lo = neighbours.before?.[side] ? closestOnPolyline(path, neighbours.before[side]).along : cum[0];
    const hi = neighbours.after?.[side] ? closestOnPolyline(path, neighbours.after[side]).along : cum[cum.length - 1];
    return lo < hi ? subPathPoints(path, cum, lo, hi) : [];
  };
  const [innerCum, outerCum] = endpoint === 'inner' ? [ownCum, otherCum] : [otherCum, ownCum];
  if (cutsThrough(edge, stretch(innerPath, innerCum, 'inner'), innerPath, outerPath) || cutsThrough(edge, stretch(outerPath, outerCum, 'outer'), outerPath, innerPath)) return null;
  return edge;
}

// Whether the edge crosses a piece of `path` (a stretch of `line`) with the stair on one side only. A piece with the
// opposite line on its other side than the line's first piece runs BACKWARDS inside the stair (the dusza of a 180 degree zone whose wangi
// stand on each other): the stair lies on both its sides and an edge may cross it.
function cutsThrough({ inner, outer }, path, line, opposite) {
  const sideOf = (a, b) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const q = closestOnPolyline(opposite, mid).point;
    return Math.sign((b.x - a.x) * (q.y - mid.y) - (b.y - a.y) * (q.x - mid.x));
  };
  const first = line.findIndex((p, i) => i > 0 && dist(line[i - 1], p) > 1e-6);
  if (first < 1) return false;
  const stairSide = sideOf(line[first - 1], line[first]);
  for (let i = 1; i < path.length; i++) {
    if (dist(path[i - 1], path[i]) < 1e-6) continue;
    if (sideOf(path[i - 1], path[i]) === stairSide && segmentsProperlyIntersect(inner, outer, path[i - 1], path[i])) return true;
  }
  return false;
}

const CORNER_MARGIN_MM = 1; // an end stops this short of a corner of its line (never ON it — a zero-length tread side)
const NEIGHBOUR_MARGIN_MM = 10; // and this short of a neighbouring edge's end (a tread side never shorter than that)

// Narrows a piece's range to between the neighbouring edges' ends on the same line; null when nothing is left.
function withinNeighbours(piece, path, neighbours, side) {
  if (!piece) return null;
  let { lo, hi } = piece;
  if (neighbours.before?.[side]) lo = Math.max(lo, closestOnPolyline(path, neighbours.before[side]).along + NEIGHBOUR_MARGIN_MM);
  if (neighbours.after?.[side]) hi = Math.min(hi, closestOnPolyline(path, neighbours.after[side]).along - NEIGHBOUR_MARGIN_MM);
  return lo <= hi ? { lo, hi } : null;
}

const clamp = (v, { lo, hi }) => Math.min(hi, Math.max(lo, v));

// An end never sits ON an interior corner of its line (the two treads meeting there would each recess it along a
// different piece): within CORNER_MARGIN_MM of one it goes that far to the side the pointer is on (the nominal side
// when it is exactly on it), staying inside `piece`.
function offCorner(cum, along, toward, nominal, piece) {
  for (let i = 1; i < cum.length - 1; i++) {
    if (Math.abs(cum[i] - along) >= CORNER_MARGIN_MM) continue;
    const side = Math.abs(toward - cum[i]) > 1e-6 ? Math.sign(toward - cum[i]) : Math.sign(nominal - cum[i]) || 1;
    const out = clamp(cum[i] + side * CORNER_MARGIN_MM, piece);
    return Math.abs(out - cum[i]) >= CORNER_MARGIN_MM - 1e-6 ? out : clamp(cum[i] - side * CORNER_MARGIN_MM, piece);
  }
  return along;
}

// Where the line from `from` through `pivot` meets `path` beyond the pivot (the nearest such crossing to `near`).
function farSideCrossing(from, pivot, path, cum, near) {
  const away = sub(from, pivot);
  const candidates = lineCrossings(from, pivot, path).filter((c) => dot(sub(c, pivot), away) < 0);
  if (candidates.length === 0) return null;
  const point = candidates.reduce((best, c) => (dist(c, near) < dist(best, near) ? c : best));
  return { point, along: closestOnPolyline(path, point).along };
}

/** A free move of one end (Alt held, or an edge without a pivot): the other end keeps its own manual edit, if any. */
export function freeEdgeDrag(endpoint, point, manual) {
  const out = {};
  if (manual?.inner) out.inner = manual.inner;
  if (manual?.outer) out.outer = manual.outer;
  out[endpoint] = point;
  return out;
}
