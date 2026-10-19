import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';

// The direction the texture's u axis runs on a mesh's top face (the grain), from its UVs: the face's points with
// their u — fit u = g·p and return g (plan frame: world (x, −z)).
function topFaceGrain(mesh) {
  const pos = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  // the triangles facing up (non-indexed geometry: three vertices each, their own UVs)
  const pts = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, 3 * t);
    b.fromBufferAttribute(pos, 3 * t + 1);
    c.fromBufferAttribute(pos, 3 * t + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.lengthSq() < 1e-12 || n.normalize().y < 0.99) continue;
    for (let k = 0; k < 3; k++) pts.push({ x: pos.getX(3 * t + k), z: pos.getZ(3 * t + k), u: uv.getX(3 * t + k) });
  }
  // least squares u = a x + b z + c
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, su = 0, sxu = 0, szu = 0;
  for (const p of pts) {
    sxx += p.x * p.x; sxz += p.x * p.z; szz += p.z * p.z; sx += p.x; sz += p.z; su += p.u; sxu += p.x * p.u; szu += p.z * p.u;
  }
  const m = new THREE.Matrix3().set(sxx, sxz, sx, sxz, szz, sz, sx, sz, pts.length).invert();
  const sol = new THREE.Vector3(sxu, szu, su).applyMatrix3(m);
  const len = Math.hypot(sol.x, sol.y);
  return { x: sol.x / len, y: -sol.y / len };
}

test('regression (user, 2026-10-19): the oak grain on a WINDER runs along its front edge, not along the diagonal', () => {
  const built = buildStaircase({ ...createDefaultConfig(), stairType: 'U', treadsLegB: 0, uSingleWinderZone: true, uWindersTotal: 5, turn1Type: 'winder', turn2Type: 'winder', uAxisGapMm: 15, treadsLegA: 6, treadsLegC: 5 });
  const treads = built.root.getObjectByName('Treads').children;
  let checked = 0;
  for (const model of built.treadModels) {
    const mesh = treads.find((m) => m.userData.stepId === model.stepId);
    const [a, b] = model.frontEdge.final;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const front = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const g = topFaceGrain(mesh);
    const sin = Math.abs(front.x * g.y - front.y * g.x);
    assert.ok(sin < 1e-3, `${model.stepId} (${model.type}): grain ${JSON.stringify(g)} vs front edge ${JSON.stringify(front)}`);
    checked++;
  }
  assert.ok(checked >= 10);
});
