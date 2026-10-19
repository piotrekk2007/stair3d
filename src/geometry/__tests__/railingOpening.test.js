import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';

// an L whose opening covers the whole plan (2336 × 2886): the stair arrives at its E edge
const L = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'L', openingOffsetX: 0, openingOffsetY: 0, openingWidth: 2886, openingLength: 2336, railingOpeningEnabled: true, ...patch });
const openingSections = (b) => b.railingModel.sections.filter((s) => s.kind === 'opening');

test('balustrade round the opening: level, on the floor, at its own height; the exit edge only where the stair is not', () => {
  const b = L();
  const edges = b.railingModel.openingEdges;
  assert.equal(edges.length, 4);
  const exit = edges.find((e) => e.exit);
  assert.ok(exit && exit.stair, 'one exit edge, with the stretch the stair stands on');
  const sections = openingSections(b);
  assert.equal(sections.length, 1, 'the free pieces round the opening = one section');
  const s = sections[0];
  assert.ok(s.valid);
  const z = b.fullConfig.totalRise;
  for (const p of s.posts) {
    assert.equal(p.elevation.bottom, z, 'posts stand on the floor');
    assert.ok(p.elevation.top >= z + 1100 - 1e-6);
  }
  const top = s.handrail.pieces.map((p) => p.start.z + s.handrail.heightMm / 2);
  assert.ok(top.every((t) => Math.abs(t - (z + 1100)) < 1e-6), 'handrail top 1100 above the floor');
  assert.ok(s.balusters.length > 10);
  assert.ok(s.balusters.every((x) => x.zBottom === z));
  assert.ok(b.allPostModels.some((p) => p.postId.startsWith('railing-post-opening-')));
});

test("regression (user, 2026-10-19): on the exit edge the balustrade runs only from the stair's post — no handrail over the stair, no second post", () => {
  const b = L();
  const exit = b.railingModel.openingEdges.find((e) => e.exit);
  const s = openingSections(b)[0];
  // no handrail piece lies over the stair's stretch of the exit edge
  const [t0, t1] = exit.stair;
  const lenE = Math.hypot(exit.b.x - exit.a.x, exit.b.y - exit.a.y);
  const ux = (exit.b.x - exit.a.x) / lenE;
  const uy = (exit.b.y - exit.a.y) / lenE;
  for (const piece of s.handrail.pieces) {
    for (const p of [piece.start, piece.end]) {
      const along = ((p.x - exit.a.x) * ux + (p.y - exit.a.y) * uy) / lenE;
      const off = Math.abs((p.x - exit.a.x) * uy - (p.y - exit.a.y) * ux);
      if (off < 200) assert.ok(along <= t0 + 1e-6 || along >= t1 - 1e-6, `a handrail point over the stair (t ${along.toFixed(2)})`);
    }
  }
  // its end at the stair is the stair's own end newel: reused, not a new post
  const end = s.postSpots.find((x) => x.reused);
  assert.ok(end, 'one end uses a stair post');
  assert.equal(end.postId, 'post-end');
  assert.ok(!s.posts.some((p) => p.postId === end.spotId), 'no second post there');
  assert.ok(s.runs.some((r) => r.endPostId === 'post-end' || r.startPostId === 'post-end'));
  // the stair post reaches the opening handrail's top
  const newel = b.allPostModels.find((p) => p.postId === 'post-end');
  assert.ok(newel.elevation.top >= b.fullConfig.totalRise + 1100 - 1e-6, `${newel.elevation.top}`);
});

test("an edge switched by hand: off splits the section / drops the exit edge's free part; no opening railing when off", () => {
  const edges = L().railingModel.openingEdges;
  const exitIndex = edges.find((e) => e.exit).index;
  const middle = (exitIndex + 2) % 4;
  assert.equal(openingSections(L({ railingOpeningEdges: { [middle]: false } })).length, 2);
  const noExit = openingSections(L({ railingOpeningEdges: { [exitIndex]: false } }));
  assert.equal(noExit.length, 1);
  assert.ok(!noExit[0].postSpots.some((x) => x.reused), 'without the exit edge it no longer reaches the stair post');
  assert.equal(openingSections(L({ railingOpeningEnabled: false })).length, 0);
});

test('the edges along the stairwell walls are left out by default', () => {
  const b = buildStaircase({ ...createDefaultConfig(), stairType: 'U', treadsLegB: 0, uSingleWinderZone: true, uWindersTotal: 6, turn1Type: 'winder', turn2Type: 'winder', stairwellRoomEnabled: true, openingMode: 'derived', railingOpeningEnabled: true });
  const edges = b.railingModel.openingEdges;
  assert.ok(edges.some((e) => e.wall), 'some edges are along walls');
  for (const e of edges.filter((x) => !x.exit)) assert.equal(e.enabled, !e.wall);
});

test('hand-placed posts and a switched-off corner work on the opening sections too', () => {
  const s0 = openingSections(L())[0];
  const corner = s0.postSpots.find((x) => x.kind === 'corner');
  const s = openingSections(L({ railingPostEdits: { [s0.id]: { added: [{ id: 'm1', s: 600 }], suppressed: [corner.s] } } }))[0];
  assert.ok(s.postSpots.some((x) => x.kind === 'manual' && x.s === 600));
  assert.ok(!s.postSpots.some((x) => x.kind === 'corner' && Math.abs(x.s - corner.s) < 1));
  assert.equal(s.suppressedCorners.length, 1);
});

test('the opening balustrade below 1.1 m is a WARNING (PL-LEGAL-H-01)', () => {
  const b = L({ railingOpeningHeightMm: 900 });
  assert.ok(b.railingModel.diagnostics.some((d) => d.ruleId === 'PL-LEGAL-H-01' && d.parameter === 'railingOpeningHeightMm'));
});

test("regression (user, 2026-10-19): the stair's end newel stands on the slab, on the opening balustrade's line — both handrails meet its faces, the inner wanga runs on to it", () => {
  const off = L({ railingOpeningEnabled: false });
  const b = L({ railingEnabled: true, railingSections: [{ id: 'r1', side: 'inner', fromStep: 0, toStep: off.treadModels.length - 1 }] });
  const z = b.fullConfig.totalRise;
  const newel = b.postModels.find((p) => p.postId === 'post-end');
  const before = off.postModels.find((p) => p.postId === 'post-end');
  assert.ok(newel.onSlab, 'moved onto the slab');
  assert.equal(newel.elevation.bottom, z, 'it stands on the floor');
  assert.ok(before.elevation.bottom < z, 'without the opening balustrade it hangs down beside the wanga as before');
  // its centre on the opening balustrade's line: the opening handrail ends at its face in a straight line
  const s = openingSections(b)[0];
  const run = s.runs.find((r) => r.endPostId === 'post-end' || r.startPostId === 'post-end');
  const pieces = run.pieces;
  const atPost = run.endPostId === 'post-end' ? pieces[pieces.length - 1] : pieces[0];
  const far = run.endPostId === 'post-end' ? atPost.start : atPost.end;
  const near = run.endPostId === 'post-end' ? atPost.end : atPost.start;
  const dx = near.x - far.x;
  const dy = near.y - far.y;
  const len = Math.hypot(dx, dy);
  const sideways = Math.abs(((newel.position.x - far.x) * dy - (newel.position.y - far.y) * dx) / len);
  assert.ok(sideways < 1e-6, `the newel's centre is ${sideways.toFixed(1)} mm off the opening handrail's line`);
  assert.ok(Math.abs(Math.hypot(newel.position.x - near.x, newel.position.y - near.y) - newel.size / 2) < 1e-6, 'the opening handrail ends at its face');
  // the stair handrail ends at its face too
  const stair = b.railingModel.sections.find((x) => x.id === 'r1');
  const lastRun = stair.runs[stair.runs.length - 1];
  assert.equal(lastRun.endPostId, 'post-end');
  const end = lastRun.pieces[lastRun.pieces.length - 1].end;
  assert.ok(Math.abs(Math.hypot(end.x - newel.position.x, end.y - newel.position.y) - newel.size / 2) < 1e-6, 'the stair handrail ends at its face');
  // the inner wanga runs on past the slab's edge into the post; what is past the edge lies above the floor
  const seg = b.stringerModels.inner.segments.at(-1);
  assert.equal(seg.endPost.postId, 'post-end');
  const g = b.stringerConstruction.inner.find((x) => x.segmentId === seg.id);
  const maxU = Math.max(...g.outerContour.map((p) => p.u));
  assert.ok(maxU > seg.referenceLine.length + 1, `the board reaches the moved post (ends at u ${maxU.toFixed(0)}, slab edge ${seg.referenceLine.length.toFixed(0)})`);
  assert.ok(Math.abs(maxU - (seg.endPost.faceU + b.fullConfig.postHousingDepthMm)) < 1e-6, 'into the post by its housing depth');
  const edgeU = seg.endPost.onSlab.edgeU;
  for (const p of g.outerContour) if (p.u > edgeU + 1e-6) assert.ok(p.v >= z - 1e-6, `a board point past the slab's edge below the floor (${p.u.toFixed(0)}, ${p.v.toFixed(0)})`);
  // the post's pocket for the board starts at the floor
  const joint = b.joints.joints.find((j) => j.postId === 'post-end' && j.type === 'STRINGER_POST_HOUSING');
  assert.ok(joint && joint.pocket.zMin >= z - 1e-6);
});
