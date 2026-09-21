// PROFILE CURVE — piecewise line/arc curves in a stringer's unfolded elevation plane
// (u = distance along the stringer's plan path, v = world elevation).
//
// This is the primitive layer of the StringerProfileModel (see
// docs/architecture/STRINGER_PROFILE_MODEL.md). A curve is a CONTINUOUS CHAIN of primitives:
//
//   { type: 'line', a, b }
//   { type: 'arc',  a, b, center, radius, startAngle, sweep }   sweep is signed (+ = CCW)
//
// Arcs stay arcs — they are only turned into short chords by curveToPolyline(), which is
// called by adapters (renderer, exporter) and never by the solver itself. Pure math, no
// stair-domain knowledge, no Three.js.
//
// Every curve handled here is u-MONOTONIC: a board's own axis never doubles back, and a
// tangent-arc fillet between two u-increasing edges turns by less than 180 degrees, so it
// stays u-increasing too. sliceCurveByU() relies on that.

import { GEOMETRY_EPS, COLLINEAR_EPS } from './tolerances.js';

const TWO_PI = Math.PI * 2;
const ANGLE_EPS = 1e-9;

// A direction change smaller than this is not a corner — it stays a straight line rather than
// becoming a near-zero-sweep arc (the "introduce curvature only when required" rule). Same
// spirit as tolerances.js's COLLINEAR_EPS, expressed as an angle because a fillet is angular.
export const FILLET_MIN_TURN_RAD = (0.5 * Math.PI) / 180;

// Maximum distance between an arc and the chords that stand in for it when a curve is
// discretized for a mesh or an export — deliberately far below any woodworking tolerance.
export const DEFAULT_CHORD_TOLERANCE_MM = 0.1;

const BISECTION_ITERATIONS = 60;

// --- construction ----------------------------------------------------------------------------

function pt(p) {
  return { u: p.u, v: p.v };
}

function dist(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

export function lineSegment(a, b) {
  return { type: 'line', a: pt(a), b: pt(b) };
}

export function polylineToCurve(points) {
  const curve = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (dist(points[i], points[i + 1]) > GEOMETRY_EPS) curve.push(lineSegment(points[i], points[i + 1]));
  }
  return curve;
}

function arcPoint(center, radius, angle) {
  return { u: center.u + radius * Math.cos(angle), v: center.v + radius * Math.sin(angle) };
}

export function makeArc(center, radius, startAngle, sweep) {
  return {
    type: 'arc',
    center: pt(center),
    radius,
    startAngle,
    sweep,
    a: arcPoint(center, radius, startAngle),
    b: arcPoint(center, radius, startAngle + sweep),
  };
}

export function curveStart(curve) {
  return curve.length > 0 ? curve[0].a : null;
}

export function curveEnd(curve) {
  return curve.length > 0 ? curve[curve.length - 1].b : null;
}

function primPointAt(prim, t) {
  if (prim.type === 'line') return { u: prim.a.u + (prim.b.u - prim.a.u) * t, v: prim.a.v + (prim.b.v - prim.a.v) * t };
  return arcPoint(prim.center, prim.radius, prim.startAngle + prim.sweep * t);
}

// Unit tangent of a primitive at its start (atStart = true) or end, in the direction of travel.
function primTangent(prim, atStart) {
  if (prim.type === 'line') {
    const len = dist(prim.a, prim.b) || 1;
    return { u: (prim.b.u - prim.a.u) / len, v: (prim.b.v - prim.a.v) / len };
  }
  const angle = prim.startAngle + (atStart ? 0 : prim.sweep);
  const dir = prim.sweep >= 0 ? 1 : -1;
  return { u: -Math.sin(angle) * dir, v: Math.cos(angle) * dir };
}

export function curveLength(curve) {
  let total = 0;
  for (const prim of curve) total += prim.type === 'line' ? dist(prim.a, prim.b) : Math.abs(prim.sweep) * prim.radius;
  return total;
}

// --- fillet ------------------------------------------------------------------------------------

/**
 * The tangent arc of `radius` that rounds the corner at `p` between the edges prev→p and p→next.
 * Returns null when there is no corner to round (straight, degenerate, or radius <= 0).
 * `tangentLength` is how far back along each edge the arc starts/ends.
 */
export function filletArcAt(prev, p, next, radius) {
  if (!(radius > 0)) return null;
  const l1 = dist(prev, p);
  const l2 = dist(p, next);
  if (l1 < GEOMETRY_EPS || l2 < GEOMETRY_EPS) return null;
  const d1 = { u: (p.u - prev.u) / l1, v: (p.v - prev.v) / l1 };
  const d2 = { u: (next.u - p.u) / l2, v: (next.v - p.v) / l2 };
  const cross = d1.u * d2.v - d1.v * d2.u;
  const dot = d1.u * d2.u + d1.v * d2.v;
  const turn = Math.atan2(Math.abs(cross), dot);
  if (turn < FILLET_MIN_TURN_RAD) return null;
  const tangentLength = radius * Math.tan(turn / 2);
  const sign = cross > 0 ? 1 : -1;
  const a = { u: p.u - d1.u * tangentLength, v: p.v - d1.v * tangentLength };
  // The centre lies on the inside of the turn: left of d1 for a left turn, right for a right turn.
  const center = { u: a.u + -d1.v * sign * radius, v: a.v + d1.u * sign * radius };
  const arc = makeArc(center, radius, Math.atan2(a.v - center.v, a.u - center.u), sign * turn);
  arc.tangentLength = tangentLength;
  arc.turn = turn;
  arc.turnSign = sign;
  return arc;
}

/**
 * Turn direction at an interior vertex: +1 left turn (CCW), -1 right turn, 0 straight/degenerate.
 */
export function turnSignAt(prev, p, next) {
  const l1 = dist(prev, p);
  const l2 = dist(p, next);
  if (l1 < GEOMETRY_EPS || l2 < GEOMETRY_EPS) return 0;
  const cross = ((p.u - prev.u) * (next.v - p.v) - (p.v - prev.v) * (next.u - p.u)) / (l1 * l2);
  const dot = ((p.u - prev.u) * (next.u - p.u) + (p.v - prev.v) * (next.v - p.v)) / (l1 * l2);
  return Math.atan2(Math.abs(cross), dot) < FILLET_MIN_TURN_RAD ? 0 : Math.sign(cross);
}

/**
 * Largest radii (<= the requested ones) whose tangent lengths fit on the edges: two fillets
 * that share an edge must not consume more than its length together. Deterministic, one pass,
 * no iteration: each vertex takes the tightest scale of its two adjacent edges.
 *
 * `radii[i]` is the requested radius at points[i]; the first/last point are never rounded.
 */
export function feasibleRadii(points, radii) {
  const n = points.length;
  const tangent = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const r = radii[i] || 0;
    if (r > 0) {
      const arc = filletArcAt(points[i - 1], points[i], points[i + 1], r);
      tangent[i] = arc ? arc.tangentLength : 0;
    }
  }
  const scale = new Array(n).fill(1);
  for (let k = 0; k < n - 1; k++) {
    const len = dist(points[k], points[k + 1]);
    const sum = tangent[k] + tangent[k + 1];
    if (sum > len && sum > 0) {
      const s = len / sum;
      scale[k] = Math.min(scale[k], s);
      scale[k + 1] = Math.min(scale[k + 1], s);
    }
  }
  return radii.map((r, i) => (i > 0 && i < n - 1 && tangent[i] > 0 ? r * scale[i] : 0));
}

/**
 * Rounds the interior vertices of a polyline with tangent arcs. Radii are made feasible first
 * (see feasibleRadii). Returns the curve and, per vertex that was actually rounded, the applied
 * radius. A vertex with radius 0 (or a turn below FILLET_MIN_TURN_RAD) stays a sharp corner.
 */
export function filletPolyline(points, radii) {
  const n = points.length;
  const applied = feasibleRadii(points, radii);
  const curve = [];
  let cursor = points[0];
  const fillets = [];
  for (let i = 1; i < n - 1; i++) {
    const arc = applied[i] > 0 ? filletArcAt(points[i - 1], points[i], points[i + 1], applied[i]) : null;
    if (arc) {
      if (dist(cursor, arc.a) > GEOMETRY_EPS) curve.push(lineSegment(cursor, arc.a));
      curve.push(arc);
      cursor = arc.b;
      fillets.push({ index: i, radius: applied[i] });
    } else {
      if (dist(cursor, points[i]) > GEOMETRY_EPS) curve.push(lineSegment(cursor, points[i]));
      cursor = points[i];
    }
  }
  if (dist(cursor, points[n - 1]) > GEOMETRY_EPS) curve.push(lineSegment(cursor, points[n - 1]));
  return { curve, fillets };
}

// --- discretization ----------------------------------------------------------------------------

/**
 * Chords standing in for a curve, no chord deviating more than `chordTol` from any arc. Lines
 * contribute only their end points, so a line-only curve comes back as exactly its vertices.
 */
export function curveToPolyline(curve, chordTol = DEFAULT_CHORD_TOLERANCE_MM) {
  if (curve.length === 0) return [];
  const points = [pt(curve[0].a)];
  for (const prim of curve) {
    if (prim.type === 'arc') {
      const maxStep = prim.radius > chordTol ? 2 * Math.acos(1 - chordTol / prim.radius) : Math.PI / 2;
      const segments = Math.max(1, Math.ceil(Math.abs(prim.sweep) / maxStep));
      for (let k = 1; k < segments; k++) points.push(primPointAt(prim, k / segments));
    }
    points.push(pt(prim.b));
  }
  return points;
}

// --- slicing -----------------------------------------------------------------------------------

function primUAt(prim, t) {
  return primPointAt(prim, t).u;
}

// The parameter t in [0,1] at which a u-increasing primitive reaches `u`.
function paramAtU(prim, u) {
  if (prim.type === 'line') {
    const du = prim.b.u - prim.a.u;
    return du !== 0 ? (u - prim.a.u) / du : 0;
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (primUAt(prim, mid) < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function subPrimitive(prim, t0, t1, aOverride, bOverride) {
  if (prim.type === 'line') {
    return lineSegment(aOverride || primPointAt(prim, t0), bOverride || primPointAt(prim, t1));
  }
  const arc = makeArc(prim.center, prim.radius, prim.startAngle + prim.sweep * t0, prim.sweep * (t1 - t0));
  if (aOverride) arc.a = pt(aOverride);
  if (bOverride) arc.b = pt(bOverride);
  return arc;
}

/**
 * The part of a u-monotonic curve between u0 and u1. If the requested span extends past the
 * curve's own ends, the first/last primitive's tangent is continued in a straight line — the
 * same "extrapolate along the nearest slope" rule polylineProfile.js's valueAtU uses, so a
 * board that reaches slightly past its outermost tread still has a defined edge there.
 */
export function sliceCurveByU(curve, u0, u1) {
  if (curve.length === 0 || !(u1 > u0)) return [];
  let extended = curve;
  const first = curve[0];
  const last = curve[curve.length - 1];
  const prefix = [];
  const suffix = [];
  if (first.a.u > u0) {
    const t = primTangent(first, true);
    if (t.u > ANGLE_EPS) prefix.push(lineSegment({ u: u0, v: first.a.v - (t.v / t.u) * (first.a.u - u0) }, first.a));
  }
  if (last.b.u < u1) {
    const t = primTangent(last, false);
    if (t.u > ANGLE_EPS) suffix.push(lineSegment(last.b, { u: u1, v: last.b.v + (t.v / t.u) * (u1 - last.b.u) }));
  }
  if (prefix.length || suffix.length) extended = [...prefix, ...curve, ...suffix];

  const result = [];
  for (const prim of extended) {
    const ua = prim.a.u;
    const ub = prim.b.u;
    if (ub <= u0 + GEOMETRY_EPS || ua >= u1 - GEOMETRY_EPS) continue;
    const t0 = ua < u0 ? paramAtU(prim, u0) : 0;
    const t1 = ub > u1 ? paramAtU(prim, u1) : 1;
    const aOverride = ua < u0 ? { ...primPointAt(prim, t0), u: u0 } : null;
    const bOverride = ub > u1 ? { ...primPointAt(prim, t1), u: u1 } : null;
    const sub = subPrimitive(prim, t0, t1, aOverride, bOverride);
    if (dist(sub.a, sub.b) > GEOMETRY_EPS || sub.type === 'arc') result.push(sub);
  }
  return result;
}

/**
 * Merges consecutive collinear LINE primitives into one. Cutting a curve at an arbitrary u can
 * leave a vertex that is not a real corner (the curve's own first control point, kept as an
 * "interior" point of a slice that starts before it); a straight run must stay ONE line —
 * the same rule simplifyCollinear applies to polylines, with the same tolerance. Arcs are never
 * touched.
 */
export function mergeCollinearLines(curve, eps = COLLINEAR_EPS) {
  const out = [];
  for (const prim of curve) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'line' && prim.type === 'line') {
      const cross = (prev.b.u - prev.a.u) * (prim.b.v - prev.a.v) - (prev.b.v - prev.a.v) * (prim.b.u - prev.a.u);
      if (Math.abs(cross) < eps) {
        out[out.length - 1] = lineSegment(prev.a, prim.b);
        continue;
      }
    }
    out.push(prim);
  }
  return out;
}

/** A copy of the curve moved by `du` along u (used to express a slice in a segment's own frame). */
export function translateCurveU(curve, du) {
  return curve.map((prim) => {
    const moved = { ...prim, a: { u: prim.a.u + du, v: prim.a.v }, b: { u: prim.b.u + du, v: prim.b.v } };
    if (prim.type === 'arc') moved.center = { u: prim.center.u + du, v: prim.center.v };
    return moved;
  });
}

// --- analytic distance -------------------------------------------------------------------------

function angleInArc(arc, angle) {
  const dir = arc.sweep >= 0 ? 1 : -1;
  let d = ((angle - arc.startAngle) * dir) % TWO_PI;
  if (d < 0) d += TWO_PI;
  return d <= Math.abs(arc.sweep) + ANGLE_EPS;
}

function pointToLine(p, line) {
  const du = line.b.u - line.a.u;
  const dv = line.b.v - line.a.v;
  const len2 = du * du + dv * dv;
  let t = len2 > 0 ? ((p.u - line.a.u) * du + (p.v - line.a.v) * dv) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.u - (line.a.u + du * t), p.v - (line.a.v + dv * t));
}

function pointToArc(p, arc) {
  const d = dist(p, arc.center);
  if (d < GEOMETRY_EPS) return arc.radius;
  if (angleInArc(arc, Math.atan2(p.v - arc.center.v, p.u - arc.center.u))) return Math.abs(d - arc.radius);
  return Math.min(dist(p, arc.a), dist(p, arc.b));
}

function pointToPrim(p, prim) {
  return prim.type === 'line' ? pointToLine(p, prim) : pointToArc(p, prim);
}

function linesCross(l1, l2) {
  const orient = (p, q, r) => (q.u - p.u) * (r.v - p.v) - (q.v - p.v) * (r.u - p.u);
  const o1 = orient(l1.a, l1.b, l2.a);
  const o2 = orient(l1.a, l1.b, l2.b);
  const o3 = orient(l2.a, l2.b, l1.a);
  const o4 = orient(l2.a, l2.b, l1.b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function lineArcCross(line, arc) {
  const du = line.b.u - line.a.u;
  const dv = line.b.v - line.a.v;
  const fu = line.a.u - arc.center.u;
  const fv = line.a.v - arc.center.v;
  const A = du * du + dv * dv;
  const B = 2 * (fu * du + fv * dv);
  const C = fu * fu + fv * fv - arc.radius * arc.radius;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return false;
  const root = Math.sqrt(disc);
  for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t < 0 || t > 1) continue;
    const q = { u: line.a.u + du * t, v: line.a.v + dv * t };
    if (angleInArc(arc, Math.atan2(q.v - arc.center.v, q.u - arc.center.u))) return true;
  }
  return false;
}

function arcsCross(a1, a2) {
  const d = dist(a1.center, a2.center);
  if (d < GEOMETRY_EPS || d > a1.radius + a2.radius || d < Math.abs(a1.radius - a2.radius)) return false;
  const along = (a1.radius * a1.radius - a2.radius * a2.radius + d * d) / (2 * d);
  const h2 = a1.radius * a1.radius - along * along;
  if (h2 < 0) return false;
  const h = Math.sqrt(h2);
  const eu = (a2.center.u - a1.center.u) / d;
  const ev = (a2.center.v - a1.center.v) / d;
  const mid = { u: a1.center.u + eu * along, v: a1.center.v + ev * along };
  for (const s of [1, -1]) {
    const q = { u: mid.u - ev * h * s, v: mid.v + eu * h * s };
    if (angleInArc(a1, Math.atan2(q.v - a1.center.v, q.u - a1.center.u)) && angleInArc(a2, Math.atan2(q.v - a2.center.v, q.u - a2.center.u))) return true;
  }
  return false;
}

// Exact minimum distance between two primitives. Every candidate below is a REAL pair of points
// (one on each primitive), so the smallest one can never under-estimate; the candidate set
// contains the true minimiser (an end point of one primitive, or a point where the two
// primitives' common normal passes through an arc centre), so it never over-estimates either.
function primDistance(p, q) {
  if (p.type === 'line' && q.type === 'line') {
    if (linesCross(p, q)) return 0;
    return Math.min(pointToLine(p.a, q), pointToLine(p.b, q), pointToLine(q.a, p), pointToLine(q.b, p));
  }
  if (p.type === 'arc' && q.type === 'line') return primDistance(q, p);
  if (p.type === 'line' && q.type === 'arc') {
    if (lineArcCross(p, q)) return 0;
    let min = Math.min(pointToArc(p.a, q), pointToArc(p.b, q), pointToLine(q.a, p), pointToLine(q.b, p));
    const len = dist(p.a, p.b) || 1;
    const nu = -(p.b.v - p.a.v) / len;
    const nv = (p.b.u - p.a.u) / len;
    for (const s of [1, -1]) {
      const c = { u: q.center.u + nu * q.radius * s, v: q.center.v + nv * q.radius * s };
      if (angleInArc(q, Math.atan2(c.v - q.center.v, c.u - q.center.u))) min = Math.min(min, pointToLine(c, p));
    }
    return min;
  }
  // arc - arc
  if (arcsCross(p, q)) return 0;
  let min = Math.min(pointToArc(p.a, q), pointToArc(p.b, q), pointToArc(q.a, p), pointToArc(q.b, p));
  const d = dist(p.center, q.center);
  if (d > GEOMETRY_EPS) {
    const eu = (q.center.u - p.center.u) / d;
    const ev = (q.center.v - p.center.v) / d;
    for (const [from, to, dirSign] of [[p, q, 1], [q, p, -1]]) {
      for (const s of [1, -1]) {
        const c = { u: from.center.u + eu * dirSign * from.radius * s, v: from.center.v + ev * dirSign * from.radius * s };
        if (angleInArc(from, Math.atan2(c.v - from.center.v, c.u - from.center.u))) min = Math.min(min, pointToArc(c, to));
      }
    }
  }
  return min;
}

/**
 * Exact minimum distance between two curves (0 if they touch or cross). O(n*m) primitive pairs;
 * both curves are a handful to a few dozen primitives.
 */
export function curveDistance(curveA, curveB) {
  let min = Infinity;
  for (const p of curveA) {
    for (const q of curveB) {
      const d = primDistance(p, q);
      if (d < min) min = d;
      if (min === 0) return 0;
    }
  }
  return min;
}

/** Distance from a single point to a curve (exact). */
export function pointToCurveDistance(point, curve) {
  let min = Infinity;
  for (const prim of curve) min = Math.min(min, pointToPrim(point, prim));
  return min;
}
