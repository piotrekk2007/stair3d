import test from 'node:test';
import assert from 'node:assert/strict';

import { snapPoint, snapGuidesXML } from '../planInteractions.js';

const VB = { x: -100, y: -2000, width: 1000, height: 2200 };

test('snapPoint reports which axes aligned to another point (and only those)', () => {
  const refs = [{ x: 300, y: 500 }];
  const both = snapPoint({ x: 310, y: 490 }, refs);
  assert.deepEqual(both.point, { x: 300, y: 500 });
  assert.equal(both.guideX, 300);
  assert.equal(both.guideY, 500);

  const onlyX = snapPoint({ x: 290, y: 900 }, refs);
  assert.equal(onlyX.guideX, 300);
  assert.equal(onlyX.guideY, null);
  assert.equal(onlyX.point.y, 900); // grid-snapped, not aligned

  const none = snapPoint({ x: 900, y: 900 }, refs);
  assert.equal(none.guideX, null);
  assert.equal(none.guideY, null);
});

test('snapGuidesXML: a vertical line at guideX and a horizontal one at the flipped svg y; nothing without a guide', () => {
  assert.equal(snapGuidesXML(null, null, VB), '');
  const xml = snapGuidesXML(300, 500, VB);
  assert.ok(xml.includes('x1="300" y1="-2000" x2="300" y2="200"'));
  assert.ok(xml.includes('x1="-100" y1="-500" x2="900" y2="-500"'));
  assert.equal((snapGuidesXML(300, null, VB).match(/snap-guide"/g) || []).length, 1);
});
