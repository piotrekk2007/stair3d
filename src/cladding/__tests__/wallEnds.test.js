import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { wallCells, moveWallEnd, toggleWallCell, wallEnds, sideSAt } from '../wallEdits.js';

// a wall's end part-way along a step (user request 2026-11-05): "czasem jest tak że tylko pół stopnia jest przy
// ścianie, a reszta wystaje"
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const has = (o, x, y) => o.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
// 3 steps 270 deep, 1000 wide (x 0..1000), no riser boards; the right side walled up to 135 before the third step's back
const cfg = (patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [{ kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 }],
  riserBoards: false,
  nosingFrontMm: 30,
  sideNosingRight: true,
  sideNosingMm: 30,
  wallList: [{ id: 'r', flight: 0, side: 'right', type: 'full', from: 0, to: 2, toOffsetMm: -135 }],
  ...patch,
});

test('a wall ending part-way along a step: that tread flush at the wall, its side nosing on the free part — a jog there', () => {
  const b = buildCladdingStair(cfg());
  const t = b.cladding.treads[2];
  // the third tread: 540..810 along the flight; the wall to 675
  assert.ok(has(t.outline, 1000, 675) && has(t.outline, 1030, 675), 'the jog at the wall\'s end');
  assert.ok(has(t.outline, 1030, 810), 'the side nosing on the free part');
  assert.ok(!t.outline.some((p) => p.x > 1000 + 1e-6 && p.y < 675 - 1e-6), 'flush along the wall');
  assert.equal(t.sideType, 'P');
  assert.deepEqual(b.cladding.treads.slice(0, 2).map((x) => x.sideType), ['CZ', 'CZ']);
  // the full wall stops there
  near(Math.max(...b.walls.flatMap((w) => w.outline.map((p) => p.y))), 675, 'the wall to 675');
});

test('the side split at the wall\'s end: the balustrade on the free part, the skirting along the wall (no exit piece)', () => {
  const b = buildCladdingStair(cfg({ railingSides: { 0: { right: true } }, skirtingEnabled: true, skirtingStyle: 'stepped' }));
  const right = b.sideRuns.filter((r) => r.key.side === 'right');
  assert.deepEqual(right.map((r) => [r.walled, r.pieces[0].s0, r.pieces.at(-1).s1]), [[true, 0, 675], [false, 675, 810]]);
  assert.equal(right[0].pieces.at(-1).cutEnd, true);
  assert.equal(right[1].pieces[0].cutStart, true);
  const s = b.balustrade.sections[0];
  assert.deepEqual([s.s0, s.s1], [675, 810]);
  const k = b.finish.skirting[0];
  assert.equal(k.parts.at(-1).part, 'horizontal', 'ends square at the wall\'s end — not an exit piece');
  near(Math.max(...k.parts.at(-1).polygon.map((p) => p.s)), 675, 'at 675');
  // raked: one board to 675
  const raked = buildCladdingStair(cfg({ skirtingEnabled: true })).finish.skirting[0];
  near(Math.max(...raked.polygon.map((p) => p.s)), 675, 'raked to 675');
});

test('the wall\'s end dragged on the plan: snapped to the steps\' edges, else 10 mm; written as step + offset', () => {
  const b = buildCladdingStair(cfg({ wallList: [{ id: 'r', flight: 0, side: 'right', type: 'full', from: null, to: null }] }));
  const cells = wallCells(b.concrete);
  const w = b.config.wallList[0];
  // the end to 677 → 680 (10 mm): step 3 (index 2), 130 before its back
  assert.deepEqual(moveWallEnd(w, cells, 'end', 677, { snapMm: 5 }), { ...w, to: 2, toOffsetMm: -130 });
  // near a step's edge → onto it, no offset
  assert.deepEqual(moveWallEnd(w, cells, 'end', 543, { snapMm: 5 }), { ...w, to: 1 }, 'onto the second step back');
  // the start part-way along the first step
  assert.deepEqual(moveWallEnd(w, cells, 'start', 101, { snapMm: 5 }), { ...w, from: 0, fromOffsetMm: 100 });
  // never past the other end
  assert.equal(moveWallEnd(w, cells, 'start', 800, { snapMm: 5, other: 400 }).fromOffsetMm, 120, 'stays 10 short of the end (390 = step 2 + 120)');
  // the side's s of a plan point, and the ends' plan points
  near(sideSAt(cells, 0, 'right', { x: 1040, y: 333 }), 333, 'projected onto the side');
  const ends = wallEnds({ ...w, to: 2, toOffsetMm: -135 }, cells, buildCladdingStair(cfg()).wallEntries[0]);
  near(ends.end.p.y, 675, 'the end on the plan');
  near(ends.end.p.x, 1000, 'on the side line');
  // the plan draws both ends as handles in the wall mode
  assert.equal((renderCladdingPlanSVG(buildCladdingStair(cfg()), { mode: 'walls' }).match(/class="clad-wall-end"/g) || []).length, 2);
});

test('the offsets kept by the list: sanitized, kept on a toggle of another step, given up where that end goes', () => {
  const s = sanitizeCladdingConfig({ wallList: [{ flight: 0, side: 'right', type: 'full', from: 0, to: 2, fromOffsetMm: '40', toOffsetMm: 0 }] });
  assert.deepEqual(s.wallList[0], { id: 'w0', flight: 0, side: 'right', type: 'full', from: 0, to: 2, fromOffsetMm: 40 });
  const b = buildCladdingStair(cfg());
  const cells = wallCells(b.concrete);
  // the middle step out: the first part keeps no end offset, the second keeps the wall's −135
  const split = toggleWallCell(b.config.wallList, cells, { index: 1, flight: 0, side: 'right' });
  assert.deepEqual(split.map((w) => [w.from, w.to, w.toOffsetMm ?? 0]), [[0, 0, 0], [2, 2, -135]]);
});
