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

// user request 2026-11-18: a harp on flight 1, balusters on flight 2, a harp on the antresola — and a balustrade only
// along some steps of a side
const twoFlights = (patch = {}) =>
  sanitizeCladdingConfig({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 9, riseMm: 185, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 185, depthMm: 1000, turn: 'u-right', gapMm: 100, finish: 'wood' },
      { kind: 'steps', count: 6, riseMm: 185, goingMm: 270, widthMm: 1000 },
    ],
    showSlab: true,
    railingSides: { 0: { left: true }, 1: { left: true } },
    railingAntresola: true,
    railingInfill: 'balusters',
    ...patch,
  });

test('each flight side and the antresola its own infill; the default where none is set', async () => {
  const { railingInfillOf } = await import('../schema.js');
  const c = twoFlights({ railingInfillSides: { 0: { left: 'harp' } }, railingAntresolaInfill: 'harp' });
  assert.equal(railingInfillOf(c, { flight: 0, side: 'left' }), 'harp');
  assert.equal(railingInfillOf(c, { flight: 1, side: 'left' }), 'balusters', 'the default');
  assert.equal(railingInfillOf(c, 'antresola'), 'harp');
  const b = buildCladdingStair(c);
  const byFlight = (f) => b.balustrade.sections.filter((s) => s.kind === 'stairs' && s.key.flight === f);
  assert.ok(byFlight(0).length && byFlight(0).every((s) => s.infill === 'harp' && s.harp.rods.length > 0 && !s.posts.length));
  assert.ok(byFlight(1).length && byFlight(1).every((s) => s.infill === 'balusters' && s.balusters.length > 0 && s.posts.length > 0 && !s.harp));
  const a = b.balustrade.sections.filter((s) => s.kind === 'antresola');
  assert.ok(a.length && a.every((s) => s.infill === 'harp'));
  // the quote prices each by its own kind
  const q = buildCladdingQuote(b, createDefaultQuoteSettings());
  assert.ok(q.lines.some((l) => /bieg 1/.test(l.name) && /^Harfa/.test(l.name)));
  assert.ok(q.lines.some((l) => /^Tralki — bieg 2/.test(l.name)));
  // unknown values dropped
  assert.deepEqual(sanitizeCladdingConfig({ ...c, railingInfillSides: { 0: { left: 'x', right: 'harp' }, a: {} }, railingAntresolaInfill: 'x' }).railingInfillSides, { 0: { right: 'harp' } });
});

test('a side\'s balustrade only along the steps of its range (numbers as on the plan)', () => {
  const full = buildCladdingStair(twoFlights({ railingInfill: 'harp', railingAntresola: false })).balustrade.sections.find((s) => s.key.flight === 0);
  const c = twoFlights({ railingInfill: 'harp', railingAntresola: false, railingRangeSides: { 0: { left: { from: 3, to: 6 } } } });
  const b = buildCladdingStair(c);
  const part = b.balustrade.sections.find((s) => s.key.flight === 0);
  const going = 270;
  near(part.s1 - part.s0, 4 * going, 'steps 3–6 = four goings', 1);
  assert.ok(part.harp.rods.length < full.harp.rods.length);
  const byIndex = new Map(b.concrete.elements.map((e) => [e.index, e]));
  assert.ok(byIndex.get(2) && part.s0 > full.s0, 'starts later');
  // a range with no step of the side → no section there; balusters too
  assert.equal(buildCladdingStair(twoFlights({ railingAntresola: false, railingRangeSides: { 0: { left: { from: 40 } } } })).balustrade.sections.filter((s) => s.key.flight === 0).length, 0);
  const bal = buildCladdingStair(twoFlights({ railingAntresola: false, railingRangeSides: { 1: { left: { to: 13 } } } })).balustrade.sections.find((s) => s.key.flight === 1);
  const balFull = buildCladdingStair(twoFlights({ railingAntresola: false })).balustrade.sections.find((s) => s.key.flight === 1);
  assert.ok(bal.balusters.length > 0 && bal.balusters.length < balFull.balusters.length);
  near(balFull.s1 - bal.s1, 3 * going, 'ends after step 13 (of 11–16)', 1);
});

// user report 2026-11-18: a U stair, the opening edge over the lower flight (on the exit edge's LINE, beside the exit)
// switched on for the antresola got no balustrade — the antresola took every edge on that line for the exit (the
// trim's rule was fixed on 2026-11-13, the antresola kept the old one); now one rule, openingEdges.js
test('the antresola on an opening edge over the lower flight of a U (on the exit\'s line, not the exit) — a harp there', async () => {
  const { exitEdgeTest } = await import('../openingEdges.js');
  const c = sanitizeCladdingConfig({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 9, riseMm: 185, goingMm: 270, widthMm: 1100 },
      { kind: 'landing', riseMm: 185, depthMm: 835, turn: 'u-right', gapMm: 0, finish: 'floorboard' },
      { kind: 'steps', count: 6, riseMm: 185, goingMm: 270, widthMm: 1130 },
    ],
    showSlab: true,
    openingManual: [{ x: 0, y: 810 }, { x: 1080, y: 810 }, { x: 2230, y: 810 }, { x: 2230, y: 3265 }, { x: 0, y: 3265 }],
    railingAntresola: true,
    railingAntresolaInfill: 'harp',
    // only the edge over the lower flight (0) on
    railingAntresolaEdges: { 1: false, 2: false, 3: false, 4: false },
  });
  const b = buildCladdingStair(c);
  const o = b.slab.opening;
  const isExit = exitEdgeTest(b);
  assert.equal(isExit(o[0], o[1]), false, 'over flight 1 — beside the exit');
  assert.equal(isExit(o[1], o[2]), true, 'the exit itself');
  const a = b.balustrade.sections.filter((s) => s.kind === 'antresola');
  assert.equal(a.length, 1, 'the antresola there');
  assert.equal(a[0].infill, 'harp');
  assert.ok(a[0].harp.rods.length > 5);
  for (const r of a[0].harp.rods) assert.ok(r.at.x > -100 && r.at.x < 1180, 'along edge 0');
  // the plan's opening editor says the same: edge 1 = the exit (grey, dashed), edge 0 green
  const svg = renderCladdingPlanSVG(b, { mode: 'opening' });
  assert.match(svg, /data-edge="0"[^>]*stroke="#2e7d32"/);
  assert.match(svg, /data-edge="1"[^>]*stroke="#9aa0a6"[^>]*stroke-dasharray/);
});

// user request 2026-11-18: the last flight's balustrade on past the exit, its last post on the floor above (on the
// antresola nosing) — as it is built in reality
test('the last post on the floor: past the exit edge by half the antresola nosing, on the finished floor, the handrail level to it', async () => {
  const { endPostOnFloorMm } = await import('../balustradeModel.js');
  const u = (patch = {}) =>
    sanitizeCladdingConfig({
      ...createDefaultCladdingConfig(),
      sequence: [
        { kind: 'steps', count: 9, riseMm: 185, goingMm: 270, widthMm: 1100 },
        { kind: 'landing', riseMm: 185, depthMm: 835, turn: 'u-right', gapMm: 0, finish: 'floorboard' },
        { kind: 'steps', count: 6, riseMm: 185, goingMm: 270, widthMm: 1130 },
      ],
      showSlab: true,
      railingSides: { 0: { left: true }, 1: { left: true } },
      ...patch,
    });
  const base = buildCladdingStair(u()).balustrade.sections.find((s) => s.key.flight === 1);
  const c = u({ railingEndOnFloorSides: { 1: { left: true }, 0: { left: true } } });
  const b = buildCladdingStair(c);
  const s = b.balustrade.sections.find((x) => x.key.flight === 1);
  const floorZ = b.concrete.exit.rawSlabTopZ + c.floorFinishTopMm;
  const d = endPostOnFloorMm(c);
  near(d, c.exitNosingDepthMm / 2, 'the nosing\'s middle');
  const last = s.posts.at(-1);
  near(last.s, base.s1 + d, 'its centre past the exit edge');
  near(last.bottomZ, floorZ, 'standing on the floor above');
  near(last.topZ, floorZ + c.railingHeightMm + c.postAboveHandrailMm, 'its top over the floor');
  near(s.handrail.at(-1).z, floorZ + c.railingHeightMm - c.handrailHeightMm / 2, 'the handrail level at the floor post');
  near(s.handrail.at(-1).z, s.handrail.at(-2).z, 'level from the exit edge');
  // only where the side reaches the exit: flight 1 (it ends at the landing) is unchanged
  const f0 = b.balustrade.sections.find((x) => x.key.flight === 0);
  const f0Base = buildCladdingStair(u()).balustrade.sections.find((x) => x.key.flight === 0);
  near(f0.s1, f0Base.s1, 'flight 1 unchanged');
  // never over the opening: at least half the post past the edge; the user's own distance
  near(endPostOnFloorMm({ ...c, railingEndOnFloorMm: 10 }), c.postSizeMm / 2, 'at least half the post');
  near(endPostOnFloorMm({ ...c, railingEndOnFloorMm: 200 }), 200, 'own');
  assert.deepEqual(sanitizeCladdingConfig({ ...c, railingEndOnFloorSides: { 1: { left: true, right: 'x' }, z: { left: true } } }).railingEndOnFloorSides, { 1: { left: true } });
});
