import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';

// walls (user request 2026-11-04): above the steps to a height, under the flight, between flights set apart
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const has = (poly, s, z) => poly.some((p) => Math.abs(p.s - s) < 1e-6 && Math.abs(p.z - z) < 1e-6);
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 6, riseMm: 180, goingMm: 270, widthMm: 1000 }], treadThicknessMm: 40, floorFinishBottomMm: 40, sideNosingLeft: true, sideNosingRight: true, sideNosingMm: 30, ...patch });
const maxX = (t) => Math.max(...t.outline.map((p) => p.x));
const minX = (t) => Math.min(...t.outline.map((p) => p.x));

test('the wall types: true (older files) = full, {type: low, heightAboveMm}, {type: under}; unknown dropped', () => {
  const c = sanitizeCladdingConfig({ walls: { 0: { left: true, right: { type: 'low', heightAboveMm: 1000 } }, 1: { left: { type: 'under' }, right: { type: 'x' } } } });
  assert.deepEqual(c.walls, { 0: { left: { type: 'full' }, right: { type: 'low', heightAboveMm: 1000 } }, 1: { left: { type: 'under' } } });
});

test('a wall above the steps: beside the stair, its top raked over the noses; walled (no side nosing)', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { right: { type: 'low', heightAboveMm: 1000 } } } }));
  const w = b.sideWalls.find((x) => x.kind === 'wall-low');
  assert.ok(w);
  for (let i = 0; i < 6; i++) assert.ok(has(w.polygon, 270 * i, 180 * (i + 1) + 40 + 1000), `over nose ${i + 1}`);
  assert.ok(has(w.polygon, 0, 0) && has(w.polygon, 6 * 270, 0), 'from the floor');
  near(w.normal.x, 1, 'outside the stair (right)');
  assert.equal(b.walls.length, 0, 'not a full wall');
  near(maxX(b.cladding.treads[2]), 1000, 'no side nosing at the wall');
  near(minX(b.cladding.treads[2]), -30, 'the open left side keeps it');
});

test('a wall under the flight: under its edge to the soffit; the side above stays open (nosing, balustrade)', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { right: { type: 'under' } } }, railingSides: { 0: { right: true } } }));
  const w = b.sideWalls.find((x) => x.kind === 'wall-under');
  assert.ok(w);
  near(w.normal.x, -1, 'its thickness under the stair');
  // the top along the concrete's soffit: never above the concrete top
  for (let i = 0; i < 6; i++) assert.ok(w.polygon.filter((p) => p.s > 270 * i && p.s < 270 * (i + 1)).every((p) => p.z <= 180 * (i + 1)));
  near(maxX(b.cladding.treads[2]), 1030, 'the side nosing stays');
  assert.equal(b.balustrade.sections.length, 1, 'the balustrade stays');
});

test('the wall between two flights set apart: the gap filled up to the slab, its sides walled', () => {
  const cfg = {
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'u-right', gapMm: 250, gapWall: true },
      { kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
    sideNosingLeft: true,
    sideNosingRight: true,
    sideNosingMm: 30,
  };
  const b = buildCladdingStair(cfg);
  const g = b.sideWalls.find((x) => x.kind === 'wall-gap');
  assert.ok(g, 'made');
  near(g.thicknessMm, 250, 'as wide as the gap');
  near(g.origin.x, 1000, 'from flight A’s inner line');
  near(Math.max(...g.polygon.map((p) => p.s)), 4 * 270, 'up to the landing');
  near(Math.min(...g.polygon.map((p) => p.s)), 0, 'from the floor end of the flights');
  near(Math.max(...g.polygon.map((p) => p.z)), b.concrete.exit.rawSlabTopZ, 'up to the slab');
  // both flights' facing sides: no side nosing
  near(maxX(b.cladding.treads[1]), 1000, 'flight A against the wall');
  near(minX(b.cladding.treads[6]), 1250, 'the return flight against the wall');
  near(maxX(b.cladding.treads[6]), 2250 + 30, 'its outer side open: nosing');
  // without the switch: no wall, the nosings back
  const open = buildCladdingStair({ ...cfg, sequence: cfg.sequence.map((s) => (s.kind === 'landing' ? { ...s, gapWall: false } : s)) });
  assert.equal(open.sideWalls.length, 0);
  near(maxX(open.cladding.treads[1]), 1030, 'no wall: nosing');
  // over the noses: the higher flight + the height
  const low = buildCladdingStair({ ...cfg, sequence: cfg.sequence.map((s) => (s.kind === 'landing' ? { ...s, gapWallTop: 'nose', gapWallAboveMm: 1000 } : s)) });
  const lw = low.sideWalls.find((x) => x.kind === 'wall-gap');
  // at v = 0: flight A's first nose (220) vs the return flight's last (its top at the floor end): the higher + 1000
  const returnTop = Math.max(...low.cladding.treads.slice(5).map((t) => t.topZ));
  assert.ok(lw.polygon.some((p) => Math.abs(p.s) < 1e-6 && Math.abs(p.z - (returnTop + 1000)) < 1), 'the return flight is the higher one at the floor end');
  // 3D: drawn
  const root = renderCladdingStair(b);
  let found = false;
  root.traverse((o) => (found ||= o.name?.startsWith('wall-gap')));
  assert.ok(found);
});
