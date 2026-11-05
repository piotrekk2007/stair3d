// The wall editor of the module "Schody na beton" (user request 2026-11-05 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): walls on SOME steps of a side only (e.g. the first step of a flight walled on the right,
// the next four on both sides), each with its type. The list `config.wallList` [{id, flight, side, type,
// heightAboveMm?, from, to}] (from / to = element indices, null = the side's start / end); these are its pure edits —
// the list in the panel and the plan's mode „▥ Ściany” (a click on a step's side = a wall there or not). Pure.

import { edgeWallKey, wallsOf } from './surroundingsModel.js';

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
  for (const e of concrete.elements) {
    for (const edge of e.edges) {
      if (edge.role !== 'left' && edge.role !== 'right' && edge.role !== 'back') continue;
      if (edge.role === e.exitSide) continue;
      const key = edgeWallKey(e, edge);
      if (!key) continue;
      out.push({ index: e.index, flight: key.flight, side: key.side, a: edge.a, b: edge.b });
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
      if (a < index) next.push({ ...w, from: a, to: index - 1 });
      if (b > index) next.push({ ...w, id: a < index ? newId() : w.id, from: index + 1, to: b });
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
    near.from = Math.min(a, index);
    near.to = Math.max(b, index);
    return out;
  }
  return [...out, { id: newId(), flight, side, type, ...(type === 'low' || type === 'above' ? { heightAboveMm: type === 'low' ? 900 : 0 } : {}), from: index, to: index }];
}

/** A new wall for the list: the whole of a side of a flight. */
export function newWall(flight = 0, side = 'left', type = 'full') {
  return { id: newId(), flight, side, type, ...(type === 'low' || type === 'above' ? { heightAboveMm: type === 'low' ? 900 : 0 } : {}), from: null, to: null };
}
