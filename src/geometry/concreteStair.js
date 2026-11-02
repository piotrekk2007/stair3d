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
// twists with it), never below the floor. Where the ceiling opening runs on past the last step, a piece up to the raw
// slab's top fills the gap to the slab's edge, its soffit rising to the slab's (none when the slab starts right behind
// the last step — it used to be a 250 mm block hanging below the slab, user report 2026-11-02). Optionally a WALL under
// the flight along its inner / outer edge (`concreteWallSide`), from the floor up to the soffit — carried on back along
// its line, under the concrete steps, to the nearest wall across it (user report 2026-11-02: under the first concrete
// winder it stopped short and the step hung over open space). Pure: no Three.js.

import { clipToConvex, polygonArea, pointInPolygon } from './polygonClip.js';
import { rawSlabTopZ, slabSoffitZ } from './floors.js';

export const CONCRETE_SLAB_THICKNESS_DEFAULT_MM = 150; // ASSUMPTION: a typical cast-in-place stair slab
const FAR_MM = 1e5; // the half-planes are quads this far along their line
export const CONCRETE_WALL_SIDES = ['none', 'inner', 'outer', 'both'];

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

// The distance from p along the unit direction d to the nearest segment {a, b} it crosses (further than `minT`), or
// Infinity.
function rayToSegments(p, d, segments, minT = 1e-6) {
  let best = Infinity;
  for (const { a, b } of segments) {
    const e = sub(b, a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, p);
    const t = (w.x * e.y - w.y * e.x) / den;
    const u = (w.x * d.y - w.y * d.x) / den;
    if (t > minT && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

// The distance from p along d to the boundary of `poly` (p inside it), or 0.
function rayToBoundary(p, d, poly) {
  const t = rayToSegments(p, d, poly.map((a, k) => ({ a, b: poly[(k + 1) % poly.length] })));
  return Number.isFinite(t) ? t : 0;
}

// The quad `w` wide on the side of `inside` along p → q (no run-on past the ends).
function strip(p, q, w, inside) {
  const d = unit(sub(q, p));
  let n = { x: -d.y, y: d.x };
  if (dot(sub(inside, p), n) < 0) n = { x: -n.x, y: -n.y };
  return [p, q, { x: q.x + n.x * w, y: q.y + n.y * w }, { x: p.x + n.x * w, y: p.y + n.y * w }];
}
// how far back a wall under the flight is carried to find a wall across it (mm)
const WALL_REACH_MM = 20000;

// The strip `w` wide along a chain segment p-q on the side of `inside` (a convex quad, run on `w` past both ends so the
// pieces of a turning line overlap at its corners).
function band(p, q, w, inside) {
  const d = unit(sub(q, p));
  let n = { x: -d.y, y: d.x };
  if (dot(sub(inside, p), n) < 0) n = { x: -n.x, y: -n.y };
  const A = { x: p.x - d.x * w, y: p.y - d.y * w };
  const B = { x: q.x + d.x * w, y: q.y + d.y * w };
  return [A, B, { x: B.x + n.x * w, y: B.y + n.y * w }, { x: A.x + n.x * w, y: A.y + n.y * w }];
}

/**
 * `wallSegments`: the walls a wall under the flight may be carried back to (walls.js allWallSegments — `{a, b}` faces).
 * @param {{planLayout: Object, treadModels: Object[], openingOutline?: {x,y}[], wallSegments?: {a,b}[]}} models
 * @param {Object} config  the full config (riserHeight merged in)
 * @returns {null | {fromIndex:number, fromTreadNo:number, slabThicknessMm:number,
 *   blocks: {treadIndex:number|null, outline:{x,y}[], topZ:number, bottomZ:number[]}[],
 *   walls: {treadIndex:number, side:string, outline:{x,y}[], topZ:number[], bottomZ:number[]}[], volumeM3:number}}
 *   (a wall's top follows the soffit: one height per outline point)
 */
export function buildConcreteModel({ planLayout, treadModels, openingOutline = null, wallSegments = [] }, config) {
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
  const walls = [];
  const soffitOf = new Map(); // tread index → its soffit height function
  const wallSide = CONCRETE_WALL_SIDES.includes(config.concreteWallSide) ? config.concreteWallSide : 'none';
  const wallSides = wallSide === 'both' ? ['inner', 'outer'] : wallSide === 'none' ? [] : [wallSide];
  const wallThickness = Number(config.concreteWallThicknessMm) > 0 ? Number(config.concreteWallThicknessMm) : Number(config.freeWallThicknessMm) > 0 ? Number(config.freeWallThicknessMm) : 120;
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
    soffitOf.set(i, soffitAt);
    const pieces = [clipToConvex(t.outline, halfPlane(begin[0], begin[1], inside))];
    // the strip of the next tread up to the next riser's back face carries this step's top too
    if (next && endShift > 0 && next.outline?.length >= 3) {
      pieces.push(clipToConvex(next.outline, halfPlane(end[0], end[1], inside)));
    }
    for (const outline of pieces) {
      if (outline.length < 3 || polygonArea(outline) < 1) continue;
      blocks.push({ treadIndex: i, outline, topZ: topZ(i), bottomZ: outline.map(soffitAt) });
    }
    // the wall under the flight: along this tread's line(s), the wall's thickness into the stair, floor to soffit
    for (const side of wallSides) {
      const chain = side === 'inner' ? t.innerChain : t.outerChain;
      for (let k = 1; k < (chain?.length || 0); k++) {
        if (Math.hypot(chain[k].x - chain[k - 1].x, chain[k].y - chain[k - 1].y) < 1) continue;
        const outline = clipToConvex(t.outline, band(chain[k - 1], chain[k], wallThickness, inside));
        if (outline.length < 3 || polygonArea(outline) < 1) continue;
        const tops = outline.map(soffitAt);
        if (Math.max(...tops) < 1) continue;
        walls.push({ treadIndex: i, side, outline, topZ: tops, bottomZ: outline.map(() => 0) });
      }
    }
  }
  // ...carried on back along its line from where the concrete begins to the nearest wall across it: under every concrete
  // step it passes, up to that step's soffit
  const first = treads[fromIndex];
  for (const side of wallSides) {
    const chain = (side === 'inner' ? first?.innerChain : first?.outerChain) || [];
    const k = chain.findIndex((q, j) => j > 0 && Math.hypot(q.x - chain[0].x, q.y - chain[0].y) >= 1);
    if (k < 0 || !(wallSegments?.length > 0)) continue;
    const p0 = chain[0];
    const back = unit(sub(p0, chain[k]));
    const reach = rayToSegments(p0, back, wallSegments, 1);
    if (!(reach > 1 && reach < WALL_REACH_MM)) continue;
    const band0 = strip(p0, { x: p0.x + back.x * reach, y: p0.y + back.y * reach }, wallThickness, centroid(first.outline));
    for (let i = fromIndex; i <= last; i++) {
      const soffitAt = soffitOf.get(i);
      if (!soffitAt) continue;
      const outline = clipToConvex(treads[i].outline, band0);
      if (outline.length < 3 || polygonArea(outline) < 1) continue;
      const tops = outline.map(soffitAt);
      if (Math.max(...tops) < 1) continue;
      walls.push({ treadIndex: i, side, outline, topZ: tops, bottomZ: outline.map(() => 0), toWall: true });
    }
  }

  // past the last step, where the ceiling opening runs on: a piece at the floor up to the slab's edge, its soffit rising
  // to the slab's (none when the slab starts right behind the last step — the flight ends against its edge)
  const lastTread = treads[last];
  if (lastTread?.backEdge?.length === 2 && lastTread.outline?.length >= 3 && openingOutline?.length >= 3) {
    const inside = centroid(lastTread.outline);
    const beyond = { x: 2 * lastTread.backEdge[0].x - inside.x, y: 2 * lastTread.backEdge[0].y - inside.y };
    const a = shiftedEdge(lastTread.backEdge, rt, beyond);
    const out = unit(sub(a[0], shiftedEdge(lastTread.backEdge, rt - 1, beyond)[0]));
    const mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
    const probe = { x: mid.x + out.x, y: mid.y + out.y };
    const depth = pointInPolygon(probe, openingOutline) ? rayToBoundary(mid, out, openingOutline) : 0;
    if (depth > 1) {
      const b = shiftedEdge(lastTread.backEdge, rt + depth, beyond);
      const outline = [a[0], a[1], b[1], b[0]];
      const from = Math.max(0, topZ(last) - plumb);
      const to = Math.max(from, slabSoffitZ(config));
      const top = rawSlabTopZ(config);
      if (top > from) blocks.push({ treadIndex: null, outline, topZ: top, bottomZ: [from, from, to, to] });
    }
  }

  // the volume (m³, information only): each block's area × its mean height
  const mean = (z) => (Array.isArray(z) ? z.reduce((x, v) => x + v, 0) / z.length : z);
  const volumeM3 = [...blocks, ...walls].reduce((s, b) => s + polygonArea(b.outline) * (mean(b.topZ) - mean(b.bottomZ)), 0) / 1e9;
  return { fromIndex, fromTreadNo: fromIndex + 1, slabThicknessMm: slab, blocks, walls, volumeM3 };
}
