import test from 'node:test';
import assert from 'node:assert/strict';

import { stepIndexFromElementId, selectionFromTakeoffSourceId } from '../selection.js';

test('stepIndexFromElementId parses the step-N convention', () => {
  assert.equal(stepIndexFromElementId('step-7'), 7);
  assert.equal(stepIndexFromElementId('step-0'), 0);
});

test('stepIndexFromElementId returns null for anything else', () => {
  assert.equal(stepIndexFromElementId('stair'), null);
  assert.equal(stepIndexFromElementId('config'), null);
  assert.equal(stepIndexFromElementId(null), null);
  assert.equal(stepIndexFromElementId(undefined), null);
  assert.equal(stepIndexFromElementId('step-abc'), null);
});

test('selectionFromTakeoffSourceId parses a tread id', () => {
  assert.deepEqual(selectionFromTakeoffSourceId('tread:step-3'), { elementType: 'tread', stepIndex: 3 });
});

test('selectionFromTakeoffSourceId parses a riser id with a panel', () => {
  assert.deepEqual(selectionFromTakeoffSourceId('riser:step-3:panel-1'), { elementType: 'riser', stepIndex: 3, panelId: 'panel-1' });
});

test('selectionFromTakeoffSourceId parses a riser id without a panel', () => {
  assert.deepEqual(selectionFromTakeoffSourceId('riser:step-3'), { elementType: 'riser', stepIndex: 3, panelId: null });
});

test('selectionFromTakeoffSourceId parses a stringer segment id', () => {
  assert.deepEqual(selectionFromTakeoffSourceId('stringer:outer:outer-seg-0'), {
    elementType: 'stringer',
    stringerId: 'outer',
    segmentId: 'outer-seg-0',
  });
});

test('selectionFromTakeoffSourceId parses a post id', () => {
  assert.deepEqual(selectionFromTakeoffSourceId('post:post-start'), { elementType: 'post', postId: 'post-start' });
});

test('selectionFromTakeoffSourceId returns null for an unknown convention', () => {
  assert.equal(selectionFromTakeoffSourceId('widget:foo'), null);
  assert.equal(selectionFromTakeoffSourceId(null), null);
  assert.equal(selectionFromTakeoffSourceId('tread:not-a-step'), null);
});
