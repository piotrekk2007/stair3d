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

// user request 2026-11-23 (the user's picture): the handrail running straight into the post — both cut along one mitre
test('the handrail mitred into the first / last post: to the post\'s outer face, the post\'s top along the same plane', async () => {
  const { renderCladdingStair } = await import('../claddingRenderer.js');
  const none = buildCladdingStair(stair()).balustrade.sections[0];
  assert.equal(none.cuts.start, null);
  const c = stair({ postHandrailJoint: 'start' });
  const b = buildCladdingStair(c);
  const s = b.balustrade.sections[0];
  const [first] = s.posts;
  const last = s.posts.at(-1);
  assert.ok(first.mitre && !last.mitre, 'the first post only ("start")');
  assert.equal(first.size, c.handrailWidthMm, 'the post takes the handrail\'s width');
  assert.equal(first.cap, 'none');
  // the handrail starts at the post's OUTER face (the line's start), not plumb
  assert.ok(Math.abs(Math.hypot(s.handrail[0].x - first.at.x, s.handrail[0].y - first.at.y) - first.size / 2) < 1e-6);
  assert.equal(s.plumb.start, false);
  // the mitre plane holds the post's top edge (both its corners) — the handrail's end is cut along the same plane
  const { point, normal } = s.cuts.start;
  const m = first.mitre;
  for (const q of m.polygon.filter((p) => p.z > first.bottomZ + 1)) {
    const at = { x: m.origin.x + m.dir.x * q.s + (m.normal.x * m.thicknessMm) / 2, y: m.origin.y + m.dir.y * q.s + (m.normal.y * m.thicknessMm) / 2, z: q.z };
    const d = (at.x - point.x) * normal.x + (at.y - point.y) * normal.y + (at.z - point.z) * normal.z;
    assert.ok(Math.abs(d) < 1e-6, `the post's top on the mitre: ${d}`);
  }
  // the outer corner higher than the inner (the bend's outside), the top = the outer corner
  const tops = m.polygon.filter((p) => p.z > first.bottomZ + 1);
  assert.ok(tops.find((p) => p.s === 0).z > tops.find((p) => p.s !== 0).z);
  assert.equal(first.topZ, Math.max(...tops.map((p) => p.z)));
  // a post's own choice over the default; both ends
  assert.ok(!buildCladdingStair(stair({ postHandrailJoint: 'start', railingPostOverrides: { [START]: { mitre: false } } })).balustrade.sections[0].posts[0].mitre);
  const both = buildCladdingStair(stair({ postHandrailJoint: 'both' })).balustrade.sections[0];
  assert.ok(both.posts[0].mitre && both.posts.at(-1).mitre && both.cuts.end);
  // 3D: the post one mesh cut along the mitre, the handrail's first piece with its end on that plane
  const root = renderCladdingStair(b);
  let rail = null;
  root.traverse((o) => o.name === `Handrail-${s.id}-1` && (rail = o));
  const pos = rail.geometry.attributes.position;
  let onPlane = 0;
  for (let i = 0; i < pos.count; i++) {
    const v = { x: pos.getX(i), y: -pos.getZ(i), z: pos.getY(i) };
    if (Math.abs((v.x - point.x) * normal.x + (v.y - point.y) * normal.y + (v.z - point.z) * normal.z) < 1e-3) onPlane++;
  }
  assert.ok(onPlane >= 4, `the handrail's end face on the mitre (${onPlane} vertices)`);
});
