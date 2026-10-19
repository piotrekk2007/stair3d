import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';

// an L whose opening covers the whole plan (2336 × 2886): the stair arrives at its E edge
const L = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'L', openingOffsetX: 0, openingOffsetY: 0, openingWidth: 2886, openingLength: 2336, railingOpeningEnabled: true, ...patch });
const openingSections = (b) => b.railingModel.sections.filter((s) => s.kind === 'opening');

test('balustrade round the opening: every edge but the exit edge; level, on the floor, at its own height', () => {
  const b = L();
  const edges = b.railingModel.openingEdges;
  assert.equal(edges.length, 4);
  assert.equal(edges.filter((e) => e.exit).length, 1, 'one exit edge');
  assert.ok(edges.filter((e) => !e.exit).every((e) => e.enabled));
  const sections = openingSections(b);
  assert.equal(sections.length, 1, 'three adjacent edges = one section');
  const s = sections[0];
  assert.ok(s.valid);
  const z = b.fullConfig.totalRise;
  for (const p of s.posts) {
    assert.equal(p.elevation.bottom, z, 'posts stand on the floor');
    assert.ok(p.elevation.top >= z + 1100 - 1e-6);
  }
  assert.deepEqual(s.postSpots.map((x) => x.kind), ['start', 'corner', 'corner', 'end']);
  const top = s.handrail.pieces.map((p) => p.start.z + s.handrail.heightMm / 2);
  assert.ok(top.every((t) => Math.abs(t - (z + 1100)) < 1e-6), 'handrail top 1100 above the floor');
  assert.ok(s.balusters.length > 10);
  assert.ok(s.balusters.every((x) => x.zBottom === z));
  // in the takeoff and the 3D model like any balustrade
  assert.ok(b.allPostModels.some((p) => p.postId.startsWith('railing-post-opening-')));
});

test('an edge switched by hand: off splits the section, on adds the exit edge; no opening railing when off', () => {
  const exitIndex = L().railingModel.openingEdges.find((e) => e.exit).index;
  const middle = (exitIndex + 2) % 4;
  const split = L({ railingOpeningEdges: { [middle]: false } });
  assert.equal(openingSections(split).length, 2);
  const all = L({ railingOpeningEdges: { [exitIndex]: true } });
  assert.equal(openingSections(all).length, 1);
  assert.equal(openingSections(all)[0].postSpots.filter((x) => x.kind === 'corner').length, 3, 'a closed loop: the start post closes it');
  assert.equal(openingSections(L({ railingOpeningEnabled: false })).length, 0);
});

test('the edges along the stairwell walls are left out by default', () => {
  const b = buildStaircase({ ...createDefaultConfig(), stairType: 'U', treadsLegB: 0, uSingleWinderZone: true, uWindersTotal: 6, turn1Type: 'winder', turn2Type: 'winder', stairwellRoomEnabled: true, openingMode: 'derived', railingOpeningEnabled: true });
  const edges = b.railingModel.openingEdges;
  assert.ok(edges.some((e) => e.wall), 'some edges are along walls');
  for (const e of edges) assert.equal(e.enabled, !e.wall && !e.exit);
});

test('hand-placed posts and a switched-off corner work on the opening sections too', () => {
  const s0 = openingSections(L())[0];
  const corner = s0.postSpots.find((x) => x.kind === 'corner');
  const s = openingSections(L({ railingPostEdits: { [s0.id]: { added: [{ id: 'm1', s: 600 }], suppressed: [corner.s] } } }))[0];
  assert.ok(s.postSpots.some((x) => x.kind === 'manual' && x.s === 600));
  assert.ok(!s.postSpots.some((x) => x.kind === 'corner' && Math.abs(x.s - corner.s) < 1));
  assert.equal(s.suppressedCorners.length, 1);
});

test('the opening balustrade below 1.1 m is a WARNING (PL-LEGAL-H-01)', () => {
  const b = L({ railingOpeningHeightMm: 900 });
  assert.ok(b.railingModel.diagnostics.some((d) => d.ruleId === 'PL-LEGAL-H-01' && d.parameter === 'railingOpeningHeightMm'));
});
