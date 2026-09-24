import test from 'node:test';
import assert from 'node:assert/strict';

import { smoothPath } from '../smoothPath.js';

const near = (a, b, eps = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) < eps;

test('the smooth path passes exactly through every input point, in order', () => {
  const input = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 600, y: 40 }, { x: 800, y: 200 }, { x: 900, y: 500 }, { x: 900, y: 800 }];
  const out = smoothPath(input, 30);
  let cursor = 0;
  for (const p of input) {
    const at = out.findIndex((q, i) => i >= cursor && near(q, p));
    assert.ok(at >= cursor, `input point ${JSON.stringify(p)} is on the curve`);
    cursor = at;
  }
  assert.ok(out.length > input.length * 3, 'resampled densely');
});

test('collinear points stay exactly a straight line (a straight flight is not bent)', () => {
  const out = smoothPath([{ x: 0, y: 0 }, { x: 270, y: 0 }, { x: 540, y: 0 }, { x: 810, y: 0 }], 40);
  for (const p of out) assert.ok(Math.abs(p.y) < 1e-9);
  const xs = out.map((p) => p.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'never doubles back');
});

test('a 90 degree turn through points on an arc is rounded and does not overshoot it', () => {
  const R = 500;
  const arc = [0, 22.5, 45, 67.5, 90].map((deg) => ({ x: R * Math.cos((deg * Math.PI) / 180), y: R * Math.sin((deg * Math.PI) / 180) }));
  const points = [{ x: R, y: -600 }, { x: R, y: -300 }, ...arc, { x: -300, y: R }, { x: -600, y: R }];
  const out = smoothPath(points, 25);
  for (const p of out) {
    if (p.x > 0 && p.y > 0) assert.ok(Math.abs(Math.hypot(p.x, p.y) - R) < 12, `stays close to the arc (${Math.hypot(p.x, p.y)})`);
  }
});

test('degenerate input never produces NaN: duplicates, one or two points, nothing', () => {
  assert.deepEqual(smoothPath([], 40), []);
  assert.deepEqual(smoothPath(null), []);
  assert.deepEqual(smoothPath([{ x: 1, y: 1 }]), [{ x: 1, y: 1 }]);
  assert.equal(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]).length, 2);
  const out = smoothPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 20);
  for (const p of out) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(near(out[0], { x: 0, y: 0 }) && near(out[out.length - 1], { x: 100, y: 100 }));
});
