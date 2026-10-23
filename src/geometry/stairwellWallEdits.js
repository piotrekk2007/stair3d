// The wall editor's edits (user request 2026-10-23: "pełny edytor" — walls on any side of either line, e.g. on both
// sides of flight C): every gesture of the plan's "▭ Ściany" mode and the panel's wall list becomes one change of
// `config.stairwellWallList` (stairwell.js: [{id, side, line, from, to}], `from` / `to` in mm from the side's fixed
// corner, `to: null` = to the side's far end).
//
// Pure: takes the current list (stairwell.js stairwellWallList — a project without a list gets its per-side walls
// turned into one by the first edit) and returns a new one; never touches config.

import { MIN_WALL_LENGTH_MM, spanToFromTo, WELL_SIDES } from './stairwell.js';

const LINES = ['outer', 'inner'];

// The next free id `wall-<n>` (stable: never reused while the list has it).
function nextId(list) {
  let n = list.length + 1;
  const ids = new Set(list.map((w) => w.id));
  while (ids.has(`wall-${n}`)) n++;
  return `wall-${n}`;
}

// One wall made valid: a known side / line, `from` ≥ 0 whole mm, `to` null or at least MIN_WALL_LENGTH_MM past `from`.
export function sanitizeWall(w) {
  const side = WELL_SIDES.includes(w.side) ? w.side : 'A';
  const line = LINES.includes(w.line) ? w.line : 'outer';
  const from = Math.max(0, Math.round(Number(w.from) || 0));
  let to = w.to === null || w.to === undefined || w.to === '' || !Number.isFinite(Number(w.to)) ? null : Math.round(Number(w.to));
  if (to !== null && to < from + MIN_WALL_LENGTH_MM) to = from + MIN_WALL_LENGTH_MM;
  return { id: String(w.id), side, line, from, to };
}

/**
 * Applies one change to the wall list:
 *  - {action: 'add', side, line, from?, to?} — a new wall (default: the whole side);
 *  - {action: 'remove', id};
 *  - {action: 'set', id, side?, line?, from?, to?} — the panel's fields (`to: null` = to the far end);
 *  - {action: 'set-span', id, t0, t1, sideLength} — a dragged end: the stretch [t0, t1] mm from the side's start;
 *  - {action: 'clear'} — no walls at all.
 * @returns {{id, side, line, from, to}[]}
 */
export function applyWallEdit(list, change) {
  const walls = (Array.isArray(list) ? list : []).map(sanitizeWall);
  const at = walls.findIndex((w) => w.id === change?.id);
  switch (change?.action) {
    case 'add':
      return [...walls, sanitizeWall({ id: nextId(walls), side: change.side, line: change.line, from: change.from ?? 0, to: change.to ?? null })];
    case 'remove':
      return walls.filter((w) => w.id !== change.id);
    case 'set': {
      if (at < 0) return walls;
      const patch = {};
      for (const k of ['side', 'line', 'from', 'to']) if (k in change) patch[k] = change[k];
      walls[at] = sanitizeWall({ ...walls[at], ...patch });
      return walls;
    }
    case 'set-span': {
      if (at < 0) return walls;
      const len = Math.max(0, Number(change.sideLength) || 0);
      let t0 = Number(change.t0);
      let t1 = Number(change.t1);
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return walls;
      if (t1 - t0 < MIN_WALL_LENGTH_MM) {
        // (the end being dragged gives way: keep the other one where it is)
        if (change.end === 'a') t0 = t1 - MIN_WALL_LENGTH_MM;
        else t1 = t0 + MIN_WALL_LENGTH_MM;
      }
      walls[at] = sanitizeWall({ ...walls[at], ...spanToFromTo(walls[at].side, len, t0, t1) });
      return walls;
    }
    case 'clear':
      return [];
    default:
      return walls;
  }
}
