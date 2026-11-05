import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';

// glass between posts held by metal clamps on the posts (user request 2026-11-05, as the self-supporting railingGlass.js)
const cfg = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 6, riseMm: 180, goingMm: 270, widthMm: 1000 }], railingSides: { 0: { right: true } }, railingInfill: 'glass-posts', glassClampsPerSide: 2, postSizeMm: 90, glassGapMm: 20, ...patch });

test('every pane between posts: two clamps at each edge, from the post\'s face over the pane\'s edge, within its height', () => {
  const b = buildCladdingStair(cfg());
  const s = b.balustrade.sections[0];
  assert.ok(s.panes.length >= 1);
  for (const p of s.panes) {
    assert.equal(p.clamps.length, 4);
    const ss = p.polygon.map((q) => q.s);
    const [s0, s1] = [Math.min(...ss), Math.max(...ss)];
    const atStart = p.clamps.filter((c) => Math.abs(c.s - s0) < 1e-6);
    const atEnd = p.clamps.filter((c) => Math.abs(c.s - s1) < 1e-6);
    assert.equal(atStart.length, 2);
    assert.equal(atEnd.length, 2);
    // the post's face 20 (the gap) before the pane's edge
    for (const c of atStart) assert.ok(Math.abs(c.s - c.postFaceS - 20) < 1e-6);
    for (const c of atEnd) assert.ok(Math.abs(c.postFaceS - c.s - 20) < 1e-6);
    const zs = p.polygon.map((q) => q.z);
    for (const c of p.clamps) assert.ok(c.z > Math.min(...zs) && c.z < Math.max(...zs), 'within the pane');
  }
  // 3D: one block per clamp; the quote's fixings = the clamps
  let n = 0;
  renderCladdingStair(b).traverse((o) => o.name === 'GlassClamp' && n++);
  assert.equal(n, s.panes.reduce((t, p) => t + p.clamps.length, 0));
  const line = buildCladdingQuote(b, createDefaultQuoteSettings()).lines.find((l) => l.id === `${s.id}-glass-fixings`);
  assert.equal(line.qty, n);
  // glass on the concrete's side: rotules, no clamps
  assert.ok(buildCladdingStair(cfg({ railingInfill: 'glass-side' })).balustrade.sections[0].panes.every((p) => p.clamps.length === 0));
});
