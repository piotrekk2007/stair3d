import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildProfileViewModel } from '../stringerProfileView.js';

const built = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...patch });

function meshBox(root, sourceId) {
  let box = null;
  root.traverse((o) => {
    if (o.isMesh && o.userData?.geometrySourceId === sourceId) box = new THREE.Box3().setFromObject(o);
  });
  return box;
}

// Regression: the inward direction was rotate90CW(forward), right only in the native right-turn frame — a
// left-turn (mirrored) stair had every wanga extruded OUTWARD, leaving a gap between the treads and the boards.
for (const turnDirection of ['right', 'left']) {
  for (const stairType of ['L', 'U']) {
    test(`3D: the treads reach into both wangi (${stairType}, turn ${turnDirection}) — no gap`, () => {
      const r = built({ stairType, turnDirection });
      const tread = meshBox(r.root, 'tread:step-2');
      for (const side of ['outer', 'inner']) {
        const board = meshBox(r.root, `stringer:${side}:${side}-seg-0`);
        const overlapX = Math.min(tread.max.x, board.max.x) - Math.max(tread.min.x, board.min.x);
        assert.ok(overlapX > 1, `${side} wanga does not overlap tread 3 across the stair (overlap ${overlapX.toFixed(1)} mm)`);
      }
    });
  }
}

test('balustrade: its lateral offset goes INTO the stair for a left-turn stair too', () => {
  const railing = [{ id: 'r', side: 'outer', fromStep: 0, toStep: 3 }];
  for (const turnDirection of ['right', 'left']) {
    const r = built({ turnDirection, railingEnabled: true, railingSections: railing });
    const x = r.railingModel.sections[0].path[0].x;
    const expected = (turnDirection === 'left' ? -1 : 1) * (r.fullConfig.stringerThickness / 2);
    assert.ok(Math.abs(x - expected) < 1e-6, `${turnDirection}: railing at x=${x}, expected ${expected} (on the outer wanga's axis)`);
  }
});

test('structural posts stand on the inner wanga\'s axis (half its thickness into the stair), mirrored for a left turn', () => {
  for (const turnDirection of ['right', 'left']) {
    const r = built({ turnDirection });
    const s = turnDirection === 'left' ? -1 : 1;
    const t = r.fullConfig.stringerThickness;
    const corner = r.planLayout.turns[0].innerCorner;
    const post = r.postModels.find((p) => p.postId === 'post-corner-0');
    // leg A runs along +y, the inner wanga of leg A lies toward the outer side (x decreasing for a right turn);
    // leg B runs along +x (mirrored: -x), its inner wanga lies toward the outer side (y increasing).
    assert.ok(Math.abs(post.position.x - (corner.x - s * (t / 2))) < 1e-6, `${turnDirection}: corner post x`);
    assert.ok(Math.abs(post.position.y - (corner.y + t / 2)) < 1e-6, `${turnDirection}: corner post y`);
    const start = r.postModels.find((p) => p.postId === 'post-start');
    assert.ok(Math.abs(start.position.x - (r.planLayout.innerFullPath[0].x - s * (t / 2))) < 1e-6, `${turnDirection}: start post on the axis`);
  }
});

test('an inner wanga board ends at the face of the post standing at its end — it never runs past or into the post', () => {
  for (const patch of [{}, { stairType: 'U' }, { stairType: 'straight' }, { treadsLegA: 0 }, { stringerConstructionTypeInner: 'cut' }]) {
    const r = built(patch);
    const segments = r.stringerModels.inner.segments;
    r.stringerConstruction.inner.forEach((g, i) => {
      const seg = segments[i];
      const us = g.outerContour.map((p) => p.u);
      if (seg.startPost) {
        assert.ok(Math.abs(g.ends.start.u - seg.startPost.faceU) < 1e-6, `${JSON.stringify(patch)} ${seg.id}: starts at ${seg.startPost.postId}'s face`);
        assert.ok(Math.min(...us) >= seg.startPost.faceU - 1e-6, `${JSON.stringify(patch)} ${seg.id}: contour reaches into ${seg.startPost.postId}`);
      }
      if (seg.endPost) {
        assert.ok(Math.abs(g.ends.end.u - seg.endPost.faceU) < 1e-6, `${JSON.stringify(patch)} ${seg.id}: ends at ${seg.endPost.postId}'s face`);
        assert.ok(Math.max(...us) <= seg.endPost.faceU + 1e-6, `${JSON.stringify(patch)} ${seg.id}: contour reaches into ${seg.endPost.postId}`);
      }
      for (const h of g.housings || []) {
        if (seg.startPost) assert.ok(h.uStart >= seg.startPost.faceU - 1e-6);
        if (seg.endPost) assert.ok(h.uEnd <= seg.endPost.faceU + 1e-6);
      }
    });
    // both boards of a turn meet the corner post: the one before ends at it, the one after starts at it
    if (segments.length > 1) {
      assert.equal(segments[0].endPost?.postId, 'post-corner-0');
      assert.equal(segments[1].startPost?.postId, 'post-corner-0');
    }
  }
});

test('with no corner post (switched off) the inner boards meet on a lap joint — no post, no trim', () => {
  const r = built({ hasCornerPost: false });
  const [a, b] = r.stringerModels.inner.segments;
  assert.equal(a.endPost, null);
  assert.equal(b.startPost, null);
});

test('the profile editor view carries the posts a board butts into', () => {
  const r = built();
  const views = buildProfileViewModel(r.stringerConstruction.inner, r.stringerModels.inner, r.fullConfig);
  assert.deepEqual(views[0].posts.map((p) => p.postId), ['post-start', 'post-corner-0']);
  const corner = views[0].posts.find((p) => p.postId === 'post-corner-0');
  assert.ok(Math.abs(corner.uStart - views[0].span.uEnd) < 1e-6, 'the board ends exactly at the drawn post');
  assert.equal(buildProfileViewModel(r.stringerConstruction.outer, r.stringerModels.outer, r.fullConfig)[0].posts.length, 0);
});
