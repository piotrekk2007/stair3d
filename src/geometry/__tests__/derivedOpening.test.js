import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData, deriveCeilingFit } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { resolveOpening, openingFrame, requiredOpeningRelative, polygonContainsPolygon } from '../ceilingOpening.js';
import { stairwellExitOutline, openingExitEdge } from '../stairwell.js';
import { generateStairwellVariants } from '../../designer/stairwellVariants.js';

const cfg = (patch = {}) => ({ ...createDefaultConfig(), ...patch });
const layoutOf = (c) => {
  const riserHeight = deriveStairData(c).riserHeight;
  return { riserHeight, L: buildPlanLayout({ ...c, riserHeight }) };
};
const room = { stairwellRoomEnabled: true, stairwellEntrySide: 'S', stairwellEntryOffsetMm: 0, stairwellWallGapMm: 0 };

test('derived opening: every tread that needs headroom lies in it, the ceiling fit passes, a tread that does not is left out', () => {
  for (const stairType of ['straight', 'L', 'U']) {
    const c = cfg({ stairType, ...(stairType === 'straight' ? { treadsLegA: 15 } : {}), openingMode: 'derived' });
    const { riserHeight, L } = layoutOf(c);
    const fit = deriveCeilingFit(c, L, riserHeight);
    assert.equal(fit.openingMode, 'derived', stairType);
    assert.equal(fit.fits, true, stairType);
    const threshold = c.totalRise - c.ceilingThickness - c.minHeadroom;
    const low = L.treads.find((t) => (t.index + 1) * riserHeight <= threshold - 100 && !polygonContainsPolygon(fit.openingOutline, t.outline));
    assert.ok(low, `${stairType}: the lowest treads are not under the opening`);
  }
});

test('derived opening of an L is the union along the axes (an L-shaped polygon), not one big rectangle', () => {
  const c = cfg({ stairType: 'L', treadsLegA: 6, treadsLegB: 6, totalRise: 3200, openingMode: 'derived' });
  const { riserHeight, L } = layoutOf(c);
  const rel = requiredOpeningRelative(c, L, riserHeight, openingFrame(c, L));
  assert.ok(rel.length >= 6, `${rel.length} corners`);
  for (let i = 0; i < rel.length; i++) {
    const a = rel[i];
    const b = rel[(i + 1) % rel.length];
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'sides along the axes');
  }
});

test('given mode is untouched; a frozen derived opening (polygon) is the same outline', () => {
  const c = cfg({ stairType: 'L', openingOffsetX: 100 });
  const { riserHeight, L } = layoutOf(c);
  assert.deepEqual(deriveCeilingFit(c, L, riserHeight).openingOutline, resolveOpening(c, L.bounds).outline);
  const d = { ...c, openingMode: 'derived' };
  const derived = deriveCeilingFit(d, L, riserHeight);
  const frozen = { ...c, openingMode: 'given', openingShape: 'polygon', openingPolygon: derived.openingRelativeOutline };
  assert.deepEqual(deriveCeilingFit(frozen, L, riserHeight).openingOutline, derived.openingOutline);
});

test('with a room and a derived opening the exit is the room wall line moved in by the inset', () => {
  const c = cfg({ ...room, stairwellRoomWidthMm: 2000, stairwellRoomLengthMm: 3000, stairwellExitSide: 'N', openingMode: 'derived', stairwellExitInsetMm: 250 });
  const e = openingExitEdge(stairwellExitOutline(c, []), 'N');
  assert.equal(e.a.y, 2750);
  assert.equal(e.b.y, 2750);
  // a given opening keeps its own edge
  assert.deepEqual(stairwellExitOutline({ ...c, openingMode: 'given' }, [{ x: 0, y: 0 }]), [{ x: 0, y: 0 }]);
});

test('Klimek room with the opening derived: the same best variant, the opening it needs listed, no ceiling collision', () => {
  const k = cfg({ ...room, stairType: 'U', totalRise: 3070, stairWidth: 965, stringerThickness: 40, walklineOffset: 500, minRiser: 150, maxRiser: 200, ceilingThickness: 380, treadGoing: 267, stairwellRoomWidthMm: 1890, stairwellRoomLengthMm: 2350, stairwellEntryOffsetMm: 267, stairwellExitSide: 'S', openingMode: 'derived' });
  const r = generateStairwellVariants(k);
  const best = r.variants[0];
  assert.equal(best.id, 'U-zone6');
  assert.equal(best.metrics.ceilingCollisions, 0);
  assert.ok(best.metrics.openingSize.x > 0 && best.metrics.openingSize.y > 0);
  const built = buildStaircase({ ...k, ...best.patch });
  assert.deepEqual(built.stairwell.diagnostics, []);
  assert.equal(built.ceilingFit.fits, true);
});

test('with a room the derived opening reaches the walls the wangi stand at (no strip of slab over a wanga)', () => {
  const c = cfg({ ...room, stairType: 'L', stairwellRoomWidthMm: 2886, stairwellRoomLengthMm: 2336, stairwellExitSide: 'E', openingMode: 'derived' });
  const { riserHeight, L } = layoutOf(c);
  const rel = requiredOpeningRelative(c, L, riserHeight, openingFrame(c, L));
  const xs = rel.map((p) => p.x);
  const ys = rel.map((p) => p.y);
  assert.ok(Math.abs(Math.min(...xs)) <= 0.1, `${Math.min(...xs)}`);
  assert.ok(Math.abs(Math.max(...ys) - 2336) <= 0.1, `${Math.max(...ys)}`);
});
