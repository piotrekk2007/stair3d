// Metal balusters with a loop (user request 2026-11-23, the user's picture): a 10 mm square tube, a straight baluster
// and beside it one with an elongated loop in its middle, alternating along the side; the wooden handrail on posts as
// with balusters; priced per piece, two prices (straight / with a loop).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings, sanitizeQuoteSettings, claddingPricesOf } from '../quote/labour.js';
import { buildCutList } from '../export/cutList.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { claddingFacts } from '../quote/claddingOffer.js';

const stair = (patch = {}) =>
  sanitizeCladdingConfig({
    ...createDefaultCladdingConfig(),
    sequence: [{ kind: 'steps', count: 12, riseMm: 180, goingMm: 270, widthMm: 1000 }],
    railingSides: { 0: { right: true } },
    railingInfill: 'metal-loop',
    ...patch,
  });

test('metal balusters: the tube, every second one with a loop in its middle, in the balustrade\'s plane; posts and handrail stay', () => {
  const c = stair();
  assert.equal(c.railingInfill, 'metal-loop', 'a known infill');
  assert.equal(c.loopTubeMm, 10);
  const s = buildCladdingStair(c).balustrade.sections[0];
  assert.equal(s.balusters.length, 0, 'no wooden balusters');
  assert.ok(s.posts.length >= 2 && s.handrail.length >= 2, 'posts and the handrail as with balusters');
  const m = s.metalBalusters;
  assert.ok(m.length >= 20, `${m.length}`);
  for (let k = 1; k < m.length; k++) assert.ok(m[k].s > m[k - 1].s, 'along the line');
  m.forEach((b, k) => assert.equal(!!b.loop, k % 2 === 1, `${k}: alternating`));
  for (const b of m) {
    assert.equal(b.size, 10);
    if (!b.loop) {
      assert.equal(b.parts.length, 1);
      assert.ok(Math.abs(b.lengthMm - (b.topZ - b.bottomZ)) < 1e-6);
      continue;
    }
    const ring = b.parts.find((p) => p.closed).points;
    const zs = ring.map((p) => p.z);
    const mid = (b.bottomZ + b.topZ) / 2;
    assert.ok(Math.abs((Math.max(...zs) + Math.min(...zs)) / 2 - mid) < 1e-6, 'the loop in the middle of the height');
    assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - (c.loopHeightMm - c.loopTubeMm)) < 1e-6, 'its height (centre line)');
    // in the plane: every point on the line through the baluster along the balustrade's direction
    const u = ring.map((p) => (p.x - b.at.x) * b.dir.x + (p.y - b.at.y) * b.dir.y);
    for (const p of ring) assert.ok(Math.abs((p.x - b.at.x) * b.dir.y - (p.y - b.at.y) * b.dir.x) < 1e-6, 'in the balustrade plane');
    assert.ok(Math.abs(Math.max(...u) - Math.min(...u) - (c.loopWidthMm - c.loopTubeMm)) < 1e-6, 'its width (centre line)');
    // the developed length: the straights below / above + the loop's two straights and two half circles (centre line)
    const R = (c.loopWidthMm - c.loopTubeMm) / 2;
    const ch = c.loopHeightMm - c.loopTubeMm;
    assert.ok(Math.abs(b.lengthMm - (b.topZ - b.bottomZ - ch + 2 * Math.PI * R + 2 * (ch - 2 * R))) < 1e-6, 'the developed length counts the loop');
  }
  // a baluster too short for its loop stays straight
  const short = buildCladdingStair(stair({ loopHeightMm: 1200 })).balustrade.sections[0].metalBalusters;
  assert.ok(short.filter((b) => b.loop).every((b) => b.loop.heightMm <= b.topZ - b.bottomZ - 120 + 1e-6));
});

test('metal balusters priced per piece (straight / with a loop), not as wood; in the 3D, the plan, the offer; prices kept in the file block', () => {
  const b = buildCladdingStair(stair());
  const m = b.balustrade.sections[0].metalBalusters;
  const loops = m.filter((x) => x.loop).length;
  const settings = sanitizeQuoteSettings({ ...createDefaultQuoteSettings(), metalBalusterPerPiece: 40, metalLoopBalusterPerPiece: 95 });
  const q = buildCladdingQuote(b, settings);
  const plain = q.lines.find((l) => l.id.endsWith('-metal-balusters'));
  const loop = q.lines.find((l) => l.id.endsWith('-metal-loop-balusters'));
  assert.equal(plain.qty, m.length - loops);
  assert.equal(loop.qty, loops);
  assert.equal(plain.material.value, 40 * (m.length - loops));
  assert.equal(loop.material.value, 95 * loops);
  assert.ok(!q.lines.some((l) => l.id.endsWith('-balusters') && /^Tralki —/.test(l.name)), 'no wooden baluster line');
  assert.ok(q.lines.some((l) => l.id.endsWith('-handrail')), 'the handrail still priced');
  assert.deepEqual([claddingPricesOf(settings).metalBalusterPerPiece, claddingPricesOf(settings).metalLoopBalusterPerPiece], [40, 95]);
  // not in the joinery's cut list
  assert.ok(!buildCutList(b).some((r) => /^TR-/.test(r.code)));
  // 3D: one mesh per baluster, metal
  const root = renderCladdingStair(b);
  const meshes = [];
  root.traverse((o) => o.name?.startsWith('MetalBaluster') && meshes.push(o));
  assert.equal(meshes.length, m.length);
  assert.ok(meshes[1].geometry.attributes.position.count > meshes[0].geometry.attributes.position.count, 'the loop drawn');
  // the plan: a mark per baluster
  assert.equal((renderCladdingPlanSVG(b, {}).match(/class="metal-baluster/g) || []).length, m.length);
  assert.match(claddingFacts(b, settings).rows.find(([k]) => k === 'Balustrada')[1], /tralki metalowe z oczkiem/);
});
