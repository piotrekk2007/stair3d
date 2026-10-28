// WalklineModel — the "linia biegu" (line of travel) as a first-class geometric object,
// independent of Three.js. Until now `walklineOffset`/`walklineSplitOffset` only existed as
// two numbers consumed deep inside planLayout.js's winder construction (buildTurnLocal) —
// there was no queryable object representing the walkline itself. This file builds one FROM
// the already-solved planLayout (never re-derives geometry independently of it), so winder
// width evaluation (see docs' PL-LEGAL-C-01) is computed from the walkline, not from
// arbitrary global coordinates.
//
// A walkline point for a tread edge is where that edge crosses the line `offsetMm` from the stair's INNER line
// (planLayout.innerFullPath, the dusza): straight pieces parallel to it and an ARC of radius `offsetMm` round every
// inner corner the stair wraps around (offsetLineFromInner). That is "measured offsetMm from the dusza" as the
// regulation (PL-LEGAL-C-01, § 69) puts it, and with offsetMm = walklineOffset exactly the walkline the winders were
// laid out on (geometry/winderArc.js). The old rule — a point offsetMm ALONG the edge from its inner end — is kept
// only as the fallback where an edge does not reach the line (it measured slanted winder edges too close to the
// dusza: 233 mm instead of the 270 mm going on the walkline).

import { inwardNormal } from './planLayout.js';
import { normalizeVector as normalize } from './pathUtils.js';

const ARC_SAMPLE_DEG = 3;

/** The line `offsetMm` from the inner line, into the stair: offset straights joined by arcs round convex corners. */
export function offsetLineFromInner(planLayout, offsetMm) {
  const half = (planLayout.turns || []).find((t) => t.halfTurn);
  if (half && offsetMm > 0) return offsetLineRoundHalfTurn(planLayout, offsetMm, half);
  return offsetLineAlong(planLayout, offsetMm);
}

// A 180° winder zone (planLayout.js buildHalfTurnLocal): the dusza between flights A and C is a short piece of inner
// line — possibly running BACK when C's wanga stands over A's — so the line `offsetMm` from it is A's offset straight,
// a HALF CIRCLE round the dusza's middle (radius offsetMm + half the gap between the inner lines, exactly how the
// walkline itself is laid out at offsetMm = walklineOffset) and C's offset straight.
function offsetLineRoundHalfTurn(planLayout, offsetMm, turn) {
  const path = (planLayout.innerFullPath || []).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9);
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  const [c1, c2] = turn.innerCorners;
  const i1 = path.findIndex((p) => near(p, c1));
  const i2 = path.findIndex((p, i) => i >= i1 && near(p, c2));
  if (i1 < 1 || i2 < 0 || i2 >= path.length - 1) return offsetLineAlong(planLayout, offsetMm);
  const handedness = planLayout.handedness;
  const lineA = offsetLineAlong({ innerFullPath: path.slice(0, i1 + 1), handedness }, offsetMm);
  const lineC = offsetLineAlong({ innerFullPath: path.slice(i2), handedness }, offsetMm);
  const ctr = turn.centre;
  const from = lineA[lineA.length - 1];
  const to = lineC[0];
  const radius = Math.hypot(from.x - ctr.x, from.y - ctr.y);
  const a0 = Math.atan2(from.y - ctr.y, from.x - ctr.x);
  let sweep = Math.atan2(to.y - ctr.y, to.x - ctr.x) - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  // round the far side of the dusza: the arc's middle lies ahead in A's walking direction
  const ahead = normalize({ x: c1.x - path[i1 - 1].x, y: c1.y - path[i1 - 1].y });
  const midOf = (sw) => ({ x: Math.cos(a0 + sw / 2), y: Math.sin(a0 + sw / 2) });
  if (midOf(sweep).x * ahead.x + midOf(sweep).y * ahead.y < midOf(sweep - 2 * Math.PI).x * ahead.x + midOf(sweep - 2 * Math.PI).y * ahead.y) sweep -= 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ((ARC_SAMPLE_DEG * Math.PI) / 180)));
  const arc = [];
  for (let k = 1; k < steps; k++) {
    const ang = a0 + (sweep * k) / steps;
    arc.push({ x: ctr.x + Math.cos(ang) * radius, y: ctr.y + Math.sin(ang) * radius });
  }
  return [...lineA, ...arc, ...lineC];
}

function offsetLineAlong(planLayout, offsetMm, side = 'inner') {
  const path = ((side === 'outer' ? planLayout.outerFullPath : planLayout.innerFullPath) || []).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9);
  if (path.length < 2 || !(offsetMm > 0)) return [];
  const handed = planLayout.handedness || 1;
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const d = normalize({ x: path[i].x - path[i - 1].x, y: path[i].y - path[i - 1].y });
    const n = inwardNormal(d, side, handed);
    segs.push({ a: path[i - 1], b: path[i], d, n });
  }
  const at = (p, n) => ({ x: p.x + n.x * offsetMm, y: p.y + n.y * offsetMm });
  const out = [at(segs[0].a, segs[0].n)];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (!next) {
      out.push(at(s.b, s.n));
      break;
    }
    if (next.d.x * s.n.x + next.d.y * s.n.y < 0) {
      // the line turns away from the stair: the offsets part — an arc round the corner
      const a0 = Math.atan2(s.n.y, s.n.x);
      let sweep = Math.atan2(next.n.y, next.n.x) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((ARC_SAMPLE_DEG * Math.PI) / 180)));
      for (let k = 0; k <= steps; k++) {
        const ang = a0 + (sweep * k) / steps;
        out.push({ x: s.b.x + Math.cos(ang) * offsetMm, y: s.b.y + Math.sin(ang) * offsetMm });
      }
    } else {
      // the line turns into the stair: the offsets cross — their intersection
      const p = at(s.b, s.n);
      const q = at(next.a, next.n);
      const den = s.d.x * next.d.y - s.d.y * next.d.x;
      const t = Math.abs(den) < 1e-12 ? 0 : ((q.x - p.x) * next.d.y - (q.y - p.y) * next.d.x) / den;
      out.push({ x: p.x + s.d.x * t, y: p.y + s.d.y * t });
    }
  }
  return out;
}

/**
 * The lines `offsetMm` from the DUSZA: `inner` from the inner line (offsetLineFromInner) and, when a turn has its dusza
 * on the outer line (the second turn of an S — planLayout.js `duszaSide`), `outer` from the outer line.
 */
export function offsetLinesFromDusza(planLayout, offsetMm) {
  const outerDusza = (planLayout.turns || []).some((t) => t.duszaSide === 'outer');
  return { inner: offsetLineFromInner(planLayout, offsetMm), outer: outerDusza ? offsetLineAlong(planLayout, offsetMm, 'outer') : null };
}

// Where the edge [inner, outer] first meets the polyline, going from its inner end; null when it does not.
function edgeCrossing(edge, line) {
  const [a, b] = edge;
  const d = { x: b.x - a.x, y: b.y - a.y };
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1];
    const e = { x: line[i].x - p.x, y: line[i].y - p.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const ap = { x: p.x - a.x, y: p.y - a.y };
    const t = (ap.x * e.y - ap.y * e.x) / den;
    const s = (ap.x * d.y - ap.y * d.x) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || s < -1e-9 || s > 1 + 1e-9) continue;
    if (!best || t < best.t) best = { t, point: { x: a.x + d.x * t, y: a.y + d.y * t } };
  }
  return best ? best.point : null;
}

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
  const lines = offsetLinesFromDusza(planLayout, offset);
  const w = duszaWeights(planLayout.treads);
  const points = planLayout.treads.map((tread, i) => walklinePointFor(tread, offset, lines, w[i], w[i + 1]));

  const origin = points.length > 0 ? points[0].front : null;
  const next = points.length > 0 ? points[0].back : null;
  const direction =
    origin && next && !(origin.x === next.x && origin.y === next.y)
      ? normalize({ x: next.x - origin.x, y: next.y - origin.y })
      : { x: 0, y: 1 };

  return { offset, origin, direction, points };
}


// The point of an edge `offsetMm` from the dusza on `side` ('inner' | 'outer'): where the edge (read from that end)
// crosses the dusza's offset line, else that fraction of the edge.
function pointOnEdge(edge, offsetMm, line, fromOuter) {
  const e = fromOuter ? [edge[1], edge[0]] : edge;
  return (line?.length >= 2 && edgeCrossing(e, line)) || lerp(e[0], e[1], fractionAcrossWidth(e, offsetMm));
}

/**
 * Per EDGE (0 = the first front edge … N = the last back edge) how far its walkline point has moved from the inner
 * dusza's offset line (0) to the outer one's (1). Every stair but an S: all 0. An S (planLayout.js `duszaSide`): 0 up to
 * the first turn's last edge, 1 from the second turn's first edge on, and in between (flight B) linearly — the
 * walkline crosses the flight from one dusza to the other; with no tread between the turns the shared edge takes ½.
 */
export function duszaWeights(treads) {
  const n = treads.length;
  const w = new Array(n + 1).fill(0);
  const kS = treads.findIndex((t) => t.duszaSide === 'outer');
  if (kS < 0) return w;
  let last = -1;
  for (let i = 0; i < kS; i++) if (treads[i].type !== 'straight') last = i;
  const kE = last + 1; // the first turn's last edge (its back edge)
  for (let e = 0; e <= n; e++) {
    if (e >= kS) w[e] = 1;
    else if (e > kE) w[e] = (e - kE) / (kS - kE);
  }
  if (kE >= kS) w[kS] = 0.5;
  return w;
}

function walklinePointFor(tread, offsetMm, lines = {}, wFront = 0, wBack = 0) {
  const at = (edge, w) => {
    const a = pointOnEdge(edge, offsetMm, lines.inner, false);
    if (!(w > 0) || !lines.outer) return a;
    const b = pointOnEdge(edge, offsetMm, lines.outer, true);
    return lerp(a, b, w);
  };
  return {
    stepId: `step-${tread.index}`,
    front: at(tread.frontEdge, wFront),
    back: at(tread.backEdge, wBack),
  };
}

// The tread's "going" (front-to-back depth) measured on a line parallel to its inner edge, at
// a FIXED distance from that inner edge — independent of config.walklineOffset, because a
// legal minimum (e.g. "measured 0.4m from the dusza") is a fixed measurement point regardless
// of where this project's own configured walkline happens to sit. Used by winder-width
// validation (see src/validation/facts.js).
export function treadGoingAtOffsetFromInner(tread, offsetMm, planLayout = null) {
  const lines = planLayout ? offsetLinesFromDusza(planLayout, offsetMm) : {};
  const i = planLayout ? planLayout.treads.findIndex((t) => t.index === tread.index) : -1;
  const w = planLayout && i >= 0 ? duszaWeights(planLayout.treads) : [];
  const p = walklinePointFor(tread, offsetMm, lines, w[i] ?? 0, w[i + 1] ?? 0);
  return Math.hypot(p.back.x - p.front.x, p.back.y - p.front.y);
}

// Stały punkt pomiaru szerokości stopnia zabiegowego (odległość od duszy) — jedno źródło
// prawdy dla walidatora (validation/facts.js, PL-LEGAL-C-01) i wymiarów planu 2D.
export const WINDER_WIDTH_MEASURE_OFFSET_MM = 400;
