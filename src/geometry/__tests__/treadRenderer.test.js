// treadRenderer.js: a notched tread (TreadModel.notch) is built as two glued prisms — the mesh must be
// exactly the full slab minus the groove, checked by volume (no rendering needed).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildTreadMesh } from '../treadRenderer.js';
import { clipToConvex } from '../polygonClip.js';

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

test('un-notched tread is the plain slab; notched tread = full top, underside minus ONLY the groove strip (nosing whole)', () => {
  const plain = treads({ hasRiserBoards: false })[1];
  assert.equal(plain.notch, null);
  const plainMesh = buildTreadMesh(plain);
  assert.ok(Math.abs(flatAreaAt(plainMesh, plain.elevation.bottom) - polygonArea(plain.outline)) < 1);
  assert.ok(Math.abs(flatAreaAt(plainMesh, plain.elevation.top) - polygonArea(plain.outline)) < 1);

  const t = treads({ hasRiserBoards: true, riserTopOverlapMm: 12, riserBoardThickness: 20 })[1];
  assert.ok(t.notch);
  const mesh = buildTreadMesh(t);
  const full = polygonArea(t.outline);
  const groove = polygonArea(clipToConvex(t.outline, t.notch.strip));
  const underside = full - groove;
  assert.ok(groove > 0 && underside < full, 'the groove must remove some underside');
  const [s0, s1, s2, s3] = t.notch.strip;
  const meanLen = (Math.hypot(s1.x - s0.x, s1.y - s0.y) + Math.hypot(s3.x - s2.x, s3.y - s2.y)) / 2;
  assert.ok(Math.abs(polygonArea(t.notch.strip) - 20 * meanLen) < 1, 'the groove strip is riser-thickness wide');
  assert.ok(Math.abs(flatAreaAt(mesh, t.elevation.top) - full) < 1, 'walking surface stays whole');
  assert.ok(Math.abs(flatAreaAt(mesh, t.elevation.bottom) - underside) < 1, 'underside = the outline minus only the groove');
  // at the notch height sit the upper slab's underside (full footprint) and the lower slabs' tops (hidden interior faces)
  assert.ok(Math.abs(flatAreaAt(mesh, t.elevation.bottom + t.notch.depthMm) - (full + underside)) < 1);
});

// Bug fix (reported 2026-09-28): the lower slab used to be the whole outline receded to behind the groove, so the NOSING
// lost the groove's depth — with a 10 mm groove the nosing was 10 mm thinner. The nosing must keep the full thickness.
test('the nosing keeps the full tread thickness; only the groove strip behind it is milled from below', () => {
  const t = treads({ hasRiserBoards: true, riserTopOverlapMm: 10, riserBoardThickness: 20, nosing: 30 })[1];
  const mesh = buildTreadMesh(t);
  // the nosing = the part of the outline in front of the structural front edge; its underside is at the tread bottom
  const [a, b] = t.frontEdge.final;
  const n = { x: -(b.y - a.y), y: b.x - a.x };
  const len = Math.hypot(n.x, n.y);
  const inFront = t.outline.filter((p) => ((p.x - a.x) * n.x + (p.y - a.y) * n.y) / len < -1 || ((p.x - a.x) * n.x + (p.y - a.y) * n.y) / len > 1);
  assert.ok(inFront.length >= 2, 'the tread has a nosing');
  const pos = mesh.getAttribute('position');
  // some bottom-face vertex lies at the nosing's front corners (world: x, -y) — the nosing reaches the bottom
  const atBottom = [];
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - t.elevation.bottom) < 1e-6) atBottom.push({ x: pos.getX(i), y: -pos.getZ(i) });
  for (const c of inFront) assert.ok(atBottom.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 1e-3), `nosing corner ${c.x},${c.y} is not at the tread's bottom`);
});
