// The harp (user request 2026-11-18): rods from the treads (or beside the stair's side, a bracket each) up to the
// ceiling — the slab's soffit, in the opening the upper floor's ceiling; metal tubes or wooden balusters per mb; evenly,
// the clear gap ≤ harpMaxClearMm; no posts, no handrail; optionally a mounting strip on the ceiling; on the antresola
// from the floor to the upper ceiling.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings, sanitizeQuoteSettings, claddingPricesOf } from '../quote/labour.js';
import { buildCutList } from '../export/cutList.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { renderCladdingStair } from '../claddingRenderer.js';

const stair = (patch = {}) =>
  sanitizeCladdingConfig({
    ...createDefaultCladdingConfig(),
    sequence: [{ kind: 'steps', count: 14, riseMm: 185, goingMm: 270, widthMm: 1000 }],
    showSlab: true,
    railingSides: { 0: { right: true } },
    railingInfill: 'harp',
    ...patch,
  });
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

test('the harp: rods evenly with the clear gap ≤ the given, from the treads to the soffit / in the opening to the upper ceiling', () => {
  const c = stair();
  const b = buildCladdingStair(c);
  const s = b.balustrade.sections[0];
  assert.equal(s.infill, 'harp');
  assert.deepEqual([s.posts.length, s.handrail.length, s.balusters.length], [0, 0, 0], 'no posts, no handrail, no balusters');
  const h = s.harp;
  assert.ok(h.rods.length > 20);
  for (let k = 1; k < h.rods.length; k++) assert.ok(h.rods[k].s - h.rods[k - 1].s - h.sizeMm <= c.harpMaxClearMm + 1e-6, 'the clear gap');
  near(h.rods[0].s - s.s0 - h.sizeMm / 2, c.harpEndMm, 'the first rod in from the end');
  const upperZ = b.slab.finishTopZ + c.harpCeilingAboveFloorMm;
  for (const r of h.rods) {
    assert.equal(r.ceiling === 'upper' ? r.topZ : null, r.ceiling === 'upper' ? upperZ : null);
    if (r.ceiling === 'soffit') near(r.topZ, b.slab.bottomZ, 'under the slab: to its soffit');
    near(r.lengthMm, r.topZ - r.bottomZ, 'length');
  }
  assert.ok(h.rods.some((r) => r.ceiling === 'soffit') && h.rods.some((r) => r.ceiling === 'upper'), 'both ceilings on this stair');
  // the bottom: the tread's top (from above)
  assert.ok(h.rods[0].bottomZ > 0);
  assert.equal(h.brackets.length, 0, 'no brackets from above');
  assert.equal(h.strips.length, 0, 'no strip unless asked');
});

test('the harp on the side: a bracket per rod, the rod below the concrete\'s top; the mounting strip on the ceiling it reaches', () => {
  const c = stair({ harpMount: 'side', harpStrip: true });
  const b = buildCladdingStair(c);
  const h = b.balustrade.sections[0].harp;
  assert.equal(h.mount, 'side');
  assert.equal(h.brackets.length, h.rods.length);
  for (const br of h.brackets) near(Math.hypot(br.face.x - br.at.x, br.face.y - br.at.y), c.harpSideStandoffMm + h.sizeMm / 2, 'the bracket to the side face');
  assert.ok(h.strips.length >= 1);
  for (const r of h.rods) near(r.topZ, r.ceilingZ - c.harpStripThicknessMm, 'the rod ends under the strip');
  near(h.stripLengthMm, h.strips.reduce((n, x) => n + x.lengthMm, 0), 'strip total');
  // the antresola: from the floor above to its ceiling
  const a = buildCladdingStair(stair({ railingAntresola: true })).balustrade.sections.find((x) => x.kind === 'antresola');
  assert.ok(a.harp.rods.length > 0);
  for (const r of a.harp.rods) assert.equal(r.ceiling, 'upper');
});

test('the harp priced: rods per mb (tube / wooden baluster), brackets per piece, the strip per mb; no handrail line; the prices kept in the file block', () => {
  const settings = sanitizeQuoteSettings({ ...createDefaultQuoteSettings(), harpTubePerMb: 40, harpBalusterPerMb: 25, harpBracketPerPiece: 12, harpStripPerMb: 30 });
  const b = buildCladdingStair(stair({ harpMount: 'side', harpStrip: true }));
  const h = b.balustrade.sections[0].harp;
  const q = buildCladdingQuote(b, settings);
  const rods = q.lines.find((l) => l.id.endsWith('-harp'));
  near(rods.qty, Math.round(h.rodsLengthMm / 10) / 100, 'rods mb');
  near(rods.material.value, Math.round(rods.qty * 40 * 100) / 100, 'tube price');
  assert.match(rods.name, /rurki metalowe Ø 20 mm/);
  const br = q.lines.find((l) => l.id.endsWith('-harp-brackets'));
  assert.equal(br.qty, h.brackets.length);
  near(br.material.value, h.brackets.length * 12, 'brackets');
  const strip = q.lines.find((l) => l.id.endsWith('-harp-strip'));
  near(strip.material.value, Math.round(strip.qty * 30 * 100) / 100, 'strip');
  assert.ok(!q.lines.some((l) => /-handrail$/.test(l.id)), 'no handrail');
  const wood = buildCladdingQuote(buildCladdingStair(stair({ harpMaterial: 'wood' })), settings).lines.find((l) => l.id.endsWith('-harp'));
  assert.match(wood.name, /tralki drewniane/);
  near(wood.material.value, Math.round(wood.qty * 25 * 100) / 100, 'wooden baluster per mb');
  assert.equal(claddingPricesOf(settings).harpStripPerMb, 30, 'in the whole price list file');
  // drawn and listed
  assert.match(renderCladdingPlanSVG(b, {}), /<circle cx=/);
  const root = renderCladdingStair(b);
  let rodsIn3d = 0;
  root.traverse((o) => (rodsIn3d += o.name === 'HarpRod' ? 1 : 0));
  assert.equal(rodsIn3d, h.rods.length);
  const cut = buildCutList(b);
  assert.ok((cut.rows || cut).some((r) => /^RH-/.test(r.code)));
});
