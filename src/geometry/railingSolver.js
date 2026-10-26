// RailingModel — plain-data description of the balustrade (handrail + balusters + end posts), fully
// independent of Three.js (railingRenderer.js is the ONLY consumer that builds meshes). See
// docs/architecture/RAILING_MODEL.md for the plan and the decisions behind it.
//
// The balustrade DEPENDS on the treads and the wangi, never the other way round (RULES.md #6): it reads
// the solved plan layout / tread models / stringer models + construction geometry and existing posts, and
// changes none of them.
//
// A balustrade is a list of SECTIONS (`config.railingSections`): { id, side, fromStep, toStep } — one
// balustrade on one side from tread `fromStep` to tread `toStep` (0-based tread indices, the same
// numbering as `step-N`; `toStep: null` = up to the last tread). A stair can therefore have a balustrade
// that starts at the 3rd step, on one flight only, or on one side only.
//
// Geometry (all mm, plan x/y + world elevation z):
//  * path: the wanga's own reference line (the tread chains, corners included) on that side, from the FRONT
//    of tread `fromStep` to the BACK of tread `toStep`, offset sideways (mitred at corners) to the wanga's
//    centre line (`railingLateralOffsetMm`, default half the wanga thickness, toward the stair interior — the
//    way the wanga board extrudes).
//  * heights: the "nosing line" runs through the tread tops, rising one riser height per tread across a
//    straight or winder tread and staying LEVEL across a landing: z(front of tread i) = (i+1)*riserHeight,
//    z(back of tread i) = (i+2)*riserHeight (a landing: (i+1)*riserHeight). The handrail's TOP sits
//    `railingHeightMm` above that line.
//  * RUNS: a handrail is a chain of straight pieces that ends in a post wherever the balustrade cannot
//    continue as one piece — a corner in plan (> RAILING_CORNER_ANGLE_DEG), a step in height (the line
//    jumps up where a flight starts after a landing) or a piece that is practically vertical (RAILING_STEEP_ANGLE_DEG,
//    e.g. the dusza of a very tight winder). A merely steep piece stays a handrail piece. Each such spot gets ONE post (an existing
//    structural post is reused when it stands there) and the two handrail runs meet it at their own heights
//    — the "łamana z prostych odcinków" of the plan, not a bent handrail. Runs shorter than a post are
//    dropped (the neighbouring joins merge into one post).
//  * housed wanga (`closed`): per run, balusters are spread evenly along the handrail and stand on the
//    wanga's top edge — the spacing is whatever keeps every clear opening <= `railingMaxClearMm`.
//  * overlay wanga (`cut`): balusters stand on the treads with the SAME rhythm on every tread (k per tread,
//    evenly spread over that tread's own chain, k from the clear-opening limit), so each tread carries them
//    identically and their heights differ from tread to tread; one that would fall on a post is dropped.

import { rotate90CW } from './planLayout.js';
import { applyPostOverrides } from './postSolver.js';
import { constructionTypeForSide, CONSTRUCTION_TYPES } from './stringerModel.js';
import { valueAtU } from './polylineProfile.js';
import { curveToPolyline, filletPolyline } from './profileCurve.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { railingEndKey, railingRunKey, sanitizeRailingEndOffsets, sanitizeRailingProfileOverrides, applyRunPoints } from './railingProfileModel.js';

// (the manual-edit layer of a handrail lives in railingProfileModel.js; re-exported for existing importers)
export { railingEndKey, sanitizeRailingEndOffsets, MAX_RAILING_END_OFFSET_MM } from './railingProfileModel.js';
import { RAILING_INFILL, isGlassInfill, glassLateralOffsetMm, glassType, panesForRun, intermediatePostSplits, splitPathAt, planCornerSplits } from './railingGlass.js';
import { starterNewelTread } from './starterSteps.js';
import { sanitizeRailingPostEdits, manualRailingPostId, SUPPRESS_MATCH_MM, MANUAL_POST_MIN_FROM_END_MM } from './railingPostEdits.js';
import { wallRailAllowed } from './stairwell.js';
export { applyRailingPostEdit, sanitizeRailingPostEdits } from './railingPostEdits.js';

export const RAILING_SIDES = Object.freeze(['outer', 'inner']);

// Handrail cross-sections offered in the UI: width = across the stair, height = vertical (mm).
export const HANDRAIL_PRESETS = Object.freeze([
  { id: '70x40', label: '70 x 40', shape: 'rect', width: 70, height: 40 },
  { id: '68x45', label: '68 x 45 (min. BWF)', shape: 'rect', width: 68, height: 45 },
  { id: '40x50', label: '40 x 50', shape: 'rect', width: 40, height: 50 },
  { id: '60x60', label: '60 x 60', shape: 'rect', width: 60, height: 60 },
  { id: 'round50', label: 'okrągła Ø 50', shape: 'round', width: 50, height: 50 },
  { id: 'round40', label: 'okrągła Ø 40', shape: 'round', width: 40, height: 40 },
]);

const POST_REUSE_TOLERANCE_FACTOR = 1; // an existing post closer than one post size to a join is reused
export const RAILING_CORNER_ANGLE_DEG = 10; // a plan turn sharper than this ends the run in a post
// A piece steeper than this is a step, not a handrail. Deliberately almost vertical: the dusza side of a winder is steep
// (~58 degrees with the default 110 mm dusza, ~85 with 3-4 winders per turn) but a continuous, if steep, handrail there is what
// the user wants ("balustrada z prostych odcinków") — only a truly vertical jump (a landing, a flight starting higher) splits it.
export const RAILING_STEEP_ANGLE_DEG = 89;
const MIN_RUN_MM = 100; // a run shorter than this (and than one post) is dropped
const SAME_POINT_MM = 1e-6;
const MITER_LIMIT = 0.1; // 1 + cos(angle) below this: too sharp a turn to mitre, use the plain segment normal

/**
 * Cleans the section list: only known sides, integer step indices, unique ids. Anything else is dropped.
 * @returns {{id:string, side:'outer'|'inner', fromStep:number, toStep:number|null}[]}
 */
export function sanitizeRailingSections(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach((s, i) => {
    if (!s || typeof s !== 'object' || !RAILING_SIDES.includes(s.side)) return;
    if (!Number.isInteger(s.fromStep) || s.fromStep < 0) return;
    if (!(s.toStep === null || s.toStep === undefined || (Number.isInteger(s.toStep) && s.toStep >= 0))) return;
    let id = typeof s.id === 'string' && s.id ? s.id : `railing-${i}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    out.push({ id, side: s.side, fromStep: s.fromStep, toStep: s.toStep ?? null });
  });
  return out;
}

/**
 * The pure edit behind the Inspektor's "Początek / Koniec / Nowy odcinek" buttons (a tread selected in the plan):
 * returns a NEW section list. `from`/`to` move that end of the section to `stepIndex` (the other end follows when
 * they would cross), `to-end` makes it run to the last tread, `remove` deletes it, `new` adds a section on `side`
 * that starts at `stepIndex` and runs to the end. An unknown section id changes nothing.
 */
export function editRailingSections(sections, { action, sectionId, stepIndex, side }) {
  const next = (sections || []).map((s) => ({ ...s }));
  if (action === 'new') {
    next.push({ id: `railing-${Date.now().toString(36)}-${next.length}`, side: side === 'inner' ? 'inner' : 'outer', fromStep: stepIndex, toStep: null });
    return next;
  }
  const s = next.find((x) => x.id === sectionId);
  if (!s) return next;
  if (action === 'from') {
    s.fromStep = stepIndex;
    if (s.toStep !== null && s.toStep < stepIndex) s.toStep = stepIndex;
  } else if (action === 'to') {
    s.toStep = stepIndex;
    if (s.fromStep > stepIndex) s.fromStep = stepIndex;
  } else if (action === 'to-end') {
    s.toStep = null;
  } else if (action === 'remove') {
    next.splice(next.indexOf(s), 1);
  }
  return next;
}

const planDist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const planLen = (p) => Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
// Pitch of a handrail piece, degrees above horizontal (negative going down).
export function piecePitchDeg(piece) {
  return deg(Math.atan2(piece.end.z - piece.start.z, planLen(piece)));
}

/**
 * Cut angles of the handrail pieces of ONE run (mutates the pieces it is given — freshly built by buildSection).
 * `startCut`/`endCut` = { kind: 'post'|'join', verticalDeg, planDeg }:
 *  - verticalDeg: the cut seen from the side, measured from the square (perpendicular-to-the-axis) cut. In the
 *    piece's own side view (u along its axis, v up, the axis at v = 0) the cut line through the axis end reaches the
 *    top edge (v = +h/2) at u = +(h/2)·tan(verticalDeg) at the start and at u = L − (h/2)·tan(verticalDeg) at the
 *    end. A run's end at a post is a plumb cut (start −pitch, end +pitch); a join between two pieces of the run is
 *    the bisector of their pitches (half the pitch change).
 *  - planDeg: seen from above, half the turn between the two pieces at a join (0 at a post, square in plan).
 * `cutLengthMm` = the longer of the piece's top and bottom edges — the length to cut it from.
 */
function annotateCuts(runPieces, handrailHeight) {
  const h2 = handrailHeight / 2;
  const pitches = runPieces.map(piecePitchDeg);
  const planDir = (p) => Math.atan2(p.end.y - p.start.y, p.end.x - p.start.x);
  const planTurnDeg = (a, b) => {
    let d = deg(planDir(b) - planDir(a));
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d) / 2;
  };
  runPieces.forEach((piece, i) => {
    const prev = runPieces[i - 1];
    const next = runPieces[i + 1];
    const alpha = pitches[i];
    piece.pitchDeg = alpha;
    piece.startCut = prev ? { kind: 'join', verticalDeg: (alpha - pitches[i - 1]) / 2, planDeg: planTurnDeg(prev, piece) } : { kind: 'post', verticalDeg: -alpha, planDeg: 0 };
    piece.endCut = next ? { kind: 'join', verticalDeg: (pitches[i + 1] - alpha) / 2, planDeg: planTurnDeg(piece, next) } : { kind: 'post', verticalDeg: alpha, planDeg: 0 };
    const top = piece.lengthMm - h2 * Math.tan(rad(piece.startCut.verticalDeg)) - h2 * Math.tan(rad(piece.endCut.verticalDeg));
    const bottom = piece.lengthMm + h2 * Math.tan(rad(piece.startCut.verticalDeg)) + h2 * Math.tan(rad(piece.endCut.verticalDeg));
    piece.cutLengthMm = Math.max(top, bottom);
  });
}

// Pitch of the handrail piece above a plan point (the nearest piece in plan); with `withDir` also the plan direction
// the handrail rises in there ({deg, dir}).
function pitchUnder(pieces, point, withDir = false) {
  let best = null;
  let bestDist = Infinity;
  for (const p of pieces) {
    const len = planLen(p);
    if (len < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((point.x - p.start.x) * (p.end.x - p.start.x) + (point.y - p.start.y) * (p.end.y - p.start.y)) / (len * len)));
    const d = Math.hypot(point.x - (p.start.x + t * (p.end.x - p.start.x)), point.y - (p.start.y + t * (p.end.y - p.start.y)));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!withDir) return best ? piecePitchDeg(best) : 0;
  return best ? { deg: piecePitchDeg(best), dir: unit({ x: best.end.x - best.start.x, y: best.end.y - best.start.y }) } : { deg: 0, dir: { x: 1, y: 0 } };
}

function unit(v) {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
}

function sideChain(planTread, side) {
  const chain = side === 'outer' ? planTread.outerChain : planTread.innerChain;
  if (chain && chain.length >= 2) return chain;
  const idx = side === 'outer' ? 1 : 0;
  return [planTread.frontEdge[idx], planTread.backEdge[idx]];
}

const pointKey = (p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;

// Offsets a plan polyline sideways by `distance` (positive = toward the stair interior for the outer side,
// `sign` flips it for the inner one), mitring at the corners. Returns a Map from each input point (by
// coordinates) to its offset position, so nodes sharing a plan position share the offset.
function offsetLookup(points, distance, sign) {
  const unique = [];
  for (const p of points) if (unique.length === 0 || planDist(unique[unique.length - 1], p) > SAME_POINT_MM) unique.push({ x: p.x, y: p.y });
  const lookup = new Map();
  if (unique.length < 2) return lookup;
  const normals = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const across = rotate90CW(unit({ x: unique[i + 1].x - unique[i].x, y: unique[i + 1].y - unique[i].y }));
    normals.push({ x: across.x * sign, y: across.y * sign });
  }
  unique.forEach((p, i) => {
    let n;
    if (i === 0) n = normals[0];
    else if (i === unique.length - 1) n = normals[normals.length - 1];
    else {
      const a = normals[i - 1];
      const b = normals[i];
      const denom = 1 + a.x * b.x + a.y * b.y;
      n = denom < MITER_LIMIT ? b : { x: (a.x + b.x) / denom, y: (a.y + b.y) / denom };
    }
    lookup.set(pointKey(p), { x: p.x + n.x * distance, y: p.y + n.y * distance });
  });
  return lookup;
}

// --- bent handrail (etap 4) ------------------------------------------------------------------------------
//
// One run of the nosing line made smooth: in PLAN every interior corner (only corners without a post remain inside a
// run when bent) is filleted with config.railingPlanBendRadiusMm; in ELEVATION — z against the distance along the
// plan path — every change of pitch is filleted with config.railingBendRadiusMm (both clamped where the neighbouring
// pieces are too short, profileCurve.js filletPolyline). The result is sampled densely, so every consumer keeps
// working on straight chords (renderer, takeoff, checks); `run.bent` marks it for the takeoff and the DXF.
const BENT_PLAN_CHORD_MM = 2; // chord tolerance of the plan arcs
const BENT_ELEVATION_CHORD_MM = 1; // chord tolerance of the elevation arcs
// Nodes of the nosing line closer than this (along the plan) are merged before the elevation is filleted — the tread
// boundaries around a corner sit a few mm apart and would otherwise clamp every fillet to almost nothing.
const BENT_MIN_NODE_SPACING_MM = 20;
const STATION_ROUND_MM = 1e-3; // stations of a bent run are merged when closer than this
const PLAN_COLLINEAR_SIN = 1e-3; // a plan vertex turning less than this (sin) is not a corner

// Plan corners only: collinear vertices dropped (a fillet sized by the legs of the REAL corner, not by a node a few
// mm away on the same line).
function planCorners(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const p = points[i];
    const b = points[i + 1];
    const l1 = Math.hypot(p.u - a.u, p.v - a.v);
    const l2 = Math.hypot(b.u - p.u, b.v - p.v);
    if (l1 < SAME_POINT_MM || l2 < SAME_POINT_MM) continue;
    const sin = Math.abs((p.u - a.u) * (b.v - p.v) - (p.v - a.v) * (b.u - p.u)) / (l1 * l2);
    if (sin > PLAN_COLLINEAR_SIN) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

function smoothRun(run, config) {
  const plan = [];
  for (const p of run) {
    const last = plan[plan.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < SAME_POINT_MM) continue;
    plan.push(p);
  }
  if (plan.length < 3) return simplifyPath(run);

  const planPts = planCorners(plan.map((p) => ({ u: p.x, v: p.y })));
  const planRadius = Math.max(0, config.railingPlanBendRadiusMm || 0);
  const planCurve = filletPolyline(planPts, planPts.map((_, i) => (i > 0 && i < planPts.length - 1 ? planRadius : 0))).curve;
  const planPoly = curveToPolyline(planCurve, BENT_PLAN_CHORD_MM);
  const cumPlanNew = cumulativeLengths(planPoly.map((p) => ({ x: p.u, y: p.v })));
  const cumPlanOld = cumulativeLengths(plan);
  const scale = cumPlanOld[cumPlanOld.length - 1] > 0 ? cumPlanNew[cumPlanNew.length - 1] / cumPlanOld[cumPlanOld.length - 1] : 1;

  const profile = [];
  plan.forEach((p, i) => {
    const q = { u: cumPlanOld[i] * scale, v: p.z };
    const last = profile[profile.length - 1];
    if (last && i < plan.length - 1 && q.u - last.u < BENT_MIN_NODE_SPACING_MM) return;
    if (last && i === plan.length - 1 && profile.length > 1 && q.u - last.u < BENT_MIN_NODE_SPACING_MM) profile.pop();
    profile.push(q);
  });
  const bendRadius = Math.max(0, config.railingBendRadiusMm || 0);
  const zPoly = curveToPolyline(filletPolyline(profile, profile.map((_, i) => (i > 0 && i < profile.length - 1 ? bendRadius : 0))).curve, BENT_ELEVATION_CHORD_MM);

  const stations = [...new Set([...cumPlanNew, ...zPoly.map((q) => q.u)].map((s) => Math.round(s / STATION_ROUND_MM) * STATION_ROUND_MM))].sort((a, b) => a - b);
  const total = cumPlanNew[cumPlanNew.length - 1];
  const planAt = (s) => {
    const k = Math.max(1, cumPlanNew.findIndex((c) => c >= s));
    const a = planPoly[k - 1];
    const b = planPoly[k] ?? a;
    const span = cumPlanNew[k] - cumPlanNew[k - 1];
    const t = span > 0 ? (s - cumPlanNew[k - 1]) / span : 0;
    return { x: a.u + (b.u - a.u) * t, y: a.v + (b.v - a.v) * t };
  };
  // Stations are rounded to STATION_ROUND_MM, so the last one may land that much past the path's real length (any
  // length that is not a round number — e.g. a run cut to a post face): the end tolerance is the rounding step, and
  // each station is evaluated inside the path. (With a 1e-6 tolerance the last station — the run's end — was dropped.)
  return stations
    .filter((s) => s >= -STATION_ROUND_MM && s <= total + STATION_ROUND_MM)
    .map((s) => Math.min(Math.max(s, 0), total))
    .map((s) => ({ ...planAt(s), z: valueAtU(zPoly, s) }));
}

// The base rail of one run: the run's plan path sampled every BASERAIL_SAMPLE_MM (plus its own vertices), each point
// lifted onto the wanga's top edge (`topAt`) with the rail's centre half its height above it, collinear points merged.
const CORNER_PROBE_MM = 1; // how far either side of a path vertex the boards' tops are read
const BOARD_STEP_MM = 1; // a difference above this between the two sides is a step between boards, not the slope
const BASERAIL_SAMPLE_MM = 20; // dense enough that a chord across a kink of the wanga top stays within ~1 mm of it
function baseRailAlong(path, topAt, heightMm) {
  const stations = [];
  for (let i = 0; i < path.length; i++) {
    stations.push(path[i]);
    const next = path[i + 1];
    if (!next) break;
    const len = Math.hypot(next.x - path[i].x, next.y - path[i].y);
    const n = Math.floor(len / BASERAIL_SAMPLE_MM);
    for (let k = 1; k < n; k++) stations.push({ x: path[i].x + ((next.x - path[i].x) * k) / n, y: path[i].y + ((next.y - path[i].y) * k) / n });
  }
  // At a path vertex two boards may meet (a plan corner, the end of a run at a corner): the rail lies on the HIGHER
  // of the top edges found just either side of it, never cutting into the board that rises past it.
  const nudge = (p, q, mm) => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: p.x + ((q.x - p.x) / l) * mm, y: p.y + ((q.y - p.y) / l) * mm };
  };
  const vertexIndex = new Map(path.map((p, k) => [p, k]));
  const topAround = (p) => {
    const k = vertexIndex.get(p);
    if (k === undefined) return topAt(p);
    const probes = [p, k > 0 ? nudge(p, path[k - 1], CORNER_PROBE_MM) : null, k < path.length - 1 ? nudge(p, path[k + 1], CORNER_PROBE_MM) : null].filter(Boolean);
    const tops = probes.map(topAt).filter((t) => t !== null && t !== undefined);
    if (tops.length === 0) return null;
    const own = tops[0];
    const highest = Math.max(...tops);
    // only a real step between two boards counts; the slope of one board over CORNER_PROBE_MM is noise
    return highest - own > BOARD_STEP_MM ? highest : own;
  };
  const points = stations
    .map((p) => {
      const top = topAround(p);
      return top === null || top === undefined ? null : { x: p.x, y: p.y, z: top + heightMm / 2 };
    })
    .filter(Boolean);
  if (points.length < 2) return [];
  // A sampled kink of the wanga top leaves a chord of about one sample step between two long pieces — a pointless
  // 20-30 mm piece for the workshop: it is replaced by the true kink (collapseShortPieces).
  const simplified = collapseShortPieces(simplifyPath(points), 2 * BASERAIL_SAMPLE_MM);
  const pieces = [];
  for (let i = 0; i < simplified.length - 1; i++) {
    const start = simplified[i];
    const end = simplified[i + 1];
    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    if (lengthMm > SAME_POINT_MM) pieces.push({ start, end, lengthMm });
  }
  annotateCuts(pieces, heightMm);
  return pieces;
}

// Removes pieces shorter than `minLen` from a 3D polyline where that is exact: an interior one whose neighbours lie in
// one vertical plane is replaced by the intersection of their lines (the kink they really meet at); an end one merges
// into its neighbour. A short piece at a plan corner (neighbours in different planes) is a real transition — kept.
function collapseShortPieces(points, minLen) {
  const pts = [...points];
  const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  let i = 0;
  while (i < pts.length - 1 && pts.length > 2) {
    if (len(pts[i], pts[i + 1]) >= minLen) {
      i += 1;
      continue;
    }
    if (i === 0) {
      pts.splice(1, 1);
      continue;
    }
    if (i + 1 === pts.length - 1) {
      pts.splice(i, 1);
      continue;
    }
    const kink = kinkBetween(pts[i - 1], pts[i], pts[i + 1], pts[i + 2]);
    if (kink) {
      pts.splice(i, 2, kink);
      i = Math.max(0, i - 1);
    } else {
      i += 1;
    }
  }
  return pts;
}

function kinkBetween(p0, a, b, p3) {
  const l1 = Math.hypot(a.x - p0.x, a.y - p0.y);
  const l2 = Math.hypot(p3.x - b.x, p3.y - b.y);
  if (l1 < SAME_POINT_MM || l2 < SAME_POINT_MM) return null;
  const d = { x: (a.x - p0.x) / l1, y: (a.y - p0.y) / l1 };
  const d2 = { x: (p3.x - b.x) / l2, y: (p3.y - b.y) / l2 };
  if (Math.abs(d.x * d2.y - d.y * d2.x) > PLAN_COLLINEAR_SIN) return null; // not in one vertical plane
  const sOf = (q) => (q.x - a.x) * d.x + (q.y - a.y) * d.y;
  const m1 = (a.z - p0.z) / (0 - sOf(p0));
  const m2 = (p3.z - b.z) / (sOf(p3) - sOf(b));
  if (Math.abs(m1 - m2) < 1e-9) return null;
  const s = (b.z - m2 * sOf(b) - a.z) / (m1 - m2);
  if (s < sOf(p0) || s > sOf(p3)) return null; // the lines meet outside the two neighbours
  return { x: a.x + d.x * s, y: a.y + d.y * s, z: a.z + m1 * s };
}

// z of the (smoothed) nosing line under a plan point: the nearest chord in plan of the given paths, interpolated.
function zOnPaths(paths, point) {
  let best = null;
  let bestDist = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
      if (d < bestDist) {
        bestDist = d;
        best = a.z + (b.z - a.z) * t;
      }
    }
  }
  return best;
}

// Removes vertices that lie on the straight line between their neighbours (3D), so a straight flight is
// ONE handrail piece however many treads it spans.
function simplifyPath(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const cross = { x: ab.y * bc.z - ab.z * bc.y, y: ab.z * bc.x - ab.x * bc.z, z: ab.x * bc.y - ab.y * bc.x };
    const scale = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(bc.x, bc.y, bc.z);
    if (scale > 1e-9 && Math.hypot(cross.x, cross.y, cross.z) / scale > 1e-6) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Point at plan-arc-length `s` along a polyline of {x,y,z} points, with its interpolated z.
function pointAt(path, cumulative, s) {
  let i = 0;
  while (i < path.length - 2 && s > cumulative[i + 1]) i++;
  const span = cumulative[i + 1] - cumulative[i];
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (s - cumulative[i]) / span)) : 0;
  const a = path[i];
  const b = path[i + 1];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function cumulativeLengths(path) {
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + planDist(path[i - 1], path[i]));
  return cumulative;
}

// The wanga's top edge (housed board) at a plan point: z on `upperCurve` of the segment the point projects
// onto (nearest of them). null when no construction geometry is available — the caller falls back to the
// nosing line + the top margin.
function wangaTopAt(point, stringerModel, geometries) {
  if (!stringerModel || !geometries) return null;
  let best = null;
  stringerModel.segments.forEach((segment, i) => {
    const geo = geometries[i];
    if (!geo || !geo.upperCurve || geo.upperCurve.length === 0) return;
    const ref = segment.referenceLine;
    const dx = point.x - ref.start.x;
    const dy = point.y - ref.start.y;
    const u = dx * ref.direction.x + dy * ref.direction.y;
    const perp = Math.abs(-dx * ref.direction.y + dy * ref.direction.x);
    const outside = u < 0 ? -u : u > ref.length ? u - ref.length : 0;
    const distance = perp + outside;
    if (!best || distance < best.distance) best = { distance, u: Math.min(ref.length, Math.max(0, u)), geo };
  });
  if (!best) return null;
  const polyline = curveToPolyline(best.geo.upperCurve);
  return polyline.length >= 2 ? valueAtU(polyline, best.u) : null;
}

// --- handrail ends at posts ---------------------------------------------------------------------------------------
// A handrail run is laid along the nosing-line nodes, but it is a piece of timber BETWEEN two posts: it starts on the
// face of the post at its start and ends on the face of the post at its end. The posts do not stand on the run's
// first/last node (a start newel is moved clear of the first nosing, an end newel stands past the last tread, a
// reused structural post is only near the join), so the run is trimmed back to the face where it passes through a
// post and continued along its own end line where it stops short of one.
const MAX_END_FIT_FACTOR = 3; // a run end is never moved further than this many post sizes

// Fits the START of a {x,y,z} path to `post` (plan square, axis-aligned like every post) ALONG the run's own line.
// Returns the same path when that line misses the post or the post is too far.
function fitStartAlongLine(path, post) {
  if (!post || path.length < 2) return { path, fitted: false };
  const half = post.size / 2;
  const c = post.position;
  const inside = (p) => Math.abs(p.x - c.x) < half - 1e-6 && Math.abs(p.y - c.y) < half - 1e-6;
  let pts = path;
  while (pts.length > 2 && inside(pts[1])) pts = pts.slice(1);
  const a = pts[0];
  const b = pts[1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < SAME_POINT_MM) return { path, fitted: false };
  // the line a + t·(b − a) against the square (slab test); t1 = where it leaves the post toward b
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, centre] of [[a.x, dx, c.x], [a.y, dy, c.y]]) {
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(o - centre) >= half) return { path, fitted: false };
      continue;
    }
    const u = (centre - half - o) / d;
    const v = (centre + half - o) / d;
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
  }
  if (t0 > t1 || t1 >= 1 - 1e-6 || Math.abs(t1) * L > MAX_END_FIT_FACTOR * post.size) return { path, fitted: false };
  const start = { ...a, x: a.x + dx * t1, y: a.y + dy * t1, z: a.z + (b.z - a.z) * t1 };
  return { path: [start, ...pts.slice(1)], fitted: true };
}

// The start of a path on its post, whatever the layout: along the run's own line when that line meets the post
// (fitStartAlongLine); otherwise — the post stands beside the line, as at a corner post between a landing and winders
// or with a 0-tread flight — the run's first point is moved to the NEAREST point of the post, keeping the first
// piece's slope over the extra distance. A handrail always reaches the post it belongs to; a start already inside the
// post is left alone (hidden in the post).
function fitPathStartToPost(path, post) {
  const along = fitStartAlongLine(path, post);
  if (along.fitted || !post || path.length < 2) return along;
  const half = post.size / 2;
  const c = post.position;
  const a = path[0];
  const q = { x: Math.max(c.x - half, Math.min(c.x + half, a.x)), y: Math.max(c.y - half, Math.min(c.y + half, a.y)) };
  const gap = Math.hypot(q.x - a.x, q.y - a.y);
  if (gap < SAME_POINT_MM || gap > MAX_END_FIT_FACTOR * post.size) return along;
  const b = path[1];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const slope = L > SAME_POINT_MM ? (b.z - a.z) / L : 0;
  return { path: [{ ...a, x: q.x, y: q.y, z: a.z - slope * gap }, ...path.slice(1)], fitted: true };
}

// A handrail is not made with a short stub next to a post: where the nosing line kinks just before a post (the first
// winder at a corner post, a landing edge), the last straight piece is carried on to the post's face instead of
// following that kink — the handrail simply meets the post a little lower or higher. A stub is a piece at a post
// shorter (in plan) than RAIL_END_STUB_MM that continues the previous piece's plan direction; it is dropped only when
// the longer piece's own line does reach that post.
export const RAIL_END_STUB_MM = 250; // judgement value (workshop practice, not a norm) — ASSUMPTION
function dropStartStub(path, post) {
  if (!post || path.length < 3) return path;
  const [a, b, c] = path;
  const l1 = Math.hypot(b.x - a.x, b.y - a.y);
  const l2 = Math.hypot(c.x - b.x, c.y - b.y);
  if (l1 >= RAIL_END_STUB_MM || l2 < SAME_POINT_MM) return path;
  const sameWay = l1 < SAME_POINT_MM || ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2) > Math.cos((RAILING_CORNER_ANGLE_DEG * Math.PI) / 180);
  if (!sameWay) return path;
  const without = path.slice(1);
  return fitStartAlongLine(without, post).fitted ? without : path;
}

function fitPathToPosts(path, startPost, endPost) {
  const s = fitPathStartToPost(dropStartStub(path, startPost), startPost);
  const e = fitPathStartToPost(dropStartStub([...s.path].reverse(), endPost), endPost);
  return { path: [...e.path].reverse(), startFitted: s.fitted, endFitted: e.fitted };
}

function diag(sectionId, ruleId, message, severity = 'WARNING') {
  return createDiagnostic({ ruleId, severity, elementType: 'railing', elementId: sectionId, message });
}

// The nosing-line nodes of the section, tread by tread: every vertex of each tread's chain with its z.
// z runs from the tread's front z to its back z in proportion to the plan distance along the chain.
function buildTreadChains(planLayout, fromStep, toStep, side, riserHeight) {
  const chains = [];
  for (let i = fromStep; i <= toStep; i++) {
    const planTread = planLayout.treads[i];
    const chain = sideChain(planTread, side);
    const zFront = (i + 1) * riserHeight;
    const zBack = planTread.type === 'landing' ? zFront : zFront + riserHeight;
    const cumulative = cumulativeLengths(chain);
    const total = cumulative[cumulative.length - 1];
    const points = chain.map((p, k) => ({ x: p.x, y: p.y, z: total > SAME_POINT_MM ? zFront + ((zBack - zFront) * cumulative[k]) / total : k === 0 ? zFront : zBack }));
    chains.push({ index: i, type: planTread.type, zFront, zBack, points });
  }
  return chains;
}

// Splits the flat node list into runs (see the header) and reports the joins between them. With a bent handrail
// (config.railingBent) a plan corner only ends the run where a post already stands there (`isPostAt`); elsewhere the
// handrail is bent round it (smoothRun).
function splitIntoRuns(nodes, config, isPostAt = () => false) {
  const steep = Math.tan((RAILING_STEEP_ANGLE_DEG * Math.PI) / 180);
  const cornerCos = Math.cos((RAILING_CORNER_ANGLE_DEG * Math.PI) / 180);
  const runs = [];
  const joins = []; // joins[j] sits between runs[j] and runs[j+1]
  let current = [nodes[0]];
  for (let k = 1; k < nodes.length; k++) {
    const a = nodes[k - 1];
    const b = nodes[k];
    const l = planDist(a, b);
    const dz = Math.abs(b.z - a.z);
    const isStep = l < SAME_POINT_MM ? dz > SAME_POINT_MM : dz > steep * l;
    if (isStep) {
      runs.push(current);
      joins.push({ kind: 'step' });
      current = [b];
      continue;
    }
    if (current.length >= 2 && l > SAME_POINT_MM) {
      const prev = current[current.length - 2];
      const lPrev = planDist(prev, a);
      if (lPrev > SAME_POINT_MM) {
        const cos = ((a.x - prev.x) * (b.x - a.x) + (a.y - prev.y) * (b.y - a.y)) / (lPrev * l);
        if (cos < cornerCos && (!config.railingBent || isPostAt(a))) {
          runs.push(current);
          joins.push({ kind: 'corner' });
          current = [a];
        }
      }
    }
    current.push(b);
  }
  runs.push(current);

  // Drop runs too short to hold a handrail; the joins around them merge into the first one.
  const runLength = (run) => cumulativeLengths(run)[run.length - 1];
  const minRun = Math.max(MIN_RUN_MM, config.postSize || 0);
  const keptRuns = [];
  const keptJoins = [];
  let pending = null;
  runs.forEach((run, j) => {
    if (runs.length > 1 && (run.length < 2 || runLength(run) < minRun)) {
      if (keptRuns.length > 0 && pending === null) pending = joins[j - 1];
      return;
    }
    if (keptRuns.length > 0) keptJoins.push(pending ?? joins[j - 1]);
    pending = null;
    keptRuns.push(run);
  });
  return { runs: keptRuns, joins: keptJoins };
}

// A node of a path at plan distance `s` along it (`cum` = its plan cumulative lengths), z interpolated.
function nodeAtS(path, cum, s) {
  for (let i = 0; i < path.length - 1; i++) {
    if (s <= cum[i + 1] + 1e-9 || i === path.length - 2) {
      const len = cum[i + 1] - cum[i];
      const t = len > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / len)) : 0;
      const a = path[i];
      const b = path[i + 1];
      return { ...a, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return { ...path[0] };
}

// The part of a path between plan distances a and b along it (its own nodes inside, interpolated ends).
function slicePathByS(path, a, b) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + planDist(path[i - 1], path[i]));
  const out = [nodeAtS(path, cum, a)];
  for (let i = 0; i < path.length; i++) if (cum[i] > a + 1e-6 && cum[i] < b - 1e-6) out.push(path[i]);
  out.push(nodeAtS(path, cum, b));
  return out;
}

// The hand edits of a section's posts (railingPostEdits.js) applied to its runs, in this order: every automatic join
// is named first (`autoKey` 'join-<k>' — its post id never changes with the edits); an automatic CORNER post switched
// off joins its two runs into one (a mitred corner; glass between posts needs its corner posts), one MOVED likewise and
// then cuts the handrail at its new place; a moved START / END post trims the balustrade to its new place (the stretch
// left over may carry a wall handrail — `wallRailPaths`); a hand-placed post cuts its run like any post. `s` = the plan
// distance along the section's path (its `nodes`) from its start. Writes `base.suppressedCorners` and the INFO for a
// post it cannot place.
function applyPostEditsToRuns(sectionId, nodes, runs, joins, infill, config, base) {
  const sCum = [0];
  for (let k = 1; k < nodes.length; k++) sCum.push(sCum[k - 1] + planDist(nodes[k - 1], nodes[k]));
  const total = sCum[sCum.length - 1];
  const sOfNode = new Map(nodes.map((n, k) => [n, sCum[k]]));
  const sOf = (n) => sOfNode.get(n) ?? null;
  const postEdits = sanitizeRailingPostEdits(config.railingPostEdits)[sectionId] || { added: [], suppressed: [] };
  const moved = postEdits.moved || {};
  joins.forEach((join, k) => {
    join.autoKey = `join-${k}`;
  });
  const cornersMovable = infill !== RAILING_INFILL.GLASS_POSTS;
  const suppressedCorners = [];
  const movedJoins = [];
  if ((postEdits.suppressed.length || Object.keys(moved).length) && cornersMovable) {
    const mRuns = [runs[0]];
    const mJoins = [];
    joins.forEach((join, j) => {
      const corner = runs[j + 1][0];
      const sc = sOf(corner);
      if (join.kind === 'corner' && sc !== null) {
        if (moved[join.autoKey] !== undefined) {
          const last = mRuns[mRuns.length - 1];
          mRuns[mRuns.length - 1] = [...last, ...runs[j + 1].slice(1)];
          movedJoins.push({ id: join.autoKey, s: moved[join.autoKey], from: sc, auto: true });
          return;
        }
        if (postEdits.suppressed.some((x) => Math.abs(x - sc) < SUPPRESS_MATCH_MM)) {
          const last = mRuns[mRuns.length - 1];
          mRuns[mRuns.length - 1] = [...last, ...runs[j + 1].slice(1)];
          suppressedCorners.push({ s: sc, at: { x: corner.x, y: corner.y } });
          return;
        }
      }
      mJoins.push(join);
      mRuns.push(runs[j + 1]);
    });
    runs = mRuns;
    joins = mJoins;
  }
  // a run cut at plan distance s along the section (its own s range [s0, s1]): the two pieces, the new node registered
  const runRange = (run) => [sOf(run[0]), sOf(run[run.length - 1])];
  const cutRun = (run, s) => {
    const [s0] = runRange(run);
    const pieces = splitPathAt(run, [s - s0]);
    if (pieces.length === 2) sOfNode.set(pieces[1][0], s);
    return pieces;
  };

  // the moved start / end (the balustrade's own extent along the path)
  const minRun = MANUAL_POST_MIN_FROM_END_MM;
  let startS = 0;
  let endS = total;
  if (moved.start !== undefined) startS = Math.max(0, Math.min(moved.start, total - minRun));
  if (moved.end !== undefined) endS = Math.min(total, Math.max(moved.end, startS + minRun));
  if (startS > 1e-6) {
    const k = runs.findIndex((run) => runRange(run)[1] > startS + 1e-6);
    if (k >= 0) {
      runs = runs.slice(k);
      joins = joins.slice(k);
      const [s0] = runRange(runs[0]);
      if (s0 < startS - 1e-6) runs[0] = cutRun(runs[0], startS)[1];
    }
  }
  if (endS < total - 1e-6) {
    let k = -1;
    runs.forEach((run, i) => {
      if (runRange(run)[0] < endS - 1e-6) k = i;
    });
    if (k >= 0) {
      runs = runs.slice(0, k + 1);
      joins = joins.slice(0, k);
      const [, s1] = runRange(runs[k]);
      if (s1 > endS + 1e-6) runs[k] = cutRun(runs[k], endS)[0];
    }
  }
  // the stretches past the moved ends that carry a wall handrail (railingPostEdits.js `wallRail`)
  const wallRailPaths = [];
  if (postEdits.wallRail?.start && startS > minRun) wallRailPaths.push({ which: 'start', path: slicePathByS(nodes, 0, startS) });
  if (postEdits.wallRail?.end && endS < total - minRun) wallRailPaths.push({ which: 'end', path: slicePathByS(nodes, endS, total) });

  const skippedManual = [];
  const skippedMoved = [];
  const toPlace = [...postEdits.added, ...movedJoins].sort((a, b) => a.s - b.s);
  if (toPlace.length) {
    const sRuns = [];
    const sJoins = [];
    runs.forEach((run, j) => {
      if (j > 0) sJoins.push(joins[j - 1]);
      const [s0, s1] = runRange(run);
      const inside = s0 === null || s1 === null ? [] : toPlace.filter((p) => p.s > s0 && p.s < s1);
      const placed = [];
      for (const p of inside) {
        const prev = placed.length ? placed[placed.length - 1].s : s0;
        if (p.s - prev >= MANUAL_POST_MIN_FROM_END_MM && s1 - p.s >= MANUAL_POST_MIN_FROM_END_MM) placed.push(p);
        else (p.auto ? skippedMoved : skippedManual).push(p);
      }
      const pieces = splitPathAt(run, placed.map((p) => p.s - s0));
      pieces.forEach((piece, k) => {
        if (k > 0) {
          const p = placed[k - 1];
          sOfNode.set(piece[0], p.s);
          sJoins.push(p.auto ? { kind: 'moved', autoKey: p.id, s: p.s } : { kind: 'manual', manualId: p.id, s: p.s });
        }
        sRuns.push(piece);
      });
    });
    runs = sRuns;
    joins = sJoins;
    // a post outside every run (past the section's end, on the dusza where no handrail runs) or too close
    for (const p of toPlace) {
      const placedHere = joins.some((jn) => (p.auto ? jn.kind === 'moved' && jn.autoKey === p.id : jn.manualId === p.id));
      if (!placedHere && !skippedManual.includes(p) && !skippedMoved.includes(p)) (p.auto ? skippedMoved : skippedManual).push(p);
    }
  }
  if (skippedManual.length) {
    base.diagnostics.push(diag(sectionId, 'RAILING-POST-MANUAL-SKIPPED', `Balustrada ${sectionId}: ${skippedManual.length} słupek(i) postawiony ręcznie jest poza poręczą albo bliżej niż ${MANUAL_POST_MIN_FROM_END_MM} mm od innego słupka / narożnika — pominięty. Przesuń go albo usuń.`, 'INFO'));
  }
  if (skippedMoved.length) {
    base.diagnostics.push(diag(sectionId, 'RAILING-POST-MANUAL-SKIPPED', `Balustrada ${sectionId}: ${skippedMoved.length} przesunięty słupek narożny jest poza poręczą albo bliżej niż ${MANUAL_POST_MIN_FROM_END_MM} mm od innego słupka — pominięty (poręcz przechodzi przez narożnik). Przesuń go albo przywróć AUTO.`, 'INFO'));
  }
  base.suppressedCorners = suppressedCorners;
  return { runs, joins, sOf, sCum, wallRailPaths, startMoved: moved.start !== undefined, endMoved: moved.end !== undefined, bare: new Set(postEdits.bare || []) };
}

// Plan distance from a point to a polyline.
function distToPolyline(path, p) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return path.length === 1 ? Math.hypot(p.x - path[0].x, p.y - path[0].y) : best;
}

// Free space between a wall handrail and the wall, and the largest spacing of its wall brackets (mm) — ASSUMPTION
// (common practice: ≥ 40–50 mm free behind the handrail, a bracket at least every metre); config overrides.
export const RAILING_WALL_RAIL_CLEARANCE_MM = 50;
export const RAILING_WALL_BRACKET_SPACING_MM = 1000;
const WALL_BRACKET_FROM_END_MM = 150;

// One wall handrail: the stretch's nosing nodes moved from the balustrade's line to the wall rail's line, simplified,
// at the handrail's height; brackets spread evenly, the first and last WALL_BRACKET_FROM_END_MM from its ends.
function buildWallRail(stretch, { config, sign, offsetMm, centre, handrailHeight }) {
  const width = config.railingHandrailWidthMm || 0;
  const clearance = config.railingWallRailClearanceMm ?? RAILING_WALL_RAIL_CLEARANCE_MM;
  const gap = Math.max(0, Number(config.stairwellWallGapMm) || 0);
  // into the stair from the outer line: the wall is `gap` outside it, the axis clearance + half the width inside the wall
  const axisInset = clearance + width / 2 - gap;
  const lookup = offsetLookup(stretch.path, axisInset - offsetMm, sign);
  const moved = stretch.path.map((p) => {
    const m = lookup.get(pointKey(p));
    return m ? { ...p, x: m.x, y: m.y } : { ...p };
  });
  const path = simplifyPath(moved);
  if (path.length < 2) return null;
  const pieces = [];
  for (let i = 0; i < path.length - 1; i++) {
    const start = centre(path[i]);
    const end = centre(path[i + 1]);
    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    if (lengthMm > SAME_POINT_MM) pieces.push({ start, end, lengthMm });
  }
  if (!pieces.length) return null;
  annotateCuts(pieces, handrailHeight);
  // brackets
  const spacing = Math.max(200, config.railingWallBracketSpacingMm ?? RAILING_WALL_BRACKET_SPACING_MM);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + planDist(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  const usable = total - 2 * WALL_BRACKET_FROM_END_MM;
  const count = usable <= 0 ? 1 : Math.ceil(usable / spacing) + 1;
  const brackets = [];
  for (let k = 0; k < count; k++) {
    const s = count === 1 ? total / 2 : WALL_BRACKET_FROM_END_MM + (usable * k) / (count - 1);
    const p = nodeAtS(path, cum, s);
    const i = Math.min(path.length - 2, cum.findIndex((c, j) => j > 0 && c >= s - 1e-9) - 1 < 0 ? 0 : cum.findIndex((c, j) => j > 0 && c >= s - 1e-9) - 1);
    const across = rotate90CW(unit({ x: path[i + 1].x - path[i].x, y: path[i + 1].y - path[i].y }));
    const toWall = { x: -across.x * sign, y: -across.y * sign }; // out of the stair
    const reach = clearance + width / 2;
    const c = centre(p);
    brackets.push({ position: { x: c.x, y: c.y }, z: c.z - handrailHeight / 2, wall: { x: c.x + toWall.x * reach, y: c.y + toWall.y * reach }, reachMm: reach });
  }
  return { pieces, brackets };
}

function buildSection(section, ctx) {
  const { config, planLayout, stringerModels, stringerConstruction, postModels, riserHeight } = ctx;
  const treadCount = planLayout.treads.length;
  // a balustrade on the dusza side starts at the newel standing on a starter step (starterSteps.js) at the earliest
  const fromStep = section.side === 'inner' ? Math.max(section.fromStep, starterNewelTread(planLayout) + 1) : section.fromStep;
  const toStep = section.toStep === null ? treadCount - 1 : section.toStep;
  const infill = isGlassInfill(config) ? config.railingInfill : RAILING_INFILL.BALUSTERS;
  const glass = infill !== RAILING_INFILL.BALUSTERS;
  const glassSide = infill === RAILING_INFILL.GLASS_SIDE;
  const base = { id: section.id, side: section.side, fromStep, toStep, valid: false, infill, handrail: null, runs: [], path: [], uncoveredSteps: [], balusters: [], glassPanes: [], glass: glass ? glassType(config) : null, posts: [], diagnostics: [] };
  if (fromStep > toStep || toStep >= treadCount) {
    base.diagnostics.push(diag(section.id, 'RAILING-SECTION-INVALID', `Odcinek balustrady ${section.id}: stopnie ${fromStep + 1}–${toStep + 1} są poza schodami albo w złej kolejności — odcinek pominięty.`));
    return base;
  }

  const side = section.side;
  const constructionType = constructionTypeForSide(config, side);
  // Glass on the wanga's side: the glass plane (and the handrail on it) lies OUTSIDE the wanga (railingGlass.js).
  const offsetMm = glassLateralOffsetMm(config) ?? config.railingLateralOffsetMm ?? (config.stringerThickness || 0) / 2;
  // Into the stair from this side's line (planLayout.js inwardNormal: also right for a mirrored left-turn plan).
  const sign = (side === 'outer' ? 1 : -1) * (planLayout.handedness ?? 1);
  const handrailHeight = config.railingHandrailHeightMm;
  const railTop = (z) => z + config.railingHeightMm;
  const balusterSize = config.railingBalusterSizeMm;

  // --- the nosing-line nodes (offset sideways as ONE polyline so the corners are mitred)
  const treadChains = buildTreadChains(planLayout, fromStep, toStep, side, riserHeight);
  const offset = offsetLookup(treadChains.flatMap((c) => c.points), offsetMm, sign);
  const shift = (p) => {
    const moved = offset.get(pointKey(p));
    return moved ? { x: moved.x, y: moved.y, z: p.z } : { ...p };
  };
  const nodes = [];
  for (const chain of treadChains) {
    chain.shifted = chain.points.map(shift);
    for (const p of chain.shifted) {
      const last = nodes[nodes.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) < SAME_POINT_MM) continue;
      nodes.push({ ...p, treadIndex: chain.index });
    }
  }
  if (nodes.length < 2) {
    base.diagnostics.push(diag(section.id, 'RAILING-SECTION-INVALID', `Odcinek balustrady ${section.id}: brak długości do poprowadzenia poręczy — odcinek pominięty.`));
    return base;
  }
  base.path = nodes.map((n) => ({ x: n.x, y: n.y })); // the whole wanga-side path (plan), also where no handrail can follow it

  const reuseDistance = config.postSize * POST_REUSE_TOLERANCE_FACTOR;
  const existingNear = (p) => (postModels || []).find((post) => Math.hypot(post.position.x - p.x, post.position.y - p.y) < reuseDistance) ?? null;
  // Glass between posts: a pane cannot turn a plan corner, so every corner gets a post (even with a bent handrail),
  // and a run longer than one pane gets intermediate posts.
  const split = splitIntoRuns(nodes, infill === RAILING_INFILL.GLASS_POSTS ? { ...config, railingBent: false } : config, (p) => existingNear(p) !== null);
  let { runs, joins } = split;

  // --- the hand-placed posts (railingPostEdits.js)
  const withEdits = applyPostEditsToRuns(section.id, nodes, runs, joins, infill, config, base);
  ({ runs, joins } = withEdits);
  const { sOf, sCum, wallRailPaths, startMoved, endMoved, bare } = withEdits;
  if (infill === RAILING_INFILL.GLASS_POSTS) {
    const subRuns = [];
    const subJoins = [];
    runs.forEach((run, j) => {
      if (j > 0) subJoins.push(joins[j - 1]);
      // a post at every plan corner of the run (a pane hangs post to post and cannot turn), then intermediate posts
      const pieces = splitPathAt(run, planCornerSplits(run)).flatMap((straight) => splitPathAt(straight, intermediatePostSplits(straight, config)));
      pieces.forEach((piece, k) => {
        if (k > 0) subJoins.push({ kind: 'glass-post' });
        subRuns.push(piece);
      });
    });
    runs = subRuns;
    joins = subJoins;
  }

  // Treads that carry no handrail at all: every node of theirs fell into a run that was too short to hold one (the
  // dusza side of a winder, where the treads shrink to a point). Their balusters would stand under nothing.
  const railedNodes = new Set(runs.flat());
  const railedTreads = new Set(nodes.filter((n) => railedNodes.has(n)).map((n) => n.treadIndex));
  const representedTreads = new Set(nodes.map((n) => n.treadIndex));
  const uncoveredSteps = treadChains.map((c) => c.index).filter((i) => representedTreads.has(i) && !railedTreads.has(i));
  base.uncoveredSteps = uncoveredSteps;

  // --- posts: one at the section start, one at the end, one at every join between two runs. An existing
  // structural post standing there is reused; a new one is a normal, editable railing post.
  const stairDepth = config.minimumStringerDepthMm || 0;
  const spots = [];
  spots.push({ id: `railing-post-${section.id}-start`, at: runs[0][0], zs: [runs[0][0].z], kind: 'start', s: sOf(runs[0][0]) ?? 0, spotKey: 'start', moved: startMoved });
  // (an automatic join is named once, before any edit — applyPostEditsToRuns `autoKey` —, so the ids of the posts an
  // override names stay put whatever is added, moved or switched off by hand; a hand-placed post by its own id; the
  // joins made after (posts splitting glass panes) number on after the named ones)
  let autoJoin = joins.reduce((n, jn) => Math.max(n, jn.autoKey ? Number(jn.autoKey.slice(5)) + 1 : 0), 0);
  joins.forEach((join, j) => {
    const endOfPrev = runs[j][runs[j].length - 1];
    const startOfNext = runs[j + 1][0];
    const key = join.kind === 'manual' ? null : (join.autoKey ?? `join-${autoJoin++}`);
    spots.push({
      id: join.kind === 'manual' ? manualRailingPostId(section.id, join.manualId) : `railing-post-${section.id}-${key}`,
      at: { x: (endOfPrev.x + startOfNext.x) / 2, y: (endOfPrev.y + startOfNext.y) / 2 },
      zs: [endOfPrev.z, startOfNext.z],
      kind: join.kind,
      manualId: join.manualId,
      s: join.kind === 'manual' || join.kind === 'moved' ? join.s : sOf(startOfNext) ?? sOf(endOfPrev),
      spotKey: key,
      moved: join.kind === 'moved',
    });
  });
  const lastRun = runs[runs.length - 1];
  spots.push({ id: `railing-post-${section.id}-end`, at: lastRun[lastRun.length - 1], zs: [lastRun[lastRun.length - 1].z], kind: 'end', s: sOf(lastRun[lastRun.length - 1]) ?? sCum[sCum.length - 1], spotKey: 'end', moved: endMoved });

  const halves = new Map(); // post id -> half width the spacing must leave free
  // The post that really stands at each spot: a reused structural post keeps ITS id, so a run's start/end post id
  // always names an existing PostModel (the structural check and the Inspektor look posts up by it).
  const postIdAt = new Map();
  const nominalPosts = [];
  // a post moved by hand stands where it was put: a structural post it was moved away from keeps standing, the
  // balustrade gets its own post there
  const existingAt = (spot) => (spot.moved ? null : existingNear(spot.at));
  for (const spot of spots) {
    const existing = existingAt(spot);
    if (existing) {
      halves.set(spot.id, existing.size / 2);
      postIdAt.set(spot.id, existing.postId);
      continue;
    }
    postIdAt.set(spot.id, spot.id);
    if (glassSide) continue; // the handrail sits on the glass — no posts of its own
    nominalPosts.push({
      postId: spot.id,
      kind: 'railing',
      ...(spot.kind === 'manual' ? { manual: true, sectionId: section.id, manualId: spot.manualId, s: spot.s } : {}),
      position: { x: spot.at.x, y: spot.at.y },
      elevation: { bottom: Math.max(0, Math.min(...spot.zs) - stairDepth), top: railTop(Math.max(...spot.zs)) + (config.railingPostTopAboveHandrailMm || 0) },
      size: config.railingPostSizeMm,
    });
  }
  base.posts = applyPostOverrides(nominalPosts, config.manualPostOverrides);
  for (const post of base.posts) halves.set(post.postId, post.removed ? 0 : post.size / 2);
  // for the plan's post editor: every post spot of this section along its path — which can be moved (a hand-placed
  // one), switched off (an automatic corner; not with glass between posts) or only edited (an end, a step, a glass split)
  base.postSpots = spots.map((spot) => ({
    postId: postIdAt.get(spot.id),
    spotId: spot.id,
    kind: spot.kind,
    s: spot.s,
    at: { x: spot.at.x, y: spot.at.y },
    manualId: spot.manualId ?? null,
    reused: postIdAt.get(spot.id) !== spot.id,
    suppressible: spot.kind === 'corner' && infill !== RAILING_INFILL.GLASS_POSTS,
    // what the plan's post editor may drag (railingPostEdits.js `moved`): the section's ends, its automatic corners
    // (not with glass between posts), the ones already moved; a step post and a pane split stay put
    spotKey: spot.spotKey ?? null,
    movable: spot.kind === 'manual' || spot.kind === 'start' || spot.kind === 'end' || spot.kind === 'moved' || (spot.kind === 'corner' && infill !== RAILING_INFILL.GLASS_POSTS),
    moved: !!spot.moved,
  }));
  base.wallRailEnds = { start: wallRailPaths.some((w) => w.which === 'start'), end: wallRailPaths.some((w) => w.which === 'end') };
  const halfAt = (spot) => halves.get(spot.id) ?? 0;
  const postClearances = [
    ...base.posts.filter((p) => !p.removed).map((p) => ({ position: p.position, half: p.size / 2 })),
    ...(postModels || []).map((p) => ({ position: p.position, half: p.size / 2 })),
  ];

  // --- handrail runs (the centre line of the profile: its TOP is `railingHeightMm` above the nosing line)
  const centre = (p) => ({ x: p.x, y: p.y, z: railTop(p.z) - handrailHeight / 2 });
  const maxClear = config.railingMaxClearMm;
  const pitch = maxClear + balusterSize; // largest allowed centre-to-centre distance
  const pieces = [];
  const balusters = [];
  const bent = !!config.railingBent;
  const endOffsets = sanitizeRailingEndOffsets(config.railingEndOffsets);
  const profilePoints = sanitizeRailingProfileOverrides(config.railingProfileOverrides)[section.id] || {};
  let skippedPoints = 0;
  let edited = false;
  const heights = []; // the handrail's top above the nosing line at every nosing node it covers
  // The post standing at a spot: a reused structural one, or this section's own. When the user REMOVED the section's
  // own post, the handrail goes on to the nearest post still standing within reach (typically the corner post just
  // past the section's end) — a handrail end is never left in the air next to a post. No post in reach: a free end.
  const standingNear = (spot) => {
    let best = null;
    for (const post of [...(postModels || []), ...base.posts.filter((p) => !p.removed)]) {
      const d = Math.hypot(post.position.x - spot.at.x, post.position.y - spot.at.y);
      if (d <= MAX_END_FIT_FACTOR * post.size && (!best || d < best.d)) best = { post, d };
    }
    return best?.post ?? null;
  };
  const ownRemoved = (spot) => base.posts.some((p) => p.postId === spot.id && p.removed);
  const postAtSpot = (spot) => existingAt(spot) ?? base.posts.find((p) => p.postId === spot.id && !p.removed) ?? (ownRemoved(spot) ? standingNear(spot) : null);
  const runPostId = (spot) => (ownRemoved(spot) ? (standingNear(spot)?.postId ?? postIdAt.get(spot.id)) : postIdAt.get(spot.id));
  const runPaths = []; // every run's final path — what a baluster / pane under an adjusted handrail reads its height from
  const runNodePaths = []; // every run's nosing nodes and whether it carries infill (overlay balusters are kept to them)
  // Base rail (podporęcz): only on a housed wanga — there the balusters stand on the wanga's top edge, and the base
  // rail lies on that edge along each handrail run, the balusters standing in it (on an overlay wanga they stand on
  // the treads: nothing to put a base rail on).
  const baseRailOn = !!config.railingBaseRail && constructionType !== CONSTRUCTION_TYPES.CUT;
  const baseRailHeight = baseRailOn ? config.railingBaseRailHeightMm : 0;
  const baseRail = baseRailOn ? { shape: 'rect', widthMm: config.railingBaseRailWidthMm, heightMm: config.railingBaseRailHeightMm, runs: [], pieces: [] } : null;
  if (config.railingBaseRail && !baseRailOn) {
    base.diagnostics.push(diag(section.id, 'RAILING-BASERAIL-NOT-APPLICABLE', `Balustrada ${section.id}: podporęcz jest tylko przy wandze wpuszczanej — przy nakładanej tralki stoją na stopniach, podporęcz pominięta.`, 'INFO'));
  }
  runs.forEach((run, j) => {
    const startPostId = runPostId(spots[j]);
    const endPostId = runPostId(spots[j + 1]);
    const startOffsetMm = endOffsets[railingEndKey(section.id, startPostId, 'start')] || 0;
    const endOffsetMm = endOffsets[railingEndKey(section.id, endPostId, 'end')] || 0;
    const startPost = postAtSpot(spots[j]);
    const endPost = postAtSpot(spots[j + 1]);
    // One order for every run: the simplified nosing line is cut to the post faces, then (if the user corrected an
    // end) its end points are moved — so the point where the handrail MEETS the post moves by exactly the given amount,
    // the straight stretch next to the post following without a kink at the last tread — and only then a bent handrail
    // is smoothed, through those ends.
    const cut = fitPathToPosts(simplifyPath(run), startPost, endPost);
    const moved = cut.path.map((node, i) => (i === 0 ? { ...node, z: node.z + startOffsetMm } : i === cut.path.length - 1 ? { ...node, z: node.z + endOffsetMm } : node));
    // the user's points on this run (railingProfileModel.js): each moves the line up/down at its place along the run
    const runKey = railingRunKey(startPostId, endPostId);
    const shaped = applyRunPoints(moved, profilePoints[runKey] || []);
    skippedPoints += shaped.skipped;
    if (startOffsetMm || endOffsetMm || shaped.control.some((c) => c.dz !== 0 || c.kind === 'added')) edited = true;
    // (smoothing may shift a path's ends a little, so a bent run is cut to the faces once more)
    const fit = bent ? fitPathToPosts(smoothRun(shaped.path, config), startPost, endPost) : { ...cut, path: shaped.path };
    if (bent) {
      fit.startFitted = fit.startFitted || cut.startFitted;
      fit.endFitted = fit.endFitted || cut.endFitted;
    }
    const path = fit.path;
    runPaths.push(path);
    const runPieces = [];
    for (let i = 0; i < path.length - 1; i++) {
      const start = centre(path[i]);
      const end = centre(path[i + 1]);
      runPieces.push({ start, end, lengthMm: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) });
    }
    annotateCuts(runPieces, handrailHeight);
    pieces.push(...runPieces);
    for (const node of run) {
      const lineZ = zOnPaths([path], node);
      if (lineZ !== null) heights.push(config.railingHeightMm + lineZ - node.z);
    }
    base.runs.push({
      key: runKey,
      startPostId,
      endPostId,
      pieces: runPieces,
      bent,
      startAtPostFace: fit.startFitted,
      endAtPostFace: fit.endFitted,
      startOffsetMm,
      endOffsetMm,
      // for the side-view editor (railingProfileView.js): all at nosing level, plan x/y + z
      profile: { final: path, auto: cut.path, base: moved, nosing: run, control: shaped.control },
    });

    // a run with no infill (railingPostEdits.js `bare`): the handrail on its two posts only
    const bareRun = bare.has(runKey);
    base.runs[base.runs.length - 1].bare = bareRun;
    runNodePaths.push({ path: run, bare: bareRun });
    if (bareRun) return;

    if (baseRail) {
      const railPieces = baseRailAlong(path, (p) => wangaTopAt(p, stringerModels?.[side], stringerConstruction?.[side]), baseRail.heightMm);
      baseRail.runs.push({ pieces: railPieces });
      baseRail.pieces.push(...railPieces);
    }

    if (glass) {
      // The glass of this run (railingGlass.js): the pane top under the handrail (a bent handrail's own line), the
      // bottom on the wanga's side (rotule) or above the wanga / the nosing line (between posts).
      // the handrail's own line (it may leave the raw nosing line: bent, corrected at a post, a stub dropped)
      const lineZ = (p) => zOnPaths([path], p) ?? p.z;
      const wangaTop = (p) => wangaTopAt(p, stringerModels?.[side], stringerConstruction?.[side]);
      const cut = constructionType === CONSTRUCTION_TYPES.CUT;
      const groundAt = (p) => {
        if (glassSide) return cut ? p.z - (riserHeight || 0) : (wangaTop(p) ?? p.z);
        return cut ? p.z : (wangaTop(p) ?? p.z);
      };
      const result = panesForRun(run, {
        config,
        sectionId: section.id,
        runIndex: j,
        startClearMm: halfAt(spots[j]),
        endClearMm: halfAt(spots[j + 1]),
        railBottomAt: (p) => railTop(lineZ(p)) - handrailHeight,
        groundAt,
      });
      base.glassPanes.push(...result.panes);
      for (const message of result.diagnostics) base.diagnostics.push(diag(section.id, 'RAILING-GLASS-PANE-LOW', `Balustrada ${section.id}: ${message}`));
    } else if (constructionType !== CONSTRUCTION_TYPES.CUT) {
      // Housed wanga: evenly spread along this run, standing on the wanga's top edge (or in the base rail on it).
      const cumulative = cumulativeLengths(path);
      const total = cumulative[cumulative.length - 1];
      // a run fitted to a post already starts/ends on that post's face
      const startHalf = fit.startFitted ? 0 : halfAt(spots[j]);
      const endHalf = fit.endFitted ? 0 : halfAt(spots[j + 1]);
      const usable = total - startHalf - endHalf;
      const n = usable > maxClear ? Math.ceil((usable - maxClear) / pitch) : 0;
      const gap = (usable - n * balusterSize) / (n + 1);
      for (let b = 0; b < n; b++) {
        const s = startHalf + gap * (b + 1) + balusterSize * b + balusterSize / 2;
        const p = pointAt(path, cumulative, s);
        const top = wangaTopAt(p, stringerModels?.[side], stringerConstruction?.[side]);
        // the wanga's own slope under it (its top at the baluster's two faces along the path): the bottom cut
        const p0 = pointAt(path, cumulative, Math.max(0, s - balusterSize / 2));
        const p1 = pointAt(path, cumulative, Math.min(total, s + balusterSize / 2));
        const t0 = wangaTopAt(p0, stringerModels?.[side], stringerConstruction?.[side]);
        const t1 = wangaTopAt(p1, stringerModels?.[side], stringerConstruction?.[side]);
        const run01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const wangaSlope = !baseRailHeight && t0 !== null && t1 !== null && run01 > 1e-6 ? { deg: deg(Math.atan2(t1 - t0, run01)), dir: unit({ x: p1.x - p0.x, y: p1.y - p0.y }) } : null;
        balusters.push({ treadIndex: null, position: { x: p.x, y: p.y }, zBottom: (top ?? p.z + (config.stringerTopMarginMm || 0)) + baseRailHeight, zTop: railTop(p.z) - handrailHeight, ...(wangaSlope ? { wangaSlope } : {}) });
      }
    }
  });

  // --- overlay wanga: the same rhythm on every tread, along that tread's own chain
  if (!glass && constructionType === CONSTRUCTION_TYPES.CUT) {
    for (const chain of treadChains) {
      if (!railedTreads.has(chain.index)) continue;
      const path = chain.shifted;
      const cumulative = cumulativeLengths(path);
      const length = cumulative[cumulative.length - 1];
      if (length < balusterSize + 2) continue;
      const k = Math.max(1, Math.ceil(length / pitch));
      for (let b = 0; b < k; b++) {
        const p = pointAt(path, cumulative, (length * (b + 0.5)) / k);
        const onPost = postClearances.some((post) => Math.hypot(post.position.x - p.x, post.position.y - p.y) < post.half + balusterSize / 2 + 5);
        if (onPost) continue;
        // under the handrail's OWN line (bent, corrected at a post, or carried straight to a post) — not the raw nosing
        // line
        // only along a run that carries infill (a run left bare by hand, or the stretch past a moved end, has none)
        const nearest = runNodePaths.reduce((best, r) => {
          const d = distToPolyline(r.path, p);
          return !best || d < best.d ? { d, bare: r.bare } : best;
        }, null);
        if (!nearest || nearest.bare || nearest.d > SAME_POINT_MM * 2) continue;
        const lineZ = zOnPaths(runPaths, p) ?? p.z;
        balusters.push({ treadIndex: chain.index, position: { x: p.x, y: p.y }, zBottom: chain.zFront, zTop: railTop(lineZ) - handrailHeight });
      }
    }
  }

  // A post a handrail ends at must reach at least the handrail's top there (+ the configured rise above it): the
  // handrail is a piece between two posts, so a shorter post would leave it hanging beside nothing. This section's own
  // posts are made that tall here; for the structural posts the need is handed to buildStaircase.js (postSolver.js
  // raisePostsToHandrail). A manual length correction of a post still applies on top of this nominal height.
  // --- the wall handrail past a moved end (railingPostEdits.js `wallRail`): the handrail goes on along the wall on
  // brackets — no posts, no infill, free ends — at the same height above the nosing line, its axis
  // `railingWallRailClearanceMm` + half its width off the wall (the wall: `stairwellWallGapMm` past the outer line)
  for (const w of wallRailPaths) {
    // (only on a side with a stairwell wall along it — stairwell.js wallRailAllowed)
    if (!wallRailAllowed(config, side)) {
      base.diagnostics.push(diag(section.id, 'RAILING-WALL-RAIL-SIDE', `Balustrada ${section.id}: poręcz przyścienna tylko po stronie, po której stoi ściana klatki — tu żadnej ściany, pominięta.`, 'INFO'));
      continue;
    }
    const wallRail = buildWallRail(w, { config, sign, offsetMm, centre, handrailHeight });
    if (!wallRail) continue;
    pieces.push(...wallRail.pieces);
    base.runs.push({ key: `wall-${w.which}`, startPostId: null, endPostId: null, pieces: wallRail.pieces, bent: false, wallRail: true, brackets: wallRail.brackets, startAtPostFace: false, endAtPostFace: false, startOffsetMm: 0, endOffsetMm: 0 });
  }

  const postTopNeeds = {};
  for (const run of base.runs) {
    const ends = [[run.startPostId, run.pieces[0]?.start], [run.endPostId, run.pieces[run.pieces.length - 1]?.end]];
    for (const [postId, pt] of ends) {
      if (!pt || !postId) continue;
      const need = pt.z + handrailHeight / 2 + (config.railingPostTopAboveHandrailMm || 0);
      postTopNeeds[postId] = Math.max(postTopNeeds[postId] ?? -Infinity, need);
    }
  }
  base.postTopNeeds = postTopNeeds;
  base.posts = applyPostOverrides(
    nominalPosts.map((p) => (postTopNeeds[p.postId] > p.elevation.top ? { ...p, elevation: { ...p.elevation, top: postTopNeeds[p.postId] } } : p)),
    config.manualPostOverrides
  );

  base.handrail = {
    pieces,
    totalLengthMm: pieces.reduce((sum, p) => sum + p.lengthMm, 0),
    shape: config.railingHandrailShape,
    widthMm: config.railingHandrailWidthMm,
    heightMm: handrailHeight,
  };
  base.baseRail = baseRail;
  base.balusters = balusters
    .filter((b) => b.zTop - b.zBottom > 0)
    .map((b, i) => {
      // Top: cut to the pitch of the handrail piece above it. Bottom: flat on a tread (overlay wanga), or along the
      // wanga's top edge, which runs parallel to the handrail (housed wanga) — an approximation stated in the DXF.
      const under = pitchUnder(pieces, b.position, true);
      const topCutDeg = under.deg;
      // (a housed wanga: its own top's slope where measured, else the handrail's)
      const { wangaSlope, ...rest } = b;
      const bottomCutDeg = constructionType === CONSTRUCTION_TYPES.CUT ? 0 : wangaSlope ? wangaSlope.deg : topCutDeg;
      const heightMm = b.zTop - b.zBottom;
      const half = balusterSize / 2;
      const longPointMm = heightMm + half * (Math.tan(rad(topCutDeg)) + Math.tan(rad(bottomCutDeg)));
      // `cutDir`: the plan direction both cuts rise in (zTop / zBottom are at the baluster's axis) — the 3D view cuts
      // its ends to them, so it sits on the wanga's slope with no corner in the air (user report 2026-10-26)
      return { id: `${section.id}-baluster-${i}`, ...rest, heightMm, topCutDeg, bottomCutDeg, longPointMm, cutDir: under.dir, bottomCutDir: wangaSlope ? wangaSlope.dir : under.dir };
    });
  if (uncoveredSteps.length > 0) {
    base.diagnostics.push(
      diag(
        section.id,
        'RAILING-UNCOVERED-STEPS',
        `Balustrada ${section.id}: stopnie ${uncoveredSteps.map((i) => i + 1).join(', ')} nie mają poręczy. Po stronie duszy zabiegi schodzą do jednego punktu (linia nosków idzie tam prawie pionowo), więc poręcz kończy się przy słupku i zaczyna dopiero za zakrętem. Ustaw ten odcinek po stronie zewnętrznej albo zaczekaj na poręcz giętą.`
      )
    );
  }
  if (edited && heights.length > 0) {
    base.diagnostics.push(
      diag(
        section.id,
        'RAILING-PROFILE-EDITED',
        `Balustrada ${section.id}: linia poręczy zmieniona ręcznie — góra poręczy jest ${Math.round(Math.min(...heights))}–${Math.round(Math.max(...heights))} mm nad linią nosków (ustawiona wysokość: ${config.railingHeightMm} mm).`,
        'INFO'
      )
    );
  }
  if (skippedPoints > 0) {
    base.diagnostics.push(diag(section.id, 'RAILING-PROFILE-POINT-SKIPPED', `Balustrada ${section.id}: ${skippedPoints} ręcznych punktów poręczy leży poza swoim biegiem (bieg się skrócił albo zmienił) — pominięte. Usuń je w edytorze „Profil poręczy” (Resetuj bieg).`, 'INFO'));
  }
  base.heightAboveNosing = heights.length ? { minMm: Math.min(...heights), maxMm: Math.max(...heights) } : null;
  const steps = joins.filter((j) => j.kind === 'step').length;
  if (steps > 0) {
    base.diagnostics.push(diag(section.id, 'RAILING-RAIL-STEP', `Balustrada ${section.id}: poręcz kończy się przy słupku i zaczyna na innej wysokości w ${steps} miejscu(ach) (podest / dusza zakrętu) — połączenie ze słupkiem do dopracowania w warsztacie.`, 'INFO'));
  }
  base.valid = true;
  return base;
}

// --- The balustrade round the CEILING OPENING on the upper floor (user decisions 2026-10-19) ----------------------------
//
// The opening's edges (`ceilingFit.openingOutline`, plan, CCW) carry a balustrade standing ON THE FLOOR, the posts'
// axis `railingOpeningSetbackMm` back from the edge onto the slab, the handrail's top `railingOpeningHeightMm` above
// the floor (z = totalRise). Which edges: by default every edge but those along a stairwell wall; the edge the stair
// arrives at (its last back edge lies on it — the EXIT edge) only where the stair does not stand: the stretch the last
// tread and its two wangi take is cut out, the rest of that edge is a free edge over the drop like any other (a U's
// exit edge over its flight A). `railingOpeningEdges[i]` (true / false) overrides edge i (for the exit edge: its free
// parts). Adjacent pieces that carry it form ONE section (`opening-e<edge>` / `opening-e<edge>-b` when it starts after
// the stair), corner posts at their corners, end posts at their ends — the same runs / posts / hand-placed posts
// (railingPostEdits.js) / balusters / glass as a stair section, only level and on the floor. An end or corner where a
// post of the stair already stands (its end newel, its balustrade's last post) uses THAT post: the opening's handrail
// meets it at its face, no second post.

export const RAILING_OPENING_EXIT_MATCH_MM = 30; // the stair's last back edge this close to an edge = the exit edge
const RAILING_OPENING_WALL_MATCH_MM = 30; // an edge this close (+ wanga + gap) to a parallel wall = along the wall
const RAILING_OPENING_MIN_PIECE_MM = 100; // a free part of the exit edge shorter than this gets no balustrade
// a stair post this close to an end / corner of the opening's balustrade is THE post there (× its own size)
const RAILING_OPENING_REUSE_FACTOR = 1.5;

const distToLine = (p, a, b) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs(((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len);
};
const paramOn = (p, a, b) => {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  return ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
};
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// `overrides`: the per-edge on / off by hand ({[edge]: boolean}) — the balustrade's `railingOpeningEdges`, or another
// element along the opening's edges (openingTrimModel.js: the trim's `openingTrimEdges`).
function openingEdgeStates(outline, ctx, overrides = ctx.config.railingOpeningEdges) {
  const { planLayout, wallSegments = [], config } = ctx;
  const last = planLayout.treads[planLayout.treads.length - 1];
  const exitMid = last ? { x: (last.backEdge[0].x + last.backEdge[1].x) / 2, y: (last.backEdge[0].y + last.backEdge[1].y) / 2 } : null;
  overrides = overrides && typeof overrides === 'object' ? overrides : {};
  const wangi = config.stringerThickness || 0;
  const wallTol = RAILING_OPENING_WALL_MATCH_MM + wangi + Math.max(0, config.stairwellWallGapMm || 0);
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dir = unit({ x: b.x - a.x, y: b.y - a.y });
    const tMid = exitMid ? paramOn(exitMid, a, b) : -1;
    const exit = !!exitMid && tMid > -0.01 && tMid < 1.01 && distToLine(exitMid, a, b) <= RAILING_OPENING_EXIT_MATCH_MM;
    // the stretch of the exit edge the stair stands on: its last back edge, and one wanga thickness past each end
    let stair = null;
    if (exit) {
      const ts = last.backEdge.map((p) => paramOn(p, a, b));
      const pad = wangi / len;
      stair = [Math.max(0, Math.min(...ts) - pad), Math.min(1, Math.max(...ts) + pad)];
    }
    // the stretches of the edge a stairwell wall runs along (a wall may cover only part of its side —
    // stairwell.js wallInterval), as [t0, t1] of the edge
    const wallCuts = [];
    for (const w of wallSegments) {
      const wd = unit({ x: w.b.x - w.a.x, y: w.b.y - w.a.y });
      if (!(Math.abs(dir.x * wd.y - dir.y * wd.x) < 0.02 && distToLine(mid, w.a, w.b) <= wallTol)) continue;
      const u0 = paramOn(w.a, a, b);
      const u1 = paramOn(w.b, a, b);
      const lo = Math.max(0, Math.min(u0, u1));
      const hi = Math.min(1, Math.max(u0, u1));
      if (hi > lo) wallCuts.push([lo, hi]);
    }
    const cuts = mergeIntervals([...wallCuts.map(([t0, t1]) => ({ t0, t1, kind: 'wall' })), ...(stair ? [{ t0: stair[0], t1: stair[1], kind: 'stair' }] : [])]);
    const coveredMm = cuts.reduce((sum, c) => sum + (c.t1 - c.t0) * len, 0);
    const wallMm = mergeIntervals(wallCuts.map(([t0, t1]) => ({ t0, t1, kind: 'wall' }))).reduce((sum, c) => sum + (c.t1 - c.t0) * len, 0);
    const wall = wallMm >= len - 1; // the whole edge along a wall
    const free = len - coveredMm;
    const auto = !wall && free >= RAILING_OPENING_MIN_PIECE_MM;
    const enabled = typeof overrides[i] === 'boolean' ? overrides[i] : auto;
    return { index: i, a, b, length: len, exit, stair, wall, wallPartial: !wall && wallMm > 1, cuts, auto, enabled, overridden: typeof overrides[i] === 'boolean' };
  });
}

// Sorted, overlapping / touching intervals {t0, t1, kind} merged (a merged one is 'stair' when any part of it is).
function mergeIntervals(list) {
  const sorted = [...list].sort((x, y) => x.t0 - y.t0);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.t0 <= last.t1 + 1e-9) {
      last.t1 = Math.max(last.t1, c.t1);
      if (c.kind === 'stair') last.kind = 'stair';
    } else out.push({ ...c });
  }
  return out;
}

// The outline cut into PIECES that do or do not carry the balustrade: every edge cut where the stair stands on it (the
// exit edge) and where a wall runs along it; the parts between carry it (when the edge is on and the part is at least
// RAILING_OPENING_MIN_PIECE_MM), the cut parts never. A free part is named by the number of cuts before it ('' for
// none, then 'b', 'c', … — the exit edge's part after the stair stays '-b').
function openingPieces(states) {
  const out = [];
  for (const e of states) {
    const cuts = e.cuts || [];
    let t = 0;
    let before = 0;
    const freePart = (t0, t1, prev, next) => {
      if (t1 - t0 <= 1e-9) return;
      const part = before === 0 ? '' : String.fromCharCode(97 + before); // 'b', 'c', …
      const piece = { edge: e.index, part, a: lerp(e.a, e.b, t0), b: lerp(e.a, e.b, t1), enabled: e.enabled && (t1 - t0) * e.length >= RAILING_OPENING_MIN_PIECE_MM };
      if (next?.kind === 'stair') piece.atStairEnd = 'b';
      if (prev?.kind === 'stair') piece.atStairEnd = 'a';
      out.push(piece);
    };
    cuts.forEach((c, k) => {
      freePart(t, c.t0, cuts[k - 1], c);
      out.push({ edge: e.index, part: c.kind, a: lerp(e.a, e.b, c.t0), b: lerp(e.a, e.b, c.t1), enabled: false });
      before++;
      t = c.t1;
    });
    freePart(t, 1, cuts[cuts.length - 1], null);
  }
  return out;
}

/**
 * The opening's edges and their free PIECES (not along a wall, not where the stair arrives) — the one rule for
 * everything that runs along the opening's edges (its balustrade, its trim): {edges, pieces}, each edge with `auto` /
 * `enabled` from `overrides` ({[edge]: boolean}).
 */
export function openingEdgePieces(outline, ctx, overrides) {
  const edges = openingEdgeStates(outline, ctx, overrides);
  return { edges, pieces: openingPieces(edges) };
}

// Runs of consecutive enabled pieces, cyclically; all enabled → one closed chain.
function openingChains(pieces) {
  const n = pieces.length;
  if (pieces.every((p) => p.enabled)) return [{ pieces, closed: true }];
  const start = pieces.findIndex((p, i) => !p.enabled && pieces[(i + 1) % n].enabled);
  if (start < 0) return [];
  const chains = [];
  let current = null;
  for (let k = 1; k <= n; k++) {
    const p = pieces[(start + k) % n];
    if (p.enabled) {
      if (!current) current = { pieces: [], closed: false };
      current.pieces.push(p);
    } else if (current) {
      chains.push(current);
      current = null;
    }
  }
  if (current) chains.push(current);
  return chains;
}

function lineIntersection(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

// The chain's path: every piece moved `setback` outward (onto the slab, away from the opening), mitred where two edges
// meet; the free ends square to their own piece.
function openingChainPath(chain, setback) {
  const off = chain.pieces.map((p) => {
    const d = unit({ x: p.b.x - p.a.x, y: p.b.y - p.a.y });
    const out = { x: d.y, y: -d.x }; // outward of a CCW outline
    return { a: { x: p.a.x + out.x * setback, y: p.a.y + out.y * setback }, b: { x: p.b.x + out.x * setback, y: p.b.y + out.y * setback }, d };
  });
  const join = (u, v) => lineIntersection(u.a, u.d, v.a, v.d) ?? v.a; // (two pieces of one edge: collinear → v.a)
  const pts = [off[0].a];
  for (let k = 1; k < off.length; k++) pts.push(join(off[k - 1], off[k]));
  if (chain.closed) {
    const corner = join(off[off.length - 1], off[0]);
    pts[0] = corner;
    pts.push(corner);
  } else pts.push(off[off.length - 1].b);
  return pts;
}

function buildOpeningSection(id, path, ctx, closed) {
  const { config, stairPosts = [] } = ctx;
  const z = config.totalRise || 0;
  const height = config.railingOpeningHeightMm || 1100;
  const handrailHeight = config.railingHandrailHeightMm;
  const balusterSize = config.railingBalusterSizeMm;
  // floor balustrades: balusters or glass between posts (glass on the side of a wanga does not apply to a floor edge)
  const infill = isGlassInfill(config) ? RAILING_INFILL.GLASS_POSTS : RAILING_INFILL.BALUSTERS;
  const glass = infill === RAILING_INFILL.GLASS_POSTS;
  const base = { id, kind: 'opening', side: null, fromStep: null, toStep: null, valid: false, infill, handrail: null, runs: [], path: [], uncoveredSteps: [], balusters: [], glassPanes: [], glass: glass ? glassType(config) : null, posts: [], diagnostics: [], postSpots: [], suppressedCorners: [], baseRail: null };
  const nodes = path.map((p) => ({ x: p.x, y: p.y, z, treadIndex: null }));
  if (nodes.length < 2) return base;
  base.path = nodes.map((n) => ({ x: n.x, y: n.y }));
  let { runs, joins } = splitIntoRuns(nodes, { ...config, railingBent: false });
  if (glass) {
    const subRuns = [];
    const subJoins = [];
    runs.forEach((run, j) => {
      if (j > 0) subJoins.push(joins[j - 1]);
      splitPathAt(run, intermediatePostSplits(run, config)).forEach((piece, k) => {
        if (k > 0) subJoins.push({ kind: 'glass-post' });
        subRuns.push(piece);
      });
    });
    runs = subRuns;
    joins = subJoins;
  }
  const withEdits = applyPostEditsToRuns(id, nodes, runs, joins, infill, config, base);
  ({ runs, joins } = withEdits);
  const { sOf, sCum, startMoved, endMoved, bare } = withEdits;
  // (a closed loop has no ends to move: its start post closes it)
  const endsMovable = !closed;

  // posts: the ends (one shared post when the chain closes on itself) and every join
  const spots = [{ id: `railing-post-${id}-start`, at: runs[0][0], kind: 'start', s: sOf(runs[0][0]) ?? 0, spotKey: endsMovable ? 'start' : null, moved: endsMovable && startMoved }];
  let autoJoin = joins.reduce((n, jn) => Math.max(n, jn.autoKey ? Number(jn.autoKey.slice(5)) + 1 : 0), 0);
  joins.forEach((join, j) => {
    const at = runs[j + 1][0];
    const key = join.kind === 'manual' ? null : (join.autoKey ?? `join-${autoJoin++}`);
    spots.push({ id: join.kind === 'manual' ? manualRailingPostId(id, join.manualId) : `railing-post-${id}-${key}`, at, kind: join.kind, manualId: join.manualId, s: join.kind === 'manual' || join.kind === 'moved' ? join.s : sOf(at), spotKey: key, moved: join.kind === 'moved' });
  });
  const lastRun = runs[runs.length - 1];
  const lastNode = lastRun[lastRun.length - 1];
  spots.push(closed ? { ...spots[0], kind: 'end', s: sCum[sCum.length - 1] } : { id: `railing-post-${id}-end`, at: lastNode, kind: 'end', s: sOf(lastNode) ?? sCum[sCum.length - 1], spotKey: 'end', moved: endMoved });
  // a post of the stair standing there (its end newel, the last post of its balustrade) IS the post there
  const stairPostAt = (at) => {
    let best = null;
    for (const p of stairPosts) {
      const d = Math.hypot(p.position.x - at.x, p.position.y - at.y);
      if (d <= RAILING_OPENING_REUSE_FACTOR * p.size && (!best || d < best.d)) best = { p, d };
    }
    return best?.p ?? null;
  };
  for (const sp of spots) {
    if (sp.kind === 'manual' || sp.moved) continue;
    const existing = stairPostAt(sp.at);
    if (existing) sp.existing = existing;
  }
  const railTop = z + height;
  const topOfPost = railTop + (config.railingPostTopAboveHandrailMm || 0);
  const unique = [...new Map(spots.filter((sp) => !sp.existing).map((sp) => [sp.id, sp])).values()];
  const nominal = unique.map((sp) => ({
    postId: sp.id,
    kind: 'railing',
    ...(sp.kind === 'manual' ? { manual: true, sectionId: id, manualId: sp.manualId, s: sp.s } : {}),
    position: { x: sp.at.x, y: sp.at.y },
    elevation: { bottom: z, top: topOfPost },
    size: config.railingPostSizeMm,
  }));
  base.posts = applyPostOverrides(nominal, config.manualPostOverrides);
  const postIdOf = (sp) => sp.existing?.postId ?? sp.id;
  const postOf = (sp) => sp.existing ?? base.posts.find((p) => p.postId === sp.id && !p.removed) ?? null;
  const halfOf = (sp) => (postOf(sp)?.size ?? 0) / 2;
  base.postSpots = spots.slice(0, closed ? -1 : undefined).map((sp) => ({ postId: postIdOf(sp), spotId: sp.id, kind: sp.kind, s: sp.s, at: { x: sp.at.x, y: sp.at.y }, manualId: sp.manualId ?? null, reused: !!sp.existing, suppressible: sp.kind === 'corner' && !glass && !sp.existing, spotKey: sp.spotKey ?? null, movable: sp.kind === 'manual' || sp.kind === 'moved' || (!!sp.spotKey && (sp.kind === 'start' || sp.kind === 'end' || (sp.kind === 'corner' && !glass))), moved: !!sp.moved }));
  base.wallRailEnds = { start: false, end: false };

  const centreZ = railTop - handrailHeight / 2;
  const maxClear = config.railingMaxClearMm;
  const pitch = maxClear + balusterSize;
  const pieces = [];
  const balusters = [];
  const postTopNeeds = {};
  runs.forEach((run, j) => {
    const startPost = postOf(spots[j]);
    const endPost = postOf(spots[j + 1]);
    const fit = fitPathToPosts(simplifyPath(run), startPost, endPost);
    const runPath = fit.path;
    const runPieces = [];
    for (let i = 0; i < runPath.length - 1; i++) {
      const start = { x: runPath[i].x, y: runPath[i].y, z: centreZ };
      const end = { x: runPath[i + 1].x, y: runPath[i + 1].y, z: centreZ };
      runPieces.push({ start, end, lengthMm: Math.hypot(end.x - start.x, end.y - start.y) });
    }
    annotateCuts(runPieces, handrailHeight);
    pieces.push(...runPieces);
    const startPostId = postIdOf(spots[j]);
    const endPostId = postIdOf(spots[j + 1]);
    // a stair post the opening's handrail meets reaches at least that handrail's top (postSolver.js raisePostsToHandrail)
    for (const sp of [spots[j], spots[j + 1]]) if (sp.existing) postTopNeeds[sp.existing.postId] = Math.max(postTopNeeds[sp.existing.postId] ?? -Infinity, topOfPost);
    const runKey = railingRunKey(startPostId, endPostId);
    const bareRun = bare.has(runKey);
    base.runs.push({ key: runKey, startPostId, endPostId, pieces: runPieces, bent: false, bare: bareRun, startAtPostFace: fit.startFitted, endAtPostFace: fit.endFitted, startOffsetMm: 0, endOffsetMm: 0 });
    if (bareRun) return; // the handrail on its two posts only (railingPostEdits.js `bare`)
    if (glass) {
      const result = panesForRun(run, { config, sectionId: id, runIndex: j, startClearMm: halfOf(spots[j]), endClearMm: halfOf(spots[j + 1]), railBottomAt: () => railTop - handrailHeight, groundAt: () => z });
      base.glassPanes.push(...result.panes);
      for (const message of result.diagnostics) base.diagnostics.push(diag(id, 'RAILING-GLASS-PANE-LOW', `Balustrada ${id}: ${message}`));
    } else {
      // balusters spread evenly along the run, standing on the floor
      const cumulative = cumulativeLengths(runPath);
      const total = cumulative[cumulative.length - 1];
      const startHalf = fit.startFitted ? 0 : halfOf(spots[j]);
      const endHalf = fit.endFitted ? 0 : halfOf(spots[j + 1]);
      const usable = total - startHalf - endHalf;
      const count = usable > maxClear ? Math.ceil((usable - maxClear) / pitch) : 0;
      const gap = (usable - count * balusterSize) / (count + 1);
      for (let b = 0; b < count; b++) {
        const p = pointAt(runPath, cumulative, startHalf + gap * (b + 1) + balusterSize * b + balusterSize / 2);
        balusters.push({ treadIndex: null, position: { x: p.x, y: p.y }, zBottom: z, zTop: railTop - handrailHeight });
      }
    }
  });
  base.handrail = { pieces, totalLengthMm: pieces.reduce((sum, p) => sum + p.lengthMm, 0), shape: config.railingHandrailShape, widthMm: config.railingHandrailWidthMm, heightMm: handrailHeight };
  base.balusters = balusters.filter((b) => b.zTop - b.zBottom > 0).map((b, i) => ({ id: `${id}-baluster-${i}`, ...b, heightMm: b.zTop - b.zBottom, topCutDeg: 0, bottomCutDeg: 0, longPointMm: b.zTop - b.zBottom }));
  base.heightAboveNosing = { minMm: height, maxMm: height };
  base.postTopNeeds = postTopNeeds;
  base.valid = pieces.length > 0;
  return base;
}

/**
 * Where the stair's END NEWEL goes when the opening's balustrade ends at it (user decision 2026-10-19): onto the slab,
 * its centre on that balustrade's line (`railingOpeningSetbackMm` back from the exit edge), so the opening's handrail
 * meets its face straight and the stair's handrail and inner wanga run on to it. Null when the opening has no
 * balustrade on the free part of the exit edge next to the stair's INNER side (the end newel stands there).
 * Returns { linePoint, outward } — the balustrade's line (a point on it, the unit normal pointing onto the slab) —
 * and the exit edge { a, b } (the slab's edge, where the wanga's end over the slab starts).
 * `ctx`: { config, planLayout, openingOutline, wallSegments } — available before any stringer / post is built.
 */
export function endNewelOntoSlab(ctx) {
  const { config, planLayout, openingOutline } = ctx;
  if (!config.railingOpeningEnabled || !Array.isArray(openingOutline) || openingOutline.length < 3) return null;
  const last = planLayout.treads[planLayout.treads.length - 1];
  if (!last) return null;
  const edges = openingEdgeStates(openingOutline, ctx);
  const exit = edges.find((e) => e.stair);
  if (!exit) return null;
  const pieces = openingPieces(edges).filter((p) => p.edge === exit.index);
  // the free part of the exit edge on the inner side of the stair (the end newel's side)
  const tInner = paramOn(last.backEdge[0], exit.a, exit.b);
  const tOuter = paramOn(last.backEdge[1], exit.a, exit.b);
  const piece = pieces.find((p) => p.atStairEnd === (tInner < tOuter ? 'b' : 'a'));
  if (!piece?.enabled) return null;
  const d = unit({ x: exit.b.x - exit.a.x, y: exit.b.y - exit.a.y });
  const outward = { x: d.y, y: -d.x }; // outward of a CCW outline = onto the slab
  const setback = Math.max(0, Number(config.railingOpeningSetbackMm) || 0);
  return { linePoint: { x: exit.a.x + outward.x * setback, y: exit.a.y + outward.y * setback }, outward, edge: { a: exit.a, b: exit.b } };
}

/**
 * The balustrade round the ceiling opening: the edge states (for the plan's toggles) and one section per chain of
 * enabled pieces. `ctx`: { config, planLayout, openingOutline (plan, CCW), wallSegments ([{a, b}] plan), stairPosts
 * (the stair's standing posts: structural + its balustrade's) }.
 */
export function buildOpeningRailing(ctx) {
  const { config, openingOutline } = ctx;
  if (!config.railingOpeningEnabled || !Array.isArray(openingOutline) || openingOutline.length < 3) return { edges: [], sections: [] };
  const edges = openingEdgeStates(openingOutline, ctx);
  const setback = Math.max(0, Number(config.railingOpeningSetbackMm) || 0);
  const sections = openingChains(openingPieces(edges)).map((chain) => {
    const first = chain.pieces[0];
    return buildOpeningSection(`opening-e${first.edge}${first.part ? `-${first.part}` : ''}`, openingChainPath(chain, setback), ctx, chain.closed);
  });
  return { edges, sections };
}

/**
 * @param {Object} models
 * @param {import('./planLayout.js').PlanLayout} models.planLayout
 * @param {Object[]} models.treadModels
 * @param {{outer:Object, inner:Object}} [models.stringerModels]
 * @param {{outer:Object[], inner:Object[]}} [models.stringerConstruction]
 * @param {Object[]} [models.postModels]  the posts that exist (postSolver.js buildPostModels)
 * @param {Object} config  full config incl. `riserHeight`
 */
export function buildRailingModel({ planLayout, treadModels, stringerModels, stringerConstruction, postModels, openingOutline = null, wallSegments = [] }, config) {
  const empty = { enabled: false, sections: [], posts: [], diagnostics: [], openingEdges: [] };
  if (!config.railingEnabled && !config.railingOpeningEnabled) return empty;
  const ctx = { config, planLayout, treadModels, stringerModels, stringerConstruction, postModels, riserHeight: config.riserHeight };
  const stairSections = config.railingEnabled ? sanitizeRailingSections(config.railingSections).map((s) => buildSection(s, ctx)) : [];
  // the balustrade round the ceiling opening on the upper floor (buildOpeningRailing above)
  // (it ends on the stair's own posts where they stand: the structural ones and the stair balustrade's)
  const stairPosts = [...(postModels || []), ...stairSections.flatMap((sec) => sec.posts.filter((p) => !p.removed))];
  const opening = buildOpeningRailing({ config, planLayout, openingOutline, wallSegments, stairPosts });
  const sections = [...stairSections, ...opening.sections];
  const postTopNeeds = {};
  for (const s of sections) for (const [postId, need] of Object.entries(s.postTopNeeds || {})) postTopNeeds[postId] = Math.max(postTopNeeds[postId] ?? -Infinity, need);
  return {
    enabled: true,
    sections,
    openingEdges: opening.edges,
    postTopNeeds,
    posts: sections.flatMap((s) => s.posts),
    diagnostics: sections.flatMap((s) => s.diagnostics),
  };
}
