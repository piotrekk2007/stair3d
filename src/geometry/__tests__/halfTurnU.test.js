import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { isHalfTurnU, halfTurnInnerGap } from '../winderArc.js';
import { goesStraightThrough } from '../pathUtils.js';
import { treadGoingAtOffsetFromInner } from '../walklineModel.js';
import { runTakeoffValidationGate } from '../../takeoff/index.js';
import { solveStairwellFit } from '../stairwellFit.js';
import { stairFacts } from '../../offer/offerModel.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';

// The user's case (2026-10-14): a U stair, no straight tread between the turns, ONE winder zone of 7 winders round one
// central post, the wanga of C straight above the wanga of A.
const U = { stairType: 'U', totalRise: 2800, treadsLegA: 3, treadsLegB: 0, treadsLegC: 3, stairWidth: 900, treadGoing: 270, walklineOffset: 400, stringerThickness: 40, postSize: 110, uSingleWinderZone: true, uWindersTotal: 7, uAxisGapMm: 0 };
const cfg = (patch = {}) => ({ ...createDefaultConfig(), ...U, ...patch });
const layout = (patch = {}) => {
  const c = cfg(patch);
  return buildPlanLayout({ ...c, riserHeight: deriveStairData(c).riserHeight });
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ptNear = (p, q, eps = 1e-6) => near(p.x, q.x, eps) && near(p.y, q.y, eps);
const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
};

test('the option applies only to a U with no middle flight and two winder turns', () => {
  assert.equal(isHalfTurnU(cfg()), true);
  assert.equal(isHalfTurnU(cfg({ treadsLegB: 1 })), false);
  assert.equal(isHalfTurnU(cfg({ turn2Type: 'landing' })), false);
  assert.equal(isHalfTurnU(cfg({ uSingleWinderZone: false })), false);
  assert.equal(isHalfTurnU(cfg({ stairType: 'L' })), false);
  // off: the two quarter turns as before
  assert.equal(layout({ uSingleWinderZone: false }).turns.length, 2);
  assert.equal(deriveStairData(cfg({ uSingleWinderZone: false })).numTreads, 3 + 5 + 0 + 5 + 3);
  // on: one turn, the given total of winders
  const pl = layout();
  assert.equal(pl.turns.length, 1);
  assert.ok(pl.turns[0].halfTurn && pl.turns[0].method === 'walkline-half-arc');
  assert.equal(deriveStairData(cfg()).numTreads, 3 + 7 + 3);
  assert.deepEqual(pl.treads.map((t) => t.type).join(','), ['straight', 'straight', 'straight', ...Array(7).fill('winder'), 'straight', 'straight', 'straight'].join(','));
  assert.equal(deriveStairData(cfg()).turnChecks.length, 1);
  assert.ok(deriveStairData(cfg()).turnChecks[0].feasible);
});

test('flights A and C: their inner wangi axes are uAxisGapMm apart (0 = the wanga of C exactly above the wanga of A)', () => {
  for (const d of [0, 40, 150]) {
    const pl = layout({ uAxisGapMm: d });
    const t = 40;
    const xA = pl.treads[0].innerChain[0].x; // A's inner line
    const xC = pl.treads[pl.treads.length - 1].innerChain[0].x; // C's inner line
    assert.ok(near(xA, 900) && near(xC, 900 + halfTurnInnerGap(d, t)), `d = ${d}`);
    // the boards lie on the stair's side of their lines: A's axis 20 mm in from x = 900 (toward A), C's toward C
    assert.ok(near(xC + t / 2 - (xA - t / 2), d), `axes ${d} apart`);
    // the outer line goes round all three sides; the middle one is two widths plus the gap between the inner lines
    const [o0, o1, o2, o3] = pl.outerFullPath;
    assert.equal(pl.outerFullPath.length, 4);
    assert.ok(near(Math.hypot(o2.x - o1.x, o2.y - o1.y), 2 * 900 + halfTurnInnerGap(d, t)));
    assert.ok(near(o0.x, 0) && near(o3.x, 2 * 900 + halfTurnInnerGap(d, t)));
  }
});

test('the winders: equal goings on the walkline round a half circle, the same width at the dusza, the standard width 0.4 m from it', () => {
  const pl = layout();
  const turn = pl.turns[0];
  const R = 400 + halfTurnInnerGap(0, 40) / 2;
  const w = pl.walkline.points;
  const winders = pl.treads.filter((t) => t.type === 'winder');
  const zone = [winders[0].index, winders[winders.length - 1].index + 1];
  // every walkline point of the zone on the half circle or its straights; along the walkline each winder is one going
  for (let k = zone[0]; k < zone[1]; k++) {
    const a = w[k];
    const b = w[k + 1];
    const onArc = (p) => near(Math.hypot(p.x - turn.centre.x, p.y - turn.centre.y), R, 1e-6) && p.y >= turn.centre.y - 1e-9;
    if (onArc(a) && onArc(b)) {
      const angle = Math.acos(Math.max(-1, Math.min(1, ((a.x - turn.centre.x) * (b.x - turn.centre.x) + (a.y - turn.centre.y) * (b.y - turn.centre.y)) / (R * R))));
      assert.ok(near(angle * R, 270, 1e-6), `winder ${k}: ${angle * R}`);
    }
  }
  // the dusza: the inner ends spread evenly along A's line, the dusza piece and C's line — each winder the same width
  const along = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  const widths = winders.map((t) => along(t.innerChain));
  assert.ok(widths.every((x) => near(x, widths[0], 1e-6)), widths.join(', '));
  assert.ok(near(widths[0], turn.innerTurnSegmentLength, 1e-6));
  // PL-LEGAL-C-01 is measured on the line 0.4 m from the dusza — round the half circle that is the walkline itself,
  // so a winder there measures the CHORD of its 270 mm on the arc (and 270 where it lies on a straight)
  const chord = 2 * R * Math.sin(270 / (2 * R));
  for (const t of winders) {
    const g = treadGoingAtOffsetFromInner(t, 400, pl);
    assert.ok(g >= chord - 0.5 && g <= 270 + 0.5, `step ${t.index}: ${g}`);
  }
});

test('one central post on the wangi axes; the inner wanga of A ends in it, the one of C starts from it', () => {
  const m = quiet(() => buildStaircase(cfg()));
  const corner = m.postModels.filter((p) => p.kind === 'corner');
  assert.equal(corner.length, 1);
  const post = corner[0];
  const turn = m.planLayout.turns[0];
  assert.ok(near(post.position.x, 900 - 20) && near(post.position.y, turn.centre.y + 20), 'midway between the axes, half a board in from the dusza');
  const inner = m.stringerModels.inner.segments;
  assert.equal(inner.length, 2, 'the dusza piece lies inside the post: no board there');
  assert.equal(inner[0].endPost?.postId, post.postId);
  assert.equal(inner[1].startPost?.postId, post.postId);
  assert.ok(near(inner[0].referenceLine.direction.y, 1) && near(inner[1].referenceLine.direction.y, -1));
  assert.deepEqual(m.stringerModels.inner.segmentJoints.map((j) => j.type), ['corner-post']);
  // no winder-width or broken-geometry finding from the layout itself
  const gate = runTakeoffValidationGate(m);
  for (const id of ['PL-LEGAL-C-01', 'CONSTRAINT-TREAD-SIMPLE-POLYGON', 'CONSTRAINT-TOPOLOGY-CONTINUITY', 'VALIDATOR-MISSING-SURFACE', 'STRINGER-TREAD-SUPPORT']) {
    assert.ok(!gate.diagnostics.some((d) => d.ruleId === id), id);
  }
});

test('an axis gap too wide for one post: a post at each dusza corner, the dusza board between them', () => {
  const m = quiet(() => buildStaircase(cfg({ uAxisGapMm: 300 })));
  const corner = m.postModels.filter((p) => p.kind === 'corner');
  assert.deepEqual(corner.map((p) => p.postId), ['post-corner-0', 'post-corner-1']);
  const inner = m.stringerModels.inner.segments;
  assert.equal(inner.length, 3);
  assert.deepEqual([inner[0].endPost?.postId, inner[1].startPost?.postId, inner[1].endPost?.postId, inner[2].startPost?.postId], ['post-corner-0', 'post-corner-0', 'post-corner-1', 'post-corner-1']);
});

test('a left turn is the mirror image', () => {
  const r = layout();
  const l = layout({ turnDirection: 'left' });
  assert.equal(l.treads.length, r.treads.length);
  l.treads.forEach((t, i) => t.outline.forEach((p, j) => assert.ok(ptNear(p, { x: -r.treads[i].outline[j].x, y: r.treads[i].outline[j].y }))));
  assert.ok(ptNear(l.turns[0].centre, { x: -r.turns[0].centre.x, y: r.turns[0].centre.y }));
  assert.ok(ptNear(l.turns[0].postSpots[0].at, { x: -r.turns[0].postSpots[0].at.x, y: r.turns[0].postSpots[0].at.y }));
});

test('regression: where A\'s and C\'s inner lines coincide (axis gap = board thickness) the inner wanga still turns at the dusza', () => {
  // the inner line runs up A's line and straight back down C's: collinear, but a corner — it used to be taken as
  // one straight board up and back
  assert.equal(goesStraightThrough({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }), true);
  assert.equal(goesStraightThrough({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 0.5 }), false);
  const m = quiet(() => buildStaircase(cfg({ uAxisGapMm: 40, treadsLegA: 4 })));
  const inner = m.stringerModels.inner.segments;
  assert.equal(inner.length, 2);
  assert.ok(near(inner[0].referenceLine.direction.y, 1) && near(inner[1].referenceLine.direction.y, -1));
  // housed treads: each end recessed toward its own tread — the treads still meet edge to edge
  const t = m.treadModels;
  for (let i = 0; i + 1 < t.length; i++) {
    assert.ok(ptNear(t[i].backEdge.final[0], t[i + 1].frontEdge.final[0], 1e-6), `inner boundary ${i + 1}`);
    assert.ok(ptNear(t[i].backEdge.final[1], t[i + 1].frontEdge.final[1], 1e-6), `outer boundary ${i + 1}`);
  }
  assert.ok(!runTakeoffValidationGate(m).diagnostics.some((d) => d.ruleId === 'CONSTRAINT-TOPOLOGY-CONTINUITY'));
  // the middle tread's front and back edges start at ONE inner point (the line turns back there): its outline gets
  // both recessed corners, never one corner twice (a spike that took the post cut seconds to subtract)
  for (const tread of t) {
    const o = tread.outline;
    for (let i = 0; i < o.length; i++) assert.ok(!o.some((q, j) => j !== i && ptNear(q, o[i], 1e-6)), `${tread.stepId}: a repeated outline point`);
  }
});

test('regression: a short wanga between two posts carrying only treads that started on the previous board gets a profile', () => {
  // (0 straight treads in A and C, 7 winders, two corner posts: the dusza board carries one continuing tread only —
  // building its profile threw "Cannot read properties of undefined")
  const m = quiet(() => buildStaircase(cfg({ treadsLegA: 0, treadsLegC: 0, uAxisGapMm: 120 })));
  assert.ok(m.stringerConstruction.inner.length >= 2);
  assert.ok(m.stringerConstruction.inner.every((g) => g.outerContour.length >= 3));
});

test('stairwell fit keeps flight B empty; the offer names the one winder zone', () => {
  const fit = solveStairwellFit(cfg({ stairwellFitEnabled: true, stairwellSideAMm: 2300, stairwellSideCMm: 2300, stairwellSideBMm: 1760, stairwellKeySide: 'A' }));
  assert.ok(fit.values);
  assert.equal(fit.values.treadsLegB, 0);
  const c = cfg();
  const row = stairFacts(c, deriveStairData(c)).rows.find((r) => r[0] === 'Stopnie zabiegowe');
  assert.match(row[1], /7 w jednej klatce zabiegowej 180°/);
});

test('regression: the plan\'s walking-direction arrow stands on the first flight (it stood beside it for a right turn)', () => {
  for (const patch of [{}, { stairType: 'L', uSingleWinderZone: false, treadsLegB: 4 }, { stairType: 'straight', treadsLegA: 10 }, { turnDirection: 'left' }]) {
    const c = cfg(patch);
    const d = deriveStairData(c);
    const pl = buildPlanLayout({ ...c, riserHeight: d.riserHeight });
    const svg = renderPlan2DSVG(pl, c, d, { viewport: { x: -3000, y: -4000, width: 6000, height: 6000 } });
    const m = /<g class="plan-arrow"[^>]*>\s*<line x1="([-\d.]+)"/.exec(svg);
    const x = Number(m[1]);
    const xs = [pl.innerFullPath[0].x, pl.outerFullPath[0].x];
    assert.ok(x > Math.min(...xs) && x < Math.max(...xs), `${JSON.stringify(patch)}: arrow at x = ${x}`);
  }
});

test('stacked inner wangi (axis gap 0): their height overlap is reported on the upper board with the fix, and goes when corrected by hand', async () => {
  const { postAnchorId } = await import('../stringerProfileModel.js');
  const stacked = (m) => m.stringerConstruction.inner.flatMap((g) => g.diagnostics.filter((d) => d.ruleId === 'STRINGER-STACKED-OVERLAP'));
  const m = quiet(() => buildStaircase(cfg()));
  const [a, c] = m.stringerModels.inner.segments;
  const found = stacked(m);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'WARNING');
  assert.equal(found[0].elementId, c.id, 'on the upper board (C), where it is edited');
  assert.ok(found[0].value > 100, `${found[0].value} mm`);
  assert.match(found[0].message, /Profil wangi/);
  // it reaches the validation list; the generic "pockets overlap inside the post" (wrong advice here) is not given
  const gate = runTakeoffValidationGate(m);
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'STRINGER-STACKED-OVERLAP'));
  assert.ok(!gate.diagnostics.some((d) => d.ruleId === 'JOINT-POST-POCKETS-OVERLAP'));

  // corrected in the profile editor: A's top edge lowered and C's bottom edge raised at the post face
  const fix = (low, up) => quiet(() => buildStaircase(cfg({ manualStringerProfileOverrides: { inner: { mode: 'MANUAL', lower: {}, upper: {}, inserted: [], anchors: { [postAnchorId('post-corner-0', a.id)]: { upper: { dv: low } }, [postAnchorId('post-corner-0', c.id)]: { lower: { dv: up } } } } } })));
  const partly = stacked(fix(-150, 250));
  assert.ok(partly.length === 1 && partly[0].value < found[0].value, 'less overlap');
  assert.equal(stacked(fix(-250, 350)).length, 0, 'apart: nothing to report');

  // side by side (axes one board apart) nothing overlaps; on an overlay lower board its treads count too
  assert.equal(stacked(quiet(() => buildStaircase(cfg({ uAxisGapMm: 40 })))).length, 0);
  const cut = stacked(quiet(() => buildStaircase(cfg({ stringerConstructionTypeInner: 'cut' }))));
  assert.ok(cut.length === 1 && /nakładanej/.test(cut[0].message));
});
