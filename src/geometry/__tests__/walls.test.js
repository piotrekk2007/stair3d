import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildStairwellWalls } from '../stairwellWallsRenderer.js';
import { applyFreeWallEdit } from '../walls.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

// a straight stair along +y, x 0..900, y 0..3510 (no stairwell: the free walls' frame = the plan bounds' min corner)
const base = (patch = {}) => ({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, ...patch });
// a wall along x = 1500, drawn upwards, its masonry on the right (+x) — its face toward the stair
const sideWall = { id: 'w1', points: [{ x: 1500, y: -500 }, { x: 1500, y: 4500 }], thicknessMm: 120, side: 'right' };
const ids = (b, ruleId) => b.wallsModel.diagnostics.filter((d) => d.ruleId === ruleId);

test('free walls (user decision 2026-10-28): a polyline in the opening frame, its masonry on the chosen side, mitred at a corner', () => {
  const b = buildStaircase(base({ freeWalls: [{ id: 'L', points: [{ x: 1500, y: 0 }, { x: 1500, y: 3000 }, { x: 3000, y: 3000 }], thicknessMm: 100, side: 'right' }] }));
  const [w] = b.wallsModel.freeWalls;
  assert.equal(w.segments.length, 2);
  const [s0, s1] = w.segments;
  assert.deepEqual(s0.outward, { x: 1, y: -0 });
  // the back line mitred: s0's back end = s1's back start (1600, 2900)
  assert.deepEqual(s0.quad[2], { x: 1600, y: 2900 });
  assert.deepEqual(s1.quad[3], { x: 1600, y: 2900 });
  assert.ok(b.wallsModel.segments.some((s) => s.id === 'free:L:1' && s.kind === 'free'));
  assert.deepEqual(b.wallsModel.diagnostics, []);
});

test('a free wall the stair runs into → ERROR WALL-COLLISION (in the takeoff gate); one beside the stair → nothing', () => {
  const into = buildStaircase(base({ freeWalls: [{ id: 'x', points: [{ x: 500, y: 1000 }, { x: 500, y: 2000 }], side: 'right' }] }));
  const hit = ids(into, 'WALL-COLLISION');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].severity, 'ERROR');
  assert.match(hit[0].message, /stopień/);
  assert.ok(runTakeoffValidationGate(into).errors.some((d) => d.ruleId === 'WALL-COLLISION'));
  const beside = buildStaircase(base({ freeWalls: [{ id: 'x', points: [{ x: -100, y: 0 }, { x: -100, y: 3000 }], side: 'left' }] }));
  assert.deepEqual(ids(beside, 'WALL-COLLISION'), []);
});

test('a door with the stair low in front of it → WARNING DOOR-STEP-IN-FRONT; the stair over the passage lower than the door → ERROR DOOR-HEADROOM; a window is only shown', () => {
  const door = (offsetMm, patch = {}) => buildStaircase(base({ freeWalls: [sideWall], wallOpenings: [{ id: 'd1', type: 'door', segmentId: 'free:w1:0', offsetMm, widthMm: 900, heightMm: 2050 }], ...patch }));
  // at the first treads (y −500 + 500 … 1400): the stair starts right in front of the door
  const low = door(500);
  assert.equal(ids(low, 'DOOR-STEP-IN-FRONT').length, 1);
  assert.deepEqual(ids(low, 'DOOR-HEADROOM'), []);
  // in the middle (y 1800 … 2700): treads ~1.2–1.8 m up — the passage under them is too low
  const mid = door(2300);
  const hr = ids(mid, 'DOOR-HEADROOM');
  assert.equal(hr.length, 1);
  assert.equal(hr[0].severity, 'ERROR');
  assert.ok(hr[0].value < 2050);
  // a shallow free strip does not reach the stair
  const shallow = door(2300, { doorClearDepthMm: 300 });
  assert.deepEqual(shallow.wallsModel.diagnostics, []);
  // a window in the same place: no check
  const win = buildStaircase(base({ freeWalls: [sideWall], wallOpenings: [{ id: 'o1', type: 'window', segmentId: 'free:w1:0', offsetMm: 2300 }] }));
  assert.deepEqual(win.wallsModel.diagnostics, []);
  assert.equal(win.wallsModel.openings[0].sillMm, 900);
});

test('a door / window whose wall is gone, or that does not fit in it → WARNING WALL-OPENING-INVALID', () => {
  const gone = buildStaircase(base({ wallOpenings: [{ id: 'd1', type: 'door', segmentId: 'free:nope:0' }] }));
  assert.equal(ids(gone, 'WALL-OPENING-INVALID').length, 1);
  const big = buildStaircase(base({ freeWalls: [sideWall], wallOpenings: [{ id: 'd1', type: 'window', segmentId: 'free:w1:0', offsetMm: 4500, widthMm: 1200 }] }));
  assert.equal(ids(big, 'WALL-OPENING-INVALID').length, 1);
});

test('3D: the free walls are drawn even with no stairwell, with a hole for every door / window', () => {
  const plain = buildStaircase(base({ freeWalls: [sideWall] }));
  assert.ok(plain.wallsMesh, 'the walls without a stairwell');
  const mesh = plain.wallsMesh.getObjectByName('FreeWall-free:w1:0');
  assert.ok(mesh);
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  assert.ok(Math.abs(bb.min.x - 1500) < 1e-6 && Math.abs(bb.max.x - 1620) < 1e-6, 'its masonry on the right of the face');
  const withDoor = buildStaircase(base({ freeWalls: [sideWall], wallOpenings: [{ id: 'd1', type: 'door', segmentId: 'free:w1:0', offsetMm: 2300 }] }));
  const holed = withDoor.wallsMesh.getObjectByName('FreeWall-free:w1:0');
  assert.ok(holed.geometry.attributes.position.count > mesh.geometry.attributes.position.count, 'the door cut through');
  assert.equal(buildStairwellWalls(null, null), null);
});

test('free wall edits (applyFreeWallEdit): add / move a corner / remove a corner (≥ 2 kept) / remove a wall with its doors / openings', () => {
  let r = applyFreeWallEdit([], [], { action: 'add', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], closed: false, thicknessMm: 200 });
  assert.equal(r.freeWalls.length, 1);
  const id = r.freeWalls[0].id;
  assert.equal(r.freeWalls[0].thicknessMm, 200);
  r = applyFreeWallEdit(r.freeWalls, r.wallOpenings, { action: 'move-vertex', id, index: 2, point: { x: 1000.04, y: 1500 } });
  assert.deepEqual(r.freeWalls[0].points[2], { x: 1000, y: 1500 });
  r = applyFreeWallEdit(r.freeWalls, r.wallOpenings, { action: 'add-opening', opening: { type: 'door', segmentId: `free:${id}:0`, offsetMm: 50 } });
  assert.equal(r.wallOpenings[0].widthMm, 900);
  r = applyFreeWallEdit(r.freeWalls, r.wallOpenings, { action: 'set-opening', id: r.wallOpenings[0].id, patch: { type: 'window' } });
  assert.equal(r.wallOpenings[0].widthMm, 1200, 'a type change takes that type’s default sizes');
  assert.equal(r.wallOpenings[0].sillMm, 900);
  r = applyFreeWallEdit(r.freeWalls, r.wallOpenings, { action: 'remove-vertex', id, index: 0 });
  r = applyFreeWallEdit(r.freeWalls, r.wallOpenings, { action: 'remove-vertex', id, index: 0 });
  assert.equal(r.freeWalls[0].points.length, 2, 'a wall keeps two points');
  r = applyFreeWallEdit(r.freeWalls, r.wallOpenings, { action: 'remove', id });
  assert.deepEqual(r, { freeWalls: [], wallOpenings: [] });
});

test('plan 2D: the free wall’s masonry, a door as a gap with its leaf and swing on the stair side, a window as a double line; the corner handles only in the wall mode', () => {
  const b = buildStaircase(base({ freeWalls: [sideWall], wallOpenings: [{ id: 'd1', type: 'door', segmentId: 'free:w1:0', offsetMm: 2300 }, { id: 'o1', type: 'window', segmentId: 'free:w1:0', offsetMm: 500 }] }));
  const svg = renderPlan2DSVG(b.planLayout, b.fullConfig, b.derived, { viewport: { x: -1000, y: -5000, width: 4000, height: 6000 }, wallsModel: b.wallsModel });
  assert.match(svg, /class="free-wall"/);
  assert.equal((svg.match(/class="wall-opening"/g) || []).length, 2);
  // the door's leaf runs from its hinge (1500, 2000) toward the stair (−x)
  assert.match(svg, /<line x1="1500" y1="-1800" x2="600" y2="-1800"/);
  assert.match(svg, /drzwi 900×2050/);
  assert.match(svg, /okno 1200×1300, parapet 900/);
  assert.doesNotMatch(svg, /free-wall-vertex/);
  const edit = renderPlan2DSVG(b.planLayout, b.fullConfig, b.derived, { viewport: { x: -1000, y: -5000, width: 4000, height: 6000 }, wallsModel: b.wallsModel, wallEdit: true });
  assert.equal((edit.match(/class="free-wall-vertex"/g) || []).length, 2);
});
