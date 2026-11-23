// One balustrade post's own edits (user request 2026-11-23: "the first post flush with the handrail, or thicker — in
// the self-supporting stair I can change it, here not"): railingPostOverrides[post id] = {sizeMm, aboveMm, cap}.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { buildCutList } from '../export/cutList.js';

const stair = (patch = {}) =>
  sanitizeCladdingConfig({
    ...createDefaultCladdingConfig(),
    sequence: [{ kind: 'steps', count: 9, riseMm: 180, goingMm: 280, widthMm: 1000 }],
    railingSides: { 0: { right: true } },
    railingInfill: 'balusters',
    ...patch,
  });
const START = 'railing-0-right:start';

test('the first post flush with the handrail, no cap, thicker — the others as all; the handrail starts at its face', () => {
  const plain = buildCladdingStair(stair()).balustrade.sections[0];
  const c = stair({ railingPostOverrides: { [START]: { sizeMm: 120, aboveMm: 0, cap: 'none' }, bad: { sizeMm: 'x' } } });
  assert.deepEqual(Object.keys(c.railingPostOverrides), [START], 'only what is set is kept');
  const s = buildCladdingStair(c).balustrade.sections[0];
  const [first, ...rest] = s.posts;
  assert.equal(first.id, START);
  assert.deepEqual([first.size, first.aboveMm, first.cap, first.edited], [120, 0, 'none', true]);
  // flush: its top = the handrail's top there (the handrail's centre line + half its height)
  const handrailTopAt = (p) => p.topZ - p.aboveMm;
  assert.ok(Math.abs(first.topZ - handrailTopAt(plain.posts[0])) < 50, 'about the handrail top');
  assert.equal(first.topZ, handrailTopAt(first));
  // its outer face stays at the line's start; the handrail from its inner face
  assert.ok(Math.abs(first.s - first.size / 2 - s.s0) < 1e-6);
  const h0 = Math.hypot(s.handrail[0].x - first.at.x, s.handrail[0].y - first.at.y);
  assert.ok(Math.abs(h0 - first.size / 2) < 1e-6, `the handrail at the face: ${h0}`);
  for (const p of rest) assert.deepEqual([p.size, p.aboveMm, p.cap, p.edited], [c.postSizeMm, c.postAboveHandrailMm, c.postCap, false]);
  // no baluster inside the thicker post
  for (const b of s.balusters) assert.ok(Math.abs(b.at.x - first.at.x) + Math.abs(b.at.y - first.at.y) > (first.size + b.size) / 2);
  // the quote and the cut list: the sizes apart
  const q = buildCladdingQuote(buildCladdingStair(c), createDefaultQuoteSettings()).lines.find((l) => l.id.endsWith('-posts'));
  assert.match(q.dims, /1 × 120 × 120 mm/);
  const cut = buildCutList(buildCladdingStair(c)).filter((r) => /^SL-/.test(r.code));
  assert.deepEqual(cut.map((r) => [r.widthMm, r.qty]), [[90, 1], [120, 1]]);
});
