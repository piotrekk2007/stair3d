// The stairwell (klatka schodowa) as FIXED and FREE side lengths — the room-first designer, model v3 (user decisions
// 2026-10-16: "no drawn room; the important thing is which dimensions are rigid").
//
// A SIDE is one straight stretch of the stair's OUTER line (`planLayout.outerFullPath` — the outer face of the outer
// wanga, the wall line), exactly as geometry/stairwellFit.js outerSideLengths measures it (collinear pieces merged): A along flight A from the first front edge
// (no nosing) to the corner, B along flight B (L: to the last back edge; U: corner to corner — wall to wall), C along
// flight C from the corner to the last back edge (U). Each side the user gives is either FIXED (it must come out
// exactly — e.g. a U's B = wall to wall and C = wall to the slab edge) or FREE (it follows from the tread counts chosen
// for the riser: the entry line floats, so the entry and the exit need not be on one line). A side may also run along
// a WALL (`stairwellWall{A,B,C}`, the wanga face `stairwellWallGapMm` off it) — drawn in 2D and 3D, and what the
// ceiling opening is measured from.
//
// The WALL FRAME (`wellFrame`): x = the distance from wall A (across, along side B's direction; for a straight stair
// across the flight), y = the distance from the END wall (where side A ends — wall B for an L/U, the exit end for a
// straight stair) back toward the entry. A point fixed in the building keeps its frame coordinates when a free side
// changes, so the opening, given in this frame, stays put. (For a right-turning stair the frame is a mirror image of
// the plan frame; outlines are re-oriented where it matters.)
//
// Pure: no Three.js, no config mutation.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { inwardNormal } from './planLayout.js';
import { sideHand } from '../util/sideNames.js';

export const WELL_SIDES = Object.freeze(['A', 'B', 'C']);
// A fixed side within this of its dimension counts as met (mm).
export const WELL_TOLERANCE_MM = 1;
// Drawn thickness of the walls in 3D — presentation only (not part of the stair, not exported, not measured).
export const STAIRWELL_WALL_DRAWN_THICKNESS_MM = 120;

const SAME_DIRECTION_SIN = 1e-6;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** The sides a stair type has. */
export function wellSideLetters(stairType) {
  return stairType === 'U' || stairType === 'S' ? ['A', 'B', 'C'] : stairType === 'L' ? ['A', 'B'] : ['A'];
}

/** The side the stair ENDS on (its last back edge): the exit side. */
export function exitSideLetter(stairType) {
  return stairType === 'U' || stairType === 'S' ? 'C' : stairType === 'L' ? 'B' : 'A';
}

/** Whether the stairwell dimensions are on. */
export function wellEnabled(config) {
  return !!config?.stairwellRoomEnabled;
}

/** The fixed sides' dimensions: {A: mm|null, ...} for the sides this type has (null = free / not given). */
export function wellFixedTargets(config) {
  const out = {};
  for (const s of wellSideLetters(config.stairType)) {
    const v = Number(config[`stairwellSide${s}Mm`]);
    out[s] = config[`stairwellSide${s}Fixed`] && v > 0 ? v : null;
  }
  return out;
}

/** Whether side `s` runs along a wall in the per-side (legacy) fields (default: yes). */
export function sideHasWall(config, s) {
  return config[`stairwellWall${s}`] !== false;
}

// How far a side's wall reaches in the per-side (legacy) fields (user decision 2026-10-19): `stairwellWall{S}Extent` =
// 'full' (the whole side), 'start' (from the side's start — side A: the first front edge — `stairwellWall{S}LengthMm`
// along it, at most the whole side) or 'end' (back from the side's end — side A: the corner / end wall — that length;
// longer than the side = the wall goes on past its start, e.g. behind the entry).
export const WALL_EXTENTS = Object.freeze(['full', 'start', 'end']);
const WALL_EXTENT_EPS_MM = 0.5;
// The shortest wall the editor makes (mm).
export const MIN_WALL_LENGTH_MM = 50;

/** The legacy wall's stretch along side `s` of length `sideLength`: [from, to] in mm from the side's start. */
export function wallInterval(config, s, sideLength) {
  const extent = config[`stairwellWall${s}Extent`];
  const len = Math.max(0, Number(config[`stairwellWall${s}LengthMm`]) || 0);
  if (extent === 'start') return [0, Math.min(len, sideLength)];
  if (extent === 'end') return [sideLength - len, sideLength];
  return [0, sideLength];
}

// The line the per-side (legacy) walls stand along: the outer one, or an S's left / right (`stairwellWallHand`).
function legacyWallLine(config) {
  if (config?.stairType !== 'S' || (config.stairwellWallHand !== 'left' && config.stairwellWallHand !== 'right')) return 'outer';
  return sideHand('inner', config) === config.stairwellWallHand ? 'inner' : 'outer';
}

/**
 * The line the sides A / B / C are MEASURED along (their dimensions, the wall frame, the fit): the outer line — but an
 * S may be measured along the other one: `stairwellWallHand` 'left' | 'right' (walking up flight A), or by default the
 * line most of its walls stand along (an S has a dusza on each line).
 * @returns {'outer'|'inner'}
 */
export function stairwellMeasureLine(config) {
  if (config?.stairType !== 'S') return 'outer';
  if (config.stairwellWallHand === 'left' || config.stairwellWallHand === 'right') return legacyWallLine(config);
  if (!Array.isArray(config.stairwellWallList)) return 'outer';
  const count = (line) => config.stairwellWallList.filter((w) => w && w.line === line && WELL_SIDES.includes(w.side)).length;
  return count('inner') > count('outer') ? 'inner' : 'outer';
}

/** Whether some wall of the stairwell stands along the plan line `line` ('outer' | 'inner'). */
export function lineHasWall(config, line) {
  if (!wellEnabled(config)) return false;
  const letters = wellSideLetters(config.stairType);
  if (Array.isArray(config.stairwellWallList)) return config.stairwellWallList.some((w) => w && w.line === line && letters.includes(w.side));
  return legacyWallLine(config) === line && letters.some((s) => sideHasWall(config, s));
}

/**
 * Whether a balustrade on side `line` may go on as a wall handrail: there is a stairwell wall along that line — or,
 * with the stairwell off (no walls modelled), on the outer side, as before the wall editor.
 */
export function wallRailAllowed(config, line) {
  return wellEnabled(config) ? lineHasWall(config, line) : line === 'outer';
}

// The straight pieces of a plan line (collinear pieces merged): [{a, b, length, dir}].
function linePieces(planLayout, line) {
  const path = (line === 'inner' ? planLayout?.innerFullPath : planLayout?.outerFullPath) || [];
  const sides = [];
  for (let i = 1; i < path.length; i++) {
    const d = sub(path[i], path[i - 1]);
    const len = Math.hypot(d.x, d.y);
    if (len < 1e-9) continue;
    const dir = mul(d, 1 / len);
    const last = sides[sides.length - 1];
    if (last && Math.abs(last.dir.x * dir.y - last.dir.y * dir.x) < SAME_DIRECTION_SIN && dot(last.dir, dir) > 0) {
      last.b = path[i];
      last.length += len;
    } else sides.push({ a: path[i - 1], b: path[i], length: len, dir });
  }
  return sides;
}

const SAME_FLIGHT_DOT = 0.999;

/**
 * The sides A / B / C of one plan line ('outer' | 'inner'), BY DIRECTION: the line's straight pieces matched in order
 * to the flights' directions (A = the outer line's first piece, B = its second, C = −A for a U, A for an S). A flight
 * with no piece on this line (e.g. an S's inner line when the stair starts with winders) gets a zero-length side where
 * it would be. {A: {a, b, length, dir}, ...} for the sides the type has ({} for an empty plan).
 */
export function lineSides(planLayout, line, stairType) {
  const letters = wellSideLetters(stairType);
  const outer = linePieces(planLayout, 'outer');
  const pieces = line === 'outer' ? outer : linePieces(planLayout, line);
  if (!outer.length || !pieces.length) return {};
  const dA = outer[0].dir;
  const dirs = { A: dA, B: outer[1]?.dir || null, C: stairType === 'U' ? mul(dA, -1) : dA };
  const out = {};
  let k = 0;
  for (const piece of pieces) {
    const j = letters.findIndex((s, idx) => idx >= k && dirs[s] && dot(dirs[s], piece.dir) > SAME_FLIGHT_DOT);
    if (j < 0) continue;
    out[letters[j]] = { ...piece };
    k = j + 1;
  }
  // a flight with no piece: zero length where it would be (the end of the side before it, else the start of the next)
  letters.forEach((s, idx) => {
    if (out[s] || !dirs[s]) return;
    const before = letters.slice(0, idx).reverse().find((x) => out[x]);
    const after = letters.slice(idx + 1).find((x) => out[x]);
    const p = before ? out[before].b : after ? out[after].a : pieces[0].a;
    out[s] = { a: p, b: p, length: 0, dir: dirs[s] };
  });
  return out;
}

/**
 * The stairwell's walls in the list form (see the header): `config.stairwellWallList` as it is, or — without one —
 * the per-side fields turned into it (side lengths from the plan, so a partial legacy wall keeps its place).
 * @returns {{id, side, line, from:number, to:number|null}[]}
 */
export function stairwellWallList(config, planLayout) {
  const letters = wellSideLetters(config.stairType);
  if (Array.isArray(config.stairwellWallList)) return config.stairwellWallList.filter((w) => w && letters.includes(w.side) && (w.line === 'outer' || w.line === 'inner'));
  const line = legacyWallLine(config);
  const sides = planLayout ? lineSides(planLayout, line, config.stairType) : {};
  const out = [];
  for (const s of letters) {
    if (!sideHasWall(config, s)) continue;
    const extent = config[`stairwellWall${s}Extent`];
    if (extent !== 'start' && extent !== 'end') {
      out.push({ id: `wall-${s}`, side: s, line, from: 0, to: null });
      continue;
    }
    const len = sides[s]?.length ?? 0;
    const [t0, t1] = wallInterval(config, s, len);
    out.push({ id: `wall-${s}`, side: s, line, ...spanToFromTo(s, len, t0, t1) });
  }
  return out;
}

/** A wall's stretch [t0, t1] in mm from the start of its side (of length `length`), from its {from, to}. */
export function wallSpan(wall, side, length) {
  const from = Math.max(0, Number(wall.from) || 0);
  const to = wall.to === null || wall.to === undefined || wall.to === '' ? null : Number(wall.to);
  if (side === 'A') return [to === null ? 0 : length - to, length - from];
  return [from, to === null ? length : to];
}

/**
 * The inverse of wallSpan: [t0, t1] along a side of length `length` → {from, to}; the end at the side's FAR end (A: its
 * start, B / C: their end) within 0.5 mm becomes `to: null` (it follows the side).
 */
export function spanToFromTo(side, length, t0, t1) {
  if (side === 'A') return { from: Math.max(0, length - t1), to: Math.abs(t0) <= WALL_EXTENT_EPS_MM ? null : length - t0 };
  return { from: Math.max(0, t0), to: Math.abs(t1 - length) <= WALL_EXTENT_EPS_MM ? null : t1 };
}

/**
 * The wall frame (see the header) of a stair, or null when the stairwell is off.
 * @returns {{wall:true, origin, xDir, yDir, toRelative:(p)=>{x,y}, toPlan:(q)=>{x,y}, sides:Object, wallLines:{axis:'x'|'y', value:number}[]}|null}
 */
export function wellFrame(config, planLayout) {
  if (!wellEnabled(config) || !planLayout) return null;
  const line = stairwellMeasureLine(config);
  const sides = lineSides(planLayout, line, config.stairType);
  const A = sides.A;
  if (!A) return null;
  const origin = A.b; // the end of side A — the end wall's corner
  const yDir = mul(A.dir, -1); // back toward the entry
  // across: along side B for an L/U, else across the flight toward the inner line
  let xDir = sides.B?.dir;
  if (!xDir) {
    const inner = planLayout.innerFullPath?.[0];
    const toInner = inner ? sub(inner, A.a) : { x: 1, y: 0 };
    const n = { x: -A.dir.y, y: A.dir.x };
    xDir = dot(n, toInner) >= 0 ? n : mul(n, -1);
  }
  const toRelative = (p) => {
    const d = sub(p, origin);
    return { x: dot(d, xDir), y: dot(d, yDir) };
  };
  const toPlan = (q) => add(origin, add(mul(xDir, q.x), mul(yDir, q.y)));
  // the walls as lines of the frame (what the opening snaps to): each wall's inner face, as the line x = … (a wall
  // along y) or y = … (along x) — e.g. wall A at x = −gap, the end wall at y = −gap, a U's wall C at x = B + gap, an S's
  // at x = B − gap (taken from the walls themselves, so any side of any stair is right)
  const frame = { wall: true, origin, xDir, yDir, toRelative, toPlan, sides, wallLines: [], line };
  for (const w of wallSegments(config, planLayout)) {
    const along = sub(w.b, w.a);
    const p = toRelative(w.a);
    const across = Math.abs(dot(along, xDir)) < Math.abs(dot(along, yDir));
    frame.wallLines.push(across ? { axis: 'x', value: p.x } : { axis: 'y', value: p.y });
  }
  return frame;

}

const diag = (ruleId, severity, parameter, message, extra = {}) => createDiagnostic({ ruleId, severity, elementType: 'stair', elementId: null, parameter, message, ...extra });

/**
 * The stair measured against the stairwell: every side's length, a fixed side off its dimension reported.
 * @returns {{enabled:boolean, frame:Object|null, sides:{side, achieved, target, fixed, deviation}[], diagnostics:Object[]}}
 */
export function stairwellReport(config, planLayout) {
  const frame = wellFrame(config, planLayout);
  if (!frame) return { enabled: false, frame: null, sides: [], diagnostics: [] };
  const targets = wellFixedTargets(config);
  const sides = wellSideLetters(config.stairType).map((s) => {
    const achieved = frame.sides[s]?.length ?? null;
    const target = targets[s];
    return { side: s, achieved, target, fixed: target !== null, deviation: target !== null && achieved !== null ? achieved - target : null };
  });
  const diagnostics = sides
    .filter((s) => s.fixed && Math.abs(s.deviation) > WELL_TOLERANCE_MM)
    .map((s) =>
      diag('STAIRWELL-SIDE-FIXED', 'WARNING', `stairwellSide${s.side}Mm`, `Bok ${s.side} (sztywny) wychodzi ${Math.round(s.achieved)} mm zamiast ${s.target} mm (${s.deviation > 0 ? '+' : ''}${Math.round(s.deviation)} mm). Użyj „Szukaj wariantów schodów w klatce” albo zmień parametry.`, {
        value: Math.round(s.achieved),
        expected: s.target,
        unit: 'mm',
      }),
    );
  return { enabled: true, frame, sides, diagnostics };
}

// The plan segment of every wall (stairwellWallList): its side of its line moved `gap` outward (away from the stair)
// over the wall's stretch, lengthened at a corner it shares with a wall of the neighbouring side of the same line so
// the corners close. `span` = the stretch along the side itself (no gap, no corner lengthening — the editor's handles).
function wallSegments(config, planLayout) {
  const letters = wellSideLetters(config.stairType);
  const gap = Math.max(0, Number(config.stairwellWallGapMm) || 0);
  const handedness = planLayout.handedness ?? 1;
  const sidesOf = { outer: lineSides(planLayout, 'outer', config.stairType), inner: lineSides(planLayout, 'inner', config.stairType) };
  // each wall's stretch along its side, and whether it reaches the side's start / end (only there does it meet the
  // neighbouring side's wall in a closed corner)
  const walls = stairwellWallList(config, planLayout)
    .map((w) => {
      const side = sidesOf[w.line][w.side];
      if (!side || !(side.length > 0)) return null;
      const [t0, t1] = wallSpan(w, w.side, side.length);
      if (!(t1 - t0 > WALL_EXTENT_EPS_MM)) return null;
      return { wall: w, side, t0, t1, atStart: Math.abs(t0) <= WALL_EXTENT_EPS_MM, atEnd: Math.abs(t1 - side.length) <= WALL_EXTENT_EPS_MM };
    })
    .filter(Boolean);
  const neighbour = (w, step, atWhich) => {
    const i = letters.indexOf(w.wall.side) + step;
    if (i < 0 || i >= letters.length) return null;
    return walls.find((x) => x.wall.line === w.wall.line && x.wall.side === letters[i] && x[atWhich]) || null;
  };
  return walls.map((w) => {
    const { side, t0, t1 } = w;
    const line = w.wall.line;
    // outward = away from the stair: the opposite of "into the stair" from this line (planLayout.js inwardNormal)
    const n = mul(inwardNormal(side.dir, line, handedness), -1);
    const spanA = add(side.a, mul(side.dir, t0));
    const spanB = add(side.a, mul(side.dir, t1));
    let a = add(spanA, mul(n, gap));
    let b = add(spanB, mul(n, gap));
    const prev = w.atStart ? neighbour(w, -1, 'atEnd') : null;
    const next = w.atEnd ? neighbour(w, 1, 'atStart') : null;
    const prevWall = !!prev;
    const nextWall = !!next;
    // A corner where the line turns AWAY from the stair (every outer corner of an L / U) is convex: the walls run on
    // past it to meet; one where it turns TOWARD the stair (an S's B–C corner, a dusza) is concave: they stop short.
    const prevSign = prev && dot(mul(prev.side.dir, -1), n) > 0 ? -1 : 1;
    const nextSign = next && dot(next.side.dir, n) > 0 ? -1 : 1;
    if (prevWall) a = sub(a, mul(side.dir, gap * prevSign));
    if (nextWall) b = add(b, mul(side.dir, gap * nextSign));
    const partial = !(w.atStart && w.atEnd);
    return { id: w.wall.id, side: w.wall.side, line, a, b, spanA, spanB, t0, t1, sideLength: side.length, outward: n, prevWall, nextWall, prevSign, nextSign, partial, lengthMm: t1 - t0, dir: side.dir };
  });
}

/**
 * The walls and slab for the 3D view, in the PLAN frame: one piece per side along a wall (inner face a→b, extended by
 * the wall thickness at a corner shared with another wall, `outward`), up to the slab's underside; `slab` = the box
 * round the stair and its walls (in the wall frame) grown by the wall thickness. null without the stairwell.
 */
export function stairwellWalls(report, config, planLayout) {
  const frame = report?.frame;
  if (!frame || !planLayout) return null;
  const T = STAIRWELL_WALL_DRAWN_THICKNESS_MM;
  const height = Math.max(0, (Number(config.totalRise) || 0) - (Number(config.ceilingThickness) || 0));
  const pieces = wallSegments(config, planLayout).map((w) => {
    const dir = unit(sub(w.b, w.a));
    // (at a convex corner the wall runs on by its thickness to close it; at a concave one it ends short — the other
    // wall's box fills the corner from its own side)
    return { id: w.id, side: w.side, line: w.line, a: w.prevWall && w.prevSign > 0 ? sub(w.a, mul(dir, T)) : w.a, b: w.nextWall && w.nextSign > 0 ? add(w.b, mul(dir, T)) : w.b, outward: w.outward, thickness: T, height, partial: w.partial };
  });
  const pts = [...(planLayout.outerFullPath || []), ...(planLayout.innerFullPath || []), ...pieces.flatMap((p) => [p.a, p.b])].map(frame.toRelative);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - T, Math.max(...xs) + T, Math.min(...ys) - T, Math.max(...ys) + T];
  const slab = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map(frame.toPlan);
  return { pieces, slab };
}

// A tread's outer side counts as along a wall when at least this share of it is (the rest is open).
const OPEN_SIDE_COVERED_SHARE = 0.5;
// A wall piece this close (+ the wanga-to-wall gap) to a parallel piece of the outer line runs along it (mm).
const WALL_ALONG_TOL_MM = 30;

/**
 * Which treads stand along an OPEN stretch of the outer line (no wall beside them): one flag per plan tread, from its
 * `outerChain` and the walls' pieces (`stairwellWalls(...).pieces`). A tread with less than half its outer side along
 * a wall is open. Without walls (stairwell off) → null.
 */
export function treadsOpenOnOuterSide(planLayout, wallPieces, config, line = 'outer') {
  if (!Array.isArray(wallPieces)) return null;
  // (only the walls along this line — a wall beside the other line is across the stair)
  wallPieces = wallPieces.filter((w) => (w.line || 'outer') === line);
  const tol = WALL_ALONG_TOL_MM + Math.max(0, Number(config.stairwellWallGapMm) || 0);
  return (planLayout.treads || []).map((t) => {
    const chain = (line === 'inner' ? t.innerChain : t.outerChain) || [];
    let total = 0;
    let covered = 0;
    for (let k = 1; k < chain.length; k++) {
      const p = chain[k - 1];
      const q = chain[k];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1e-9) continue;
      total += len;
      const d = mul(sub(q, p), 1 / len);
      const spans = [];
      for (const w of wallPieces) {
        const wl = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        if (wl < 1e-9) continue;
        const wd = mul(sub(w.b, w.a), 1 / wl);
        if (Math.abs(d.x * wd.y - d.y * wd.x) > 0.02) continue; // not parallel
        const off = Math.abs((p.x - w.a.x) * wd.y - (p.y - w.a.y) * wd.x);
        if (off > tol) continue;
        const u0 = dot(sub(w.a, p), d);
        const u1 = dot(sub(w.b, p), d);
        const lo = Math.max(0, Math.min(u0, u1));
        const hi = Math.min(len, Math.max(u0, u1));
        if (hi > lo) spans.push([lo, hi]);
      }
      spans.sort((x, y) => x[0] - y[0]);
      let end = -Infinity;
      for (const [lo, hi] of spans) {
        const from = Math.max(lo, end);
        if (hi > from) covered += hi - from;
        end = Math.max(end, hi);
      }
    }
    return total > 0 && covered < OPEN_SIDE_COVERED_SHARE * total;
  });
}

/** Runs of consecutive open treads → balustrade sections on the outer side ({fromStep, toStep}, 0-based). */
export function openOuterRailingRanges(openFlags) {
  const out = [];
  (openFlags || []).forEach((open, i) => {
    if (!open) return;
    const last = out[out.length - 1];
    if (last && last.toStep === i - 1) last.toStep = i;
    else out.push({ fromStep: i, toStep: i });
  });
  return out;
}

/**
 * What the plan 2D draws of the stairwell (PLAN frame): the walls, and each side's dimension with its state.
 * @returns {{walls:{side,a,b,outward}[], dims:{side,a,b,value,fixed,target,ok}[]}|null}
 */
export function stairwellPlanDrawing(report, config, planLayout) {
  const frame = report?.frame;
  if (!frame || !planLayout) return null;
  const segments = wallSegments(config, planLayout);
  const walls = segments.map(({ id, side, line, a, b, spanA, spanB, t0, t1, sideLength, dir, outward, partial, lengthMm, prevWall, nextWall }) => ({ id, side, line, a, b, spanA, spanB, t0, t1, sideLength, dir, outward, partial, lengthMm, prevWall, nextWall }));
  // the wall editor's places for a new wall: every side of both lines (a line's side with no length has none)
  const gap = Math.max(0, Number(config.stairwellWallGapMm) || 0);
  const handedness = planLayout.handedness ?? 1;
  const candidates = [];
  for (const line of ['outer', 'inner']) {
    const sides = lineSides(planLayout, line, config.stairType);
    for (const s of wellSideLetters(config.stairType)) {
      const side = sides[s];
      if (!side || !(side.length > MIN_WALL_LENGTH_MM)) continue;
      const n = mul(inwardNormal(side.dir, line, handedness), -1);
      candidates.push({ side: s, line, a: add(side.a, mul(n, gap)), b: add(side.b, mul(n, gap)), outward: n, sideA: side.a, dir: side.dir, length: side.length });
    }
  }
  const dims = report.sides
    .filter((s) => frame.sides[s.side])
    .map((s) => {
      const seg = frame.sides[s.side];
      return { side: s.side, a: seg.a, b: seg.b, value: s.achieved, fixed: s.fixed, target: s.target, ok: !s.fixed || Math.abs(s.deviation) <= WELL_TOLERANCE_MM };
    });
  return { walls, dims, candidates };
}
