import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { pointInPolygon } from '../../geometry/polygonClip.js';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const ys = (o) => o.map((p) => p.y);
const xs = (o) => o.map((p) => p.x);
const zoneCfg = (winders = {}, patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    { kind: 'winders', count: 3, riseMm: 180, turn: 'right', ...winders },
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
  ],
  ...patch,
});
const rules = (b) => b.diagnostics.map((d) => d.ruleId);

// --- winder warnings (user request 2026-11-04) ---------------------------------------------------------------------

test('default winders: A / B from the straight going — the walkline goings equal it, no going warning', () => {
  const b = buildCladdingStair(zoneCfg({ count: 4 }));
  const z = b.concrete.zones[0];
  z.walkGoingsMm.forEach((g, k) => near(g, 270, `winder ${k + 1} on the walkline`, 0.01));
  assert.ok(!rules(b).includes('CLAD-WINDER-GOING'));
});

test('winders: too shallow 0.4 m from the dusza (PL-LEGAL-C-01), too narrow at the dusza (CO-MFG-J-04), an uneven walkline going', () => {
  // the corner square only: every edge from the dusza corner — no dusza width, shallow near it
  const tight = buildCladdingStair(zoneCfg({ spaceAMm: 1000, spaceBMm: 1000, count: 4 }));
  const t = tight.diagnostics;
  assert.ok(t.some((d) => d.ruleId === 'CO-MFG-J-04' && d.severity === 'WARNING' && d.value === 0), 'no width at the dusza');
  const z = tight.concrete.zones[0];
  z.legalGoingsMm.forEach((g, k) => {
    const flagged = t.some((d) => d.ruleId === 'PL-LEGAL-C-01' && d.elementId === `winder-${2 + k}`);
    assert.equal(flagged, g < 250 - 0.5, `winder ${k + 1}: ${g} at 0.4 m`);
  });
  assert.ok(t.some((d) => d.ruleId === 'PL-LEGAL-C-01'), 'a 4-winder fan in a 1 m corner is under 250 mm at 0.4 m');
  // a measured edge far off: one winder long, its neighbour short on the walkline
  const uneven = buildCladdingStair(zoneCfg({ edges: [{ outerMm: -100, innerMm: 0 }] }));
  assert.ok(uneven.diagnostics.some((d) => d.ruleId === 'CLAD-WINDER-GOING' && d.severity === 'WARNING'));
  // the dusza widths add up to the dusza line
  const sum = z.duszaWidthsMm.reduce((s, w) => s + w, 0);
  near(sum, 0, 'corner square: no dusza line');
});

// --- walls --------------------------------------------------------------------------------------------------------

test('walls: along the chosen flight sides (a turn landing’s back edge belongs to the next flight); no side nosing at a wall', () => {
  const cfg = {
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'right' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
    sideNosingLeft: true,
    sideNosingRight: true,
    sideNosingMm: 30,
  };
  const open = buildCladdingStair(cfg);
  near(Math.min(...xs(open.cladding.treads[0].outline)), -30, 'no wall: nosing on the left');
  const walled = buildCladdingStair({ ...cfg, walls: { 0: { left: true }, 1: { left: true } } });
  // flight A left (x = 0): its two steps and the landing's left edge; flight B left = the landing's back edge (y = 1540)
  const w = walled.walls;
  assert.ok(w.every((p) => p.topZ === walled.concrete.exit.rawSlabTopZ && p.bottomZ === 0));
  // (user report 2026-11-06: one wall per run, not a box per step) — the stretches it walls are its `segments`
  const segs = w.flatMap((p) => p.segments);
  assert.ok(segs.some((s) => s.key.flight === 0 && Math.abs(s.a.x) < 1e-9 && Math.abs(s.b.x) < 1e-9), 'flight A’s left side walled (x = 0)');
  assert.ok(segs.some((s) => s.key.flight === 1 && Math.abs(s.a.y - 1540) < 1e-9 && Math.abs(s.b.y - 1540) < 1e-9), 'the landing back edge = flight B’s left wall');
  assert.equal(Math.min(...w.flatMap((p) => xs(p.outline))), -120, 'a wall 120 thick left of flight A');
  assert.equal(Math.max(...w.flatMap((p) => ys(p.outline))), 1660, '… and behind the landing');
  // one solid wall round the turn, its outer corner filled (no gap where the two sides meet)
  assert.equal(w.length, 1, 'one wall along flight A, the landing and flight B');
  assert.ok(w[0].outline.some((p) => Math.abs(p.x + 120) < 1e-9 && Math.abs(p.y - 1660) < 1e-9), 'the corner (−120, 1660) filled');
  // the walled side: no nosing; the open right side keeps it
  near(Math.min(...xs(walled.cladding.treads[0].outline)), 0, 'wall: none on the left');
  near(Math.max(...xs(walled.cladding.treads[0].outline)), 1030, 'open right: nosing');
  // a step's own override still wins
  const forced = buildCladdingStair({ ...cfg, walls: { 0: { left: true } }, stepOverrides: { 1: { nosingLeft: true } } });
  near(Math.min(...xs(forced.cladding.treads[1].outline)), -30, 'own override past the wall rule');
});

// --- floor-board landing, the antresola nosing, the slab ---------------------------------------------------------

test('a floor-board landing: OSB + boards (its finished height counts them), a solid nosing piece along the front', () => {
  const cfg = {
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'none', finish: 'floorboard' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
    treadThicknessMm: 40,
    osbThicknessMm: 18,
    floorboardThicknessMm: 15,
    landingNosingDepthMm: 120,
    floorFinishBottomMm: 40,
    floorFinishTopMm: 40,
  };
  const b = buildCladdingStair(cfg);
  const landing = b.cladding.treads[2];
  assert.equal(landing.finish, 'floorboard');
  assert.equal(landing.topZ, 540 + 33);
  const h = b.cladding.heights;
  assert.equal(h[2].finishedRiseMm, 180 - 7, 'onto the landing: 7 mm less (33 instead of 40)');
  assert.equal(h[3].finishedRiseMm, 180 + 7, 'off it: 7 mm more');
  assert.ok(b.diagnostics.some((d) => d.ruleId === 'CLAD-RISE-UNEVEN' && d.elementId === 'landing-2'));
  // the parts: the nosing from the tread's front to 120 past the concrete's front line, OSB + boards behind it
  const { nosing, osb, boards } = landing.parts;
  near(Math.min(...ys(nosing.outline)), 540 - 30 - 20, 'nosing from the front');
  near(Math.max(...ys(nosing.outline)), 540 + 120, 'nosing 120 onto the concrete');
  near(Math.min(...ys(osb.outline)), 660, 'OSB behind it');
  assert.equal(osb.topZ, 540 + 18);
  assert.equal(boards.topZ, 540 + 33);
  assert.equal(nosing.topZ, boards.topZ, 'flush on top');
});

test('the antresola nosing: along the last back edge, over the exit riser, onto the slab, flush with the floor above', () => {
  const b = buildCladdingStair({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], nosingFrontMm: 30, riserThicknessMm: 20, exitNosingDepthMm: 120, floorFinishTopMm: 20, treadThicknessMm: 40 });
  const [n] = b.cladding.exitNosing;
  near(Math.min(...ys(n.outline)), 1080 - 50, 'over the exit riser by the nosing');
  near(Math.max(...ys(n.outline)), 1080 + 120, 'onto the slab');
  assert.equal(n.topZ, b.concrete.exit.rawSlabTopZ + 20);
  assert.equal(n.bottomZ, n.topZ - 40);
  assert.equal(b.cladding.risers.at(-1).topZ, n.bottomZ + 10, 'the exit riser goes into its groove');
  assert.deepEqual(n.grooves?.map((g) => g.depthMm), [10], 'the antresola nosing grooved for it');
  assert.equal(buildCladdingStair({ ...createDefaultCladdingConfig(), exitNosing: false }).cladding.exitNosing.length, 0);
});

test('the slab: its opening round the treads that need the headroom, up to the exit edge', () => {
  const b = buildCladdingStair({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 15, riseMm: 180, goingMm: 270, widthMm: 1000 }], slabThicknessMm: 220, minHeadroomMm: 2000 });
  const s = b.slab;
  const soffit = b.concrete.exit.rawSlabTopZ - 220;
  // every tread whose finished top is closer than 2 m to the soffit lies inside the opening, the others do not decide it
  for (const t of b.cladding.treads) {
    const needs = t.topZ + 2000 > soffit;
    assert.equal(s.treadsUnder.includes(t.index), needs, `tread ${t.index + 1}`);
    if (needs) {
      const ox = s.opening.map((p) => p.x);
      const oy = s.opening.map((p) => p.y);
      assert.ok(t.outline.every((p) => p.x >= Math.min(...ox) - 1e-9 && p.x <= Math.max(...ox) + 1e-9 && p.y >= Math.min(...oy) - 1e-9 && p.y <= Math.max(...oy) + 1e-9));
    }
  }
  near(Math.max(...ys(s.opening)), 15 * 270, 'the opening ends at the last back edge');
  assert.ok(pointInPolygon({ x: 500, y: 15 * 270 + 500 }, s.outline), 'the slab goes on past the exit');
});

test('the opening of an L stair is an L: the empty corner beside the flights stays slab', () => {
  const b = buildCladdingStair(createDefaultCladdingConfig());
  const o = b.slab.opening;
  assert.ok(o.length > 4, `an L outline (${o.length} points)`);
  // the corner the stair leaves empty (right of flight A, below flight B) is not in the opening
  const a = b.concrete.elements[0];
  const ax = Math.max(...a.outline.map((p) => p.x));
  const lowB = Math.min(...b.concrete.elements.at(-1).outline.map((p) => p.y));
  assert.equal(pointInPolygon({ x: ax + 200, y: lowB - 200 }, o), false);
});
