// Generic 2D polyline primitives for a LOCAL PROFILE PLANE (u = distance along a board's own
// axis, v = elevation) — used by stringerConstructionGeometry.js to solve a stringer's lower/
// upper structural contour as a genuine offset of the profile that actually passes through
// every tread bearing, instead of a straight line fit through only the first and last one.
// Pure math, no stair-domain knowledge, no Three.js — reusable wherever a piecewise-linear
// profile in a flat (u,v) plane needs simplifying, offsetting, or measuring.

import { COLLINEAR_EPS } from './tolerances.js';

// Removes points that are collinear (within COLLINEAR_EPS, the same corner-detection
// tolerance pathUtils.js's isCollinear() uses on raw plan coordinates — (u,v) points here are
// on the same order of magnitude) with their neighbors — the whole point being that a UNIFORM
// straight flight's per-bearing knots collapse back down to exactly 2 points (matching the
// pre-refactor "single straight pitch line" shape one-for-one), while a genuinely kinked
// winder profile keeps every real kink.
export function simplifyCollinear(points, eps = COLLINEAR_EPS) {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const result = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = result[result.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
    if (Math.abs(cross) >= eps) result.push({ ...b });
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

// Infinite-line intersection in the (u,v) plane. Returns null for (near-)parallel lines —
// callers fall back to the nearer segment's own endpoint, which is exactly correct when the
// two adjacent offset segments are actually the same line (the common straight-flight case).
function lineLineIntersect(a1, a2, b1, b2) {
  const d1u = a2.u - a1.u;
  const d1v = a2.v - a1.v;
  const d2u = b2.u - b1.u;
  const d2v = b2.v - b1.v;
  const denom = d1u * d2v - d1v * d2u;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.u - a1.u) * d2v - (b1.v - a1.v) * d2u) / denom;
  return { u: a1.u + d1u * t, v: a1.v + d1v * t };
}

// Offsets a piecewise-linear profile by `distance` along its OWN LOCAL NORMAL at every
// segment — the "local normal envelope" method (see docs/architecture/
// STRINGER_ARC_LENGTH_PROFILE.md §5 for why this was chosen over a spline/smooth-curve fit):
// each straight segment of the input is moved perpendicular to ITSELF, and adjacent offset
// segments are joined with a plain miter (their two infinite lines' intersection) — the
// standard, numerically simple way to offset a polyline that never introduces curvature the
// input didn't have. `direction` is 'up' (+normal, used for a closed stringer's top edge) or
// 'down' (-normal, used for every stringer's structural bottom edge). Since a profile's u
// values are always monotonically increasing (arc length along the board never runs
// backwards), the "down" normal is unambiguous regardless of local slope sign.
export function offsetPolylineByNormal(points, distance, direction) {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0] }];
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len = Math.hypot(du, dv) || 1;
    // rotate the segment's unit direction by -90° for "down" (dv,-du)/len, +90° for "up" (-dv,du)/len
    const nu = direction === 'up' ? -dv / len : dv / len;
    const nv = direction === 'up' ? du / len : -du / len;
    segs.push({
      a: { u: a.u + nu * distance, v: a.v + nv * distance },
      b: { u: b.u + nu * distance, v: b.v + nv * distance },
    });
  }
  const result = [segs[0].a];
  for (let i = 0; i < segs.length - 1; i++) {
    const inter = lineLineIntersect(segs[i].a, segs[i].b, segs[i + 1].a, segs[i + 1].b);
    result.push(inter || segs[i].b);
  }
  result.push(segs[segs.length - 1].b);
  return result;
}

// Shortest (perpendicular, clamped to the polyline's own extent) distance from a point to a
// piecewise-linear profile — used to measure a stringer's remaining structural section
// PERPENDICULAR to its local slope, never as a raw vertical (v-only) gap, which is only
// correct for a horizontal profile and understates/overstates the real material thickness
// anywhere the board rakes at an angle (see docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md §7).
export function distancePointToPolyline(point, polyline) {
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len2 = du * du + dv * dv || 1;
    let t = ((point.u - a.u) * du + (point.v - a.v) * dv) / len2;
    t = Math.max(0, Math.min(1, t));
    const fu = a.u + du * t;
    const fv = a.v + dv * t;
    const dist = Math.hypot(point.u - fu, point.v - fv);
    if (dist < min) min = dist;
  }
  return Number.isFinite(min) ? min : 0;
}

// Total length of a (u,v) profile — the TRUE physical length of a raked stringer board, i.e.
// the hypotenuse of its rise-and-run, not just its u (horizontal plan) extent. A stringer that
// climbs steeply is measurably LONGER than the horizontal distance it spans; using u-extent
// alone would understate real board length (and therefore understate material takeoff) on any
// non-trivial pitch.
export function profileLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.hypot(points[i + 1].u - points[i].u, points[i + 1].v - points[i].v);
  }
  return length;
}

// Interpolates (or, past either end, extrapolates along the nearest segment's own slope) the
// profile's v-value at a given u — used to check whether a tread bearing at a known (u,v) sits
// inside a solved [bottom,top] envelope. Assumes `polyline` is u-monotonic (true for every
// profile this module builds — a board's own axis never doubles back on itself).
export function valueAtU(polyline, u) {
  const n = polyline.length;
  if (n === 1) return polyline[0].v;
  for (let i = 0; i < n - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if ((u >= a.u && u <= b.u) || (u <= a.u && u >= b.u)) {
      const t = b.u - a.u !== 0 ? (u - a.u) / (b.u - a.u) : 0;
      return a.v + (b.v - a.v) * t;
    }
  }
  const [a, b] = u < polyline[0].u ? [polyline[0], polyline[1]] : [polyline[n - 2], polyline[n - 1]];
  const t = b.u - a.u !== 0 ? (u - a.u) / (b.u - a.u) : 0;
  return a.v + (b.v - a.v) * t;
}
