import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { buildPostModels } from '../postSolver.js';
import { buildRailingModel, applyRailingPostEdit, sanitizeRailingPostEdits } from '../railingSolver.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildRailingItems } from '../../takeoff/railingItems.js';

const baseConfig = (patch = {}) => ({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 10, totalRise: 2000, treadGoing: 280, railingEnabled: true, railingSections: [{ id: 's', side: 'outer', fromStep: 0, toStep: null }], ...patch });
function stair(patch = {}) {
  const config = baseConfig(patch);
  const full = { ...config, riserHeight: deriveStairData(config).riserHeight };
  const planLayout = buildPlanLayout(full);
  const treadModels = buildTreadModels(planLayout, full);
  const stringerModels = buildStringerModelsForFlight(planLayout, full);
  const stringerConstruction = { outer: buildStringerConstructionGeometry(stringerModels.outer, full), inner: buildStringerConstructionGeometry(stringerModels.inner, full) };
  const postModels = buildPostModels(planLayout, full);
  return buildRailingModel({ planLayout, treadModels, stringerModels, stringerConstruction, postModels }, full).sections[0];
}
const L = (patch = {}) => stair({ stairType: 'L', turn1Type: 'landing', treadsLegA: 4, treadsLegB: 4, totalRise: 2600, ...patch });
const edits = (e) => ({ railingPostEdits: { s: e } });
const planLen = (p) => Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y);
const posted = (s) => s.runs.filter((r) => !r.wallRail);

test('edits: move-auto / reset-auto / bare / wall-rail are pure and clean', () => {
  let e = applyRailingPostEdit({}, { action: 'move-auto', sectionId: 's', key: 'end', s: 1500.04 });
  e = applyRailingPostEdit(e, { action: 'move-auto', sectionId: 's', key: 'join-0', s: 800 });
  e = applyRailingPostEdit(e, { action: 'bare', sectionId: 's', runKey: 'a>b', on: true });
  e = applyRailingPostEdit(e, { action: 'wall-rail', sectionId: 's', end: 'end', on: true });
  assert.deepEqual(e.s, { added: [], suppressed: [], moved: { end: 1500, 'join-0': 800 }, bare: ['a>b'], wallRail: { end: true } });
  e = applyRailingPostEdit(e, { action: 'reset-auto', sectionId: 's', key: 'end' });
  e = applyRailingPostEdit(e, { action: 'reset-auto', sectionId: 's', key: 'join-0' });
  e = applyRailingPostEdit(e, { action: 'bare', sectionId: 's', runKey: 'a>b', on: false });
  e = applyRailingPostEdit(e, { action: 'wall-rail', sectionId: 's', end: 'end', on: false });
  assert.deepEqual(e, {});
  assert.deepEqual(sanitizeRailingPostEdits({ s: { moved: { bogus: 3, end: -1 }, bare: [5, 'x'], wallRail: { start: 'yes' } } }), {});
});

test('regression (user, 2026-10-20): an automatic CORNER post can be moved — the handrail goes on through the corner and is cut at the new place; its id stays', () => {
  const plain = L();
  const corner = plain.postSpots.find((x) => x.kind === 'corner');
  assert.ok(corner?.movable, 'an automatic corner post is movable');
  const s = L(edits({ moved: { [corner.spotKey]: corner.s + 400 } }));
  const spot = s.postSpots.find((x) => x.spotKey === corner.spotKey);
  assert.ok(spot && spot.moved, 'the moved post is there');
  assert.equal(spot.postId, corner.postId, 'same post id (manualPostOverrides keep applying)');
  assert.ok(Math.abs(spot.s - (corner.s + 400)) < 1e-6);
  assert.ok(Math.hypot(spot.at.x - corner.at.x, spot.at.y - corner.at.y) > 300, 'it really stands elsewhere');
  // no post at the old corner any more; the runs meet the moved post
  assert.ok(!s.postSpots.some((x) => Math.hypot(x.at.x - corner.at.x, x.at.y - corner.at.y) < 1));
  assert.ok(s.runs.some((r) => r.endPostId === corner.postId) && s.runs.some((r) => r.startPostId === corner.postId));
  // back to AUTO
  const back = L(edits({ moved: {} }));
  assert.deepEqual(back.postSpots.map((x) => x.postId), plain.postSpots.map((x) => x.postId));
});

test('a moved END post: the balustrade ends there (own post), the rest of the path carries nothing; a moved start likewise', () => {
  const plain = stair();
  const total = plain.postSpots.find((x) => x.kind === 'end').s;
  const s = stair(edits({ moved: { end: total - 1000, start: 300 } }));
  const end = s.postSpots.find((x) => x.kind === 'end');
  const start = s.postSpots.find((x) => x.kind === 'start');
  assert.ok(Math.abs(end.s - (total - 1000)) < 1e-6 && end.moved);
  assert.ok(Math.abs(start.s - 300) < 1e-6 && start.moved);
  assert.equal(end.reused, false, 'a moved end gets its own post (a structural post there is left alone)');
  const handrail = s.handrail.pieces.reduce((sum, p) => sum + planLen(p), 0);
  const plainHandrail = plain.handrail.pieces.reduce((sum, p) => sum + planLen(p), 0);
  assert.ok(handrail < plainHandrail - 1200, `the handrail is shorter (${handrail.toFixed(0)} vs ${plainHandrail.toFixed(0)})`);
  assert.ok(s.balusters.length < plain.balusters.length);
});

test('a run set to "sama poręcz": no balusters under it, the handrail and its posts stay', () => {
  const plain = L();
  const run = plain.runs[0];
  const s = L(edits({ bare: [run.key] }));
  const bareRun = s.runs.find((r) => r.key === run.key);
  assert.equal(bareRun.bare, true);
  assert.equal(bareRun.pieces.length, run.pieces.length, 'the handrail is still there');
  assert.ok(s.balusters.length < plain.balusters.length, 'fewer balusters');
  // none under the bare run (plan: within its span)
  const a = run.pieces[0].start;
  const b = run.pieces[run.pieces.length - 1].end;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  for (const x of s.balusters) {
    const t = ((x.position.x - a.x) * (b.x - a.x) + (x.position.y - a.y) * (b.y - a.y)) / (len * len);
    const off = Math.abs((x.position.x - a.x) * (b.y - a.y) - (x.position.y - a.y) * (b.x - a.x)) / len;
    assert.ok(!(t > 0.02 && t < 0.98 && off < 30), 'a baluster under the bare run');
  }
});

test('regression (user, 2026-10-20): past a moved end, a WALL handrail — on brackets, no posts, no balusters, off the wall by the clearance; priced', () => {
  const plain = stair();
  const total = plain.postSpots.find((x) => x.kind === 'end').s;
  const cut = total - 1200;
  const s = stair(edits({ moved: { end: cut }, wallRail: { end: true } }));
  const wall = s.runs.find((r) => r.wallRail);
  assert.ok(wall, 'a wall rail run');
  assert.equal(wall.startPostId, null);
  assert.equal(wall.endPostId, null);
  assert.ok(wall.brackets.length >= 2, `${wall.brackets.length} brackets`);
  const length = wall.pieces.reduce((sum, p) => sum + planLen(p), 0);
  assert.ok(Math.abs(length - 1200) < 5, `the wall rail runs from the post to the path's end (${length.toFixed(0)})`);
  // no post past the moved end, no baluster along the wall rail
  assert.ok(!s.postSpots.some((x) => x.s > cut + 1));
  const nearRun = (p, run) =>
    run.pieces.some((piece) => {
      const dx = piece.end.x - piece.start.x;
      const dy = piece.end.y - piece.start.y;
      const l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p.x - piece.start.x) * dx + (p.y - piece.start.y) * dy) / l2));
      return Math.hypot(p.x - piece.start.x - dx * t, p.y - piece.start.y - dy * t) < 100;
    });
  assert.ok(!s.balusters.some((b) => nearRun(b.position, wall)));
  // the wall rail's axis: clearance + half the handrail width off the wall (the outer line, no gap) — its brackets reach that far
  const cfg = createDefaultConfig();
  for (const b of wall.brackets) assert.ok(Math.abs(b.reachMm - (50 + cfg.railingHandrailWidthMm / 2)) < 1e-6);
  // takeoff: the wall rail as handrail, its brackets as a fitting
  const items = buildRailingItems({ enabled: true, sections: [s] }, { ...createDefaultConfig() });
  assert.ok(items.some((i) => i.materialId === 'railing-wall-bracket' && i.quantity === wall.brackets.length));
  assert.ok(items.filter((i) => i.materialId === 'railing-handrail').length > posted(s).length);
});

test('the wall rail reaches the 3D scene (brackets mesh)', () => {
  const plain = buildStaircase(baseConfig());
  const total = plain.railingModel.sections[0].postSpots.find((x) => x.kind === 'end').s;
  const b = buildStaircase(baseConfig(edits({ moved: { end: total - 1500 }, wallRail: { end: true } })));
  let found = false;
  b.root.traverse((o) => {
    if (o.name === 'Railing_s_wallBrackets') found = true;
  });
  assert.ok(found, 'the brackets are drawn');
});
