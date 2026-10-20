// Starter steps (stopnie zapraszające) — user decisions 2026-10-20 (second version: no blocks): ANY straight tread can
// be marked as a starter step in the Inspektor (selected on the plan 2D) and then
//   - widened to the LEFT and / or to the RIGHT (as seen walking up), measured from the stair's line on that side;
//   - its widened end(s) rounded (up to a half circle of the tread's depth);
//   - its front (czoło) bowed — a circular arc of the given sagitta over the whole width;
//   - given its own riser board, or none (`riser`), independent of the stair's riser boards — a bent riser following
//     the bowed front and wrapping the rounded end(s).
// The wangi and posts are NOT changed here (the next step redesigns the wanga's run round such a tread).
//
// `config.manualStarterTreads = { [treadIndex]: { leftMm, rightMm, radiusMm, bowMm, riser } }`.
//
// Pure: plan geometry only. planLayout.js applies it as its LAST layer (`tread.starter`, `tread.outline` = the tread
// WITH its nosing, final); treadSolver.js keeps that outline (no nosing added, no riser groove); riserSolver.js builds
// the riser from `tread.starter.riserPath`.

import { signedPolygonArea } from './pathUtils.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

const CORNER_SEGMENTS = 12; // points per quarter circle of a rounded end
const BOW_SEGMENTS = 24; // points along a bowed front

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** Cleans `manualStarterTreads`: non-negative numbers, `riser` a boolean. */
export function sanitizeStarterTreads(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, e] of Object.entries(raw)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || !e || typeof e !== 'object') continue;
    out[index] = {
      leftMm: Math.max(0, num(e.leftMm)),
      rightMm: Math.max(0, num(e.rightMm)),
      radiusMm: Math.max(0, num(e.radiusMm)),
      bowMm: Math.max(0, num(e.bowMm)),
      riser: e.riser === true,
    };
  }
  return out;
}

/** The default spec of a tread just marked as a starter step (the Inspektor's first click). */
export function defaultStarterSpec(config) {
  return { leftMm: 0, rightMm: 200, radiusMm: 150, bowMm: 0, riser: !!config?.hasRiserBoards };
}

/** Only an ordinary straight tread can be a starter step. */
export function canBeStarter(tread) {
  return tread?.type === 'straight' && !tread.winderInfo;
}

// Quarter-circle points from angle a0 to a1 (radians) round `c`, in local (u, v).
function arcPoints(c, r, a0, a1) {
  const out = [];
  for (let s = 0; s <= CORNER_SEGMENTS; s++) {
    const a = a0 + ((a1 - a0) * s) / CORNER_SEGMENTS;
    out.push({ u: c.u + r * Math.cos(a), v: c.v + r * Math.sin(a) });
  }
  return out;
}

// The shape in local (u across, LEFT → RIGHT as seen walking up; v back from the front edge), as an ordered point list
// starting on the back edge at the left end and ending on the back edge at the right end (closing it = the back
// edge). `grow` moves the front and the widened ends outward (the nosing past the riser line).
function localShape({ uL, uR, D, wL, wR, radiusMm, bowMm, grow }) {
  const half = D / 2;
  const rf = (w) => (w > 0 ? Math.min(radiusMm, half) : 0);
  const rb = (w) => (w > 0 ? Math.min(radiusMm, half, w) : 0);
  const gL = wL > 0 ? grow : 0;
  const gR = wR > 0 ? grow : 0;
  const P = Math.PI;
  const pts = [];
  const corner = (centre, r, g, a0, a1, fallback) => {
    if (r > 0) pts.push(...arcPoints(centre, r + g, a0, a1));
    else pts.push(fallback);
  };
  const rfl = rf(wL);
  const rfr = rf(wR);
  // a back corner grown by the nosing ends `grow` further forward on the end: kept short enough not to run past the
  // front corner's arc (a half-circle end stays one arc)
  const rbl = Math.min(rb(wL), Math.max(0, D - gL - rfl));
  const rbr = Math.min(rb(wR), Math.max(0, D - gR - rfr));
  // back-left (from the back edge down the left end), front-left, [front], front-right, back-right (to the back edge)
  // (a back corner grows sideways only: its centre moves forward by the growth, so the arc still ends ON the back edge)
  corner({ u: uL + rbl, v: D - rbl - gL }, rbl, gL, 0.5 * P, P, { u: uL - gL, v: D });
  corner({ u: uL + rfl, v: rfl }, rfl, grow, P, 1.5 * P, { u: uL - gL, v: -grow });
  if (bowMm > 0) {
    const a = uL + rfl;
    const b = uR - rfr;
    for (let s = 1; s < BOW_SEGMENTS; s++) pts.push({ u: a + ((b - a) * s) / BOW_SEGMENTS, v: -grow });
  }
  corner({ u: uR - rfr, v: rfr }, rfr, grow, 1.5 * P, 2 * P, { u: uR + gR, v: -grow });
  corner({ u: uR - rbr, v: D - rbr - gR }, rbr, gR, 0, 0.5 * P, { u: uR + gR, v: D });
  // the bow: a circular arc of sagitta `bowMm` over the whole width, toward −v, fading linearly to 0 at the back edge
  if (bowMm > 0) {
    const span = uR - uL;
    const s = Math.min(bowMm, span / 2);
    const R = (span * span) / 4 / (2 * s) + s / 2;
    const uc = (uL + uR) / 2;
    for (const p of pts) {
      const dx = p.u - uc;
      const bulge = Math.max(0, Math.sqrt(Math.max(0, R * R - dx * dx)) - (R - s));
      p.v -= bulge * Math.max(0, Math.min(1, 1 - p.v / D));
    }
  }
  return pts.filter((p, i) => i === 0 || Math.hypot(p.u - pts[i - 1].u, p.v - pts[i - 1].v) > 1e-6);
}

/**
 * The starter tread's geometry in the PLAN frame: `outline` (the tread with its nosing, same orientation as the
 * tread's own outline) and `riserPath` (the riser's face line: the front at the front edge, wrapping a widened end to
 * the back edge; on a side not widened it starts at the front corner). Local frame: u LEFT → RIGHT walking up, v from
 * the front edge back. A widened side starts from the stair's line there (the raw wanga line); a side not widened keeps
 * the tread's own end (the housing recess).
 */
export function starterGeometry(tread, spec, nosingMm = 0) {
  const ci = tread.innerChain?.[0] ?? tread.frontEdge[0];
  const co = tread.outerChain?.[0] ?? tread.frontEdge[1];
  const bi = tread.innerChain?.[tread.innerChain.length - 1] ?? tread.backEdge[0];
  const across = unit(sub(co, ci));
  let vDir = { x: -across.y, y: across.x };
  if (dot(sub(bi, ci), vDir) < 0) vDir = { x: -vDir.x, y: -vDir.y };
  const uDir = { x: vDir.y, y: -vDir.x }; // to the RIGHT of the walk
  const origin = ci;
  const toLocal = (p) => ({ u: dot(sub(p, origin), uDir), v: dot(sub(p, origin), vDir) });
  const D = Math.max(1, dot(sub(bi, ci), vDir));
  const lineU = [toLocal(ci).u, toLocal(co).u];
  const ownU = (tread.outline?.length ? tread.outline : [ci, co]).map((p) => toLocal(p).u);
  const wL = spec.leftMm;
  const wR = spec.rightMm;
  const uL = wL > 0 ? Math.min(...lineU) - wL : Math.min(...ownU);
  const uR = wR > 0 ? Math.max(...lineU) + wR : Math.max(...ownU);
  const params = { uL, uR, D, wL, wR, radiusMm: spec.radiusMm, bowMm: spec.bowMm };
  const toPlan = (p) => ({ x: origin.x + uDir.x * p.u + vDir.x * p.v, y: origin.y + uDir.y * p.u + vDir.y * p.v });
  let outline = localShape({ ...params, grow: nosingMm }).map(toPlan);
  if (Math.hypot(outline[0].x - outline[outline.length - 1].x, outline[0].y - outline[outline.length - 1].y) < 1e-6) outline.pop();
  const own = tread.outline?.length >= 3 ? Math.sign(signedPolygonArea(tread.outline)) : 1;
  if (Math.sign(signedPolygonArea(outline)) !== own) outline = outline.reverse();
  // the riser's face: the shape without the nosing; a side not widened starts at its front corner (no wrap)
  let face = localShape({ ...params, grow: 0 });
  if (!(wR > 0)) face = face.slice(0, face.length - 1);
  if (!(wL > 0)) face = face.slice(1);
  // which wanga side each widening is on (the inner line is on the left when its u is the smaller)
  const innerLeft = toLocal(ci).u <= toLocal(co).u;
  const widened = { inner: (innerLeft ? wL : wR) > 0, outer: (innerLeft ? wR : wL) > 0 };
  return { outline, riserPath: face.map(toPlan), depthMm: D, widthMm: uR - uL, widened, frame: { origin, uDir, vDir } };
}

/**
 * The plan layer: every marked straight tread gets its starter outline (`tread.outline`, with the nosing) and
 * `tread.starter = { ...spec, riserPath, depthMm, widthMm }`.
 */
export function applyStarterSteps(treads, config) {
  const specs = sanitizeStarterTreads(config.manualStarterTreads);
  if (!Object.keys(specs).length) return treads;
  return treads.map((tread) => {
    const spec = specs[tread.index];
    if (!spec || !canBeStarter(tread)) return tread;
    const g = starterGeometry(tread, spec, Math.max(0, num(config.nosing)));
    return { ...tread, outline: g.outline, starter: { ...spec, riserPath: g.riserPath, depthMm: g.depthMm, widthMm: g.widthMm, widened: g.widened } };
  });
}

/** Whether a starter tread is widened past the wanga on this side ('inner' | 'outer') — it then LIES ON that wanga. */
export function starterLiesOn(tread, side) {
  return !!tread?.starter?.widened?.[side];
}

/**
 * The start newel on a starter step (user decision 2026-10-20): when the stair STARTS with starter steps widened on
 * the inner (dusza) side, the newel stands on the last of them — the index of that tread, or -1.
 */
export function starterNewelTread(planLayout) {
  let k = -1;
  while (starterLiesOn(planLayout?.treads?.[k + 1], 'inner')) k++;
  return k;
}

/**
 * A starter step reaching into a stairwell wall: WARNING `STARTER-INTO-WALL` with how far. `wallPieces` =
 * stairwellWalls(...).pieces (inner face a→b, `outward`).
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
          parameter: 'manualStarterTreads',
          value: Math.round(worst),
          unit: 'mm',
          message: `Stopień zapraszający ${t.index + 1} wchodzi ${Math.round(worst)} mm w ścianę klatki — zmniejsz jego poszerzenie po tej stronie albo skróć ścianę (zasięg ściany w folderze „3. Klatka schodowa”).`,
        })
      );
    }
  }
  return out;
}
