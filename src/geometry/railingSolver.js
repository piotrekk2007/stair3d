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
import { curveToPolyline } from './profileCurve.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

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

// Splits the flat node list into runs (see the header) and reports the joins between them.
function splitIntoRuns(nodes, config) {
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
        if (cos < cornerCos) {
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

function buildSection(section, ctx) {
  const { config, planLayout, stringerModels, stringerConstruction, postModels, riserHeight } = ctx;
  const treadCount = planLayout.treads.length;
  const fromStep = section.fromStep;
  const toStep = section.toStep === null ? treadCount - 1 : section.toStep;
  const base = { id: section.id, side: section.side, fromStep, toStep, valid: false, handrail: null, runs: [], path: [], uncoveredSteps: [], balusters: [], posts: [], diagnostics: [] };
  if (fromStep > toStep || toStep >= treadCount) {
    base.diagnostics.push(diag(section.id, 'RAILING-SECTION-INVALID', `Odcinek balustrady ${section.id}: stopnie ${fromStep + 1}–${toStep + 1} są poza schodami albo w złej kolejności — odcinek pominięty.`));
    return base;
  }

  const side = section.side;
  const constructionType = constructionTypeForSide(config, side);
  const offsetMm = config.railingLateralOffsetMm ?? (config.stringerThickness || 0) / 2;
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

  const { runs, joins } = splitIntoRuns(nodes, config);

  // Treads that carry no handrail at all: every node of theirs fell into a run that was too short to hold one (the
  // dusza side of a winder, where the treads shrink to a point). Their balusters would stand under nothing.
  const railedNodes = new Set(runs.flat());
  const railedTreads = new Set(nodes.filter((n) => railedNodes.has(n)).map((n) => n.treadIndex));
  const representedTreads = new Set(nodes.map((n) => n.treadIndex));
  const uncoveredSteps = treadChains.map((c) => c.index).filter((i) => representedTreads.has(i) && !railedTreads.has(i));
  base.uncoveredSteps = uncoveredSteps;

  // --- posts: one at the section start, one at the end, one at every join between two runs. An existing
  // structural post standing there is reused; a new one is a normal, editable railing post.
  const reuseDistance = config.postSize * POST_REUSE_TOLERANCE_FACTOR;
  const existingNear = (p) => (postModels || []).find((post) => Math.hypot(post.position.x - p.x, post.position.y - p.y) < reuseDistance) ?? null;
  const stairDepth = config.minimumStringerDepthMm || 0;
  const spots = [];
  spots.push({ id: `railing-post-${section.id}-start`, at: runs[0][0], zs: [runs[0][0].z] });
  joins.forEach((join, j) => {
    const endOfPrev = runs[j][runs[j].length - 1];
    const startOfNext = runs[j + 1][0];
    spots.push({
      id: `railing-post-${section.id}-join-${j}`,
      at: { x: (endOfPrev.x + startOfNext.x) / 2, y: (endOfPrev.y + startOfNext.y) / 2 },
      zs: [endOfPrev.z, startOfNext.z],
      kind: join.kind,
    });
  });
  const lastRun = runs[runs.length - 1];
  spots.push({ id: `railing-post-${section.id}-end`, at: lastRun[lastRun.length - 1], zs: [lastRun[lastRun.length - 1].z] });

  const halves = new Map(); // post id -> half width the spacing must leave free
  // The post that really stands at each spot: a reused structural post keeps ITS id, so a run's start/end post id
  // always names an existing PostModel (the structural check and the Inspektor look posts up by it).
  const postIdAt = new Map();
  const nominalPosts = [];
  for (const spot of spots) {
    const existing = existingNear(spot.at);
    if (existing) {
      halves.set(spot.id, existing.size / 2);
      postIdAt.set(spot.id, existing.postId);
      continue;
    }
    postIdAt.set(spot.id, spot.id);
    nominalPosts.push({
      postId: spot.id,
      kind: 'railing',
      position: { x: spot.at.x, y: spot.at.y },
      elevation: { bottom: Math.max(0, Math.min(...spot.zs) - stairDepth), top: railTop(Math.max(...spot.zs)) + (config.railingPostTopAboveHandrailMm || 0) },
      size: config.railingPostSizeMm,
    });
  }
  base.posts = applyPostOverrides(nominalPosts, config.manualPostOverrides);
  for (const post of base.posts) halves.set(post.postId, post.removed ? 0 : post.size / 2);
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
  runs.forEach((run, j) => {
    const path = simplifyPath(run);
    const runPieces = [];
    for (let i = 0; i < path.length - 1; i++) {
      const start = centre(path[i]);
      const end = centre(path[i + 1]);
      runPieces.push({ start, end, lengthMm: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) });
    }
    pieces.push(...runPieces);
    base.runs.push({ startPostId: postIdAt.get(spots[j].id), endPostId: postIdAt.get(spots[j + 1].id), pieces: runPieces });

    if (constructionType !== CONSTRUCTION_TYPES.CUT) {
      // Housed wanga: evenly spread along this run, standing on the wanga's top edge.
      const cumulative = cumulativeLengths(path);
      const total = cumulative[cumulative.length - 1];
      const startHalf = halfAt(spots[j]);
      const endHalf = halfAt(spots[j + 1]);
      const usable = total - startHalf - endHalf;
      const n = usable > maxClear ? Math.ceil((usable - maxClear) / pitch) : 0;
      const gap = (usable - n * balusterSize) / (n + 1);
      for (let b = 0; b < n; b++) {
        const s = startHalf + gap * (b + 1) + balusterSize * b + balusterSize / 2;
        const p = pointAt(path, cumulative, s);
        const top = wangaTopAt(p, stringerModels?.[side], stringerConstruction?.[side]);
        balusters.push({ treadIndex: null, position: { x: p.x, y: p.y }, zBottom: top ?? p.z + (config.stringerTopMarginMm || 0), zTop: railTop(p.z) - handrailHeight });
      }
    }
  });

  // --- overlay wanga: the same rhythm on every tread, along that tread's own chain
  if (constructionType === CONSTRUCTION_TYPES.CUT) {
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
        balusters.push({ treadIndex: chain.index, position: { x: p.x, y: p.y }, zBottom: chain.zFront, zTop: railTop(p.z) - handrailHeight });
      }
    }
  }

  base.handrail = {
    pieces,
    totalLengthMm: pieces.reduce((sum, p) => sum + p.lengthMm, 0),
    shape: config.railingHandrailShape,
    widthMm: config.railingHandrailWidthMm,
    heightMm: handrailHeight,
  };
  base.balusters = balusters.filter((b) => b.zTop - b.zBottom > 0).map((b, i) => ({ id: `${section.id}-baluster-${i}`, ...b, heightMm: b.zTop - b.zBottom }));
  if (uncoveredSteps.length > 0) {
    base.diagnostics.push(
      diag(
        section.id,
        'RAILING-UNCOVERED-STEPS',
        `Balustrada ${section.id}: stopnie ${uncoveredSteps.map((i) => i + 1).join(', ')} nie mają poręczy. Po stronie duszy zabiegi schodzą do jednego punktu (linia nosków idzie tam prawie pionowo), więc poręcz kończy się przy słupku i zaczyna dopiero za zakrętem. Ustaw ten odcinek po stronie zewnętrznej albo zaczekaj na poręcz giętą.`
      )
    );
  }
  const steps = joins.filter((j) => j.kind === 'step').length;
  if (steps > 0) {
    base.diagnostics.push(diag(section.id, 'RAILING-RAIL-STEP', `Balustrada ${section.id}: poręcz kończy się przy słupku i zaczyna na innej wysokości w ${steps} miejscu(ach) (podest / dusza zakrętu) — połączenie ze słupkiem do dopracowania w warsztacie.`, 'INFO'));
  }
  base.valid = true;
  return base;
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
export function buildRailingModel({ planLayout, treadModels, stringerModels, stringerConstruction, postModels }, config) {
  const empty = { enabled: false, sections: [], posts: [], diagnostics: [] };
  if (!config.railingEnabled) return empty;
  const ctx = { config, planLayout, treadModels, stringerModels, stringerConstruction, postModels, riserHeight: config.riserHeight };
  const sections = sanitizeRailingSections(config.railingSections).map((s) => buildSection(s, ctx));
  return {
    enabled: true,
    sections,
    posts: sections.flatMap((s) => s.posts),
    diagnostics: sections.flatMap((s) => s.diagnostics),
  };
}
