import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { signedPolygonArea } from '../pathUtils.js';
import { treadGoingAtOffsetFromInner, WINDER_WIDTH_MEASURE_OFFSET_MM } from '../walklineModel.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { stairwellWalls, stairwellReport } from '../stairwell.js';
import { generateStairwellVariants } from '../../designer/stairwellVariants.js';

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

test('S stairwell, fixed sides: A, B and C kept LIVE — from other counts and going the stair comes back to exactly those sides', () => {
  const ref = buildStaircase(S({ stairwellRoomEnabled: true }));
  const sides = Object.fromEntries(ref.stairwell.sides.map((x) => [x.side, Math.round(x.achieved)]));
  const fixed = { stairwellSideAMm: sides.A, stairwellSideBMm: sides.B, stairwellSideCMm: sides.C, stairwellSideAFixed: true, stairwellSideBFixed: true, stairwellSideCFixed: true };
  const b = buildStaircase(S({ stairwellRoomEnabled: true, ...fixed, treadGoing: 240, treadsLegA: 6, treadsLegB: 0, treadsLegC: 1 }));
  for (const x of b.stairwell.sides) assert.ok(Math.abs(x.achieved - x.target) <= 1, `side ${x.side}: ${x.achieved.toFixed(1)} instead of ${x.target}`);
  assert.equal(b.stairwell.diagnostics.filter((d) => d.ruleId === 'STAIRWELL-SIDE-FIXED').length, 0);
  // the variants: an S's own (two winder turns n − 1..n + 1, two landings), the winder ones meeting every side
  const v = generateStairwellVariants(S({ stairwellRoomEnabled: true, ...fixed }));
  assert.ok(v.ok);
  assert.ok(v.variants.every((x) => x.id.startsWith('S-')), v.variants.map((x) => x.id).join(','));
  assert.ok(v.variants.some((x) => x.id === 'S-landing'));
  const winders = v.variants.filter((x) => x.id.startsWith('S-w'));
  assert.equal(winders.length, 3);
  assert.ok(winders.every((x) => x.ok), winders.map((x) => x.problems.join(';')).join(' | '));
});

test('regression (2026-10-23): a DERIVED opening holds every tread that needs headroom — U and S (a corner on the 0.1 mm grid used to stick out by microns)', () => {
  for (const stairType of ['U', 'S']) {
    for (const well of [false, true]) {
      const b = buildStaircase(S({ stairType, openingMode: 'derived', stairwellRoomEnabled: well }));
      assert.deepEqual(b.ceilingFit.violatingTreads, [], `${stairType}${well ? ' in a stairwell' : ''}`);
    }
  }
});

test("S stairwell frame: wall C's line is on the near side of side B's end (x = B − gap), not past it like a U's", () => {
  const b = buildStaircase(S({ stairwellRoomEnabled: true, stairwellWallGapMm: 15 }));
  const B = b.stairwell.sides.find((x) => x.side === 'B').achieved;
  const lines = b.stairwell.frame.wallLines;
  assert.ok(lines.some((l) => l.axis === 'x' && Math.abs(l.value - (B - 15)) < 1e-6), JSON.stringify(lines));
  const u = buildStaircase(S({ stairType: 'U', stairwellRoomEnabled: true, stairwellWallGapMm: 15 }));
  const Bu = u.stairwell.sides.find((x) => x.side === 'B').achieved;
  assert.ok(u.stairwell.frame.wallLines.some((l) => l.axis === 'x' && Math.abs(l.value - (Bu + 15)) < 1e-6));
});

test("S stairwell: a fixed B narrower than the stair's own comes out exactly — the width is narrowed (never widened), as in a U", () => {
  const b = buildStaircase(S({ stairwellRoomEnabled: true, stairwellSideAMm: 2600, stairwellSideBMm: 1800, stairwellSideCMm: 1500, stairwellSideAFixed: true, stairwellSideBFixed: true, stairwellSideCFixed: true }));
  const side = (x) => b.stairwell.sides.find((s) => s.side === x);
  assert.ok(Math.abs(side('B').achieved - 1800) <= 1, `B ${side('B').achieved}`);
  assert.ok(Math.abs(side('C').achieved - 1500) <= 1, `C ${side('C').achieved}`);
  assert.ok(b.fullConfig.stairWidth < S().stairWidth, 'narrowed');
  // the other fixed side within one going
  assert.ok(Math.abs(side('A').achieved - 2600) < b.fullConfig.treadGoing);
});

test("regression (user, 2026-10-23): an S's stairwell walls on the LEFT or the RIGHT (walking up A) — the sides measured along that line, no post at the dusza against them (also with a wall gap)", () => {
  const sideLine = (b) => b.stairwell.frame.line;
  // first turn left: the inner line is the left one
  const left = buildStaircase(S({ stairwellRoomEnabled: true, stairwellWallHand: 'left', stairwellWallGapMm: 10 }));
  assert.equal(sideLine(left), 'inner');
  const inner = left.planLayout.innerFullPath;
  const A = left.stairwell.sides.find((x) => x.side === 'A').achieved;
  assert.ok(Math.abs(A - Math.hypot(inner[1].x - inner[0].x, inner[1].y - inner[0].y)) < 1, 'side A along the left (inner) line');
  // the walls stand outside the left line (x smaller than the stair's left line along A)
  const wallA = left.stairwellWalls.pieces.find((w) => w.side === 'A');
  assert.ok(wallA.a.x < inner[0].x && wallA.b.x < inner[0].x);
  assert.ok(!left.postModels.some((p) => p.postId === 'post-corner-0'), "the first turn's dusza is against the wall: no post");
  assert.ok(left.postModels.some((p) => p.line === 'outer'), 'the open dusza of the second turn keeps its post');
  // on the right: the outer line, the second turn's dusza against the wall
  const right = buildStaircase(S({ stairwellRoomEnabled: true, stairwellWallHand: 'right', stairwellWallGapMm: 10 }));
  assert.equal(sideLine(right), 'outer');
  assert.ok(!right.postModels.some((p) => p.line === 'outer'), 'no post at the wall even with a 10 mm gap (a concave corner: gap × √2)');
  assert.ok(right.postModels.some((p) => p.postId === 'post-corner-0'));
  // the hand is the user's: a first turn to the RIGHT with the walls on the left puts them on the OUTER line
  assert.equal(sideLine(buildStaircase(S({ turnDirection: 'right', stairwellRoomEnabled: true, stairwellWallHand: 'left' }))), 'outer');
});

test('a new project before "Generuj schody" (stairPending): the plan shows only the stairwell and the opening', async () => {
  const { renderPlan2DSVG } = await import('../../plan2d/plan2dRenderer.js');
  const c = S({ stairwellRoomEnabled: true, stairPending: true });
  const b = buildStaircase(c);
  const viewport = { x: -4000, y: -4000, width: 8000, height: 8000 };
  const pending = renderPlan2DSVG(b.planLayout, b.fullConfig, b.derived, { viewport, stairwell: null });
  const shown = renderPlan2DSVG(b.planLayout, { ...b.fullConfig, stairPending: false }, b.derived, { viewport, stairwell: null });
  assert.ok(!pending.includes('step-object'), 'no tread before generating');
  assert.ok(shown.includes('step-object'));
});

test("regression (user, 2026-10-23): at a postless lap corner the board reaches exactly one thickness past the corner — not also the housing recess (an S's dusza against the wall stuck out 20 mm past the other board)", () => {
  const c = S({ stairwellRoomEnabled: true, treadsLegA: 0, treadsLegB: 1, treadsLegC: 7, stairWidth: 760, treadGoing: 159.2, totalRise: 3000 });
  const b = buildStaircase(c);
  const seg = b.stringerModels.outer.segments.find((s) => s.id === 'outer-seg-1');
  const g = b.stringerConstruction.outer.find((x) => x.segmentId === seg.id);
  assert.ok(seg && g, 'the board exists');
  assert.equal(b.stringerModels.outer.segmentJoints[0].type, 'lap-joint');
  assert.ok(Math.abs(g.ends.end.u - (seg.referenceLine.length + seg.thickness)) < 0.5, `end u ${g.ends.end.u.toFixed(1)} vs corner + t ${(seg.referenceLine.length + seg.thickness).toFixed(1)}`);
});

test("regression (user, 2026-10-23): an S's walkline crosses flight B as one straight from turn 1's dusza to turn 2's — no jump across the stair along an edge", () => {
  const c = S();
  const L = layout(c);
  const { path, points } = L.walkline;
  const kB0 = c.treadsLegA + c.windersPerTurn;
  const kBn = kB0 + c.treadsLegB;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  // flight B starts at turn 1's walkline (off its dusza, the inner line) and ends at turn 2's (off ITS dusza, the outer
  // line), each turn's own offset; in between the edges' points lie on the straight between those two
  const off = (t) => L.turns[t].walklineOffsetMm ?? c.walklineOffset;
  const toLine = (p, line) => Math.min(...line.slice(1).map((q, i) => {
    const a = line[i];
    const len2 = (q.x - a.x) ** 2 + (q.y - a.y) ** 2;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (q.x - a.x) + (p.y - a.y) * (q.y - a.y)) / len2));
    return dist(p, { x: a.x + t * (q.x - a.x), y: a.y + t * (q.y - a.y) });
  }));
  assert.ok(Math.abs(toLine(points[kB0], L.innerFullPath) - off(0)) < 0.5, 'flight B starts on turn 1 walkline');
  assert.ok(Math.abs(toLine(points[kBn], L.outerFullPath) - off(1)) < 0.5, `flight B ends on turn 2 walkline: ${toLine(points[kBn], L.outerFullPath).toFixed(1)} vs ${off(1)}`);
  const iB0 = path.findIndex((q) => dist(q, points[kB0]) < 0.01);
  assert.ok(iB0 >= 0 && dist(path[iB0 + 1], points[kBn]) < 0.01, 'one straight across flight B');
  // every walkline point (edit pivot) lies on its edge and on the drawn path
  const onPath = (p) => path.some((q, i) => i > 0 && Math.abs((q.x - path[i - 1].x) * (p.y - path[i - 1].y) - (q.y - path[i - 1].y) * (p.x - path[i - 1].x)) / Math.max(1e-9, Math.hypot(q.x - path[i - 1].x, q.y - path[i - 1].y)) < 0.5
    && (p.x - path[i - 1].x) * (p.x - q.x) + (p.y - path[i - 1].y) * (p.y - q.y) <= 0.5);
  points.forEach((p, k) => assert.ok(onPath(p), `walkline point ${k} off the path`));
});
