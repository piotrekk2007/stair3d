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

const ARC_SAMPLE_DEG = 3;

/** The line `offsetMm` from the inner line, into the stair: offset straights joined by arcs round convex corners. */
export function offsetLineFromInner(planLayout, offsetMm) {
  const path = (planLayout.innerFullPath || []).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9);
  if (path.length < 2 || !(offsetMm > 0)) return [];
  const handed = planLayout.handedness || 1;
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const d = normalize({ x: path[i].x - path[i - 1].x, y: path[i].y - path[i - 1].y });
    const n = inwardNormal(d, 'inner', handed);
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
  const line = offsetLineFromInner(planLayout, offset);
  const points = planLayout.treads.map((tread) => walklinePointFor(tread, offset, line));

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

function walklinePointFor(tread, offsetMm, line = []) {
  const onEdge = (edge) => (line.length >= 2 && edgeCrossing(edge, line)) || lerp(edge[0], edge[1], fractionAcrossWidth(edge, offsetMm));
  return {
    stepId: `step-${tread.index}`,
    front: onEdge(tread.frontEdge),
    back: onEdge(tread.backEdge),
  };
}

// The tread's "going" (front-to-back depth) measured on a line parallel to its inner edge, at
// a FIXED distance from that inner edge — independent of config.walklineOffset, because a
// legal minimum (e.g. "measured 0.4m from the dusza") is a fixed measurement point regardless
// of where this project's own configured walkline happens to sit. Used by winder-width
// validation (see src/validation/facts.js).
export function treadGoingAtOffsetFromInner(tread, offsetMm, planLayout = null) {
  const p = walklinePointFor(tread, offsetMm, planLayout ? offsetLineFromInner(planLayout, offsetMm) : []);
  return Math.hypot(p.back.x - p.front.x, p.back.y - p.front.y);
}

// Stały punkt pomiaru szerokości stopnia zabiegowego (odległość od duszy) — jedno źródło
// prawdy dla walidatora (validation/facts.js, PL-LEGAL-C-01) i wymiarów planu 2D.
export const WINDER_WIDTH_MEASURE_OFFSET_MM = 400;
