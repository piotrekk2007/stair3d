// METAL STRUCTURE ("konstrukcja metalowa") — pure model, no Three.js. User decisions (2026-10-10):
//  * `stairConstruction: 'metal-profile'` — "wanga na profilu": ONE central beam or TWO beams under the treads (both
//    selectable, `metalBeamCount`, two beams `metalBeamSetbackMm` from the tread's sides). The beam is a STRAIGHT
//    closed steel profile per plan run; every tread stands on its own SUPPORT welded on the beam (a horizontal plate
//    under the tread + a web down to the beam);
//  * `stairConstruction: 'metal-flat'` — "wanga na płaskowniku": TWO flat bars at the sides, cut in TEETH (a zig-zag
//    top and the same zig-zag below); the treads lie on the teeth.
// No wooden wangi, no structural posts and no risers in either (buildStaircase.js; like the cantilever stair).
//
// Every section size here is a parameter with a placeholder default — DO WERYFIKACJI (CO-MFG-J-METAL): the steel is
// NOT structurally checked by this program.
//
// One plan LINE per member row: the stair's outer and inner lines (planLayout.outerFullPath / innerFullPath) are
// parallel, so a line `d` mm from one of them is the point-by-point blend of the two. Along a line every tread owns
// the stretch between its FINAL front edge and the next tread's — the line is cut into those stretches once
// (`treadStretches`) and both variants are built from them.
//
// Members are plain prisms: a side outline in (u = mm along the plan piece, v = elevation), extruded across the
// piece from `nFrom` to `nTo` (mm along `normal`). Renderer, takeoff and DXF read only that.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { cleanPolygon, polygonArea } from './polygonClip.js';

export const METAL_CONSTRUCTIONS = Object.freeze({ PROFILE: 'metal-profile', FLAT: 'metal-flat' });
export const STEEL_DENSITY_KG_M3 = 7850; // structural steel, the usual handbook value

const STRETCH_MIN_MM = 1; // a shorter stretch of a tread on a plan piece is ignored
const SUPPORT_MARGIN_MM = 20; // the support plate ends this far inside its tread's stretch
const SUPPORT_MIN_LENGTH_MM = 40; // a shorter support is not made on that plan piece
const FAR_MM = 20000; // "far beyond the piece" for the flat bar's ends before clipping
const LP_EPS = 1e-6;

export function isMetal(config) {
  return config?.stairConstruction === METAL_CONSTRUCTIONS.PROFILE || config?.stairConstruction === METAL_CONSTRUCTIONS.FLAT;
}

const pos = (v, def) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : def);

export function metalParams(config = {}) {
  return {
    beamCount: Math.round(pos(config.metalBeamCount, 1)) >= 2 ? 2 : 1,
    beamSetbackMm: pos(config.metalBeamSetbackMm, 150),
    beamWidthMm: Math.max(1, pos(config.metalBeamWidthMm, 100)),
    beamHeightMm: Math.max(1, pos(config.metalBeamHeightMm, 200)),
    beamWallMm: Math.max(0.5, pos(config.metalBeamWallMm, 5)),
    supportPlateThicknessMm: Math.max(1, pos(config.metalSupportPlateThicknessMm, 8)),
    supportPlateWidthMm: Math.max(1, pos(config.metalSupportPlateWidthMm, 300)),
    supportClearanceMm: pos(config.metalSupportClearanceMm, 0),
    supportMaxHeightMm: pos(config.metalSupportMaxHeightMm, 400),
    flatThicknessMm: Math.max(1, pos(config.metalFlatThicknessMm, 12)),
    flatNeckMm: Math.max(10, pos(config.metalFlatNeckMm, 120)),
    flatSetbackMm: pos(config.metalFlatSetbackMm, 30),
  };
}

/**
 * The config every solver sees for a metal stair: open (no risers) and both sides treated like an overlay stringer
 * side — the treads are not recessed and the balusters stand on the treads.
 */
export function metalConfig(fullConfig) {
  if (!isMetal(fullConfig)) return fullConfig;
  return { ...fullConfig, hasRiserBoards: false, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cross = (a, b) => a.x * b.y - a.y * b.x;

/** The plan line `distanceMm` from the `from` side's line towards the other side. null when the two lines do not pair. */
export function planLineAt(planLayout, from, distanceMm, stairWidthMm) {
  const a = from === 'outer' ? planLayout.outerFullPath : planLayout.innerFullPath;
  const b = from === 'outer' ? planLayout.innerFullPath : planLayout.outerFullPath;
  if (!a || !b || a.length !== b.length || a.length < 2 || !(stairWidthMm > 0)) return null;
  const t = distanceMm / stairWidthMm;
  const points = a.map((p, i) => lerp(p, b[i], t));
  const pieces = [];
  let station = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const d = sub(points[k + 1], points[k]);
    const length = Math.hypot(d.x, d.y);
    if (!(length > STRETCH_MIN_MM)) return null;
    const dir = { x: d.x / length, y: d.y / length };
    pieces.push({ index: k, start: points[k], dir, normal: { x: -dir.y, y: dir.x }, length, station });
    station += length;
  }
  return { points, pieces, length: station };
}

// Station (mm along the line) where the edge a-b crosses it. The first piece is extended backwards and the last
// forwards, so an edge moved past the line's end still gets a station.
function stationOfEdge(line, a, b) {
  const e = sub(b, a);
  const last = line.pieces.length - 1;
  for (const piece of line.pieces) {
    const den = cross(piece.dir, e);
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, piece.start);
    const u = cross(w, e) / den;
    const t = cross(w, piece.dir) / den;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    if ((piece.index > 0 && u < -1e-6) || (piece.index < last && u > piece.length + 1e-6)) continue;
    // |tan| of the edge's skew to the piece's square cut: how far the edge runs along the piece per mm across it
    const along = Math.abs(e.x * piece.dir.x + e.y * piece.dir.y);
    const across = Math.abs(cross(piece.dir, e));
    return { station: piece.station + u, skew: across > 1e-9 ? along / across : 0 };
  }
  return null;
}

/**
 * Cuts the line into the stretches of the treads: per plan piece `[{treadIndex, a, b, skewA, skewB, bottom, top}]`
 * (a, b local mm along the piece). null when an edge does not cross the line.
 */
export function treadStretches(line, treadModels) {
  if (!line || treadModels.length === 0) return null;
  const edges = [...treadModels.map((t) => t.frontEdge.final), treadModels[treadModels.length - 1].backEdge.final];
  const cuts = [];
  for (const [a, b] of edges) {
    const cut = stationOfEdge(line, a, b);
    if (!cut) return null;
    cuts.push({ station: Math.max(cut.station, cuts.length ? cuts[cuts.length - 1].station : -Infinity), skew: cut.skew });
  }
  const last = line.pieces.length - 1;
  return line.pieces.map((piece) => {
    const lo = piece.index === 0 ? -Infinity : piece.station;
    const hi = piece.index === last ? Infinity : piece.station + piece.length;
    const stretches = [];
    treadModels.forEach((t, i) => {
      const a = Math.max(cuts[i].station, lo);
      const b = Math.min(cuts[i + 1].station, hi);
      if (b - a < STRETCH_MIN_MM) return;
      stretches.push({ treadIndex: i, stepId: t.stepId, a: a - piece.station, b: b - piece.station, skewA: a === cuts[i].station ? cuts[i].skew : 0, skewB: b === cuts[i + 1].station ? cuts[i + 1].skew : 0, bottom: t.elevation.bottom, top: t.elevation.top });
    });
    return stretches;
  });
}

// --- a tiny LP: maximise c·x subject to A·x <= b, by trying every vertex (x has at most a handful of entries) -------

function solveSquare(rows, rhs) {
  const n = rows.length;
  const m = rows.map((r, i) => [...r, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-10) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

export function maximizeLinear(objective, constraints) {
  const n = objective.length;
  let best = null;
  const pick = [];
  const visit = (from) => {
    if (pick.length === n) {
      const x = solveSquare(pick.map((i) => constraints[i].row), pick.map((i) => constraints[i].rhs));
      if (!x) return;
      for (const c of constraints) if (c.row.reduce((s, v, i) => s + v * x[i], 0) > c.rhs + LP_EPS) return;
      const value = objective.reduce((s, v, i) => s + v * x[i], 0);
      if (!best || value > best.value + LP_EPS) best = { x, value };
      return;
    }
    for (let i = from; i < constraints.length; i++) {
      pick.push(i);
      visit(i + 1);
      pick.pop();
    }
  };
  visit(0);
  return best ? best.x : null;
}

// The lower convex hull of points (u, z): a straight line is below every point exactly when it is below these.
function lowerHull(points) {
  const sorted = [...points].sort((p, q) => p.u - q.u || p.z - q.z).filter((p, i, all) => i === 0 || p.u - all[i - 1].u > 1e-9);
  const hull = [];
  for (const p of sorted) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      if ((b.u - a.u) * (p.z - a.z) - (b.z - a.z) * (p.u - a.u) <= 1e-9) hull.pop();
      else break;
    }
    hull.push(p);
  }
  return hull;
}

// Keeps the part of a polygon where value(p) >= 0 (one straight cut).
function cutPolygon(poly, value) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const vp = value(p);
    const vq = value(q);
    if (vp >= 0) out.push(p);
    if ((vp > 0 && vq < 0) || (vp < 0 && vq > 0)) {
      const t = vp / (vp - vq);
      out.push({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
    }
  }
  return out;
}

const tidy = (outline) => cleanPolygon(outline.map((p) => ({ x: p.u, y: p.v }))).map((p) => ({ u: p.x, v: p.y }));
const outlineArea = (outline) => Math.abs(polygonArea(outline.map((p) => ({ x: p.u, y: p.v }))));
const boundsOf = (outline) => ({
  uMin: Math.min(...outline.map((p) => p.u)),
  uMax: Math.max(...outline.map((p) => p.u)),
  vMin: Math.min(...outline.map((p) => p.v)),
  vMax: Math.max(...outline.map((p) => p.v)),
});

function member(fields, piece, outline, nFrom, nTo) {
  const b = boundsOf(outline);
  return { ...fields, origin: piece.start, dir: piece.dir, normal: piece.normal, outline, nFrom, nTo, bounds: b, areaMm2: outlineArea(outline) };
}

// --- variant 1: straight beams + a support under every tread ----------------------------------------------------

function buildBeamRow(rowId, side, line, perPiece, params, diagnostics) {
  const members = [];
  const tp = params.supportPlateThicknessMm;
  const half = params.beamWidthMm / 2;
  const last = line.pieces.length - 1;
  // every piece's own range along itself (the first starts at the first front edge, the last ends at the last back edge)
  const ranges = line.pieces.map((piece, k) => {
    const s = perPiece[k];
    return { uA: k === 0 && s.length ? s[0].a : 0, uB: k === last && s.length ? s[s.length - 1].b : piece.length };
  });
  // node heights h[0..K]: the beam's TOP at each end of each piece; continuous at plan corners. The top must stay
  // below every tread's support plate — over the tread's stretch widened by what a skew edge adds across the beam.
  const n = line.pieces.length + 1;
  const constraints = [];
  const guards = [];
  const objective = new Array(n).fill(0);
  line.pieces.forEach((piece, k) => {
    const { uA, uB } = ranges[k];
    const span = uB - uA;
    if (!(span > STRETCH_MIN_MM)) return;
    const points = [];
    for (const s of perPiece[k]) {
      const z = s.bottom - tp - params.supportClearanceMm;
      points.push({ u: Math.max(uA, s.a - half * s.skewA), z }, { u: Math.min(uB, s.b + half * s.skewB), z });
      const mid = ((s.a + s.b) / 2 - uA) / span;
      objective[k] += 1 - mid;
      objective[k + 1] += mid;
    }
    for (const p of lowerHull(points)) {
      const t = (p.u - uA) / span;
      const row = new Array(n).fill(0);
      row[k] = 1 - t;
      row[k + 1] += t;
      constraints.push({ row, rhs: p.z });
    }
    const rising = new Array(n).fill(0); // a beam never runs downhill
    rising[k] = 1;
    rising[k + 1] = -1;
    guards.push({ row: rising, rhs: 0 });
  });
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    row[i] = -1;
    guards.push({ row, rhs: 1e5 });
  }
  // The treads alone bound the goal (every tread's middle lies between two of its own points), so the guards are
  // tried only when the treads' answer breaks one of them — the search grows fast with the number of rows.
  let h = maximizeLinear(objective, constraints);
  if (!h || guards.some((g) => g.row.reduce((sum, v, i) => sum + v * h[i], 0) > g.rhs + LP_EPS)) h = maximizeLinear(objective, [...constraints, ...guards]);
  if (!h) {
    diagnostics.push(createDiagnostic({ ruleId: 'METAL-LAYOUT', severity: 'WARNING', elementType: 'stringer', elementId: rowId, message: `Konstrukcja metalowa, ${rowId}: nie udało się wyznaczyć prostej belki pod stopniami — belka nie została narysowana.` }));
    return { members, supported: new Set() };
  }
  const supported = new Set();
  line.pieces.forEach((piece, k) => {
    const { uA, uB } = ranges[k];
    const span = uB - uA;
    if (!(span > STRETCH_MIN_MM)) return;
    const slope = (h[k + 1] - h[k]) / span;
    const top = (u) => h[k] + slope * (u - uA);
    // at a plan corner each beam runs half a beam width past the corner, so the two fill the corner (mitre weld)
    const from = k === 0 ? uA : uA - half;
    const to = k === last ? uB : uB + half;
    const drop = params.beamHeightMm * Math.hypot(1, slope); // the section's height measured plumb
    const outline = tidy(cutPolygon([{ u: from, v: top(from) }, { u: to, v: top(to) }, { u: to, v: top(to) - drop }, { u: from, v: top(from) - drop }], (p) => p.v));
    if (outline.length >= 3) {
      const lengthMm = (to - from) * Math.hypot(1, slope);
      const steelMm2 = 2 * params.beamWallMm * (params.beamWidthMm + params.beamHeightMm - 2 * params.beamWallMm);
      members.push({
        ...member({ id: `${rowId}-beam-${k}`, kind: 'beam', rowId, side, pieceIndex: k }, piece, outline, -half, half),
        lengthMm,
        slopeDeg: (Math.atan(slope) * 180) / Math.PI,
        section: { widthMm: params.beamWidthMm, heightMm: params.beamHeightMm, wallMm: params.beamWallMm },
        massKg: (steelMm2 * lengthMm * STEEL_DENSITY_KG_M3) / 1e9,
        reachesFloor: top(from) - drop <= 0,
      });
    }
    for (const s of perPiece[k]) {
      const a = s.a + half * s.skewA + SUPPORT_MARGIN_MM;
      const b = s.b - half * s.skewB - SUPPORT_MARGIN_MM;
      if (b - a < SUPPORT_MIN_LENGTH_MM) continue;
      supported.add(s.treadIndex);
      const under = s.bottom - tp;
      const id = `${rowId}-support-${s.stepId}-${k}`;
      const plateWidth = params.supportPlateWidthMm;
      members.push({
        ...member({ id: `${id}-plate`, kind: 'support-plate', rowId, side, pieceIndex: k, treadIndex: s.treadIndex, stepId: s.stepId }, piece, [{ u: a, v: under }, { u: b, v: under }, { u: b, v: s.bottom }, { u: a, v: s.bottom }], -plateWidth / 2, plateWidth / 2),
        lengthMm: b - a,
        widthMm: plateWidth,
        thicknessMm: tp,
        massKg: ((b - a) * plateWidth * tp * STEEL_DENSITY_KG_M3) / 1e9,
      });
      // (where the beam's top is still below the floor, the web stands on the floor)
      const web = tidy(cutPolygon([{ u: a, v: Math.min(top(a), under) }, { u: b, v: Math.min(top(b), under) }, { u: b, v: under }, { u: a, v: under }], (p) => p.v));
      const heightMm = under - Math.max(0, Math.min(top(a), under));
      if (web.length >= 3 && heightMm > 0.5) {
        members.push({
          ...member({ id: `${id}-web`, kind: 'support-web', rowId, side, pieceIndex: k, treadIndex: s.treadIndex, stepId: s.stepId }, piece, web, -half, half),
          lengthMm: b - a,
          heightMm,
          // cut from the beam's own profile: the mass of its two side walls and the front one, as a fair estimate
          massKg: (outlineArea(web) * 2 * params.beamWallMm * STEEL_DENSITY_KG_M3) / 1e9,
        });
        if (params.supportMaxHeightMm > 0 && heightMm > params.supportMaxHeightMm + 0.5) {
          diagnostics.push(createDiagnostic({ ruleId: 'METAL-SUPPORT-HEIGHT', severity: 'WARNING', elementType: 'tread', elementId: s.stepId, parameter: 'metalSupportMaxHeightMm', value: Math.round(heightMm), expected: `<= ${params.supportMaxHeightMm}`, unit: 'mm', message: `Konstrukcja metalowa, ${rowId}: podpora stopnia ${s.treadIndex + 1} ma ${Math.round(heightMm)} mm wysokości (więcej niż ${params.supportMaxHeightMm} mm) — prosta belka odchodzi tu daleko od stopni (zabieg / podest).` }));
        }
      }
    }
  });
  return { members, supported };
}

// --- variant 2: a flat bar cut in teeth --------------------------------------------------------------------------

function distanceToPolyline(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const l2 = du * du + dv * dv;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / l2)) : 0;
    best = Math.min(best, Math.hypot(a.u + du * t - p.u, a.v + dv * t - p.v));
  }
  return best;
}

const shift = (line, d) => line.map((p) => ({ u: p.u + d.u, v: p.v + d.v }));
const gapBetween = (top, bottom) => Math.min(...top.map((p) => distanceToPolyline(p, bottom)), ...bottom.map((p) => distanceToPolyline(p, top)));

/**
 * The toothed plate of one plan piece: the top follows the treads' undersides (level under each tread, plumb at each
 * next front edge); the bottom is the SAME line moved square to the pitch, as far as leaves `neckMm` of steel at the
 * narrowest place. Ends plumb; the foot (`toFloor`) is cut along the floor.
 */
export function toothedPlateOutline(stretches, uA, uB, neckMm, { toFloor = false } = {}) {
  if (stretches.length === 0 || !(uB - uA > STRETCH_MIN_MM)) return null;
  const first = stretches[0];
  const lastS = stretches[stretches.length - 1];
  const pitch = Math.atan2(lastS.bottom - first.bottom, Math.max(lastS.a - first.a, 1e-9));
  // Beyond the piece the line just carries on (cut off plumb below): level — or, at the stair's foot, down along the
  // pitch, so the bar's front edge runs plumb from the first tread to the floor.
  const top = [toFloor ? { u: uA - FAR_MM * Math.cos(pitch), v: first.bottom - FAR_MM * Math.sin(pitch) } : { u: uA - FAR_MM, v: first.bottom }];
  for (const s of stretches) top.push({ u: s.a, v: s.bottom }, { u: s.b, v: s.bottom });
  top.push({ u: uB + FAR_MM, v: lastS.bottom });
  const dirOf = (w) => ({ u: w * Math.sin(pitch), v: -w * Math.cos(pitch) });
  // the gap grows with the shift: bisect for the shift that leaves exactly the neck
  let lo = neckMm;
  let hi = neckMm + 2000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (gapBetween(top, shift(top, dirOf(mid))) < neckMm) lo = mid;
    else hi = mid;
  }
  const bottom = shift(top, dirOf(hi));
  let outline = [...top, ...bottom.reverse()];
  outline = cutPolygon(outline, (p) => p.u - uA);
  outline = cutPolygon(outline, (p) => uB - p.u);
  outline = cutPolygon(outline, (p) => p.v);
  outline = tidy(outline);
  return outline.length >= 3 ? { outline, shiftMm: hi, pitchDeg: (pitch * 180) / Math.PI } : null;
}

function buildFlatRow(rowId, side, line, perPiece, params) {
  const members = [];
  const supported = new Set();
  const last = line.pieces.length - 1;
  const half = params.flatThicknessMm / 2;
  line.pieces.forEach((piece, k) => {
    const s = perPiece[k];
    if (s.length === 0) return;
    const uA = k === 0 ? s[0].a : 0;
    const uB = k === last ? s[s.length - 1].b : piece.length;
    const plate = toothedPlateOutline(s, uA, uB, params.flatNeckMm, { toFloor: k === 0 });
    if (!plate) return;
    for (const x of s) supported.add(x.treadIndex);
    const base = member({ id: `${rowId}-plate-${k}`, kind: 'plate', rowId, side, pieceIndex: k }, piece, plate.outline, -half, half);
    members.push({
      ...base,
      thicknessMm: params.flatThicknessMm,
      neckMm: params.flatNeckMm,
      pitchDeg: plate.pitchDeg,
      blank: { lengthMm: base.bounds.uMax - base.bounds.uMin, heightMm: base.bounds.vMax - base.bounds.vMin },
      // the stretches the treads lie on (for the drawing): [{treadIndex, a, b, v}]
      bearings: s.map((x) => ({ treadIndex: x.treadIndex, stepId: x.stepId, a: x.a, b: x.b, v: x.bottom })),
      massKg: (base.areaMm2 * params.flatThicknessMm * STEEL_DENSITY_KG_M3) / 1e9,
    });
  });
  return { members, supported };
}

/**
 * @param {{planLayout: Object, treadModels: Object[]}} models
 * @param {Object} config  the full config (metalConfig applied)
 * @returns {null | {kind, params, rows: Array<{id, side, distanceMm}>, members: Object[], totalMassKg: number, diagnostics: Object[]}}
 */
export function buildMetalStructure({ planLayout, treadModels }, config) {
  if (!isMetal(config)) return null;
  const params = metalParams(config);
  const kind = config.stairConstruction;
  const width = config.stairWidth;
  const diagnostics = [];
  const rows =
    kind === METAL_CONSTRUCTIONS.FLAT
      ? [
          { id: 'flat-outer', side: 'outer', from: 'outer', distanceMm: params.flatSetbackMm + params.flatThicknessMm / 2 },
          { id: 'flat-inner', side: 'inner', from: 'inner', distanceMm: params.flatSetbackMm + params.flatThicknessMm / 2 },
        ]
      : params.beamCount === 2
        ? [
            { id: 'beam-outer', side: 'outer', from: 'outer', distanceMm: params.beamSetbackMm },
            { id: 'beam-inner', side: 'inner', from: 'inner', distanceMm: params.beamSetbackMm },
          ]
        : [{ id: 'beam-centre', side: 'centre', from: 'outer', distanceMm: width / 2 }];
  const members = [];
  const supportedBy = treadModels.map(() => 0);
  for (const row of rows) {
    if (row.distanceMm > width / 2 + 1e-6) {
      diagnostics.push(createDiagnostic({ ruleId: 'METAL-LAYOUT', severity: 'WARNING', elementType: 'stringer', elementId: row.id, value: Math.round(row.distanceMm), expected: `<= ${Math.round(width / 2)}`, unit: 'mm', message: `Konstrukcja metalowa, ${row.id}: odsunięcie od boku stopnia (${Math.round(row.distanceMm)} mm) przekracza połowę szerokości biegu — element pominięty.` }));
      continue;
    }
    const line = planLineAt(planLayout, row.from, row.distanceMm, width);
    const perPiece = treadStretches(line, treadModels);
    if (!perPiece) {
      diagnostics.push(createDiagnostic({ ruleId: 'METAL-LAYOUT', severity: 'WARNING', elementType: 'stringer', elementId: row.id, message: `Konstrukcja metalowa, ${row.id}: nie udało się rozłożyć stopni wzdłuż linii elementu — element pominięty.` }));
      continue;
    }
    const built = kind === METAL_CONSTRUCTIONS.FLAT ? buildFlatRow(row.id, row.side, line, perPiece, params) : buildBeamRow(row.id, row.side, line, perPiece, params, diagnostics);
    members.push(...built.members);
    for (const i of built.supported) supportedBy[i]++;
  }
  const needed = rows.length;
  treadModels.forEach((t, i) => {
    if (supportedBy[i] >= needed) return;
    diagnostics.push(createDiagnostic({ ruleId: 'METAL-SUPPORT-MISSING', severity: 'WARNING', elementType: 'tread', elementId: t.stepId, value: supportedBy[i], expected: needed, message: `Konstrukcja metalowa: stopień ${i + 1} ma podparcie na ${supportedBy[i]} z ${needed} elementów stalowych (za krótki odcinek stopnia nad elementem).` }));
  });
  diagnostics.push(createDiagnostic({ ruleId: 'METAL-UNVERIFIED', severity: 'INFO', elementType: 'stair', elementId: 'stair', message: 'Konstrukcja metalowa: przekroje stali, podpory i zamocowania są ORIENTACYJNE — program ich nie oblicza. Do weryfikacji przez konstruktora (CO-MFG-J-METAL).' }));
  return { kind, params, rows: rows.map(({ id, side, distanceMm }) => ({ id, side, distanceMm })), members, totalMassKg: members.reduce((s, m) => s + (m.massKg || 0), 0), diagnostics };
}
