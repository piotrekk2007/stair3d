// Editing a tread boundary (edge) in the 2D plan, the way StairDesigner does it: every edge is anchored on the
// walkline — its PIVOT is where its nominal position crosses the walkline — and dragging one end turns the edge about
// that pivot. The dragged end slides along its own stringer line (the stair's inner or outer line), the other end
// follows on the opposite line, so the going measured on the walkline never changes. Pure: plan coordinates (mm), no
// DOM. The result is a plain `config.manualEdgeOverrides` entry {inner, outer} — both ends at once.

import { getBoundaryPoints, getNominalBoundaryPoints, edgeOverrideEndpoints } from '../geometry/edgeOverrides.js';
import { cumulativeDistances, pointAtDistance } from '../geometry/pathUtils.js';

const SLIDE_SNAP_MM = 5; // the dragged end lands on a 5 mm step along its stringer line (same step as the grid snap)

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Where the walkline crosses an edge, as a fraction from its OUTER end (0) to its INNER end (1). */
export function walklineFraction(config) {
  const w = config.stairWidth || 1;
  return Math.min(1, Math.max(0, (w - (config.walklineOffset ?? w / 2)) / w));
}

/** The walkline point of a nominal edge [inner, outer]. */
export function walklinePivot(nominal, config) {
  const [inner, outer] = nominal;
  const t = walklineFraction(config);
  return { x: outer.x + (inner.x - outer.x) * t, y: outer.y + (inner.y - outer.y) * t };
}

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
 * stringer lines, before the housing recess), otherwise (a landing side without a chain) its current ends.
 * @returns {{inner, outer, nominal: [inner, outer]|null, pivot: {x,y}|null, manual: {inner?, outer?}} | null}
 */
export function boundaryEditPoints(treads, boundaryIndex, overrides, config) {
  const { current } = getBoundaryPoints(treads, boundaryIndex);
  if (!current) return null;
  const nominal = getNominalBoundaryPoints(treads, boundaryIndex);
  const manual = edgeOverrideEndpoints(overrides?.[boundaryIndex]);
  const base = nominal || current;
  return {
    inner: manual.inner || base[0],
    outer: manual.outer || base[1],
    nominal,
    pivot: nominal ? walklinePivot(nominal, config) : null,
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
  // Each end stays on the straight piece of its stringer line its nominal end lies on: a tread's outline owns the
  // corners of the line between its two edges, so carrying an end past a corner would leave that corner in the wrong
  // tread and fold both treads (the outline is never re-cut here). An end sitting exactly on a corner stays there.
  const ownCum = cumulativeDistances(own);
  const otherCum = cumulativeDistances(other);
  const otherSide = endpoint === 'inner' ? 'outer' : 'inner';
  const ownPiece = withinNeighbours(pieceAround(ownCum, closestOnPolyline(own, nominalOwn).along), own, neighbours, endpoint);
  const otherPiece = withinNeighbours(pieceAround(otherCum, closestOnPolyline(other, nominalOther).along), other, neighbours, otherSide);
  if (!ownPiece || !otherPiece) return null;

  const hit = closestOnPolyline(own, raw);
  const along = clamp(Math.round(hit.along / SLIDE_SNAP_MM) * SLIDE_SNAP_MM, ownPiece);
  let moved = pointAtDistance(own, ownCum, along);
  if (dist(moved, pivot) < 1) return null;
  let opposite = farSideCrossing(moved, pivot, other, otherCum, nominalOther);
  if (!opposite) return null;
  if (opposite.along < otherPiece.lo || opposite.along > otherPiece.hi) {
    // the opposite end would pass a corner: the edge turns only as far as that corner, and the dragged end goes to
    // where the edge through that corner and the pivot meets its own line
    const stop = pointAtDistance(other, otherCum, clamp(opposite.along, otherPiece));
    const back = farSideCrossing(stop, pivot, own, ownCum, nominalOwn);
    if (!back || back.along < ownPiece.lo - 1e-6 || back.along > ownPiece.hi + 1e-6) return null;
    moved = back.point;
    opposite = { point: stop };
  }
  return endpoint === 'inner' ? { inner: moved, outer: opposite.point } : { inner: opposite.point, outer: moved };
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

// The arc-length range [lo, hi] of the straight piece of a polyline that contains `along`; null when `along` is on an
// interior corner itself. The line's own two ends are not corners (an edge may reach them).
function pieceAround(cum, along) {
  const n = cum.length;
  for (let i = 1; i < n - 1; i++) if (Math.abs(cum[i] - along) < 1e-6) return null;
  let i = 1;
  while (i < n - 1 && cum[i] < along) i++;
  return { lo: i - 1 === 0 ? cum[0] : cum[i - 1] + CORNER_MARGIN_MM, hi: i === n - 1 ? cum[n - 1] : cum[i] - CORNER_MARGIN_MM };
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
