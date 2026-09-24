import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { buildPostModels, sanitizePostOverrides } from '../postSolver.js';
import { buildRailingModel, sanitizeRailingSections, editRailingSections, RAILING_STEEP_ANGLE_DEG, RAILING_CORNER_ANGLE_DEG } from '../railingSolver.js';

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

// --- turns and landings (stage 2) ------------------------------------------------------------------------

function turn(kind, side, extra = {}) {
  return stair({
    stairType: 'L',
    turn1Type: kind,
    treadsLegA: 4,
    treadsLegB: 4,
    windersPerTurn: 4,
    totalRise: 2600,
    railingSections: whole(side),
    ...extra,
  });
}

const slopeDeg = (piece) => (Math.atan2(Math.abs(piece.end.z - piece.start.z), Math.hypot(piece.end.x - piece.start.x, piece.end.y - piece.start.y)) * 180) / Math.PI;
const planAngleDeg = (a, b) => {
  const da = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const db = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const cos = (da.x * db.x + da.y * db.y) / (Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
};

for (const kind of ['landing', 'winder']) {
  for (const side of ['outer', 'inner']) {
    for (const wanga of [cut, closed]) {
      const label = `${kind} / ${side} / ${wanga === cut ? 'cut' : 'closed'}`;
      test(`L stair (${label}): every handrail piece is a real handrail, every run turns only slightly, balusters have a positive height and clear the posts`, () => {
        const { config, model } = turn(kind, side, wanga);
        const section = model.sections[0];
        assert.ok(section.valid);
        assert.ok(section.runs.length >= 1);
        for (const piece of section.handrail.pieces) assert.ok(slopeDeg(piece) <= RAILING_STEEP_ANGLE_DEG + 1e-6, `piece slope ${slopeDeg(piece)}`);
        for (const run of section.runs) {
          for (let i = 0; i < run.pieces.length - 1; i++) assert.ok(planAngleDeg(run.pieces[i], run.pieces[i + 1]) <= RAILING_CORNER_ANGLE_DEG + 1e-6, 'a corner must end the run in a post');
        }
        assert.ok(section.balusters.length > 0);
        for (const b of section.balusters) assert.ok(b.heightMm > 0 && b.zTop > b.zBottom);
        // no baluster stands inside one of this section's own posts
        for (const post of section.posts.filter((p) => !p.removed)) {
          for (const b of section.balusters) {
            const d = Math.hypot(b.position.x - post.position.x, b.position.y - post.position.y);
            assert.ok(d >= post.size / 2 + config.railingBalusterSizeMm / 2 - 1e-6, `baluster ${b.id} inside post ${post.postId}`);
          }
        }
      });
    }
  }
}

test('L stair with a landing (outer): a corner post at the turn, the handrail LEVEL across the landing, then a step up to the next flight', () => {
  const { config, model } = turn('landing', 'outer', cut);
  const section = model.sections[0];
  assert.ok(section.posts.some((p) => p.postId.includes('-join-')), 'a post at the corner');
  const level = section.handrail.pieces.filter((p) => Math.abs(p.end.z - p.start.z) < 1e-6 && Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y) > 500);
  assert.ok(level.length >= 1, 'a level piece across the landing');
  assert.ok(section.runs.length >= 2);
  const first = section.runs[0].pieces;
  const second = section.runs[section.runs.length - 1].pieces;
  const endOfFirst = first[first.length - 1].end.z;
  const startOfLast = second[0].start.z;
  assert.ok(startOfLast - endOfFirst >= config.riserHeight - 1e-6, 'the next flight starts at least one riser higher than the landing handrail');
  const landingTop = 5 * config.riserHeight;
  const onLanding = section.balusters.filter((b) => Math.abs(b.zBottom - landingTop) < 1e-6);
  assert.ok(onLanding.length > 0, 'balusters stand on the landing');
  for (const b of onLanding) assert.ok(Math.abs(b.zTop - (landingTop + config.railingHeightMm - config.railingHandrailHeightMm)) < 1e-6, 'the same height all over the level landing');
});

test('L stair with winders (outer): one corner post where the outer edge turns, the handrail meets it from both sides at the same height', () => {
  const { model } = turn('winder', 'outer', cut);
  const section = model.sections[0];
  assert.ok(section.runs.length >= 2);
  for (let j = 0; j < section.runs.length - 1; j++) {
    const before = section.runs[j].pieces[section.runs[j].pieces.length - 1].end;
    const after = section.runs[j + 1].pieces[0].start;
    assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 200, 'the two runs meet at one post');
  }
});

test('L stair with winders (inner / dusza): the handrail follows the winders as straight pieces — a steep rail, but continuous, never a gap', () => {
  for (const windersPerTurn of [3, 4, 5]) {
    const { model } = turn('winder', 'inner', { ...cut, windersPerTurn });
    const section = model.sections[0];
    assert.deepEqual(section.uncoveredSteps, [], `${windersPerTurn} winders`);
    const planLength = (pts) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    const railed = section.handrail.pieces.reduce((sum, p) => sum + Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y), 0);
    assert.ok(railed >= 0.95 * planLength(section.path), `${windersPerTurn} winders: the rail covers the whole path`);
    for (const piece of section.handrail.pieces) assert.ok(slopeDeg(piece) <= RAILING_STEEP_ANGLE_DEG + 1e-6);
  }
});

test('the default winder turn on the inner side reuses the structural corner post instead of adding a second one next to it', () => {
  const { model, planLayout } = turn('winder', 'inner', cut);
  const section = model.sections[0];
  assert.equal(section.posts.filter((p) => p.postId.includes('-join-')).length, 0, 'a join at the inner corner falls into the existing post');
  assert.ok(planLayout.turns.length > 0);
});

test('housed wanga on a turn: within each run the balusters are evenly spread and every clear opening stays within the limit', () => {
  const { config, model } = turn('landing', 'outer', closed);
  const section = model.sections[0];
  let checkedRuns = 0;
  for (const run of section.runs) {
    const pts = [run.pieces[0].start, ...run.pieces.map((p) => p.end)];
    const onRun = section.balusters.filter((b) => {
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const c = pts[i + 1];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.min(1, Math.max(0, ((b.position.x - a.x) * dx + (b.position.y - a.y) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(b.position.x - (a.x + dx * t), b.position.y - (a.y + dy * t)));
      }
      return best < 1;
    });
    if (onRun.length < 2) continue;
    checkedRuns++;
    const along = (b) => Math.hypot(b.position.x - pts[0].x, b.position.y - pts[0].y);
    const sorted = onRun.map(along).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] - config.railingBalusterSizeMm <= config.railingMaxClearMm + 1e-3, 'clear opening within the limit');
  }
  assert.ok(checkedRuns >= 2, 'at least two runs actually carried enough balusters to check');
});

// --- the dusza side of a winder (reported: a section on the inner side from step 6/7 to 12 only got a rail on the straight steps)

test('never a baluster under a missing handrail: whatever the winder, side and wanga, balusters only stand on treads that carry a rail', () => {
  for (const wanga of [cut, closed]) {
    for (const side of ['outer', 'inner']) {
      for (const windersPerTurn of [2, 3, 4, 5, 6]) {
        const { model } = stair({ ...wanga, stairType: 'L', treadsLegA: 5, treadsLegB: 5, windersPerTurn, totalRise: 2800, railingSections: [{ id: 's', side, fromStep: 3, toStep: 9 }] });
        const section = model.sections[0];
        assert.ok(section.valid);
        for (const b of section.balusters) assert.ok(b.treadIndex === null || !section.uncoveredSteps.includes(b.treadIndex));
        const finding = section.diagnostics.find((d) => d.ruleId === 'RAILING-UNCOVERED-STEPS');
        assert.equal(!!finding, section.uncoveredSteps.length > 0, 'uncovered steps are always reported');
        if (finding) assert.ok(section.uncoveredSteps.every((i) => finding.message.includes(String(i + 1))));
      }
    }
  }
});

test('outer side across winders has no uncovered steps', () => {
  const { model } = stair({ ...cut, stairType: 'L', treadsLegA: 5, treadsLegB: 5, windersPerTurn: 5, totalRise: 2800, railingSections: [{ id: 's', side: 'outer', fromStep: 6, toStep: 11 }] });
  assert.deepEqual(model.sections[0].uncoveredSteps, []);
});

// --- section edits from the plan 2D (Inspektor buttons)

test('editRailingSections: from / to move an end (the other follows if they would cross), to-end, remove, new; unknown ids change nothing', () => {
  const base = [{ id: 'a', side: 'outer', fromStep: 2, toStep: 6 }];
  assert.deepEqual(editRailingSections(base, { action: 'from', sectionId: 'a', stepIndex: 4 })[0], { id: 'a', side: 'outer', fromStep: 4, toStep: 6 });
  assert.deepEqual(editRailingSections(base, { action: 'from', sectionId: 'a', stepIndex: 8 })[0], { id: 'a', side: 'outer', fromStep: 8, toStep: 8 });
  assert.deepEqual(editRailingSections(base, { action: 'to', sectionId: 'a', stepIndex: 9 })[0], { id: 'a', side: 'outer', fromStep: 2, toStep: 9 });
  assert.deepEqual(editRailingSections(base, { action: 'to', sectionId: 'a', stepIndex: 1 })[0], { id: 'a', side: 'outer', fromStep: 1, toStep: 1 });
  assert.equal(editRailingSections(base, { action: 'to-end', sectionId: 'a' })[0].toStep, null);
  assert.deepEqual(editRailingSections(base, { action: 'remove', sectionId: 'a' }), []);
  assert.deepEqual(editRailingSections(base, { action: 'from', sectionId: 'nope', stepIndex: 5 }), base);
  const added = editRailingSections(base, { action: 'new', side: 'inner', stepIndex: 3 });
  assert.equal(added.length, 2);
  assert.deepEqual({ ...added[1], id: 'x' }, { id: 'x', side: 'inner', fromStep: 3, toStep: null });
  assert.notEqual(added[1].id, 'a');
  assert.deepEqual(base, [{ id: 'a', side: 'outer', fromStep: 2, toStep: 6 }], 'the input list is not mutated');
  assert.equal(sanitizeRailingSections(added).length, 2, 'the result is a valid section list');
});
