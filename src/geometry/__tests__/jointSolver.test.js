import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { pocketBox, nearestFace, faceAxis, vRangeWithin } from '../jointSolver.js';
import { buildBoxWithBoxPockets } from '../geometryUtils.js';

const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...patch });

test('every inner board end at a structural post gets ONE housing in that post, on the face it enters', () => {
  for (const patch of [{}, { stairType: 'U' }, { stairType: 'straight' }, { stringerConstructionTypeInner: 'cut' }, { turnDirection: 'left' }]) {
    const m = build(patch);
    let expected = 0;
    m.stringerModels.inner.segments.forEach((seg) => {
      expected += (seg.startPost ? 1 : 0) + (seg.endPost ? 1 : 0);
    });
    const stringerJoints = m.joints.joints.filter((j) => j.type === 'STRINGER_POST_HOUSING');
    assert.equal(stringerJoints.length, expected, JSON.stringify(patch));
    for (const j of stringerJoints) {
      const seg = m.stringerModels.inner.segments.find((s) => s.id === j.segmentId);
      const ref = seg.referenceLine;
      const dir = { x: (ref.end.x - ref.start.x) / ref.length, y: (ref.end.y - ref.start.y) / ref.length };
      const into = j.end === 'end' ? dir : { x: -dir.x, y: -dir.y };
      const f = nearestFace({ x: -into.x, y: -into.y });
      assert.equal(j.pocket.faceId, f.faceId, `${JSON.stringify(patch)} ${j.id}: the face that looks back at the board`);
      assert.ok(f.cos > 0.999);
      // as wide as the board is thick, as deep as the parameter, inside the post
      assert.ok(Math.abs(j.pocket.sMax - j.pocket.sMin - seg.thickness) < 1e-6);
      assert.equal(j.pocket.depthMm, m.fullConfig.postHousingDepthMm);
      const post = m.postModels.find((p) => p.postId === j.postId);
      assert.ok(j.pocket.zMin >= post.elevation.bottom - 1e-6 && j.pocket.zMax <= post.elevation.top + 1e-6);
    }
    assert.deepEqual(m.joints.diagnostics, [], JSON.stringify(patch));
  }
});

test("the pocket is as tall as the board's section over the whole depth it enters", () => {
  const m = build({});
  for (const j of m.joints.joints.filter((x) => x.type === 'STRINGER_POST_HOUSING')) {
    const i = m.stringerModels.inner.segments.findIndex((s) => s.id === j.segmentId);
    const g = m.stringerConstruction.inner[i];
    const range = j.end === 'end' ? [j.faceU, j.faceU + j.depthMm] : [j.faceU - j.depthMm, j.faceU];
    const vr = vRangeWithin(g.outerContour, range[0], range[1]);
    const post = m.postModels.find((p) => p.postId === j.postId);
    assert.ok(Math.abs(j.pocket.zMin - Math.max(vr.min, post.elevation.bottom)) < 1e-6);
    assert.ok(Math.abs(j.pocket.zMax - Math.min(vr.max, post.elevation.top)) < 1e-6);
    assert.equal(j.pocket.openTop, vr.max > post.elevation.top + 1e-6);
  }
});

test('depth 0 = no joints (the board ends at the post face); deep pockets meeting inside a post are reported', () => {
  assert.equal(build({ postHousingDepthMm: 0 }).joints.joints.filter((j) => j.type === 'STRINGER_POST_HOUSING').length, 0);
  const deep = build({ postHousingDepthMm: 60 });
  assert.ok(deep.joints.diagnostics.some((d) => d.ruleId === 'JOINT-POST-POCKETS-OVERLAP' && d.elementId === 'post-corner-0' && d.severity === 'WARNING'));
  // removed corner post -> lap joint, nothing to machine there
  const noCorner = build({ manualPostOverrides: { 'post-corner-0': { removed: true } } });
  assert.ok(noCorner.joints.joints.every((j) => j.postId !== 'post-corner-0'));
});

test('face axes: a viewer outside the face looking at it has +axis on the right', () => {
  assert.equal(faceAxis('E').y, 1);
  assert.equal(faceAxis('S').x, 1);
  const post = { position: { x: 0, y: 0 }, size: 100, elevation: { bottom: 0, top: 1000 } };
  const b = pocketBox(post, { faceId: 'E', sMin: -20, sMax: 20, zMin: 100, zMax: 400, depthMm: 25 });
  assert.deepEqual([b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ], [25, 50, -20, 20, 100, 400]);
});

// signed volume of a closed triangle mesh (divergence theorem)
function meshVolume(geometry) {
  const p = geometry.getAttribute('position');
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i);
    const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

test('3D: the post mesh is the box with the pockets taken out (closed, exact volume)', () => {
  const outer = { minX: 0, maxX: 100, minY: 0, maxY: 1000, minZ: 0, maxZ: 100 };
  const holes = [
    { minX: 80, maxX: 100, minY: 200, maxY: 500, minZ: 30, maxZ: 70 },
    { minX: 30, maxX: 70, minY: 800, maxY: 1100, minZ: 80, maxZ: 100 }, // open at the top
  ];
  const g = buildBoxWithBoxPockets(outer, holes);
  const expected = 100 * 1000 * 100 - 20 * 300 * 40 - 40 * 200 * 20;
  assert.ok(Math.abs(meshVolume(g) - expected) < 1e-3, `${meshVolume(g)} vs ${expected}`);
  const m = build({});
  const posts = m.root.getObjectByName('Posts');
  const corner = posts.children.find((c) => c.name.startsWith('Post_Corner'));
  const post = m.postModels.find((p) => p.postId === 'post-corner-0');
  // (stage 1 only: no tread housings in the post, so the removed volume is just the two stringer pockets)
  const m1 = build({ postTreadHousingDepthMm: 0 });
  const corner1 = m1.root.getObjectByName('Posts').children.find((c) => c.name.startsWith('Post_Corner'));
  const pockets = m1.joints.pocketsByPost['post-corner-0'];
  const full = post.size * post.size * (post.elevation.top - post.elevation.bottom);
  const removed = pockets.reduce((s, p) => s + (p.sMax - p.sMin) * p.depthMm * (p.zMax - p.zMin), 0);
  assert.equal(pockets.length, 2);
  assert.ok(Math.abs(Math.abs(meshVolume(corner1.geometry)) - (full - removed)) < 1, 'the rendered corner post has its two pockets');
  assert.ok(Math.abs(meshVolume(corner.geometry)) < full - removed, 'with tread housings too, even more is taken out');
});

// ---- stage 3: two boards meeting at a corner without a post ----
import { boardPlanFootprint } from '../stringerModel.js';
import { clipToConvex, polygonArea } from '../polygonClip.js';

test('postless corner: the boards no longer overlap — at the outer (convex) corner only the tongue in the housing, at a concave one nothing', () => {
  for (const patch of [{}, { hasCornerPost: false }, { turnDirection: 'left' }, { stairType: 'U' }, { stringerConstructionTypeOuter: 'cut' }]) {
    const m = build(patch);
    const t = m.fullConfig.stringerThickness;
    const d = Math.min(m.fullConfig.stringerHousingDepthMm, t - 1);
    for (const side of ['outer', 'inner']) {
      const segs = m.stringerModels[side].segments;
      const geos = m.stringerConstruction[side];
      for (let i = 1; i < segs.length; i++) {
        const butt = geos[i].ends.start.butt;
        if (!butt) continue;
        const fa = boardPlanFootprint(segs[i - 1], geos[i - 1]);
        const fb = boardPlanFootprint(segs[i], geos[i]);
        const overlap = polygonArea(clipToConvex(fa, fb));
        const expected = butt.housed ? d * t : 0;
        assert.ok(Math.abs(overlap - expected) < 1, `${JSON.stringify(patch)} ${side} ${segs[i].id}: overlap ${overlap} vs ${expected}`);
        const joint = m.joints.joints.find((j) => j.type === 'STRINGER_STRINGER_BUTT' && j.segmentId === segs[i].id);
        assert.ok(joint, 'listed in the joint model');
        if (butt.housed) {
          const h = geos[i - 1].housings.find((x) => x.kind === 'butt');
          assert.ok(h && Math.abs(h.uEnd - h.uStart - t) < 1e-6, 'the housing in the through board is as wide as the butting board is thick');
          assert.ok(geos[i - 1].housingPockets.length > 0);
        }
      }
    }
    // the outer stringer at a turn always butts into a housing
    assert.ok(m.stringerConstruction.outer.slice(1).every((g) => g.ends.start.butt?.housed), JSON.stringify(patch));
  }
});
