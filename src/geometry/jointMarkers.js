// JOINT MARKERS — where the joints are, as plain 3D shapes for the "Złącza" view layer (scene/jointMarkersOverlay.js):
// the same pockets and holes the DXF exports mark, placed in space. Pure: no Three.js; plan coordinates (x, y) +
// elevation z, the convention of every model. Nothing here is decided anew — every shape is read off the joint model
// (jointSolver.js pocketsByPost / holesByPost / holesBySegment) and the stringer construction geometry (housings).
//
//   boxes:     { kind: 'post-pocket' | 'wanga-housing', center, axisU, axisN (unit plan vectors), sizeU, sizeN, sizeZ, label }
//   cylinders: { kind: 'bolt' | 'nut-bore', a, b (end points {x,y,z}), diameterMm, label }
//
// A wanga occupies [0, thickness] from its chain line along its inward normal (stringerSolver.js); housings are routed
// from its INNER face (n = thickness) `depth` deep, bolts run in its mid-plane (n = thickness / 2). A nut bore is drawn
// from the inner face to just past the bolt axis — a marker of where it is, its depth is not a parameter.

import { pocketBox } from './jointSolver.js';

const NORMALS = { E: { x: 1, y: 0 }, N: { x: 0, y: 1 }, W: { x: -1, y: 0 }, S: { x: 0, y: -1 } };

export function buildJointMarkers({ joints, stringerModels, stringerConstruction, postModels }) {
  const boxes = [];
  const cylinders = [];
  if (!joints) return { boxes, cylinders };
  const posts = new Map((postModels || []).map((p) => [p.postId, p]));

  // posts: the pockets (axis-aligned, pocketBox) and the drilled holes
  for (const [postId, pockets] of Object.entries(joints.pocketsByPost || {})) {
    const post = posts.get(postId);
    if (!post) continue;
    for (const p of pockets) {
      const b = pocketBox(post, p);
      boxes.push({
        kind: 'post-pocket',
        center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 },
        axisU: { x: 1, y: 0 },
        axisN: { x: 0, y: 1 },
        sizeU: b.maxX - b.minX,
        sizeN: b.maxY - b.minY,
        sizeZ: b.maxZ - b.minZ,
        label: `${postId}: ${p.label}`,
      });
    }
  }
  for (const [postId, holes] of Object.entries(joints.holesByPost || {})) {
    const post = posts.get(postId);
    if (!post) continue;
    const h = post.size / 2;
    for (const hole of holes) {
      if (hole.exit) continue; // the through hole is one cylinder from face to face
      const n = NORMALS[hole.faceId];
      const ax = { x: -n.y, y: n.x };
      const at = (k) => ({ x: post.position.x + n.x * k + ax.x * hole.s, y: post.position.y + n.y * k + ax.y * hole.s, z: hole.z });
      cylinders.push({ kind: 'bolt', a: at(h), b: at(h - Math.min(hole.depthMm, post.size)), diameterMm: hole.diameterMm, label: `${postId}: ${hole.label}` });
    }
  }

  // stringers: housings in the inner face, and the holes along / through the boards
  for (const side of ['outer', 'inner']) {
    const segments = stringerModels?.[side]?.segments || [];
    segments.forEach((segment, i) => {
      const ref = segment.referenceLine;
      const dir = ref.direction;
      const nrm = segment.inwardNormal;
      const t = segment.thickness;
      const at = (u, nOff, z) => ({ x: ref.start.x + dir.x * u + nrm.x * nOff, y: ref.start.y + dir.y * u + nrm.y * nOff, z });
      const g = stringerConstruction?.[side]?.[i];
      for (const hs of g?.housings || []) {
        const depth = Math.min(hs.depth, t);
        const c = at((hs.uStart + hs.uEnd) / 2, t - depth / 2, (hs.bottomV + hs.topV) / 2);
        boxes.push({ kind: 'wanga-housing', center: c, axisU: dir, axisN: nrm, sizeU: hs.uEnd - hs.uStart, sizeN: depth, sizeZ: hs.topV - hs.bottomV, label: `${segment.id}: ${hs.kind || 'tread'}` });
      }
      for (const hole of joints.holesBySegment?.[segment.id] || []) {
        if (hole.kind === 'axial') {
          cylinders.push({ kind: 'bolt', a: at(hole.u0, t / 2, hole.v), b: at(hole.u1, t / 2, hole.v), diameterMm: hole.diameterMm, label: `${segment.id}: ${hole.label}` });
          if (hole.nutBoreMm > 0) {
            cylinders.push({ kind: 'nut-bore', a: at(hole.u1, t, hole.v), b: at(hole.u1, Math.max(0, t / 2 - hole.diameterMm / 2), hole.v), diameterMm: hole.nutBoreMm, label: `${segment.id}: gniazdo nakretki` });
          }
        } else {
          cylinders.push({ kind: 'bolt', a: at(hole.u, 0, hole.v), b: at(hole.u, t, hole.v), diameterMm: hole.diameterMm, label: `${segment.id}: ${hole.label}` });
        }
      }
    });
  }
  return { boxes, cylinders };
}
