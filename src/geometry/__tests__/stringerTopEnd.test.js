import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { curveToPolyline } from '../profileCurve.js';

const lastBoard = (b, side) => {
  const list = b.stringerConstruction[side];
  return list[list.length - 1];
};
const maxV = (pts) => Math.max(...pts.map((p) => p.v));

test('regression (user, 2026-10-26): a housed wanga ending at the slab with no post is cut LEVEL at the floor — not run on above it into a spike; the outline (3D) and the curve (DXF) agree', () => {
  const config = { ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', treadsLegA: 5, treadsLegB: 4, windersPerTurn: 3, totalRise: 2900, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', manualPostOverrides: { 'post-end': { removed: true } } };
  const b = buildStaircase(config);
  for (const side of ['outer', 'inner']) {
    const g = lastBoard(b, side);
    assert.ok(maxV(g.outerContour) <= 2900 + 0.01, `${side}: contour top ${maxV(g.outerContour)}`);
    assert.ok(maxV(curveToPolyline(g.upperCurve)) <= 2900 + 0.01, `${side}: curve top`);
    assert.ok(maxV(g.outerContour) >= 2900 - 0.01, `${side}: reaches the floor`);
  }
  // a set height above the floor (a board standing a little proud of it)
  const proud = buildStaircase({ ...config, stringerTopEndAboveFloorMm: 30 });
  assert.ok(Math.abs(maxV(lastBoard(proud, 'outer').outerContour) - 2930) < 0.01);
});

test('a wanga running into the end newel keeps its top (it goes into the post)', () => {
  const config = { ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', treadsLegA: 5, treadsLegB: 4, windersPerTurn: 3, totalRise: 2900, stringerConstructionTypeInner: 'closed' };
  const b = buildStaircase(config);
  const inner = lastBoard(b, 'inner');
  const seg = b.stringerModels.inner.segments.find((s) => s.id === inner.segmentId);
  assert.ok(seg.endPost, 'the inner board ends at the end newel');
  assert.ok(maxV(inner.outerContour) > 2900, 'its top above the floor, into the post');
});
