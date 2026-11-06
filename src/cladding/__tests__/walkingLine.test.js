import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { walkingLine, roundCorners } from '../walkingLine.js';

// user report 2026-11-06: the plan's walking line was a broken line through the middle of every element — a sharp
// 90° corner on a landing, a zigzag through the winders. It must run smoothly (as the self-supporting plan's).
const steps = (count, extra = {}) => ({ kind: 'steps', count, riseMm: 180, goingMm: 270, widthMm: 1000, ...extra });
const cfg = (sequence) => ({ ...createDefaultCladdingConfig(), sequence });
const CASES = {
  'L on a landing (the default)': createDefaultCladdingConfig(),
  'L on winders': cfg([steps(2), { kind: 'winders', count: 3, riseMm: 180, turn: 'right' }, steps(3)]),
  'U on one landing': cfg([steps(5), { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'u-left', gapMm: 100 }, steps(5)]),
  'U on two landings': cfg([steps(4), { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'right' }, steps(1), { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'right' }, steps(4)]),
};

/** The drawn walking line (the plan's solid red polyline) and its sharpest bend between two chords (°). */
function drawn(built) {
  const svg = renderCladdingPlanSVG(built);
  const m = svg.match(/<polyline points="([^"]+)" fill="none" stroke="#c0392b" stroke-width="1.5"/);
  const p = m[1].trim().split(/\s+/).map((s) => s.split(',').map(Number));
  let worst = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]);
    const b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
    worst = Math.max(worst, Math.abs(((((b - a) * 180) / Math.PI + 540) % 360) - 180));
  }
  return { points: p, worst };
}

for (const [name, config] of Object.entries(CASES))
  test(`the walking line bends smoothly — ${name}`, () => {
    const b = buildCladdingStair(config);
    const { worst } = drawn(b);
    assert.ok(worst <= 6, `the sharpest bend is ${worst.toFixed(1)}° (a broken line)`);
  });

test('the walking line runs along the flights\' axes and through a winder zone on its own walkline', () => {
  const b = buildCladdingStair(CASES['L on winders']);
  const line = walkingLine(b.concrete);
  const first = b.concrete.elements[0];
  const mid = (o) => o.reduce((s, p) => s + p.x, 0) / o.length;
  // the first flight: the line stays on its axis (the middle across it)
  for (const p of line.filter((q) => q.y < Math.max(...first.outline.map((o) => o.y)))) assert.ok(Math.abs(p.x - mid(first.outline)) < 1e-6, `x ${p.x}`);
  // the zone's walkline points are on the drawn line (the arc's chords kept, only their joints eased)
  const z = b.concrete.zones[0].walkline;
  const near = (p) => Math.min(...line.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
  const midArc = z[Math.floor(z.length / 2)];
  assert.ok(near(midArc) < 2, `the arc's middle ${near(midArc).toFixed(2)} mm off`);
});

test('roundCorners: a 90° corner becomes a tangent arc within half of each segment; straight points stay', () => {
  const r = roundCorners([{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 1000, y: 1000 }]);
  assert.deepEqual(r[0], { x: 0, y: 0 });
  assert.deepEqual(r.at(-1), { x: 1000, y: 1000 });
  // radius 500 (half the segment), centre (500, 500): every arc point 500 from it
  for (const p of r.slice(1, -1)) assert.ok(Math.abs(Math.hypot(p.x - 500, p.y - 500) - 500) < 1e-6);
  assert.deepEqual(roundCorners([{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 9 }]).length, 3);
});
