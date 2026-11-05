import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingPlanSVG, claddingMeasureRefs } from '../claddingPlanRenderer.js';
import { snapMeasurePoint } from '../../plan2d/planMeasure.js';

// the plan's tape measure (user request 2026-11-05)
const b = buildCladdingStair({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], walls: { 0: { left: true } }, railingSides: { 0: { right: true } } });

test('the measure snaps to the concrete\'s, the cladding\'s, the wall\'s and the posts\' points', () => {
  const refs = claddingMeasureRefs(b);
  const has = (p) => refs.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6);
  assert.ok(has(b.concrete.elements[1].outline[0]), 'a concrete corner');
  assert.ok(has(b.cladding.treads[2].outline[1]), 'a tread corner');
  assert.ok(has(b.walls[0].outline[0]), 'a wall corner');
  assert.ok(has(b.balustrade.sections[0].posts[0].at), 'a post');
  // a click 6 mm off a concrete corner with 10 mm tolerance → the corner itself
  const c = b.concrete.elements[1].outline[0];
  const q = snapMeasurePoint({ x: c.x + 4, y: c.y - 4.5 }, refs, 10);
  assert.ok(q.snapped && q.x === c.x && q.y === c.y);
});

test('the plan draws the measures (length, Δx, Δy) and the one being drawn dashed; none by default', () => {
  const svg = renderCladdingPlanSVG(b, { measures: [{ a: { x: 0, y: 0 }, b: { x: 300, y: 400 } }], measureDraft: { a: { x: 0, y: 0 }, cursor: { x: 1000, y: 0 } } });
  assert.match(svg, /500 mm \(Δx 300 · Δy 400\)/);
  assert.match(svg, /1000 mm \(Δx 1000 · Δy 0\)/);
  assert.match(svg, /stroke-dasharray="6,4"[^>]*vector-effect/);
  assert.doesNotMatch(renderCladdingPlanSVG(b, {}), /clad-measures/);
});
