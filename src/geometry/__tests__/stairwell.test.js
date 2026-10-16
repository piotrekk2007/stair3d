import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { stairPlacement, stairwellReport, openingExitEdge, stairwellPlanDrawing } from '../stairwell.js';
import { resolveOpening, openingFrame } from '../ceilingOpening.js';
import { runTakeoffValidationGate } from '../../takeoff/index.js';

const cfg = (patch = {}) => ({ ...createDefaultConfig(), ...patch });
const layout = (c) => buildPlanLayout({ ...c, riserHeight: deriveStairData(c).riserHeight });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ids = (report) => report.diagnostics.map((d) => d.ruleId);
const room = (patch = {}) => ({ stairwellRoomEnabled: true, stairwellRoomWidthMm: 2000, stairwellRoomLengthMm: 4000, stairwellEntrySide: 'S', stairwellEntryOffsetMm: 0, stairwellWallGapMm: 0, ...patch });
const report = (c) => {
  const L = layout(c);
  const placement = stairPlacement(c, L);
  const opening = resolveOpening(c, openingFrame(c, L));
  return stairwellReport(c, L, placement, opening.relativeOutline);
};

test('no room: no placement, the opening stays relative to the stair plan (unchanged behaviour)', () => {
  const c = cfg({ stairType: 'L', openingOffsetX: 100, openingOffsetY: 200 });
  const L = layout(c);
  assert.equal(stairPlacement(c, L), null);
  const a = resolveOpening(c, L.bounds);
  const b = resolveOpening(c, openingFrame(c, L));
  assert.deepEqual(a.outline, b.outline);
  assert.equal(stairwellReport(c, L, null, b.relativeOutline).enabled, false);
});

test('placement: plan +Y is the entry walking direction, the outer line along the wall, round trip exact', () => {
  for (const [entry, walk] of [['S', { x: 0, y: 1 }], ['N', { x: 0, y: -1 }], ['W', { x: 1, y: 0 }], ['E', { x: -1, y: 0 }]]) {
    const c = cfg({ stairType: 'straight', treadsLegA: 10, ...room({ stairwellEntrySide: entry, stairwellRoomWidthMm: 4000, stairwellWallGapMm: 10, stairwellEntryOffsetMm: 50 }) });
    const L = layout(c);
    const p = stairPlacement(c, L);
    assert.ok(near(p.walk.x, walk.x) && near(p.walk.y, walk.y), entry);
    const a = p.toRoom({ x: 0, y: 0 });
    const b = p.toRoom({ x: 0, y: 100 });
    assert.ok(near(b.x - a.x, 100 * walk.x) && near(b.y - a.y, 100 * walk.y), `${entry}: +Y = walking`);
    const q = p.toPlan(p.toRoom({ x: 123.4, y: 567.8 }));
    assert.ok(near(q.x, 123.4) && near(q.y, 567.8));
    // the outer line (plan x = 0) is 10 mm off the wall on the walker's left, the first front edge 50 mm inside
    const left = { x: -walk.y, y: walk.x };
    const wallDistance = { S: a.x, N: 4000 - a.x, W: 4000 - a.y, E: a.y }[entry];
    assert.ok(near(wallDistance, 10), `${entry}: ${wallDistance}`);
    const entryDistance = { S: a.y, N: 4000 - a.y, W: a.x, E: 4000 - a.x }[entry];
    assert.ok(near(entryDistance, 50), `${entry}: entry ${entryDistance}`);
    assert.ok(left);
  }
});

test('a straight stair along the RIGHT wall has its inner wanga at that wall', () => {
  const c = cfg({ stairType: 'straight', treadsLegA: 10, stairWidth: 900, ...room({ stairwellStraightWall: 'right' }) });
  const p = stairPlacement(c, layout(c));
  assert.ok(near(p.toRoom({ x: 900, y: 0 }).x, 2000));
  assert.ok(near(p.toRoom({ x: 0, y: 0 }).x, 1100));
});

test('a left-turning L has its outer wanga along the right wall', () => {
  const c = cfg({ stairType: 'L', turnDirection: 'left', ...room({ stairwellRoomWidthMm: 3000 }) });
  const p = stairPlacement(c, layout(c));
  assert.equal(p.outerOnLeft, false);
  assert.ok(near(p.toRoom({ x: 0, y: 0 }).x, 3000));
  assert.equal(ids(report(c)).includes('STAIRWELL-OUTSIDE'), false);
});

test('outside the room: reported with the amount', () => {
  const c = cfg({ stairType: 'straight', treadsLegA: 10, ...room({ stairwellRoomLengthMm: 2000 }) });
  const L = layout(c);
  const r = report(c);
  const d = r.diagnostics.find((x) => x.ruleId === 'STAIRWELL-OUTSIDE');
  assert.ok(d);
  assert.equal(d.value, Math.round(L.bounds.maxY - 2000));
  assert.match(d.message, /N/);
});

test('exit: the edge facing a side; the required stair type from entry and exit', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(openingExitEdge(sq, 'N').index, 2);
  assert.equal(openingExitEdge(sq, 'E').index, 1);
  // an L-shaped opening: of the two edges facing N, the farther one
  const ell = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
  assert.equal(openingExitEdge(ell, 'N').index, 4);

  const base = { ...room({ stairwellRoomWidthMm: 3000, stairwellRoomLengthMm: 3000 }), openingOffsetX: 0, openingOffsetY: 500, openingWidth: 2900, openingLength: 2000 };
  const L = cfg({ stairType: 'L', ...base, stairwellExitSide: 'E' });
  assert.equal(report(L).required.stairType, 'L');
  assert.equal(report(L).required.turnDirection, 'right');
  const wrong = cfg({ stairType: 'L', turnDirection: 'left', ...base, stairwellExitSide: 'E' });
  const d = report(wrong).diagnostics.find((x) => x.ruleId === 'STAIRWELL-EXIT-DIRECTION');
  assert.ok(d);
  assert.match(d.message, /skręt w prawo/);
  assert.equal(report(cfg({ stairType: 'L', ...base, stairwellExitSide: 'N' })).required.stairType, 'straight');
  assert.equal(report(cfg({ stairType: 'L', ...base, stairwellExitSide: 'W' })).required.turnDirection, 'left');
  const u = report(cfg({ stairType: 'L', ...base, stairwellExitSide: 'S', openingOffsetX: 1600, openingWidth: 1300 })).required;
  assert.equal(u.stairType, 'U');
  assert.equal(u.turnDirection, 'right');
});

test('exit offset: the last back edge on the exit line, or how far it is off (signed)', () => {
  const c0 = cfg({ stairType: 'L', ...room({ stairwellRoomWidthMm: 3500, stairwellRoomLengthMm: 3000 }), stairwellExitSide: 'E' });
  const L = layout(c0);
  const last = L.treads[L.treads.length - 1].backEdge;
  const exitX = last[0].x; // entry S, no gap: plan x = room x
  const at = (dx) => cfg({ ...c0, openingOffsetX: 500, openingWidth: exitX - 500 + dx, openingOffsetY: 1000, openingLength: 1600 });
  const ok = report(at(0));
  assert.ok(near(ok.exitOffsetMm, 0, 1e-6));
  assert.deepEqual(ids(ok), []);
  const short = report(at(40));
  assert.ok(near(short.exitOffsetMm, -40, 1e-6));
  assert.match(short.diagnostics.find((x) => x.ruleId === 'STAIRWELL-EXIT-OFFSET').message, /za krótkie/);
  const long = report(at(-40));
  assert.match(long.diagnostics.find((x) => x.ruleId === 'STAIRWELL-EXIT-OFFSET').message, /za długie/);
  // an exit edge shorter than the back edge
  const narrow = report(cfg({ ...c0, openingOffsetX: 500, openingWidth: exitX - 500, openingOffsetY: 1800, openingLength: 300 }));
  assert.ok(ids(narrow).includes('STAIRWELL-EXIT-EDGE'));
});

test('with a room the opening stays put in the ROOM when the stair changes; the plan outline is the room one placed', () => {
  const c = cfg({ stairType: 'L', ...room({ stairwellEntrySide: 'W', stairwellRoomWidthMm: 3000, stairwellRoomLengthMm: 3000 }), openingOffsetX: 300, openingOffsetY: 400, openingWidth: 1000, openingLength: 1200 });
  const roomRect = [{ x: 300, y: 400 }, { x: 1300, y: 400 }, { x: 1300, y: 1600 }, { x: 300, y: 1600 }];
  for (const treadGoing of [240, 280]) {
    const cc = { ...c, treadGoing };
    const L = layout(cc);
    const f = openingFrame(cc, L);
    const o = resolveOpening(cc, f);
    assert.deepEqual(o.relativeOutline, roomRect);
    o.outline.forEach((p, i) => {
      const q = f.toRelative(p);
      assert.ok(near(q.x, roomRect[i].x, 1e-9) && near(q.y, roomRect[i].y, 1e-9));
    });
  }
});

test('buildStaircase carries the stairwell; its findings reach the validation gate; the plan drawing is in the plan frame', () => {
  const c = cfg({ stairType: 'straight', treadsLegA: 10, ...room({ stairwellRoomLengthMm: 2000 }), stairwellExitSide: 'N' });
  const built = buildStaircase(c);
  assert.equal(built.stairwell.enabled, true);
  const gate = runTakeoffValidationGate(built);
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'STAIRWELL-OUTSIDE'));
  const drawing = stairwellPlanDrawing(built.stairwell, c);
  assert.equal(drawing.room.length, 4);
  assert.deepEqual(drawing.room[0], { x: 0, y: 0 });
  assert.equal(drawing.entrySide, 'S');
});

test('3D walls: every side but the open entry, corners closed, up to the slab; the slab covers the room and its walls', async () => {
  const { stairwellWalls, STAIRWELL_WALL_DRAWN_THICKNESS_MM: T } = await import('../stairwell.js');
  const { buildStairwellWalls } = await import('../stairwellWallsRenderer.js');
  const c = cfg({ stairType: 'L', ...room({ stairwellRoomWidthMm: 3000, stairwellRoomLengthMm: 2500 }), totalRise: 2800, ceilingThickness: 250 });
  const built = buildStaircase(c);
  const walls = stairwellWalls(built.stairwell, built.fullConfig);
  assert.deepEqual(walls.pieces.map((p) => p.side).sort(), ['E', 'N', 'W']);
  const n = walls.pieces.find((p) => p.side === 'N');
  assert.ok(near(Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y), 3000 + 2 * T), 'N closes both corners');
  const w = walls.pieces.find((p) => p.side === 'W');
  assert.ok(near(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 2500 + T), 'W stops at the open entry side');
  assert.equal(n.height, 2550);
  assert.equal(walls.slab.length, 4);
  const mesh = buildStairwellWalls(walls);
  assert.equal(mesh.children.length, 3);
  assert.ok(built.wallsMesh && built.wallsMesh.name === 'StairwellWalls');
  assert.equal(buildStaircase(cfg({ stairType: 'L' })).wallsMesh, null);
});
