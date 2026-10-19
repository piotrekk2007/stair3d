import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';

// The user's Testowy_1 (2026-10-19): U, one 180° zone of 5 winders, axis gap 15 — its tread 9 is a TRIANGLE (front and
// back edges cross before the inner line).
const TESTOWY = { ...createDefaultConfig(), stairType: 'U', turnDirection: 'right', totalRise: 2944, stairWidth: 955, treadGoing: 275.53539062730914, treadsLegA: 6, treadsLegB: 0, treadsLegC: 5, uSingleWinderZone: true, uWindersTotal: 5, uAxisGapMm: 15, turn1Type: 'winder', turn2Type: 'winder', walklineOffset: 440, minInnerWidth: 105, stringerThickness: 40, treadThickness: 40 };

// The nosed outline's front: the longest outline side whose BOTH ends stand `nosing` in front of the structural front
// edge's line — i.e. the nosing edge is parallel to the front edge at the full distance. Returns its length.
function nosingEdgeLength(model, nosing) {
  const [a, b] = model.frontEdge.final;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const c = model.outline.reduce((acc, p) => ({ x: acc.x + p.x / model.outline.length, y: acc.y + p.y / model.outline.length }), { x: 0, y: 0 });
  if ((c.x - a.x) * n.x + (c.y - a.y) * n.y > 0) n = { x: -n.x, y: -n.y }; // outward = away from the tread
  const dist = (p) => (p.x - a.x) * n.x + (p.y - a.y) * n.y;
  let best = 0;
  model.outline.forEach((p, i) => {
    const q = model.outline[(i + 1) % model.outline.length];
    if (Math.abs(dist(p) - nosing) < 0.5 && Math.abs(dist(q) - nosing) < 0.5) best = Math.max(best, Math.hypot(q.x - p.x, q.y - p.y));
  });
  return { length: best, front: len };
}

test('regression (user, 2026-10-19): every tread follows the nosing setting — also a triangular winder of a 180° zone', () => {
  const zero = buildStaircase({ ...TESTOWY, nosing: 0 });
  const triangle = zero.treadModels.find((m) => m.outline.length === 3);
  assert.ok(triangle, 'the layout has a triangular winder');
  for (const nosing of [25, 60]) {
    const built = buildStaircase({ ...TESTOWY, nosing });
    for (const m of built.treadModels) {
      const { length, front } = nosingEdgeLength(m, nosing);
      assert.ok(length >= 0.9 * front, `nosing ${nosing}: tread ${m.index + 1} (${m.type}, ${m.outline.length} corners): nosing edge ${length.toFixed(0)} mm of a ${front.toFixed(0)} mm front edge`);
    }
  }
});
