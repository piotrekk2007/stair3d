import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildAllPostModels } from '../../geometry/postSolver.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildStringerBoardDXF, buildStringerAllBoardsDXF, buildBoardOutlineCurve, buildPostDXF, buildAllPostsDXF, buildTreadDXF, buildAllTreadsDXF } from '../dxfExport.js';

function build(configPatch, side = 'outer') {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const models = buildStringerModelsForFlight(planLayout, fullConfig);
  const model = models[side];
  const geometries = buildStringerConstructionGeometry(model, fullConfig);
  return { config: fullConfig, model, geometries };
}

function dist(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

test('buildBoardOutlineCurve: forms one real closed loop from the top and bottom curves', () => {
  const { geometries } = build({ stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const outline = buildBoardOutlineCurve(geometries[0]);
  assert.ok(outline && outline.length > 0);
  for (let i = 0; i < outline.length; i++) {
    const next = outline[(i + 1) % outline.length];
    assert.ok(dist(outline[i].b, next.a) < 1e-6, `primitive ${i} end must meet the next primitive's start`);
  }
});

test('buildBoardOutlineCurve: returns null when there is no lower curve (e.g. an empty segment)', () => {
  assert.equal(buildBoardOutlineCurve({ lowerCurve: [], upperCurve: [] }), null);
  assert.equal(buildBoardOutlineCurve({ lowerCurve: null }), null);
});

test('buildStringerBoardDXF: a cut board is a valid, well-formed DXF with an outline and a title block', () => {
  const { geometries, config } = build({ stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const dxf = buildStringerBoardDXF(geometries[0], { config });
  assert.ok(dxf.startsWith('0\nSECTION'));
  assert.ok(dxf.trim().endsWith('0\nEOF'));
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.includes('8\nOUTLINE'));
  assert.ok(/\bLINE\b/.test(dxf) || /\bARC\b/.test(dxf));
  assert.ok(dxf.includes('Skala 1:1'));
  assert.ok(dxf.includes(geometries[0].segmentId));
});

test('buildStringerBoardDXF: a closed (housed) board marks its housings with their real depth, on their own layer', () => {
  const { geometries, config } = build({ stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const withHousings = geometries.find((g) => (g.housings || []).length > 0);
  assert.ok(withHousings, 'a closed construction should produce at least one housed board in this scenario');
  const dxf = buildStringerBoardDXF(withHousings, { config });
  assert.ok(dxf.includes('8\nHOUSINGS'));
  const expectedDepth = Math.round(withHousings.housings[0].depth);
  assert.ok(dxf.includes(`wpust gl. ${expectedDepth} mm`));
});

test('buildStringerBoardDXF: marks tread-bearing positions when a matching StringerModel segment is given', () => {
  const { geometries, model, config } = build({ stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const segment = model.segments.find((s) => s.id === geometries[0].segmentId);
  const dxf = buildStringerBoardDXF(geometries[0], { segment, config });
  assert.ok(dxf.includes('8\nBEARINGS'));
  assert.ok(dxf.includes('st. 1'));
});

test('buildStringerBoardDXF: with no segment/config given, still produces a valid outline-only DXF', () => {
  const { geometries } = build({ stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const dxf = buildStringerBoardDXF(geometries[0]);
  assert.ok(dxf.includes('8\nOUTLINE'));
  assert.ok(!dxf.includes('8\nBEARINGS\n0\nLINE'));
});

test('buildStringerBoardDXF: DXF text is plain ASCII (Polish diacritics stripped) even though the app is Polish', () => {
  const { geometries, config } = build({ stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const dxf = buildStringerBoardDXF(geometries[0], { config });
  assert.ok(dxf.includes('wanga wpuszczana') === false || !/[ąćęłńóśźż]/i.test(dxf));
  assert.ok(!/[ąćęłńóśźż]/i.test(dxf));
});

test('buildStringerAllBoardsDXF: lays every board out with a real gap so none overlap', () => {
  const { geometries, model, config } = build(
    { stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, totalRise: 2700, treadGoing: 280, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' },
    'outer'
  );
  assert.ok(geometries.length >= 2, 'an L-winder outer stringer should have more than one board');
  const dxf = buildStringerAllBoardsDXF(geometries, { model, config });
  assert.ok(dxf);
  const titlePositions = [...dxf.matchAll(/10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n30\n0\n40\n[\d.]+\n1\nDeska: /g)].map((m) => Number(m[1]));
  assert.equal(titlePositions.length, geometries.filter((g) => g.lowerCurve?.length).length);
  for (let i = 1; i < titlePositions.length; i++) assert.ok(titlePositions[i] > titlePositions[i - 1], 'each board is laid out further right than the previous one');
});

// Regression: the very first board of a run has its bottom-front corner trimmed flush with the
// floor (stringerConstructionGeometry.js clampFirstSegmentToFloor), so the lower curve's own
// drawn start no longer reaches the board's real start face — a naive direct line from that point
// to the top curve's start cut the corner off as a false diagonal instead of the real right-angle
// (floor, then vertical face) the profile editor shows (same solved outerContour).
test('buildBoardOutlineCurve: a floor-trimmed first board keeps the real floor + vertical-face corner, not a diagonal shortcut', () => {
  const { geometries } = build({
    stairType: 'L',
    treadsLegA: 4,
    treadsLegB: 4,
    windersPerTurn: 5,
    totalRise: 2700,
    treadGoing: 280,
    stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed',
  });
  const g = geometries[0];
  assert.equal(g.ends.start.cut, 'FLOOR_HORIZONTAL', 'this scenario only demonstrates the bug when the first board is floor-trimmed');
  const outline = buildBoardOutlineCurve(g);
  const startU = g.ends.start.u;
  const hasFloorCorner = outline.some((prim) => prim.type === 'line' && Math.abs(prim.a.v) < 1e-6 && Math.abs(prim.b.v) < 1e-6 && Math.abs(prim.b.u - startU) < 1e-6);
  assert.ok(hasFloorCorner, 'the outline must include the flat floor segment ending at the start face, not skip straight to the top curve');
  // The corner point itself must be a genuine polygon vertex (both edges connect through it).
  const cornerCount = outline.filter((prim) => Math.abs(prim.a.u - startU) < 1e-6 && Math.abs(prim.a.v) < 1e-6).length + outline.filter((prim) => Math.abs(prim.b.u - startU) < 1e-6 && Math.abs(prim.b.v) < 1e-6).length;
  assert.ok(cornerCount >= 2, 'the floor/start-face corner point must connect two primitives, not float in the middle of a single diagonal');
});

// Regression: a tread's nosing is milled into the SAME physical board, overhanging past its
// structural front edge — the housing that receives that board end-on must be long enough for the
// nosing too, or the workshop cuts a slot 25mm too short for the real board (reported: the DXF
// housing showed only the nominal tread-going width, ignoring the 25mm nosing visible in 3D).
test('buildStringerBoardDXF / housings: the owned front corner of a housing extends by config.nosing, the back corner does not', () => {
  const { geometries, model, config } = build({ stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', nosing: 25 });
  const g = geometries.find((geo) => (geo.housings || []).length > 0);
  assert.ok(g);
  const segment = model.segments.find((s) => s.id === g.segmentId);
  for (const h of g.housings) {
    const bearing = segment.treadBearings.find((b) => b.treadIndex === h.treadIndex);
    const expectedStart = bearing.finalUStart + (bearing.ownsStart && bearing.riserRecess > 0 ? bearing.riserRecess : 0);
    assert.equal(h.uStart, bearing.ownsStart ? expectedStart - config.nosing : expectedStart);
    assert.equal(h.uEnd, bearing.finalUEnd, 'the back corner is never extended — nosing only overhangs at the front');
  }
});

test('buildStringerAllBoardsDXF: returns null when there is nothing to draw', () => {
  assert.equal(buildStringerAllBoardsDXF([]), null);
  assert.equal(
    buildStringerAllBoardsDXF([{ lowerCurve: [], upperCurve: [] }]),
    null
  );
});

function buildPosts(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return buildAllPostModels(planLayout, fullConfig);
}

test('buildPostDXF: a plain section-width x length rectangle, with a title block', () => {
  const posts = buildPosts({});
  const post = posts.find((p) => p.postId === 'post-start');
  const dxf = buildPostDXF(post);
  assert.ok(dxf.startsWith('0\nSECTION'));
  assert.ok(dxf.trim().endsWith('0\nEOF'));
  assert.ok(dxf.includes('8\nOUTLINE'));
  const lines = [...dxf.matchAll(/0\nLINE\n8\nOUTLINE\n10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n30\n0\n11\n(-?[\d.]+)\n21\n(-?[\d.]+)\n31\n0/g)];
  assert.equal(lines.length, 4, 'a plain rectangle is exactly 4 lines');
  const us = lines.flatMap((m) => [+m[1], +m[3]]);
  const vs = lines.flatMap((m) => [+m[2], +m[4]]);
  assert.equal(Math.max(...us) - Math.min(...us), post.size);
  assert.equal(Math.max(...vs) - Math.min(...vs), post.elevation.top - post.elevation.bottom);
  assert.ok(dxf.includes(`Slup: ${post.postId}`));
  assert.ok(dxf.includes('Skala 1:1'));
});

test('buildPostDXF: null for a removed post or a degenerate one', () => {
  const posts = buildPosts({});
  const post = posts.find((p) => p.postId === 'post-start');
  assert.equal(buildPostDXF({ ...post, removed: true }), null);
  assert.equal(buildPostDXF({ ...post, elevation: { bottom: 100, top: 100 } }), null);
  assert.equal(buildPostDXF({ ...post, size: 0 }), null);
  assert.equal(buildPostDXF(null), null);
});

test('buildAllPostsDXF: every existing post laid out side by side, removed ones excluded', () => {
  const posts = buildPosts({ hasCornerPost: true });
  assert.ok(posts.length >= 3, 'an L-winder with a corner post should have start/end/corner posts');
  const withOneRemoved = posts.map((p, i) => (i === 0 ? { ...p, removed: true } : p));
  const dxf = buildAllPostsDXF(withOneRemoved);
  const titlePositions = [...dxf.matchAll(/10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n30\n0\n40\n[\d.]+\n1\nSlup: /g)].map((m) => Number(m[1]));
  assert.equal(titlePositions.length, posts.length - 1, 'the removed post is excluded');
  for (let i = 1; i < titlePositions.length; i++) assert.ok(titlePositions[i] > titlePositions[i - 1], 'each post is laid out further right than the previous one');
});

test('buildAllPostsDXF: returns null when there is nothing to draw', () => {
  assert.equal(buildAllPostsDXF([]), null);
  assert.equal(buildAllPostsDXF(null), null);
  assert.equal(buildAllPostsDXF([{ removed: true, elevation: { bottom: 0, top: 1000 }, size: 100 }]), null);
});

function buildTreads(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return buildTreadModels(planLayout, fullConfig);
}

test('buildTreadDXF: a straight tread is its real nosed outline, one edge per vertex, with a title block', () => {
  const treads = buildTreads({});
  const straight = treads.find((t) => t.type === 'straight');
  assert.ok(straight);
  const dxf = buildTreadDXF(straight);
  assert.ok(dxf.startsWith('0\nSECTION'));
  assert.ok(dxf.trim().endsWith('0\nEOF'));
  const lines = [...dxf.matchAll(/0\nLINE\n8\nOUTLINE\n10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n30\n0\n11\n(-?[\d.]+)\n21\n(-?[\d.]+)\n31\n0/g)];
  assert.equal(lines.length, straight.outline.length, 'one edge per outline vertex');
  assert.ok(dxf.includes(`Stopien: ${straight.stepId}`));
  assert.ok(dxf.includes('Typ: prosty'));
  assert.ok(dxf.includes('Skala 1:1'));
  assert.ok(!dxf.includes('Formatka surowa'), 'a straight tread has no separate production blank to state');
});

test('buildTreadDXF: a winder tread also states its raw production blank alongside the finished outline', () => {
  const treads = buildTreads({});
  const winder = treads.find((t) => t.type === 'winder');
  assert.ok(winder && winder.winderBlank);
  const dxf = buildTreadDXF(winder);
  assert.ok(dxf.includes('Typ: zabiegowy'));
  assert.ok(dxf.includes(`Formatka surowa: ${Math.round(winder.winderBlank.length)} x ${Math.round(winder.winderBlank.depth)} mm`));
});

test('buildAllTreadsDXF: every tread laid out side by side without overlap, one title per tread', () => {
  const treads = buildTreads({});
  const dxf = buildAllTreadsDXF(treads);
  assert.ok(dxf);
  const titlePositions = [...dxf.matchAll(/10\n(-?[\d.]+)\n20\n(-?[\d.]+)\n30\n0\n40\n[\d.]+\n1\nStopien: /g)].map((m) => Number(m[1]));
  assert.equal(titlePositions.length, treads.length);
  for (let i = 1; i < titlePositions.length; i++) assert.ok(titlePositions[i] > titlePositions[i - 1], 'each tread is laid out further right than the previous one');
});

test('buildTreadDXF / buildAllTreadsDXF: null for missing/degenerate input', () => {
  assert.equal(buildTreadDXF(null), null);
  assert.equal(buildTreadDXF({ outline: [] }), null);
  assert.equal(buildTreadDXF({ outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }), null);
  assert.equal(buildAllTreadsDXF([]), null);
  assert.equal(buildAllTreadsDXF(null), null);
});

// A tread with a riser below it has a groove milled into its underside (TreadModel.notch) — the
// workshop drawing must show it (own layer, 4 edges, depth in the label); no risers = no groove.
test('buildTreadDXF: the underside groove for the riser overlap is drawn on its own NOTCH layer, and only when there is one', () => {
  const withRisers = buildTreads({ hasRiserBoards: true, riserTopOverlapMm: 12, riserBoardThickness: 20 });
  const straight = withRisers.find((t) => t.type === 'straight' && t.notch);
  assert.ok(straight);
  const dxf = buildTreadDXF(straight);
  assert.equal([...dxf.matchAll(/0\nLINE\n8\nNOTCH\n/g)].length, 4);
  assert.ok(dxf.includes('rowek od spodu gl. 12 mm'));
  assert.ok(buildAllTreadsDXF(withRisers).includes('8\nNOTCH\n'));

  const noRisers = buildTreads({ hasRiserBoards: false });
  assert.ok(!buildTreadDXF(noRisers.find((t) => t.type === 'straight')).includes('NOTCH\n1'));
  assert.ok(!buildTreadDXF(noRisers.find((t) => t.type === 'straight')).includes('rowek'));
});
