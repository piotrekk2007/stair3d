// treadRenderer.js: a notched tread (TreadModel.notch) is built as two glued prisms — the mesh must be
// exactly the full slab minus the groove, checked by volume (no rendering needed).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildTreadMesh } from '../treadRenderer.js';

function treads(patch) {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 4, ...patch };
  const fullConfig = { ...config, riserHeight: deriveStairData(config).riserHeight };
  return buildTreadModels(buildPlanLayout(fullConfig), fullConfig);
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Total area of the triangles lying flat in the horizontal plane y = height (orientation-independent).
function flatAreaAt(geometry, height) {
  const pos = geometry.getAttribute('position');
  let area = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ys = [0, 1, 2].map((k) => pos.getY(i + k));
    if (!ys.every((y) => Math.abs(y - height) < 1e-6)) continue;
    const [a, b, c] = [0, 1, 2].map((k) => ({ x: pos.getX(i + k), z: pos.getZ(i + k) }));
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  return area;
}

test('un-notched tread is the plain slab; notched tread = full top, receded underside, full ledge at the notch height', () => {
  const plain = treads({ hasRiserBoards: false })[1];
  assert.equal(plain.notch, null);
  const plainMesh = buildTreadMesh(plain);
  assert.ok(Math.abs(flatAreaAt(plainMesh, plain.elevation.bottom) - polygonArea(plain.outline)) < 1);
  assert.ok(Math.abs(flatAreaAt(plainMesh, plain.elevation.top) - polygonArea(plain.outline)) < 1);

  const t = treads({ hasRiserBoards: true, riserTopOverlapMm: 12, riserBoardThickness: 20 })[1];
  assert.ok(t.notch);
  const mesh = buildTreadMesh(t);
  const full = polygonArea(t.outline);
  const receded = polygonArea(t.notch.outline);
  assert.ok(receded < full, 'the groove must remove some underside');
  assert.ok(Math.abs(flatAreaAt(mesh, t.elevation.top) - full) < 1, 'walking surface stays whole');
  assert.ok(Math.abs(flatAreaAt(mesh, t.elevation.bottom) - receded) < 1, 'underside is the receded outline only');
  // at the notch height sit the upper slab's underside (full footprint: groove ceiling + a hidden interior face) and the lower slab's top (hidden interior face)
  assert.ok(Math.abs(flatAreaAt(mesh, t.elevation.bottom + t.notch.depthMm) - (full + receded)) < 1);
});
