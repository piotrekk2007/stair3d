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
  // the nosing line above plan position y (the flight runs along +y from the first front edge): one riser at the
  // first nosing, one more per going
  const nosingZ = (pt) => config.riserHeight * (1 + pt.y / config.treadGoing);
  assert.ok(Math.abs(start.z + half - (nosingZ(start) + config.railingHeightMm)) < 1e-6);
  assert.ok(Math.abs(end.z + half - (nosingZ(end) + config.railingHeightMm)) < 1e-6);
  // ...and it is a piece BETWEEN the two posts: each end on the face of its post, never through it or short of it
  const [first, last] = [section.posts[0], section.posts[section.posts.length - 1]];
  assert.ok(Math.abs(start.y - (first.position.y + first.size / 2)) < 1e-6, 'starts on the face of the start post');
  assert.ok(Math.abs(end.y - (last.position.y - last.size / 2)) < 1e-6, 'ends on the face of the end post');
  assert.ok(section.runs[0].startAtPostFace && section.runs[0].endAtPostFace);
});

test('a section can start at a later step and end early: only that stretch is covered', () => {
  const { config, model } = stair({ ...cut, railingSections: [{ id: 's', side: 'outer', fromStep: 2, toStep: 5 }] });
  const [section] = model.sections;
  assert.equal(section.fromStep, 2);
  const half = config.railingHandrailHeightMm / 2;
  const first = section.handrail.pieces[0].start;
  assert.ok(Math.abs(first.z + half - (config.riserHeight * (1 + first.y / config.treadGoing) + config.railingHeightMm)) < 1e-6);
  assert.ok(first.y >= 2 * config.treadGoing && first.y < 3 * config.treadGoing, 'starts at tread 3, on the face of its post');
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
  // the handrail runs from post face to post face, so its own ends are the faces the gaps are measured from
  assert.ok(Math.abs(along[0] - config.railingBalusterSizeMm / 2 - (steps[0] - config.railingBalusterSizeMm)) < 1e-6, 'the gap to the start post equals the gap between balusters');
  assert.ok(along[0] - config.railingBalusterSizeMm / 2 <= config.railingMaxClearMm + 1e-6, 'gap to the start post');
  assert.ok(dist(start, end) - along[along.length - 1] - config.railingBalusterSizeMm / 2 <= config.railingMaxClearMm + 1e-6, 'gap to the end post');
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
  // a post reaches 60 mm above the handrail's top where the handrail meets it (on the post's face), and never less
  // than 60 mm above the handrail height over its own nosing-line node
  const half = config.railingHandrailHeightMm / 2;
  const run = model.sections[0].runs[0];
  const railStartTop = run.pieces[0].start.z + half;
  assert.ok(Math.abs(start.elevation.top - (railStartTop + 60)) < 1e-6, 'start: 60 mm above the handrail on its face');
  assert.ok(start.elevation.top >= config.riserHeight + config.railingHeightMm + 60 - 1e-6);
  assert.ok(Math.abs(end.elevation.top - (11 * config.riserHeight + config.railingHeightMm + 60)) < 1e-6);
  assert.ok(end.elevation.top >= run.pieces[run.pieces.length - 1].end.z + half + 60 - 1e-6, 'end: at least 60 mm above the handrail');
});

test('per-post edits: thickness and length of a railing post, and removing it; the balusters follow the real post width', () => {
  const id = 'railing-post-s-start';
  const base = stair({ ...closed, railingSections: whole('outer') }).model.sections[0];
  const edited = stair({ ...closed, railingSections: whole('outer'), manualPostOverrides: { [id]: { sizeMm: 140, topDeltaMm: 50, bottomDeltaMm: -20 } } }).model.sections[0];
  const b = base.posts.find((p) => p.postId === id);
  const e = edited.posts.find((p) => p.postId === id);
  assert.equal(e.size, 140);
  assert.equal(e.nominalSize, b.size);
  // +50 on top of ITS nominal height (a fatter post meets the rising handrail further along, so its nominal top is higher)
  assert.ok(Math.abs(e.elevation.top - (e.nominalElevation.top + 50)) < 1e-6);
  assert.ok(e.nominalElevation.top >= b.elevation.top - 1e-6);
  assert.ok(Math.abs(e.elevation.bottom - (b.elevation.bottom + 20)) < 1e-6);
  assert.equal(e.overridden, true);
  // measured from the post's own centre (the handrail itself now starts on the post's face)
  const firstGap = (section) => Math.hypot(section.balusters[0].position.x - b.position.x, section.balusters[0].position.y - b.position.y);
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
    // the whole path but the posts it stops at (a run ends on a post's face)
    const inPosts = (section.runs.length + 1) * 110;
    assert.ok(railed >= 0.95 * (planLength(section.path) - inPosts), `${windersPerTurn} winders: the rail covers the whole path`);
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

// ---- stage 4: bent handrail (railingSolver.js smoothRun) ----
import { buildStaircase as buildStaircaseForBent } from '../buildStaircase.js';
import { computeMaterialTakeoff as takeoffForBent } from '../../takeoff/materialTakeoff.js';
import { buildRailingDXF as railingDxfForBent } from '../../export/dxfExport.js';

const bentStair = (patch = {}, sections = [{ id: 'o', side: 'outer', fromStep: 0, toStep: null }]) =>
  buildStaircaseForBent({ ...createDefaultConfig(), railingEnabled: true, railingBent: true, railingSections: sections, ...patch });
const pitchOf = (p) => (Math.atan2(p.end.z - p.start.z, Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y)) * 180) / Math.PI;
const maxPitchJump = (pieces) => pieces.slice(1).reduce((m, p, i) => Math.max(m, Math.abs(pitchOf(p) - pitchOf(pieces[i]))), 0);

test('bent handrail: a plan corner with no post is bent round instead of ending in a post — one run, no join post', () => {
  const straight = bentStair({ railingBent: false });
  const bent = bentStair();
  assert.equal(straight.railingModel.sections[0].runs.length, 2, 'the straight (łamana) handrail ends in a post at the outer corner');
  assert.equal(bent.railingModel.sections[0].runs.length, 1);
  assert.equal(bent.railingModel.sections[0].runs[0].bent, true);
  assert.ok(!bent.railingModel.sections[0].posts.some((p) => p.postId.includes('join')), 'no join post at the bent corner');
});

test('bent handrail: pitch changes are rounded — no kink between consecutive pieces larger than a few degrees', () => {
  const straight = bentStair({ railingBent: false });
  const bent = bentStair();
  const straightJump = Math.max(...straight.railingModel.sections[0].runs.map((run) => maxPitchJump(run.pieces)));
  const bentJump = maxPitchJump(bent.railingModel.sections[0].runs[0].pieces);
  assert.ok(straightJump > 10, `the łamana handrail has kinks (${straightJump.toFixed(1)} deg)`);
  assert.ok(bentJump < 8, `bent handrail still kinks by ${bentJump.toFixed(1)} deg`);
});

test('bent handrail: where a structural post stands at the corner (the dusza side) the handrail still ends at the post', () => {
  const r = bentStair({}, [{ id: 'i', side: 'inner', fromStep: 0, toStep: null }]);
  const ids = r.railingModel.sections[0].runs.flatMap((run) => [run.startPostId, run.endPostId]);
  assert.ok(ids.includes('post-corner-0'));
});

test('bent handrail: every baluster reaches exactly the underside of the bent handrail above it', () => {
  for (const type of ['closed', 'cut']) {
    const r = bentStair({ stringerConstructionTypeOuter: type });
    const section = r.railingModel.sections[0];
    const h = section.handrail.heightMm;
    const pieces = section.runs.flatMap((run) => run.pieces);
    for (const b of section.balusters) {
      let best = null;
      let bestDist = Infinity;
      for (const p of pieces) {
        const dx = p.end.x - p.start.x;
        const dy = p.end.y - p.start.y;
        const L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((b.position.x - p.start.x) * dx + (b.position.y - p.start.y) * dy) / L2)) : 0;
        const d = Math.hypot(b.position.x - (p.start.x + t * dx), b.position.y - (p.start.y + t * dy));
        if (d < bestDist) {
          bestDist = d;
          best = p.start.z + (p.end.z - p.start.z) * t - h / 2;
        }
      }
      assert.ok(Math.abs(b.zTop - best) < 1, `${type}: baluster ${b.id} top ${b.zTop.toFixed(1)} vs handrail underside ${best.toFixed(1)}`);
    }
  }
});

test('bent handrail: the takeoff counts a bent run as ONE handrail piece of its true length, and the DXF draws its development', () => {
  const r = bentStair();
  const items = takeoffForBent(r, r.fullConfig).filter((i) => i.elementType === 'HANDRAIL');
  const run = r.railingModel.sections[0].runs[0];
  assert.equal(items.length, 1);
  assert.ok(Math.abs(items[0].nominalDimensions.lengthMm - run.pieces.reduce((s, p) => s + p.lengthMm, 0)) < 1e-9);
  const dxf = railingDxfForBent(r.railingModel, { balusterSizeMm: r.fullConfig.railingBalusterSizeMm });
  assert.ok(dxf.includes('Porecz GIETA'));
  assert.ok(/^[\x00-\x7F]*$/.test(dxf));
});

// ---- stage 4: base rail (podporęcz) on a housed wanga ----
import { buildStructuralReport as structuralForBaseRail } from '../../structural/index.js';

const withBaseRail = (patch = {}) => bentStair({ railingBent: false, railingBaseRail: true, ...patch });

test('base rail: lies on the housed wanga\'s top edge along the handrail runs, and the balusters stand in it', () => {
  const plain = bentStair({ railingBent: false });
  const r = withBaseRail();
  const section = r.railingModel.sections[0];
  const h = r.fullConfig.railingBaseRailHeightMm;
  assert.ok(section.baseRail.pieces.length > 0);
  // every baluster is lifted by exactly the base rail's height (it stands IN the base rail on the wanga)
  const before = plain.railingModel.sections[0].balusters;
  assert.equal(section.balusters.length, before.length);
  section.balusters.forEach((b, i) => assert.ok(Math.abs(b.zBottom - before[i].zBottom - h) < 1e-6));
  // the base rail's underside is the wanga's top at the balusters' feet (the same wanga top the balusters used)
  for (const b of before) {
    let best = null;
    let bestDist = Infinity;
    for (const p of section.baseRail.pieces) {
      const dx = p.end.x - p.start.x;
      const dy = p.end.y - p.start.y;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((b.position.x - p.start.x) * dx + (b.position.y - p.start.y) * dy) / L2)) : 0;
      const d = Math.hypot(b.position.x - (p.start.x + t * dx), b.position.y - (p.start.y + t * dy));
      if (d < bestDist) {
        bestDist = d;
        best = p.start.z + (p.end.z - p.start.z) * t - h / 2;
      }
    }
    assert.ok(Math.abs(best - b.zBottom) < 2, `base rail underside ${best.toFixed(1)} vs wanga top ${b.zBottom.toFixed(1)} at ${b.id}`);
  }
});

test('base rail: not on an overlay wanga (the balusters stand on the treads) — skipped with an INFO', () => {
  const r = withBaseRail({ stringerConstructionTypeOuter: 'cut' });
  const section = r.railingModel.sections[0];
  assert.equal(section.baseRail, null);
  assert.ok(section.diagnostics.some((d) => d.ruleId === 'RAILING-BASERAIL-NOT-APPLICABLE' && d.severity === 'INFO'));
});

test('base rail: priced per piece (own material), drawn in the balustrade DXF, and its weight loads the wanga', () => {
  const r = withBaseRail();
  const pieces = r.railingModel.sections[0].baseRail.pieces;
  const items = takeoffForBent(r, r.fullConfig).filter((i) => i.elementType === 'BASERAIL');
  assert.equal(items.length, pieces.length);
  assert.ok(items.every((i) => i.materialId === 'railing-baserail'));
  const dxf = railingDxfForBent(r.railingModel, { balusterSizeMm: r.fullConfig.railingBalusterSizeMm });
  assert.equal((dxf.match(/\nPodporecz /g) || []).length, pieces.length);
  const report = structuralForBaseRail(r);
  const onBoards = report.stringers.checks.reduce((s, c) => s + c.railingDetailKn.baseRail, 0);
  const selfWeight = report.selfWeight.categories.find((c) => c.key === 'baserail').weightKn;
  assert.ok(onBoards > 0);
  assert.ok(Math.abs(onBoards - selfWeight) < 1e-9, 'the whole base rail reaches the wangi');
});

test('base rail off (default): nothing changes', () => {
  const r = bentStair({ railingBent: false });
  assert.equal(r.railingModel.sections[0].baseRail, null);
  assert.equal(takeoffForBent(r, r.fullConfig).filter((i) => i.elementType === 'BASERAIL').length, 0);
});

// ---- handrail ends at posts (reported with a screenshot: a rail running THROUGH the start newel and stopping short of
// the end newel) and the manual height correction of an end at its post ----
import { railingEndKey, sanitizeRailingEndOffsets, MAX_RAILING_END_OFFSET_MM } from '../railingSolver.js';

function allPosts(planLayout, config, model) {
  return [...buildPostModels(planLayout, config), ...model.posts.filter((p) => !p.removed)];
}

test('every handrail run starts and ends ON the face of the post there — structural newels and corner posts included', () => {
  for (const patch of [
    { ...closed, railingSections: whole('inner') },
    { ...cut, railingSections: whole('inner') },
    { ...closed, stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, railingSections: whole('inner') },
    { ...closed, stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, railingSections: whole('outer') },
    { ...closed, stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, railingBent: true, railingSections: whole('inner') },
  ]) {
    const { config, model, planLayout } = stair(patch);
    const posts = allPosts(planLayout, config, model);
    const section = model.sections[0];
    const label = JSON.stringify(patch).slice(0, 90);
    for (const run of section.runs) {
      const ends = [
        [run.pieces[0].start, run.startPostId, run.startAtPostFace],
        [run.pieces[run.pieces.length - 1].end, run.endPostId, run.endAtPostFace],
      ];
      for (const [pt, postId, fitted] of ends) {
        const post = posts.find((p) => p.postId === postId);
        if (!post) continue;
        assert.ok(fitted, `${label}: the end at ${postId} is fitted to the post`);
        // on the square's boundary: the larger of |dx|, |dy| is exactly half the post, the other within it
        const dx = Math.abs(pt.x - post.position.x);
        const dy = Math.abs(pt.y - post.position.y);
        assert.ok(Math.abs(Math.max(dx, dy) - post.size / 2) < 1e-6 && Math.min(dx, dy) <= post.size / 2 + 1e-6, `${label}: ${postId} — the rail ends ${Math.max(dx, dy).toFixed(1)} mm from the post centre, not on its face`);
      }
      // and no part of the run lies inside a post at its ends
      for (const piece of run.pieces) {
        const mid = { x: (piece.start.x + piece.end.x) / 2, y: (piece.start.y + piece.end.y) / 2 };
        for (const postId of [run.startPostId, run.endPostId]) {
          const post = posts.find((p) => p.postId === postId);
          if (post) assert.ok(Math.max(Math.abs(mid.x - post.position.x), Math.abs(mid.y - post.position.y)) >= post.size / 2 - 1e-6, `${label}: a handrail piece inside ${postId}`);
        }
      }
    }
  }
});

test('railingEndOffsets: the end of a handrail at its post is moved up/down by hand; the other end and the line\'s plan stay; balusters follow', () => {
  const patch = { ...closed, railingSections: whole('inner') };
  const base = stair(patch).model.sections[0];
  const endPostId = base.runs[0].endPostId;
  const key = railingEndKey('s', endPostId, 'end');
  const lowered = stair({ ...patch, railingEndOffsets: { [key]: -120 } }).model.sections[0];
  const b = base.runs[0].pieces;
  const l = lowered.runs[0].pieces;
  assert.equal(lowered.runs[0].endOffsetMm, -120);
  assert.ok(Math.abs(l[l.length - 1].end.z - (b[b.length - 1].end.z - 120)) < 1e-6, 'the point on the post face is exactly 120 mm lower');
  assert.ok(Math.abs(l[0].start.z - b[0].start.z) < 1e-6, 'the other end stays');
  assert.ok(Math.abs(l[l.length - 1].end.x - b[b.length - 1].end.x) < 1e-6 && Math.abs(l[l.length - 1].end.y - b[b.length - 1].end.y) < 1e-6, 'still on the same post face');
  // balusters reach the corrected handrail: the last one is shorter than before
  const lastTop = (sec) => sec.balusters[sec.balusters.length - 1].zTop;
  assert.ok(lastTop(lowered) < lastTop(base) - 50);
  // sanitizing: only "...|start" / "...|end" keys, finite, non-zero, clamped
  assert.deepEqual(sanitizeRailingEndOffsets({ [key]: -5000, 'x|y|middle': 10, 'a|b|start': 'abc', 'c|d|end': 0 }), { [key]: -MAX_RAILING_END_OFFSET_MM });
});

test('railingEndOffsets move the point ON THE POST FACE by exactly the amount — also where the run reaches the post by a steep winder piece, and with a bent handrail', () => {
  for (const railingBent of [false, true]) {
    const patch = { ...closed, stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, railingBent, railingSections: whole('inner') };
    const base = stair(patch).model.sections[0];
    const lowered = stair({ ...patch, railingEndOffsets: { [railingEndKey('s', 'post-corner-0', 'end')]: -150 } }).model.sections[0];
    const endOf = (sec) => sec.runs[0].pieces[sec.runs[0].pieces.length - 1].end;
    assert.equal(base.runs[0].endPostId, 'post-corner-0');
    assert.ok(Math.abs(endOf(lowered).z - (endOf(base).z - 150)) < 1, `bent ${railingBent}: ${(endOf(base).z - endOf(lowered).z).toFixed(1)} mm lower instead of 150`);
    assert.ok(Math.hypot(endOf(lowered).x - endOf(base).x, endOf(lowered).y - endOf(base).y) < 1e-6, 'same point of the post face in plan');
  }
});

test('no short stub next to a post: where the nosing line kinks just before the corner post, the straight handrail is carried on to the post face', async () => {
  const { RAIL_END_STUB_MM } = await import('../railingSolver.js');
  const { config, model, planLayout } = stair({ ...closed, stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, railingSections: whole('inner') });
  const run = model.sections[0].runs[0];
  assert.equal(run.endPostId, 'post-corner-0');
  // the flight before the corner is ONE straight piece from the start newel's face to the corner post's face
  assert.equal(run.pieces.length, 1, 'no extra piece at the post');
  const post = buildPostModels(planLayout, config).find((p) => p.postId === 'post-corner-0');
  const end = run.pieces[0].end;
  assert.ok(Math.abs(Math.max(Math.abs(end.x - post.position.x), Math.abs(end.y - post.position.y)) - post.size / 2) < 1e-6, 'on the post face');
  // no piece next to a post is shorter than the stub limit while continuing the previous piece's direction
  for (const sec of model.sections) for (const r of sec.runs) {
    if (r.pieces.length < 2) continue;
    for (const [stub, next] of [[r.pieces[0], r.pieces[1]], [r.pieces[r.pieces.length - 1], r.pieces[r.pieces.length - 2]]]) {
      const plan = (pc) => Math.hypot(pc.end.x - pc.start.x, pc.end.y - pc.start.y);
      const cos = ((stub.end.x - stub.start.x) * (next.end.x - next.start.x) + (stub.end.y - stub.start.y) * (next.end.y - next.start.y)) / (plan(stub) * plan(next) || 1);
      assert.ok(plan(stub) >= RAIL_END_STUB_MM - 1e-6 || cos < Math.cos((RAILING_CORNER_ANGLE_DEG * Math.PI) / 180), `a ${plan(stub).toFixed(0)} mm stub at a post`);
    }
  }
  // the balusters stand under the handrail's own line
  const s = model.sections[0];
  for (const b of s.balusters) assert.ok(b.heightMm > 300 && b.heightMm < 1300, `baluster ${b.heightMm.toFixed(0)} mm`);
});

test('a handrail reaches its post also when the post stands BESIDE the run\'s line (landing + winders, 0-tread flight, partial section)', () => {
  // each of these left the handrail ending in the air, 5-70 mm short of the post (the run's own line missed the post)
  const cases = [
    { stairType: 'U', treadsLegA: 1, treadsLegB: 0, treadsLegC: 2, windersPerTurn: 3, turn1Type: 'landing', turn2Type: 'winder', railingSections: whole('inner') },
    { stairType: 'U', treadsLegA: 1, treadsLegB: 0, treadsLegC: 2, windersPerTurn: 3, turn1Type: 'winder', turn2Type: 'landing', railingSections: whole('inner') },
    { stairType: 'L', treadsLegA: 0, treadsLegB: 0, windersPerTurn: 3, railingSections: [{ id: 's', side: 'inner', fromStep: 2, toStep: null }] },
  ];
  for (const patch of cases) {
    const { config, model, planLayout } = stair({ ...closed, totalRise: 2810, ...patch });
    const posts = allPosts(planLayout, config, model);
    const label = JSON.stringify(patch).slice(0, 110);
    let ends = 0;
    for (const run of model.sections[0].runs) {
      for (const [pt, postId] of [[run.pieces[0].start, run.startPostId], [run.pieces[run.pieces.length - 1].end, run.endPostId]]) {
        const post = posts.find((q) => q.postId === postId);
        assert.ok(post, `${label}: ${postId}`);
        // how far outside the post's plan square the handrail's end is (0 = on a face or inside the post)
        const gap = Math.hypot(Math.max(0, Math.abs(pt.x - post.position.x) - post.size / 2), Math.max(0, Math.abs(pt.y - post.position.y) - post.size / 2));
        assert.ok(gap < 1e-6, `${label}: the handrail ends ${gap.toFixed(1)} mm short of ${postId}`);
        ends++;
      }
    }
    assert.ok(ends >= 2, label);
  }
});
