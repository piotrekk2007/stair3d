import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { signedOnZoneLine } from '../concreteModel.js';
import { pointInPolygon } from '../../geometry/polygonClip.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';

// stage 2 (user decisions 2026-11-04): a 90° winder zone; its edges measured on site from the wall corner and the
// dusza corner, the unmeasured ones generated
const zoneCfg = (winders = {}, patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    { kind: 'winders', count: 3, riseMm: 180, turn: 'right', ...winders },
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
  ],
  ...patch,
});
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const xs = (o) => o.map((p) => p.x);
const ys = (o) => o.map((p) => p.y);

test('a right winder zone: the corners from A / B, the exit flight from the zone end on, the heights on', () => {
  const b = buildCladdingStair(zoneCfg({ spaceAMm: 1300, spaceBMm: 1200 }));
  const z = b.concrete.zones[0];
  assert.equal(b.concrete.elements.length, 7);
  assert.deepEqual(b.concrete.elements.map((e) => e.kind), ['step', 'step', 'winder', 'winder', 'winder', 'step', 'step']);
  // zone start y = 540; wall corner 1300 further on the outer (left, x = 0) line; dusza corner one exit width before
  near(z.wallCorner.x, 0, 'wall corner x');
  near(z.wallCorner.y, 540 + 1300, 'wall corner y');
  near(z.duszaCorner.x, 1000, 'dusza corner x');
  near(z.duszaCorner.y, 540 + 300, 'dusza corner y');
  // the exit flight: from x = B on, its outer line y = 1840
  const exit = b.concrete.elements[5];
  assert.deepEqual([Math.min(...xs(exit.outline)), Math.max(...xs(exit.outline))], [1200, 1470]);
  assert.deepEqual([Math.min(...ys(exit.outline)), Math.max(...ys(exit.outline))], [840, 1840]);
  assert.deepEqual(b.concrete.elements.map((e) => e.topZ), [180, 360, 540, 720, 900, 1080, 1260]);
  // the zone is covered exactly: the winders' areas add up to the zone's
  const area = (o) => Math.abs(o.reduce((s, p, k) => s + p.x * o[(k + 1) % o.length].y - o[(k + 1) % o.length].x * p.y, 0) / 2);
  const zoneArea = 1000 * 1300 + 1000 * (1200 - 1000);
  near(b.concrete.elements.filter((e) => e.kind === 'winder').reduce((s, e) => s + area(e.outline), 0), zoneArea, 'zone area', 1e-3);
});

test('generated edges: the dusza ends spread evenly, equal goings on the walkline', () => {
  const b = buildCladdingStair(zoneCfg({ spaceAMm: 1250, spaceBMm: 1250 }));
  const z = b.concrete.zones[0];
  // A = Wn + 250, B = W + 250 → dusza line 500 long, three equal pieces
  const inner = z.edges.map((e) => e.innerMm);
  near(inner[1] - inner[0], 500 / 3, 'dusza piece 1');
  near(inner[2] - inner[1], 500 / 3, 'dusza piece 2');
  near(inner[3] - inner[2], 500 / 3, 'dusza piece 3');
  const g = z.walkGoingsMm;
  assert.ok(g.every((x) => x !== null));
  near(g[0], g[1], 'going 1 = 2', 1e-3);
  near(g[1], g[2], 'going 2 = 3', 1e-3);
  assert.equal(z.orderOk, true);
  assert.equal(b.diagnostics.filter((d) => d.severity === 'ERROR').length, 0);
});

test('a measured edge (from the corners) is used as given; the other end generated when only one is measured', () => {
  const b = buildCladdingStair(zoneCfg({ spaceAMm: 1300, spaceBMm: 1200, edges: [{ outerMm: -400, innerMm: -120 }, { outerMm: 350 }] }));
  const z = b.concrete.zones[0];
  near(z.edges[1].outer.x, 0, 'edge 1 on the incoming wall');
  near(z.edges[1].outer.y, 540 + 1300 - 400, 'edge 1: 400 before the wall corner');
  near(z.edges[1].inner.x, 1000, 'edge 1 at the dusza');
  near(z.edges[1].inner.y, 540 + 300 - 120, 'edge 1: 120 before the dusza corner');
  assert.equal(z.edges[1].measuredOuter, true);
  near(z.edges[2].outer.x, 350, 'edge 2: 350 past the wall corner on the exit wall');
  near(z.edges[2].outer.y, 1840, 'edge 2 on the exit wall');
  assert.equal(z.edges[2].measuredInner, false);
  // dragging on the plan gives back the same numbers
  near(signedOnZoneLine(z, 'outer', z.edges[1].outer), -400, 'outer round trip');
  near(signedOnZoneLine(z, 'inner', z.edges[1].inner), -120, 'inner round trip');
  near(signedOnZoneLine(z, 'outer', { x: 350, y: 1900 }), 350, 'a point off the wall snaps onto it');
});

test('edges out of order (crossing) are an ERROR', () => {
  const b = buildCladdingStair(zoneCfg({ edges: [{ outerMm: 500 }, { outerMm: -300 }] }));
  assert.equal(b.concrete.zones[0].orderOk, false);
  assert.ok(b.diagnostics.some((d) => d.ruleId === 'CLAD-WINDER-ORDER' && d.severity === 'ERROR'));
});

test('a left winder zone: mirrored — the exit flight along −x, the right line the outer one', () => {
  const b = buildCladdingStair(zoneCfg({ turn: 'left', spaceAMm: 1300, spaceBMm: 1200 }));
  const z = b.concrete.zones[0];
  near(z.wallCorner.x, 0, 'wall corner on the right (outer) line');
  near(z.duszaCorner.x, -1000, 'dusza corner on the left');
  const exit = b.concrete.elements[5];
  assert.deepEqual([Math.min(...xs(exit.outline)), Math.max(...xs(exit.outline))], [-1470, -1200]);
});

test('cladding on winders: front nosing past the riser board, the side nosing round the dusza corner, a riser per winder', () => {
  const b = buildCladdingStair(zoneCfg({ spaceAMm: 1250, spaceBMm: 1250 }, { sideNosingRight: true, sideNosingLeft: false, sideNosingMm: 30, nosingFrontMm: 30, riserThicknessMm: 20 }));
  const z = b.concrete.zones[0];
  const winders = b.cladding.treads.filter((t) => t.kind === 'winder');
  assert.equal(winders.length, 3);
  // the winder over the dusza corner reaches 30 mm past it into the dusza (both lines)
  const corner = z.duszaCorner;
  const over = winders.find((t) => pointInPolygon({ x: corner.x + 20, y: corner.y - 20 }, t.outline));
  assert.ok(over, 'a winder tread wraps the dusza corner with its nosing');
  // every winder its riser board along its front edge
  const risers = b.cladding.risers.filter((r) => b.concrete.elements[r.index]?.kind === 'winder');
  assert.equal(risers.length, 3);
  // the finished heights include the winders, their going on the walkline
  const rows = b.cladding.heights.filter((h) => h.kind === 'winder');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((h) => h.goingMm > 200 && h.goingMm < 500));
  // the plan draws the edge handles of the inner edges (two per edge)
  const svg = renderCladdingPlanSVG(b, {});
  assert.equal((svg.match(/class="clad-edge-handle"/g) || []).length, 4);
});

test('sanitize: a winder group keeps count − 1 edge slots, numbers only', () => {
  const c = sanitizeCladdingConfig({ sequence: [{ kind: 'winders', count: 4, riseMm: 180, turn: 'x', edges: [{ outerMm: '300' }, null, { innerMm: 'a' }, { outerMm: 1 }] }] });
  const g = c.sequence[0];
  assert.equal(g.turn, 'right');
  assert.deepEqual(g.edges, [{ outerMm: 300 }, null, null]);
});
