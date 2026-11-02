// A stair partly on a CONCRETE flight (user request 2026-11-02, decisions: a slab with a smooth soffit, the wangi run up
// to the concrete, no balustrade on it, the concrete not in the takeoff). Docs: docs/architecture/CONCRETE_FLIGHT.md.
//
// From tread `concreteFromTread` (1-based, as the plan numbers them; null = the first winder / landing of the first turn)
// up to the exit the treads lie on a concrete flight cast on site: wooden cladding treads (and risers, when the stair
// has them) on its steps, no wangi and no structural posts there. Below it the stair is the usual wooden one; its wangi
// end with a plumb cut at the first concrete step (stringerSolver.js — the concrete treads give no bearings), the posts
// standing on the concrete part's lines are not made (postSolver.js), its treads are not recessed into a wanga
// (edgeOverrides.js applyHousingRecess / treadSolver.js nominalEdgesOf) and the balustrade stops on the wooden part
// (`woodOnlyRailingSections`).
//
// THE ONE RULE for "is this tread on concrete": `concreteFromIndex` (planLayout.js marks the treads `onConcrete`).
//
// The concrete itself (`buildConcreteModel`): every concrete step a block under its tread — top at the tread's
// underside, from its riser's back face (the front edge moved back by the riser board's thickness) to the next one's —
// and one smooth soffit under them: on the line where step i begins it is step i−1's top less the slab's vertical
// thickness, on the line where it ends step i's top less it, between the two by the distance to each (a winder's soffit
// twists with it), never below the floor. Past the last step a block up to the raw slab's top (the flight is cast into
// the slab). Pure: no Three.js.

import { clipToConvex, polygonArea } from './polygonClip.js';
import { rawSlabTopZ } from './floors.js';

export const CONCRETE_SLAB_THICKNESS_DEFAULT_MM = 150; // ASSUMPTION: a typical cast-in-place stair slab
const FAR_MM = 1e5; // the half-planes are quads this far along their line
const TOP_BLOCK_DEPTH_MIN_MM = 200;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = (v) => {
  const l = Math.hypot(v.x, v.y);
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
};

/** Whether the project has a concrete part at all (only a stair on wangi can have one). */
export function hasConcretePart(config) {
  return !!config?.concreteEnabled && (config.stairConstruction || 'stringers') === 'stringers';
}

/**
 * The 0-based index of the first tread on concrete, or null (no concrete part). `concreteFromTread` is the plan's tread
 * NUMBER (1-based); null = the first tread of the first turn (flight A + 1), clamped to the stair.
 */
export function concreteFromIndex(config, treadCount) {
  if (!hasConcretePart(config) || !(treadCount > 0)) return null;
  const given = Number(config.concreteFromTread);
  const number = Number.isFinite(given) && given >= 1 ? Math.round(given) : (Number(config.treadsLegA) || 0) + 1;
  return Math.min(treadCount, Math.max(1, number)) - 1;
}

/** The balustrade sections cut back to the wooden part (no balustrade on the concrete — user decision 2026-11-02). */
export function woodOnlyRailingSections(sections, fromIndex) {
  if (fromIndex === null || fromIndex === undefined || !Array.isArray(sections)) return sections;
  const lastWood = fromIndex - 1;
  return sections
    .filter((s) => s && Number.isInteger(s.fromStep) && s.fromStep <= lastWood)
    .map((s) => ({ ...s, toStep: s.toStep === null || s.toStep === undefined ? lastWood : Math.min(s.toStep, lastWood) }));
}

// The half-plane on the side of `towards` of the line through a-b, as a big convex quad (for clipToConvex).
function halfPlane(a, b, towards) {
  const d = unit(sub(b, a));
  let n = { x: -d.y, y: d.x };
  if (dot(sub(towards, a), n) < 0) n = { x: -n.x, y: -n.y };
  const A = { x: a.x - d.x * FAR_MM, y: a.y - d.y * FAR_MM };
  const B = { x: a.x + d.x * FAR_MM, y: a.y + d.y * FAR_MM };
  return [A, B, { x: B.x + n.x * FAR_MM, y: B.y + n.y * FAR_MM }, { x: A.x + n.x * FAR_MM, y: A.y + n.y * FAR_MM }];
}

// An edge [inner, outer] moved by `d` along its normal towards `towards` (a line: two points).
function shiftedEdge(edge, d, towards) {
  const [a, b] = edge;
  const dir = unit(sub(b, a));
  let n = { x: -dir.y, y: dir.x };
  if (dot(sub(towards, a), n) < 0) n = { x: -n.x, y: -n.y };
  return [
    { x: a.x + n.x * d, y: a.y + n.y * d },
    { x: b.x + n.x * d, y: b.y + n.y * d },
  ];
}

const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

// Signed distance of p from the line a-b, positive on the side of `towards`.
function sideDistance(p, [a, b], towards) {
  const d = unit(sub(b, a));
  let n = { x: -d.y, y: d.x };
  if (dot(sub(towards, a), n) < 0) n = { x: -n.x, y: -n.y };
  return dot(sub(p, a), n);
}

/**
 * @param {{planLayout: Object, treadModels: Object[]}} models
 * @param {Object} config  the full config (riserHeight merged in)
 * @returns {null | {fromIndex:number, fromTreadNo:number, slabThicknessMm:number,
 *   blocks: {treadIndex:number|null, outline:{x,y}[], topZ:number, bottomZ:number[]}[], volumeM3:number}}
 */
export function buildConcreteModel({ planLayout, treadModels }, config) {
  const treads = planLayout?.treads || [];
  const fromIndex = concreteFromIndex(config, treads.length);
  if (fromIndex === null) return null;
  const rise = Number(config.riserHeight) || 0;
  const tt = Number(config.treadThickness) || 0;
  const rt = config.hasRiserBoards && Number(config.riserBoardThickness) > 0 ? Number(config.riserBoardThickness) : 0;
  const slab = Number(config.concreteSlabThicknessMm) > 0 ? Number(config.concreteSlabThicknessMm) : CONCRETE_SLAB_THICKNESS_DEFAULT_MM;
  const going = Number(config.treadGoing) > 0 ? Number(config.treadGoing) : 1;
  // the slab's thickness measured plumb (square to the nominal pitch it is `slab`)
  const plumb = slab / Math.cos(Math.atan2(rise, going));
  const topZ = (i) => (i + 1) * rise - tt; // the concrete step's top = its tread's underside (treadSolver.js)

  const blocks = [];
  const last = treads.length - 1;
  for (let i = fromIndex; i <= last; i++) {
    const t = treads[i];
    if (!t.frontEdge?.length || !t.backEdge?.length || !(t.outline?.length >= 3)) continue;
    const inside = centroid(t.outline);
    // where this step begins (behind its riser) and ends (behind the next riser; the last one: at the back edge — the
    // top riser stands behind it, riserSolver.js)
    const begin = shiftedEdge(t.frontEdge, rt, inside);
    const next = treads[i + 1];
    const endShift = i < last ? rt : 0;
    const beyond = { x: 2 * t.backEdge[0].x - inside.x, y: 2 * t.backEdge[0].y - inside.y };
    const end = shiftedEdge(t.backEdge, endShift, beyond);
    const soffitAt = (p) => {
      const dF = Math.max(0, sideDistance(p, begin, inside));
      const dB = Math.max(0, sideDistance(p, end, inside));
      const f = dF + dB > 1e-6 ? dF / (dF + dB) : 0.5;
      return Math.max(0, topZ(i - 1) + (topZ(i) - topZ(i - 1)) * f - plumb);
    };
    const pieces = [clipToConvex(t.outline, halfPlane(begin[0], begin[1], inside))];
    // the strip of the next tread up to the next riser's back face carries this step's top too
    if (next && endShift > 0 && next.outline?.length >= 3) {
      pieces.push(clipToConvex(next.outline, halfPlane(end[0], end[1], inside)));
    }
    for (const outline of pieces) {
      if (outline.length < 3 || polygonArea(outline) < 1) continue;
      blocks.push({ treadIndex: i, outline, topZ: topZ(i), bottomZ: outline.map(soffitAt) });
    }
  }
  // past the last step: up to the raw slab (the flight is cast into it)
  const lastTread = treads[last];
  if (lastTread?.backEdge?.length === 2 && lastTread.outline?.length >= 3) {
    const inside = centroid(lastTread.outline);
    const beyond = { x: 2 * lastTread.backEdge[0].x - inside.x, y: 2 * lastTread.backEdge[0].y - inside.y };
    const depth = Math.max(TOP_BLOCK_DEPTH_MIN_MM, Number(config.ceilingThickness) || 0);
    const a = shiftedEdge(lastTread.backEdge, rt, beyond);
    const b = shiftedEdge(lastTread.backEdge, rt + depth, beyond);
    const outline = [a[0], a[1], b[1], b[0]];
    const bottom = Math.max(0, topZ(last) - plumb);
    const top = rawSlabTopZ(config);
    if (top > bottom) blocks.push({ treadIndex: null, outline, topZ: top, bottomZ: outline.map(() => bottom) });
  }

  // the volume (m³, information only): each block's area × its mean height
  const volumeM3 = blocks.reduce((s, b) => s + polygonArea(b.outline) * (b.topZ - b.bottomZ.reduce((x, z) => x + z, 0) / b.bottomZ.length), 0) / 1e9;
  return { fromIndex, fromTreadNo: fromIndex + 1, slabThicknessMm: slab, blocks, volumeM3 };
}
