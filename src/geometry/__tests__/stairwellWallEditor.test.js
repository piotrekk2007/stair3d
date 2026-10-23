import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { stairwellWalls, stairwellReport, stairwellPlanDrawing, lineSides, stairwellWallList, wallSpan, spanToFromTo, treadsOpenOnOuterSide } from '../stairwell.js';
import { applyWallEdit } from '../stairwellWallEdits.js';
import { wallEditXML } from '../../plan2d/plan2dRenderer.js';

const layout = (c) => buildPlanLayout({ ...c, riserHeight: deriveStairData(c).riserHeight });
const walls = (c) => {
  const L = layout(c);
  return { L, pieces: stairwellWalls(stairwellReport(c, L), c, L)?.pieces || [] };
};
const dirOf = (w) => {
  const l = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  return { x: (w.b.x - w.a.x) / l, y: (w.b.y - w.a.y) / l };
};

test("regression (user, 2026-10-23): an S starting with winders (A = 0) with its walls on the LEFT — every side keeps its letter (found by direction): wall C runs along flight C, none is lost", () => {
  const c = { ...createDefaultConfig(), stairType: 'S', turnDirection: 'left', stairwellRoomEnabled: true, stairwellWallHand: 'left', treadsLegA: 0, treadsLegB: 1, treadsLegC: 7, windersPerTurn: 3, stairWidth: 760, treadGoing: 159.2, totalRise: 3000 };
  const { L, pieces } = walls(c);
  const sides = lineSides(L, 'inner', 'S');
  assert.equal(sides.A.length, 0, 'no inner piece along flight A');
  assert.ok(sides.C.length > 500, 'side C is the long piece along flight C');
  const wallC = pieces.find((w) => w.side === 'C');
  assert.ok(wallC, 'a wall along side C');
  const flightC = lineSides(L, 'outer', 'S').C.dir;
  const d = dirOf(wallC);
  assert.ok(Math.abs(d.x * flightC.x + d.y * flightC.y) > 0.999, 'wall C parallel to flight C');
  const wallB = pieces.find((w) => w.side === 'B');
  assert.ok(wallB && Math.abs(dirOf(wallB).x * flightC.x + dirOf(wallB).y * flightC.y) < 0.01, 'wall B across flight C');
});

test('the wall list: walls on BOTH sides of flight C (user request 2026-10-23) — two pieces, one per line, outward away from the stair; the treads of C are closed on both sides', () => {
  const c = { ...createDefaultConfig(), stairType: 'U', turnDirection: 'left', stairwellRoomEnabled: true, treadsLegA: 4, treadsLegB: 2, treadsLegC: 4, windersPerTurn: 3, stairwellWallList: [{ id: 'w1', side: 'C', line: 'outer', from: 0, to: null }, { id: 'w2', side: 'C', line: 'inner', from: 0, to: null }] };
  const { L, pieces } = walls(c);
  assert.deepEqual(pieces.map((w) => w.line).sort(), ['inner', 'outer']);
  const inner = pieces.find((w) => w.line === 'inner');
  const outer = pieces.find((w) => w.line === 'outer');
  // the two walls face each other across flight C, the stair between them
  const mid = (w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
  const toOther = { x: mid(outer).x - mid(inner).x, y: mid(outer).y - mid(inner).y };
  assert.ok(toOther.x * inner.outward.x + toOther.y * inner.outward.y < 0, 'the inner wall faces away from the outer one');
  assert.ok(toOther.x * outer.outward.x + toOther.y * outer.outward.y > 0);
  const n = L.treads.length;
  const openOuter = treadsOpenOnOuterSide(L, pieces, c, 'outer');
  const openInner = treadsOpenOnOuterSide(L, pieces, c, 'inner');
  assert.equal(openOuter[n - 1], false);
  assert.equal(openInner[n - 1], false, 'the last tread has a wall on its inner side too');
  assert.equal(openInner[0], true, 'flight A is open on its inner side');
});

test("a wall's [from, to] is measured from the side's FIXED corner: side A back from its end, so a free side A that grows keeps the wall at the corner", () => {
  const base = { ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', stairwellRoomEnabled: true, treadsLegB: 4, windersPerTurn: 3, stairwellWallList: [{ id: 'w', side: 'A', line: 'outer', from: 0, to: 1000 }] };
  for (const treadsLegA of [3, 6]) {
    const c = { ...base, treadsLegA };
    const L = layout(c);
    const A = lineSides(L, 'outer', 'L').A;
    const w = stairwellPlanDrawing(stairwellReport(c, L), c, L).walls[0];
    assert.ok(Math.abs(w.lengthMm - 1000) < 0.5, `${treadsLegA}: 1000 mm long`);
    assert.ok(Math.abs(w.t1 - A.length) < 0.5, `${treadsLegA}: ends at the corner`);
  }
  // round trip of the span ↔ from / to for A (from its end) and C (from its start); the far end → null
  assert.deepEqual(spanToFromTo('A', 2000, 0, 1500), { from: 500, to: null });
  assert.deepEqual(wallSpan({ from: 500, to: null }, 'A', 2000), [0, 1500]);
  assert.deepEqual(spanToFromTo('C', 2000, 300, 2000), { from: 300, to: null });
  assert.deepEqual(wallSpan({ from: 300, to: 900 }, 'C', 2000), [300, 900]);
});

test('older projects (no wall list): the per-side walls become the list — the same walls as before (incl. a partial one)', () => {
  const c = { ...createDefaultConfig(), stairType: 'L', turnDirection: 'right', stairwellRoomEnabled: true, treadsLegA: 4, treadsLegB: 4, windersPerTurn: 3, stairwellWallB: false, stairwellWallAExtent: 'start', stairwellWallALengthMm: 800 };
  const L = layout(c);
  const list = stairwellWallList(c, L);
  assert.equal(list.length, 1);
  const A = lineSides(L, 'outer', 'L').A;
  assert.deepEqual(wallSpan(list[0], 'A', A.length).map(Math.round), [0, 800], 'from the first front edge, 800 long');
  // the first edit writes the list (here: the same wall made longer) — nothing else changes
  const next = applyWallEdit(list, { action: 'set-span', id: list[0].id, t0: 0, t1: 1200, sideLength: A.length });
  assert.equal(next.length, 1);
  assert.deepEqual(wallSpan(next[0], 'A', A.length).map(Math.round), [0, 1200]);
});

test('wall edits: add a whole side, drag an end (min length kept), remove, set fields', () => {
  let list = applyWallEdit([], { action: 'add', side: 'C', line: 'inner' });
  assert.deepEqual(list, [{ id: 'wall-1', side: 'C', line: 'inner', from: 0, to: null }]);
  list = applyWallEdit(list, { action: 'add', side: 'B', line: 'outer' });
  assert.equal(list[1].id, 'wall-2');
  list = applyWallEdit(list, { action: 'set-span', id: 'wall-1', end: 'b', t0: 0, t1: 20, sideLength: 1500 });
  assert.equal(list[0].to, 50, 'never shorter than 50 mm');
  list = applyWallEdit(list, { action: 'set', id: 'wall-1', to: null, from: 200 });
  assert.deepEqual(list[0], { id: 'wall-1', side: 'C', line: 'inner', from: 200, to: null });
  list = applyWallEdit(list, { action: 'remove', id: 'wall-2' });
  assert.deepEqual(list.map((w) => w.id), ['wall-1']);
});

test('the plan in the wall mode: a dashed place on every side of both lines, two handles per wall, the wall labelled', () => {
  const c = { ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', stairwellRoomEnabled: true, treadsLegA: 4, treadsLegB: 4, windersPerTurn: 3 };
  const b = buildStaircase(c);
  const drawing = stairwellPlanDrawing(b.stairwell, b.fullConfig, b.planLayout);
  const xml = wallEditXML(drawing, b.fullConfig);
  assert.equal((xml.match(/class="wall-candidate"/g) || []).length, 4, 'A and B on the outer and the inner line');
  assert.equal((xml.match(/class="wall-handle"/g) || []).length, 2 * drawing.walls.length);
  assert.ok(/ściana A zewn\.: \d+/.test(xml));
  // what a dragged end is measured along (main.js wallDrag): the side's direction, its length, the span
  for (const w of drawing.walls) assert.ok(w.dir && Number.isFinite(w.sideLength) && Number.isFinite(w.t0) && Number.isFinite(w.t1), w.id);
});
