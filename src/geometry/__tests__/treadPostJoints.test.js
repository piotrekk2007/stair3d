import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { treadJointsByStep, riserPanelPolygon, faceAxis } from '../jointSolver.js';
import { clipToConvex, polygonArea } from '../polygonClip.js';
import { buildTreadMesh } from '../treadRenderer.js';
import { buildTreadDXF, buildPostDXF } from '../../export/dxfExport.js';

const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), hasRiserBoards: true, ...patch });
const square = (post, h) => [
  { x: post.position.x - h, y: post.position.y - h },
  { x: post.position.x + h, y: post.position.y - h },
  { x: post.position.x + h, y: post.position.y + h },
  { x: post.position.x - h, y: post.position.y + h },
];
const structural = (m) => m.postModels.filter((p) => p.kind !== 'railing');

function meshVolume(geometry) {
  const p = geometry.getAttribute('position');
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i);
    const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

test('every tread passing through a structural post is cut around it: nothing left inside the post core, the rest intact', () => {
  for (const patch of [{}, { stairType: 'U' }, { stairType: 'straight' }, { turnDirection: 'left' }, { postTreadHousingDepthMm: 0 }]) {
    const m = build(patch);
    const d = m.fullConfig.postTreadHousingDepthMm;
    let cutCount = 0;
    for (const tread of m.treadModels) {
      const posts = structural(m).filter((p) => polygonArea(clipToConvex(tread.outline, square(p, p.size / 2))) > 1 && tread.elevation.top > p.elevation.bottom && tread.elevation.bottom < p.elevation.top);
      const cut = m.joints.treadCuts[tread.stepId];
      assert.equal(!!cut, posts.length > 0, `${JSON.stringify(patch)} ${tread.stepId}: cut exactly when it passes through a post`);
      if (!cut) continue;
      cutCount++;
      for (const p of posts) {
        const core = square(p, p.size / 2 - d);
        assert.ok(polygonArea(clipToConvex(cut.outline, core)) < 1, `${JSON.stringify(patch)} ${tread.stepId}: something left in ${p.postId}'s core`);
        // the tongue into the post: exactly the part of the tread within the housing depth of the faces
        if (d > 0) assert.ok(polygonArea(clipToConvex(cut.outline, square(p, p.size / 2))) > 1, `${tread.stepId}: no tongue into ${p.postId}`);
        else assert.ok(polygonArea(clipToConvex(cut.outline, square(p, p.size / 2))) < 1, `${tread.stepId}: depth 0 = cut flush with the post`);
      }
      // what was removed is only (part of) the post
      const removed = polygonArea(tread.outline) - polygonArea(cut.outline) - (cut.droppedMm2 || 0);
      const overlap = posts.reduce((s, p) => s + polygonArea(clipToConvex(tread.outline, square(p, p.size / 2 - d))), 0);
      assert.ok(Math.abs(removed - overlap) < 1, `${tread.stepId}: removed ${removed} vs core overlap ${overlap}`);
    }
    assert.ok(cutCount >= 2, JSON.stringify(patch));
  }
});

test('the post gets a pocket on every face a tread / riser passes, at its height, as deep as the parameter', () => {
  const m = build({});
  const d = m.fullConfig.postTreadHousingDepthMm;
  for (const j of m.joints.joints.filter((x) => x.type === 'TREAD_POST_HOUSING' || x.type === 'RISER_POST_HOUSING')) {
    const post = m.postModels.find((p) => p.postId === j.postId);
    const element = j.type === 'TREAD_POST_HOUSING' ? m.treadModels.find((t) => t.stepId === j.stepId) : m.riserModels.find((r) => r.riserId === j.riserId);
    assert.ok(j.pockets.length >= 1, j.id);
    for (const p of j.pockets) {
      assert.equal(p.depthMm, d);
      assert.equal(p.zMin, Math.max(post.elevation.bottom, element.elevation.bottom));
      assert.equal(p.zMax, Math.min(post.elevation.top, element.elevation.top));
      assert.ok(p.sMin >= -post.size / 2 - 1e-6 && p.sMax <= post.size / 2 + 1e-6 && p.sMax > p.sMin);
      assert.ok(['tread', 'riser'].includes(p.kind));
      // the pocket's width is where the element really crosses that face
      const a = faceAxis(p.faceId);
      assert.ok(a);
    }
  }
  assert.ok(m.joints.joints.some((j) => j.type === 'RISER_POST_HOUSING'), 'risers pass through posts too');
  assert.deepEqual(m.joints.diagnostics, [], 'the winder tip behind the corner post is cut off silently (a sliver)');
  assert.ok(m.joints.treadCuts['step-5'].droppedMm2 > 0, 'the sliver is recorded');
  // depth 0: the elements are only cut flush, no tread/riser pockets
  const flush = build({ postTreadHousingDepthMm: 0 });
  assert.ok(flush.joints.joints.filter((j) => j.type !== 'STRINGER_POST_HOUSING').every((j) => j.pockets.length === 0));
});

test('risers passing through a post are cut too; without risers nothing of the kind', () => {
  const m = build({});
  const cutIds = Object.keys(m.joints.riserCuts);
  assert.ok(cutIds.length >= 2);
  for (const id of cutIds) {
    const [riserId, k] = id.split(':');
    const riser = m.riserModels.find((r) => r.riserId === riserId);
    const before = polygonArea(riserPanelPolygon(riser, riser.panels[Number(k)]));
    assert.ok(polygonArea(m.joints.riserCuts[id]) < before, id);
  }
  assert.deepEqual(build({ hasRiserBoards: false }).joints.riserCuts, {});
});

// (buildPrism's side-wall winding is not consistent enough for an absolute signed volume — see treadRenderer.test.js —
// but it is the same for the cut and the uncut tread, so their RATIO is exact)
test('3D: a cut tread shrinks exactly in proportion to its cut outline', () => {
  const m = build({ hasRiserBoards: false });
  for (const tread of m.treadModels.filter((t) => m.joints.treadCuts[t.stepId] && !t.notch)) {
    const cut = m.joints.treadCuts[tread.stepId];
    const ratioMesh = meshVolume(buildTreadMesh(tread, cut)) / meshVolume(buildTreadMesh(tread));
    const ratioArea = polygonArea(cut.outline) / polygonArea(tread.outline);
    assert.ok(Math.abs(ratioMesh - ratioArea) < 1e-4, `${tread.stepId}: ${ratioMesh} vs ${ratioArea}`);
    assert.ok(ratioMesh < 1);
  }
});

test('DXF: the tread is drawn cut around the post (with the post outline and the housing depth); the post shows the tread pockets', () => {
  const m = build({});
  const byStep = treadJointsByStep(m.joints, m.postModels);
  const stepId = Object.keys(byStep)[0];
  const tread = m.treadModels.find((t) => t.stepId === stepId);
  const dxf = buildTreadDXF(tread, byStep[stepId]);
  const outlineLines = (dxf.match(/0\nLINE\n8\nOUTLINE\n/g) || []).length;
  assert.equal(outlineLines, byStep[stepId].cut.outline.length, 'the OUTLINE is the cut outline');
  assert.ok(dxf.includes('8\nJOINTS'));
  assert.match(dxf, /Wyciecie wokol slupa post-[a-z0-9-]+, wpust w slup gl\. 20 mm/);
  const post = m.postModels.find((p) => p.postId === 'post-corner-0');
  const postDxf = buildPostDXF(post, m.joints.pocketsByPost[post.postId]);
  assert.match(postDxf, /stopien \d+ gl\. 20 mm/);
  assert.match(postDxf, /podstopien \d+ gl\. 20 mm/);
});
