import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { signedPolygonArea } from '../pathUtils.js';
import { treadGoingAtOffsetFromInner, WINDER_WIDTH_MEASURE_OFFSET_MM } from '../walklineModel.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { stairwellWalls, stairwellReport } from '../stairwell.js';

// the user's case (2026-10-23): first turn LEFT, then right — the walls along the outer line go up, left, up
const S = (patch = {}) => ({ ...createDefaultConfig(), stairType: 'S', turnDirection: 'left', turn1Type: 'winder', turn2Type: 'winder', treadsLegA: 4, treadsLegB: 2, treadsLegC: 3, windersPerTurn: 3, totalRise: 2900, ...patch });
const layout = (c) => buildPlanLayout({ ...c, riserHeight: deriveStairData(c).riserHeight });
const dirs = (path) => {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    if (Math.hypot(dx, dy) < 1) continue;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'up' : 'down';
    if (out[out.length - 1] !== d) out.push(d);
  }
  return out;
};

test('S plan: the second turn goes the other way — the outer line up, left, up; one inner and one outer line, continuous; the counts', () => {
  for (const [t1, t2] of [['winder', 'winder'], ['landing', 'landing'], ['winder', 'landing'], ['landing', 'winder']]) {
    const c = S({ turn1Type: t1, turn2Type: t2 });
    const L = layout(c);
    assert.equal(L.treads.length, deriveStairData(c).numTreads, `${t1}/${t2}: tread count`);
    assert.deepEqual(dirs(L.outerFullPath), ['up', 'left', 'up'], `${t1}/${t2}: outer line`);
    assert.deepEqual(dirs(L.innerFullPath), ['up', 'left', 'up'], `${t1}/${t2}: inner line`);
    for (let i = 1; i < L.treads.length; i++) {
      for (const k of ['innerChain', 'outerChain']) {
        const a = L.treads[i - 1][k].at(-1);
        const b = L.treads[i][k][0];
        if (a && b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.5, `${t1}/${t2}: ${k} breaks before tread ${i + 1}`);
      }
      const fe = L.treads[i].frontEdge;
      const be = L.treads[i - 1].backEdge;
      assert.ok(Math.hypot(fe[0].x - be[0].x, fe[0].y - be[0].y) < 0.5 && Math.hypot(fe[1].x - be[1].x, fe[1].y - be[1].y) < 0.5, `${t1}/${t2}: edge ${i}`);
    }
    // every tread winds the same way (the second turn was mirrored in its own frame)
    const signs = new Set(L.treads.map((t) => Math.sign(signedPolygonArea(t.outline))));
    assert.equal(signs.size, 1, `${t1}/${t2}: winding`);
    // the first turn's dusza on the inner line, the second's on the outer line
    assert.deepEqual(L.turns.map((t) => t.duszaSide || 'inner'), ['inner', 'outer']);
  }
  // mirrored: first turn right → the outer line up, right, up
  assert.deepEqual(dirs(layout(S({ turnDirection: 'right' })).outerFullPath), ['up', 'right', 'up']);
});

test("S posts: the first turn's corner post on the inner wanga, the second's on the OUTER wanga's axis; no post where that dusza stands at a stairwell wall (the wangi lap)", () => {
  const b = buildStaircase(S());
  const corners = b.postModels.filter((p) => p.kind === 'corner');
  assert.equal(corners.length, 2);
  const second = corners.find((p) => p.line === 'outer');
  assert.ok(second, 'a post on the outer line');
  const corner = b.planLayout.turns[1].innerCorner;
  const half = b.fullConfig.stringerThickness / 2;
  assert.ok(Math.abs(Math.hypot(second.position.x - corner.x, second.position.y - corner.y) - half * Math.SQRT2) < 1, 'on the mitre of the outer wangi axes');
  const outerJoints = b.stringerModels.outer.segmentJoints.map((j) => j.type);
  assert.ok(outerJoints.includes('corner-post'), 'the outer wangi meet the post');
  assert.ok(b.stringerModels.outer.segments.some((s) => s.endPost?.postId === second.postId) && b.stringerModels.outer.segments.some((s) => s.startPost?.postId === second.postId));
  // the stairwell's walls along the outer line: no post at that dusza, the outer boards lap there
  const walled = buildStaircase(S({ stairwellRoomEnabled: true }));
  assert.ok(!walled.postModels.some((p) => p.line === 'outer'), 'no post against the wall');
  assert.deepEqual(walled.stringerModels.outer.segmentJoints.map((j) => j.type), ['lap-joint', 'lap-joint']);
  assert.ok(walled.postModels.some((p) => p.postId === 'post-corner-0'), 'the open dusza keeps its post');
});

test('S walkline: continuous through flight B (from one dusza to the other); the second turn\'s winders measured from THEIR dusza', () => {
  const b = buildStaircase(S());
  const gate = runTakeoffValidationGate(b);
  assert.ok(!gate.diagnostics.some((d) => d.ruleId === 'VALIDATOR-WALKLINE-CONTINUITY'));
  const winders = b.planLayout.treads.filter((t) => t.type === 'winder');
  const first = winders.filter((t) => t.duszaSide !== 'outer');
  const second = winders.filter((t) => t.duszaSide === 'outer');
  assert.equal(first.length, 3);
  assert.equal(second.length, 3);
  // the same turn mirrored: the same goings 400 mm from the dusza (in reverse order through the turn)
  const g = (list) => list.map((t) => Math.round(treadGoingAtOffsetFromInner(t, WINDER_WIDTH_MEASURE_OFFSET_MM, b.planLayout)));
  assert.deepEqual(g(second), g(first));
});

test('S: no finding the same U does not have (the shape itself adds none)', () => {
  const keys = (c) => new Set(runTakeoffValidationGate(buildStaircase(c)).diagnostics.filter((d) => d.severity !== 'INFO').map((d) => `${d.ruleId}:${d.elementId}`));
  for (const t of [['winder', 'winder'], ['landing', 'landing']]) {
    const patch = { turn1Type: t[0], turn2Type: t[1], mergeLandings: false, openingMode: 'derived' };
    const u = keys(S({ ...patch, stairType: 'U' }));
    for (const k of keys(S(patch))) assert.ok(u.has(k), `${t.join('/')}: ${k} only in the S`);
  }
});

test("S stairwell: sides A/B/C along the outer line, the B–C corner is concave — the walls meet at the wanga's face, not past it", () => {
  const c = S({ stairwellRoomEnabled: true, stairwellWallGapMm: 20 });
  const b = buildStaircase(c);
  const report = b.stairwell;
  assert.deepEqual(report.sides.map((s) => s.side), ['A', 'B', 'C']);
  const walls = stairwellWalls(stairwellReport(b.fullConfig, b.planLayout), b.fullConfig, b.planLayout).pieces;
  const B = walls.find((w) => w.side === 'B');
  const C = walls.find((w) => w.side === 'C');
  // the inner faces of walls B and C meet exactly at the corner moved by the gap into the wall side
  const corner = b.planLayout.turns[1].innerCorner;
  const meet = { x: C.a.x, y: B.b.y };
  assert.ok(Math.abs(B.b.x - C.a.x) < 1e-6, 'B ends where C begins (across)');
  assert.ok(Math.hypot(meet.x - corner.x, meet.y - corner.y) - 20 * Math.SQRT2 < 1e-6);
});
