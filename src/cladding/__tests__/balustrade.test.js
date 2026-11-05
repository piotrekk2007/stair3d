import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { sNearest } from '../balustradeModel.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';

// the balustrade's types and editors (user request 2026-11-04 — as in the self-supporting module)
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 8, riseMm: 180, goingMm: 270, widthMm: 1000 }], railingSides: { 0: { right: true } }, postSizeMm: 90, ...patch });
const tall = (patch = {}) => straight({ sequence: [{ kind: 'steps', count: 15, riseMm: 180, goingMm: 270, widthMm: 1000 }], railingSides: {}, railingAntresola: true, ...patch });

test('round balusters: the shape on every baluster, drawn as cylinders', () => {
  const b = buildCladdingStair(straight({ balusterShape: 'round' }));
  const [s] = b.balustrade.sections;
  assert.ok(s.balusters.length > 0 && s.balusters.every((x) => x.shape === 'round'));
  const root = renderCladdingStair(b);
  const bal = root.getObjectByName('Baluster');
  // (the wood-grain pass re-makes the geometry: a 16-sided cylinder has far more vertices than a box's 36)
  assert.ok(bal.geometry.getAttribute('position').count > 100, `${bal.geometry.getAttribute('position').count} vertices`);
});

test('glass between posts: one pane per span, posts added so no pane is wider than allowed, clamps counted', () => {
  const b = buildCladdingStair(straight({ railingInfill: 'glass-posts', glassMaxWidthMm: 800, glassGapMm: 20, glassClampsPerSide: 2 }));
  const [s] = b.balustrade.sections;
  assert.equal(s.balusters.length, 0);
  assert.ok(s.panes.length >= 3, `${s.panes.length} panes`);
  assert.ok(s.panes.every((p) => p.widthMm <= 800 + 1e-6), 'no pane over the width');
  assert.equal(s.posts.length, s.panes.length + 1, 'a post between every two panes');
  assert.equal(s.fixings, s.panes.length * 4);
  // the panes over the noses, under the handrail
  for (const p of s.panes) assert.ok(Math.min(...p.polygon.map((q) => q.z)) > 0 && Math.max(...p.polygon.map((q) => q.z)) < s.handrail.at(-1).z + 100);
});

test('glass on the concrete side: no posts, the panes outside the concrete below the treads, the handrail on them, no side nosing there', () => {
  const b = buildCladdingStair(straight({ railingInfill: 'glass-side', glassStandoffMm: 20, glassThicknessMm: 17, glassOverlapMm: 120, glassMaxWidthMm: 1200, sideNosingRight: true, sideNosingMm: 30 }));
  const [s] = b.balustrade.sections;
  assert.equal(s.posts.length, 0);
  assert.ok(s.panes.length >= 2);
  // the plane 20 + 17 / 2 outside the concrete's side (x = 1000)
  near(s.handrail[0].x, 1000 + 20 + 8.5, 'the handrail on the glass');
  // the pane reaches 120 below the concrete top of the first tread
  assert.ok(s.panes[0].polygon.some((q) => Math.abs(q.z - (180 - 120)) < 1e-6));
  assert.equal(s.fixings, s.panes.length * 2);
  near(Math.max(...b.cladding.treads[3].outline.map((p) => p.x)), 1000, 'no side nosing against the glass');
});

test('posts by hand: added on the line, an automatic one removed (and restored)', () => {
  const base = buildCladdingStair(straight());
  const id = base.balustrade.sections[0].id;
  const s = sNearest(base.balustrade.sections[0], { x: 950, y: 1000 });
  near(s.s, 1000, 'the nearest point on the line');
  const edited = buildCladdingStair(straight({ railingPostEdits: { [id]: { added: [{ id: 'a', s: 1000 }], removed: [`${id}:end`] } } }));
  const e = edited.balustrade.sections[0];
  assert.ok(e.posts.some((p) => p.id === `${id}:m-a` && Math.abs(p.at.y - 1000) < 1e-6 && p.manual));
  assert.ok(!e.posts.some((p) => p.id === `${id}:end`));
  assert.deepEqual(e.removedPosts.map((p) => p.id), [`${id}:end`]);
  // no baluster where the new post stands
  assert.ok(e.balusters.every((b) => Math.abs(b.at.y - 1000) > 45));
});

test('the antresola per edge: an edge switched off splits it; the opening drawn by hand is used', () => {
  const on = buildCladdingStair(tall());
  const a = on.balustrade.sections.filter((s) => s.kind === 'antresola');
  assert.equal(a.length, 1);
  // switch off one of its edges (not the exit edge): two pieces, or one shorter
  const o = on.slab.opening;
  const exitY = 15 * 270;
  const k = o.findIndex((p, i) => {
    const q = o[(i + 1) % o.length];
    return !(Math.abs(p.y - exitY) < 1 && Math.abs(q.y - exitY) < 1) && Math.abs(p.x - q.x) < 1;
  });
  const off = buildCladdingStair(tall({ railingAntresolaEdges: { [k]: false } }));
  const b = off.balustrade.sections.filter((s) => s.kind === 'antresola');
  assert.ok(b.reduce((sum, s) => sum + s.lengthMm, 0) < a[0].lengthMm - 100, 'shorter by that edge');
  // a hand-drawn opening (wider): the slab's opening and the antresola follow it
  const manual = [{ x: -200, y: 2000 }, { x: 1200, y: 2000 }, { x: 1200, y: exitY }, { x: -200, y: exitY }];
  const m = buildCladdingStair(tall({ openingManual: manual }));
  assert.equal(m.slab.manual, true);
  assert.deepEqual(m.slab.opening.map((p) => [p.x, p.y]), manual.map((p) => [p.x, p.y]));
  const ma = m.balustrade.sections.find((s) => s.kind === 'antresola');
  assert.ok(ma.handrail.some((p) => Math.abs(p.x - (-200 - 60)) < 1e-6), 'along the moved edge, 60 back onto the slab');
});

test('the quote: glass per m² of its blanks and its fixings from the shared price list', () => {
  const b = buildCladdingStair(straight({ railingInfill: 'glass-side' }));
  const s = createDefaultQuoteSettings();
  s.priceList.find((p) => p.materialId === 'railing-glass').price = 600;
  s.priceList.find((p) => p.materialId === 'railing-glass-fixing').price = 45;
  const q = buildCladdingQuote(b, s);
  const sec = b.balustrade.sections[0];
  const glass = q.lines.find((l) => l.id === `${sec.id}-glass`);
  near(glass.qty, Math.round(sec.panes.reduce((t, p) => t + p.blankAreaM2, 0) * 100) / 100, 'm²');
  near(glass.material.value, Math.round(600 * glass.qty * 100) / 100, 'glass price', 0.02);
  near(q.lines.find((l) => l.id === `${sec.id}-glass-fixings`).material.value, 45 * sec.fixings, 'rotules');
  assert.equal(q.lines.some((l) => l.id === `${sec.id}-posts`), false, 'no posts: no post line');
});
