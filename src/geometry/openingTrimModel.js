// The ceiling opening's wooden TRIM — "fajka" / nosek (user request 2026-10-26): along the chosen edges of the opening
// a profile with, at the edge, a NOSE as thick as a tread (or thicker, down to covering the whole slab edge) standing
// `openingTrimNoseWidthMm` out into the opening, and behind it a thin BOARD lying on the slab, its top flush with the
// floor, running `openingTrimBoardDepthMm` back onto the floor where it meets the floor finish. It finishes the edge of
// the opening and takes the posts / balusters of the gallery balustrade.
//
//   section (n = from the opening's edge into the slab, z up; F = the floor, totalRise):
//     nose  : n ∈ [−noseWidth, 0],   z ∈ [F − noseHeight, F]
//     board : n ∈ [0, boardDepth],   z ∈ [F − boardThickness, F]
//
// Which edges: the same free pieces as the opening's balustrade (railingSolver.js openingEdgePieces — not along a
// stairwell wall, not the stretch where the stair arrives), each edge on / off by hand (`openingTrimEdges`, toggled on
// the plan). Adjacent pieces of a chain are MITRED (the band corners where the offset lines of the two edges meet); a
// free end (at the stair, at a wall, next to an edge without trim) is cut square to its edge.
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
  const { edges, pieces: all } = openingEdgePieces(openingOutline, ctx, config.openingTrimEdges);
  const dims = openingTrimDims(config);
  const F = Number(config.totalRise) || 0;
  const diagnostics = [];
  if (dims.noseHeight > (Number(config.ceilingThickness) || Infinity)) {
    diagnostics.push(createDiagnostic({ ruleId: 'OPENING-TRIM-NOSE-HEIGHT', severity: 'WARNING', elementType: 'stair', elementId: null, parameter: 'openingTrimNoseHeightMm', value: dims.noseHeight, expected: `≤ ${config.ceilingThickness}`, unit: 'mm', message: `Obróbka otworu: nosek ${dims.noseHeight} mm jest wyższy niż grubość stropu (${config.ceilingThickness} mm) — wystaje poniżej stropu.` }));
  }
  const pieces = all.filter((p) => p.enabled && Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) > JOIN_MM);
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
      { kind: 'nose', outline: band(-dims.noseWidth, 0), zBottom: F - dims.noseHeight, zTop: F },
      ...(dims.boardDepth > 0 ? [{ kind: 'board', outline: band(0, dims.boardDepth), zBottom: F - dims.boardThickness, zTop: F }] : []),
    ].filter((s) => dims.noseWidth > 0 || s.kind !== 'nose');
    // the blank: the longest side of the band × its full width, at the nose's height (one board, milled)
    const lengthMm = Math.max(...solids.flatMap((s) => [Math.hypot(s.outline[1].x - s.outline[0].x, s.outline[1].y - s.outline[0].y), Math.hypot(s.outline[2].x - s.outline[3].x, s.outline[2].y - s.outline[3].y)]));
    return { id: `opening-trim-e${p.edge}${p.part ? `-${p.part}` : ''}`, edge: p.edge, part: p.part, a: p.a, b: p.b, outward: n, lengthMm, widthMm: dims.noseWidth + dims.boardDepth, solids };
  });
  return { enabled: true, edges: edges.map((e) => ({ index: e.index, a: e.a, b: e.b, auto: e.auto, enabled: e.enabled, overridden: e.overridden, wall: e.wall })), pieces: out, dims, diagnostics };
}
