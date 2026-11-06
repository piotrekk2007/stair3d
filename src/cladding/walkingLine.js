// THE WALKING LINE drawn on the plan (user report 2026-11-06: it was a broken line through the middle of every element
// — a sharp 90° corner on a landing, a zigzag through the winders' centroids). Now it runs as the self-supporting
// plan's does: straight along every flight's axis, through a winder zone along that zone's own walkline (the arc the
// winders were laid out on), round a landing's turn — the corner where the axes in and out meet, or for a 180° turn
// one point on each axis at the landing's middle — and every remaining corner rounded by a tangent arc. Pure: plan
// points in, plan points out.

const ARC_STEP_DEG = 5;
const MAX_RADIUS_MM = 600;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : null;
};
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const centre = (outline) => ({ x: outline.reduce((s, p) => s + p.x, 0) / outline.length, y: outline.reduce((s, p) => s + p.y, 0) / outline.length });

/** p projected on the line through q with direction d (a unit vector). */
const project = (p, q, d) => add(q, mul(d, dot(sub(p, q), d)));

/** Where the lines (p, d) and (q, e) meet, or null when they are (nearly) parallel. */
function meet(p, d, q, e) {
  const c = cross(d, e);
  if (Math.abs(c) < 1e-6) return null;
  return add(p, mul(d, cross(sub(q, p), e) / c));
}

/** The line's corner points before rounding: element middles, a zone's walkline, a landing's turn point(s). */
export function walkingLineCorners(concrete) {
  const zones = concrete.zones || [];
  const items = [];
  const seen = new Set();
  for (const e of concrete.elements || []) {
    const zone = e.kind === 'winder' ? zones[e.zone] : null;
    if (zone?.walkline?.length >= 2) {
      if (!seen.has(e.zone)) {
        seen.add(e.zone);
        for (const p of zone.walkline) items.push({ p, kind: 'zone' });
      }
      continue;
    }
    items.push({ p: centre(e.outline), kind: e.kind });
  }
  const out = [];
  items.forEach((it, j) => {
    if (it.kind !== 'landing') return out.push(it.p);
    // the axis coming in (the two points before) and going out (the two after)
    const a0 = items[j - 2]?.p;
    const a1 = items[j - 1]?.p;
    const b0 = items[j + 1]?.p;
    const b1 = items[j + 2]?.p;
    const dIn = a0 && a1 ? unit(sub(a1, a0)) : a1 ? unit(sub(it.p, a1)) : null;
    const dOut = b0 && b1 ? unit(sub(b1, b0)) : b0 ? unit(sub(b0, it.p)) : null;
    if (!dIn || !dOut || !a1 || !b0) return out.push(it.p);
    if (Math.abs(cross(dIn, dOut)) > 0.3) {
      // a 90° turn: the corner where the two axes meet (kept only near the landing — else its middle)
      const c = meet(a1, dIn, b0, dOut);
      return out.push(c && len(sub(c, it.p)) < 1500 ? c : it.p);
    }
    if (dot(dIn, dOut) < 0) {
      // a 180° turn: a point on each axis level with the landing's middle → two corners, a U
      out.push(project(it.p, a1, dIn), project(it.p, b0, dOut));
      return;
    }
    out.push(project(it.p, a1, dIn)); // straight on: the middle on the axis
  });
  return out.filter((p, i, all) => i === 0 || len(sub(p, all[i - 1])) > 1);
}

/**
 * The corners rounded: at every vertex a tangent arc, its tangent points at most half way along the two segments
 * beside it (so neighbouring arcs never overlap), radius ≤ MAX_RADIUS_MM; arcs as chords of ARC_STEP_DEG.
 */
export function roundCorners(points) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const p = points[i];
    const b = points[i + 1];
    const u = unit(sub(a, p));
    const v = unit(sub(b, p));
    if (!u || !v) continue;
    const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(u, v)))); // 0 = straight on
    if (turn < (0.5 * Math.PI) / 180) {
      out.push(p);
      continue;
    }
    const half = Math.tan(turn / 2);
    const t = Math.min(len(sub(a, p)) / 2, len(sub(b, p)) / 2, MAX_RADIUS_MM * half);
    const r = t / half;
    const s = add(p, mul(u, t));
    const e = add(p, mul(v, t));
    // the arc's centre: from the tangent point s, square to the incoming direction, toward the inside of the turn
    const bis = unit(add(u, v));
    const centreP = add(p, mul(bis, Math.hypot(t, r)));
    const a0 = Math.atan2(s.y - centreP.y, s.x - centreP.x);
    let a1 = Math.atan2(e.y - centreP.y, e.x - centreP.x);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs((da * 180) / Math.PI) / ARC_STEP_DEG));
    for (let k = 0; k <= n; k++) {
      const ang = a0 + (da * k) / n;
      out.push({ x: centreP.x + r * Math.cos(ang), y: centreP.y + r * Math.sin(ang) });
    }
  }
  out.push(points[points.length - 1]);
  return out.filter((p, i, all) => i === 0 || len(sub(p, all[i - 1])) > 0.01);
}

/** The walking line as drawn on the plan (points in walking order). */
export const walkingLine = (concrete) => roundCorners(walkingLineCorners(concrete));
