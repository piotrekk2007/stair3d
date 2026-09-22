import test from 'node:test';
import assert from 'node:assert/strict';

import { snapDragTarget, roundToGrid, niceGridStepMm, tickPositions, SNAP_TOLERANCE_MM } from '../profileEditorSnapping.js';

test('snapDragTarget: snaps to a nearby point\'s own elevation, keeping u unchanged', () => {
  const points = [{ id: 'support:step-2', contour: 'lower', v: 1000 }, { id: 'support:step-3', contour: 'lower', v: 1200 }];
  const target = { u: 555, v: 1003 };
  const result = snapDragTarget(target, { id: 'support:step-9', contour: 'lower' }, points, null);
  assert.equal(result.u, 555);
  assert.equal(result.v, 1000);
  assert.deepEqual(result.snap, { type: 'point', label: 'support:step-2' });
});

test('snapDragTarget: never snaps to the point being dragged itself', () => {
  const points = [{ id: 'support:step-2', contour: 'lower', v: 1000 }];
  const target = { u: 100, v: 1001 };
  const result = snapDragTarget(target, { id: 'support:step-2', contour: 'lower' }, points, null);
  assert.equal(result.snap, null);
});

test('snapDragTarget: a point on a DIFFERENT contour can still be a snap target (aligning lower and upper)', () => {
  const points = [{ id: 'end:top', contour: 'upper', v: 500 }];
  const result = snapDragTarget({ u: 10, v: 502 }, { id: 'support:step-1', contour: 'lower' }, points, null);
  assert.equal(result.snap.type, 'point');
  assert.equal(result.v, 500);
});

test('snapDragTarget: outside the tolerance, no point snap happens', () => {
  const points = [{ id: 'support:step-2', contour: 'lower', v: 1000 }];
  const target = { u: 100, v: 1000 + SNAP_TOLERANCE_MM + 1 };
  const result = snapDragTarget(target, { id: 'x', contour: 'lower' }, points, null);
  assert.equal(result.snap, null);
  assert.deepEqual(result, { u: target.u, v: target.v, snap: null });
});

test('snapDragTarget: falls back to the minimum-depth envelope when no point is close enough', () => {
  const envelope = [{ u: 0, v: 0 }, { u: 1000, v: 500 }];
  const target = { u: 400, v: 205 }; // near, but not exactly on, the envelope line
  const result = snapDragTarget(target, { id: 'x', contour: 'lower' }, [], envelope);
  assert.equal(result.snap.type, 'envelope');
  // the snapped point must actually lie ON the envelope line (v = u/2) and be its closest point to target
  assert.ok(Math.abs(result.v - result.u / 2) < 1e-6, 'the snapped point is not on the envelope line');
  assert.ok(Math.hypot(result.u - target.u, result.v - target.v) < Math.hypot(400 - target.u, 200 - target.v) + 1, 'not the nearest point');
});

test('snapDragTarget: a point snap takes priority over the envelope even when both are close', () => {
  const envelope = [{ u: 0, v: 0 }, { u: 1000, v: 0 }];
  const points = [{ id: 'p', contour: 'lower', v: 3 }];
  const result = snapDragTarget({ u: 10, v: 2 }, { id: 'x', contour: 'lower' }, points, envelope);
  assert.equal(result.snap.type, 'point');
});

test('snapDragTarget: too far from everything falls through untouched', () => {
  const result = snapDragTarget({ u: 10, v: 500 }, { id: 'x', contour: 'lower' }, [{ id: 'p', contour: 'lower', v: 0 }], [{ u: 0, v: 900 }, { u: 20, v: 900 }]);
  assert.deepEqual(result, { u: 10, v: 500, snap: null });
});

test('roundToGrid: snaps to the nearest 5 mm by default, both directions and signs', () => {
  assert.equal(roundToGrid(12), 10);
  assert.equal(roundToGrid(13), 15);
  assert.equal(roundToGrid(-7), -5);
  assert.equal(roundToGrid(52, 10), 50);
});

test('niceGridStepMm: picks a 1/2/5 x 10^n step so the on-screen spacing stays close to the target', () => {
  // 1 px = 10 mm, target 100 px -> ~1000 mm target -> nice step 1000
  assert.equal(niceGridStepMm(10, 100), 1000);
  // 1 px = 1 mm, target 90 px -> ~90 mm target, magnitude 10, residual 9 -> step 5*10=50
  assert.equal(niceGridStepMm(1, 90), 50);
  // 1 px = 3 mm, target 90 -> 270mm target, magnitude 100, residual 2.7 -> step 2*100=200
  assert.equal(niceGridStepMm(3, 90), 200);
  assert.ok(niceGridStepMm(0, 90) > 0, 'never returns a non-positive step');
});

test('tickPositions: covers the requested range on the grid, nothing outside it', () => {
  const ticks = tickPositions(12, 47, 10);
  assert.deepEqual(ticks, [20, 30, 40]);
  assert.deepEqual(tickPositions(0, 0, 5), [0]);
  assert.deepEqual(tickPositions(-12, 8, 10), [-10, 0]);
});
