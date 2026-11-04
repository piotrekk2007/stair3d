// Finishing boards along the stair's sides (module "Schody na beton", stage 5 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): the SKIRTING BOARD on a walled side (listwa przyścienna — its bottom cut to the
// treads and risers, its top raked parallel to the noses or stepped with them) and the COVER STRINGER on an open side
// (wanga obiciowa — on the concrete's side face, from its soffit up to under the treads (stepped) or above the noses
// (raked)). Each board is a polygon in its own vertical plane (s along the flight, z up) placed by its run's line.
// Pure, no Three.js.

import { buildSideRuns, runPoint, runOutward } from './sideRuns.js';

const dedupe = (pts) => pts.filter((p, k) => k === 0 || Math.abs(p.s - pts[k - 1].s) > 1e-6 || Math.abs(p.z - pts[k - 1].z) > 1e-6);

// the board's blank in its plane: along its top line (first → last point of `top`) × across
function blank(polygon, top) {
  const a = top[0];
  const b = top[top.length - 1];
  const len = Math.hypot(b.s - a.s, b.z - a.z) || 1;
  const d = { s: (b.s - a.s) / len, z: (b.z - a.z) / len };
  const n = { s: -d.z, z: d.s };
  const us = polygon.map((p) => p.s * d.s + p.z * d.z);
  const vs = polygon.map((p) => p.s * n.s + p.z * n.z);
  return { lengthMm: Math.max(...us) - Math.min(...us), depthMm: Math.max(...vs) - Math.min(...vs) };
}

// a raked top: through every nose (a landing level along its length), `h` above, on to the run's end
function rakedTop(pieces, h, topOf) {
  const pts = [];
  for (const p of pieces) {
    pts.push({ s: p.s0, z: topOf(p) + h });
    if (p.flat) pts.push({ s: p.s1, z: topOf(p) + h });
  }
  const last = pieces[pieces.length - 1];
  pts.push({ s: last.s1, z: topOf(last) + h });
  return dedupe(pts);
}
const steppedTop = (pieces, h, topOf) => dedupe(pieces.flatMap((p) => [{ s: p.s0, z: topOf(p) + h }, { s: p.s1, z: topOf(p) + h }]));

function placed(run, id, kind, polygon, top, normal, thicknessMm, extra = {}) {
  return { id, kind, key: run.key, polygon, origin: runPoint(run, 0), dir: run.frame.f, normal, thicknessMm, ...blank(polygon, top), ...extra };
}

/** @returns {{skirting: object[], coverStringers: object[]}} */
export function buildFinishBoards(concrete, config) {
  const runs = buildSideRuns(concrete, config);
  const skirting = [];
  const coverStringers = [];
  for (const run of runs) {
    const { pieces } = run;
    if (!pieces.length) continue;
    const out = runOutward(run);
    if (run.walled && config.skirtingEnabled) {
      // the bottom cut to the finished treads and risers (a run beginning on a landing starts at its top)
      const bottom = [];
      let prev = pieces[0].flat ? pieces[0].top : pieces[0].below;
      for (const p of pieces) {
        bottom.push({ s: p.s0, z: prev }, { s: p.s0, z: p.top }, { s: p.s1, z: p.top });
        prev = p.top;
      }
      const top = (config.skirtingStyle === 'stepped' ? steppedTop : rakedTop)(pieces, config.skirtingHeightMm, (p) => p.top);
      const polygon = dedupe([...dedupe(bottom), ...[...top].reverse()]);
      // on the wall's face, its thickness into the stair
      skirting.push(placed(run, `skirting-${run.key.flight}-${run.key.side}`, 'skirting', polygon, top, { x: -out.x, y: -out.y }, config.skirtingThicknessMm, { style: config.skirtingStyle }));
    }
    if (!run.walled && config.coverStringers?.[run.key.flight]?.[run.key.side]) {
      // the bottom along the concrete's soffit, the top under the treads (stepped — the side nosing over it) or above
      // the noses (raked — the treads butt into it)
      const bottom = dedupe(pieces.flatMap((p) => [{ s: p.s0, z: p.soffit.front }, { s: p.s1, z: p.soffit.back }]));
      const raked = config.coverStringerTop === 'raked';
      const top = raked ? rakedTop(pieces, config.coverStringerAboveMm, (p) => p.top) : steppedTop(pieces, 0, (p) => p.concreteTop);
      const polygon = dedupe([...bottom, ...[...top].reverse()]);
      coverStringers.push(placed(run, `cover-${run.key.flight}-${run.key.side}`, 'cover-stringer', polygon, raked ? top : [top[0], top[top.length - 1]], out, config.coverStringerThicknessMm, { top: config.coverStringerTop }));
    }
  }
  return { skirting, coverStringers };
}
