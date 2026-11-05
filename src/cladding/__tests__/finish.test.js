import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { claddingPieces } from '../export/claddingDxf.js';
import { renderCladdingStair } from '../claddingRenderer.js';

// stage 5 (user request 2026-11-04): skirting boards, cover stringers, the balustrade with decorative posts
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 6, riseMm: 180, goingMm: 270, widthMm: 1000 }], treadThicknessMm: 40, floorFinishBottomMm: 40, floorFinishTopMm: 40, ...patch });
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const has = (poly, s, z) => poly.some((p) => Math.abs(p.s - s) < 1e-6 && Math.abs(p.z - z) < 1e-6);

test('skirting on a walled side: the bottom cut to every tread top and riser, the top raked through the noses + its height', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true, skirtingHeightMm: 80, skirtingThicknessMm: 15 }));
  assert.equal(b.finish.skirting.length, 1);
  const k = b.finish.skirting[0];
  assert.deepEqual(k.key, { flight: 0, side: 'left' });
  for (let i = 0; i < 6; i++) {
    const top = 180 * (i + 1) + 40;
    assert.ok(has(k.polygon, 270 * i, top), `tread ${i + 1}: the cut at its front`);
    assert.ok(has(k.polygon, 270 * (i + 1), top), `tread ${i + 1}: the cut at its back`);
    assert.ok(has(k.polygon, 270 * i, top + 80), `tread ${i + 1}: the raked top over its nose`);
  }
  assert.ok(has(k.polygon, 0, 40), 'starts on the finished floor');
  // on the wall's face, its thickness into the stair (+x for the left side)
  near(k.normal.x, 1, 'normal x');
  near(k.normal.y, 0, 'normal y');
  // the blank along its raked top: at least the top line, plus the cut bottom's overhang at its ends
  const line = Math.hypot(270 * 6, 180 * 5);
  assert.ok(k.lengthMm >= line && k.lengthMm < line + 300, `blank ${k.lengthMm}`);
  // none without a wall, none switched off
  assert.equal(buildCladdingStair(straight({ skirtingEnabled: true })).finish.skirting.length, 0);
  assert.equal(buildCladdingStair(straight({ walls: { 0: { left: true } } })).finish.skirting.length, 0);
});

// a stepped skirting as the joiners make it (user request 2026-11-05): horizontal pieces on the treads, vertical ones
// in front of the risers, mitred at 45°, the vertical ones notched for the noses
const stepped = (patch = {}) => straight({ walls: { 0: { right: true } }, skirtingEnabled: true, skirtingStyle: 'stepped', skirtingHeightMm: 80, riserBoards: true, riserThicknessMm: 20, nosingFrontMm: 30, ...patch });
// tread i: its top 180 (i + 1) + 40, its underside 180 (i + 1); riser i's face F = 270 i − 20
const top = (i) => 180 * (i + 1) + 40;
const F = (i) => 270 * i - 20;

test('a stepped skirting: a horizontal piece on every tread and a vertical one at every riser, mitred at 45°', () => {
  const k = buildCladdingStair(stepped()).finish.skirting[0];
  assert.equal(k.polygon, null);
  assert.deepEqual(k.parts.map((p) => p.part), [...Array(6)].flatMap(() => ['vertical', 'horizontal']).concat(['vertical']), 'v h v h … + the exit');
  const hs = k.parts.filter((p) => p.part === 'horizontal');
  for (let i = 0; i < 5; i++) {
    const h = hs[i].polygon;
    // front: the mitre from (F, top) to (F − 80, top + 80) — 45°; back: from (F', top) to (F' − 80, top + 80)
    assert.ok(has(h, F(i), top(i)) && has(h, F(i) - 80, top(i) + 80), `tread ${i + 1} front mitre`);
    assert.ok(has(h, F(i + 1), top(i)) && has(h, F(i + 1) - 80, top(i) + 80), `tread ${i + 1} back mitre`);
    near(hs[i].lengthMm, F(i + 1) - F(i) + 80, `tread ${i + 1} blank length`);
    near(hs[i].depthMm, 80, 'the board width');
  }
  const vs = k.parts.filter((p) => p.part === 'vertical');
  // the first one from the finished floor (level cut), up to the first tread's mitre
  assert.ok(has(vs[0].polygon, F(0), 40) && has(vs[0].polygon, F(0) - 80, 40), 'level on the floor');
  for (let i = 1; i < 6; i++) {
    const v = vs[i].polygon;
    assert.ok(has(v, F(i), top(i - 1)) && has(v, F(i) - 80, top(i - 1) + 80), `riser ${i + 1}: the bottom mitre with the tread below`);
    assert.ok(has(v, F(i) - 80, top(i) + 80) && has(v, F(i), top(i)), `riser ${i + 1}: the top mitre`);
  }
});

test('a stepped skirting: the vertical pieces notched for the nose; a nose past the board ends them level under it', () => {
  const k = buildCladdingStair(stepped()).finish.skirting[0];
  const v = k.parts.filter((p) => p.part === 'vertical')[2];
  // the riser face up to the tread's underside, out by the overhang (30), up its thickness (40)
  assert.ok(has(v.polygon, F(2), 180 * 3) && has(v.polygon, F(2) - 30, 180 * 3) && has(v.polygon, F(2) - 30, top(2)), 'the notch');
  assert.deepEqual(v.notch, { widthMm: 30, heightMm: 40 });
  assert.ok(v.depthMm === 80 && v.lengthMm > 180, 'blank along its grain (up)');
  // a nose of 100 over an 80 board: the vertical piece ends level under it, the horizontal one square at F − 80
  const long = buildCladdingStair(stepped({ nosingFrontMm: 100 })).finish.skirting[0];
  const lv = long.parts.filter((p) => p.part === 'vertical')[2];
  assert.ok(has(lv.polygon, F(2), 180 * 3) && has(lv.polygon, F(2) - 80, 180 * 3), 'level under the nose');
  assert.equal(lv.notch, null);
  const lh = long.parts.filter((p) => p.part === 'horizontal')[2];
  assert.ok(has(lh.polygon, F(2) - 80, top(2)) && has(lh.polygon, F(2) - 80, top(2) + 80), 'square over the nose');
});

test('a stepped skirting: the exit piece up to the floor above + its width, notched for the antresola nosing', () => {
  const b = buildCladdingStair(stepped());
  const k = b.finish.skirting[0];
  const exit = k.parts.at(-1);
  assert.equal(exit.exit, true);
  const floorAbove = b.concrete.exit.rawSlabTopZ + b.config.floorFinishTopMm;
  const Fe = 270 * 6 - 20;
  assert.ok(has(exit.polygon, Fe, floorAbove + 80) && has(exit.polygon, Fe - 80, floorAbove + 80), 'level top 80 over the floor');
  assert.ok(has(exit.polygon, Fe - 30, floorAbove - 40) && has(exit.polygon, Fe - 30, floorAbove), 'notched for the antresola nosing');
});

test('a stepped skirting downstream: 3D one mesh per piece, the DXF / cut list per piece (grain along x), the quote per piece, LED per tread', () => {
  const b = buildCladdingStair(stepped({ ledSkirtingEnabled: true, ledSkirtingAboveMm: 40 }));
  const k = b.finish.skirting[0];
  const s = createDefaultQuoteSettings();
  s.skirtingPerMb = 30;
  s.labour.find((r) => r.id === 'skirting-stepped').rate = 15;
  const line = buildCladdingQuote(b, s).lines.find((l) => l.id === k.id);
  near(line.qty, Math.round(k.lengthMm / 10) / 100, 'mb of all pieces');
  near(line.labour.value, 15 * k.parts.length, 'labour per piece', 0.011);
  const leds = b.led.strips.filter((x) => x.kind === 'skirting');
  assert.equal(leds.length, 6, 'one strip per tread');
  near(leds[1].points[0].z, top(1) + 40, 'the LED 40 over the tread');
  const pieces = claddingPieces(b).filter((p) => p.code.startsWith('LS-1P-'));
  assert.equal(pieces.length, k.parts.length, 'every piece in the DXF');
  for (const [i, p] of pieces.entries()) {
    const w = Math.max(...p.pts.map((q) => q.u)) - Math.min(...p.pts.map((q) => q.u));
    near(w, k.parts[i].lengthMm, `${p.code} grain along x`);
  }
  assert.match(pieces[2].notes.join(), /wycięcie pod nosek 30 × 40/);
  const root = renderCladdingStair(b);
  let meshes = 0;
  root.getObjectByName('Finish').traverse((o) => o.isMesh && meshes++);
  assert.equal(meshes, k.parts.length, 'one mesh per piece');
});

test('a cover stringer on the open side: along the soffit, its top under the treads (stepped) or above the noses (raked — no side nosing then)', () => {
  const b = buildCladdingStair(straight({ coverStringers: { 0: { right: true } }, coverStringerThicknessMm: 20, sideNosingRight: true, sideNosingMm: 30 }));
  const c = b.finish.coverStringers[0];
  near(c.normal.x, 1, 'outside the concrete');
  near(c.normal.y, 0, 'outside the concrete (y)');
  for (let i = 0; i < 6; i++) assert.ok(has(c.polygon, 270 * i, 180 * (i + 1)) && has(c.polygon, 270 * (i + 1), 180 * (i + 1)), `under tread ${i + 1} (its concrete top)`);
  assert.ok(has(c.polygon, 0, 0), 'down to the floor at the start (the soffit never below it)');
  // the side nosing still over it
  assert.equal(Math.round(Math.max(...b.cladding.treads[2].outline.map((p) => p.x))), 1030);
  const raked = buildCladdingStair(straight({ coverStringers: { 0: { right: true } }, coverStringerTop: 'raked', coverStringerAboveMm: 60, sideNosingRight: true }));
  const r = raked.finish.coverStringers[0];
  assert.ok(has(r.polygon, 270 * 2, 180 * 3 + 40 + 60), 'raked: 60 over the third nose');
  assert.equal(Math.round(Math.max(...raked.cladding.treads[2].outline.map((p) => p.x))), 1000, 'the treads butt into it: no side nosing');
  // no cover stringer on a walled side
  assert.equal(buildCladdingStair(straight({ coverStringers: { 0: { left: true } }, walls: { 0: { left: true } } })).finish.coverStringers.length, 0);
});

test('the balustrade on an open side: decorative posts at both ends, balusters per tread under a handrail H above the noses', () => {
  const b = buildCladdingStair(straight({ railingSides: { 0: { right: true } }, railingHeightMm: 900, handrailHeightMm: 50, balustersPerTread: 2, postSizeMm: 90, railingInsetMm: 50, postCap: 'ball', postGrooves: 3 }));
  const [s] = b.balustrade.sections;
  assert.equal(s.kind, 'stairs');
  assert.equal(s.posts.length, 2);
  assert.equal(s.posts[0].cap, 'ball');
  assert.equal(s.posts[0].grooves, 3);
  near(s.posts[0].at.x, 1000 - 50, 'post axis 50 in from the tread end');
  assert.equal(s.posts[0].bottomZ, 220, 'on the first tread');
  assert.ok(s.posts[0].topZ > s.handrail[0].z, 'the post rises over the handrail');
  // balusters: two per tread, none in a post — each from its tread up to the handrail's underside
  assert.ok(s.balusters.length >= 2 * 6 - 2 && s.balusters.length <= 12);
  for (const bal of s.balusters) {
    const tread = Math.floor(bal.at.y / 270);
    assert.equal(bal.bottomZ, 180 * (tread + 1) + 40);
    // (under the handrail: H − its height over the nose, up to one rise more at the tread's back)
    assert.ok(bal.topZ >= bal.bottomZ + 900 - 50 - 1e-6 && bal.topZ <= bal.bottomZ + 900 - 50 + 180 + 1e-6, `baluster ${bal.topZ - bal.bottomZ}`);
  }
  assert.equal(s.treadCount, 6);
  // none on a walled side
  assert.equal(buildCladdingStair(straight({ railingSides: { 0: { right: true } }, walls: { 0: { right: true } } })).balustrade.sections.length, 0);
});

test('the antresola balustrade: round the opening on the floor above, not on the exit edge, posts at its corners', () => {
  const b = buildCladdingStair(straight({ sequence: [{ kind: 'steps', count: 15, riseMm: 180, goingMm: 270, widthMm: 1000 }], railingAntresola: true, railingAntresolaHeightMm: 1100, antresolaSetbackMm: 60 }));
  const a = b.balustrade.sections.find((s) => s.kind === 'antresola');
  assert.ok(a);
  const exitY = 15 * 270;
  // no part of it along the exit edge (y = the last back edge)
  for (let k = 1; k < a.handrail.length; k++) {
    const p = a.handrail[k - 1];
    const q = a.handrail[k];
    assert.ok(!(Math.abs(p.y - exitY) < 100 && Math.abs(q.y - exitY) < 100), 'not along the exit edge');
  }
  assert.equal(a.posts.length, a.handrail.length, 'a post at every corner / end');
  const floor = b.concrete.exit.rawSlabTopZ + 40;
  assert.ok(a.posts.every((p) => p.bottomZ === floor));
  near(a.handrail[0].z, floor + 1100 - 25, 'the handrail on the floor + 1.1 m');
});

test('the quote: skirting per mb, the cover stringer as a board, the balustrade (handrail, balusters, posts) with their labour', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true, coverStringers: { 0: { right: true } }, railingSides: { 0: { right: true } } }));
  const s = createDefaultQuoteSettings();
  s.labour.forEach((r) => (r.rate = 10));
  // (the SHARED price list: the handrail / baluster by material id, the posts from the post table by section)
  s.skirtingPerMb = 30;
  s.priceList.find((p) => p.materialId === 'railing-handrail').price = 200;
  s.priceList.find((p) => p.materialId === 'railing-baluster').price = 40;
  s.boardPricing.postPrices = [{ sectionMm: 100, price: 500, unit: 'szt' }];
  const q = buildCladdingQuote(b, s);
  const sk = q.lines.find((l) => l.id === 'skirting-0-left');
  near(sk.material.value, Math.round(30 * sk.qty * 100) / 100, 'skirting material per mb', 0.011);
  assert.equal(sk.labour.id, 'skirting');
  const cover = q.lines.find((l) => l.id === 'cover-0-right');
  assert.ok(cover.material.value > 0, 'priced from the board table');
  assert.equal(cover.labour.id, 'cover-stringer');
  const rail = q.lines.find((l) => l.id === 'railing-0-right-handrail');
  assert.equal(rail.labour.id, 'railing-stairs');
  assert.equal(rail.labour.qty, 6, 'labour per tread');
  const posts = q.lines.find((l) => l.id === 'railing-0-right-posts');
  assert.equal(posts.qty, 2);
  near(posts.material.value, 1000, 'two posts');
  assert.ok(q.lines.find((l) => l.id === 'railing-0-right-balusters').qty > 0);
});

test('an L landing: the side the next flight leaves from carries no balustrade (it is the way on)', () => {
  const cfg = {
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'right' },
      { kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
    railingSides: { 0: { right: true } },
  };
  const [s] = buildCladdingStair(cfg).balustrade.sections;
  // flight A's right side ends at the landing: nothing past y = 810 (the landing's front line) on x = 950
  assert.ok(s.posts.every((p) => p.at.y <= 810 + 1e-6), `posts at ${s.posts.map((p) => Math.round(p.at.y))}`);
  assert.ok(s.balusters.every((b) => b.at.y <= 810));
});
