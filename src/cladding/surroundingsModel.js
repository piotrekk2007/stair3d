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

/** Does glass on the concrete's side (balustradeModel.js, `glass-side`) stand along this edge — no side nosing there? */
export function edgeHasSideGlass(element, edge, config) {
  const key = edgeWallKey(element, edge);
  return !!key && config.railingInfill === 'glass-side' && !!config.railingSides?.[key.flight]?.[key.side] && !edgeHasWall(element, edge, config);
}

/** Is this edge's side covered by a RAKED cover stringer (finishModel.js — the treads butt into it, no side nosing)? */
export function edgeHasRakedCover(element, edge, config) {
  const key = edgeWallKey(element, edge);
  return !!key && config.coverStringerTop === 'raked' && !!config.coverStringers?.[key.flight]?.[key.side];
}

/**
 * Every wall as a list entry {id, flight, side, type, heightAboveMm?, from, to} (from / to element indices, null = open):
 * `config.wallList` when given (the wall editor), else one entry per (flight, side) of the per-flight `walls`
 * (true = full, the older form); the walls between flights set apart (`gapWalls`, withGapWalls) first — a later entry
 * wins, so the user's own wall on that side stays.
 */
export function wallsOf(config) {
  const own = Array.isArray(config.wallList)
    ? config.wallList
    : Object.entries(config.walls || {}).flatMap(([f, v]) => ['left', 'right'].filter((side) => v?.[side]).map((side) => ({ id: `w-${f}-${side}`, flight: Number(f), side, ...(v[side] === true ? { type: 'full' } : v[side]), from: null, to: null })));
  return [...(config.gapWalls || []), ...own];
}

/** The wall on a (flight, side) at an element (its index; omitted = anywhere on the side): null, or the list entry. */
export function wallOn(key, config, index = null) {
  if (!key) return null;
  let found = null;
  for (const w of wallsOf(config)) {
    if (w.flight !== key.flight || w.side !== key.side) continue;
    if (index !== null && ((w.from !== null && w.from !== undefined && index < w.from) || (w.to !== null && w.to !== undefined && index > w.to))) continue;
    found = w;
  }
  return found;
}

/** Does a wall stand along this edge, beside the stair (no side nosing, the skirting there)? A piece of an edge split
 *  where a wall ends (`wallSpans`) carries its own `wall`; a whole edge counts as walled where its longest stretch is. */
export function edgeHasWall(element, edge, config) {
  if (edge && 'wall' in edge) return !!edge.wall && edge.wall.type !== 'under';
  const spans = config.wallIndex?.spansOf(element, edge);
  if (spans?.length) {
    const longest = spans.reduce((b, x) => (!b || x.t1 - x.t0 > b.t1 - b.t0 ? x : b), null);
    return !!longest.wall && longest.wall.type !== 'under';
  }
  const w = wallOn(edgeWallKey(element, edge), config, element.index);
  return !!w && w.type !== 'under';
}

/** Every flight's frame: from its first straight step (the side runs' s along it). */
export function flightFrames(concrete) {
  const frames = new Map();
  for (const e of concrete.elements) if (e.kind === 'step' && !frames.has(e.flight)) frames.set(e.flight, e.frame);
  return frames;
}
const sAlong = (frame, p) => (p.x - frame.o.x) * frame.f.x + (p.y - frame.o.y) * frame.f.y;

/**
 * The walls placed along their sides (user request 2026-11-05 — a wall ending part-way along a step): every list entry
 * gets its stretch [sA, sB] in mm along its flight's frame — `from` / `to` steps (their side's first / last point) +
 * `fromOffsetMm` / `toOffsetMm` (+ = on up the flight), open ends ±∞ —, and `spansOf(element, edge)` splits an edge where
 * a wall ends: `[{t0, t1, a, b, s0, s1, wall}]` (t along the edge, a later list entry winning). An edge square to its
 * flight (a U landing's end wall) takes the wall of its element by index. Pure; memoised per edge.
 */
export function resolveWalls(concrete, config) {
  const frames = flightFrames(concrete);
  // every side cell's s range
  const cells = [];
  for (const e of concrete.elements) {
    for (const edge of e.edges) {
      if (edge.role !== 'left' && edge.role !== 'right' && edge.role !== 'back') continue;
      const key = edgeWallKey(e, edge);
      const frame = key && frames.get(key.flight);
      if (!frame) continue;
      const sa = sAlong(frame, edge.a);
      const sb = sAlong(frame, edge.b);
      cells.push({ index: e.index, flight: key.flight, side: key.side, s0: Math.min(sa, sb), s1: Math.max(sa, sb) });
    }
  }
  const sideCells = (w) => cells.filter((c) => c.flight === w.flight && c.side === w.side && c.s1 - c.s0 > 1);
  const entries = wallsOf(config).map((w) => {
    const mine = sideCells(w);
    let sA = -Infinity;
    let sB = Infinity;
    if (w.from !== null && w.from !== undefined) {
      const c = mine.filter((x) => x.index >= w.from);
      const at = c.length ? Math.min(...c.filter((x) => x.index === Math.min(...c.map((y) => y.index))).map((x) => x.s0)) : Infinity;
      sA = at + (Number(w.fromOffsetMm) || 0);
    }
    if (w.to !== null && w.to !== undefined) {
      const c = mine.filter((x) => x.index <= w.to);
      const at = c.length ? Math.max(...c.filter((x) => x.index === Math.max(...c.map((y) => y.index))).map((x) => x.s1)) : -Infinity;
      sB = at + (Number(w.toOffsetMm) || 0);
    }
    return { ...w, sA, sB };
  });
  const memo = new WeakMap();
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  function spansOf(element, edge) {
    if (memo.has(edge)) return memo.get(edge);
    const key = edgeWallKey(element, edge);
    const frame = key && frames.get(key.flight);
    let out;
    if (!key) out = [{ t0: 0, t1: 1, a: edge.a, b: edge.b, wall: null }];
    else if (!frame) out = [{ t0: 0, t1: 1, a: edge.a, b: edge.b, wall: wallOn(key, config, element.index) }];
    else {
      const sa = sAlong(frame, edge.a);
      const sb = sAlong(frame, edge.b);
      const mine = entries.filter((w) => w.flight === key.flight && w.side === key.side);
      if (Math.abs(sb - sa) < 1) {
        // (square to the flight: by its element)
        out = [{ t0: 0, t1: 1, a: edge.a, b: edge.b, s0: sa, s1: sb, wall: wallOn(key, config, element.index) }];
      } else {
        const ts = [0, 1, ...mine.flatMap((w) => [w.sA, w.sB]).filter(Number.isFinite).map((s) => (s - sa) / (sb - sa))].filter((t) => t >= 0 && t <= 1);
        const cuts = [...new Set(ts.map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y).filter((t, k, all) => k === 0 || t - all[k - 1] > 1e-4);
        out = [];
        for (let k = 1; k < cuts.length; k++) {
          const t0 = cuts[k - 1];
          const t1 = cuts[k];
          const sMid = sa + (sb - sa) * ((t0 + t1) / 2);
          let wall = null;
          for (const w of mine) if (sMid >= w.sA - 1e-6 && sMid <= w.sB + 1e-6) wall = w;
          const prev = out[out.length - 1];
          if (prev && (prev.wall?.id ?? null) === (wall?.id ?? null)) {
            prev.t1 = t1;
            prev.b = lerp(edge.a, edge.b, t1);
            prev.s1 = sa + (sb - sa) * t1;
          } else out.push({ t0, t1, a: lerp(edge.a, edge.b, t0), b: lerp(edge.a, edge.b, t1), s0: sa + (sb - sa) * t0, s1: sa + (sb - sa) * t1, wall });
        }
      }
    }
    memo.set(edge, out);
    return out;
  }
  return { entries, cells, frames, spansOf };
}

/** An element's edges with every side edge split where a wall ends (each piece its `wall`; the others as they are). */
export function splitEdgesByWalls(element, config) {
  if (!config.wallIndex) return element.edges;
  return element.edges.flatMap((edge) => {
    if (edge.role !== 'left' && edge.role !== 'right') return [edge];
    const spans = config.wallIndex.spansOf(element, edge);
    return spans.map((s) => ({ ...edge, a: s.a, b: s.b, wall: s.wall, cut: { start: s.t0 > 1e-6, end: s.t1 < 1 - 1e-6 } }));
  });
}

/**
 * The full walls: every walled stretch of an edge (its face on the concrete's edge) joined end to end into one wall
 * per run — through the flights' joints and round a turn's corner (user report 2026-11-06: a box per step read as a
 * row of see-through blocks with seams, a gap at the corner, and confused the AI render). Each wall = its face line
 * offset `wallThicknessMm` outward, the corners mitred (the outer corner filled), floor to slab, as one outline.
 * `segments` keeps the stretches it is made of ({key, a, b} — which flight / side each one walls).
 */
export function buildWalls(concrete, config) {
  const T = config.wallThicknessMm;
  const segs = [];
  for (const e of concrete.elements) {
    for (const edge of e.edges) {
      // (the edge's stretches under a full wall — a wall may end part-way along it)
      const spans = config.wallIndex ? config.wallIndex.spansOf(e, edge) : [{ a: edge.a, b: edge.b, wall: wallOn(edgeWallKey(e, edge), config, e.index) }];
      for (const sp of spans) {
        if (sp.wall?.type !== 'full' || Math.hypot(sp.b.x - sp.a.x, sp.b.y - sp.a.y) < 1e-6) continue;
        segs.push({ key: edgeWallKey(e, edge), a: sp.a, b: sp.b, n: outward(edge), index: e.index });
      }
    }
  }
  return joinWallSegments(segs, T).map((chain, k) => ({
    id: `wall-${chain[0].index}-${k}`,
    key: chain[0].key,
    segments: chain.map((s) => ({ key: s.key, a: s.a, b: s.b })),
    outline: wallOutline(chain, T),
    bottomZ: 0,
    topZ: concrete.exit.rawSlabTopZ,
  }));
}

const JOIN_EPS = 0.5; // mm
const samePoint = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < JOIN_EPS;

/** The stretches chained end to end (a stretch walked backwards is turned round; its outward side stays). */
export function joinWallSegments(segs) {
  const left = segs.map((s) => ({ ...s }));
  const chains = [];
  while (left.length) {
    const chain = [left.shift()];
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        // only stretches facing the same way round the stair join (their outward sides on one side of the chain)
        const flip = (x) => ({ ...x, a: x.b, b: x.a });
        let put = null;
        if (samePoint(tail.b, s.a)) put = ['end', s];
        else if (samePoint(tail.b, s.b)) put = ['end', flip(s)];
        else if (samePoint(head.a, s.b)) put = ['start', s];
        else if (samePoint(head.a, s.a)) put = ['start', flip(s)];
        if (!put) continue;
        const [where, x] = put;
        const nb = where === 'end' ? tail : head;
        // the outward side must not swap at the joint (walls facing each other are two walls)
        if (nb.n.x * x.n.x + nb.n.y * x.n.y < -0.5) continue;
        if (where === 'end') chain.push(x);
        else chain.unshift(x);
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(chain);
  }
  return chains;
}

/** A chain's outline: its face points, then the face offset by T outward walked back — each corner where the two offset lines meet. */
function wallOutline(chain, T) {
  // the face line, collinear joints dropped (one flat face, no seam)
  const face = [chain[0].a];
  const normals = [];
  for (const s of chain) {
    const last = normals.length ? normals[normals.length - 1] : null;
    if (last && Math.abs(last.x * s.n.y - last.y * s.n.x) < 1e-6 && last.x * s.n.x + last.y * s.n.y > 0) face[face.length - 1] = s.b;
    else {
      face.push(s.b);
      normals.push(s.n);
    }
  }
  const back = face.map((p, k) => {
    if (k === 0) return add(p, normals[0], T);
    if (k === face.length - 1) return add(p, normals[normals.length - 1], T);
    const n1 = normals[k - 1];
    const n2 = normals[k];
    const c = 1 + n1.x * n2.x + n1.y * n2.y;
    // (the mitre: p + T (n1 + n2) / (1 + n1·n2) — the outer corner of two walls filled, the inner one met)
    return c > 1e-6 ? { x: p.x + (T * (n1.x + n2.x)) / c, y: p.y + (T * (n1.y + n2.y)) / c } : add(p, n1, T);
  });
  return [...face, ...back.reverse()];
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
  if (!need.length && !config.openingManual) return null;
  // (the opening runs to the stair's exit: the slab's edge — the last tread with the exit riser standing behind it)
  const lastIndex = concrete.elements.length - 1;
  const exitRisers = cladding.risers.filter((r) => r.id.startsWith('riser-top')).flatMap((r) => r.outline);
  const footprint = (t) => (t.index === lastIndex ? [...t.outline, ...exitRisers] : t.outline);
  const loops = !need.length ? [] : unionRectangles(need.map((t) => rect(footprint(t))).map((r) => ({ uStart: r.minX, uEnd: r.maxX, vBottom: r.minY, vTop: r.maxY })));
  const area = (l) => Math.abs(l.reduce((s, p, k) => s + p.u * l[(k + 1) % l.length].v - l[(k + 1) % l.length].u * p.v, 0) / 2);
  const biggest = loops.reduce((best, l) => (!best || area(l) > area(best) ? l : best), null);
  if (!biggest && !config.openingManual) return null;
  let openingPoly = biggest ? biggest.map((p) => ({ x: p.u, y: p.v })) : [];
  // drawn by hand (the plan's opening editor): as given, made counter-clockwise
  const manual = config.openingManual;
  if (manual?.length >= 3) {
    const a = manual.reduce((s, p, k) => s + p.x * manual[(k + 1) % manual.length].y - manual[(k + 1) % manual.length].x * p.y, 0);
    openingPoly = a < 0 ? [...manual].reverse() : manual.map((p) => ({ ...p }));
  }
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
  return { outline: asPoly(outer), opening: openingPoly, manual: !!manual, topZ: top, bottomZ: soffit, finishTopZ: top + config.floorFinishTopMm, treadsUnder: need.map((t) => t.index) };
}

function rect(pts) {
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
}
