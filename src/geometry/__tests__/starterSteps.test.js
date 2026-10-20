import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { starterStepSpecs, starterOutline, availableStarterSteps } from '../starterSteps.js';
import { signedPolygonArea } from '../pathUtils.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';

const straight = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 12, totalRise: 2600, ...patch });
// a tread laid out along +y, 900 wide (inner x = 0, outer x = 900), 270 deep
const tread = { type: 'straight', frontEdge: [{ x: 0, y: 0 }, { x: 900, y: 0 }], backEdge: [{ x: 0, y: 270 }, { x: 900, y: 270 }], outline: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 270 }, { x: 0, y: 270 }] };
const xs = (pts) => pts.map((p) => p.x);
const ys = (pts) => pts.map((p) => p.y);

test('specs: the count is clamped to the leading straight treads (max 3), the values to >= 0', () => {
  const treads = [{ type: 'straight' }, { type: 'straight' }, { type: 'winder' }, { type: 'winder' }];
  assert.equal(availableStarterSteps(treads), 2);
  const specs = starterStepSpecs({ starterStepCount: 3, starterStep1OuterMm: 200, starterStep1InnerMm: -5, starterStep2RadiusMm: 80 }, treads);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs[0], { index: 0, outerMm: 200, innerMm: 0, radiusMm: 0, bowMm: 0 });
  assert.equal(specs[1].radiusMm, 80);
  assert.equal(starterStepSpecs({ starterStepCount: 0 }, treads).length, 0);
});

test('outline: widened per side, the widened ends rounded (a half circle at most), the back edge straight', () => {
  const shape = starterOutline(tread, { outerMm: 300, innerMm: 0, radiusMm: 1000, bowMm: 0 });
  assert.ok(Math.abs(Math.max(...xs(shape.outline)) - 1200) < 1e-6, 'outer side widened by 300');
  assert.ok(Math.abs(Math.min(...xs(shape.outline)) - 0) < 1e-6, 'inner side unchanged');
  assert.ok(Math.abs(Math.min(...ys(shape.outline))) < 1e-6 && Math.abs(Math.max(...ys(shape.outline)) - 270) < 1e-6, 'depth unchanged');
  // the outer end is a half circle of the depth: its points round (1065, 135) at 135 mm
  const end = shape.outline.filter((p) => p.x > 1066);
  assert.ok(end.length > 5);
  for (const p of end) assert.ok(Math.abs(Math.hypot(p.x - 1065, p.y - 135) - 135) < 1e-6);
  // the inner corners (no widening) stay square
  assert.ok(shape.outline.some((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9));
  assert.ok(shape.outline.some((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.y - 270) < 1e-9));
  // the same orientation as the tread's own outline
  assert.equal(Math.sign(signedPolygonArea(shape.outline)), Math.sign(signedPolygonArea(tread.outline)));
});

test('outline: a bowed front reaches `bowMm` forward in the middle, nothing at the ends; the back stays straight', () => {
  const shape = starterOutline(tread, { outerMm: 200, innerMm: 200, radiusMm: 0, bowMm: 60 });
  assert.ok(Math.abs(Math.min(...ys(shape.outline)) + 60) < 0.5, `front middle at ${Math.min(...ys(shape.outline)).toFixed(1)}`);
  const back = shape.outline.filter((p) => p.y > 269.999);
  assert.ok(back.length >= 2 && Math.abs(Math.min(...xs(back)) + 200) < 1e-6 && Math.abs(Math.max(...xs(back)) - 1100) < 1e-6);
  const cornerFront = shape.outline.find((p) => Math.abs(p.x + 200) < 1e-6 && p.y < 1);
  assert.ok(cornerFront && Math.abs(cornerFront.y) < 1e-6, 'no bow at the ends');
});

test('regression (user, 2026-10-20): starter steps — wider blocks on the floor, no risers, the wangi start behind them, the newel stands on the last one, the balustrade starts there', () => {
  const plain = straight({ hasRiserBoards: true });
  const b = straight({ hasRiserBoards: true, starterStepCount: 2, starterStep1OuterMm: 250, starterStep1RadiusMm: 135, starterStep2OuterMm: 120, railingEnabled: true, railingSections: [{ id: 'r', side: 'inner', fromStep: 0, toStep: null }] });
  const rh = b.fullConfig.riserHeight;
  const [t0, t1, t2] = b.treadModels;
  assert.ok(t0.starter && t1.starter && !t2.starter);
  // wider than the stair on the outer side
  const width = (t) => Math.max(...xs(t.outline)) - Math.min(...xs(t.outline));
  assert.ok(width(t0) > width(plain.treadModels[0]) + 200);
  assert.ok(!t0.notch && !t1.notch, 'no riser groove');
  // no riser boards for them, the rest unchanged
  assert.equal(b.riserModels.length, plain.riserModels.length - 2);
  assert.ok(!b.riserModels.some((r) => r.stepId === 'step-0' || r.stepId === 'step-1'));
  // the wangi carry no starter tread and start at the first carried tread's front edge
  for (const side of ['outer', 'inner']) {
    const seg = b.stringerModels[side].segments[0];
    assert.ok(!b.stringerModels[side].segments.some((s) => s.treadBearings.some((x) => x.treadIndex < 2)), `${side}: no bearing for a starter`);
    const front = b.planLayout.treads[2][side === 'outer' ? 'outerChain' : 'innerChain'][0];
    assert.ok(Math.hypot(seg.referenceLine.start.x - front.x, seg.referenceLine.start.y - front.y) < 1e-6);
  }
  // the newel on the second block: bottom at its top, its back face where the wanga starts; the inner board enters it
  const newel = b.postModels.find((p) => p.postId === 'post-start');
  assert.ok(Math.abs(newel.elevation.bottom - 2 * rh) < 1e-6);
  const inner = b.stringerModels.inner.segments[0];
  assert.equal(inner.startPost?.postId, 'post-start');
  assert.ok(Math.abs(inner.startPost.faceU) < 1e-6, 'the newel back face at the wanga start');
  // the balustrade starts at the newel
  const r = b.railingModel.sections.find((s) => s.id === 'r');
  assert.equal(r.fromStep, 2);
  assert.equal(r.runs[0].startPostId, 'post-start');
  // no new ERROR from the starter steps
  const errs = (built) => new Set([...(built.stringerConstruction.inner || []), ...(built.stringerConstruction.outer || [])].flatMap((g) => g.diagnostics || []).filter((d) => d.severity === 'ERROR').map((d) => d.ruleId));
  for (const id of errs(b)) assert.ok(errs(plain).has(id), `new error ${id}`);
  // takeoff: a cladding item per block
  const items = computeMaterialTakeoff(b, b.fullConfig);
  assert.equal(items.filter((i) => i.itemId.startsWith('starter-block-')).length, 2);
});

test('the 3D view has the blocks; a starter step widened into a stairwell wall is reported', () => {
  const b = straight({ starterStepCount: 1, starterStep1OuterMm: 200 });
  let blocks = 0;
  b.root.traverse((o) => {
    if (o.name?.startsWith('StarterBlock_')) blocks++;
  });
  assert.equal(blocks, 1);
  const walled = straight({ starterStepCount: 1, starterStep1OuterMm: 200, stairwellRoomEnabled: true });
  assert.ok(walled.stairwell.diagnostics.some((d) => d.ruleId === 'STARTER-INTO-WALL' && d.value >= 199));
  const free = straight({ starterStepCount: 1, starterStep1OuterMm: 200, stairwellRoomEnabled: true, stairwellWallAExtent: 'end', stairwellWallALengthMm: 1500 });
  assert.ok(!free.stairwell.diagnostics.some((d) => d.ruleId === 'STARTER-INTO-WALL'), 'a wall that starts behind the starter steps');
});
