// THE ONLY Three.js mesh builder for posts. Consumes PostModel[] (postSolver.js) — it does
// not decide positions, only builds a box mesh at an already-decided position/size.

import * as THREE from 'three';
import { traceability } from '../scene/traceability.js';
import { buildBoxWithBoxPockets } from './geometryUtils.js';
import { pocketBox } from './jointSolver.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sochaPostParts } from './sochaStyle.js';

// A post with pockets (jointSolver.js — e.g. the housings the stringers enter) is the box with those boxes taken out;
// the pockets are already decided in plan + elevation, here only converted to world (x, z up→y, −y→z).
// A post a handrail runs into, mitred (railingSolver.js handrailMitre → postSolver.js applyPostTopCuts): every vertex
// of its top moved onto the mitre plane — `offset` = the mesh's position (its geometry local), world = plan x, z, −y.
function cutTopAlong(geometry, model, offset = { x: 0, y: 0, z: 0 }) {
  const { point: P, normal: n } = model.topCut;
  if (!(Math.abs(n.z) > 1e-9)) return;
  const pos = geometry.getAttribute('position');
  for (let k = 0; k < pos.count; k++) {
    const wy = pos.getY(k) + offset.y;
    if (wy < model.elevation.top - 0.5) continue;
    const x = pos.getX(k) + offset.x;
    const y = -(pos.getZ(k) + offset.z);
    pos.setY(k, P.z - (n.x * (x - P.x) + n.y * (y - P.y)) / n.z - offset.y);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function boxMeshFor(model, pockets = []) {
  const height = model.elevation.top - model.elevation.bottom;
  if (pockets.length > 0) {
    const h = model.size / 2;
    const toWorldBox = (b) => ({ minX: b.minX, maxX: b.maxX, minY: b.minZ, maxY: b.maxZ, minZ: -b.maxY, maxZ: -b.minY });
    const outer = toWorldBox({ minX: model.position.x - h, maxX: model.position.x + h, minY: model.position.y - h, maxY: model.position.y + h, minZ: model.elevation.bottom, maxZ: model.elevation.top });
    const geometry = buildBoxWithBoxPockets(outer, pockets.map((p) => toWorldBox(pocketBox(model, p))));
    if (model.topCut) cutTopAlong(geometry, model);
    return new THREE.Mesh(geometry);
  }
  const geometry = new THREE.BoxGeometry(model.size, height, model.size);
  geometry.translate(0, height / 2, 0);
  if (model.topCut) cutTopAlong(geometry, model, { x: model.position.x, y: model.elevation.bottom, z: -model.position.y });
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(model.position.x, model.elevation.bottom, -model.position.y);
  return mesh;
}

// A Socha post (user request 2026-11-24, sochaStyle.js): the plinth, the fluted shaft and the stepped cap as one mesh in
// world coordinates; a handrail running into it on a mitre — no cap, its top cut along the mitre. (Its stringer pockets
// are not shown — they lie under the boards that enter them.)
function sochaMeshFor(model) {
  const parts = sochaPostParts({ sizeMm: model.size, bottomZ: model.elevation.bottom, topZ: model.elevation.top, capped: !model.topCut, ...(model.socha || {}) });
  const { x, y } = model.position;
  const geometries = parts.boxes.map((b) => {
    const g = new THREE.BoxGeometry(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0);
    g.translate(x + (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, -(y + (b.y0 + b.y1) / 2));
    return g;
  });
  if (parts.frustum) {
    const f = parts.frustum;
    // (a 4-sided frustum, its corners over the plates' corners)
    const g = new THREE.CylinderGeometry(f.w1 / Math.SQRT2, f.w0 / Math.SQRT2, f.z1 - f.z0, 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(x, (f.z0 + f.z1) / 2, -y);
    geometries.push(g);
  }
  const geometry = mergeGeometries(geometries.map((g) => g.toNonIndexed()));
  if (model.topCut) cutTopAlong(geometry, model);
  return new THREE.Mesh(geometry);
}

const MESH_NAME_BY_KIND = { start: 'Post_Start', end: 'Post_End' };

export function renderPosts(postModels, material, pocketsByPost = {}) {
  const group = new THREE.Group();
  group.name = 'Posts';
  let cornerIndex = 0;
  for (const model of postModels) {
    const mesh = model.style === 'socha' ? sochaMeshFor(model) : boxMeshFor(model, pocketsByPost[model.postId] || []);
    mesh.material = material;
    mesh.name = model.kind === 'corner' ? `Post_Corner_${cornerIndex++}` : model.kind === 'railing' ? `Post_Railing_${model.postId}` : MESH_NAME_BY_KIND[model.kind];
    // Posts aren't tied to one tread (stepId: null) — a corner post sits at a turn, a newel at
    // the flight's very start/end, neither "belongs to" a single step the way a bearing does.
    mesh.userData = traceability({ elementType: 'post', geometrySourceId: `post:${model.postId}` });
    group.add(mesh);
  }
  return group;
}
