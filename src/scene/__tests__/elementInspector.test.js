import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTraceability } from '../elementInspector.js';

test('resolveTraceability: returns userData when the object itself is traceable', () => {
  const mesh = { userData: { elementType: 'tread', stepId: 'step-2', stringerId: null, geometrySourceId: 'tread:step-2' } };
  assert.deepEqual(resolveTraceability(mesh), mesh.userData);
});

test('resolveTraceability: walks up the parent chain to find traceability on an ancestor', () => {
  const group = { userData: { elementType: 'stringer', stepId: 'step-4', stringerId: 'outer', geometrySourceId: 'stringer:outer:outer-seg-0:bearing-4' }, parent: null };
  const child = { userData: {}, parent: group };
  const grandchild = { userData: {}, parent: child };
  assert.deepEqual(resolveTraceability(grandchild), group.userData);
});

test('resolveTraceability: returns null when nothing in the chain is traceable (e.g. a grid helper)', () => {
  const untraceable = { userData: {}, parent: { userData: {}, parent: null } };
  assert.equal(resolveTraceability(untraceable), null);
});

test('resolveTraceability: returns null for a null/undefined object', () => {
  assert.equal(resolveTraceability(null), null);
  assert.equal(resolveTraceability(undefined), null);
});
