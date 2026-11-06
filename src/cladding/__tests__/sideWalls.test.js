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

// user request 2026-11-06: the walls that are not full ones (to a height / above the steps / under) joined round a
// turn too — one folded body, the corner filled (as the full walls), no seam
test('the walls of one kind meeting round a turn: one folded body, its outer corner mitred', async () => {
  const { joinSideWalls } = await import('../sideWallsModel.js');
  for (const type of ['low', 'above', 'under']) {
    const b = buildCladdingStair({ ...createDefaultCladdingConfig(), wallList: [0, 1].map((flight) => ({ id: `w${flight}`, flight, side: 'left', type, heightAboveMm: 900, from: null, to: null })) });
    assert.equal(b.sideWallBodies.length, 1, type);
    const body = b.sideWallBodies[0];
    assert.equal(body.ids.length, 2, `${type}: both flights' walls`);
    assert.ok(b.sideWalls.every((w) => w.bodyId === body.id), `${type}: the pieces marked (the 3D draws the body)`);
    assert.equal(body.path.length, 3, `${type}: one corner`);
    const [cx, cy] = [body.back[1].x, body.back[1].y];
    // the corner of the L's outer side at (0, 2870): the back line meets at the mitre — outward for a wall beside the
    // stair (−120, 2990), inward for the one under its edge (120, 2750)
    const expect = type === 'under' ? [120, 2750] : [-120, 2990];
    assert.ok(Math.abs(cx - expect[0]) < 1e-6 && Math.abs(cy - expect[1]) < 1e-6, `${type}: corner ${cx}, ${cy}`);
    // the bottom / top lines run on through the joint (one region, cs increasing)
    for (const line of [body.bottom, body.top]) assert.ok(line.every((p, k) => k === 0 || p.s >= line[k - 1].s - 1e-6), `${type}: in order`);
    // 3D: ONE mesh for the two (not one per flight), every vertex a number, reaching the corner's back point
    const meshes = [];
    renderCladdingStair(b).traverse((o) => o.isMesh && o.name?.startsWith(`wall-${type}`) && meshes.push(o));
    assert.equal(meshes.length, 1, `${type}: one mesh`);
    const pos = meshes[0].geometry.attributes.position;
    assert.ok(pos.count > 0 && [...pos.array].every(Number.isFinite), `${type}: a valid body`);
    let reach = false;
    for (let i = 0; i < pos.count; i++) reach ||= Math.abs(pos.getX(i) - expect[0]) < 1e-3 && Math.abs(-pos.getZ(i) - expect[1]) < 1e-3;
    assert.ok(reach, `${type}: the mitred corner in the mesh`);
  }
  // a single flight's wall stays as it was (no body)
  const one = buildCladdingStair({ ...createDefaultCladdingConfig(), wallList: [{ id: 'w', flight: 0, side: 'left', type: 'low', heightAboveMm: 900, from: null, to: null }] });
  assert.equal(one.sideWallBodies.length, 0);
  assert.equal(joinSideWalls([], 120).length, 0);
});
