import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

// the landing's depth (user request 2026-11-02: "a big landing 1800 x 900 — I need it 1080 deep to even out the
// treads"): config.landingDepthMm along the flight entering the landing, null = the stair's width (the old square)
const cfg = (patch) => ({ ...createDefaultConfig(), stairWidth: 900, treadGoing: 270, turnDirection: 'right', ...patch });
const bigU = { stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: true, treadsLegA: 6, treadsLegB: 0, treadsLegC: 6 };
const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
const landingOf = (layout) => layout.treads.filter((t) => t.type === 'landing');

test('null = the stair’s width: the landing is the old square (nothing changes for an existing project)', () => {
  for (const patch of [bigU, { stairType: 'L', turn1Type: 'landing', treadsLegA: 6, treadsLegB: 5 }]) {
    const a = buildPlanLayout(cfg({ ...patch, landingDepthMm: null }));
    const b = buildPlanLayout(cfg({ ...patch, landingDepthMm: 900 }));
    assert.deepEqual(b.treads.map((t) => t.outline), a.treads.map((t) => t.outline));
    assert.deepEqual(b.innerFullPath, a.innerFullPath);
  }
});

test('the U’s big landing 1080 deep: 2 widths × 1080, flights A and C where they were, one corner post, no spike in the dusza line', () => {
  const sq = buildStaircase(cfg(bigU));
  const deep = buildStaircase(cfg({ ...bigU, landingDepthMm: 1080 }));
  const [L] = landingOf(deep.planLayout);
  assert.ok(Math.abs(span(L.outerChain, 'y') - 1080) < 1e-6, `depth ${span(L.outerChain, 'y')}`);
  assert.ok(Math.abs(span(L.outerChain, 'x') - 1800) < 1e-6);
  assert.ok(Math.abs(span(landingOf(sq.planLayout)[0].outerChain, 'y') - 900) < 1e-6);
  // the flights do not move: every non-landing tread is where it was
  const flights = (b) => b.planLayout.treads.filter((t) => t.type !== 'landing').map((t) => t.frontEdge.final ?? t.frontEdge);
  assert.deepEqual(flights(deep), flights(sq));
  // the dusza line goes from A straight on to C at the landing's near edge (it went out and back along A's line)
  assert.deepEqual(deep.planLayout.innerFullPath, sq.planLayout.innerFullPath);
  assert.deepEqual(deep.postModels.filter((p) => p.kind === 'corner').map((p) => p.position), sq.postModels.filter((p) => p.kind === 'corner').map((p) => p.position));
});

test('an L’s landing 1080 deep: the exit flight at the outer side, the landing’s free dusza edge on the inner wanga, the corner post where the dusza turns', () => {
  const b = buildStaircase(cfg({ stairType: 'L', turn1Type: 'landing', treadsLegA: 6, treadsLegB: 5, landingDepthMm: 1080 }));
  const [L] = landingOf(b.planLayout);
  const Yc = 6 * 270;
  assert.ok(Math.abs(span(L.outerChain, 'y') - 1080) < 1e-6);
  const exitFirst = b.planLayout.treads[L.index + 1];
  const ys = exitFirst.frontEdge.map((p) => p.y).sort((x, y) => x - y);
  assert.ok(Math.abs(ys[0] - (Yc + 180)) < 25 && Math.abs(ys[1] - (Yc + 1080)) < 25, `exit flight between ${ys}`);
  assert.ok(b.stringerModels.inner.segments.some((s) => s.treadBearings.some((x) => x.treadIndex === L.index)), 'the inner wanga carries the landing');
  const corner = b.postModels.find((p) => p.kind === 'corner');
  assert.ok(corner && Math.abs(corner.position.y - (Yc + 180)) < 40, `corner post at ${JSON.stringify(corner?.position)}`);
});

test('a U with two half landings: both 1080 deep, flight C starts where A ends', () => {
  const b = buildPlanLayout(cfg({ stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: false, treadsLegA: 5, treadsLegB: 2, treadsLegC: 5, landingDepthMm: 1080 }));
  const ls = landingOf(b);
  assert.equal(ls.length, 2);
  for (const L of ls) assert.ok(Math.abs(Math.max(span(L.outerChain, 'y'), span(L.outerChain, 'x')) - 1080) < 1e-6 || Math.abs(span(L.outline, 'y') - 1080) < 25);
  const aEnd = b.treads[4].backEdge[0].y;
  const cStart = b.treads[ls[1].index + 1].frontEdge[0].y;
  assert.ok(Math.abs(aEnd - cStart) < 25, `${aEnd} vs ${cStart}`);
});

test('a U with a big landing (user request 2026-11-02): flight C its own width, flights A and C apart — the landing A + gap + C wide, its free edge between them on the inner wanga, a corner post at each flight', () => {
  const b = buildStaircase(cfg({ ...bigU, stairWidth: 780, stairWidthC: 1020, uFlightGapMm: 120 }));
  const [L] = landingOf(b.planLayout);
  assert.ok(Math.abs(span(L.outerChain, 'x') - (780 + 120 + 1020)) < 1e-6, `${span(L.outerChain, 'x')}`);
  const raw = (t) => [t.innerChain[0], t.outerChain[0]];
  const a0 = b.planLayout.treads[0];
  const cLast = b.planLayout.treads.at(-1);
  assert.ok(Math.abs(Math.hypot(raw(a0)[1].x - raw(a0)[0].x, raw(a0)[1].y - raw(a0)[0].y) - 780) < 1e-6, 'A 780 wide');
  assert.ok(Math.abs(Math.hypot(raw(cLast)[1].x - raw(cLast)[0].x, raw(cLast)[1].y - raw(cLast)[0].y) - 1020) < 1e-6, 'C 1020 wide');
  // the inner lines 120 apart: A's at x = 780, C's at x = 900
  assert.ok(Math.abs(cLast.innerChain[0].x - a0.innerChain[0].x - 120) < 1e-6);
  assert.ok(L.innerChain.length === 2 && b.stringerModels.inner.segments.some((s) => s.treadBearings.some((x) => x.treadIndex === L.index)), 'the free edge on the inner wanga');
  assert.equal(b.postModels.filter((p) => p.kind === 'corner').length, 2);
  // the stair pair spacing checks know both widths and the landing's depth
  const ids = runTakeoffValidationGate(b).errors.map((d) => d.ruleId);
  assert.ok(!ids.includes('CONSTRAINT-STRINGER-PAIR-SPACING') && !ids.includes('CONSTRAINT-STRINGER-PAIR-PARALLEL'), ids.join(' '));
  // side by side (no gap): one corner post, no free edge
  const side = buildStaircase(cfg({ ...bigU, stairWidth: 780, stairWidthC: 1020 }));
  assert.equal(landingOf(side.planLayout)[0].innerChain.length, 0);
  assert.equal(side.postModels.filter((p) => p.kind === 'corner').length, 1);
});

test('a U with two half landings (user request 2026-11-02): flights A and C apart too — flight B makes up B × going of the distance, both half landings the rest equally; less than B × going changes nothing', () => {
  const halves = { stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: false, treadsLegA: 5, treadsLegB: 2, treadsLegC: 5 };
  const gapOf = (b) => b.planLayout.treads.at(-1).innerChain[0].x - b.planLayout.treads[0].innerChain[0].x;
  const plain = buildStaircase(cfg(halves));
  assert.ok(Math.abs(gapOf(plain) - 2 * 270) < 1e-6);
  assert.ok(Math.abs(gapOf(buildStaircase(cfg({ ...halves, uFlightGapMm: 400 }))) - 540) < 1e-6, 'less than flight B: as it was');
  for (const B of [2, 0]) {
    const b = buildStaircase(cfg({ ...halves, treadsLegB: B, uFlightGapMm: 1200 }));
    assert.ok(Math.abs(gapOf(b) - 1200) < 1e-6, `B = ${B}: ${gapOf(b)}`);
    const ls = landingOf(b.planLayout);
    const along = ls.map((L) => span(L.outerChain, 'x'));
    assert.ok(Math.abs(along[0] - along[1] + 0) < 1e-6 || Math.abs(along[0] - along[1]) < 1e-6, `equal halves ${along}`);
    assert.equal(b.postModels.filter((p) => p.kind === 'corner').length, 2);
    assert.ok(!runTakeoffValidationGate(b).errors.some((d) => d.ruleId.startsWith('CONSTRAINT-STRINGER-PAIR')));
  }
});
