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

/**
 * @param {{stringerModels: {outer, inner}, stringerConstruction: {outer: Array, inner: Array}, postModels: Array}} models
 * @returns {{joints: Array, pocketsByPost: Record<string, Array>, diagnostics: Array}}
 */
export function buildJointModel({ stringerModels, stringerConstruction, postModels }) {
  const joints = [];
  const diagnostics = [];
  const posts = new Map((postModels || []).filter((p) => !p.removed).map((p) => [p.postId, p]));

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

  const pocketsByPost = {};
  for (const j of joints) (pocketsByPost[j.postId] ||= []).push(j.pocket);

  // A post weakened by its own pockets: two pockets whose volumes meet inside the post (deep pockets on adjacent or
  // opposite faces at the same height) leave no solid core there.
  for (const [postId, pockets] of Object.entries(pocketsByPost)) {
    const post = posts.get(postId);
    const boxes = pockets.map((p) => pocketBox(post, p));
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        if (boxesOverlap(boxes[a], boxes[b])) {
          diagnostics.push(finding('WARNING', 'JOINT-POST-POCKETS-OVERLAP', postId, `Gniazda w słupie ${postId} (${pockets[a].label}, ${pockets[b].label}) nachodzą na siebie wewnątrz słupa — zmniejsz głębokość wręgu albo zwiększ przekrój słupa.`));
        }
      }
    }
  }
  return { joints, pocketsByPost, diagnostics };
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
