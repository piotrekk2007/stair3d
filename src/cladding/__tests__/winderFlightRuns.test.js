import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';

// user report 2026-11-13: a stair STARTING with winders at a corner — no skirting along the wall beside the zone (its
// flight has no straight step, so no frame for the side runs)
const wall = (id, flight, side) => ({ id, flight, side, type: 'full', from: null, to: null });

test('a flight that is only a winder zone (the stair starts with it): its walled side gets the skirting', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [{ kind: 'winders', count: 3, riseMm: 180, turn: 'right' }, { kind: 'steps', count: 8, riseMm: 180, goingMm: 270, widthMm: 1000 }],
    skirtingEnabled: true,
    wallList: [wall('a', 0, 'left'), wall('b', 1, 'left')],
  });
  const run = b.sideRuns.find((r) => r.id === '0-left');
  assert.ok(run, 'the zone’s wall side is a run');
  assert.equal(run.walled, true);
  assert.deepEqual(run.pieces.map((p) => p.element.kind), ['winder', 'winder']);
  const sk = b.finish.skirting.find((s) => s.key.flight === 0 && s.key.side === 'left');
  assert.ok(sk, 'its skirting');
  // along the wall (x = 0, the zone's incoming direction), the zone's length on it
  assert.equal(sk.origin.x, 0);
  assert.deepEqual(sk.dir, { x: 0, y: 1 });
  assert.ok(sk.lengthMm > 900, `${sk.lengthMm}`);
});

test('a stair ENDING with a winder zone: the wall along its exit direction gets the skirting too', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [{ kind: 'steps', count: 8, riseMm: 180, goingMm: 270, widthMm: 1000 }, { kind: 'winders', count: 3, riseMm: 180, turn: 'left' }],
    skirtingEnabled: true,
    wallList: [wall('a', 0, 'right'), wall('b', 1, 'right')],
  });
  assert.ok(b.sideRuns.some((r) => r.id === '1-right' && r.walled));
  assert.ok(b.finish.skirting.some((s) => s.key.flight === 1 && s.key.side === 'right'));
});
