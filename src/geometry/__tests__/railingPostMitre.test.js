// The handrail running into a post, mitred (user request 2026-11-23, the user's picture — "poręcz przechodzi w słup od
// razu"; the concrete module has it too): config.railingPostJoint (none / start / both) and per handrail end
// config.railingEndJoints[railingEndKey] = 'mitre' | 'plumb'. The run's line goes on to the post's centre, the
// handrail's end and the post's top are cut along ONE plane — the mitre bisecting the handrail's and the post's axes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { handrailPieceSolid } from '../railingRenderer.js';
import { renderPosts } from '../postRenderer.js';
import { railingEndKey } from '../railingProfileModel.js';
import { buildRailingDXF } from '../../export/dxfExport.js';

const build = (patch = {}) =>
  buildStaircase({ ...createDefaultConfig(), stairPending: false, stairType: 'straight', treadsLegA: 15, railingEnabled: true, railingSections: [{ id: 'r', side: 'inner', fromStep: 0, toStep: null }], ...patch });
const runs = (b) => b.railingModel.sections[0].runs.filter((r) => !r.wallRail);
const onPlane = (p, cut) => (p.x - cut.point.x) * cut.normal.x + (p.y - cut.point.y) * cut.normal.y + (p.z - cut.point.z) * cut.normal.z;

test('by default the handrail ends at the post faces, plumb; "start" mitres it into the first post only', () => {
  const plain = build();
  assert.equal(runs(plain)[0].pieces[0].startCut.kind, 'post');
  assert.ok(!plain.postModels.some((p) => p.topCut));
  const b = build({ railingPostJoint: 'start' });
  const run = runs(b)[0];
  const first = run.pieces[0];
  const post = b.postModels.find((p) => p.postId === run.startPostId);
  assert.equal(first.startCut.kind, 'mitre');
  assert.equal(runs(b).at(-1).pieces.at(-1).endCut.kind, 'post', 'the last end as before');
  // the line on to the post's centre (in plan)
  assert.ok(Math.hypot(first.start.x - post.position.x, first.start.y - post.position.y) < 1e-6, 'to the post centre');
  // the mitre: the bisector of the handrail's axis and the post's (up)
  const d = { x: first.end.x - first.start.x, y: first.end.y - first.start.y, z: first.end.z - first.start.z };
  const dl = Math.hypot(d.x, d.y, d.z);
  const n = first.startCut.normal;
  const angle = (a, b) => (Math.acos((a.x * b.x + a.y * b.y + a.z * b.z) / Math.hypot(a.x, a.y, a.z) / Math.hypot(b.x, b.y, b.z)) * 180) / Math.PI;
  assert.ok(Math.abs(angle(n, { x: d.x / dl, y: d.y / dl, z: d.z / dl }) - angle(n, { x: 0, y: 0, z: 1 })) < 1e-6, 'bisecting');
  assert.ok(Math.abs(Math.abs(first.startCut.verticalDeg) - (90 - first.pitchDeg) / 2) < 1e-6, 'the workshop angle (90 − pitch) / 2');
  // the post's top: cut along the same plane, its top = the plane's highest point over it
  assert.ok(post.topCut, 'the post carries the cut');
  assert.ok(Math.abs(onPlane(first.start, post.topCut)) < 1e-6);
  const h = post.size / 2;
  const zs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => post.topCut.point.z - (n.x * i * h + n.y * k * h) / n.z);
  assert.ok(Math.abs(post.elevation.top - Math.max(...zs)) < 1e-6);
  assert.ok(post.elevation.top > first.start.z, 'above the handrail axis');
});

test('"both" mitres the last post too; a handrail end\'s own choice over the default', () => {
  const b = build({ railingPostJoint: 'both' });
  const last = runs(b).at(-1);
  assert.equal(last.pieces.at(-1).endCut.kind, 'mitre');
  // at the top the post goes DOWN from the handrail: the bisector of the axis and "down"
  const p = last.pieces.at(-1);
  assert.ok(Math.abs(Math.abs(p.endCut.verticalDeg) - (90 + p.pitchDeg) / 2) < 1e-6);
  assert.ok(b.postModels.find((x) => x.postId === last.endPostId).topCut);
  const key = railingEndKey('r', last.endPostId, 'end');
  const own = build({ railingPostJoint: 'both', railingEndJoints: { [key]: 'plumb', junk: 'mitre' } });
  assert.equal(runs(own).at(-1).pieces.at(-1).endCut.kind, 'post', 'its own plumb');
  assert.equal(runs(own)[0].pieces[0].startCut.kind, 'mitre');
  assert.deepEqual(own.railingModel.endJoints, { [key]: 'plumb' });
  const only = build({ railingEndJoints: { [railingEndKey('r', runs(own)[0].startPostId, 'start')]: 'mitre' } });
  assert.equal(runs(only)[0].pieces[0].startCut.kind, 'mitre', 'its own mitre with the default none');
});

test('the renderers: the handrail\'s end face and the post\'s top on the mitre; the DXF names the cut', () => {
  const b = build({ railingPostJoint: 'start' });
  const run = runs(b)[0];
  const first = run.pieces[0];
  const cut = { point: first.start, normal: first.startCut.normal };
  const solid = handrailPieceSolid(first, b.railingModel.sections[0].handrail);
  for (const q of solid.start) assert.ok(Math.abs(onPlane(q, cut)) < 1e-6, 'the end face on the mitre');
  const post = b.postModels.find((p) => p.postId === run.startPostId);
  const group = renderPosts([post], new THREE.MeshBasicMaterial());
  const mesh = group.children[0];
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position');
  let onTop = 0;
  for (let k = 0; k < pos.count; k++) {
    const w = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(mesh.matrixWorld);
    if (w.y < post.elevation.bottom + 1) continue;
    const plan = { x: w.x, y: -w.z, z: w.y };
    assert.ok(Math.abs(onPlane(plan, post.topCut)) < 1e-3, 'every top vertex on the mitre');
    onTop++;
  }
  assert.ok(onTop >= 4);
  const dxf = buildRailingDXF(b.railingModel, { balusterSizeMm: b.fullConfig.railingBalusterSizeMm, config: b.fullConfig });
  assert.match(dxf, /skos .*wchodzi w slup/);
});
