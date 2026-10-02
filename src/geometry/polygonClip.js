// Plan polygon clipping for joints (jointSolver.js): a tread/riser cut around a post. Pure, no dependencies.
//
//   clipToConvex(subject, clip)    subject ∩ clip          (Sutherland–Hodgman; clip convex)
//   subtractConvex(subject, hole)  subject \ hole  → [{outer, holes}]   (Weiler–Atherton walk; hole convex)
//
// Polygons are [{x, y}], any orientation (normalised to CCW inside). `subject` must be simple (a tread outline is),
// `hole` convex (the post's core — an axis-aligned square). A hole entirely inside the subject comes back as a real
// hole ({outer: subject, holes: [hole]}); a subject entirely inside the hole disappears ([]); a subject cut in two
// comes back as two pieces.

import { signedPolygonArea } from './pathUtils.js';

const EPS = 1e-9;

export function polygonArea(poly) {
  return Math.abs(signedPolygonArea(poly));
}

const ccw = (poly) => (signedPolygonArea(poly) < 0 ? [...poly].reverse() : poly);
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Drops repeated points (closer than 1 µm) and vertices lying on a straight line between their neighbours — what
// successive subtractions of shapes sharing an edge leave behind (0-length edges, a corner on a straight side).
const CLEAN_EPS_MM = 1e-3;
export function cleanPolygon(poly) {
  let pts = poly.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const p = pts[i];
      const next = pts[(i + 1) % pts.length];
      const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      const duplicate = Math.hypot(p.x - prev.x, p.y - prev.y) < CLEAN_EPS_MM;
      const onLine = Math.abs(cross(prev, p, next)) / len < CLEAN_EPS_MM && (p.x - prev.x) * (next.x - p.x) + (p.y - prev.y) * (next.y - p.y) >= 0;
      if (duplicate || onLine) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/** subject ∩ clip (clip convex). Returns a polygon (possibly empty). */
export function clipToConvex(subject, clip) {
  const c = ccw(clip);
  let out = subject.slice();
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const inside = (p) => cross(a, b, p) >= -EPS;
    const inter = (p, q) => {
      const d1 = cross(a, b, p);
      const d2 = cross(a, b, q);
      const t = d1 / (d1 - d2);
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(inter(p, q));
        out.push(q);
      } else if (inside(p)) out.push(inter(p, q));
    }
  }
  return out;
}

function pointInConvex(p, convexCcw) {
  for (let i = 0; i < convexCcw.length; i++) if (cross(convexCcw[i], convexCcw[(i + 1) % convexCcw.length], p) < -EPS) return false;
  return true;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Proper crossing of segments a1a2 and b1b2 → {t, u} (params along each), or null.
function segmentCrossing(a1, a2, b1, b2) {
  const r = { x: a2.x - a1.x, y: a2.y - a1.y };
  const s = { x: b2.x - b1.x, y: b2.y - b1.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return null;
  const qp = { x: b1.x - a1.x, y: b1.y - a1.y };
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { t, u };
}

/**
 * subject \ hole (hole convex). Returns [{outer, holes}] — the pieces left. Vertex-on-edge degeneracies are avoided
 * by nudging the hole by a sub-micron amount (irrelevant at mm scale).
 */
export function subtractConvex(subjectIn, holeIn) {
  const A = ccw(subjectIn);
  // nudge the hole so no subject vertex lies exactly on its boundary (and no edge is collinear with it)
  const cx = holeIn.reduce((s, p) => s + p.x, 0) / holeIn.length;
  const cy = holeIn.reduce((s, p) => s + p.y, 0) / holeIn.length;
  const B = ccw(holeIn.map((p) => ({ x: cx + (p.x - cx) * (1 + 3.7e-9) + 1.3e-7, y: cy + (p.y - cy) * (1 + 3.7e-9) + 0.9e-7 })));

  // intersection nodes on both boundaries
  const aNodes = A.map((p) => [{ p, inter: null }]);
  const bNodes = B.map((p) => [{ p, inter: null }]);
  const inters = [];
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i];
    const a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j];
      const b2 = B[(j + 1) % B.length];
      const c = segmentCrossing(a1, a2, b1, b2);
      if (!c) continue;
      const p = { x: a1.x + (a2.x - a1.x) * c.t, y: a1.y + (a2.y - a1.y) * c.t };
      // A enters B when its direction points to B's inside (left of the CCW edge)
      const entering = (b2.x - b1.x) * (a2.y - a1.y) - (b2.y - b1.y) * (a2.x - a1.x) > 0;
      const node = { id: inters.length, p, entering, visited: false };
      inters.push(node);
      aNodes[i].push({ p, inter: node, t: c.t });
      bNodes[j].push({ p, inter: node, t: c.u });
    }
  }
  if (inters.length === 0) {
    if (A.every((p) => pointInConvex(p, B))) return [];
    if (B.every((p) => pointInPolygon(p, A))) return [{ outer: A, holes: [B] }];
    return [{ outer: A, holes: [] }];
  }
  const flatten = (lists) => lists.flatMap((l) => [l[0], ...l.slice(1).sort((m, n) => m.t - n.t)]);
  const aList = flatten(aNodes);
  const bList = flatten(bNodes);
  const aIndex = new Map(aList.map((n, k) => [n.inter?.id, k]).filter(([id]) => id !== undefined));
  const bIndex = new Map(bList.map((n, k) => [n.inter?.id, k]).filter(([id]) => id !== undefined));

  const pieces = [];
  for (const start of inters) {
    if (start.entering || start.visited) continue; // start where A LEAVES the hole
    const ring = [];
    let onA = true;
    let k = aIndex.get(start.id);
    let guard = 0;
    for (;;) {
      if (guard++ > 10000) break;
      const list = onA ? aList : bList;
      const node = list[k];
      if (node.inter) {
        if (node.inter === start && ring.length > 0) break;
        node.inter.visited = true;
        ring.push(node.p);
        // on A: an entering node means we reach the hole -> follow the hole BACKWARDS (its part inside A)
        if (onA && node.inter.entering && ring.length > 1) {
          onA = false;
          k = bIndex.get(node.inter.id);
          k = (k - 1 + bList.length) % bList.length;
          continue;
        }
        if (!onA && ring.length > 1) {
          // on the hole we reached an exit node of A -> continue along A
          onA = true;
          k = aIndex.get(node.inter.id);
          k = (k + 1) % aList.length;
          continue;
        }
      } else {
        ring.push(node.p);
      }
      k = onA ? (k + 1) % aList.length : (k - 1 + bList.length) % bList.length;
    }
    const clean = cleanPolygon(ring);
    if (clean.length >= 3 && polygonArea(clean) > 1e-6) pieces.push({ outer: clean, holes: [] });
  }
  return pieces;
}
