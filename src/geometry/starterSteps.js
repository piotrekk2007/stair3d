// Starter steps (stopnie zapraszające) — user decisions 2026-10-20: the first 1–3 treads of flight A made wider, each
// on its own (outer / inner widening), their ends rounded (up to a full half circle) and optionally a bowed (arched)
// front; built as BLOCKS standing on the floor (the tread on top, a cladding round the exposed sides), the wangi start
// behind the last one and the start newel stands on it.
//
// Pure: plan geometry only (an outline per starter tread in the plan frame). planLayout.js applies it as its last
// layer (`tread.starter`, `tread.outline`); treadSolver.js (no nosing, no riser groove), riserSolver.js (no riser:
// the block's cladding takes its place), stringerSolver.js (the wangi start behind them), postSolver.js (the newel on
// the last block), railingSolver.js (a balustrade starts at the newel) and the renderers / takeoff read that.

import { signedPolygonArea } from './pathUtils.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

export const MAX_STARTER_STEPS = 3;
// Points per quarter circle of a rounded end, and along a bowed front (presentation / DXF smoothness).
const CORNER_SEGMENTS = 12;
const BOW_SEGMENTS = 24;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** How many starter steps the stair can have: the leading straight treads of flight A, at most 3. */
export function availableStarterSteps(treads) {
  let n = 0;
  while (n < MAX_STARTER_STEPS && treads[n] && treads[n].type === 'straight') n++;
  // the stair must go on past them (a flight of starter steps only is not a stair)
  return Math.min(n, Math.max(0, treads.length - 1));
}

/**
 * The starter steps the config asks for: `starterStepCount` (0..3) and per step k = 1..3
 * `starterStep{k}OuterMm` / `InnerMm` (widening past the outer / inner line), `RadiusMm` (the rounded ends; clamped
 * to a half circle of the step's depth, and on the back corner to the widening), `BowMm` (the front's sagitta, 0 =
 * straight). Clamped to what the plan allows (availableStarterSteps).
 * @returns {{index:number, outerMm:number, innerMm:number, radiusMm:number, bowMm:number}[]}
 */
export function starterStepSpecs(config, treads) {
  const count = Math.max(0, Math.min(Math.round(num(config.starterStepCount)), availableStarterSteps(treads)));
  const out = [];
  for (let i = 0; i < count; i++) {
    const k = i + 1;
    out.push({
      index: i,
      outerMm: Math.max(0, num(config[`starterStep${k}OuterMm`])),
      innerMm: Math.max(0, num(config[`starterStep${k}InnerMm`])),
      radiusMm: Math.max(0, num(config[`starterStep${k}RadiusMm`])),
      bowMm: Math.max(0, num(config[`starterStep${k}BowMm`])),
    });
  }
  return out;
}

// Quarter-circle points from angle a0 to a1 (radians) round `c`, in local (u, v).
function arcPoints(c, r, a0, a1, segments = CORNER_SEGMENTS) {
  const out = [];
  for (let s = 0; s <= segments; s++) {
    const a = a0 + ((a1 - a0) * s) / segments;
    out.push({ u: c.u + r * Math.cos(a), v: c.v + r * Math.sin(a) });
  }
  return out;
}

/**
 * The outline of one starter tread in the PLAN frame, with the same orientation as the tread's own outline.
 * Local frame: u across the stair from the inner line's front point toward the outer line's, v from the front back.
 * The block spans u ∈ [−inner, W + outer], v ∈ [0, D]; a widened end has its front and back corners rounded; a bow
 * pushes the front forward by a circular arc over the whole width (fading to nothing at the back edge, so the next
 * step still meets a straight edge).
 */
export function starterOutline(tread, spec) {
  // measured from the stair's own lines (the raw wanga lines — innerChain / outerChain), not from a tread edge the
  // housing recess pulled in: there is no wanga along a starter step, the widening is past the stair's width
  const fi = tread.innerChain?.[0] ?? tread.frontEdge[0];
  const fo = tread.outerChain?.[0] ?? tread.frontEdge[1];
  const bi = tread.innerChain?.[tread.innerChain.length - 1] ?? tread.backEdge[0];
  const uDir = unit(sub(fo, fi));
  // into the stair along the walk: perpendicular to the front edge, toward the back edge
  let vDir = { x: -uDir.y, y: uDir.x };
  if ((bi.x - fi.x) * vDir.x + (bi.y - fi.y) * vDir.y < 0) vDir = { x: -vDir.x, y: -vDir.y };
  const W = Math.hypot(fo.x - fi.x, fo.y - fi.y);
  const D = Math.max(1, (bi.x - fi.x) * vDir.x + (bi.y - fi.y) * vDir.y);
  const u0 = -spec.innerMm;
  const u1 = W + spec.outerMm;
  const half = D / 2;
  const rFront = (w) => (w > 0 ? Math.min(spec.radiusMm, half) : 0);
  const rBack = (w) => (w > 0 ? Math.min(spec.radiusMm, half, w) : 0);
  const rfi = rFront(spec.innerMm);
  const rfo = rFront(spec.outerMm);
  const rbi = rBack(spec.innerMm);
  const rbo = rBack(spec.outerMm);
  // going round: front (inner → outer), outer end, back (outer → inner), inner end — in (u, v)
  const pts = [];
  const corner = (cu, cv, r, a0, a1, fallback) => {
    if (r > 0) pts.push(...arcPoints({ u: cu, v: cv }, r, a0, a1));
    else pts.push(fallback);
  };
  const P = Math.PI;
  corner(u0 + rfi, rfi, rfi, P, 1.5 * P, { u: u0, v: 0 }); // front-inner: from the inner side up to the front
  if (spec.bowMm > 0) {
    for (let s = 1; s < BOW_SEGMENTS; s++) pts.push({ u: u0 + rfi + ((u1 - rfo - (u0 + rfi)) * s) / BOW_SEGMENTS, v: 0 });
  }
  corner(u1 - rfo, rfo, rfo, 1.5 * P, 2 * P, { u: u1, v: 0 }); // front-outer
  corner(u1 - rbo, D - rbo, rbo, 0, 0.5 * P, { u: u1, v: D }); // back-outer
  corner(u0 + rbi, D - rbi, rbi, 0.5 * P, P, { u: u0, v: D }); // back-inner
  // the bow: a circular arc of sagitta `bowMm` over the whole width, toward −v, fading linearly to 0 at the back
  if (spec.bowMm > 0) {
    const span = u1 - u0;
    const s = Math.min(spec.bowMm, span / 2);
    const R = (span * span) / 4 / (2 * s) + s / 2;
    const uc = (u0 + u1) / 2;
    for (const p of pts) {
      const dx = p.u - uc;
      const bulge = Math.max(0, Math.sqrt(Math.max(0, R * R - dx * dx)) - (R - s));
      p.v -= bulge * Math.max(0, 1 - p.v / D);
    }
  }
  let plan = pts.map((p) => ({ x: fi.x + uDir.x * p.u + vDir.x * p.v, y: fi.y + uDir.y * p.u + vDir.y * p.v }));
  // drop repeated points (a corner without rounding next to a bow sample)
  plan = plan.filter((p, i) => i === 0 || Math.hypot(p.x - plan[i - 1].x, p.y - plan[i - 1].y) > 1e-6);
  if (Math.hypot(plan[0].x - plan[plan.length - 1].x, plan[0].y - plan[plan.length - 1].y) < 1e-6) plan.pop();
  const own = tread.outline?.length >= 3 ? Math.sign(signedPolygonArea(tread.outline)) : 1;
  if (Math.sign(signedPolygonArea(plan)) !== own) plan.reverse();
  return { outline: plan, depthMm: D, widthMm: u1 - u0, frame: { origin: fi, uDir, vDir } };
}

/**
 * The plan layer: the starter treads get their block outline (`tread.outline`) and `tread.starter` =
 * { ...spec, depthMm, widthMm, exposedMm } — `exposedMm` = the length of the outline NOT along the back edge (the
 * block's visible sides: front, ends, the parts of the back past the next step).
 */
export function applyStarterSteps(treads, config) {
  const specs = starterStepSpecs(config, treads);
  if (!specs.length) return treads;
  return treads.map((tread, i) => {
    const spec = specs[i];
    if (!spec) return tread;
    const shape = starterOutline(tread, spec);
    const next = treads[i + 1];
    const nextWidth = next ? Math.hypot(next.frontEdge[1].x - next.frontEdge[0].x, next.frontEdge[1].y - next.frontEdge[0].y) : 0;
    let perimeter = 0;
    for (let k = 0; k < shape.outline.length; k++) {
      const a = shape.outline[k];
      const b = shape.outline[(k + 1) % shape.outline.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    // the stretch of the back edge the next block / step covers
    const exposedMm = Math.max(0, perimeter - nextWidth);
    return { ...tread, outline: shape.outline, starter: { ...spec, depthMm: shape.depthMm, widthMm: shape.widthMm, exposedMm, perimeterMm: perimeter } };
  });
}

/**
 * A starter step reaching into a stairwell wall (its widening on a side that runs along a wall): WARNING
 * `STARTER-INTO-WALL` with how far. `wallPieces` = stairwellWalls(...).pieces (inner face a→b, `outward`).
 */
export function starterWallDiagnostics(planLayout, wallPieces) {
  const out = [];
  for (const t of planLayout?.treads || []) {
    if (!t.starter) continue;
    let worst = 0;
    for (const w of wallPieces || []) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (!(len > 0)) continue;
      const d = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
      for (const p of t.outline) {
        const along = (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y;
        const into = (p.x - w.a.x) * w.outward.x + (p.y - w.a.y) * w.outward.y;
        if (along > 0 && along < len && into > worst) worst = into;
      }
    }
    if (worst > 1) {
      out.push(
        createDiagnostic({
          ruleId: 'STARTER-INTO-WALL',
          severity: 'WARNING',
          elementType: 'tread',
          elementId: `step-${t.index}`,
          parameter: `starterStep${t.index + 1}OuterMm`,
          value: Math.round(worst),
          unit: 'mm',
          message: `Stopień zapraszający ${t.index + 1} wchodzi ${Math.round(worst)} mm w ścianę klatki — zmniejsz jego poszerzenie po tej stronie albo skróć ścianę (zasięg ściany w folderze „3. Klatka schodowa”).`,
        })
      );
    }
  }
  return out;
}

/** The number of starter steps actually laid out (plan treads flagged `starter`). */
export function starterCount(planLayout) {
  let n = 0;
  while (planLayout?.treads?.[n]?.starter) n++;
  return n;
}
