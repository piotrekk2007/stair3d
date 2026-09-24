// RailingModel — plain-data description of the balustrade (handrail + balusters + end posts), fully
// independent of Three.js (railingRenderer.js is the ONLY consumer that builds meshes). See
// docs/architecture/RAILING_MODEL.md for the plan and the decisions behind it.
//
// The balustrade DEPENDS on the treads and the wangi, never the other way round (RULES.md #6): it reads
// the solved plan layout / tread models / stringer models + construction geometry and existing posts, and
// changes none of them.
//
// A balustrade is a list of SECTIONS (`config.railingSections`): { id, side, fromStep, toStep } — one
// handrail run on one side from tread `fromStep` to tread `toStep` (0-based tread indices, the same
// numbering as `step-N`; `toStep: null` = up to the last tread). A stair can therefore have a balustrade
// that starts at the 3rd step, on one flight only, or on one side only.
//
// Geometry (all mm, plan x/y + world elevation z):
//  * path: the wanga's own reference line (tread chain) on that side, from the FRONT of tread `fromStep`
//    to the BACK of tread `toStep`, moved sideways to the wanga's centre line (`railingLateralOffsetMm`,
//    default half the wanga thickness, toward the stair interior — the way the wanga board extrudes).
//  * heights: the "nosing line" runs through the tread tops at the front edges, rising one riser height per
//    tread: z(front of tread i) = (i+1)*riserHeight, z(back of tread i) = (i+2)*riserHeight. The handrail's
//    TOP sits `railingHeightMm` above that line.
//  * housed wanga (`closed`): balusters are spread evenly along the handrail and stand on the wanga's top
//    edge — the spacing is whatever keeps every clear opening <= `railingMaxClearMm`.
//  * overlay wanga (`cut`): balusters stand on the treads with the SAME rhythm on every tread (k per tread,
//    evenly spread over that tread's own length, k from the clear-opening limit), so each tread carries them
//    identically and their heights differ from tread to tread.
//  * straight flights only for now: a section that crosses a turn is built from the same rules but the
//    handrail is a polyline of straight pieces (no bent handrail, no mitred joints — later stage).

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

const POST_REUSE_TOLERANCE_FACTOR = 1; // an existing post closer than one post size to a section end is reused

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

// Removes vertices that lie on the straight line between their neighbours (3D), so one straight flight is
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

function buildSection(section, ctx) {
  const { config, planLayout, treadModels, stringerModels, stringerConstruction, postModels, riserHeight } = ctx;
  const treadCount = planLayout.treads.length;
  const fromStep = section.fromStep;
  const toStep = section.toStep === null ? treadCount - 1 : section.toStep;
  const base = { id: section.id, side: section.side, fromStep, toStep, valid: false, handrail: null, balusters: [], posts: [], diagnostics: [] };
  if (fromStep > toStep || toStep >= treadCount) {
    base.diagnostics.push(diag(section.id, 'RAILING-SECTION-INVALID', `Odcinek balustrady ${section.id}: stopnie ${fromStep + 1}–${toStep + 1} są poza schodami albo w złej kolejności — odcinek pominięty.`));
    return base;
  }

  const side = section.side;
  const constructionType = constructionTypeForSide(config, side);
  const offsetMm = config.railingLateralOffsetMm ?? (config.stringerThickness || 0) / 2;
  const sign = side === 'outer' ? 1 : -1;
  const shifted = (point, direction) => {
    const across = rotate90CW(unit(direction));
    return { x: point.x + across.x * sign * offsetMm, y: point.y + across.y * sign * offsetMm };
  };
  const nosingZ = (index) => (index + 1) * riserHeight;
  const handrailHeight = config.railingHandrailHeightMm;
  const railTop = (z) => z + config.railingHeightMm;
  const balusterSize = config.railingBalusterSizeMm;

  // Points of the wanga's reference line per tread (front, back) — moved to the wanga's centre line.
  const treadEdges = [];
  for (let i = fromStep; i <= toStep; i++) {
    const chain = sideChain(planLayout.treads[i], side);
    const direction = treadModels[i].direction;
    treadEdges.push({ index: i, front: shifted(chain[0], direction), back: shifted(chain[chain.length - 1], direction) });
  }

  const pathPoints = treadEdges.map((e) => ({ ...e.front, z: nosingZ(e.index) }));
  const last = treadEdges[treadEdges.length - 1];
  pathPoints.push({ ...last.back, z: nosingZ(last.index) + riserHeight });
  const path = simplifyPath(pathPoints);

  // --- handrail (centre line of the profile: its TOP is `railingHeightMm` above the nosing line)
  const centre = (p) => ({ x: p.x, y: p.y, z: railTop(p.z) - handrailHeight / 2 });
  const pieces = [];
  for (let i = 0; i < path.length - 1; i++) {
    const start = centre(path[i]);
    const end = centre(path[i + 1]);
    pieces.push({ start, end, lengthMm: Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) });
  }
  base.handrail = {
    pieces,
    totalLengthMm: pieces.reduce((sum, p) => sum + p.lengthMm, 0),
    shape: config.railingHandrailShape,
    widthMm: config.railingHandrailWidthMm,
    heightMm: handrailHeight,
  };

  // --- end posts: reuse an existing post standing at the section end, otherwise add one
  const reuseDistance = config.postSize * POST_REUSE_TOLERANCE_FACTOR;
  const existingNear = (p) => (postModels || []).find((post) => Math.hypot(post.position.x - p.x, post.position.y - p.y) < reuseDistance) ?? null;
  const stairDepth = config.minimumStringerDepthMm || 0;
  // Half of the post width at each end of the handrail (what the baluster spacing must leave free): a reused
  // structural post counts with its own size, a new one with its (possibly hand-edited) size, a removed one with 0.
  const endHalf = { start: 0, end: 0 };
  const nominalPosts = [];
  [['start', path[0]], ['end', path[path.length - 1]]].forEach(([which, p]) => {
    const existing = existingNear(p);
    if (existing) {
      endHalf[which] = existing.size / 2;
      return;
    }
    nominalPosts.push({
      postId: `railing-post-${section.id}-${which}`,
      kind: 'railing',
      position: { x: p.x, y: p.y },
      elevation: { bottom: Math.max(0, p.z - stairDepth), top: railTop(p.z) + (config.railingPostTopAboveHandrailMm || 0) },
      size: config.railingPostSizeMm,
    });
  });
  base.posts = applyPostOverrides(nominalPosts, config.manualPostOverrides);
  for (const post of base.posts) endHalf[post.postId.endsWith('-start') ? 'start' : 'end'] = post.removed ? 0 : post.size / 2;

  // --- balusters
  const balusters = [];
  const maxClear = config.railingMaxClearMm;
  const pitch = maxClear + balusterSize; // largest allowed centre-to-centre distance
  if (constructionType === CONSTRUCTION_TYPES.CUT) {
    for (const edge of treadEdges) {
      const length = Math.hypot(edge.back.x - edge.front.x, edge.back.y - edge.front.y);
      if (length < balusterSize + 2) continue;
      const k = Math.max(1, Math.ceil(length / pitch));
      const zTread = nosingZ(edge.index);
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const x = edge.front.x + (edge.back.x - edge.front.x) * t;
        const y = edge.front.y + (edge.back.y - edge.front.y) * t;
        const zTop = railTop(zTread + riserHeight * t) - handrailHeight;
        balusters.push({ treadIndex: edge.index, position: { x, y }, zBottom: zTread, zTop });
      }
    }
  } else {
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    const total = cumulative[cumulative.length - 1];
    const usable = total - endHalf.start - endHalf.end;
    const n = usable > maxClear ? Math.ceil((usable - maxClear) / pitch) : 0;
    const gap = (usable - n * balusterSize) / (n + 1);
    for (let j = 0; j < n; j++) {
      const s = endHalf.start + gap * (j + 1) + balusterSize * j + balusterSize / 2;
      const p = pointAt(path, cumulative, s);
      const top = wangaTopAt(p, stringerModels?.[side], stringerConstruction?.[side]);
      const zBottom = top ?? p.z + (config.stringerTopMarginMm || 0);
      balusters.push({ treadIndex: null, position: { x: p.x, y: p.y }, zBottom, zTop: railTop(p.z) - handrailHeight });
    }
  }
  base.balusters = balusters.map((b, i) => ({ id: `${section.id}-baluster-${i}`, ...b, heightMm: b.zTop - b.zBottom }));
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
