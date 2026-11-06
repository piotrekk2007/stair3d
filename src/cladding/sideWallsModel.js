// The walls of the module "Schody na beton" that follow the stair (user request 2026-11-04 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): per flight side a wall ABOVE the steps to a height (`walls[f][side] = {type: 'low',
// heightAboveMm}` — beside the stair, its top raked over the noses), a wall UNDER the flight (`{type: 'under'}` — under
// its edge, floor to the concrete's soffit, the side above stays open), and the WALL BETWEEN two flights set apart at a
// U landing (`gapWall` on the landing — the gap filled, up to the slab or `gapWallAboveMm` over the higher flight's
// noses; its two sides count as walled). The full walls beside the stair stay in surroundingsModel.js. Each wall here
// is a polygon in its own vertical plane (s along the flight, z up), as the finishing boards. Pure.

import { buildSideRuns, runPoint, runOutward } from './sideRuns.js';
import { rakedTop, dedupe } from './finishModel.js';
import { planPoint } from './concreteModel.js';

/** The config with the walls between flights set apart added as walled sides ('gap') — the cladding, the skirting and
 *  the balustrade then treat them as walls. A side the user gave its own wall keeps it. */
export function withGapWalls(concrete, config) {
  const gaps = concrete.elements.filter((e) => e.gap && config.sequence?.[e.groupIndex]?.gapWall);
  if (!gaps.length) return config;
  // (list entries before the user's own — wallsOf: a later entry wins)
  const gapWalls = gaps.flatMap((e) => [e.gap.flightIn, e.gap.flightOut].map((f) => ({ id: `gap-${e.index}-${f}`, flight: f, side: e.gap.side, type: 'gap', from: null, to: null })));
  return { ...config, gapWalls };
}

// a raked top through a run's noses as a function of s (null outside it)
function topLine(pieces, h) {
  const pts = rakedTop(pieces, h, (p) => p.top);
  return (s) => {
    if (s < pts[0].s - 1e-6 || s > pts[pts.length - 1].s + 1e-6) return null;
    for (let k = 1; k < pts.length; k++) if (s <= pts[k].s + 1e-9) return pts[k - 1].z + ((pts[k].z - pts[k - 1].z) * (s - pts[k - 1].s)) / (pts[k].s - pts[k - 1].s || 1);
    return pts[pts.length - 1].z;
  };
}

/**
 * The pieces of one kind meeting end to end round a turn joined into one folded wall (user request 2026-11-06 — as the
 * full walls, surroundingsModel.js joinWallSegments: no seam, no gap at the corner, one body for the AI render too).
 * A body: its face line in plan (`path`, `cs` = the distance along it at each vertex), the extrusion direction per
 * segment (`normals`), the back line's corners mitred (`back`), and its bottom / top lines in (cs, z) — at a joint the
 * lower bottom and the higher top of the two. Its pieces carry `bodyId` (the 3D draws the body, the plan the pieces).
 */
export function joinSideWalls(pieces, T, eps = 5) {
  const end = (w, which) => {
    const ss = w.polygon.map((p) => p.s);
    const s = which === 'start' ? Math.min(...ss) : Math.max(...ss);
    return { x: w.origin.x + w.dir.x * s, y: w.origin.y + w.dir.y * s, s };
  };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < eps;
  const free = pieces.filter((w) => w.kind !== 'wall-gap' && w.bottom && w.top);
  const used = new Set();
  const bodies = [];
  for (const first of free) {
    if (used.has(first)) continue;
    // walk back to the chain's start, then forward
    let head = first;
    for (let guard = 0; guard < free.length; guard++) {
      const prev = free.find((w) => !used.has(w) && w !== head && w.kind === head.kind && near(end(w, 'end'), end(head, 'start')) && w.normal.x * head.normal.x + w.normal.y * head.normal.y > -0.5);
      if (!prev || prev === first) break;
      head = prev;
    }
    const chain = [head];
    used.add(head);
    for (let guard = 0; guard < free.length; guard++) {
      const tail = chain[chain.length - 1];
      const next = free.find((w) => !used.has(w) && w.kind === tail.kind && near(end(tail, 'end'), end(w, 'start')) && w.normal.x * tail.normal.x + w.normal.y * tail.normal.y > -0.5);
      if (!next) break;
      chain.push(next);
      used.add(next);
    }
    if (chain.length < 2) continue;
    const id = `body-${chain[0].id}`;
    const path = [end(chain[0], 'start')];
    const cs = [0];
    const normals = [];
    let bottom = [];
    let top = [];
    chain.forEach((w, k) => {
      const a = end(w, 'start');
      const b = end(w, 'end');
      const off = cs[cs.length - 1] - a.s;
      const shift = (line) => line.map((p) => ({ s: p.s + off, z: p.z }));
      const bw = shift(w.bottom);
      const tw = shift(w.top);
      if (k > 0) {
        // the joint: one value each side (the lower bottom, the higher top)
        const lb = bottom.pop();
        const lt = top.pop();
        bw[0] = { s: bw[0].s, z: Math.min(lb.z, bw[0].z) };
        tw[0] = { s: tw[0].s, z: Math.max(lt.z, tw[0].z) };
      }
      bottom = bottom.concat(bw);
      top = top.concat(tw);
      path.push({ x: b.x, y: b.y });
      cs.push(cs[cs.length - 1] + (b.s - a.s));
      normals.push(w.normal);
      w.bodyId = id;
    });
    const back = path.map((p, k) => {
      const n1 = normals[Math.max(0, k - 1)];
      const n2 = normals[Math.min(normals.length - 1, k)];
      const c = 1 + n1.x * n2.x + n1.y * n2.y;
      return { x: p.x + (T * (n1.x + n2.x)) / c, y: p.y + (T * (n1.y + n2.y)) / c };
    });
    bodies.push({ id, kind: chain[0].kind, ids: chain.map((w) => w.id), path: path.map(({ x, y }) => ({ x, y })), cs, normals, back, bottom, top, thicknessMm: T });
  }
  return bodies;
}

/** @returns {{id, kind: 'wall-low' | 'wall-above' | 'wall-under' | 'wall-gap', key, polygon, origin, dir, normal, thicknessMm}[]} */
export function buildSideWalls(concrete, config) {
  const runs = buildSideRuns(concrete, config);
  const out = [];
  const T = config.wallThicknessMm;
  for (const run of runs) {
    // (a run = a stretch of one side under one wall — sideRuns.js)
    const w = run.wall;
    const { pieces } = run;
    if (!w || !pieces.length) continue;
    const s0 = pieces[0].s0;
    const s1 = pieces[pieces.length - 1].s1;
    const outN = runOutward(run);
    if (w.type === 'low') {
      // beside the stair, from the floor up to its height over the noses (0 = up to the slab)
      const top = w.heightAboveMm > 0 ? rakedTop(pieces, w.heightAboveMm, (p) => p.top) : [{ s: s0, z: concrete.exit.rawSlabTopZ }, { s: s1, z: concrete.exit.rawSlabTopZ }];
      const bottom = [{ s: s0, z: 0 }, { s: s1, z: 0 }];
      out.push({ id: `wall-low-${run.id}`, kind: 'wall-low', key: run.key, polygon: dedupe([...bottom, ...[...top].reverse()]), bottom, top, origin: runPoint(run, 0), dir: run.frame.f, normal: outN, thicknessMm: T });
    } else if (w.type === 'above') {
      // beside the stair, from the concrete's soffit (nothing under the flight) up to the slab / its height over the
      // noses
      const soffit = dedupe(pieces.flatMap((p) => [{ s: p.s0, z: p.soffit.front }, { s: p.s1, z: p.soffit.back }]));
      const top = w.heightAboveMm > 0 ? rakedTop(pieces, w.heightAboveMm, (p) => p.top) : [{ s: s0, z: concrete.exit.rawSlabTopZ }, { s: s1, z: concrete.exit.rawSlabTopZ }];
      out.push({ id: `wall-above-${run.id}`, kind: 'wall-above', key: run.key, polygon: dedupe([...soffit, ...[...top].reverse()]), bottom: soffit, top, origin: runPoint(run, 0), dir: run.frame.f, normal: outN, thicknessMm: T });
    } else if (w.type === 'under') {
      // under the flight's edge, its thickness under the stair, up to the concrete's soffit
      const soffit = dedupe(pieces.flatMap((p) => [{ s: p.s0, z: p.soffit.front }, { s: p.s1, z: p.soffit.back }]));
      const bottom = [{ s: s0, z: 0 }, { s: s1, z: 0 }];
      out.push({ id: `wall-under-${run.id}`, kind: 'wall-under', key: run.key, polygon: dedupe([...bottom, ...[...soffit].reverse()]), bottom, top: soffit, origin: runPoint(run, 0), dir: run.frame.f, normal: { x: -outN.x, y: -outN.y }, thicknessMm: T });
    }
  }
  // the walls between flights set apart (in the incoming flight's frame: s = v, the return flight's s' = v0 − v)
  for (const e of concrete.elements) {
    const g = e.gap;
    const group = config.sequence?.[e.groupIndex];
    if (!g || !group?.gapWall) continue;
    const runA = runs.find((r) => r.key.flight === g.flightIn && r.key.side === g.side);
    const runC = runs.find((r) => r.key.flight === g.flightOut && r.key.side === g.side);
    const reachC = runC ? Math.max(...runC.pieces.map((p) => p.s1)) : 0;
    const vStart = Math.min(0, g.v0 - reachC);
    let top;
    if (group.gapWallTop === 'nose' && (runA || runC)) {
      const h = group.gapWallAboveMm;
      const zA = runA ? topLine(runA.pieces, h) : () => null;
      const zC = runC ? topLine(runC.pieces, h) : () => null;
      const at = new Set([vStart, g.v0]);
      for (const p of runA?.pieces || []) at.add(p.s0), at.add(p.s1);
      for (const p of runC?.pieces || []) at.add(g.v0 - p.s0), at.add(g.v0 - p.s1);
      top = [...at]
        .filter((v) => v >= vStart - 1e-6 && v <= g.v0 + 1e-6)
        .sort((a, b) => a - b)
        .map((v) => {
          const zs = [zA(v), zC(g.v0 - v)].filter((z) => z !== null);
          return { s: v, z: zs.length ? Math.max(...zs) : h };
        });
    } else {
      top = [{ s: vStart, z: concrete.exit.rawSlabTopZ }, { s: g.v0, z: concrete.exit.rawSlabTopZ }];
    }
    out.push({ id: `wall-gap-${e.index}`, kind: 'wall-gap', key: null, polygon: dedupe([{ s: vStart, z: 0 }, { s: g.v0, z: 0 }, ...[...top].reverse()]), origin: planPoint(e.frame, g.uFrom, 0), dir: e.frame.f, normal: e.frame.r, thicknessMm: g.widthMm });
  }
  return out;
}
