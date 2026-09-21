import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { matchesSelection, applySelectionHighlight } from '../selectionHighlight.js';

const tread = (n) => ({ elementType: 'tread', stepId: `step-${n}`, stringerId: null, geometrySourceId: `tread:step-${n}` });
const riser = (n) => ({ elementType: 'riser', stepId: `step-${n}`, stringerId: null, geometrySourceId: `riser:step-${n}:panel-0` });
const board = (side) => ({ elementType: 'stringer', stepId: null, stringerId: side, geometrySourceId: `stringer:${side}:${side}-seg-0` });
const housing = (side, i) => ({ elementType: 'stringer', stepId: null, stringerId: side, geometrySourceId: `stringer:${side}:${side}-seg-0:housing-${i}` });
const post = (id) => ({ elementType: 'post', stepId: null, stringerId: null, geometrySourceId: `post:${id}` });

test('a step selection matches that step\'s tread AND riser, never another step', () => {
  const sel = { elementType: 'tread', stepIndex: 3 };
  assert.ok(matchesSelection(tread(3), sel));
  assert.ok(matchesSelection(riser(3), sel));
  assert.ok(!matchesSelection(tread(4), sel));
  assert.ok(!matchesSelection(board('outer'), sel));
});

test('a stringer selection matches only that side (and its own housings), never the other side', () => {
  const sel = { elementType: 'stringer', stringerId: 'outer', segmentId: null };
  assert.ok(matchesSelection(board('outer'), sel));
  assert.ok(matchesSelection(housing('outer', 2), sel));
  assert.ok(!matchesSelection(board('inner'), sel));
});

test('a segment selection matches its board and its housings, but not another segment', () => {
  const seg = { elementType: 'stringer', stringerId: 'outer', segmentId: 'outer-seg-0' };
  assert.ok(matchesSelection(board('outer'), seg));
  assert.ok(matchesSelection(housing('outer', 1), seg));
  assert.ok(!matchesSelection({ ...board('outer'), geometrySourceId: 'stringer:outer:outer-seg-1' }, seg));
});

test('a post selection matches by id; with no id it matches every post', () => {
  assert.ok(matchesSelection(post('post-start'), { elementType: 'post', postId: 'post-start' }));
  assert.ok(!matchesSelection(post('post-end'), { elementType: 'post', postId: 'post-start' }));
  assert.ok(matchesSelection(post('post-end'), { elementType: 'post', postId: null }));
});

test('no selection / no userData never matches', () => {
  assert.ok(!matchesSelection(tread(1), null));
  assert.ok(!matchesSelection(undefined, { elementType: 'tread', stepIndex: 1 }));
});

test('applySelectionHighlight tints ONLY matching meshes and fully restores materials afterwards', () => {
  const shared = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  const root = new THREE.Group();
  const make = (userData) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    m.userData = userData;
    root.add(m);
    return m;
  };
  const a = make(tread(1));
  const b = make(tread(2));

  assert.equal(applySelectionHighlight(root, { elementType: 'tread', stepIndex: 1 }), 1);
  assert.notEqual(a.material, shared, 'the highlighted mesh gets its OWN material clone');
  assert.equal(b.material, shared, 'other meshes keep the shared material untouched');
  assert.equal(shared.emissive.getHex(), 0x000000, 'the shared material itself is never modified');

  applySelectionHighlight(root, null);
  assert.equal(a.material, shared, 'clearing the selection restores the original material');
  assert.equal(a.userData._origMaterial, undefined);
});
