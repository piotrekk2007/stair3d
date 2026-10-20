// The HEADROOM under the ceiling slab (user request 2026-10-20: "show the minimum headroom in 3D, also in the
// presentation mode") — pure model, no Three.js. scene/headroomOverlay.js draws it.
//
// The rule measures it vertically from the tread (nosing line) up to the slab's underside (soffit, z = totalRise −
// ceilingThickness), `minHeadroom`. Two kinds of pieces:
//   - EDGE curtains: along every edge of the opening (`ceilingFit.openingOutline`), the soffit followed down to the
//     FIRST tread below, just past the edge on the slab's side (the highest whose plan outline contains that point,
//     under the soffit — the same outlines and tread tops (index + 1) × riser as the ceiling check, config/schema.js
//     deriveCeilingFit, so both agree; none at the exit, where the stair arrives on the slab): one vertical strip per
//     stretch over one tread (plan a→b, zBottom = its top, zTop = the soffit).
//   - UNDER-SLAB blocks: a tread the ceiling check flags (`ceilingFit.violatingTreads` — not inside the opening and
//     less than the headroom under the slab), its part under the slab (the outline minus a convex opening; the whole
//     tread otherwise) from its top up to the soffit — where the head would hit.
// `min` = the tightest spot of all (for the dimension in 3D).

import { pointInPolygon, subtractConvex } from './polygonClip.js';
import { signedPolygonArea } from './pathUtils.js';

export const HEADROOM_SAMPLE_MM = 10;
// How far past the edge (onto the slab side) a tread must go on to count as passing under the edge (mm).
const UNDER_PROBE_MM = 5;

function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * @param {{planLayout: Object, ceilingFit: Object, config: Object}} input  config with `riserHeight`
 * @returns {{soffitZ:number, requiredMm:number, pieces:Object[], blocks:Object[], min:Object|null}}
 */
export function buildHeadroomModel({ planLayout, ceilingFit, config }) {
  const soffitZ = (Number(config.totalRise) || 0) - (Number(config.ceilingThickness) || 0);
  const requiredMm = Number(config.minHeadroom) || 0;
  const outline = ceilingFit?.openingOutline;
  const empty = { soffitZ, requiredMm, pieces: [], blocks: [], min: null };
  const rh = Number(config.riserHeight) || 0;
  const all = (planLayout?.treads || []).map((t) => ({ index: t.index, stepId: `step-${t.index}`, outline: t.outline, elevation: { top: (t.index + 1) * rh } }));
  if (!Array.isArray(outline) || outline.length < 3 || !all.length) return empty;
  const treads = all.filter((t) => t.outline?.length >= 3 && t.elevation.top < soffitZ - 1e-6);
  const below = (p) => {
    let best = null;
    for (const t of treads) if ((!best || t.elevation.top > best.elevation.top) && pointInPolygon(p, t.outline)) best = t;
    return best;
  };
  const piece = (fields, top) => ({ ...fields, zTop: soffitZ, zBottom: top, headroomMm: soffitZ - top, ok: soffitZ - top >= requiredMm - 1e-6 });

  // --- edge curtains
  const pieces = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const outward = { x: d.y, y: -d.x }; // a CCW outline: the slab is to the right of a → b
    const n = Math.max(1, Math.ceil(len / HEADROOM_SAMPLE_MM));
    let current = null;
    for (let k = 0; k < n; k++) {
      const t0 = (k * len) / n;
      const t1 = ((k + 1) * len) / n;
      const mid = { x: a.x + (d.x * (t0 + t1)) / 2, y: a.y + (d.y * (t0 + t1)) / 2 };
      // the first tread under the slab just past the edge (at the exit the stair arrives on the slab: none there; an
      // edge lying on a tread boundary measures the tread under the slab, not the one inside the opening)
      const use = below({ x: mid.x + outward.x * UNDER_PROBE_MM, y: mid.y + outward.y * UNDER_PROBE_MM });
      if (current && use && current.stepId === use.stepId) {
        current.b = { x: a.x + d.x * t1, y: a.y + d.y * t1 };
        continue;
      }
      if (current) pieces.push(current);
      current = use ? piece({ kind: 'edge', edge: i, stepId: use.stepId, a: { x: a.x + d.x * t0, y: a.y + d.y * t0 }, b: { x: a.x + d.x * t1, y: a.y + d.y * t1 } }, use.elevation.top) : null;
    }
    if (current) pieces.push(current);
  });

  // --- the treads the ceiling check flags: their part under the slab
  const blocks = [];
  const convex = isConvex(outline);
  const byIndex = new Map(all.map((t) => [t.index, t]));
  for (const index of ceilingFit.violatingTreads || []) {
    const t = byIndex.get(index);
    if (!t || !(t.elevation.top < soffitZ)) continue;
    let parts = [t.outline];
    if (convex) {
      const left = subtractConvex(t.outline, outline).map((p) => p.outer).filter((p) => p.length >= 3 && Math.abs(signedPolygonArea(p)) > 1);
      if (left.length) parts = left;
    }
    for (const outlinePart of parts) blocks.push(piece({ kind: 'block', stepId: t.stepId, outline: outlinePart }, t.elevation.top));
  }

  let min = null;
  const consider = (p, at) => {
    if (!min || p.headroomMm < min.headroomMm) min = { headroomMm: p.headroomMm, ok: p.ok, at, zBottom: p.zBottom, zTop: p.zTop, stepId: p.stepId };
  };
  for (const p of pieces) consider(p, { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });
  for (const p of blocks) {
    const c = p.outline.reduce((acc, q) => ({ x: acc.x + q.x / p.outline.length, y: acc.y + q.y / p.outline.length }), { x: 0, y: 0 });
    consider(p, c);
  }
  return { soffitZ, requiredMm, pieces, blocks, min };
}
