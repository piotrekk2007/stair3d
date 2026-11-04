// The surroundings of the concrete stair (module "Schody na beton", stage 3 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): the walls along its flights (a walled side gets no side nosing — claddingModel.js),
// the slab above with the ceiling opening the stair needs. Pure, no Three.js.

import { unionRectangles } from '../geometry/rectUnion.js';

const unit = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const outward = (e) => {
  const t = unit(e.a, e.b);
  return { x: t.y, y: -t.x };
};
const add = (p, n, d) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

/**
 * Which wall (flight, side walking up) an element's edge lies along, or null. A step's side edges belong to its flight;
 * a landing's / a winder zone's side edges to the flight they run along (the incoming one, or the next one past the
 * turn); an L landing's back edge is the next flight's outer side, a U landing's back edge the end wall (the incoming
 * flight's outer side).
 */
export function edgeWallKey(element, edge) {
  const f = element.flight;
  if (edge.role === 'left' || edge.role === 'right') {
    if (element.kind === 'step') return { flight: f, side: edge.role };
    const t = unit(edge.a, edge.b);
    const along = Math.abs(t.x * element.frame.f.x + t.y * element.frame.f.y) > 0.7;
    return { flight: along ? f : f + 1, side: edge.role };
  }
  if (edge.role === 'back' && element.kind === 'landing' && element.turn && element.turn !== 'none') {
    if (element.turn === 'right') return { flight: f + 1, side: 'left' };
    if (element.turn === 'left') return { flight: f + 1, side: 'right' };
    return { flight: f, side: element.turn === 'u-right' ? 'left' : 'right' };
  }
  return null;
}

/** Is this edge's side covered by a RAKED cover stringer (finishModel.js — the treads butt into it, no side nosing)? */
export function edgeHasRakedCover(element, edge, config) {
  const key = edgeWallKey(element, edge);
  return !!key && config.coverStringerTop === 'raked' && !!config.coverStringers?.[key.flight]?.[key.side];
}

export function edgeHasWall(element, edge, config) {
  const key = edgeWallKey(element, edge);
  return !!key && !!config.walls?.[key.flight]?.[key.side];
}

/** Every walled edge as a wall piece: its face on the concrete's edge, `wallThicknessMm` outward, floor to slab. */
export function buildWalls(concrete, config) {
  const pieces = [];
  for (const e of concrete.elements) {
    for (const edge of e.edges) {
      if (!edgeHasWall(e, edge, config)) continue;
      const n = outward(edge);
      const T = config.wallThicknessMm;
      pieces.push({ id: `wall-${e.index}-${pieces.length}`, key: edgeWallKey(e, edge), outline: [edge.a, edge.b, add(edge.b, n, T), add(edge.a, n, T)], bottomZ: 0, topZ: concrete.exit.rawSlabTopZ });
    }
  }
  return pieces;
}

/**
 * The slab above: the opening = the union of the plan rectangles (the plan's axes — every flight runs along x or y)
 * round every tread whose finished top is closer than `minHeadroomMm` to the slab's soffit (an L / U stair gets an L /
 * U opening, not one box over the empty corner); the slab = the stair's extent + 1 m round it, the opening cut out.
 * null when no tread reaches up there.
 */
export function buildSlab(concrete, cladding, config) {
  const top = concrete.exit.rawSlabTopZ;
  const soffit = top - config.slabThicknessMm;
  const need = cladding.treads.filter((t) => t.topZ + config.minHeadroomMm > soffit);
  if (!need.length) return null;
  // (the opening runs to the stair's exit: the last tread's back line)
  const loops = unionRectangles(need.map((t) => rect(t.outline)).map((r) => ({ uStart: r.minX, uEnd: r.maxX, vBottom: r.minY, vTop: r.maxY })));
  const area = (l) => Math.abs(l.reduce((s, p, k) => s + p.u * l[(k + 1) % l.length].v - l[(k + 1) % l.length].u * p.v, 0) / 2);
  const biggest = loops.reduce((best, l) => (!best || area(l) > area(best) ? l : best), null);
  if (!biggest) return null;
  const openingPoly = biggest.map((p) => ({ x: p.u, y: p.v }));
  const all = rect(concrete.elements.flatMap((e) => e.outline));
  const MARGIN = 1000;
  const outer = { minX: all.minX - MARGIN, maxX: all.maxX + MARGIN, minY: all.minY - MARGIN, maxY: all.maxY + MARGIN };
  const asPoly = (r) => [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  // the exit edge of the opening must be the stair's last back edge (the slab starts there)
  return { outline: asPoly(outer), opening: openingPoly, topZ: top, bottomZ: soffit, finishTopZ: top + config.floorFinishTopMm, treadsUnder: need.map((t) => t.index) };
}

function rect(pts) {
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
}
