import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildPostModels, buildAllPostModels, sanitizePostOverrides, MIN_POST_HEIGHT_MM } from '../postSolver.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildRiserModels } from '../riserSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { buildProjectPayload, parseProjectJSON } from '../../project/projectIO.js';

function layout(patch = {}) {
  const config = { ...createDefaultConfig(), stairType: 'L', ...patch };
  const derived = deriveStairData(config);
  const full = { ...config, riserHeight: derived.riserHeight };
  return { config: full, derived, planLayout: buildPlanLayout(full) };
}

test('no overrides: every post exists, nothing is flagged, nominal == final', () => {
  const { config, planLayout } = layout();
  const all = buildAllPostModels(planLayout, config);
  assert.ok(all.length >= 3);
  for (const p of all) {
    assert.equal(p.removed, false);
    assert.equal(p.overridden, false);
    assert.deepEqual(p.elevation, p.nominalElevation);
  }
  assert.equal(buildPostModels(planLayout, config).length, all.length);
});

test('lengthen a post at the top and at the bottom: the elevation follows, the nominal one is kept', () => {
  const { config, planLayout } = layout();
  const nominal = buildAllPostModels(planLayout, config).find((p) => p.postId === 'post-start');
  const edited = buildAllPostModels(planLayout, { ...config, manualPostOverrides: { 'post-start': { topDeltaMm: 150, bottomDeltaMm: 40 } } }).find((p) => p.postId === 'post-start');
  assert.equal(edited.elevation.top, nominal.elevation.top + 150);
  assert.equal(edited.elevation.bottom, nominal.elevation.bottom - 40);
  assert.deepEqual(edited.nominalElevation, nominal.elevation);
  assert.equal(edited.overridden, true);
});

test('shorten a post: negative deltas; other posts are untouched', () => {
  const { config, planLayout } = layout();
  const all = buildAllPostModels(planLayout, { ...config, manualPostOverrides: { 'post-end': { topDeltaMm: -300 } } });
  const end = all.find((p) => p.postId === 'post-end');
  assert.equal(end.elevation.top, end.nominalElevation.top - 300);
  for (const p of all.filter((x) => x.postId !== 'post-end')) assert.equal(p.overridden, false);
});

test('a post shortened below the minimum height is left as it was and flagged, never made absurd', () => {
  const { config, planLayout } = layout();
  const p = buildAllPostModels(planLayout, { ...config, manualPostOverrides: { 'post-start': { topDeltaMm: -950 } } }).find((x) => x.postId === 'post-start');
  assert.equal(p.overridden, false);
  assert.equal(p.overrideRejected, true);
  assert.deepEqual(p.elevation, p.nominalElevation);
  assert.ok(MIN_POST_HEIGHT_MM > 0);
});

test('removing a post: gone from buildPostModels (3D, takeoff), still listed by buildAllPostModels (flagged) so it can be restored', () => {
  const { config, planLayout } = layout();
  const withRemoved = { ...config, manualPostOverrides: { 'post-start': { removed: true } } };
  assert.ok(!buildPostModels(planLayout, withRemoved).some((p) => p.postId === 'post-start'));
  const flagged = buildAllPostModels(planLayout, withRemoved).find((p) => p.postId === 'post-start');
  assert.equal(flagged.removed, true);
  assert.equal(buildPostModels(planLayout, withRemoved).length, buildPostModels(planLayout, config).length - 1);
});

function postItems(patch) {
  const { config, derived, planLayout } = layout(patch);
  const stringerModels = buildStringerModelsForFlight(planLayout, config);
  // the quantities layer directly: the validation gate can block a default L stair (ceiling opening), which is not what is under test
  return computeMaterialTakeoff(
    {
      fullConfig: config,
      derived,
      planLayout,
      treadModels: buildTreadModels(planLayout, config),
      riserModels: buildRiserModels(planLayout, config),
      stringerModels,
      stringerConstruction: { outer: buildStringerConstructionGeometry(stringerModels.outer, config), inner: buildStringerConstructionGeometry(stringerModels.inner, config) },
      postModels: buildPostModels(planLayout, config),
    },
    config
  ).filter((i) => i.elementType === 'POST');
}

test('takeoff: a removed post is not counted and a lengthened post is taken off at its new length', () => {
  const base = postItems({});
  assert.ok(base.length >= 3, 'the takeoff scenario must have posts (it can be BLOCKED by validation otherwise)');
  const removed = postItems({ manualPostOverrides: { 'post-start': { removed: true } } });
  assert.equal(removed.length, base.length - 1);
  const longer = postItems({ manualPostOverrides: { 'post-end': { topDeltaMm: 200 } } });
  const before = base.find((i) => i.sourceElementId === 'post:post-end').calculatedDimensions.heightMm;
  const after = longer.find((i) => i.sourceElementId === 'post:post-end').calculatedDimensions.heightMm;
  assert.equal(after, before + 200);
});

test('sanitizePostOverrides drops garbage and empty entries', () => {
  assert.deepEqual(sanitizePostOverrides({ a: { topDeltaMm: 'x', removed: 'yes' }, b: { topDeltaMm: 0 }, c: null, d: { removed: true, bottomDeltaMm: -20 } }), { d: { removed: true, bottomDeltaMm: -20 } });
  assert.deepEqual(sanitizePostOverrides(undefined), {});
});

test('project file: post overrides round-trip at the top level, outside config; an older file without them loads with none', () => {
  const overrides = { 'post-start': { topDeltaMm: 100 }, 'post-corner-0': { removed: true } };
  const payload = buildProjectPayload({ ...createDefaultConfig(), manualPostOverrides: overrides });
  assert.equal(payload.config.manualPostOverrides, undefined);
  assert.deepEqual(payload.postOverrides, overrides);
  assert.deepEqual(parseProjectJSON(JSON.stringify(payload)).manualPostOverrides, overrides);
  const bare = buildProjectPayload(createDefaultConfig());
  assert.equal(bare.postOverrides, undefined);
  assert.deepEqual(parseProjectJSON(JSON.stringify(bare)).manualPostOverrides, {});
});

// Removing a corner post means the inner wanga is no longer interrupted there: that turn's two
// boards meet on a lap joint (one continuous profile), exactly like with no corner posts at all —
// and only THAT turn changes.
test('removing a corner post turns that turn\'s inner joint into a lap joint; other turns and the outer side keep theirs', () => {
  const patch = { turn1Type: 'winder', turn2Type: 'winder', stairType: 'U', hasCornerPost: true, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };
  const base = layout(patch);
  const jointsOf = (l, side) => buildStringerModelsForFlight(l.planLayout, l.config)[side].segmentJoints.map((j) => j.type);

  const innerBase = jointsOf(base, 'inner');
  assert.ok(innerBase.length >= 2, 'a U stair has at least two inner joints');
  assert.ok(innerBase.every((t) => t === 'corner-post'), `expected only corner posts, got ${innerBase}`);

  const removed = layout({ ...patch, manualPostOverrides: { 'post-corner-0': { removed: true } } });
  const innerRemoved = jointsOf(removed, 'inner');
  assert.equal(innerRemoved.filter((t) => t === 'lap-joint').length, 1, `only the removed post's turn changes: ${innerRemoved}`);
  assert.equal(innerRemoved.length, innerBase.length);
  assert.deepEqual(jointsOf(removed, 'outer'), jointsOf(base, 'outer'));

  const model = buildStringerModelsForFlight(removed.planLayout, removed.config).inner;
  assert.equal(model.intermediateSupports.length, innerBase.length - 1, 'the removed post is no longer an intermediate support');
  // the lap-jointed pair now gets the overlap extension a post-less corner has
  const [g0] = buildStringerConstructionGeometry(model, removed.config);
  const [h0] = buildStringerConstructionGeometry(buildStringerModelsForFlight(base.planLayout, base.config).inner, base.config);
  assert.ok(g0.ends.end.u > h0.ends.end.u, 'first board runs on into the joint once its post is gone');
});

test('a flight starting or ending straight away with winders (0 straight treads) has ONE post at that corner, not two', () => {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1;
  for (const patch of [{ treadsLegA: 0 }, { treadsLegB: 0 }, { stairType: 'U', treadsLegA: 0, treadsLegC: 0 }]) {
    const { config, planLayout } = layout(patch);
    const posts = buildPostModels(planLayout, config);
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        assert.ok(!near(posts[i].position, posts[j].position), `${JSON.stringify(patch)}: ${posts[i].postId} and ${posts[j].postId} stand in the same place`);
      }
    }
    assert.ok(posts.some((p) => p.kind === 'corner'), 'the full-height corner post stays');
  }
  // an ordinary stair keeps its start and end post
  const ordinary = buildPostModels(layout().planLayout, layout().config).map((p) => p.postId);
  assert.ok(ordinary.includes('post-start') && ordinary.includes('post-end'));
});

test('a flight starting with winders: removing the corner post brings the start post back, so the spot is never empty', () => {
  const { config, planLayout } = layout({ treadsLegA: 0, manualPostOverrides: { 'post-corner-0': { removed: true } } });
  const ids = buildPostModels(planLayout, config).map((p) => p.postId);
  assert.ok(!ids.includes('post-corner-0'));
  assert.ok(ids.includes('post-start'));
});
