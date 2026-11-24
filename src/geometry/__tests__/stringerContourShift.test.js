// The WHOLE line of a wanga's profile moved by hand (user request 2026-11-24: "the lower line is 20–30 mm too far,
// its shape is fine — move it whole, not point by point"): `shift` per side / `boardShift` per board (its lap-jointed
// group) in manualStringerProfileOverrides — the solved contour moved parallel to itself, shape unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { applyProfileEdit, PROFILE_EDITS, contourShiftOf, countProfileOverrides, sanitizeStringerProfileOverrides } from '../stringerProfileModel.js';
import { offsetCurve, makeArc, lineSegment, curveToPolyline, curveDistance, pointToCurveDistance } from '../profileCurve.js';

function flight(patch) {
  const config = { ...createDefaultConfig(), ...patch };
  const derived = deriveStairData(config);
  const full = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(full);
  const models = buildStringerModelsForFlight(planLayout, full);
  return { models, geo: { outer: buildStringerConstructionGeometry(models.outer, full), inner: buildStringerConstructionGeometry(models.inner, full) } };
}
const shiftEdit = (all, side, contour, dn, board = null) => applyProfileEdit(all, { type: PROFILE_EDITS.SHIFT_CONTOUR, side, contour, dn, board });
const L_POSTS = { stairType: 'L', turn1Type: 'winder', hasCornerPost: true, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' };

// every point of `moved` lies `d` from `original` — the same shape, `d` further (away from the board's ends, where the
// construction layer cuts the edges: the foot on the floor, the plumb faces, a level piece past a corner)
const END_ZONE_MM = 150;
function assertParallel(original, moved, d, label) {
  // the chords subdivided every 10 mm (a line-only edge has only its corners)
  const poly = curveToPolyline(moved).flatMap((p, i, all) => {
    if (i === 0) return [p];
    const a = all[i - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(p.u - a.u, p.v - a.v) / 10));
    return Array.from({ length: n }, (_, k) => ({ u: a.u + ((p.u - a.u) * (k + 1)) / n, v: a.v + ((p.v - a.v) * (k + 1)) / n }));
  });
  const u0 = poly[0].u + END_ZONE_MM;
  const u1 = poly[poly.length - 1].u - END_ZONE_MM;
  const inner = poly.filter((p) => p.u > u0 && p.u < u1);
  assert.ok(inner.length > 0, `${label}: nothing to compare`);
  for (const p of inner) {
    const dist = pointToCurveDistance(p, original);
    assert.ok(Math.abs(dist - Math.abs(d)) < 0.5, `${label}: a point ${dist.toFixed(2)} mm off, not ${Math.abs(d)}`);
  }
}

test('offsetCurve: a line and an arc move parallel; the arc keeps its centre', () => {
  const curve = [lineSegment({ u: 0, v: 0 }, { u: 100, v: 0 }), makeArc({ u: 100, v: 100 }, 100, -Math.PI / 2, Math.PI / 4)];
  const down = offsetCurve(curve, 20, 'down');
  assert.deepEqual([down[0].a, down[0].b], [{ u: 0, v: -20 }, { u: 100, v: -20 }]);
  assert.equal(down[1].radius, 120);
  assert.deepEqual(down[1].center, { u: 100, v: 100 });
  assert.ok(Math.abs(curveDistance(down, curve) - 20) < 1e-6);
  // a sharp corner: the two lines joined at their crossing
  const corner = offsetCurve([lineSegment({ u: 0, v: 0 }, { u: 100, v: 0 }), lineSegment({ u: 100, v: 0 }, { u: 200, v: 100 })], 10, 'up');
  assert.equal(corner.length, 2);
  assert.ok(Math.abs(corner[0].b.u - corner[1].a.u) < 1e-9 && Math.abs(corner[0].b.v - 10) < 1e-9);
  // an arc that would shrink to nothing: null (the caller offsets the chords)
  assert.equal(offsetCurve([makeArc({ u: 0, v: 10 }, 10, -Math.PI / 2, Math.PI / 4)], 20, 'up'), null);
});

test('the whole lower line of a wanga moved up 25 mm: the same shape, 25 mm shallower everywhere; the top untouched', () => {
  for (const style of ['TANGENT_ARC', 'SPLINE']) {
    const cfg = { ...L_POSTS, stringerTransitionStyle: style, stringerCornerRadiusMm: 150 };
    const before = flight(cfg).geo.outer;
    const overrides = shiftEdit({}, 'outer', 'lower', -25);
    const after = flight({ ...cfg, manualStringerProfileOverrides: overrides }).geo.outer;
    before.forEach((g, i) => {
      if (!g.lowerCurve.length) return;
      assertParallel(g.lowerCurve, after[i].lowerCurve, 25, `${style} ${g.segmentId}`);
      // up, not down: the moved line is nearer the top
      assert.ok(curveDistance(after[i].lowerCurve, after[i].upperCurve) < curveDistance(g.lowerCurve, g.upperCurve) - 20);
      assert.deepEqual(after[i].upperCurve, g.upperCurve, 'the top edge stays');
      assert.deepEqual(after[i].profileShift, { lower: -25, upper: 0 });
      // the control points move with it (a handle stays on its line)
      const c0 = g.lowerControl.find((c) => !c.anchor && c.normal);
      const c1 = after[i].lowerControl.find((c) => c.id === c0.id);
      assert.ok(Math.abs(Math.hypot(c1.u - c0.u, c1.v - c0.v) - 25) < 1e-6);
    });
    // a hand edit below the minimum depth: kept, a WARNING (never blocks the takeoff)
    const minDepth = after.flatMap((g) => g.diagnostics).filter((d) => d.ruleId === 'STRINGER-MIN-DEPTH');
    assert.ok(minDepth.length > 0 && minDepth.every((d) => d.severity === 'WARNING'), style);
  }
});

test('the upper line of a housed wanga moved, and one board\'s own shift on top of the wanga\'s', () => {
  const base = flight(L_POSTS);
  const boards = base.geo.inner.filter((g) => g.lowerCurve.length);
  assert.ok(boards.length >= 2, 'the inner wanga has several boards (posts)');
  const target = boards[1];
  let o = shiftEdit({}, 'inner', 'upper', 15);
  o = shiftEdit(o, 'inner', 'lower', 20, target.profileGroupId);
  assert.deepEqual(contourShiftOf(o, 'inner'), { lower: 0, upper: 15 });
  assert.deepEqual(contourShiftOf(o, 'inner', target.profileGroupId), { lower: 20, upper: 0 });
  assert.equal(countProfileOverrides(o), 2);
  const after = flight({ ...L_POSTS, manualStringerProfileOverrides: o }).geo.inner;
  for (const g of boards) {
    const a = after.find((x) => x.segmentId === g.segmentId);
    assertParallel(g.upperCurve, a.upperCurve, 15, `${g.segmentId} top`);
    if (g.profileGroupId === target.profileGroupId) assertParallel(g.lowerCurve, a.lowerCurve, 20, `${g.segmentId} bottom`);
    else assert.deepEqual(a.lowerCurve, g.lowerCurve, `${g.segmentId}: another board keeps its bottom`);
  }
  // 0 removes it again
  const cleared = shiftEdit(shiftEdit(o, 'inner', 'upper', 0), 'inner', 'lower', 0, target.profileGroupId);
  assert.equal(sanitizeStringerProfileOverrides(cleared).inner, undefined);
});

test('a board\'s own shift for a board that no longer exists: out of date, removable with PRUNE', () => {
  const o = shiftEdit({}, 'inner', 'lower', 20, 'inner-seg-99');
  const { geo } = flight({ ...L_POSTS, manualStringerProfileOverrides: o });
  assert.deepEqual(geo.inner[0].outOfDateOverrideIds, ['shift:inner-seg-99']);
  const pruned = applyProfileEdit(o, { type: PROFILE_EDITS.PRUNE, side: 'inner', ids: ['shift:inner-seg-99'] });
  assert.equal(sanitizeStringerProfileOverrides(pruned).inner, undefined);
});
