// The ceiling opening's wooden TRIM — "fajka" / nosek (user request 2026-10-26): along the chosen edges of the opening
// a profile with, at the edge, a NOSE as thick as a tread (or thicker, down to covering the whole slab edge) standing
// `openingTrimNoseWidthMm` out into the opening, and behind it a thin BOARD lying on the slab, its top flush with the
// floor, running `openingTrimBoardDepthMm` back onto the floor where it meets the floor finish. It finishes the edge of
// the opening and takes the posts / balusters of the gallery balustrade.
//
//   section (n = from the opening's edge into the slab, z up; F = the floor, totalRise):
//     nose  : n ∈ [−noseWidth, 0],   z ∈ [T − noseHeight, T]
//     board : n ∈ [0, boardDepth],   z ∈ [F, T]          T = F + boardThickness
// — the board LIES ON the slab (its underside on the slab's top, F = totalRise; user report 2026-10-26: inside the
// slab it collided with it), its top flush with the finished floor laid round it.
//
// Which edges: the same free pieces as the opening's balustrade (railingSolver.js openingEdgePieces — not along a
// stairwell wall, not the stretch where the stair arrives), each edge on / off by hand (`openingTrimEdges`, toggled on
// the plan) — an edge along a wall is off by default but, switched on, gets the trim along its whole length (a wall
// does not cut it, unlike the balustrade; user report 2026-10-26). Adjacent pieces of a chain are MITRED (the band corners where the offset lines of the two edges meet); a
// free end (at the stair, at a wall, next to an edge without trim) is cut square to its edge.
//
// At the stair's EXIT (the stretch of the exit edge the stair arrives at, user request 2026-10-26) the trim is its own
// piece `opening-trim-exit`, the whole stretch (wangi included — it joins the trim beside it), switched on / off on its
// own (`openingTrimExit`, default on): it is the stair's nosing tread on the slab ("stopień fajkowy") — the top riser ends under its nose
// (`exitTrimNoseBottomZ` → riserSolver.js topRiserElevation).
//
// HOLES (withTrimHoles, after the balustrade is solved): every post and baluster of the opening's balustrade standing
// on the trim goes through it in a hole of its own section, down to the solid's underside (the slab) — the 3D trim
// shows them, the DXF draws them.
//
// Pure: no Three.js. Sizes ASSUMPTION / DO WERYFIKACJI (workshop practice, no published figure).

import { openingEdgePieces } from './railingSolver.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

const JOIN_MM = 0.5;

/** The trim's dimensions from config (mm). */
export function openingTrimDims(config) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const tread = num(config.treadThickness, 40);
  const noseHeight = config.openingTrimNoseHeightMm === null || config.openingTrimNoseHeightMm === undefined ? tread : num(config.openingTrimNoseHeightMm, tread);
  return {
    noseWidth: num(config.openingTrimNoseWidthMm, 20),
    noseHeight,
    boardThickness: Math.min(num(config.openingTrimBoardThicknessMm, 15), noseHeight),
    boardDepth: num(config.openingTrimBoardDepthMm, 100),
  };
}

// Where the line through p (direction d) meets the line through q (direction e); null when parallel.
function meet(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/**
 * @param {{config:Object, planLayout:Object, openingOutline:{x,y}[], wallSegments?:Object[]}} ctx
 * @returns {{enabled:boolean, edges:Object[], pieces:Object[], diagnostics:Object[]}}
 *   pieces: [{id, edge, part, a, b, outward, lengthMm, widthMm, solids:[{kind:'nose'|'board', outline:{x,y}[], zBottom, zTop}]}]
 */
export function buildOpeningTrim(ctx) {
  const { config, openingOutline } = ctx;
  const empty = { enabled: false, edges: [], pieces: [], diagnostics: [] };
  if (!config.openingTrimEnabled || !Array.isArray(openingOutline) || openingOutline.length < 3) return empty;
  const { edges, pieces: all } = openingEdgePieces(openingOutline, ctx, config.openingTrimEdges, { wallsCut: false });
  const dims = openingTrimDims(config);
  const F = Number(config.totalRise) || 0;
  const T = F + dims.boardThickness;
  const diagnostics = [];
  if (dims.noseHeight > (Number(config.ceilingThickness) || Infinity)) {
    diagnostics.push(createDiagnostic({ ruleId: 'OPENING-TRIM-NOSE-HEIGHT', severity: 'WARNING', elementType: 'stair', elementId: null, parameter: 'openingTrimNoseHeightMm', value: dims.noseHeight, expected: `≤ ${config.ceilingThickness}`, unit: 'mm', message: `Obróbka otworu: nosek ${dims.noseHeight} mm jest wyższy niż grubość stropu (${config.ceilingThickness} mm) — wystaje poniżej stropu.` }));
  }
  // every free part of an edge that is on (however short: the trim closes up to the stair's stretch and the corners —
  // unlike the balustrade, which drops a stub)
  const edgeOn = new Map(edges.map((e) => [e.index, e.enabled]));
  const pieces = all.filter((p) => p.part !== 'stair' && edgeOn.get(p.edge) && Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) > JOIN_MM);
  // the exit: the whole stretch of the exit edge cut out for the stair (the last back edge and one wanga past each end)
  // — so it butts against the trim on either side of it on its edge and is mitred at a corner like any piece (user
  // report 2026-10-26: stopped at the wangi's inner faces, it left a gap each side and never met the next edge); the
  // wangi's ends are notched under its nose (stringerConstructionGeometry.js), a post standing there gets a hole
  const stairCut = all.find((p) => p.part === 'stair');
  const exit = stairCut && Math.hypot(stairCut.b.x - stairCut.a.x, stairCut.b.y - stairCut.a.y) > JOIN_MM ? { edge: stairCut.edge, part: 'exit', a: stairCut.a, b: stairCut.b, enabled: config.openingTrimExit !== false, isExit: true } : null;
  if (exit?.enabled) pieces.push(exit);
  const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_MM;
  const out = pieces.map((p) => {
    const d = unit({ x: p.b.x - p.a.x, y: p.b.y - p.a.y });
    // the opening's outline is CCW: the slab is on the right of each edge
    const n = { x: d.y, y: -d.x };
    const prev = pieces.find((q) => q !== p && same(q.b, p.a));
    const next = pieces.find((q) => q !== p && same(q.a, p.b));
    // the band's two corners at offset `off` at each end: mitred with the neighbour, else square
    const at = (end, off) => {
      const base = end === 'a' ? p.a : p.b;
      const q = end === 'a' ? prev : next;
      const own = { x: base.x + n.x * off, y: base.y + n.y * off };
      if (!q) return own;
      const e = unit({ x: q.b.x - q.a.x, y: q.b.y - q.a.y });
      const m = { x: e.y, y: -e.x };
      return meet(own, d, { x: base.x + m.x * off, y: base.y + m.y * off }, e) || own;
    };
    const band = (n0, n1) => [at('a', n0), at('b', n0), at('b', n1), at('a', n1)];
    const solids = [
      { kind: 'nose', outline: band(-dims.noseWidth, 0), zBottom: T - dims.noseHeight, zTop: T },
      ...(dims.boardDepth > 0 ? [{ kind: 'board', outline: band(0, dims.boardDepth), zBottom: F, zTop: T }] : []),
    ].filter((s) => dims.noseWidth > 0 || s.kind !== 'nose');
    // the blank: the longest side of the band × its full width, at the nose's height (one board, milled)
    const lengthMm = Math.max(...solids.flatMap((s) => [Math.hypot(s.outline[1].x - s.outline[0].x, s.outline[1].y - s.outline[0].y), Math.hypot(s.outline[2].x - s.outline[3].x, s.outline[2].y - s.outline[3].y)]));
    const id = p.isExit ? 'opening-trim-exit' : `opening-trim-e${p.edge}${p.part ? `-${p.part}` : ''}`;
    return { id, edge: p.edge, part: p.part, exit: !!p.isExit, a: p.a, b: p.b, outward: n, lengthMm, widthMm: dims.noseWidth + dims.boardDepth, solids, holes: [] };
  });
  return {
    enabled: true,
    edges: edges.map((e) => ({ index: e.index, a: e.a, b: e.b, auto: e.auto, enabled: e.enabled, overridden: e.overridden, wall: e.wall })),
    // the exit piece's own switch (the plan's "▬ Fajka" mode)
    exit: exit ? { a: exit.a, b: exit.b, enabled: exit.enabled } : null,
    // where the top riser ends when the trim at the exit is the stair's nosing tread (riserSolver.js topRiserElevation)
    exitNoseBottomZ: exit?.enabled ? T - dims.noseHeight : null,
    exitNoseWidthMm: exit?.enabled ? dims.noseWidth : null,
    pieces: out,
    dims,
    diagnostics,
  };
}

// Point in polygon (ray casting) — local, so this model stays free of the clipping helpers' conventions.
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
  }
  return c;
}

/**
 * The solid of the trim under a plan point (null where there is none) — what the opening's balustrade stands in
 * (railingSolver.js openingGroundAt: the handrail from its top, the post / baluster down its hole to its underside).
 */
export function trimSolidAt(trim, p) {
  if (!trim?.enabled) return null;
  let best = null;
  for (const piece of trim.pieces) for (const s of piece.solids) if (inside(p, s.outline) && (!best || s.zTop > best.zTop)) best = s;
  return best;
}

/**
 * The trim with the HOLES of the opening balustrade's posts and balusters standing on it: on the piece / solid under
 * each one, its own section (`shape` square | round, `sizeMm`), through the solid (`depthMm`).
 */
export function withTrimHoles(trim, railingModel, config, stairPosts = []) {
  if (!trim?.enabled) return trim;
  const pieces = trim.pieces.map((p) => ({ ...p, holes: [] }));
  const add = (at, kind, shape, sizeMm) => {
    for (const piece of pieces) {
      const solid = piece.solids.find((s) => inside(at, s.outline));
      if (solid) {
        // `whole`: the hole lies wholly in this solid (not across the mitre into the next piece — a corner post)
        const r = sizeMm / 2;
        const whole = [[-r, -r], [r, -r], [r, r], [-r, r]].every(([dx, dy]) => inside({ x: at.x + dx, y: at.y + dy }, solid.outline));
        piece.holes.push({ kind, x: at.x, y: at.y, shape, sizeMm, solid: solid.kind, depthMm: solid.zTop - solid.zBottom, whole });
        return;
      }
    }
  };
  // a post of the stair standing where the trim lies (an end newel at the exit, a stair balustrade's post): through it too
  const seen = new Set();
  for (const post of stairPosts) {
    if (post.removed || seen.has(post.postId)) continue;
    seen.add(post.postId);
    add(post.position, 'post', 'square', post.size);
  }
  for (const section of railingModel?.sections || []) {
    if (section.kind !== 'opening') continue;
    for (const post of section.posts || []) if (!post.removed && !seen.has(post.postId)) add(post.position, 'post', 'square', post.size);
    for (const b of section.balusters || []) add(b.position, 'baluster', config.railingBalusterShape === 'round' ? 'round' : 'square', config.railingBalusterSizeMm);
  }
  return { ...trim, pieces };
}
