import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { buildPostModels } from '../postSolver.js';
import { buildRailingModel, applyRailingPostEdit, sanitizeRailingPostEdits } from '../railingSolver.js';

function stair(patch = {}) {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 10, totalRise: 2000, treadGoing: 280, railingEnabled: true, railingSections: [{ id: 's', side: 'outer', fromStep: 0, toStep: null }], ...patch };
  const full = { ...config, riserHeight: deriveStairData(config).riserHeight };
  const planLayout = buildPlanLayout(full);
  const treadModels = buildTreadModels(planLayout, full);
  const stringerModels = buildStringerModelsForFlight(planLayout, full);
  const stringerConstruction = { outer: buildStringerConstructionGeometry(stringerModels.outer, full), inner: buildStringerConstructionGeometry(stringerModels.inner, full) };
  const postModels = buildPostModels(planLayout, full);
  return buildRailingModel({ planLayout, treadModels, stringerModels, stringerConstruction, postModels }, full).sections[0];
}
const L = (patch = {}) => stair({ stairType: 'L', turn1Type: 'landing', treadsLegA: 4, treadsLegB: 4, totalRise: 2600, ...patch });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('edits: add / move / remove / suppress / restore are pure and clean', () => {
  let e = applyRailingPostEdit({}, { action: 'add', sectionId: 's', s: 1200.04 });
  e = applyRailingPostEdit(e, { action: 'add', sectionId: 's', s: 500 });
  assert.deepEqual(e.s.added, [{ id: 'm2', s: 500 }, { id: 'm1', s: 1200 }]);
  e = applyRailingPostEdit(e, { action: 'move', sectionId: 's', id: 'm1', s: 1500 });
  e = applyRailingPostEdit(e, { action: 'remove', sectionId: 's', id: 'm2' });
  e = applyRailingPostEdit(e, { action: 'suppress', sectionId: 's', s: 900 });
  e = applyRailingPostEdit(e, { action: 'suppress', sectionId: 's', s: 920 }); // the same corner
  assert.deepEqual(e.s, { added: [{ id: 'm1', s: 1500 }], suppressed: [900] });
  e = applyRailingPostEdit(e, { action: 'restore', sectionId: 's', s: 905 });
  e = applyRailingPostEdit(e, { action: 'remove', sectionId: 's', id: 'm1' });
  assert.deepEqual(e, {});
  assert.deepEqual(sanitizeRailingPostEdits({ s: { added: [{ id: 'x', s: -1 }, { s: 3 }, 'junk'], suppressed: ['a', NaN] } }), {});
});

test('a hand-placed post cuts the handrail where it stands; the automatic posts keep their ids', () => {
  const plain = stair();
  const path = plain.path;
  const total = path.slice(1).reduce((acc, p, i) => acc + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
  const s = Math.round(total / 2);
  const edited = stair({ railingPostEdits: { s: { added: [{ id: 'm1', s }], suppressed: [] } } });
  assert.equal(edited.runs.length, plain.runs.length + 1);
  const post = edited.posts.find((p) => p.postId === 'railing-post-s-m-m1');
  assert.ok(post, 'the post exists with its stable id');
  assert.equal(post.manual, true);
  // it stands on the path at s from the start
  const spot = edited.postSpots.find((x) => x.postId === post.postId);
  assert.equal(spot.kind, 'manual');
  assert.equal(spot.s, s);
  // the handrail pieces meet at its faces: one run ends there, the next starts there
  const r0 = edited.runs.find((r) => r.endPostId === post.postId);
  const r1 = edited.runs.find((r) => r.startPostId === post.postId);
  assert.ok(r0 && r1);
  // the automatic ends keep their ids
  assert.deepEqual(edited.postSpots.filter((x) => x.kind !== 'manual').map((x) => x.spotId), plain.postSpots.map((x) => x.spotId));
  // the per-post edits apply to it (size)
  const sized = stair({ railingPostEdits: { s: { added: [{ id: 'm1', s }] } }, manualPostOverrides: { 'railing-post-s-m-m1': { sizeMm: 70 } } });
  assert.equal(sized.posts.find((p) => p.postId === 'railing-post-s-m-m1').size, 70);
});

test('a hand-placed post too close to an end, or off the handrail, is skipped and reported', () => {
  const r = stair({ railingPostEdits: { s: { added: [{ id: 'm1', s: 30 }, { id: 'm2', s: 99999 }] } } });
  assert.equal(r.posts.filter((p) => p.manual).length, 0);
  assert.ok(r.diagnostics.some((d) => d.ruleId === 'RAILING-POST-MANUAL-SKIPPED'));
});

test('an automatic CORNER post switched off joins the two runs into one with a mitred corner; a step post cannot be', () => {
  const plain = L();
  const corner = plain.postSpots.find((x) => x.kind === 'corner');
  assert.ok(corner, 'the L has a corner post');
  assert.equal(corner.suppressible, true);
  const off = L({ railingPostEdits: { s: { suppressed: [corner.s] } } });
  assert.equal(off.runs.length, plain.runs.length - 1);
  assert.ok(!off.postSpots.some((x) => near(x.s, corner.s, 1) && x.kind === 'corner'));
  assert.equal(off.suppressedCorners.length, 1);
  // a step join stays (its handrail must end in a post)
  for (const step of plain.postSpots.filter((x) => x.kind === 'step')) {
    const r = L({ railingPostEdits: { s: { suppressed: [step.s] } } });
    assert.ok(r.postSpots.some((x) => x.kind === 'step' && near(x.s, step.s, 1)));
  }
  // with glass between posts the corner post is required
  const glass = L({ railingInfill: 'glass-posts', railingPostEdits: { s: { suppressed: [corner.s] } } });
  assert.ok(glass.postSpots.every((x) => !x.suppressible));
});

test('plan "▮ Słupki" layer: a click target per section, a handle per post spot (manual orange), a ghost per switched-off corner', async () => {
  const { railingPostEditXML } = await import('../../plan2d/plan2dRenderer.js');
  const plain = L();
  const corner = plain.postSpots.find((x) => x.kind === 'corner');
  const s = L({ railingPostEdits: { s: { added: [{ id: 'm1', s: 500 }], suppressed: [corner.s] } } });
  const xml = railingPostEditXML({ enabled: true, sections: [s] });
  assert.equal((xml.match(/class="railing-path-hit"/g) || []).length, 1);
  assert.equal((xml.match(/class="railing-post-handle/g) || []).length, s.postSpots.length);
  assert.equal((xml.match(/class="railing-post-handle manual"/g) || []).length, 1);
  assert.equal((xml.match(/class="railing-post-ghost"/g) || []).length, 1);
  assert.equal(railingPostEditXML({ enabled: false, sections: [] }), '');
});
