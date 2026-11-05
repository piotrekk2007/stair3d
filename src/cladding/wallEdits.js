// The wall editor of the module "Schody na beton" (user request 2026-11-05 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): walls on SOME steps of a side only (e.g. the first step of a flight walled on the right,
// the next four on both sides), each with its type. The list `config.wallList` [{id, flight, side, type,
// heightAboveMm?, from, to, fromOffsetMm?, toOffsetMm?}] (from / to = element indices, null = the side's start / end;
// the offsets move an end part-way along that step, mm, + = on up the flight); these are its pure edits — the list in
// the panel and the plan's mode „▥ Ściany” (a click on a step's side = a wall there or not; a wall's end dragged along
// the side). Pure.

import { edgeWallKey, wallsOf, flightFrames } from './surroundingsModel.js';

/** The user's own walls as a list (the older per-flight `walls` turned into one entry per side), never the gap walls. */
export function wallListOf(config) {
  return wallsOf({ ...config, gapWalls: [] }).map((w) => ({ ...w }));
}

/**
 * Every element's side that can carry a wall: `[{index, flight, side, a, b}]` — the edges the side runs use (a step's
 * left / right, a landing's / winder's sides and a turning landing's back edge — never the way on to the next flight).
 */
export function wallCells(concrete) {
  const out = [];
  const frames = flightFrames(concrete);
  for (const e of concrete.elements) {
    for (const edge of e.edges) {
      if (edge.role !== 'left' && edge.role !== 'right' && edge.role !== 'back') continue;
      if (edge.role === e.exitSide) continue;
      const key = edgeWallKey(e, edge);
      if (!key) continue;
      // (s along the flight's frame at a / b — the side's coordinate the wall ends are placed by)
      const frame = frames.get(key.flight);
      const s = (p) => (frame ? (p.x - frame.o.x) * frame.f.x + (p.y - frame.o.y) * frame.f.y : 0);
      out.push({ index: e.index, flight: key.flight, side: key.side, a: edge.a, b: edge.b, sa: s(edge.a), sb: s(edge.b) });
    }
  }
  return out;
}

// the element indices of a (flight, side), sorted
const indicesOf = (cells, flight, side) => [...new Set(cells.filter((c) => c.flight === flight && c.side === side).map((c) => c.index))].sort((x, y) => x - y);

/** A wall's range made concrete on its side: [from, to] (null ends = the side's first / last element). */
export function wallRange(w, cells) {
  const idx = indicesOf(cells, w.flight, w.side);
  return [w.from ?? idx[0] ?? 0, w.to ?? idx[idx.length - 1] ?? 0];
}

let seq = 0;
const newId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * A click on a step's side on the plan: a wall there → that step taken out of its wall (the wall shortened or split);
 * none → the neighbouring wall of the side grown onto it (its type), else a new one of `type`.
 * @returns {object[]} the new list
 */
export function toggleWallCell(list, cells, { index, flight, side }, type = 'full') {
  const out = list.map((w) => ({ ...w }));
  const on = (w) => {
    if (w.flight !== flight || w.side !== side) return false;
    const [a, b] = wallRange(w, cells);
    return index >= a && index <= b;
  };
  const hit = out.map((w, k) => (on(w) ? k : -1)).filter((k) => k >= 0);
  if (hit.length) {
    // (every wall covering it — the last one wins in the model — gives it up)
    const next = [];
    for (const [k, w] of out.entries()) {
      if (!hit.includes(k)) {
        next.push(w);
        continue;
      }
      const [a, b] = wallRange(w, cells);
      // (the part before keeps its start, ends at the step before; the part after starts at the step after)
      const { toOffsetMm, fromOffsetMm, ...rest } = w;
      const prev = indicesOf(cells, flight, side).filter((i) => i < index).at(-1);
      const nxt = indicesOf(cells, flight, side).find((i) => i > index);
      if (a < index && prev !== undefined) next.push({ ...rest, ...(fromOffsetMm ? { fromOffsetMm } : {}), from: a, to: prev });
      if (b > index && nxt !== undefined) next.push({ ...rest, ...(toOffsetMm ? { toOffsetMm } : {}), id: a < index ? newId() : w.id, from: nxt, to: b });
    }
    return next;
  }
  // the neighbouring wall: ending on the side's element just before, or starting on the one just after
  const idx = indicesOf(cells, flight, side);
  const pos = idx.indexOf(index);
  const prev = idx[pos - 1];
  const next = idx[pos + 1];
  const near = out.find((w) => {
    if (w.flight !== flight || w.side !== side) return false;
    const [a, b] = wallRange(w, cells);
    return (prev !== undefined && b === prev) || (next !== undefined && a === next);
  });
  if (near) {
    const [a, b] = wallRange(near, cells);
    if (index < a) {
      near.from = index;
      delete near.fromOffsetMm;
    } else if (index > b) {
      near.to = index;
      delete near.toOffsetMm;
    }
    return out;
  }
  return [...out, { id: newId(), flight, side, type, ...(type === 'low' || type === 'above' ? { heightAboveMm: type === 'low' ? 900 : 0 } : {}), from: index, to: index }];
}

// a side's cells with their s range, in walking order
const sideOf = (cells, flight, side) =>
  cells
    .filter((c) => c.flight === flight && c.side === side && Math.abs(c.sb - c.sa) > 1)
    .map((c) => ({ ...c, s0: Math.min(c.sa, c.sb), s1: Math.max(c.sa, c.sb) }))
    .sort((x, y) => x.s0 - y.s0);

/** A wall's ends on the plan: `{start, end}` each `{s, p}` (s along the side, p its plan point) — null where it has none. */
export function wallEnds(w, cells, resolved) {
  const side = sideOf(cells, w.flight, w.side);
  if (!side.length) return { start: null, end: null };
  const pointAt = (s) => {
    const c = side.find((x) => s >= x.s0 - 1e-6 && s <= x.s1 + 1e-6) || (s < side[0].s0 ? side[0] : side[side.length - 1]);
    const t = (s - c.sa) / (c.sb - c.sa || 1);
    return { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t };
  };
  const lo = side[0].s0;
  const hi = side[side.length - 1].s1;
  const sA = Math.max(lo, Number.isFinite(resolved?.sA) ? resolved.sA : lo);
  const sB = Math.min(hi, Number.isFinite(resolved?.sB) ? resolved.sB : hi);
  return { start: { s: sA, p: pointAt(sA) }, end: { s: sB, p: pointAt(sB) } };
}

/** The s along a wall's side of a plan point (its nearest point on the side's line pieces). */
export function sideSAt(cells, flight, side, p) {
  let best = null;
  for (const c of sideOf(cells, flight, side)) {
    const dx = c.b.x - c.a.x;
    const dy = c.b.y - c.a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - c.a.x) * dx + (p.y - c.a.y) * dy) / l2));
    const d = Math.hypot(p.x - (c.a.x + dx * t), p.y - (c.a.y + dy * t));
    if (!best || d < best.d) best = { d, s: c.sa + (c.sb - c.sa) * t };
  }
  return best?.s ?? null;
}

/**
 * A wall's end moved to s along its side (the plan's drag): snapped to a step's front / back within `snapMm`, else to
 * 10 mm; written as the step it falls on + the offset from that step's start (the wall's start) / end (its end).
 * The two ends never cross (kept ≥ 10 mm apart). @returns {object} the wall changed
 */
export function moveWallEnd(w, cells, end, s, { snapMm = 0, other = null } = {}) {
  const side = sideOf(cells, w.flight, w.side);
  if (!side.length || !Number.isFinite(s)) return w;
  const lo = side[0].s0;
  const hi = side[side.length - 1].s1;
  let v = Math.max(lo, Math.min(hi, s));
  const bounds = side.flatMap((c) => [c.s0, c.s1]);
  const near = bounds.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), bounds[0]);
  v = Math.abs(near - v) <= snapMm ? near : Math.round(v / 10) * 10;
  if (Number.isFinite(other)) v = end === 'start' ? Math.min(v, other - 10) : Math.max(v, other + 10);
  const out = { ...w };
  if (end === 'start') {
    // the step it starts on (a step's back = the next one's front: the next step, offset 0)
    const c = side.find((x) => v >= x.s0 - 1e-6 && v < x.s1 - 1e-6) || side[side.length - 1];
    out.from = c.index;
    const off = Math.round(v - c.s0);
    if (off) out.fromOffsetMm = off;
    else delete out.fromOffsetMm;
  } else {
    const c = [...side].reverse().find((x) => v <= x.s1 + 1e-6 && v > x.s0 + 1e-6) || side[0];
    out.to = c.index;
    const off = Math.round(v - c.s1);
    if (off) out.toOffsetMm = off;
    else delete out.toOffsetMm;
  }
  return out;
}

/** A new wall for the list: the whole of a side of a flight. */
export function newWall(flight = 0, side = 'left', type = 'full') {
  return { id: newId(), flight, side, type, ...(type === 'low' || type === 'above' ? { heightAboveMm: type === 'low' ? 900 : 0 } : {}), from: null, to: null };
}
