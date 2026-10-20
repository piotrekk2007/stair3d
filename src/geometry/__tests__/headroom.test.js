import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildHeadroomOverlay } from '../../scene/headroomOverlay.js';

const straight = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 15, openingMode: 'derived', ...patch });

test('headroom: a straight stair under an opening it fits — one curtain on the entry-side edge, enough headroom, none at the exit', () => {
  const b = straight();
  const h = b.headroom;
  const soffit = b.fullConfig.totalRise - b.fullConfig.ceilingThickness;
  assert.equal(b.ceilingFit.violatingTreads.length, 0);
  assert.equal(h.blocks.length, 0);
  assert.ok(h.pieces.length >= 1);
  assert.ok(h.min.ok && h.min.headroomMm >= b.fullConfig.minHeadroom);
  // the curtain stands on the first tread under the slab: its top + the headroom = the soffit
  const rh = b.fullConfig.riserHeight;
  for (const p of h.pieces) {
    assert.ok(Math.abs(p.zTop - soffit) < 1e-6);
    const index = Number(p.stepId.slice(5));
    assert.ok(Math.abs(p.zBottom - (index + 1) * rh) < 1e-6);
    assert.ok(Math.abs(p.headroomMm - (soffit - p.zBottom)) < 1e-6);
  }
  // nothing over the last treads (the exit — the stair arrives on the slab there)
  const n = b.planLayout.treads.length;
  assert.ok(!h.pieces.some((p) => p.stepId === `step-${n - 1}`));
});

test('headroom: the treads the ceiling check flags are under-slab blocks; the tightest spot is not enough (red)', () => {
  const b = buildStaircase({ ...createDefaultConfig() }); // the default L has ceiling collisions
  const h = b.headroom;
  assert.ok(b.ceilingFit.violatingTreads.length > 0);
  // (a tread at or above the soffit goes through the slab — nothing to measure there)
  const soffit = b.fullConfig.totalRise - b.fullConfig.ceilingThickness;
  const rh = b.fullConfig.riserHeight;
  const flagged = new Set(b.ceilingFit.violatingTreads.filter((i) => (i + 1) * rh < soffit).map((i) => `step-${i}`));
  assert.ok(flagged.size > 0);
  assert.equal(new Set(h.blocks.map((x) => x.stepId)).size, flagged.size);
  assert.ok(h.blocks.every((x) => flagged.has(x.stepId) && !x.ok));
  assert.equal(h.min.ok, false);
  assert.ok(h.min.headroomMm < b.fullConfig.minHeadroom);
});

test('headroom overlay: a mesh per curtain / block and the dimension line; nothing without pieces', () => {
  const b = straight();
  const g = buildHeadroomOverlay(b.headroom);
  let meshes = 0;
  let lines = 0;
  g.traverse((o) => {
    if (o.isMesh) meshes++;
    if (o.isLine) lines++;
  });
  assert.equal(meshes, b.headroom.pieces.length + b.headroom.blocks.length);
  assert.ok(lines >= 3, 'the meeting line, the dimension and its ticks');
  assert.equal(buildHeadroomOverlay({ pieces: [], blocks: [], min: null }), null);
});
