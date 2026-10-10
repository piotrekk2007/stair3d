import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import {
  applyRunPoints,
  applyRailingProfileEdit,
  sanitizeRailingProfileOverrides,
  railingRunKey,
  railingEndKey,
  RAILING_PROFILE_EDITS,
  MAX_RAILING_POINT_OFFSET_MM,
} from '../railingProfileModel.js';
import { buildRailingProfileView, listRailingRuns, valueAt } from '../railingProfileView.js';
import { renderRailingProfileSVG, railingViewBox } from '../../railingEditor/railingEditorRenderer.js';

const base = { stairType: 'straight', treadsLegA: 10, totalRise: 2000, treadGoing: 280, railingEnabled: true, railingSections: [{ id: 's', side: 'inner', fromStep: 0, toStep: null }] };
const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...base, ...patch });
const runOf = (m) => m.railingModel.sections[0].runs[0];

test('applyRunPoints: a point adds a vertex dz above the line; a point on an existing vertex moves it; order does not matter; ends stay', () => {
  const path = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1000, z: 500 }, { x: 0, y: 2000, z: 700 }];
  const a = applyRunPoints(path, [{ s: 500, dz: 40 }, { s: 1000, dz: -30 }]);
  const b = applyRunPoints(path, [{ s: 1000, dz: -30 }, { s: 500, dz: 40 }]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.path.map((p) => [p.y, p.z]), [[0, 0], [500, 290], [1000, 470], [2000, 700]]);
  assert.deepEqual(a.control.map((c) => c.kind), ['end', 'added', 'vertex', 'end']);
  assert.deepEqual(a.control.map((c) => c.dz), [0, 40, -30, 0]);
  // a point at an end or outside the run is skipped and counted, never applied
  const out = applyRunPoints(path, [{ s: 5, dz: 100 }, { s: 3000, dz: 100 }]);
  assert.equal(out.skipped, 2);
  assert.deepEqual(out.path, path);
});

test('sanitize + edits: SET_POINT adds/moves, REMOVE_POINT removes, SET_END writes the end offset, RESET_RUN clears the run', () => {
  assert.deepEqual(sanitizeRailingProfileOverrides({ s: { 'a>b': [{ s: 300, dz: 9999 }, { s: 300.2, dz: 1 }, { s: -5, dz: 1 }, { s: 'x', dz: 1 }], 'c>d': [] }, t: 'nope' }), { s: { 'a>b': [{ s: 300, dz: MAX_RAILING_POINT_OFFSET_MM }] } });
  const E = RAILING_PROFILE_EDITS;
  let st = applyRailingProfileEdit({}, { type: E.SET_POINT, sectionId: 's', runKey: 'a>b', s: 800, dz: 25 });
  st = applyRailingProfileEdit(st, { type: E.SET_POINT, sectionId: 's', runKey: 'a>b', s: 300, dz: -10 });
  st = applyRailingProfileEdit(st, { type: E.SET_POINT, sectionId: 's', runKey: 'a>b', s: 800.4, dz: 40 }); // the same point, moved
  assert.deepEqual(st.railingProfileOverrides, { s: { 'a>b': [{ s: 300, dz: -10 }, { s: 800.4, dz: 40 }] } });
  st = applyRailingProfileEdit(st, { type: E.SET_END, sectionId: 's', postId: 'b', end: 'end', dz: -60 });
  assert.deepEqual(st.railingEndOffsets, { [railingEndKey('s', 'b', 'end')]: -60 });
  st = applyRailingProfileEdit(st, { type: E.REMOVE_POINT, sectionId: 's', runKey: 'a>b', s: 300 });
  assert.deepEqual(st.railingProfileOverrides.s['a>b'], [{ s: 800.4, dz: 40 }]);
  st = applyRailingProfileEdit(st, { type: E.RESET_RUN, sectionId: 's', runKey: 'a>b', startPostId: 'a', endPostId: 'b' });
  assert.deepEqual(st, { railingProfileOverrides: {}, railingEndOffsets: {} });
});

test('a point on a run lifts the handrail there by exactly dz, the ends stay on their post faces, balusters follow', () => {
  const plain = build();
  const run = runOf(plain);
  const key = railingRunKey(run.startPostId, run.endPostId);
  assert.equal(run.key, key);
  const s = 1200;
  const edited = build({ railingProfileOverrides: { s: { [key]: [{ s, dz: 80 }] } } });
  const r = runOf(edited);
  assert.equal(r.pieces.length, 2, 'the straight handrail now has a vertex');
  const joint = r.pieces[0].end;
  const along = (pt) => Math.hypot(pt.x - run.pieces[0].start.x, pt.y - run.pieces[0].start.y);
  assert.ok(Math.abs(along(joint) - s) < 1e-6, 'at 1200 mm along the run');
  const p = run.pieces[0];
  const zPlain = p.start.z + ((p.end.z - p.start.z) * s) / along(p.end);
  assert.ok(Math.abs(joint.z - (zPlain + 80)) < 1e-6, '80 mm above the straight line');
  assert.deepEqual(r.pieces[0].start, run.pieces[0].start);
  assert.deepEqual(r.pieces[1].end, run.pieces[0].end);
  // a baluster near the point is longer than before, by about the lift
  const near = (m) => m.railingModel.sections[0].balusters.reduce((best, b) => (Math.abs(along(b.position) - s) < Math.abs(along(best.position) - s) ? b : best));
  assert.ok(near(edited).zTop - near(plain).zTop > 60);
  // reported, with the real height range above the nosing line
  const info = edited.railingModel.diagnostics.find((d) => d.ruleId === 'RAILING-PROFILE-EDITED');
  assert.ok(info && info.severity === 'INFO');
  assert.ok(!plain.railingModel.diagnostics.some((d) => d.ruleId === 'RAILING-PROFILE-EDITED'));
  // a point outside the run is skipped and reported
  const stale = build({ railingProfileOverrides: { s: { [key]: [{ s: 99999, dz: 50 }] } } });
  assert.ok(stale.railingModel.diagnostics.some((d) => d.ruleId === 'RAILING-PROFILE-POINT-SKIPPED'));
  assert.deepEqual(runOf(stale).pieces, run.pieces);
});

test('view model of a run: unfolded handrail band, one handle per end and per vertex, posts at both ends, the AUTO line for comparison', () => {
  const m = build();
  const runs = listRailingRuns(m.railingModel);
  assert.equal(runs.length, 1);
  const view = buildRailingProfileView(m, runs[0]);
  const cfg = m.fullConfig;
  assert.ok(Math.abs(view.railTop[view.railTop.length - 1].u - view.lengthMm) < 1e-6);
  assert.ok(view.railTop.every((p, i) => Math.abs(p.v - view.railBottom[i].v - cfg.railingHandrailHeightMm) < 1e-9));
  assert.deepEqual(view.controls.map((c) => c.id), ['end:start', 'end:end']);
  assert.equal(view.edited, false);
  assert.equal(view.posts.length, 2);
  assert.ok(view.posts[0].u1 === 0 && Math.abs(view.posts[1].u0 - view.lengthMm) < 1e-9, 'the rail runs from post face to post face');
  // the handrail's top is railingHeightMm above the nosing line it follows
  const mid = view.lengthMm / 2;
  const nosingMid = valueAt(view.nosing.filter((p, i, all) => i === 0 || p.u > all[i - 1].u), mid);
  assert.ok(Math.abs(valueAt(view.railTop, mid) - nosingMid - cfg.railingHeightMm) < 1);
  assert.ok(view.balusters.length > 3 && view.balusters.every((b) => b.u > 0 && b.u < view.lengthMm && b.v1 > b.v0));

  const key = runs[0].runKey;
  const edited = buildRailingProfileView(build({ railingProfileOverrides: { s: { [key]: [{ s: 1200, dz: 80 }] } }, railingEndOffsets: { [railingEndKey('s', view.endPostId, 'end')]: -50 } }), runs[0]);
  assert.deepEqual(edited.controls.map((c) => [c.id, c.kind, c.dz, c.edited]), [['end:start', 'end', 0, false], ['pt:1200.000', 'added', 80, true], ['end:end', 'end', -50, true]]);
  assert.equal(edited.edited, true);
  // the AUTO line is the unedited handrail
  assert.ok(Math.abs(valueAt(edited.autoTop, edited.lengthMm) - valueAt(view.railTop, view.lengthMm)) < 1e-6);
});

test('renderer: one handle per control (squares at the posts, circles on the line), a fixed size on screen; the AUTO line only when edited', () => {
  const m = build();
  const which = listRailingRuns(m.railingModel)[0];
  const view = buildRailingProfileView(m, which);
  const svg = renderRailingProfileSVG(view, { mmPerPx: 2 });
  assert.equal((svg.match(/data-point-id=/g) || []).length, 2);
  assert.ok(svg.includes('data-point-id="end:start"') && svg.includes('class="re-rail"') && !svg.includes('class="re-auto"'));
  const width = (text) => Number(/class="re-cp re-cp-end[^"]*"[^>]*? width="([\d.]+)"/.exec(text)[1]);
  assert.equal(width(svg), 18);
  assert.equal(width(renderRailingProfileSVG(view, { mmPerPx: 4 })), 36, 'twice the mm per pixel: the same 9 px');
  const vb = railingViewBox(view);
  assert.ok(vb.width > view.lengthMm && vb.height > 0);
  const edited = buildRailingProfileView(build({ railingProfileOverrides: { s: { [which.runKey]: [{ s: 1200, dz: 80 }] } } }), which);
  const svg2 = renderRailingProfileSVG(edited, { selectedId: 'pt:1200.000', mmPerPx: 2 });
  assert.ok(svg2.includes('class="re-auto"'));
  assert.ok(/<circle class="re-cp edited selected" data-point-id="pt:1200.000"/.test(svg2));
});

test('L stair, bent handrail: points and end corrections shape the smoothed run too; every run keeps its post faces', () => {
  const patch = { stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, railingBent: true };
  const plain = build(patch);
  const run = plain.railingModel.sections[0].runs[1];
  const view = buildRailingProfileView(plain, { sectionId: 's', runKey: run.key });
  const s = Math.round(view.lengthMm / 2);
  const edited = build({ ...patch, railingProfileOverrides: { s: { [run.key]: [{ s, dz: -70 }] } } });
  const v2 = buildRailingProfileView(edited, { sectionId: 's', runKey: run.key });
  assert.ok(valueAt(v2.railTop, s) < valueAt(view.railTop, s) - 30, 'lower in the middle');
  assert.ok(Math.abs(valueAt(v2.railTop, 0) - valueAt(view.railTop, 0)) < 1 && Math.abs(valueAt(v2.railTop, v2.lengthMm) - valueAt(view.railTop, view.lengthMm)) < 1, 'the ends stay');
  const r2 = edited.railingModel.sections[0].runs[1];
  assert.ok(r2.startAtPostFace && r2.endAtPostFace);
  // the other run is untouched
  assert.deepEqual(edited.railingModel.sections[0].runs[0].pieces, plain.railingModel.sections[0].runs[0].pieces);
});
