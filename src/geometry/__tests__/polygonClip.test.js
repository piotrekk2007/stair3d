import test from 'node:test';
import assert from 'node:assert/strict';

import { subtractConvex, clipToConvex, polygonArea } from '../polygonClip.js';

const rect = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test('clipToConvex: the overlap of a tread and a post square', () => {
  assert.ok(near(polygonArea(clipToConvex(rect(0, 0, 900, 270), rect(850, -50, 960, 60))), 50 * 60));
  assert.equal(clipToConvex(rect(0, 0, 10, 10), rect(20, 20, 30, 30)).length, 0);
});

test('subtractConvex: a post corner notched out of a tread (one piece, area = tread − overlap)', () => {
  const tread = rect(0, 0, 900, 270);
  const post = rect(850, -50, 960, 60);
  const pieces = subtractConvex(tread, post);
  assert.equal(pieces.length, 1);
  assert.ok(near(polygonArea(pieces[0].outer), 900 * 270 - 50 * 60));
  assert.equal(pieces[0].holes.length, 0);
});

test('subtractConvex: a post across the middle of a narrow board cuts it in two', () => {
  const pieces = subtractConvex(rect(0, 0, 1000, 40), rect(450, -30, 560, 70));
  assert.equal(pieces.length, 2);
  const areas = pieces.map((p) => polygonArea(p.outer)).sort((a, b) => a - b);
  assert.ok(near(areas[0], 440 * 40) && near(areas[1], 450 * 40), JSON.stringify(areas));
});

test('subtractConvex: a post standing inside a landing becomes a hole; a board inside the post disappears; no overlap = unchanged', () => {
  const inside = subtractConvex(rect(0, 0, 1000, 1000), rect(400, 400, 510, 510));
  assert.equal(inside.length, 1);
  assert.equal(inside[0].holes.length, 1);
  assert.deepEqual(subtractConvex(rect(10, 10, 20, 20), rect(0, 0, 110, 110)), []);
  const apart = subtractConvex(rect(0, 0, 10, 10), rect(20, 20, 30, 30));
  assert.equal(apart.length, 1);
  assert.ok(near(polygonArea(apart[0].outer), 100));
});

test('subtractConvex: a winder wedge through a post corner (slanted edges) keeps the right area', () => {
  // a wedge whose narrow end reaches into the post
  const wedge = [
    { x: 0, y: 0 },
    { x: 1000, y: -100 },
    { x: 1000, y: 300 },
  ];
  const post = rect(-55, -55, 55, 55);
  const pieces = subtractConvex(wedge, post);
  assert.equal(pieces.length, 1);
  const expected = polygonArea(wedge) - polygonArea(clipToConvex(wedge, post));
  assert.ok(near(polygonArea(pieces[0].outer), expected, 1e-2), `${polygonArea(pieces[0].outer)} vs ${expected}`);
});
