import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { wallListOf, wallCells, toggleWallCell, wallRange } from '../wallEdits.js';

// the wall editor (user request 2026-11-05): "w 3 biegu pierwszy stopień jest ściana tylko z prawej strony, a na
// kolejnych 4 ściany idą już po obu stronach i dodatkowo ściana jest tylko od płyty schodów w górę"
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
// one straight flight of 5 steps (elements 0..4): the first walled on the right only, the next four on both sides —
// the walls from the stair's concrete up (nothing under the flight)
const cfg = (patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [{ kind: 'steps', count: 5, riseMm: 180, goingMm: 270, widthMm: 1000 }],
  sideNosingLeft: true,
  sideNosingRight: true,
  wallList: [
    { id: 'r', flight: 0, side: 'right', type: 'above', heightAboveMm: 0, from: 0, to: 4 },
    { id: 'l', flight: 0, side: 'left', type: 'above', heightAboveMm: 0, from: 1, to: 4 },
  ],
  ...patch,
});

test('walls on some steps only: the side nosings follow (L on the first, CZ between the walls)', () => {
  const b = buildCladdingStair(cfg());
  assert.deepEqual(b.cladding.treads.map((t) => t.sideType), ['L', 'CZ', 'CZ', 'CZ', 'CZ']);
});

test('a side split where its wall changes: the open stretch carries the balustrade, the walled one the skirting', () => {
  const b = buildCladdingStair(cfg({ skirtingEnabled: true, railingSides: { 0: { left: true } }, wallRails: { 0: { left: true } } }));
  const left = b.sideRuns.filter((r) => r.key.side === 'left');
  assert.deepEqual(left.map((r) => [r.walled, r.pieces.length, r.id]), [[false, 1, '0-left'], [true, 4, '0-left-s1']]);
  // the balustrade on the first step's open left side only, the wall handrail along the four walled ones
  assert.equal(b.balustrade.sections.length, 1);
  near(b.balustrade.sections[0].s1 - b.balustrade.sections[0].s0, 270, 'the balustrade one going long');
  assert.equal(b.balustrade.wallRails.filter((w) => w.key.side === 'left').length, 1);
  // the skirting on the left from the second step, on the right the whole flight
  const sk = b.finish.skirting;
  assert.deepEqual(sk.map((s) => s.id).sort(), ['skirting-0-left-s1', 'skirting-0-right']);
});

test('the wall "from the stair\'s concrete up": its bottom along the concrete\'s soffit, up to the slab, nothing below', () => {
  const b = buildCladdingStair(cfg());
  const w = b.sideWalls.find((x) => x.kind === 'wall-above' && x.key.side === 'right');
  assert.ok(w, 'the right wall');
  const zs = w.polygon.map((p) => p.z);
  near(Math.max(...zs), b.concrete.exit.rawSlabTopZ, 'up to the slab');
  assert.ok(w.polygon.some((p) => Math.abs(p.s - 540) < 1e-6 && p.z > 100), 'over the third step: up from the concrete, not from the floor');
  // the bottom = the soffit (it rises with the flight)
  const bottom = w.polygon.filter((p) => p.z < b.concrete.exit.rawSlabTopZ - 1);
  assert.ok(bottom.at(-1).z > bottom[0].z + 500, 'raked along the soffit');
  // a full wall would stand on the floor instead
  // (one solid wall along the whole side — user report 2026-11-06 — not a box per step)
  const full = buildCladdingStair(cfg({ wallList: [{ id: 'f', flight: 0, side: 'right', type: 'full', from: null, to: null }] })).walls;
  assert.equal(full.length, 1);
  assert.equal(full[0].segments.length, 5, 'made of the five steps’ stretches');
  assert.equal(full[0].outline.length, 4, 'one flat face: the collinear joints dropped');
});

test('the older per-flight walls still read as the whole side; the list sanitized', () => {
  const old = buildCladdingStair({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 }], walls: { 0: { left: true } } });
  assert.deepEqual(wallListOf(old.config).map((w) => [w.flight, w.side, w.type, w.from, w.to]), [[0, 'left', 'full', null, null]]);
  const s = sanitizeCladdingConfig({ wallList: [{ flight: 0, side: 'up', type: 'full' }, { flight: '1', side: 'left', type: 'above', from: '2', to: '' }] });
  assert.deepEqual(s.wallList, [{ id: 'w0', flight: 1, side: 'left', type: 'above', heightAboveMm: 0, from: 2, to: null }]);
});

test('the plan\'s wall mode: a click on a step\'s side takes it out of its wall / grows the neighbouring wall / adds one', () => {
  const b = buildCladdingStair(cfg());
  const cells = wallCells(b.concrete);
  const list = wallListOf(b.config);
  // out of the middle of the right wall → split in two
  const split = toggleWallCell(list, cells, { index: 2, flight: 0, side: 'right' });
  assert.deepEqual(split.filter((w) => w.side === 'right').map((w) => wallRange(w, cells)), [[0, 1], [3, 4]]);
  // back in → the neighbouring wall grows over it
  const back = toggleWallCell(split, cells, { index: 2, flight: 0, side: 'right' });
  assert.deepEqual(back.filter((w) => w.side === 'right').map((w) => wallRange(w, cells)).sort(), [[0, 2], [3, 4]]);
  // the left side's first step → the left wall grows to the start
  const grown = toggleWallCell(list, cells, { index: 0, flight: 0, side: 'left' });
  assert.deepEqual(wallRange(grown.find((w) => w.id === 'l'), cells), [0, 4]);
  // the plan draws a clickable cell per step side in the wall mode
  assert.equal((renderCladdingPlanSVG(b, { mode: 'walls' }).match(/class="clad-wall-cell"/g) || []).length, 10);
  assert.doesNotMatch(renderCladdingPlanSVG(b, {}), /clad-wall-cell/);
});
