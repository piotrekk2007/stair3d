import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { starterGeometry, sanitizeStarterTreads, canBeStarter, starterHandles, starterDragValue } from '../starterSteps.js';
import { starterHandlesXML } from '../../plan2d/plan2dRenderer.js';
import { signedPolygonArea } from '../pathUtils.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { applyRailingPostEdit } from '../railingPostEdits.js';
import { segmentsProperlyIntersect } from '../pathUtils.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

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

test('regression (user, 2026-10-20): a starter step is a TREAD (no block): its own bent riser without the stair risers; widened to the outer side the newel stays', () => {
  const plain = straight();
  const b = straight({ hasRiserBoards: false, manualStarterTreads: { 0: { leftMm: 250, rightMm: 0, radiusMm: 135, bowMm: 40, riser: true } } });
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

const selfIntersects = (pts) => {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if ((j + 1) % n !== i && segmentsProperlyIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  return false;
};

test('regression (2026-10-20): a half-circle end with the nosing stays one simple outline (the grown back arc used to run past the front one)', () => {
  const g = starterGeometry(tread, spec({ leftMm: 250, radiusMm: 135 }), 25);
  assert.equal(selfIntersects(g.outline), false);
  const b = straight({ manualStarterTreads: { 0: { leftMm: 250, radiusMm: 135, riser: true } } });
  const errors = runTakeoffValidationGate(b).diagnostics.filter((d) => d.severity === 'ERROR' && /step-0|riser-0/.test(d.elementId || ''));
  assert.deepEqual(errors.map((d) => d.ruleId), []);
});

test('regression (user, 2026-10-20): the starter step LIES ON the wanga it is widened past — the housed board cut down to its underside there, no housing; the other wanga as before', () => {
  for (const [patch, onSide, other] of [[{ rightMm: 250 }, 'inner', 'outer'], [{ leftMm: 250 }, 'outer', 'inner']]) {
    const b = straight({ stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', manualStarterTreads: { 0: { ...patch, radiusMm: 135 } } });
    assert.ok(b.planLayout.treads[0].starter.widened[onSide], `${JSON.stringify(patch)} is widened on the ${onSide} side`);
    const under = b.treadModels[0].elevation.bottom;
    const board = (side) => b.stringerConstruction[side].find((g) => g.segmentId === b.stringerModels[side].segments[0].id);
    const bearing = b.stringerModels[onSide].segments[0].treadBearings.find((x) => x.treadIndex === 0);
    assert.ok(bearing?.starterOnTop, 'the wanga still carries it');
    assert.ok(!board(onSide).housings.some((h) => h.treadIndex === 0), 'no housing under the starter');
    const top = Math.max(...board(onSide).outerContour.filter((p) => p.u > 1 && p.u < bearing.finalUEnd - 1).map((p) => p.v));
    assert.ok(top <= under + 1e-6, `the board under the starter reaches ${top.toFixed(0)} (tread underside ${under.toFixed(0)})`);
    assert.ok(board(other).housings.some((h) => h.treadIndex === 0), 'the other wanga houses it as before');
  }
});

test('regression (user, 2026-10-20): widened on the dusza side at the start, the newel stands ON the starter tread on the wanga axis, its back face at the tread back edge; the dusza balustrade starts there', () => {
  const plain = straight();
  const b = straight({ manualStarterTreads: { 0: { rightMm: 250, radiusMm: 135 } }, railingEnabled: true, railingSections: [{ id: 'r', side: 'inner', fromStep: 0, toStep: null }] });
  const newel = b.postModels.find((p) => p.postId === 'post-start');
  const rh = b.fullConfig.riserHeight;
  assert.ok(Math.abs(newel.elevation.bottom - rh) < 1e-6, 'on the tread');
  const back = b.planLayout.treads[0].innerChain.at(-1);
  const d = b.planLayout.treads[0].direction ?? { x: 0, y: 1 };
  const backFace = (newel.position.y - back.y) * (d.y || 1) + newel.size / 2;
  assert.ok(Math.abs(backFace) < 1e-6, 'its back face at the back edge');
  assert.ok(!b.stringerModels.inner.segments[0].startPost, 'the inner board runs on under the tread (no post at its foot)');
  const r = b.railingModel.sections.find((s) => s.id === 'r');
  assert.equal(r.fromStep, 1);
  assert.equal(r.runs[0].startPostId, 'post-start');
  // widened only to the outer side: the newel stays where it was
  const outerOnly = straight({ manualStarterTreads: { 0: { leftMm: 250 } } });
  assert.deepEqual(outerOnly.postModels.find((p) => p.postId === 'post-start').position, plain.postModels.find((p) => p.postId === 'post-start').position);
});

test('plan handles: one per widened end, the bow, the roundings; dragging a handle to a point gives that value back (5 mm steps)', () => {
  const b = straight({ manualStarterTreads: { 0: { leftMm: 0, rightMm: 200, radiusMm: 100, bowMm: 30 } } });
  const t = b.planLayout.treads[0];
  const hs = starterHandles(t);
  assert.deepEqual(hs.map((h) => h.kind).sort(), ['bow', 'left', 'radius-right', 'right']);
  // each handle where its own value puts it: reading it back at its own spot gives the current value
  const at = (k) => hs.find((h) => h.kind === k).at;
  assert.deepEqual(starterDragValue(t, 'right', at('right')), { rightMm: 200 });
  assert.deepEqual(starterDragValue(t, 'bow', at('bow')), { bowMm: 30 });
  assert.deepEqual(starterDragValue(t, 'radius-right', at('radius-right')), { radiusMm: 100 });
  assert.deepEqual(starterDragValue(t, 'left', at('left')), { leftMm: 0 });
  // moved 100 mm further out along their axes
  const out = (k, mm) => {
    const h = hs.find((x) => x.kind === k);
    return { x: h.at.x + h.axis.x * mm, y: h.at.y + h.axis.y * mm };
  };
  assert.deepEqual(starterDragValue(t, 'right', out('right', 102)), { rightMm: 300 });
  // the left end (not widened yet) sits 20 mm in from the stair line (the housing recess); once widened it carries the
  // nosing (25 mm) — so the handle ends up exactly under the pointer: 150 − 20 − 25
  assert.deepEqual(starterDragValue(t, 'left', out('left', 150)), { leftMm: 105 });
  const widened = straight({ manualStarterTreads: { 0: { leftMm: 105, rightMm: 200, radiusMm: 100, bowMm: 30 } } }).planLayout.treads[0];
  const leftAt = starterHandles(widened).find((h) => h.kind === 'left').at;
  assert.ok(Math.hypot(leftAt.x - out('left', 150).x, leftAt.y - out('left', 150).y) < 1e-6, 'the handle follows the pointer');
  assert.deepEqual(starterDragValue(t, 'bow', out('bow', 50)), { bowMm: 80 });
  assert.deepEqual(starterDragValue(t, 'bow', out('bow', -100)), { bowMm: 0 }, 'never negative');
  // the plan draws them for the selected starter only
  const xml = starterHandlesXML(b.planLayout, { elementType: 'tread', stepIndex: 0 });
  assert.equal((xml.match(/class="starter-handle"/g) || []).length, 4);
  assert.equal(starterHandlesXML(b.planLayout, { elementType: 'tread', stepIndex: 1 }), '');
  assert.equal(starterHandlesXML(b.planLayout, null), '');
});
