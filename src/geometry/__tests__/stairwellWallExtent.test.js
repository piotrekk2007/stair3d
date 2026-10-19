import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { wallInterval, treadsOpenOnOuterSide, openOuterRailingRanges, stairwellPlanDrawing } from '../stairwell.js';

// an L in a stairwell, walls along both sides
const L = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'L', stairwellRoomEnabled: true, ...patch });
const lenOf = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
const sideA = (b) => b.stairwell.frame.sides.A;
const along = (b, p) => {
  const A = sideA(b);
  return (p.x - A.a.x) * A.dir.x + (p.y - A.a.y) * A.dir.y;
};

test('wall interval: the whole side, a length from its start (at most the side), a length back from its end (may go past its start)', () => {
  assert.deepEqual(wallInterval({}, 'A', 3000), [0, 3000]);
  assert.deepEqual(wallInterval({ stairwellWallAExtent: 'start', stairwellWallALengthMm: 1200 }, 'A', 3000), [0, 1200]);
  assert.deepEqual(wallInterval({ stairwellWallAExtent: 'start', stairwellWallALengthMm: 5000 }, 'A', 3000), [0, 3000]);
  assert.deepEqual(wallInterval({ stairwellWallAExtent: 'end', stairwellWallALengthMm: 1300 }, 'A', 3000), [1700, 3000]);
  assert.deepEqual(wallInterval({ stairwellWallAExtent: 'end', stairwellWallALengthMm: 3500 }, 'A', 3000), [-500, 3000]);
});

test("regression (user, 2026-10-19): wall A only 1200 mm from the stair's start — the 3D / plan wall stops there, no corner with wall B", () => {
  const full = L();
  const b = L({ stairwellWallAExtent: 'start', stairwellWallALengthMm: 1200 });
  const wFull = full.stairwellWalls.pieces.find((w) => w.side === 'A');
  const w = b.stairwellWalls.pieces.find((x) => x.side === 'A');
  assert.ok(lenOf(wFull) > 2000, 'the default wall runs the whole side');
  assert.ok(Math.abs(lenOf(w) - 1200) < 1e-6, `wall A is ${lenOf(w).toFixed(0)} mm`);
  assert.ok(Math.abs(along(b, w.a)) < 1e-6 && Math.abs(along(b, w.b) - 1200) < 1e-6, 'from the first front edge on');
  assert.equal(w.partial, true);
  // wall B no longer closes a corner with it
  const plan = stairwellPlanDrawing(b.stairwell, b.fullConfig, b.planLayout);
  assert.equal(plan.walls.find((x) => x.side === 'B').prevWall, false);
  assert.equal(plan.walls.find((x) => x.side === 'A').partial, true);
});

test('wall A 1300 mm back from the corner (side B): its start is 1300 mm before the corner, the corner with wall B closes', () => {
  const b = L({ stairwellWallAExtent: 'end', stairwellWallALengthMm: 1300 });
  const A = sideA(b);
  const plan = stairwellPlanDrawing(b.stairwell, b.fullConfig, b.planLayout);
  const w = plan.walls.find((x) => x.side === 'A');
  assert.ok(Math.abs(along(b, w.a) - (A.length - 1300)) < 1e-6);
  assert.equal(w.nextWall, true);
  assert.equal(plan.walls.find((x) => x.side === 'B').prevWall, true);
});

test('treads with no wall beside them → the outer balustrade sections', () => {
  const full = L();
  assert.ok(treadsOpenOnOuterSide(full.planLayout, full.stairwellWalls.pieces, full.fullConfig).every((open) => !open), 'walls everywhere: no open tread');
  const b = L({ stairwellWallAExtent: 'end', stairwellWallALengthMm: 1300 });
  const flags = treadsOpenOnOuterSide(b.planLayout, b.stairwellWalls.pieces, b.fullConfig);
  const ranges = openOuterRailingRanges(flags);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].fromStep, 0, 'the first treads (before the wall starts) are open');
  // every open tread lies before the wall's start along side A
  const wallStart = sideA(b).length - 1300;
  for (let i = ranges[0].fromStep; i <= ranges[0].toStep; i++) {
    const t = b.planLayout.treads[i];
    const mid = (along(b, t.outerChain[0]) + along(b, t.outerChain.at(-1))) / 2;
    assert.ok(mid < wallStart + 1, `tread ${i + 1} is open but along the wall`);
  }
  assert.ok(ranges[0].toStep < b.planLayout.treads.length - 1);
  assert.equal(treadsOpenOnOuterSide(b.planLayout, null, b.fullConfig), null);
  assert.deepEqual(openOuterRailingRanges([true, true, false, true]), [{ fromStep: 0, toStep: 1 }, { fromStep: 3, toStep: 3 }]);
});

test('the opening balustrade leaves out only the part of an edge a wall runs along', () => {
  // an opening over the whole stair: its edge along side A is the wall's edge
  const open = { openingOffsetX: 0, openingOffsetY: 0, openingWidth: 2886, openingLength: 2336, railingOpeningEnabled: true };
  const full = L(open);
  const part = L({ ...open, stairwellWallAExtent: 'end', stairwellWallALengthMm: 1300 });
  // the edge along side A (parallel to it)
  const edgeA = (b) => {
    const d = sideA(b).dir;
    return b.railingModel.openingEdges.find((e) => (e.wall || e.wallPartial) && Math.abs(((e.b.x - e.a.x) * d.y - (e.b.y - e.a.y) * d.x) / e.length) < 0.01);
  };
  assert.ok(edgeA(full)?.wall && !edgeA(full).enabled, 'with the whole wall A the edge along it has no balustrade');
  const e = edgeA(part);
  assert.ok(e && !e.wall && e.wallPartial && e.enabled, 'with part of wall A the edge is partly open — balustrade on');
  // the balustrade on that edge stops where the wall starts
  const sections = part.railingModel.sections.filter((s) => s.kind === 'opening');
  const ex = (e.b.x - e.a.x) / e.length;
  const ey = (e.b.y - e.a.y) / e.length;
  const wallCut = e.cuts.find((c) => c.kind === 'wall');
  for (const s of sections)
    for (const piece of s.handrail.pieces)
      for (const p of [piece.start, piece.end]) {
        const off = Math.abs((p.x - e.a.x) * ey - (p.y - e.a.y) * ex);
        const t = ((p.x - e.a.x) * ex + (p.y - e.a.y) * ey) / e.length;
        if (off < 200) assert.ok(t <= wallCut.t0 + 0.02 || t >= wallCut.t1 - 0.02, `a handrail point along the wall (t ${t.toFixed(2)})`);
      }
});
