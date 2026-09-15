import test from 'node:test';
import assert from 'node:assert/strict';

import { createHistory, commit, undo, redo, canUndo, canRedo } from '../modelHistory.js';

test('fresh history cannot undo or redo', () => {
  const h = createHistory({ a: 1 });
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});

test('commit then undo restores the previous snapshot', () => {
  const h = createHistory({ a: 1 });
  commit(h, { a: 2 });
  assert.equal(canUndo(h), true);
  const restored = undo(h);
  assert.deepEqual(restored, { a: 1 });
  assert.equal(canRedo(h), true);
});

test('undo then redo restores the newer snapshot', () => {
  const h = createHistory({ a: 1 });
  commit(h, { a: 2 });
  undo(h);
  const redone = redo(h);
  assert.deepEqual(redone, { a: 2 });
  assert.equal(canRedo(h), false);
});

test('a new commit after undo discards the abandoned redo future', () => {
  const h = createHistory({ a: 1 });
  commit(h, { a: 2 });
  undo(h); // current = a:1, redo available = a:2
  commit(h, { a: 3 }); // fresh edit — a:2 future is gone
  assert.equal(canRedo(h), false);
  const restored = undo(h);
  assert.deepEqual(restored, { a: 1 });
});

test('multiple commits produce a correctly ordered undo chain', () => {
  const h = createHistory({ v: 0 });
  for (let i = 1; i <= 5; i++) commit(h, { v: i });
  const seen = [];
  while (canUndo(h)) seen.push(undo(h).v);
  assert.deepEqual(seen, [4, 3, 2, 1, 0]);
});

test('snapshots are deep-cloned — mutating the object passed to commit does not corrupt history', () => {
  const h = createHistory({ nested: { x: 1 } });
  const payload = { nested: { x: 2 } };
  commit(h, payload);
  payload.nested.x = 999; // mutate after commit
  const restored = undo(h);
  assert.equal(restored.nested.x, 1);
  // redo() must also be unaffected by the later mutation of `payload`
  const redone = redo(h);
  assert.equal(redone.nested.x, 2);
});

test('history caps at MAX_HISTORY_ENTRIES and drops the oldest entries', () => {
  const h = createHistory({ v: 0 });
  for (let i = 1; i <= 150; i++) commit(h, { v: i });
  let count = 0;
  while (canUndo(h)) {
    undo(h);
    count++;
  }
  assert.ok(count <= 100, `expected at most 100 undoable steps, got ${count}`);
});
