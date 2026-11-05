// Finishing boards along the stair's sides (module "Schody na beton", stage 5 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): the SKIRTING BOARD on a walled side (listwa przyścienna — its bottom cut to the
// treads and risers, its top raked parallel to the noses or stepped with them) and the COVER STRINGER on an open side
// (wanga obiciowa — on the concrete's side face, from its soffit up to under the treads (stepped) or above the noses
// (raked)). Each board is a polygon in its own vertical plane (s along the flight, z up) placed by its run's line; a
// STEPPED skirting is made of parts (horizontal + vertical pieces, mitred, notched for the noses — `parts`).
// Pure, no Three.js.

import { buildSideRuns, runPoint, runOutward } from './sideRuns.js';
import { riserOn, riserThicknessOf } from './claddingModel.js';

export const dedupe = (pts) => pts.filter((p, k) => k === 0 || Math.abs(p.s - pts[k - 1].s) > 1e-6 || Math.abs(p.z - pts[k - 1].z) > 1e-6);

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
export function rakedTop(pieces, h, topOf) {
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

/** Every polygon of a board in its plane: a stepped skirting's parts, else the board itself. */
export const boardPolygons = (b) => (b.parts ? b.parts.map((p) => p.polygon) : [b.polygon]);

/**
 * A STEPPED skirting as the joiners make it (user request 2026-11-05): a HORIZONTAL piece lying on every tread /
 * landing and a VERTICAL piece standing in front of every riser (the riser board's face, or the concrete's face without
 * riser boards), the board `H` wide, mitred at 45° where they meet — at the stair's inner corner (tread × riser) and at
 * the outer corner (over the nose: the mitre from the band's outer corner (F − H, top + H) to (F, top)) — and in the
 * vertical piece a NOTCH for the tread's nose (its overhang `nosingFrontMm` × the tread's thickness). A nose reaching
 * past the board (overhang ≥ H) leaves no mitre there: the vertical piece ends level under the nose, the horizontal one
 * starts square over it at F − H. The first piece from the floor (or the tread before the run) has a level bottom cut; a
 * run that ends at the stair's exit gets a vertical piece in front of the exit riser up to the floor above + H (notched
 * for the antresola nosing), else the last horizontal piece ends square. Each part a polygon in the run's plane
 * ({s, z}, CCW) with its blank (length along its grain × H).
 */
function steppedSkirtingParts(run, concrete, config, { joinedStart = false } = {}) {
  const H = config.skirtingHeightMm;
  const n = config.nosingFrontMm;
  const r = riserThicknessOf(config);
  // the levels: consecutive pieces at one height merged (two landing pieces, …)
  const levels = [];
  for (const p of run.pieces) {
    const last = levels[levels.length - 1];
    if (last && Math.abs(last.top - p.top) < 1e-6) last.s1 = p.s1;
    else levels.push({ s0: p.s0, s1: p.s1, top: p.top, under: p.concreteTop, first: p, lastPiece: p });
    levels[levels.length - 1].lastPiece = p;
  }
  // the riser face in front of a level (where its own riser board stands, else the concrete's front)
  const face = (lv) => lv.s0 - (riserOn(lv.first.element, config) ? r : 0);
  const els = concrete.elements;
  const exitEl = els[els.length - 1];
  const floorAbove = concrete.exit.rawSlabTopZ + config.floorFinishTopMm;
  const parts = [];
  const vertical = (F, bottom, top, notch) => {
    // bottom: 'level' at z, or a mitre with the horizontal piece below at its top `zb`
    const pts = [];
    if (bottom.level !== undefined) pts.push({ s: F - H, z: bottom.level }, { s: F, z: bottom.level });
    else pts.push({ s: F - H, z: bottom.mitre + H }, { s: F, z: bottom.mitre });
    const nn = Math.min(notch.overhang, H);
    if (notch.overhang >= H - 1e-6) {
      // the nose covers the whole board: ends level under it
      pts.push({ s: F, z: notch.under }, { s: F - H, z: notch.under });
    } else {
      pts.push({ s: F, z: notch.under }, { s: F - nn, z: notch.under }, { s: F - nn, z: notch.top });
      if (top.level !== undefined) pts.push({ s: F, z: notch.top }, { s: F, z: top.level }, { s: F - H, z: top.level });
      else pts.push({ s: F, z: notch.top }, { s: F - H, z: notch.top + H });
    }
    return dedupe(pts);
  };
  levels.forEach((lv, j) => {
    const prev = levels[j - 1] || null;
    const next = levels[j + 1] || null;
    const F = face(lv);
    // (a run going on round a wall corner from the previous one at the same height starts like a landing — no riser)
    const riserHere = !!prev || (!lv.first.flat && !joinedStart && !lv.first.cutStart);
    // the vertical piece in front of this level's riser
    if (riserHere) {
      const notch = { overhang: n, under: lv.under, top: lv.top };
      parts.push({ part: 'vertical', polygon: vertical(F, prev ? { mitre: prev.top } : { level: lv.first.below }, {}, notch), notch: n < H - 1e-6 ? { widthMm: n, heightMm: lv.top - lv.under } : null });
    }
    // the horizontal piece on it: its front mitred with the riser's piece (square at F − H under a long nose / square
    // at the run's start), its back mitred with the next riser's piece (square at the run's end)
    const nextF = next ? face(next) : null;
    const isExit = !next && lv.lastPiece.element === exitEl && !lv.lastPiece.cutEnd; // (a wall ending part-way: square there)
    const exitF = isExit ? lv.s1 - (config.riserBoards ? r : 0) : null;
    const backF = nextF ?? exitF;
    const front = !riserHere ? [{ s: lv.s0, z: lv.top }, null, { s: lv.s0, z: lv.top + H }] : n >= H - 1e-6 ? [{ s: F - H, z: lv.top }, null, { s: F - H, z: lv.top + H }] : [{ s: F, z: lv.top }, null, { s: F - H, z: lv.top + H }];
    const back = backF !== null ? [{ s: backF, z: lv.top }, { s: backF - H, z: lv.top + H }] : [{ s: lv.s1, z: lv.top }, { s: lv.s1, z: lv.top + H }];
    parts.push({ part: 'horizontal', polygon: dedupe([front[0], back[0], back[1], front[2]]) });
    // the stair's exit: the piece in front of the exit riser up to the floor above + H, notched for the antresola nosing
    if (isExit && floorAbove > lv.top + 1) {
      const nosed = config.exitNosing;
      const notch = nosed ? { overhang: n, under: floorAbove - config.treadThicknessMm, top: floorAbove } : { overhang: 0, under: floorAbove, top: floorAbove };
      parts.push({ part: 'vertical', exit: true, polygon: vertical(exitF, { mitre: lv.top }, { level: floorAbove + H }, notch), notch: nosed && n < H - 1e-6 ? { widthMm: n, heightMm: config.treadThicknessMm } : null });
    }
  });
  // each part's blank: along its grain (horizontal: s, vertical: z) × the board's width
  return parts.map((p, k) => {
    const ss = p.polygon.map((q) => q.s);
    const zs = p.polygon.map((q) => q.z);
    const along = p.part === 'horizontal' ? Math.max(...ss) - Math.min(...ss) : Math.max(...zs) - Math.min(...zs);
    const across = p.part === 'horizontal' ? Math.max(...zs) - Math.min(...zs) : Math.max(...ss) - Math.min(...ss);
    return { ...p, id: `${p.part === 'horizontal' ? 'h' : 'v'}${String(k + 1).padStart(2, '0')}`, lengthMm: along, depthMm: across };
  });
}

/** @returns {{skirting: object[], coverStringers: object[]}} */
export function buildFinishBoards(concrete, config) {
  const runs = buildSideRuns(concrete, config);
  const skirting = [];
  const coverStringers = [];
  // the wall corners at a turn (user request 2026-11-05): a skirted run ending where the next one starts (its wall's
  // end on the other wall's line) — both boards cut through their thickness there (cornerCuts below); the next one going
  // on at the same height starts without a riser piece
  const skirted = config.skirtingEnabled ? runs.filter((r) => r.walled && r.pieces.length) : [];
  const endOf = (r) => runPoint(r, r.pieces[r.pieces.length - 1].s1);
  const startOf = (r) => runPoint(r, r.pieces[0].s0);
  const joins = [];
  for (const a of skirted) for (const b of skirted) if (a !== b && Math.hypot(endOf(a).x - startOf(b).x, endOf(a).y - startOf(b).y) < 1) joins.push({ a, b });
  const joinedStart = new Set(joins.filter((j) => Math.abs(j.a.pieces[j.a.pieces.length - 1].top - j.b.pieces[0].top) < 1e-6).map((j) => j.b));
  for (const run of runs) {
    const { pieces } = run;
    if (!pieces.length) continue;
    const out = runOutward(run);
    if (run.walled && config.skirtingEnabled && config.skirtingStyle === 'stepped') {
      // stepped: horizontal + vertical pieces mitred at 45°, notched for the noses (steppedSkirtingParts)
      const parts = steppedSkirtingParts(run, concrete, config, { joinedStart: joinedStart.has(run) });
      skirting.push({ id: `skirting-${run.id}`, kind: 'skirting', key: run.key, polygon: null, parts, origin: runPoint(run, 0), dir: run.frame.f, normal: { x: -out.x, y: -out.y }, thicknessMm: config.skirtingThicknessMm, lengthMm: parts.reduce((s, p) => s + p.lengthMm, 0), depthMm: config.skirtingHeightMm, style: 'stepped' });
    } else if (run.walled && config.skirtingEnabled) {
      // the bottom cut to the finished treads and risers (a run beginning on a landing starts at its top)
      const bottom = [];
      let prev = pieces[0].flat || joinedStart.has(run) || pieces[0].cutStart ? pieces[0].top : pieces[0].below;
      for (const p of pieces) {
        bottom.push({ s: p.s0, z: prev }, { s: p.s0, z: p.top }, { s: p.s1, z: p.top });
        prev = p.top;
      }
      const top = (config.skirtingStyle === 'stepped' ? steppedTop : rakedTop)(pieces, config.skirtingHeightMm, (p) => p.top);
      const polygon = dedupe([...dedupe(bottom), ...[...top].reverse()]);
      // on the wall's face, its thickness into the stair
      skirting.push(placed(run, `skirting-${run.id}`, 'skirting', polygon, top, { x: -out.x, y: -out.y }, config.skirtingThicknessMm, { style: config.skirtingStyle }));
    }
    if (!run.walled && config.coverStringers?.[run.key.flight]?.[run.key.side]) {
      // the bottom along the concrete's soffit, the top under the treads (stepped — the side nosing over it) or above
      // the noses (raked — the treads butt into it)
      const bottom = dedupe(pieces.flatMap((p) => [{ s: p.s0, z: p.soffit.front }, { s: p.s1, z: p.soffit.back }]));
      const raked = config.coverStringerTop === 'raked';
      const top = raked ? rakedTop(pieces, config.coverStringerAboveMm, (p) => p.top) : steppedTop(pieces, 0, (p) => p.concreteTop);
      const polygon = dedupe([...bottom, ...[...top].reverse()]);
      coverStringers.push(placed(run, `cover-${run.id}`, 'cover-stringer', polygon, raked ? top : [top[0], top[top.length - 1]], out, config.coverStringerThicknessMm, { top: config.coverStringerTop }));
    }
  }
  cornerCuts(joins, skirting);
  return { skirting, coverStringers };
}

/**
 * The corner cut of two skirting boards meeting at a wall corner: each board's end there cut through its thickness so
 * that the two meet on the corner's bisector (a 90° corner: 45°) — at the wall's face the board reaches the corner, at its
 * face toward the stair it is `k` × its thickness longer / shorter (k < 0 an inside corner, k > 0 an outside one).
 * `board.corners = {start?, end?: {s, k, angleDeg}}` (s = the board's end in its plane); the renderer shears the
 * board's end vertices by k × their depth, the plan draws the cut, the DXF notes it.
 */
function cornerCuts(joins, skirting) {
  const dot = (u, v) => u.x * v.x + u.y * v.y;
  const boardOf = (run) => skirting.find((b) => b.id === `skirting-${run.id}`);
  const ends = (b) => {
    const ss = boardPolygons(b).flat().map((p) => p.s);
    return { min: Math.min(...ss), max: Math.max(...ss) };
  };
  for (const { a, b } of joins) {
    const A = boardOf(a);
    const B = boardOf(b);
    if (!A || !B) continue;
    const dA = a.frame.f;
    const dB = b.frame.f;
    const across = dot(dA, B.normal);
    if (Math.abs(across) < 0.2) continue; // (walls in line — nothing to cut)
    const c = 1 - dot(A.normal, B.normal);
    const kA = c / across;
    const kB = c / dot(dB, A.normal);
    const angleDeg = Math.round((Math.atan(Math.abs(kA)) * 180) / Math.PI);
    const eA = ends(A);
    const eB = ends(B);
    // (only where the board's end is at the corner — a vertical piece standing short of it is left as it is)
    if (Math.abs(eA.max - a.pieces[a.pieces.length - 1].s1) < 1) A.corners = { ...A.corners, end: { s: eA.max, k: kA, angleDeg } };
    if (Math.abs(eB.min - b.pieces[0].s0) < 1) B.corners = { ...B.corners, start: { s: eB.min, k: kB, angleDeg } };
  }
}
