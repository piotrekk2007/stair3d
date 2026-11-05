import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { trimEdges } from '../openingTrimModel.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { claddingPieces } from '../export/claddingDxf.js';

// user requests 2026-11-05: the opening's trim („fajka”) chosen per opening edge; the posts' tops rounded or none
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const cfg = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 14, riseMm: 185, goingMm: 270, widthMm: 1000 }], treadThicknessMm: 40, floorFinishTopMm: 20, ...patch });

test('the trim: on every opening edge but the exit one, nose into the opening + board on the slab, flush with the floor', () => {
  const b = buildCladdingStair(cfg({ openingTrimEnabled: true, openingTrimNoseWidthMm: 20, openingTrimBoardDepthMm: 100 }));
  const edges = trimEdges(b, b.config);
  assert.equal(edges.filter((e) => e.exit).length, 1, 'the exit edge');
  const pieces = b.openingTrim.pieces;
  assert.equal(pieces.length, edges.length - 1, 'every other edge');
  assert.ok(!pieces.some((p) => edges[p.edge].exit));
  const t = pieces[0];
  const floor = b.concrete.exit.rawSlabTopZ + 20;
  near(t.board.topZ, floor, 'flush with the finished floor');
  near(t.board.bottomZ, b.concrete.exit.rawSlabTopZ, 'the board on the slab');
  near(t.nose.topZ - t.nose.bottomZ, 40, 'the nose the tread\'s thickness');
  near(t.depthMm, 120, 'nose 20 + board 100');
  // mitred at the corner of two trimmed edges: the two pieces share their outer corner point
  const [p1, p2] = pieces.filter((p) => pieces.some((q) => q.edge === (p.edge + 1) % edges.length) || pieces.some((q) => q.edge === (p.edge - 1 + edges.length) % edges.length)).slice(0, 2);
  assert.ok(p1 && p2 && p1.outline.some((a) => p2.outline.some((c) => Math.hypot(a.x - c.x, a.y - c.y) < 1e-6)), 'a shared mitre point');
});

test('the trim per edge (the plan\'s mode „▬ Fajka”), in 3D, on the plan, priced and in the DXF', () => {
  const b = buildCladdingStair(cfg({ openingTrimEnabled: true, openingTrimEdges: { 1: false } }));
  assert.ok(!b.openingTrim.pieces.some((p) => p.edge === 1), 'edge 2 off');
  const svg = renderCladdingPlanSVG(b, { mode: 'trim' });
  assert.ok((svg.match(/class="clad-trim-edge"/g) || []).length >= 2, 'the edges to click');
  assert.match(svg, /class="clad-trim"/);
  const root = renderCladdingStair(b);
  assert.ok(root.getObjectByName(`OpeningTrim-${b.openingTrim.pieces[0].edge}-nose`));
  const q = buildCladdingQuote(b, createDefaultQuoteSettings());
  assert.equal(q.lines.filter((l) => l.id.startsWith('trim-')).length, b.openingTrim.pieces.length);
  assert.ok(claddingPieces(b).some((p) => p.code.startsWith('FJ-')));
  assert.equal(buildCladdingStair(cfg()).openingTrim.pieces.length, 0, 'off by default');
});

test('the posts\' tops: rounded (turned — a lathe) or none (the shaft to the top)', () => {
  const base = { railingSides: { 0: { right: true } }, postCapHeightMm: 60 };
  const round = renderCladdingStair(buildCladdingStair(cfg({ ...base, postCap: 'round' })));
  const cap = round.getObjectByName('PostCapRound');
  cap.geometry.computeBoundingBox();
  const bb = cap.geometry.boundingBox;
  near(bb.max.y - bb.min.y, 60, 'the cap height', 1e-3);
  assert.ok(cap.geometry.attributes.position.count > 100, 'a turned (round) solid');
  const b = buildCladdingStair(cfg({ ...base, postCap: 'none' }));
  const none = renderCladdingStair(b);
  const post = none.getObjectByName(`Post-${b.balustrade.sections[0].posts[0].id}`);
  let meshes = 0;
  post.traverse((o) => o.isMesh && meshes++);
  assert.equal(meshes, 1 + b.config.postGrooves, 'the shaft (+ its grooves) only');
  const q = buildCladdingQuote(b, createDefaultQuoteSettings());
  assert.match(q.lines.find((l) => /Słupy ozdobne/.test(l.name)).name, /bez czapki/);
});

// user report 2026-11-05 (a screenshot): the trim beside the stair's exit must meet the antresola nosing at 45°
test('the trim meets the antresola nosing on the corner\'s diagonal, the nosing carried on to a corner short of it', () => {
  const b = buildCladdingStair(cfg({ openingTrimEnabled: true, sideNosingRight: true, sideNosingMm: 30 }));
  const [nz] = b.cladding.exitNosing;
  assert.equal(nz.mitred, true);
  const shared = (p) => b.openingTrim.pieces.filter((t) => t.outline.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)).length;
  // both of the nosing's ends shared with a trim piece (the right one past the stair's width, the opening 30 wider)
  const xs = nz.outline.map((p) => p.x);
  assert.ok(Math.max(...xs) > 1000 + 30, 'carried on past the stair to the opening\'s corner');
  assert.equal(nz.outline.filter((p) => shared(p) > 0).length, 4, 'every corner point of the nosing on a trim piece');
  near(nz.lengthMm, Math.max(...xs) - Math.min(...xs), 'its length anew');
  // without the trim: as before
  assert.equal(buildCladdingStair(cfg()).cladding.exitNosing[0].mitred, undefined);
});

// user decision 2026-11-05: the trim's reach by default as the antresola nosing's → the two meet at exactly 45°
test('the trim\'s reach by default = the antresola nosing\'s (front nosing + riser): the corner cut one straight 45° line', () => {
  const b = buildCladdingStair(cfg({ openingTrimEnabled: true, nosingFrontMm: 30, riserThicknessMm: 20, riserBoards: true }));
  assert.equal(b.config.openingTrimNoseWidthMm, null);
  assert.equal(b.config.openingTrimBoardDepthMm, null);
  assert.equal(b.openingTrim.boardDepthMm, b.config.exitNosingDepthMm, 'the board as deep as the nosing');
  assert.equal(b.openingTrim.noseWidthMm, 50);
  const [nz] = b.cladding.exitNosing;
  near(nz.overMm, 50, 'the nosing\'s reach');
  // at the opening's corner on the nosing's left end: inner mitre point, the corner, outer mitre point on one 45° line
  const o = b.slab.opening;
  const corner = o.find((p) => nz.outline.some((q) => Math.abs(q.x - p.x) < 200 && Math.abs(q.y - p.y) < 200));
  const pts = nz.outline.filter((q) => Math.hypot(q.x - corner.x, q.y - corner.y) < 300);
  for (const q of pts) near(Math.abs(q.x - corner.x), Math.abs(q.y - corner.y), '45° — as far along x as along y', 1e-6);
  // the user's own reach stays
  assert.equal(buildCladdingStair(cfg({ openingTrimEnabled: true, openingTrimNoseWidthMm: 25 })).openingTrim.noseWidthMm, 25);
});
