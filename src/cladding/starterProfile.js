// Starter steps and tread edge profiles (module "Schody na beton", stage 5 part 2 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md). Pure, no Three.js.
//
// STARTER STEP (stopień zapraszający): a straight step whose tread reaches past the concrete on its sides
// (`leftMm` / `rightMm` walking up), its front corners on a widened side rounded (`radiusMm`), its front bowed forward
// (`bowMm`, the arc's sagitta). Its riser is bent round that front (and along the widened sides back to the step's back
// line); under the widening a support block (the concrete — or a timber frame — cast wider) fills the shape inside the
// riser.
//
// EDGE PROFILE: the tread's exposed top edge (its front, a nosed side, a starter's round) milled: `chamfer` (fazka s ×
// s), `round` (zaokrąglenie górnej krawędzi R = s, ćwierćwałek), `bullnose` (półwałek — the whole edge round, R = half
// the thickness), `square` (none). Described as rings (an inset of the exposed edges at a height) the renderer lofts.

import { planPoint } from './concreteModel.js';

export const EDGE_PROFILES = Object.freeze(['square', 'chamfer', 'round', 'bullnose']);
export const EDGE_PROFILE_LABELS = Object.freeze({ square: 'prosta (bez profilu)', chamfer: 'fazka', round: 'zaokrąglenie R (ćwierćwałek)', bullnose: 'półwałek (cała krawędź)' });
const ARC_POINTS = 10;
const BOW_POINTS = 24;

const signedArea = (pts) => pts.reduce((s, p, k) => s + p.x * pts[(k + 1) % pts.length].y - pts[(k + 1) % pts.length].x * p.y, 0) / 2;

/** Is `starter` a real widening / rounding / bow? */
export const isStarter = (s) => !!s && (s.leftMm > 0 || s.rightMm > 0 || s.bowMm > 0);

/**
 * The starter step's outline in plan, as edges with roles (front = the bow and the rounded corners), `inset` mm inside
 * the tread's own outline (0 = the tread, the front nosing = the riser's face, …).
 * @param {object} e  the concrete step (a rectangle: frame, u0, u1, v0, v1)
 * @param {{leftMm, rightMm, radiusMm, bowMm}} s
 * @param {{front: number, left: number, right: number}} reach  the tread's own reach past the concrete (nosings)
 */
export function starterEdges(e, s, reach, inset = 0) {
  const uL = e.u0 - (s.leftMm > 0 ? s.leftMm : reach.left) + inset;
  const uR = e.u1 + (s.rightMm > 0 ? s.rightMm : reach.right) - inset;
  const vF = e.v0 - reach.front + inset;
  const vB = e.v1;
  const room = Math.max(0, Math.min(vB - vF, (uR - uL) / 2));
  const rL = s.leftMm > 0 ? Math.max(0, Math.min(room, (s.radiusMm || 0) - inset)) : 0;
  const rR = s.rightMm > 0 ? Math.max(0, Math.min(room, (s.radiusMm || 0) - inset)) : 0;
  const local = [];
  const role = [];
  const push = (u, v, r) => {
    local.push({ u, v });
    role.push(r);
  };
  // CCW in (u, v): the left side down, the rounded corner, the bow, the right corner, the right side up, the back
  push(uL, vB, 'left');
  if (rL > 0) for (let k = 0; k <= ARC_POINTS; k++) {
    const a = Math.PI + (Math.PI / 2) * (k / ARC_POINTS);
    push(uL + rL + rL * Math.cos(a), vF + rL + rL * Math.sin(a), 'front');
  }
  else push(uL, vF, 'front');
  const A = { u: uL + rL, v: vF };
  const B = { u: uR - rR, v: vF };
  const chord = B.u - A.u;
  const h = Math.max(0, s.bowMm || 0);
  if (h > 0 && chord > 1) {
    const R = (chord * chord) / 4 / (2 * h) + h / 2;
    const c = { u: (A.u + B.u) / 2, v: vF - h + R };
    const half = Math.asin(Math.min(1, chord / 2 / R));
    for (let k = 1; k < BOW_POINTS; k++) {
      const a = -Math.PI / 2 - half + (2 * half * k) / BOW_POINTS;
      push(c.u + R * Math.cos(a), c.v + R * Math.sin(a), 'front');
    }
  }
  if (rR > 0) for (let k = 0; k <= ARC_POINTS; k++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (k / ARC_POINTS);
    push(uR - rR + rR * Math.cos(a), vF + rR + rR * Math.sin(a), k === ARC_POINTS ? 'right' : 'front');
  }
  else push(uR, vF, 'right');
  push(uR, vB, 'back');
  let pts = local.map((p) => planPoint(e.frame, p.u, p.v));
  let roles = role;
  // drop repeats
  const keep = pts.map((p, k) => k === 0 || Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y) > 1e-6);
  pts = pts.filter((_, k) => keep[k]);
  roles = roles.filter((_, k) => keep[k]);
  let edges = pts.map((a, k) => ({ a, b: pts[(k + 1) % pts.length], role: roles[k] }));
  if (signedArea(pts) < 0) edges = edges.reverse().map((x) => ({ a: x.b, b: x.a, role: x.role }));
  return { edges, uL, uR, vF, vB };
}

/** The bent riser of a starter step: its face path (the outline `nosingFrontMm` in) — from the widened sides' back
 *  ends (or the front corners on a side not widened) round the front — as a strip `thickness` thick inward. */
export function starterRiserStrip(e, s, reach, nosingFrontMm, thickness) {
  const { edges } = starterEdges(e, s, reach, nosingFrontMm);
  // the path: the front and the widened sides, in order round the outline from the back of the left side
  const exposed = (x) => x.role === 'front' || (x.role === 'left' && s.leftMm > 0) || (x.role === 'right' && s.rightMm > 0);
  // rotate the edge list so it starts right after the back edge
  const back = edges.findIndex((x) => x.role === 'back');
  const ordered = [...edges.slice(back + 1), ...edges.slice(0, back)];
  const path = [];
  for (const x of ordered) {
    if (!exposed(x)) continue;
    if (!path.length) path.push(x.a);
    path.push(x.b);
  }
  if (path.length < 2) return null;
  // the strip: the path and the same path `thickness` inward (left of its direction — the outline is CCW)
  const inner = path.map((p, k) => {
    const a = path[Math.max(0, k - 1)];
    const b = path[Math.min(path.length - 1, k + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x + (-(b.y - a.y) / l) * thickness, y: p.y + ((b.x - a.x) / l) * thickness };
  });
  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
  return { outline: [...path, ...inner.reverse()], lengthMm: length };
}

// --- edge profiles ------------------------------------------------------------------------------------------------

/** The edges of an outline with the flag `exposed` per vertex-starting edge → the outline moved in by `d` on the
 *  exposed edges only (one point per vertex — the rings of a loft keep their count). */
export function insetExposed(points, exposed, d) {
  const n = points.length;
  return points.map((p, k) => {
    const prev = (k - 1 + n) % n;
    const e1 = { a: points[prev], b: p, d: exposed[prev] ? d : 0 };
    const e2 = { a: p, b: points[(k + 1) % n], d: exposed[k] ? d : 0 };
    const t1 = unit(e1.a, e1.b);
    const t2 = unit(e2.a, e2.b);
    // inward of a CCW outline = left of the direction
    const n1 = { x: -t1.y, y: t1.x };
    const n2 = { x: -t2.y, y: t2.x };
    const cross = t1.x * t2.y - t1.y * t2.x;
    if (Math.abs(cross) < 1e-9) return { x: p.x + n2.x * Math.max(e1.d, e2.d), y: p.y + n2.y * Math.max(e1.d, e2.d) };
    const P = { x: e1.a.x + n1.x * e1.d, y: e1.a.y + n1.y * e1.d };
    const Q = { x: p.x + n2.x * e2.d, y: p.y + n2.y * e2.d };
    const w = { x: Q.x - P.x, y: Q.y - P.y };
    const s = (w.x * t2.y - w.y * t2.x) / cross;
    return { x: P.x + t1.x * s, y: P.y + t1.y * s };
  });
}
const unit = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

/** The loft rings of a profiled tread, bottom to top: [{inset, z}] (z from the tread's bottom). */
export function profileRings(kind, sizeMm, thicknessMm) {
  const t = thicknessMm;
  const s = Math.max(0, Math.min(sizeMm, t));
  if (kind === 'chamfer' && s > 0) return [{ inset: 0, z: 0 }, { inset: 0, z: t - s }, { inset: s, z: t }];
  if (kind === 'round' && s > 0) {
    const out = [{ inset: 0, z: 0 }];
    for (let k = 0; k <= 6; k++) {
      const a = (Math.PI / 2) * (k / 6);
      out.push({ inset: s * (1 - Math.cos(a)), z: t - s + s * Math.sin(a) });
    }
    return out;
  }
  if (kind === 'bullnose') {
    const R = t / 2;
    const out = [];
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI / 2 + Math.PI * (k / 10);
      out.push({ inset: R * (1 - Math.cos(a)), z: R + R * Math.sin(a) });
    }
    return out;
  }
  return [{ inset: 0, z: 0 }, { inset: 0, z: t }];
}
