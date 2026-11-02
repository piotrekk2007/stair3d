import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';

// the landing's depth (user request 2026-11-02: "a big landing 1800 x 900 — I need it 1080 deep to even out the
// treads"): config.landingDepthMm along the flight entering the landing, null = the stair's width (the old square)
const cfg = (patch) => ({ ...createDefaultConfig(), stairWidth: 900, treadGoing: 270, turnDirection: 'right', ...patch });
const bigU = { stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: true, treadsLegA: 6, treadsLegB: 0, treadsLegC: 6 };
const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
const landingOf = (layout) => layout.treads.filter((t) => t.type === 'landing');

test('null = the stair’s width: the landing is the old square (nothing changes for an existing project)', () => {
  for (const patch of [bigU, { stairType: 'L', turn1Type: 'landing', treadsLegA: 6, treadsLegB: 5 }]) {
    const a = buildPlanLayout(cfg({ ...patch, landingDepthMm: null }));
    const b = buildPlanLayout(cfg({ ...patch, landingDepthMm: 900 }));
    assert.deepEqual(b.treads.map((t) => t.outline), a.treads.map((t) => t.outline));
    assert.deepEqual(b.innerFullPath, a.innerFullPath);
  }
});

test('the U’s big landing 1080 deep: 2 widths × 1080, flights A and C where they were, one corner post, no spike in the dusza line', () => {
  const sq = buildStaircase(cfg(bigU));
  const deep = buildStaircase(cfg({ ...bigU, landingDepthMm: 1080 }));
  const [L] = landingOf(deep.planLayout);
  assert.ok(Math.abs(span(L.outerChain, 'y') - 1080) < 1e-6, `depth ${span(L.outerChain, 'y')}`);
  assert.ok(Math.abs(span(L.outerChain, 'x') - 1800) < 1e-6);
  assert.ok(Math.abs(span(landingOf(sq.planLayout)[0].outerChain, 'y') - 900) < 1e-6);
  // the flights do not move: every non-landing tread is where it was
  const flights = (b) => b.planLayout.treads.filter((t) => t.type !== 'landing').map((t) => t.frontEdge.final ?? t.frontEdge);
  assert.deepEqual(flights(deep), flights(sq));
  // the dusza line goes from A straight on to C at the landing's near edge (it went out and back along A's line)
  assert.deepEqual(deep.planLayout.innerFullPath, sq.planLayout.innerFullPath);
  assert.deepEqual(deep.postModels.filter((p) => p.kind === 'corner').map((p) => p.position), sq.postModels.filter((p) => p.kind === 'corner').map((p) => p.position));
});

test('an L’s landing 1080 deep: the exit flight at the outer side, the landing’s free dusza edge on the inner wanga, the corner post where the dusza turns', () => {
  const b = buildStaircase(cfg({ stairType: 'L', turn1Type: 'landing', treadsLegA: 6, treadsLegB: 5, landingDepthMm: 1080 }));
  const [L] = landingOf(b.planLayout);
  const Yc = 6 * 270;
  assert.ok(Math.abs(span(L.outerChain, 'y') - 1080) < 1e-6);
  const exitFirst = b.planLayout.treads[L.index + 1];
  const ys = exitFirst.frontEdge.map((p) => p.y).sort((x, y) => x - y);
  assert.ok(Math.abs(ys[0] - (Yc + 180)) < 25 && Math.abs(ys[1] - (Yc + 1080)) < 25, `exit flight between ${ys}`);
  assert.ok(b.stringerModels.inner.segments.some((s) => s.treadBearings.some((x) => x.treadIndex === L.index)), 'the inner wanga carries the landing');
  const corner = b.postModels.find((p) => p.kind === 'corner');
  assert.ok(corner && Math.abs(corner.position.y - (Yc + 180)) < 40, `corner post at ${JSON.stringify(corner?.position)}`);
});

test('a U with two half landings: both 1080 deep, flight C starts where A ends', () => {
  const b = buildPlanLayout(cfg({ stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: false, treadsLegA: 5, treadsLegB: 2, treadsLegC: 5, landingDepthMm: 1080 }));
  const ls = landingOf(b);
  assert.equal(ls.length, 2);
  for (const L of ls) assert.ok(Math.abs(Math.max(span(L.outerChain, 'y'), span(L.outerChain, 'x')) - 1080) < 1e-6 || Math.abs(span(L.outline, 'y') - 1080) < 25);
  const aEnd = b.treads[4].backEdge[0].y;
  const cStart = b.treads[ls[1].index + 1].frontEdge[0].y;
  assert.ok(Math.abs(aEnd - cStart) < 25, `${aEnd} vs ${cStart}`);
});
