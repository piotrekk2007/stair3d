// JOINT CONNECTORS (joints stage 4 — docs/architecture/JOINTS_MODEL.md) — the bolts that hold a stringer in a post's
// housing (STRINGER_POST_HOUSING) and a butting stringer against the board it butts into (STRINGER_STRINGER_BUTT), as
// plain data: where every hole is drilled in EACH element, how long the bolt is, and what the holes do to the post.
// Pure: no Three.js, no DXF — the DXF exporter only draws `holesByPost` / `holesBySegment`, the takeoff only counts
// `connectors`. Treads/risers entering a post are not bolted (glued in their pockets) — out of scope.
//
// The connector (user decision 2026-09-28: "łączniki jako parametry") is a stair bolt: a hole along the joint axis —
// through the post (or blind, a set depth into it), on through the joint face into the end of the stringer, up to a
// nut-access bore drilled into the stringer's inner face. Count, spacing (vertical, centred on the stringer's section
// at the joint face), diameter, how far into the stringer, the access bore and the post mode are config parameters —
// all DO WERYFIKACJI (CO-MFG-J-CONNECTORS). Bolt length = the whole drilled axis from its head face to the nut bore.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { GEOMETRY_EPS } from './tolerances.js';

// EN 1995-1-1 Table 8.4 (bolts): minimum distance to an unloaded edge a4,c = 3d — quoted from memory, DO WERYFIKACJI.
export const CONNECTOR_EDGE_DISTANCE_FACTOR = 3;
// A post left with less than this share of its plan section at some height is reported as weakened. A judgement
// threshold, not from a standard — DO WERYFIKACJI.
export const POST_MIN_NET_SECTION_FRACTION = 0.5;

const POST_NORMALS = { E: { x: 1, y: 0 }, N: { x: 0, y: 1 }, W: { x: -1, y: 0 }, S: { x: 0, y: -1 } };
const OPPOSITE_FACE = { E: 'W', W: 'E', N: 'S', S: 'N' };
const axisOf = (faceId) => ({ x: -POST_NORMALS[faceId].y, y: POST_NORMALS[faceId].x });

/** Connector parameters from config; a project without the fields (older file) has no connectors (count 0). */
export function connectorParams(config = {}) {
  const num = (key, def) => {
    const v = Number(config[key]);
    return Number.isFinite(v) ? v : def;
  };
  return {
    count: Math.max(0, Math.round(num('jointConnectorCount', 0))),
    spacingMm: Math.max(0, num('jointConnectorSpacingMm', 120)),
    diameterMm: Math.max(1, num('jointConnectorDiameterMm', 10)),
    boardDepthMm: Math.max(0, num('jointConnectorBoardDepthMm', 100)),
    nutBoreMm: Math.max(0, num('jointConnectorNutBoreMm', 30)),
    throughPost: config.jointConnectorPostMode !== 'blind',
    postDepthMm: Math.max(0, num('jointConnectorPostDepthMm', 60)),
  };
}

// Heights of `count` bolts spaced `spacing` apart, centred on `zc`.
function boltHeights(zc, count, spacing) {
  return Array.from({ length: count }, (_, i) => zc + (i - (count - 1) / 2) * spacing);
}

function warn(ruleId, elementType, elementId, message, parameter = 'jointConnectorSpacingMm') {
  return createDiagnostic({ ruleId, severity: 'WARNING', elementType, elementId, parameter, message });
}

// A hole's drilled axis inside a post, as a 3D segment from its face inwards.
function holeAxis(post, hole) {
  const h = post.size / 2;
  const n = POST_NORMALS[hole.faceId];
  const ax = axisOf(hole.faceId);
  const at = (k) => ({ x: post.position.x + n.x * k + ax.x * hole.s, y: post.position.y + n.y * k + ax.y * hole.s, z: hole.z });
  return [at(h), at(h - Math.min(hole.depthMm, post.size))];
}

// Closest distance between 3D segments p0-p1 and q0-q1.
export function segmentDistance3(p0, p1, q0, q1) {
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s;
  let t;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  if (a <= GEOMETRY_EPS && e <= GEOMETRY_EPS) return Math.sqrt(dot(r, r));
  if (a <= GEOMETRY_EPS) {
    s = 0;
    t = clamp(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= GEOMETRY_EPS) {
      t = 0;
      s = clamp(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > GEOMETRY_EPS ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  const cp = { x: p0.x + d1.x * s - (q0.x + d2.x * t), y: p0.y + d1.y * s - (q0.y + d2.y * t), z: p0.z + d1.z * s - (q0.z + d2.z * t) };
  return Math.sqrt(dot(cp, cp));
}

/**
 * @param {Array} joints  buildJointModel's joints (STRINGER_POST_HOUSING / STRINGER_STRINGER_BUTT are bolted)
 * @param {{stringerModels, stringerConstruction, posts: Map<string, Object>, pocketsByPost: Object, config: Object,
 *   vRangeWithin: Function}} ctx
 * @returns {{connectors: Array, holesByPost: Object, holesBySegment: Object, postWeakening: Object, diagnostics: Array}}
 */
export function buildConnectors(joints, { stringerModels, stringerConstruction, posts, pocketsByPost, config, vRangeWithin }) {
  const p = connectorParams(config);
  const out = { connectors: [], holesByPost: {}, holesBySegment: {}, postWeakening: {}, diagnostics: [] };
  const segById = new Map();
  for (const side of ['outer', 'inner']) {
    (stringerModels?.[side]?.segments || []).forEach((segment, i) => segById.set(segment.id, { segment, geometry: stringerConstruction?.[side]?.[i], side }));
  }
  const d = p.diameterMm;
  const edge = CONNECTOR_EDGE_DISTANCE_FACTOR * d;
  const addPostHole = (postId, h) => (out.holesByPost[postId] ||= []).push(h);
  const addSegHole = (segmentId, h) => (out.holesBySegment[segmentId] ||= []).push(h);

  if (p.count > 0) {
    if (p.count > 1 && p.spacingMm < Math.max(p.nutBoreMm, d) - GEOMETRY_EPS) {
      out.diagnostics.push(warn('JOINT-CONNECTOR-SPACING', 'stair', 'stair', `Rozstaw łączników ${p.spacingMm} mm jest mniejszy niż średnica gniazda nakrętki (${p.nutBoreMm} mm) — gniazda w wandze nachodzą na siebie.`));
    }
    for (const j of joints) {
      if (j.type === 'STRINGER_POST_HOUSING') boltIntoPost(j);
      else if (j.type === 'STRINGER_STRINGER_BUTT') boltButt(j);
    }
  }
  checkPosts();
  return out;

  // The board's end is inside the pocket (faceU ± depth); the bolt runs from the post's far face (or a blind depth in
  // the post) through the joint face into the board, up to the nut bore `boardDepthMm` in from the joint face.
  function boltIntoPost(j) {
    const post = posts.get(j.postId);
    const entry = segById.get(j.segmentId);
    if (!post || !entry?.geometry?.outerContour?.length) return;
    const section = vRangeWithin(entry.geometry.outerContour, j.faceU, j.faceU);
    if (!section) return;
    const s = (j.pocket.sMin + j.pocket.sMax) / 2;
    const inPostMm = p.throughPost ? post.size : p.postDepthMm; // from the joint face
    const lo = Math.max(section.min, post.elevation.bottom) + edge;
    const hi = Math.min(section.max, post.elevation.top) - edge;
    // Where the bolts go is this solver's own choice: centred on the section, unless their holes would cross the holes
    // already drilled in this post for another board (two boards entering adjacent faces of a corner post at about the
    // same height) — then the whole group is moved up/down in steps of d/2, by at most one spacing, to the nearest
    // height that clears them without breaking the edge distance. Nothing found = centred, and reported below.
    const centre = (section.min + section.max) / 2;
    const clears = (zs) => {
      const mine = zs.map((z) => holeAxis(post, { faceId: j.pocket.faceId, s, z, depthMm: inPostMm }));
      return (out.holesByPost[post.postId] || []).filter((h) => !h.exit).every((h) => {
        const [q0, q1] = holeAxis(post, h);
        return mine.every(([p0, p1]) => segmentDistance3(p0, p1, q0, q1) >= (d + h.diameterMm) / 2);
      });
    };
    const fits = (zs) => zs.every((z) => z >= lo - GEOMETRY_EPS && z <= hi + GEOMETRY_EPS);
    let zs = boltHeights(centre, p.count, p.spacingMm);
    let shiftMm = 0;
    if (!clears(zs)) {
      const maxShift = Math.max(p.spacingMm, 2 * d);
      for (let k = 1; k * (d / 2) <= maxShift + GEOMETRY_EPS; k++) {
        const found = [k, -k].map((m) => m * (d / 2)).find((dz) => {
          const cand = boltHeights(centre + dz, p.count, p.spacingMm);
          return fits(cand) && clears(cand);
        });
        if (found !== undefined) {
          shiftMm = found;
          zs = boltHeights(centre + found, p.count, p.spacingMm);
          break;
        }
      }
    }
    const into = j.end === 'end' ? -1 : 1; // direction INTO the board along u, from the joint face
    const boardEndU = j.faceU - into * j.depthMm;
    const nutU = j.faceU + into * p.boardDepthMm;
    if (!p.throughPost && inPostMm <= j.depthMm + GEOMETRY_EPS) {
      out.diagnostics.push(warn('JOINT-CONNECTOR-SHORT', 'post', post.postId, `Łącznik ślepy ${p.postDepthMm} mm nie sięga dalej niż wręg (${Math.round(j.depthMm)} mm) w słupie ${post.postId} — nie trzyma w słupie.`, 'jointConnectorPostDepthMm'));
    }
    const lengthMm = inPostMm + p.boardDepthMm;
    if (!fits(zs)) {
      out.diagnostics.push(warn('JOINT-CONNECTOR-EDGE', 'post', post.postId, `Łączniki wangi ${j.segmentId} w słupie ${post.postId} leżą bliżej niż ${CONNECTOR_EDGE_DISTANCE_FACTOR}d (${edge} mm) od krawędzi wangi lub końca słupa — zmniejsz rozstaw albo liczbę.`));
    }
    const label = `sruba M${d} dl. ${Math.round(lengthMm)}`;
    zs.forEach((z, k) => {
      const id = `${j.id}:bolt-${k}`;
      out.connectors.push({ id, jointId: j.id, kind: 'stringer-post', postId: post.postId, segmentId: j.segmentId, z, shiftMm, diameterMm: d, lengthMm, throughPost: p.throughPost });
      addPostHole(post.postId, { id, jointId: j.id, faceId: j.pocket.faceId, s, z, diameterMm: d, depthMm: inPostMm, through: p.throughPost, label: p.throughPost ? `otw. O${d} przelotowo (${label})` : `otw. O${d} gl. ${Math.round(inPostMm)} od lica (${label})` });
      if (p.throughPost) addPostHole(post.postId, { id, jointId: j.id, faceId: OPPOSITE_FACE[j.pocket.faceId], s: -s, z, diameterMm: d, depthMm: inPostMm, through: true, exit: true, label: `wyjscie O${d} - podkladka/zaslepka` });
      addSegHole(j.segmentId, { id, kind: 'axial', u0: boardEndU, u1: nutU, v: z, diameterMm: d, nutBoreMm: p.nutBoreMm, label: `otw. O${d} od czola do gniazda nakretki O${p.nutBoreMm} (lico wewn.) - ${label}` });
    });
  }

  // B butts into A (stage 3): the bolt goes THROUGH board A (from its outer face, along B's direction) into B's end.
  function boltButt(j) {
    const a = segById.get(j.intoSegmentId);
    const b = segById.get(j.segmentId);
    if (!a?.geometry?.outerContour?.length || !b?.geometry?.outerContour?.length) return;
    const butt = b.geometry.ends?.start?.butt;
    if (!butt) return;
    const A = a.segment;
    const B = b.segment;
    const dirA = A.referenceLine.direction;
    const dirB = B.referenceLine.direction;
    const across = Math.abs(dirB.x * A.inwardNormal.x + dirB.y * A.inwardNormal.y);
    if (across < 0.5) return; // not a corner butt — nothing sensible to bolt
    const tAlong = A.thickness / across;
    // where the bolt crosses A: the mid-plane of B at the joint face, projected onto A's axis
    const pt = {
      x: B.referenceLine.start.x + dirB.x * butt.faceU + B.inwardNormal.x * (B.thickness / 2),
      y: B.referenceLine.start.y + dirB.y * butt.faceU + B.inwardNormal.y * (B.thickness / 2),
    };
    const uA = (pt.x - A.referenceLine.start.x) * dirA.x + (pt.y - A.referenceLine.start.y) * dirA.y;
    const secB = vRangeWithin(b.geometry.outerContour, butt.faceU, butt.faceU);
    const secA = vRangeWithin(a.geometry.outerContour, uA, uA);
    if (!secB || !secA) return;
    const zs = boltHeights((secB.min + secB.max) / 2, p.count, p.spacingMm);
    const lo = Math.max(secA.min, secB.min) + edge;
    const hi = Math.min(secA.max, secB.max) - edge;
    if (zs.some((z) => z < lo - GEOMETRY_EPS || z > hi + GEOMETRY_EPS)) {
      out.diagnostics.push(warn('JOINT-CONNECTOR-EDGE', 'stringer', b.side, `Łączniki wangi ${B.id} w wandze ${A.id} leżą bliżej niż ${CONNECTOR_EDGE_DISTANCE_FACTOR}d (${edge} mm) od krawędzi którejś z desek — zmniejsz rozstaw albo liczbę.`));
    }
    const lengthMm = tAlong + p.boardDepthMm;
    const label = `sruba M${d} dl. ${Math.round(lengthMm)}`;
    zs.forEach((z, k) => {
      const id = `${j.id}:bolt-${k}`;
      out.connectors.push({ id, jointId: j.id, kind: 'stringer-stringer', segmentId: B.id, intoSegmentId: A.id, z, diameterMm: d, lengthMm, throughPost: false });
      addSegHole(A.id, { id, kind: 'cross', u: uA, v: z, diameterMm: d, label: `otw. O${d} przelotowo (do wangi ${B.id}) - ${label}` });
      addSegHole(B.id, { id, kind: 'axial', u0: b.geometry.ends.start.u, u1: butt.faceU + p.boardDepthMm, v: z, diameterMm: d, nutBoreMm: p.nutBoreMm, label: `otw. O${d} od czola do gniazda nakretki O${p.nutBoreMm} (lico wewn.) - ${label}` });
    });
  }

  // Post weakening: bolt holes crossing each other inside a post, and the post's net plan section at every height a
  // hole or pocket is at (pockets: width x depth; holes: diameter x drilled length; overlaps counted twice —
  // conservative).
  function checkPosts() {
    const postIds = new Set([...Object.keys(pocketsByPost || {}), ...Object.keys(out.holesByPost)]);
    for (const postId of postIds) {
      const post = posts.get(postId);
      if (!post) continue;
      const holes = (out.holesByPost[postId] || []).filter((x) => !x.exit);
      const axis = (x) => holeAxis(post, x);
      const reported = new Set();
      for (let i = 0; i < holes.length; i++) {
        for (let k = i + 1; k < holes.length; k++) {
          if (holes[i].jointId === holes[k].jointId) continue;
          const [p0, p1] = axis(holes[i]);
          const [q0, q1] = axis(holes[k]);
          const key = `${holes[i].jointId}|${holes[k].jointId}`;
          if (!reported.has(key) && segmentDistance3(p0, p1, q0, q1) < (holes[i].diameterMm + holes[k].diameterMm) / 2) {
            reported.add(key);
            out.diagnostics.push(warn('JOINT-CONNECTOR-CLASH', 'post', postId, `Otwory łączników w słupie ${postId} krzyżują się wewnątrz słupa (${holes[i].jointId} i ${holes[k].jointId}) — przesuń łączniki na inną wysokość albo użyj łącznika ślepego.`));
          }
        }
      }
      const pockets = pocketsByPost?.[postId] || [];
      const samples = [...holes.map((x) => x.z), ...pockets.map((q) => (q.zMin + q.zMax) / 2)];
      let worst = null;
      for (const z of samples) {
        let removed = 0;
        for (const q of pockets) if (z >= q.zMin - GEOMETRY_EPS && z <= q.zMax + GEOMETRY_EPS) removed += (q.sMax - q.sMin) * q.depthMm;
        for (const x of holes) if (Math.abs(z - x.z) < x.diameterMm / 2) removed += x.diameterMm * Math.min(x.depthMm, post.size);
        const fraction = Math.max(0, 1 - removed / (post.size * post.size));
        if (!worst || fraction < worst.netFraction) worst = { netFraction: fraction, zMm: z };
      }
      if (!worst) continue;
      out.postWeakening[postId] = worst;
      if (worst.netFraction < POST_MIN_NET_SECTION_FRACTION) {
        out.diagnostics.push(warn('JOINT-POST-WEAKENED', 'post', postId, `Słup ${postId} na wysokości ${Math.round(worst.zMm)} mm zachowuje tylko ${Math.round(worst.netFraction * 100)} % przekroju (gniazda + otwory) — próg ${Math.round(POST_MIN_NET_SECTION_FRACTION * 100)} % (do weryfikacji).`, 'postSize'));
      }
    }
  }
}
