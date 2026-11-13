import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { trimEdges, buildOpeningTrim } from '../openingTrimModel.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { renderCladdingStair } from '../claddingRenderer.js';

// user report 2026-11-13 (a U stair, 9 steps + a landing + 6 steps, the opening drawn by hand)
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const uStair = (patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [
    { kind: 'steps', count: 9, riseMm: 185, goingMm: 270, widthMm: 1100 },
    { kind: 'landing', riseMm: 185, depthMm: 835, turn: 'u-right', gapMm: 0, finish: 'floorboard' },
    { kind: 'steps', count: 6, riseMm: 185, goingMm: 270, widthMm: 1130 },
  ],
  riserBoards: true,
  showSlab: true,
  openingManual: [{ x: 0, y: 810 }, { x: 1080, y: 810 }, { x: 2230, y: 810 }, { x: 2230, y: 3265 }, { x: 0, y: 3265 }],
  ...patch,
});

test('fajka: an opening edge on the exit edge’s LINE but not over it (over the lower flight of a U) can carry a trim', () => {
  const c = uStair({ openingTrimEnabled: true, openingTrimEdges: { 0: true, 1: false, 2: false, 3: false, 4: false } });
  const b = buildCladdingStair(c);
  const edges = trimEdges(b, c);
  assert.equal(edges[0].exit, false, 'x 0..1080 is over flight 1, not the exit (1100..2230)');
  assert.equal(edges[1].exit, true);
  assert.equal(edges[0].on, true);
  const piece = buildOpeningTrim(b, c).pieces.find((p) => p.edge === 0);
  assert.ok(piece, 'the trim is built there');
  // straight on into the antresola nosing: it runs on to the nosing's end (x 1100), butted square
  const nosing = b.cladding.exitNosing[0];
  const xs = piece.outline.map((p) => p.x);
  near(Math.max(...xs), Math.min(nosing.edge.a.x, nosing.edge.b.x), 'up to the nosing');
  near(Math.min(...xs), 0, 'from the corner');
});

test('the handrail stops at the end posts’ faces towards the run (it ran through them to their far faces), ends cut plumb', () => {
  const c = uStair({ railingSides: { 0: { right: true }, 1: { right: true } }, postSizeMm: 90 });
  const b = buildCladdingStair(c);
  for (const s of b.balustrade.sections) {
    const [p0, p1] = [s.posts[0], s.posts.at(-1)];
    const at = (q) => {
      // the handrail's end's s along the plan line: its distance from the line's start point
      const start = s.path[0];
      return Math.hypot(q.x - start.x, q.y - start.y);
    };
    near(at(s.handrail[0]), p0.s + 45 - s.s0, `${s.id}: starts at the first post's face`, 1e-3);
    near(at(s.handrail.at(-1)), p1.s - 45 - s.s0, `${s.id}: ends at the last post's face`, 1e-3);
    assert.deepEqual(s.plumb, { start: true, end: true });
  }
  // the post removed: the handrail runs on to the line's end, square
  const id = b.balustrade.sections[0].id;
  const b2 = buildCladdingStair({ ...c, railingPostEdits: { [id]: { added: [], removed: [`${id}:end`] } } });
  const s2 = b2.balustrade.sections.find((s) => s.id === id);
  assert.equal(s2.plumb.end, false);
  // the 3D handrail's first piece: its end face plumb (all its end corners at the same plan distance along the run)
  const group = renderCladdingStair(b);
  let piece = null;
  group.traverse((o) => {
    if (!piece && o.name === `Handrail-${id}-1`) piece = o;
  });
  assert.ok(piece);
  const pos = piece.geometry.getAttribute('position');
  // (the start face = the first 6 vertices: its four corners)
  const ys = Array.from({ length: 6 }, (_, k) => -pos.getZ(k));
  const xs = Array.from({ length: 6 }, (_, k) => pos.getX(k));
  near(Math.max(...ys) - Math.min(...ys), 0, 'the end face in one vertical plane across the flight (plan y)', 1e-3);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 50, 'across the handrail’s width');
});

test('wall handrails one by one: on / off per walled stretch, cut back from either end, own height, own ends', () => {
  const base = { ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 6, riseMm: 180, goingMm: 270, widthMm: 1000 }], walls: { 0: { left: true, right: true } } };
  // none switched on: both walled sides offered as spots
  const b0 = buildCladdingStair(base);
  assert.equal(b0.balustrade.wallRails.length, 0);
  assert.equal(b0.balustrade.wallRailSpots.length, 2);
  assert.match(b0.balustrade.wallRailSpots[0].label, /^bieg 1 [LP], stopnie 1–6$/);
  // one switched on by hand (a click on the plan), cut back 270 from the start and 100 from the end, 1000 high, returned
  const runId = b0.balustrade.wallRailSpots.find((w) => w.key.side === 'left').runId;
  const c = sanitizeCladdingConfig({ ...base, wallRailEdits: { [runId]: { on: true, fromMm: 270, toMm: 100, heightMm: 1000, return: true } } });
  assert.deepEqual(c.wallRailEdits[runId], { on: true, fromMm: 270, toMm: 100, heightMm: 1000, return: true });
  const b = buildCladdingStair(c);
  assert.equal(b.balustrade.wallRails.length, 1);
  const w = b.balustrade.wallRails[0];
  near(w.s0, w.runS0 + 270, 'cut back at the start');
  near(w.s1, w.runS1 - 100, 'cut back at the end');
  assert.equal(w.return, true);
  assert.equal(w.handrail.length > 2 && Math.hypot(w.handrail[0].x - w.ends.start.x, w.handrail[0].y - w.ends.start.y) > 1, true, 'returned into the wall');
  // its own height: the same rail at the settings' 900 is 100 lower point by point
  const at900 = buildCladdingStair({ ...c, wallRailEdits: { [runId]: { ...c.wallRailEdits[runId], heightMm: undefined } } }).balustrade.wallRails[0];
  assert.equal(at900.handrail.length, w.handrail.length);
  w.handrail.forEach((q, k) => near(q.z - at900.handrail[k].z, 100, `point ${k}: 1000 vs 900`));
  // the flight side switched on for both, one stretch switched off by hand
  const b2 = buildCladdingStair({ ...base, wallRails: { 0: { left: true, right: true } }, wallRailEdits: { [runId]: { on: false } } });
  assert.equal(b2.balustrade.wallRails.length, 1);
  assert.notEqual(b2.balustrade.wallRails[0].runId, runId);
  // the plan's post mode: the rail's ends to drag, the spot to click
  const svg = renderCladdingPlanSVG(b2, { mode: 'posts' });
  assert.equal((svg.match(/class="clad-wall-rail-end"/g) || []).length, 2);
  assert.match(svg, new RegExp(`class="clad-wall-rail-spot" data-run="${runId}"`));
  assert.doesNotMatch(renderCladdingPlanSVG(b2, { mode: 'select' }), /clad-wall-rail-end/);
  // cut back too far: kept at least 200 mm long
  const short = buildCladdingStair({ ...base, wallRailEdits: { [runId]: { on: true, fromMm: 5000 } } }).balustrade.wallRails[0];
  near(short.s1 - short.s0, 200, 'the least length');
});
