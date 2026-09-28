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

// User rule 2026-09-28: a tread's end is milled as little as possible and enters the post as widely as it can — ONE
// plain notch round the post and ONE tongue, on the face the tread bears on most, across the tread's full width there.
// A riser carries no load: cut flush with the post, no pocket.
function bandOf(post, faceId, d) {
  const n = { E: [1, 0], N: [0, 1], W: [-1, 0], S: [0, -1] }[faceId];
  const a = faceAxis(faceId);
  const h = post.size / 2;
  const pt = (k, s) => ({ x: post.position.x + n[0] * k + a.x * s, y: post.position.y + n[1] * k + a.y * s });
  return [pt(h - d, -h), pt(h, -h), pt(h, h), pt(h - d, h)];
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
        if (d === 0) assert.ok(polygonArea(clipToConvex(cut.outline, square(p, p.size / 2))) < 1, `${tread.stepId}: depth 0 = cut flush with the post`);
      }
    }
    assert.ok(cutCount >= 2, JSON.stringify(patch));
  }
});

test('the post gets ONE pocket per tread (none for a riser), at its height, as deep as the parameter', () => {
  const m = build({});
  const d = m.fullConfig.postTreadHousingDepthMm;
  for (const j of m.joints.joints.filter((x) => x.type === 'TREAD_POST_HOUSING')) {
    const post = m.postModels.find((p) => p.postId === j.postId);
    const element = m.treadModels.find((t) => t.stepId === j.stepId);
    assert.ok(j.pockets.length <= 1, j.id);
    for (const p of j.pockets) {
      assert.equal(p.depthMm, d);
      assert.equal(p.zMin, Math.max(post.elevation.bottom, element.elevation.bottom));
      assert.equal(p.zMax, Math.min(post.elevation.top, element.elevation.top));
      assert.ok(p.sMin >= -post.size / 2 - 1e-6 && p.sMax <= post.size / 2 + 1e-6 && p.sMax > p.sMin);
      assert.equal(p.kind, 'tread');
      // the pocket's width is where the element really crosses that face
      const a = faceAxis(p.faceId);
      assert.ok(a);
    }
  }
  assert.ok(m.joints.joints.some((j) => j.type === 'TREAD_POST_HOUSING' && j.pockets.length === 1));
  const riserCuts = m.joints.joints.filter((j) => j.type === 'RISER_POST_CUT');
  assert.ok(riserCuts.length > 0, 'risers pass through posts too');
  assert.ok(riserCuts.every((j) => j.pockets.length === 0 && j.depthMm === 0), 'a riser is not housed in the post');
  assert.ok(Object.values(m.joints.pocketsByPost).flat().every((p) => p.kind !== 'riser'));
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
    for (const p of structural(m)) assert.ok(polygonArea(clipToConvex(m.joints.riserCuts[id], square(p, p.size / 2))) < 1, `${id}: cut flush with ${p.postId}`);
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
  assert.doesNotMatch(postDxf, /podstopien/, 'no riser pockets in the post');
});

test('every post: a tread keeps ONE tongue — on the face it bears on most, across the full face band — and nothing else in the post', () => {
  for (const patch of [{}, { stairType: 'U' }, { turnDirection: 'left' }, { windersPerTurn: 3 }, { stairType: 'straight' }, { hasRiserBoards: false }]) {
    const m = build(patch);
    const d = m.fullConfig.postTreadHousingDepthMm;
    for (const post of structural(m)) {
      const h = post.size / 2;
      for (const j of m.joints.joints.filter((x) => x.postId === post.postId && x.type === 'TREAD_POST_HOUSING')) {
        assert.ok(j.pockets.length <= 1, `${JSON.stringify(patch)} ${j.id}: ${j.pockets.length} pockets`);
        const cut = m.joints.treadCuts[j.stepId].outline;
        const inPost = polygonArea(clipToConvex(cut, square(post, h)));
        if (j.pockets.length === 0) {
          assert.ok(inPost < 1, `${j.id}: no tongue, so nothing may be left in the post`);
          continue;
        }
        const f = j.pockets[0].faceId;
        const band = bandOf(post, f, d);
        // everything of the tread left inside the post is the one tongue in that face's band ...
        assert.ok(Math.abs(inPost - polygonArea(clipToConvex(cut, band))) < 1, `${JSON.stringify(patch)} ${j.id}: tread material in the post outside its one tongue`);
        // ... and the tongue is all the tread had in that band (entered as widely as it can, no steps)
        const tread = m.treadModels.find((t) => t.stepId === j.stepId);
        assert.ok(Math.abs(polygonArea(clipToConvex(cut, band)) - polygonArea(clipToConvex(tread.outline, band))) < 1, `${JSON.stringify(patch)} ${j.id}: the tongue was narrowed`);
        // the face chosen is the one with the most contact
        for (const g of ['E', 'N', 'W', 'S']) assert.ok(polygonArea(clipToConvex(tread.outline, bandOf(post, g, d))) <= polygonArea(clipToConvex(tread.outline, band)) + 1e-6, `${j.id}: ${g} has more contact than ${f}`);
        // the pocket is as wide as the tongue
        const p = j.pockets[0];
        const a = faceAxis(f);
        const ss = clipToConvex(cut, band).map((q) => (q.x - post.position.x) * a.x + (q.y - post.position.y) * a.y);
        assert.ok(Math.abs(p.sMin - Math.min(...ss)) < 1e-6 && Math.abs(p.sMax - Math.max(...ss)) < 1e-6, `${j.id}: pocket width`);
      }
    }
  }
});
