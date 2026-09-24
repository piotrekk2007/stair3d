import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { buildPostModels, sanitizePostOverrides } from '../postSolver.js';
import { buildRailingModel, sanitizeRailingSections } from '../railingSolver.js';

function stair(patch = {}) {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 10, totalRise: 2000, treadGoing: 280, railingEnabled: true, ...patch };
  const full = { ...config, riserHeight: deriveStairData(config).riserHeight };
  const planLayout = buildPlanLayout(full);
  const treadModels = buildTreadModels(planLayout, full);
  const stringerModels = buildStringerModelsForFlight(planLayout, full);
  const stringerConstruction = { outer: buildStringerConstructionGeometry(stringerModels.outer, full), inner: buildStringerConstructionGeometry(stringerModels.inner, full) };
  const postModels = buildPostModels(planLayout, full);
  const model = buildRailingModel({ planLayout, treadModels, stringerModels, stringerConstruction, postModels }, full);
  return { config: full, model, planLayout };
}

const cut = { stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };
const closed = { stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' };
const whole = (side, id = 's') => [{ id, side, fromStep: 0, toStep: null }];

test('disabled or without sections: nothing is built', () => {
  assert.equal(stair({ railingEnabled: false, railingSections: whole('outer') }).model.sections.length, 0);
  assert.equal(stair({ railingSections: [] }).model.sections.length, 0);
});

test('sanitizeRailingSections drops garbage and keeps ids unique', () => {
  const out = sanitizeRailingSections([
    { id: 'a', side: 'outer', fromStep: 1, toStep: 4 },
    { id: 'a', side: 'inner', fromStep: 0, toStep: null },
    { side: 'left', fromStep: 0, toStep: 1 },
    { side: 'outer', fromStep: -1, toStep: 1 },
    { side: 'outer', fromStep: 1.5, toStep: 3 },
    null,
  ]);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id);
  assert.equal(out[1].toStep, null);
  assert.deepEqual(sanitizeRailingSections('nope'), []);
});

test('an invalid range is skipped with a warning, never guessed', () => {
  const { model } = stair({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 5, toStep: 2 }, { id: 'far', side: 'outer', fromStep: 0, toStep: 99 }] });
  assert.equal(model.sections.length, 2);
  assert.ok(model.sections.every((s) => !s.valid && s.balusters.length === 0));
  assert.equal(model.diagnostics.filter((d) => d.ruleId === 'RAILING-SECTION-INVALID').length, 2);
});

test('straight flight: the handrail is ONE straight piece rising with the nosing line, its top railingHeightMm above it', () => {
  const { config, model } = stair({ ...cut, railingSections: whole('outer') });
  const [section] = model.sections;
  assert.ok(section.valid);
  assert.equal(section.handrail.pieces.length, 1);
  const { start, end } = section.handrail.pieces[0];
  const half = config.railingHandrailHeightMm / 2;
  assert.ok(Math.abs(start.z + half - (config.riserHeight + config.railingHeightMm)) < 1e-6);
  assert.ok(Math.abs(end.z + half - (11 * config.riserHeight + config.railingHeightMm)) < 1e-6);
});

test('a section can start at a later step and end early: only that stretch is covered', () => {
  const { config, model } = stair({ ...cut, railingSections: [{ id: 's', side: 'outer', fromStep: 2, toStep: 5 }] });
  const [section] = model.sections;
  assert.equal(section.fromStep, 2);
  const half = config.railingHandrailHeightMm / 2;
  assert.ok(Math.abs(section.handrail.pieces[0].start.z + half - (3 * config.riserHeight + config.railingHeightMm)) < 1e-6);
  assert.ok(section.balusters.length > 0);
  assert.ok(section.balusters.every((b) => b.treadIndex >= 2 && b.treadIndex <= 5));
});

test('the two sides are independent sections', () => {
  const { model } = stair({ ...cut, railingSections: [{ id: 'o', side: 'outer', fromStep: 0, toStep: 3 }, { id: 'i', side: 'inner', fromStep: 4, toStep: null }] });
  assert.equal(model.sections.length, 2);
  assert.ok(model.sections.every((s) => s.valid));
  assert.notEqual(model.sections[0].handrail.pieces[0].start.x, model.sections[1].handrail.pieces[0].start.x, 'opposite sides of the stair');
});

test('overlay wanga: the same rhythm on every tread, clear opening within the limit, balusters stand on the tread', () => {
  const { config, model } = stair({ ...cut, railingSections: whole('outer') });
  const bs = model.sections[0].balusters;
  const perTread = new Map();
  for (const b of bs) perTread.set(b.treadIndex, (perTread.get(b.treadIndex) || 0) + 1);
  assert.equal(new Set(perTread.values()).size, 1, 'k is identical on every straight tread');
  const k = [...perTread.values()][0];
  const first = bs.filter((b) => b.treadIndex === 0);
  const second = bs.filter((b) => b.treadIndex === 1);
  const centreDistance = Math.hypot(second[0].position.x - first[0].position.x, second[0].position.y - first[0].position.y);
  assert.ok(centreDistance / k - config.railingBalusterSizeMm <= config.railingMaxClearMm + 1e-6, 'clear opening within the limit');
  for (const b of bs) {
    assert.ok(Math.abs(b.zBottom - (b.treadIndex + 1) * config.riserHeight) < 1e-6, 'stands on the tread top');
    assert.ok(b.heightMm > 0);
  }
  assert.ok(second[0].zBottom > first[0].zBottom && Math.abs(second[0].heightMm - first[0].heightMm) < 1e-6, 'same height pattern one tread up');
});

test('housed wanga: evenly spread along the handrail, every clear opening within the limit, all about the same height', () => {
  const { config, model } = stair({ ...closed, railingSections: whole('outer') });
  const [section] = model.sections;
  const bs = section.balusters;
  assert.ok(bs.length > 3);
  const start = section.handrail.pieces[0].start;
  const end = section.handrail.pieces[0].end;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const along = bs.map((b) => dist(start, b.position));
  const steps = along.slice(1).map((v, i) => v - along[i]);
  for (const d of steps) assert.ok(Math.abs(d - steps[0]) < 1e-6, 'even spacing');
  assert.ok(steps[0] - config.railingBalusterSizeMm <= config.railingMaxClearMm + 1e-6);
  const postHalf = section.posts[0].size / 2;
  assert.ok(Math.abs(along[0] - config.railingBalusterSizeMm / 2 - postHalf - (steps[0] - config.railingBalusterSizeMm)) < 1e-6, 'the gap to the start post equals the gap between balusters');
  assert.ok(along[0] - config.railingBalusterSizeMm / 2 - postHalf <= config.railingMaxClearMm + 1e-6, 'gap to the start post');
  assert.ok(dist(start, end) - along[along.length - 1] - config.railingBalusterSizeMm / 2 - postHalf <= config.railingMaxClearMm + 1e-6, 'gap to the end post');
  for (const b of bs) assert.ok(b.heightMm > 0 && b.zBottom > 0);
  const heights = bs.map((b) => b.heightMm);
  assert.ok(Math.max(...heights) - Math.min(...heights) < 5, 'parallel to the pitch line');
});

test('end posts: an outer-side section adds posts at both ends; the start/end newels on the inner side are reused', () => {
  const outer = stair({ ...cut, railingSections: whole('outer') });
  assert.equal(outer.model.sections[0].posts.length, 2);
  assert.ok(outer.model.sections[0].posts.every((p) => p.kind === 'railing' && p.elevation.top > p.elevation.bottom));
  const inner = stair({ ...cut, railingSections: whole('inner') });
  assert.ok(inner.model.sections[0].posts.length < 2);
});

test('handrail length and baluster count are exposed for the takeoff', () => {
  const { model } = stair({ ...cut, railingSections: whole('outer') });
  const s = model.sections[0];
  assert.ok(s.handrail.totalLengthMm > 2000);
  assert.ok(s.balusters.length > 10);
});

test('new end posts take the configured thickness and rise railingPostTopAboveHandrailMm above the handrail top', () => {
  const { config, model } = stair({ ...cut, railingSections: whole('outer'), railingPostSizeMm: 100, railingPostTopAboveHandrailMm: 60 });
  const [start, end] = model.sections[0].posts;
  assert.equal(start.size, 100);
  const startZ = config.riserHeight; // nosing line at the front of tread 0
  assert.ok(Math.abs(start.elevation.top - (startZ + config.railingHeightMm + 60)) < 1e-6);
  assert.ok(Math.abs(end.elevation.top - (11 * config.riserHeight + config.railingHeightMm + 60)) < 1e-6);
});

test('per-post edits: thickness and length of a railing post, and removing it; the balusters follow the real post width', () => {
  const id = 'railing-post-s-start';
  const base = stair({ ...closed, railingSections: whole('outer') }).model.sections[0];
  const edited = stair({ ...closed, railingSections: whole('outer'), manualPostOverrides: { [id]: { sizeMm: 140, topDeltaMm: 50, bottomDeltaMm: -20 } } }).model.sections[0];
  const b = base.posts.find((p) => p.postId === id);
  const e = edited.posts.find((p) => p.postId === id);
  assert.equal(e.size, 140);
  assert.equal(e.nominalSize, b.size);
  assert.ok(Math.abs(e.elevation.top - (b.elevation.top + 50)) < 1e-6);
  assert.ok(Math.abs(e.elevation.bottom - (b.elevation.bottom + 20)) < 1e-6);
  assert.equal(e.overridden, true);
  const firstGap = (section) => Math.hypot(section.balusters[0].position.x - section.handrail.pieces[0].start.x, section.balusters[0].position.y - section.handrail.pieces[0].start.y);
  assert.ok(firstGap(edited) > firstGap(base), 'a fatter post pushes the first baluster away from the end');

  const removed = stair({ ...closed, railingSections: whole('outer'), manualPostOverrides: { [id]: { removed: true } } }).model.sections[0];
  assert.equal(removed.posts.find((p) => p.postId === id).removed, true);
  assert.ok(firstGap(removed) < firstGap(base), 'no post at that end: the first baluster comes closer');
});

test('the thickness override is sanitised to a sane range', () => {
  assert.deepEqual(sanitizePostOverrides({ a: { sizeMm: 10 }, b: { sizeMm: 500 }, c: { sizeMm: 80 } }), { c: { sizeMm: 80 } });
});
