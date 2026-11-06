import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitViewToBox } from '../offerFraming.js';

// the modern offer's picture (user decisions 2026-11-06): a tall narrow strip (84 × 276 mm) of a wide stair — between
// the whole stair inside ('contain') and the stair filling the strip's height ('height'), half way in scale
const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2900, 2800, 2300));
const aspect = 84 / 276;

test('fill: contain keeps the stair whole, height brings it nearer, 0.5 half way in scale', () => {
  const c = fitViewToBox(box, { aspect, fill: 'contain' });
  const h = fitViewToBox(box, { aspect, fill: 'height' });
  const m = fitViewToBox(box, { aspect, fill: 0.5 });
  assert.ok(h.radius < c.radius * 0.6, `height ${h.radius} vs contain ${c.radius}`);
  assert.ok(Math.abs(1 / m.radius - (1 / c.radius + 1 / h.radius) / 2) < 1e-12);
  assert.deepEqual(fitViewToBox(box, { aspect }), c, 'the default is contain (the 84 × 150 box as before)');
  assert.deepEqual(fitViewToBox(box, { aspect, fill: 0 }), c);
});
