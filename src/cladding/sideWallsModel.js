// The walls of the module "Schody na beton" that follow the stair (user request 2026-11-04 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): per flight side a wall ABOVE the steps to a height (`walls[f][side] = {type: 'low',
// heightAboveMm}` — beside the stair, its top raked over the noses), a wall UNDER the flight (`{type: 'under'}` — under
// its edge, floor to the concrete's soffit, the side above stays open), and the WALL BETWEEN two flights set apart at a
// U landing (`gapWall` on the landing — the gap filled, up to the slab or `gapWallAboveMm` over the higher flight's
// noses; its two sides count as walled). The full walls beside the stair stay in surroundingsModel.js. Each wall here
// is a polygon in its own vertical plane (s along the flight, z up), as the finishing boards. Pure.

import { buildSideRuns, runPoint, runOutward } from './sideRuns.js';
import { rakedTop, dedupe } from './finishModel.js';
import { wallOn } from './surroundingsModel.js';
import { planPoint } from './concreteModel.js';

/** The config with the walls between flights set apart added as walled sides ('gap') — the cladding, the skirting and
 *  the balustrade then treat them as walls. A side the user gave its own wall keeps it. */
export function withGapWalls(concrete, config) {
  const gaps = concrete.elements.filter((e) => e.gap && config.sequence?.[e.groupIndex]?.gapWall);
  if (!gaps.length) return config;
  const walls = JSON.parse(JSON.stringify(config.walls || {}));
  for (const e of gaps) {
    for (const f of [e.gap.flightIn, e.gap.flightOut]) {
      walls[f] = walls[f] || {};
      if (!walls[f][e.gap.side]) walls[f][e.gap.side] = { type: 'gap' };
    }
  }
  return { ...config, walls };
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

/** @returns {{id, kind: 'wall-low' | 'wall-under' | 'wall-gap', key, polygon, origin, dir, normal, thicknessMm}[]} */
export function buildSideWalls(concrete, config) {
  const runs = buildSideRuns(concrete, config);
  const out = [];
  const T = config.wallThicknessMm;
  for (const run of runs) {
    const w = wallOn(run.key, config);
    const { pieces } = run;
    if (!w || !pieces.length) continue;
    const s0 = pieces[0].s0;
    const s1 = pieces[pieces.length - 1].s1;
    const outN = runOutward(run);
    if (w.type === 'low') {
      // beside the stair, from the floor up to its height over the noses (0 = up to the slab)
      const top = w.heightAboveMm > 0 ? rakedTop(pieces, w.heightAboveMm, (p) => p.top) : [{ s: s0, z: concrete.exit.rawSlabTopZ }, { s: s1, z: concrete.exit.rawSlabTopZ }];
      out.push({ id: `wall-low-${run.key.flight}-${run.key.side}`, kind: 'wall-low', key: run.key, polygon: dedupe([{ s: s0, z: 0 }, { s: s1, z: 0 }, ...[...top].reverse()]), origin: runPoint(run, 0), dir: run.frame.f, normal: outN, thicknessMm: T });
    } else if (w.type === 'under') {
      // under the flight's edge, its thickness under the stair, up to the concrete's soffit
      const soffit = dedupe(pieces.flatMap((p) => [{ s: p.s0, z: p.soffit.front }, { s: p.s1, z: p.soffit.back }]));
      out.push({ id: `wall-under-${run.key.flight}-${run.key.side}`, kind: 'wall-under', key: run.key, polygon: dedupe([{ s: s0, z: 0 }, { s: s1, z: 0 }, ...[...soffit].reverse()]), origin: runPoint(run, 0), dir: run.frame.f, normal: { x: -outN.x, y: -outN.y }, thicknessMm: T });
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
