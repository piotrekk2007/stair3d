import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildProfileViewModel, offsetFromDrag } from '../../geometry/stringerProfileView.js';
import { applyProfileEdit, PROFILE_EDITS, anchorIdForTread } from '../../geometry/stringerProfileModel.js';
import { layoutSegments, contentBounds, toSvg, fromSvg, renderProfileEditorSVG, SEGMENT_GAP_MM } from '../profileEditorRenderer.js';

function views(patch = {}, side = 'outer') {
  const config = { ...createDefaultConfig(), stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, totalRise: 2700, treadGoing: 280, ...patch };
  const derived = deriveStairData(config);
  const full = { ...config, riserHeight: derived.riserHeight };
  const models = buildStringerModelsForFlight(buildPlanLayout(full), full);
  return { full, views: buildProfileViewModel(buildStringerConstructionGeometry(models[side], full), models[side], full) };
}

test('layoutSegments: boards sit left to right with a gap, each starting after the previous board ends', () => {
  const { views: v } = views();
  assert.ok(v.length >= 2);
  const layout = layoutSegments(v);
  assert.equal(layout.length, v.length);
  assert.equal(layout[0].offsetX + layout[0].uMin, 0, 'the first board starts at x = 0');
  for (let i = 1; i < layout.length; i++) {
    const prevRight = layout[i - 1].offsetX + layout[i - 1].uMax;
    const left = layout[i].offsetX + layout[i].uMin;
    assert.ok(Math.abs(left - prevRight - SEGMENT_GAP_MM) < 1e-6);
  }
});

test('toSvg / fromSvg are inverses (v up on the board, y down in SVG), and a point in a gap goes to the nearer board', () => {
  const { views: v } = views();
  const layout = layoutSegments(v);
  const p = toSvg(layout[1], 300, 1200);
  assert.deepEqual(p, { x: 300 + layout[1].offsetX, y: -1200 });
  const back = fromSvg(layout, p.x, p.y);
  assert.equal(back.index, 1);
  assert.ok(Math.abs(back.u - 300) < 1e-9 && Math.abs(back.v - 1200) < 1e-9);
  // just right of board 0's end -> still board 0
  const gapX = layout[0].offsetX + layout[0].uMax + SEGMENT_GAP_MM * 0.2;
  assert.equal(fromSvg(layout, gapX, 0).index, 0);
});

test('contentBounds includes the floor (y = 0) and every board', () => {
  const { views: v } = views();
  const b = contentBounds(layoutSegments(v));
  assert.ok(b.maxY >= 0 && b.minY < 0 && b.maxX > b.minX);
});

test('renderProfileEditorSVG: one segment group per board, outline, both contours, control points with stable data attributes', () => {
  const { views: v } = views();
  const { svg, layout } = renderProfileEditorSVG(v, { viewport: { x: 0, y: -3000, width: 6000, height: 3500 }, pxToMm: 10 });
  assert.equal(layout.length, v.length);
  assert.equal((svg.match(/class="pe-segment"/g) || []).length, v.length);
  assert.ok(svg.includes('class="pe-outline"') && svg.includes('pe-lower') && svg.includes('class="pe-floor"'));
  assert.ok(/data-cp-id="support:step-\d+"/.test(svg) && /data-contour="lower"/.test(svg));
  assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 -3000 6000 3500"'));
});

test('renderProfileEditorSVG: layers can be switched off, the selected point is marked, and text/handles scale with pxToMm', () => {
  const { views: v } = views();
  const vp = { x: 0, y: -3000, width: 6000, height: 3500 };
  const off = renderProfileEditorSVG(v, { viewport: vp, pxToMm: 10, layers: { reference: false, envelope: false, treads: false } }).svg;
  assert.ok(!off.includes('pe-reference') && !off.includes('pe-envelope') && !off.includes('class="pe-tread"'));
  const id = v[0].controlPoints.find((c) => c.withinSegment).id;
  const selected = renderProfileEditorSVG(v, { viewport: vp, pxToMm: 10, selected: { id, contour: 'lower' } }).svg;
  assert.ok(selected.includes('pe-cp pe-cp-anchored selected') || /pe-cp-\w+ selected/.test(selected));
  const small = renderProfileEditorSVG(v, { viewport: vp, pxToMm: 1 }).svg;
  const radius = (s) => Number(s.match(/<circle[^>]*r="([\d.]+)"/)[1]);
  assert.ok(radius(renderProfileEditorSVG(v, { viewport: vp, pxToMm: 10 }).svg) > radius(small), 'handles keep a constant on-screen size, so the mm radius grows with pxToMm');
});

test('a depth violation is drawn red and the label says so', () => {
  const config = { manualStringerProfileOverrides: applyProfileEdit({}, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', contour: 'lower', anchorId: anchorIdForTread(2), ds: 0, dn: -80 }) };
  const { views: v } = views(config);
  assert.ok(v.some((x) => x.localDepthMm < x.requiredDepthMm - 1));
  const svg = renderProfileEditorSVG(v, { viewport: { x: 0, y: -3000, width: 6000, height: 3500 }, pxToMm: 10 }).svg;
  assert.ok(svg.includes('pe-lower violation') && svg.includes('pe-label violation'));
});

test('a dragged position becomes the (ds, dn) that moves the point there (the editor round trip through the layout)', () => {
  const cfg = { manualStringerProfileOverrides: applyProfileEdit({}, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', contour: 'lower', anchorId: anchorIdForTread(2), ds: 0, dn: 0.001 }) };
  const first = views(cfg);
  const layout = layoutSegments(first.views);
  const cp = first.views[0].controlPoints.find((c) => c.id === anchorIdForTread(2) && c.contour === 'lower');
  // the pointer is over the SVG plane; the editor converts it with fromSvg and offsetFromDrag
  const pointer = toSvg(layout[0], cp.nominal.u + 20, cp.nominal.v - 60);
  const local = fromSvg(layout, pointer.x, pointer.y);
  const { ds, dn } = offsetFromDrag(cp, { u: local.u, v: local.v });
  const edited = views({ manualStringerProfileOverrides: applyProfileEdit({}, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', contour: 'lower', anchorId: anchorIdForTread(2), ds, dn }) });
  const cp2 = edited.views[0].controlPoints.find((c) => c.id === anchorIdForTread(2) && c.contour === 'lower');
  assert.ok(Math.abs(cp2.u - local.u) < 1e-6 && Math.abs(cp2.v - local.v) < 1e-6);
});

test('view model: the silhouette and the board span are provided, and an inserted point knows its place on its edge', () => {
  const insert = { type: PROFILE_EDITS.INSERT_VERTEX, side: 'outer', contour: 'lower', id: 'manual-1', after: anchorIdForTread(3), t: 0.4, dn: 20 };
  const { views: v } = views({ manualStringerProfileOverrides: applyProfileEdit({}, insert) });
  assert.ok(v[0].outline.length >= 4 && v[0].span.uEnd > v[0].span.uStart);
  const ins = v.flatMap((x) => x.controlPoints).find((c) => c.id === 'manual-1');
  assert.ok(ins && ins.kind === 'inserted' && ins.t === 0.4 && ins.edgeLength > 0);
});

test('applyProfileEdit RESET_SIDE clears one stringer and leaves the other', () => {
  let o = applyProfileEdit({}, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', contour: 'lower', anchorId: 'support:step-1', ds: 0, dn: 10 });
  o = applyProfileEdit(o, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'inner', contour: 'lower', anchorId: 'support:step-1', ds: 0, dn: 10 });
  const next = applyProfileEdit(o, { type: PROFILE_EDITS.RESET_SIDE, side: 'outer' });
  assert.equal(next.outer, undefined);
  assert.ok(next.inner);
});
