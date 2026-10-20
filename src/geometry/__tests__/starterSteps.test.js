import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { starterGeometry, sanitizeStarterTreads, canBeStarter } from '../starterSteps.js';
import { signedPolygonArea } from '../pathUtils.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { applyRailingPostEdit } from '../railingPostEdits.js';

const straight = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 15, totalRise: 2800, ...patch });
// a tread laid out along +y (walking up = +y, so RIGHT = +x): inner line x = 0, outer line x = 900, 270 deep
const tread = {
  type: 'straight',
  frontEdge: [{ x: 0, y: 0 }, { x: 900, y: 0 }],
  backEdge: [{ x: 0, y: 270 }, { x: 900, y: 270 }],
  innerChain: [{ x: 0, y: 0 }, { x: 0, y: 270 }],
  outerChain: [{ x: 900, y: 0 }, { x: 900, y: 270 }],
  outline: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 270 }, { x: 0, y: 270 }],
};
const xs = (pts) => pts.map((p) => p.x);
const ys = (pts) => pts.map((p) => p.y);
const spec = (patch = {}) => ({ leftMm: 0, rightMm: 0, radiusMm: 0, bowMm: 0, riser: false, ...patch });

test('sanitize: non-negative numbers, riser a boolean, bad keys dropped; only an ordinary straight tread qualifies', () => {
  assert.deepEqual(sanitizeStarterTreads({ 0: { leftMm: -5, rightMm: '200', riser: 'yes' }, x: {}, 2: null }), { 0: { leftMm: 0, rightMm: 200, radiusMm: 0, bowMm: 0, riser: false } });
  assert.ok(canBeStarter({ type: 'straight' }));
  assert.ok(!canBeStarter({ type: 'winder', winderInfo: {} }));
  assert.ok(!canBeStarter({ type: 'landing' }));
});

test('geometry: widened to the RIGHT (walking up) from the stair line, the end rounded to a half circle, the nosing in front and round the end', () => {
  const g = starterGeometry(tread, spec({ rightMm: 300, radiusMm: 1000 }), 30);
  assert.ok(Math.abs(Math.max(...xs(g.outline)) - 1230) < 1e-6, 'right: 900 + 300 + the nosing round the end');
  assert.ok(Math.abs(Math.min(...xs(g.outline))) < 1e-6, 'left: unchanged');
  assert.ok(Math.abs(Math.min(...ys(g.outline)) + 30) < 1e-6, 'the nosing in front');
  assert.ok(Math.abs(Math.max(...ys(g.outline)) - 270) < 1e-6, 'nothing past the back edge');
  assert.equal(Math.sign(signedPolygonArea(g.outline)), Math.sign(signedPolygonArea(tread.outline)));
  // the riser: from the front-left corner along the front and round the right end to the back edge, on the riser line
  const r = g.riserPath;
  assert.ok(Math.abs(r[0].x) < 1e-6 && Math.abs(r[0].y) < 1e-6, 'starts at the front-left corner (left not widened)');
  assert.ok(Math.abs(r[r.length - 1].y - 270) < 1e-6, 'ends on the back edge');
  for (const p of r.filter((q) => q.x > 1066)) assert.ok(Math.abs(Math.hypot(p.x - 1065, p.y - 135) - 135) < 1e-6, 'a half circle of the depth');
});

test('geometry: widened to the LEFT, bowed front — the middle reaches the sagitta forward, the ends not', () => {
  const g = starterGeometry(tread, spec({ leftMm: 200, radiusMm: 100, bowMm: 50 }), 0);
  assert.ok(Math.abs(Math.min(...xs(g.outline)) + 200) < 1e-6, 'left widened');
  assert.ok(Math.abs(Math.max(...xs(g.outline)) - 900) < 1e-6, 'right unchanged');
  assert.ok(Math.abs(Math.min(...ys(g.outline)) + 50) < 0.5, `bow ${Math.min(...ys(g.outline)).toFixed(1)}`);
  // the riser wraps the widened LEFT end and stops at the front-right corner
  assert.ok(Math.abs(g.riserPath[0].y - 270) < 1e-6 && g.riserPath[0].x < 0);
  const last = g.riserPath[g.riserPath.length - 1];
  assert.ok(Math.abs(last.x - 900) < 1e-6 && Math.abs(last.y) < 1e-6);
});

test('regression (user, 2026-10-20): a starter step is a TREAD (no block): its own bent riser without the stair risers, the wangi and the newel unchanged', () => {
  const plain = straight();
  const b = straight({ hasRiserBoards: false, manualStarterTreads: { 0: { leftMm: 0, rightMm: 250, radiusMm: 135, bowMm: 40, riser: true } } });
  const t0 = b.treadModels[0];
  assert.ok(t0.starter && !t0.notch);
  const width = (t) => Math.max(...xs(t.outline)) - Math.min(...xs(t.outline));
  assert.ok(width(t0) > width(plain.treadModels[0]) + 200);
  // only the starter's own riser, bent: many panels
  assert.equal(b.riserModels.length, 1);
  assert.equal(b.riserModels[0].stepId, 'step-0');
  assert.ok(b.riserModels[0].starter && b.riserModels[0].panels.length > 10);
  // no blocks, the newel and the wangi as without it
  let blocks = 0;
  b.root.traverse((o) => {
    if (o.name?.startsWith('StarterBlock')) blocks++;
  });
  assert.equal(blocks, 0);
  const newel = (x) => x.postModels.find((p) => p.postId === 'post-start');
  assert.deepEqual(newel(b).position, newel(plain).position);
  assert.deepEqual(newel(b).elevation, newel(plain).elevation);
  assert.ok(b.stringerModels.outer.segments[0].treadBearings.some((x) => x.treadIndex === 0), 'the wanga still carries it');
  // takeoff: the bent riser priced, with its note
  const items = computeMaterialTakeoff(b, b.fullConfig);
  const riser = items.find((i) => i.itemId === 'riser-step-0');
  assert.ok(riser && riser.notes.some((n) => n.includes('GIĘTY')));
  // without the riser: none at all
  const bare = straight({ hasRiserBoards: true, manualStarterTreads: { 0: { rightMm: 250, riser: false } } });
  assert.ok(!bare.riserModels.some((r) => r.stepId === 'step-0'));
  assert.ok(bare.riserModels.some((r) => r.stepId === 'step-1'));
});

test('a winder cannot be a starter step; a starter widened into a stairwell wall is reported', () => {
  const L = buildStaircase({ ...createDefaultConfig(), manualStarterTreads: { 6: { rightMm: 300 } } });
  assert.ok(!L.treadModels[6].starter, 'tread 7 of the default L is a winder');
  // the straight stair's wall A runs along its LEFT side (walking up)
  const walled = straight({ stairwellRoomEnabled: true, manualStarterTreads: { 0: { leftMm: 200 } } });
  assert.ok(walled.stairwell.diagnostics.some((d) => d.ruleId === 'STARTER-INTO-WALL' && d.value >= 199));
  const free = straight({ stairwellRoomEnabled: true, manualStarterTreads: { 0: { rightMm: 200 } } });
  assert.ok(!free.stairwell.diagnostics.some((d) => d.ruleId === 'STARTER-INTO-WALL'));
});

test('railing posts: "remove all hand-placed" clears them in one edit', () => {
  let e = applyRailingPostEdit({}, { action: 'add', sectionId: 's', s: 100 });
  e = applyRailingPostEdit(e, { action: 'add', sectionId: 's', s: 500 });
  e = applyRailingPostEdit(e, { action: 'remove-all-manual', sectionId: 's' });
  assert.deepEqual(e, {});
});
