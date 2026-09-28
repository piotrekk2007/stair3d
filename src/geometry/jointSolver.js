// JOINT MODEL — how the elements of the stair are joined, as plain data (no Three.js, no DXF). Every consumer draws
// the SAME joint: the 3D post gets the pocket (postRenderer.js), the post DXF shows it on the unfolded faces
// (dxfExport.js), the stringer DXF marks where the board enters the post. Nothing here moves a board — the board's
// length at a post is already decided by stringerConstructionGeometry.js (ends.*.intoPost); this file only derives
// what has to be machined into the OTHER element so the two fit.
//
// Stage 1 (user decision 2026-09-28): stringer ↔ structural post = a full-section housing (wręg): the stringer enters
// a pocket milled into the post face, `postHousingDepthMm` deep. The pocket is a plain rectangle in the face (a CNC
// pocket with walls square to the face): as wide as the board is thick, and as tall as the board's cross-section
// over the whole depth it enters (a raked board shifts up/down inside the pocket), clipped to the post's own height —
// an end that sticks out above/below the post is an OPEN pocket there (openTop/openBottom).
//
// Post faces are named by the plan direction their outward normal points to: E (+x), N (+y), W (−x), S (−y); posts
// are axis-aligned squares (postRenderer.js BoxGeometry). A face's horizontal coordinate `s` runs to the RIGHT of a
// viewer standing outside the face, looking at it (0 = the post's centre line); `z` is world elevation.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { GEOMETRY_EPS } from './tolerances.js';
import { subtractConvex, clipToConvex, polygonArea } from './polygonClip.js';
import { buildConnectors } from './jointConnectors.js';

const MIN_OVERLAP_MM2 = 1; // a tread/riser touching a post by less than this is not a joint
// A post cutting a tread in two keeps the larger piece; the smaller one is just cut off (typically the narrow tip of a
// winder behind a corner post). It is only reported when it is a real part of the tread (a judgement threshold).
const SPLIT_WARN_FRACTION = 0.05;

export const POST_FACES = Object.freeze({
  E: { id: 'E', normal: { x: 1, y: 0 }, label: '+X' },
  N: { id: 'N', normal: { x: 0, y: 1 }, label: '+Y' },
  W: { id: 'W', normal: { x: -1, y: 0 }, label: '-X' },
  S: { id: 'S', normal: { x: 0, y: -1 }, label: '-Y' },
});
// Order the faces are laid out in the post DXF: walking round the post (each face's right edge meets the next one's left).
export const POST_FACE_ORDER = Object.freeze(['S', 'E', 'N', 'W']);

const FACE_SKEW_COS = Math.cos((5 * Math.PI) / 180); // a board more than 5° off a face's normal is reported

/** The horizontal axis of a face, pointing to the viewer's right (viewer outside, looking at the face). */
export function faceAxis(faceId) {
  const n = POST_FACES[faceId].normal;
  return { x: -n.y, y: n.x };
}

/** The face whose outward normal is closest to `dir`, and how well it matches (cosine). */
export function nearestFace(dir) {
  let best = null;
  for (const face of Object.values(POST_FACES)) {
    const c = face.normal.x * dir.x + face.normal.y * dir.y;
    if (!best || c > best.cos) best = { faceId: face.id, cos: c };
  }
  return best;
}

// Lowest and highest v of a closed (u,v) outline within u ∈ [u0, u1] (vertices inside plus every edge's crossings of
// the two bounds). null when the outline does not reach the interval.
export function vRangeWithin(outline, u0, u1) {
  const vs = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (a.u >= u0 - GEOMETRY_EPS && a.u <= u1 + GEOMETRY_EPS) vs.push(a.v);
    for (const u of [u0, u1]) {
      if ((a.u - u) * (b.u - u) < 0) vs.push(a.v + ((b.v - a.v) * (u - a.u)) / (b.u - a.u));
    }
  }
  return vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : null;
}

function finding(severity, ruleId, elementId, message, extra = {}) {
  return createDiagnostic({ ruleId, severity, elementType: 'post', elementId, parameter: 'postHousingDepthMm', message, ...extra });
}

const square = (c, h) => [
  { x: c.x - h, y: c.y - h },
  { x: c.x + h, y: c.y - h },
  { x: c.x + h, y: c.y + h },
  { x: c.x - h, y: c.y + h },
];

/** The strip of a post between face `faceId` and the core `depth` further in, across the whole face (plan polygon). */
function faceBand(post, faceId, depth) {
  const n = POST_FACES[faceId].normal;
  const a = faceAxis(faceId);
  const h = post.size / 2;
  const pt = (k, s) => ({ x: post.position.x + n.x * k + a.x * s, y: post.position.y + n.y * k + a.y * s });
  return [pt(h - depth, -h), pt(h, -h), pt(h, h), pt(h - depth, h)];
}

/** How deep a tread / riser enters a post's pocket (etap 2) — never negative, never through the post. */
export function postTreadHousingDepthMm(config, postSize) {
  const d = Number(config?.postTreadHousingDepthMm);
  const depth = Number.isFinite(d) && d > 0 ? d : 0;
  return Math.min(depth, Math.max(0, postSize / 2 - 1));
}

// The plan rectangle a riser panel occupies (riserRenderer.js extrudes the panel line by the thickness — forward,
// under the tread, for an ordinary riser).
export function riserPanelPolygon(riser, panel) {
  const sign = riser.inward ? 1 : -1;
  const e = { x: panel.direction.x * riser.thickness * sign, y: panel.direction.y * riser.thickness * sign };
  return [panel.p0, panel.p1, { x: panel.p1.x + e.x, y: panel.p1.y + e.y }, { x: panel.p0.x + e.x, y: panel.p0.y + e.y }];
}

/**
 * Stage 2: an element (tread / riser panel) that passes through a structural post is cut around it (outline minus the
 * post's core) and enters a pocket in every face it crosses. Returns the new outline (largest piece), its holes, and
 * the pockets; `null` when the element does not reach the post.
 */
// A rectangle in a face's own frame: `k` along the face normal (from the post's centre), `s` along the face axis.
function faceRect(post, faceId, k0, k1, s0, s1) {
  const n = POST_FACES[faceId].normal;
  const a = faceAxis(faceId);
  const pt = (k, sv) => ({ x: post.position.x + n.x * k + a.x * sv, y: post.position.y + n.y * k + a.y * sv });
  return [pt(k0, s0), pt(k1, s0), pt(k1, s1), pt(k0, s1)];
}

/**
 * What to take out of an element at a post, and where it keeps a tongue:
 *  - ordinary post: everything inside the core (post square shrunk by the depth) — the element keeps a tongue in the
 *    band of EVERY face it crosses;
 *  - corner post (user decision 2026-09-28: no "fork" of thin prongs round the post's corner): the element is cut FLUSH
 *    with the post faces and keeps ONE tongue — on the face it bears on most, only within that face's middle part (not
 *    its corner strips), so it never wraps the corner. No contact with a face's middle part = flush, no tongue.
 * Returns { rects: convex polygons to subtract, bands: [{faceId, band}] where tongues/pockets are }.
 */
function removalAtPost(outline, post, depth, singleFace) {
  const h = post.size / 2;
  if (!(depth > 0)) return { rects: [square(post.position, h)], bands: [] };
  if (!singleFace) return { rects: [square(post.position, h - depth)], bands: POST_FACE_ORDER.map((faceId) => ({ faceId, band: faceBand(post, faceId, depth) })) };
  let best = null;
  for (const faceId of POST_FACE_ORDER) {
    const band = faceRect(post, faceId, h - depth, h, -(h - depth), h - depth);
    const area = polygonArea(clipToConvex(outline, band));
    if (area >= MIN_OVERLAP_MM2 && (!best || area > best.area)) best = { faceId, band, area };
  }
  if (!best) return { rects: [square(post.position, h)], bands: [] };
  const f = best.faceId;
  return {
    rects: [faceRect(post, f, -h, h - depth, -h, h), faceRect(post, f, h - depth, h, -h, -(h - depth)), faceRect(post, f, h - depth, h, h - depth, h)],
    bands: [{ faceId: f, band: best.band }],
  };
}

// Subtract convex polygons one after another, keeping the largest piece each time; returns the kept piece, how many
// pieces the element fell into at the worst step, and the area cut off (all pieces but the kept one).
function subtractAll(outline, rects) {
  let kept = { outer: outline, holes: [] };
  let dropped = 0;
  let maxPieces = 1;
  let total = polygonArea(outline);
  for (const r of rects) {
    const pieces = subtractConvex(kept.outer, r);
    if (pieces.length === 0) return { kept: null, maxPieces: 0, droppedMm2: total, total };
    const sorted = pieces.slice().sort((p, q) => polygonArea(q.outer) - polygonArea(p.outer));
    const real = pieces.filter((p) => polygonArea(p.outer) > MIN_OVERLAP_MM2).length;
    maxPieces = Math.max(maxPieces, real);
    dropped += pieces.reduce((sum, p) => sum + polygonArea(p.outer), 0) - polygonArea(sorted[0].outer);
    kept = { outer: sorted[0].outer, holes: [...kept.holes, ...sorted[0].holes] };
  }
  return { kept, maxPieces, droppedMm2: dropped, total };
}

function cutAroundPost(outline, post, depth, zRange) {
  if (!(zRange.top > post.elevation.bottom + GEOMETRY_EPS && zRange.bottom < post.elevation.top - GEOMETRY_EPS)) return null;
  const h = post.size / 2;
  if (polygonArea(clipToConvex(outline, square(post.position, h))) < MIN_OVERLAP_MM2) return null;
  const removal = removalAtPost(outline, post, depth, post.kind === 'corner');
  const { kept, maxPieces, droppedMm2, total } = subtractAll(outline, removal.rects);
  const pockets = [];
  if (depth > 0) {
    for (const { faceId, band } of removal.bands) {
      const tongue = clipToConvex(outline, band);
      if (polygonArea(tongue) < MIN_OVERLAP_MM2) continue;
      const a = faceAxis(faceId);
      const s = tongue.map((p) => (p.x - post.position.x) * a.x + (p.y - post.position.y) * a.y);
      pockets.push({
        faceId,
        sMin: Math.max(-h, Math.min(...s)),
        sMax: Math.min(h, Math.max(...s)),
        zMin: Math.max(post.elevation.bottom, zRange.bottom),
        zMax: Math.min(post.elevation.top, zRange.top),
        depthMm: depth,
        openBottom: zRange.bottom < post.elevation.bottom - GEOMETRY_EPS,
        openTop: zRange.top > post.elevation.top + GEOMETRY_EPS,
      });
    }
  }
  return { kept, rects: removal.rects, split: maxPieces > 1 && droppedMm2 > SPLIT_WARN_FRACTION * total, droppedMm2, swallowed: !kept, pockets };
}

/**
 * @param {{stringerModels: {outer, inner}, stringerConstruction: {outer: Array, inner: Array}, postModels: Array,
 *   treadModels?: Array, riserModels?: Array, config?: Object}} models
 * @returns {{joints: Array, pocketsByPost: Record<string, Array>, treadCuts: Record<string, Object>,
 *   riserCuts: Record<string, Array>, connectors: Array, holesByPost: Record<string, Array>,
 *   holesBySegment: Record<string, Array>, postWeakening: Record<string, Object>, diagnostics: Array}}
 */
export function buildJointModel({ stringerModels, stringerConstruction, postModels, treadModels = [], riserModels = [], config = {} }) {
  const joints = [];
  const diagnostics = [];
  const posts = new Map((postModels || []).filter((p) => !p.removed).map((p) => [p.postId, p]));
  const structuralPosts = [...posts.values()].filter((p) => p.kind !== 'railing');

  for (const side of ['outer', 'inner']) {
    const model = stringerModels?.[side];
    const geos = stringerConstruction?.[side] || [];
    (model?.segments || []).forEach((segment, i) => {
      const g = geos[i];
      if (!g?.ends || !g.outerContour?.length) return;
      for (const end of ['start', 'end']) {
        const into = g.ends[end]?.intoPost;
        if (!into || !(into.depthMm > 0)) continue;
        const post = posts.get(into.postId);
        if (!post) continue;
        const ref = segment.referenceLine;
        const dir = { x: (ref.end.x - ref.start.x) / ref.length, y: (ref.end.y - ref.start.y) / ref.length };
        // the board goes INTO the post along +dir at its end, along −dir at its start; the face it enters looks back at it
        const faceDir = end === 'end' ? { x: -dir.x, y: -dir.y } : dir;
        const { faceId, cos } = nearestFace(faceDir);
        const jointId = `joint:${post.postId}:${segment.id}:${end}`;
        if (cos < FACE_SKEW_COS) {
          diagnostics.push(finding('WARNING', 'JOINT-POST-FACE-SKEW', post.postId, `Wanga ${segment.id} dochodzi do słupa ${post.postId} pod kątem do jego lica — gniazdo zaznaczone prostopadle do lica (${faceId}).`));
        }
        // horizontal extent: the board's thickness band (chain line .. + thickness inward) at the face, on the face axis
        const axis = faceAxis(faceId);
        const chainAtFace = { x: ref.start.x + dir.x * into.faceU, y: ref.start.y + dir.y * into.faceU };
        const inner = { x: chainAtFace.x + segment.inwardNormal.x * segment.thickness, y: chainAtFace.y + segment.inwardNormal.y * segment.thickness };
        const s = [chainAtFace, inner].map((p) => (p.x - post.position.x) * axis.x + (p.y - post.position.y) * axis.y);
        // vertical extent: the board's section over the whole depth it enters
        const uRange = end === 'end' ? [into.faceU, into.faceU + into.depthMm] : [into.faceU - into.depthMm, into.faceU];
        const vr = vRangeWithin(g.outerContour, uRange[0], uRange[1]);
        if (!vr) continue;
        const pocket = {
          jointId,
          kind: 'stringer',
          label: `wreg wangi ${segment.id}`,
          faceId,
          sMin: Math.max(-post.size / 2, Math.min(...s)),
          sMax: Math.min(post.size / 2, Math.max(...s)),
          zMin: Math.max(post.elevation.bottom, vr.min),
          zMax: Math.min(post.elevation.top, vr.max),
          depthMm: into.depthMm,
          openBottom: vr.min < post.elevation.bottom - GEOMETRY_EPS,
          openTop: vr.max > post.elevation.top + GEOMETRY_EPS,
        };
        if (pocket.zMax - pocket.zMin <= GEOMETRY_EPS || pocket.sMax - pocket.sMin <= GEOMETRY_EPS) {
          diagnostics.push(finding('WARNING', 'JOINT-POST-POCKET-OUTSIDE', post.postId, `Wanga ${segment.id} nie trafia w słup ${post.postId} — brak gniazda.`));
          continue;
        }
        if (Math.min(...s) < -post.size / 2 - GEOMETRY_EPS || Math.max(...s) > post.size / 2 + GEOMETRY_EPS) {
          diagnostics.push(finding('WARNING', 'JOINT-POST-POCKET-OUTSIDE', post.postId, `Wanga ${segment.id} jest szersza niż lico słupa ${post.postId} — gniazdo przycięte do słupa.`));
        }
        joints.push({ id: jointId, type: 'STRINGER_POST_HOUSING', postId: post.postId, side, segmentId: segment.id, end, faceU: into.faceU, depthMm: into.depthMm, pocket });
      }
    });
  }

  // --- stage 3: two boards meeting at a corner without a post (stringerConstructionGeometry.js butts) ---
  for (const side of ['outer', 'inner']) {
    for (const g of stringerConstruction?.[side] || []) {
      const butt = g?.ends?.start?.butt;
      if (!butt) continue;
      joints.push({ id: `joint:${butt.intoSegmentId}:${g.segmentId}`, type: 'STRINGER_STRINGER_BUTT', side, segmentId: g.segmentId, intoSegmentId: butt.intoSegmentId, depthMm: butt.depthMm, housed: butt.housed, pockets: [] });
    }
  }

  // --- stage 2: treads and risers that pass through a structural post ---
  const treadCuts = {};
  const riserCuts = {};
  for (const tread of treadModels || []) {
    let outline = tread.outline;
    let undersides = null;
    let holes = [];
    let droppedMm2 = 0;
    let touched = false;
    for (const post of structuralPosts) {
      const depth = postTreadHousingDepthMm(config, post.size);
      const cut = cutAroundPost(outline, post, depth, tread.elevation);
      if (!cut) continue;
      touched = true;
      if (cut.swallowed || !cut.kept) {
        diagnostics.push(finding('WARNING', 'JOINT-TREAD-INSIDE-POST', post.postId, `Stopień ${tread.index + 1} leży prawie cały w słupie ${post.postId} — nie da się go wyciąć wokół słupa.`, { parameter: 'postTreadHousingDepthMm' }));
        continue;
      }
      if (cut.split) diagnostics.push(finding('WARNING', 'JOINT-TREAD-SPLIT', post.postId, `Słup ${post.postId} przecina stopień ${tread.index + 1} na części — zostaje większa.`, { parameter: 'postTreadHousingDepthMm' }));
      outline = cut.kept.outer;
      holes = [...holes, ...cut.kept.holes];
      droppedMm2 += cut.droppedMm2;
      // the underside below the riser groove: the CUT outline minus the groove strip (nosing kept whole)
      if (tread.notch?.strip) undersides = subtractConvex(outline, tread.notch.strip).map((p) => p.outer);
      const jointId = `joint:${post.postId}:${tread.stepId}`;
      const pockets = cut.pockets.map((p) => ({ ...p, jointId, kind: 'tread', label: `stopien ${tread.index + 1}` }));
      joints.push({ id: jointId, type: 'TREAD_POST_HOUSING', postId: post.postId, stepId: tread.stepId, depthMm: depth, pockets });
    }
    if (touched) treadCuts[tread.stepId] = { outline, holes, undersides, droppedMm2 };
  }
  for (const riser of riserModels || []) {
    riser.panels.forEach((panel, k) => {
      let poly = riserPanelPolygon(riser, panel);
      let touched = false;
      for (const post of structuralPosts) {
        const depth = postTreadHousingDepthMm(config, post.size);
        const cut = cutAroundPost(poly, post, depth, riser.elevation);
        if (!cut || !cut.kept) continue;
        touched = true;
        poly = cut.kept.outer;
        const label = riser.atTop ? 'podstopien gorny' : `podstopien ${Number(String(riser.stepId).replace('step-', '')) + 1}`;
        const jointId = `joint:${post.postId}:${riser.riserId}:${k}`;
        joints.push({ id: jointId, type: 'RISER_POST_HOUSING', postId: post.postId, riserId: riser.riserId, panelIndex: k, depthMm: depth, pockets: cut.pockets.map((p) => ({ ...p, jointId, kind: 'riser', label })) });
      }
      if (touched) riserCuts[`${riser.riserId}:${k}`] = poly;
    });
  }

  const pocketsByPost = {};
  for (const j of joints) for (const p of j.pockets || [j.pocket]) (pocketsByPost[j.postId] ||= []).push(p);

  // A post weakened by its own pockets: two STRINGER pockets whose volumes meet inside the post (deep pockets on
  // adjacent or opposite faces at the same height) leave no solid core there. (A tread wrapping a post corner has
  // pockets on two faces meeting at that corner by design — not a weakness.)
  for (const [postId, allPockets] of Object.entries(pocketsByPost)) {
    const post = posts.get(postId);
    const pockets = allPockets.filter((p) => p.kind === 'stringer');
    const boxes = pockets.map((p) => pocketBox(post, p));
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        if (boxesOverlap(boxes[a], boxes[b])) {
          diagnostics.push(finding('WARNING', 'JOINT-POST-POCKETS-OVERLAP', postId, `Gniazda w słupie ${postId} (${pockets[a].label}, ${pockets[b].label}) nachodzą na siebie wewnątrz słupa — zmniejsz głębokość wręgu albo zwiększ przekrój słupa.`));
        }
      }
    }
  }
  // stage 4: the bolts through the stringer joints, and what their holes (with the pockets) leave of each post
  const bolts = buildConnectors(joints, { stringerModels, stringerConstruction, posts, pocketsByPost, config, vRangeWithin });
  diagnostics.push(...bolts.diagnostics);
  return { joints, pocketsByPost, treadCuts, riserCuts, connectors: bolts.connectors, holesByPost: bolts.holesByPost, holesBySegment: bolts.holesBySegment, postWeakening: bolts.postWeakening, diagnostics };
}

/** Per tread: its cut outline and the posts it enters — what the tread DXF needs ({[stepId]: {cut, posts}}). */
export function treadJointsByStep(jointModel, postModels) {
  const out = {};
  const posts = new Map((postModels || []).map((p) => [p.postId, p]));
  for (const j of jointModel?.joints || []) {
    if (j.type !== 'TREAD_POST_HOUSING') continue;
    const post = posts.get(j.postId);
    if (!post) continue;
    const entry = (out[j.stepId] ||= { cut: jointModel.treadCuts?.[j.stepId] || null, posts: [] });
    entry.posts.push({ postId: post.postId, position: post.position, size: post.size, depthMm: j.depthMm });
  }
  return out;
}

/**
 * A pocket as an axis-aligned box in PLAN + elevation coordinates: {minX, maxX, minY, maxY, minZ, maxZ}. The face's
 * normal gives the depth direction (from the face inwards), its axis the width.
 */
export function pocketBox(post, pocket) {
  const n = POST_FACES[pocket.faceId].normal;
  const a = faceAxis(pocket.faceId);
  const h = post.size / 2;
  // along the normal: from the face (h) inwards by the depth; along the axis: sMin..sMax
  const nRange = [h - pocket.depthMm, h];
  const pts = [];
  for (const k of nRange) for (const s of [pocket.sMin, pocket.sMax]) pts.push({ x: post.position.x + n.x * k + a.x * s, y: post.position.y + n.y * k + a.y * s });
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
    minZ: pocket.zMin,
    maxZ: pocket.zMax,
  };
}

function boxesOverlap(a, b) {
  const eps = GEOMETRY_EPS;
  return a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minY < b.maxY - eps && b.minY < a.maxY - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps;
}
