import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { wellFrame, stairwellReport, stairwellWalls, stairwellPlanDrawing, wellSideLetters, exitSideLetter, STAIRWELL_WALL_DRAWN_THICKNESS_MM as T } from '../stairwell.js';
import { resolveOpening, openingFrame } from '../ceilingOpening.js';
import { buildStairwellWalls } from '../stairwellWallsRenderer.js';
import { runTakeoffValidationGate } from '../../takeoff/index.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';

const cfg = (patch = {}) => ({ ...createDefaultConfig(), ...patch });
const layout = (c) => buildPlanLayout({ ...c, riserHeight: deriveStairData(c).riserHeight });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const well = (patch = {}) => ({ stairwellRoomEnabled: true, ...patch });

test('sides per type and the side the stair ends on', () => {
  assert.deepEqual(wellSideLetters('straight'), ['A']);
  assert.deepEqual(wellSideLetters('L'), ['A', 'B']);
  assert.deepEqual(wellSideLetters('U'), ['A', 'B', 'C']);
  assert.equal(exitSideLetter('straight'), 'A');
  assert.equal(exitSideLetter('L'), 'B');
  assert.equal(exitSideLetter('U'), 'C');
});

test('no stairwell: no frame, no report; the opening stays relative to the stair plan', () => {
  const c = cfg({ stairType: 'L', openingOffsetX: 100, openingOffsetY: 200 });
  const L = layout(c);
  assert.equal(wellFrame(c, L), null);
  assert.equal(stairwellReport(c, L).enabled, false);
  assert.deepEqual(resolveOpening(c, openingFrame(c, L)).outline, resolveOpening(c, L.bounds).outline);
});

test('wall frame: x from wall A, y from the end wall back toward the entry, for both turn directions', () => {
  for (const turnDirection of ['right', 'left']) {
    const c = cfg({ stairType: 'U', turnDirection, ...well() });
    const L = layout(c);
    const f = wellFrame(c, L);
    const A = f.sides.A;
    // the first front edge's outer end: on wall A (x 0), side A away from the end wall
    const start = f.toRelative(L.outerFullPath[0]);
    assert.ok(near(start.x, 0) && near(start.y, A.length), `${turnDirection}: ${JSON.stringify(start)}`);
    // the inner line lies at positive x (inside the stair)
    assert.ok(f.toRelative(L.innerFullPath[0]).x > 0, turnDirection);
    const q = f.toPlan(f.toRelative({ x: 123, y: 456 }));
    assert.ok(near(q.x, 123) && near(q.y, 456));
  }
});

test('report: a fixed side off its dimension is a WARNING with the amount; a free side never is', () => {
  const c = cfg({ stairType: 'L', ...well({ stairwellSideAMm: 3000, stairwellSideAFixed: true, stairwellSideBMm: 1, stairwellSideBFixed: false }) });
  const L = layout(c);
  const r = stairwellReport(c, L);
  const A = r.sides.find((s) => s.side === 'A');
  assert.equal(A.fixed, true);
  const d = r.diagnostics.find((x) => x.ruleId === 'STAIRWELL-SIDE-FIXED');
  assert.ok(d);
  assert.equal(d.value, Math.round(A.achieved));
  assert.equal(r.sides.find((s) => s.side === 'B').fixed, false);
  assert.equal(r.diagnostics.length, 1);
  // the gate carries it
  assert.ok(runTakeoffValidationGate(buildStaircase(c)).diagnostics.some((x) => x.ruleId === 'STAIRWELL-SIDE-FIXED'));
});

test('the opening given from the walls stays put when a free side changes (the entry floats)', () => {
  const base = cfg({ stairType: 'U', turnDirection: 'right', ...well(), openingOffsetX: 200, openingOffsetY: 100, openingWidth: 1000, openingLength: 1200 });
  const relative = [];
  for (const treadsLegA of [3, 6]) {
    const c = { ...base, treadsLegA };
    const L = layout(c);
    const f = openingFrame(c, L);
    const o = resolveOpening(c, f);
    relative.push(o.outline.map(f.toRelative).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).sort().join(' '));
    // the opening in the plan is the rectangle 200..1200 from wall A, 100..1300 from the end wall
    for (const p of o.outline.map(f.toRelative)) assert.ok([200, 1200].includes(Math.round(p.x)) && [100, 1300].includes(Math.round(p.y)), JSON.stringify(p));
  }
  assert.equal(relative[0], relative[1]);
});

test('walls: one per side along a wall, corners closed, a side without a wall left out; 3D walls and slab follow', () => {
  const c = cfg({ stairType: 'U', ...well({ stairwellWallC: false }), totalRise: 2800, ceilingThickness: 250 });
  const built = buildStaircase(c);
  const walls = stairwellWalls(built.stairwell, built.fullConfig, built.planLayout);
  assert.deepEqual(walls.pieces.map((p) => p.side), ['A', 'B']);
  const B = walls.pieces.find((p) => p.side === 'B');
  const sideB = built.stairwell.frame.sides.B;
  assert.ok(near(Math.hypot(B.b.x - B.a.x, B.b.y - B.a.y), sideB.length + T), 'B closes the corner with A, not with C');
  assert.equal(B.height, 2550);
  assert.equal(walls.slab.length, 4);
  assert.equal(buildStairwellWalls(walls).children.length, 2);
  assert.ok(built.wallsMesh);
  assert.equal(buildStaircase(cfg({ stairType: 'U' })).wallsMesh, null);
});

test('plan: walls and every side dimension, a fixed one marked met / off', () => {
  const c = cfg({ stairType: 'L', ...well({ stairwellSideBMm: 99999, stairwellSideBFixed: true }) });
  const built = buildStaircase(c);
  const d = stairwellPlanDrawing(built.stairwell, c, built.planLayout);
  assert.equal(d.walls.length, 2);
  assert.deepEqual(d.dims.map((x) => [x.side, x.fixed, x.ok]), [['A', false, true], ['B', true, false]]);
  const svg = renderPlan2DSVG(built.planLayout, c, built.derived, { viewport: { x: -500, y: -3000, width: 4000, height: 4000 }, stairwell: d });
  assert.match(svg, /id="stairwell-layer"/);
  assert.match(svg, /B: \d+ \(sztywny 99999\)/);
  assert.match(svg, /A: \d+ \(swobodny\)/);
});
