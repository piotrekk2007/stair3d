import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { pocketBox } from '../jointSolver.js';
import { buildJointMarkers } from '../jointMarkers.js';
import { buildJointMarkersOverlay } from '../../scene/jointMarkersOverlay.js';

const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...patch });
const count = (list, kind) => list.filter((x) => x.kind === kind).length;

test('the joints layer shows exactly what the DXFs mark: every pocket, every housing, every hole and nut bore', () => {
  for (const patch of [{}, { hasRiserBoards: true }, { stairType: 'U' }, { turnDirection: 'left' }, { jointConnectorPostMode: 'blind' }]) {
    const m = build(patch);
    const k = buildJointMarkers(m);
    const pockets = Object.values(m.joints.pocketsByPost).flat();
    const housings = ['outer', 'inner'].flatMap((s) => m.stringerConstruction[s].flatMap((g) => g.housings || []));
    const postHoles = Object.values(m.joints.holesByPost).flat().filter((h) => !h.exit);
    const segHoles = Object.values(m.joints.holesBySegment).flat();
    assert.equal(count(k.boxes, 'post-pocket'), pockets.length, JSON.stringify(patch));
    assert.equal(count(k.boxes, 'wanga-housing'), housings.length);
    assert.equal(count(k.cylinders, 'bolt'), postHoles.length + segHoles.length);
    assert.equal(count(k.cylinders, 'nut-bore'), segHoles.filter((h) => h.kind === 'axial').length);
  }
});

test('markers sit where the elements are: a pocket box is the pocket, a bolt starts on the post face, a housing is inside the wanga', () => {
  const m = build({});
  const k = buildJointMarkers(m);
  // post pockets: the same box as pocketBox (the 3D post's own cut)
  const [postId, pockets] = Object.entries(m.joints.pocketsByPost)[0];
  const post = m.postModels.find((p) => p.postId === postId);
  const b = pocketBox(post, pockets[0]);
  const box = k.boxes.find((x) => x.kind === 'post-pocket' && x.label.startsWith(postId));
  assert.ok(Math.abs(box.center.x - (b.minX + b.maxX) / 2) < 1e-9 && Math.abs(box.sizeZ - (b.maxZ - b.minZ)) < 1e-9);
  // every bolt drilled into a post starts on its surface and stays inside it
  for (const [id, holes] of Object.entries(m.joints.holesByPost)) {
    const p = m.postModels.find((x) => x.postId === id);
    const h = p.size / 2;
    for (const c of k.cylinders.filter((x) => x.label.startsWith(`${id}:`))) {
      for (const q of [c.a, c.b]) assert.ok(Math.abs(q.x - p.position.x) <= h + 1e-6 && Math.abs(q.y - p.position.y) <= h + 1e-6, `${c.label}`);
      assert.ok(Math.max(Math.abs(c.a.x - p.position.x), Math.abs(c.a.y - p.position.y)) > h - 1e-6, 'starts on a face');
    }
    assert.ok(holes.length > 0);
  }
  // every wanga housing lies within the board's thickness, against its inner face
  for (const side of ['outer', 'inner']) {
    for (const seg of m.stringerModels[side].segments) {
      for (const x of k.boxes.filter((bx) => bx.kind === 'wanga-housing' && bx.label.startsWith(`${seg.id}:`))) {
        const n = (x.center.x - seg.referenceLine.start.x) * seg.inwardNormal.x + (x.center.y - seg.referenceLine.start.y) * seg.inwardNormal.y;
        assert.ok(Math.abs(n + x.sizeN / 2 - seg.thickness) < 1e-6, `${x.label}: against the inner face`);
      }
    }
  }
});

test('overlay: one see-through mesh per marker, drawn over the wood, never part of the exported model', () => {
  const m = build({ hasRiserBoards: true });
  const k = buildJointMarkers(m);
  const g = buildJointMarkersOverlay(k);
  assert.equal(g.name, 'JointMarkers');
  assert.equal(g.children.length, k.boxes.length + k.cylinders.length);
  for (const mesh of g.children) {
    assert.equal(mesh.material.depthTest, false);
    assert.ok(mesh.material.transparent);
    assert.ok(mesh.userData.jointMarker?.kind);
  }
  let inModel = false;
  m.root.traverse((o) => {
    if (o.name === 'JointMarkers' || o.userData?.jointMarker) inModel = true;
  });
  assert.equal(inModel, false, 'the model tree (exported to OBJ/DAE) has no markers');
  assert.deepEqual(buildJointMarkers({}), { boxes: [], cylinders: [] });
});
