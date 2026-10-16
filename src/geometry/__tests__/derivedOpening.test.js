import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData, deriveCeilingFit } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { resolveOpening, openingFrame, requiredOpeningRelative, polygonContainsPolygon } from '../ceilingOpening.js';
import { generateStairwellVariants } from '../../designer/stairwellVariants.js';

const cfg = (patch = {}) => ({ ...createDefaultConfig(), ...patch });
const layoutOf = (c) => {
  const riserHeight = deriveStairData(c).riserHeight;
  return { riserHeight, L: buildPlanLayout({ ...c, riserHeight }) };
};

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
  for (const well of [false, true]) {
    const c = cfg({ stairType: 'L', openingOffsetX: 100, stairwellRoomEnabled: well });
    const { riserHeight, L } = layoutOf(c);
    if (!well) assert.deepEqual(deriveCeilingFit(c, L, riserHeight).openingOutline, resolveOpening(c, L.bounds).outline);
    const derived = deriveCeilingFit({ ...c, openingMode: 'derived' }, L, riserHeight);
    const frozen = { ...c, openingMode: 'given', openingShape: 'polygon', openingPolygon: derived.openingRelativeOutline };
    assert.deepEqual(deriveCeilingFit(frozen, L, riserHeight).openingOutline, derived.openingOutline, `well ${well}`);
  }
});

test('with the stairwell walls the derived opening reaches them (no strip of slab over a wanga)', () => {
  const c = cfg({ stairType: 'L', stairwellRoomEnabled: true, openingMode: 'derived' });
  const { riserHeight, L } = layoutOf(c);
  const rel = requiredOpeningRelative(c, L, riserHeight, openingFrame(c, L));
  const xs = rel.map((p) => p.x);
  const ys = rel.map((p) => p.y);
  assert.ok(Math.abs(Math.min(...xs)) <= 0.1, `wall A: ${Math.min(...xs)}`);
  assert.ok(Math.abs(Math.min(...ys)) <= 0.1, `end wall: ${Math.min(...ys)}`);
});

test('the user\'s U (B 1885, C 2350 fixed, A free) with the opening derived: fixed sides met, no ceiling collision', () => {
  const k = cfg({ stairType: 'U', turnDirection: 'right', totalRise: 3070, stairWidth: 965, stringerThickness: 40, walklineOffset: 500, ceilingThickness: 380, stairwellRoomEnabled: true, stairwellSideBMm: 1885, stairwellSideBFixed: true, stairwellSideCMm: 2350, stairwellSideCFixed: true, openingMode: 'derived' });
  const best = generateStairwellVariants(k).variants[0];
  assert.ok(best.ok, best.problems.join(' | '));
  assert.equal(best.metrics.ceilingCollisions, 0);
  assert.ok(best.metrics.openingSize.x > 0 && best.metrics.openingSize.y > 0);
  const built = buildStaircase({ ...k, ...best.patch });
  assert.deepEqual(built.stairwell.diagnostics, []);
  assert.equal(built.ceilingFit.fits, true);
});
