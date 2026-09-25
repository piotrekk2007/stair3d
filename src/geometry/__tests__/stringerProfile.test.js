// Tests for the STRINGER PROFILE MODEL (stringerProfileModel.js / stringerProfileSolver.js /
// profileCurve.js) and its integration into stringerConstructionGeometry.js — the design study's
// test strategy (docs/architecture/STRINGER_PROFILE_MODEL.md §13): a grid of geometries x
// inclinations x minimum depths x corner radii, each checked for the same physical properties
// (continuous simple contour, minimum LOCAL depth, tread support, inner/outer relationship,
// stable reference path, determinism), plus the manual-override layer.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { solveStringerProfile } from '../stringerProfileSolver.js';
import { profileParamsFromConfig, setVertexOverride, countProfileOverrides, sanitizeStringerProfileOverrides, anchorIdForTread, END_ANCHOR_ID, applyProfileEdit, PROFILE_EDITS } from '../stringerProfileModel.js';
import { buildProfileViewModel, offsetFromDrag } from '../stringerProfileView.js';
import { curveDistance, polylineToCurve, curveToPolyline, sliceCurveByU } from '../profileCurve.js';
import { segmentsProperlyIntersect } from '../pathUtils.js';

const GEOMETRIES = {
  straight: { stairType: 'straight', treadsLegA: 12, treadGoing: 280 },
  L: { stairType: 'L', turn1Type: 'winder', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, treadGoing: 280 },
  U: { stairType: 'U', turn1Type: 'winder', turn2Type: 'winder', treadsLegA: 3, treadsLegB: 3, treadsLegC: 3, windersPerTurn: 5, treadGoing: 280 },
};
// Flatter, medium and steeper flights (riser/going ratio) for the same geometry.
const INCLINATIONS = { flat: 2300, medium: 2700, steep: 3100 };

function flight(patch) {
  const config = { ...createDefaultConfig(), ...patch };
  const derived = deriveStairData(config);
  const full = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(full);
  const models = buildStringerModelsForFlight(planLayout, full);
  return { config: full, planLayout, models, geo: { outer: buildStringerConstructionGeometry(models.outer, full), inner: buildStringerConstructionGeometry(models.inner, full) } };
}

function isSimplePolygon(polygon) {
  const n = polygon.length;
  const xy = (p) => ({ x: p.u, y: p.v });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsProperlyIntersect(xy(polygon[i]), xy(polygon[(i + 1) % n]), xy(polygon[j]), xy(polygon[(j + 1) % n]))) return false;
    }
  }
  return true;
}

const ruleIds = (geo) => geo.flatMap((g) => g.diagnostics.map((d) => d.ruleId));
const errorsOf = (geo) => geo.flatMap((g) => g.diagnostics.filter((d) => d.severity === 'ERROR'));

// --- the grid --------------------------------------------------------------------------------

for (const [geoName, geoPatch] of Object.entries(GEOMETRIES)) {
  for (const [incName, totalRise] of Object.entries(INCLINATIONS)) {
    for (const minDepth of [300, 350, 400]) {
      for (const radius of [0, 50, 100, 200]) {
        for (const constructionType of ['cut', 'closed']) {
          const label = `${geoName}/${incName}/${constructionType}: min depth ${minDepth}, corner radius ${radius}`;
          test(`profile grid — ${label}`, (t) => {
            const patch = { ...geoPatch, totalRise, stringerConstructionTypeOuter: constructionType, stringerConstructionTypeInner: constructionType, minimumStringerDepthMm: minDepth, stringerCornerRadiusMm: radius, stringerRadiusScope: 'BOTH' };
            const derived = deriveStairData({ ...createDefaultConfig(), ...patch });
            if (!derived.turnFeasible) return t.skip('geometry not feasible');
            const { models, geo } = flight(patch);

            for (const side of ['outer', 'inner']) {
              for (const g of geo[side]) {
                // A continuous, simple silhouette.
                assert.ok(g.outerContour.length >= 4, `${side}/${g.segmentId}: contour has points`);
                assert.ok(isSimplePolygon(g.outerContour), `${side}/${g.segmentId}: contour is self-intersecting`);
                // Minimum LOCAL depth — a true constraint, never undershot (AUTO clamps the radius).
                assert.ok(g.localDepthMm >= minDepth - 1e-3, `${side}/${g.segmentId}: local depth ${g.localDepthMm} < ${minDepth}`);
                assert.ok(!ruleIds([g]).includes('STRINGER-MIN-DEPTH'), `${side}/${g.segmentId}: unexpected STRINGER-MIN-DEPTH`);
                // Every tread keeps its support.
                assert.ok(!ruleIds([g]).includes('STRINGER-TREAD-SUPPORT'), `${side}/${g.segmentId}: a tread lost its support`);
                // The lower contour is continuous: each primitive starts where the previous one ended.
                for (let i = 0; i < g.lowerCurve.length - 1; i++) {
                  assert.ok(Math.hypot(g.lowerCurve[i].b.u - g.lowerCurve[i + 1].a.u, g.lowerCurve[i].b.v - g.lowerCurve[i + 1].a.v) < 1e-6);
                }
                // No curvature where none was asked for.
                if (radius === 0) assert.ok(g.lowerCurve.every((p) => p.type === 'line'), `${side}/${g.segmentId}: radius 0 must stay all lines`);
              }
            }
            // Inner and outer stringers carry the same treads, so a tread they both support sits at
            // the same elevation on both.
            const elevations = (side) => new Map(models[side].segments.flatMap((s) => s.treadBearings.map((b) => [b.treadIndex, b.bearingElevation])));
            const outerElev = elevations('outer');
            for (const [index, z] of elevations('inner')) if (outerElev.has(index)) assert.ok(Math.abs(outerElev.get(index) - z) < 1e-9);
          });
        }
      }
    }
  }
}

// --- SPLINE transition style: a smaller, dedicated grid ---------------------------------------
//
// TRANSITION_STYLES.SPLINE (profileCurve.js splineThroughPoints, centripetal Catmull-Rom) is
// exercised across the same variety of real geometry as the grid above (straight/L-winder/
// U-double-winder, flat/medium/steep, cut/closed) — the exact case it must be robust to is a
// winder's widely varying tread spacing along one board, which is precisely what a centripetal
// (not uniform) parameterization is for. A narrower grid than the one above (one radius value,
// since SPLINE ignores stringerCornerRadiusMm) to keep the suite fast.
for (const [geoName, geoPatch] of Object.entries(GEOMETRIES)) {
  for (const [incName, totalRise] of Object.entries(INCLINATIONS)) {
    for (const constructionType of ['cut', 'closed']) {
      const label = `${geoName}/${incName}/${constructionType}`;
      test(`spline grid — ${label}`, (t) => {
        const patch = {
          ...geoPatch,
          totalRise,
          stringerConstructionTypeOuter: constructionType,
          stringerConstructionTypeInner: constructionType,
          stringerTransitionStyle: 'SPLINE',
          stringerRadiusScope: 'BOTH',
        };
        const derived = deriveStairData({ ...createDefaultConfig(), ...patch });
        if (!derived.turnFeasible) return t.skip('geometry not feasible');
        const { geo } = flight(patch);

        for (const side of ['outer', 'inner']) {
          for (const g of geo[side]) {
            assert.ok(g.outerContour.length >= 4, `${side}/${g.segmentId}: contour has points`);
            assert.ok(isSimplePolygon(g.outerContour), `${side}/${g.segmentId}: spline contour is self-intersecting`);
            assert.ok(g.localDepthMm >= 350 - 1e-3, `${side}/${g.segmentId}: local depth ${g.localDepthMm} below the default minimum`);
            assert.ok(!ruleIds([g]).includes('STRINGER-TREAD-SUPPORT'), `${side}/${g.segmentId}: a tread lost its support`);
            // The lower contour is continuous end to end.
            for (let i = 0; i < g.lowerCurve.length - 1; i++) {
              assert.ok(Math.hypot(g.lowerCurve[i].b.u - g.lowerCurve[i + 1].a.u, g.lowerCurve[i].b.v - g.lowerCurve[i + 1].a.v) < 1e-6);
            }
            // u never goes backward anywhere along either contour (the hard invariant every
            // downstream slicing function relies on).
            for (const curve of [g.lowerCurve, g.upperCurve].filter(Boolean)) {
              const chord = curveToPolyline(curve);
              for (let i = 1; i < chord.length; i++) assert.ok(chord[i].u >= chord[i - 1].u - 1e-6, `${side}/${g.segmentId}: u went backward`);
            }
          }
        }
      });
    }
  }
}

test('SPLINE: a winder board is visibly smooth (many short segments) compared to the same board with SHARP corners', () => {
  const sharp = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SHARP' });
  const spline = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SPLINE', stringerRadiusScope: 'BOTH' });
  for (let i = 0; i < sharp.geo.outer.length; i++) {
    assert.ok(
      spline.geo.outer[i].lowerCurve.length > sharp.geo.outer[i].lowerCurve.length,
      `${sharp.geo.outer[i].segmentId}: spline (${spline.geo.outer[i].lowerCurve.length} segments) should be visibly denser than sharp (${sharp.geo.outer[i].lowerCurve.length})`
    );
  }
});

// A perfectly straight, uniform flight's bearing points are exactly collinear, so a spline
// through them degenerates back to a straight line — same as SHARP/TANGENT_ARC at radius 0 — and
// stringerConstructionGeometry.js's own mergeCollinearLines correctly collapses it to ONE line,
// same as the existing "with default profile parameters..." test above. That is the CORRECT
// behaviour (a straight input has no reason to wiggle), not a sign SPLINE silently did nothing —
// the winder test above is the one that actually exercises curvature.
test('SPLINE: a perfectly straight flight stays a single straight line (a spline through collinear points has nothing to smooth)', () => {
  const { geo } = flight({ ...GEOMETRIES.straight, totalRise: 2600, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SPLINE', stringerRadiusScope: 'BOTH' });
  for (const g of geo.outer) {
    assert.equal(g.lowerCurve.length, 1);
    assert.ok(Math.abs(g.localDepthMm - 350) < 1e-6, 'still meets the minimum depth exactly, no spurious safety push on an already-safe straight profile');
  }
});

test('SPLINE only reshapes a plain offset contour — a cut board\'s stepped/notched top comb is untouched', () => {
  const sharp = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SHARP' });
  const spline = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SPLINE', stringerRadiusScope: 'BOTH' });
  for (let i = 0; i < sharp.geo.outer.length; i++) {
    assert.deepEqual(spline.geo.outer[i].upperCurve, sharp.geo.outer[i].upperCurve, `${sharp.geo.outer[i].segmentId}: the comb must not change under SPLINE`);
  }
});

test('SPLINE respects stringerRadiusScope — BOTTOM smooths the lower contour but leaves the upper one exactly as SHARP would', () => {
  const patchFor = (transitionStyle) => ({
    ...GEOMETRIES.L,
    totalRise: 2700,
    stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed',
    stringerTransitionStyle: transitionStyle,
    stringerRadiusScope: 'BOTTOM',
  });
  const sharp = flight(patchFor('SHARP'));
  const spline = flight(patchFor('SPLINE'));
  for (let i = 0; i < sharp.geo.outer.length; i++) {
    assert.ok(
      spline.geo.outer[i].lowerCurve.length > sharp.geo.outer[i].lowerCurve.length,
      `${sharp.geo.outer[i].segmentId}: lower contour should be smoothed`
    );
    assert.deepEqual(spline.geo.outer[i].upperCurve, sharp.geo.outer[i].upperCurve, `${sharp.geo.outer[i].segmentId}: upper contour is out of scope — must be untouched`);
  }
});

// --- reference path stability and determinism ----------------------------------------------

test('the plan reference path is untouched by any profile parameter or override (still straight, RULES #5)', () => {
  const plain = flight({ ...GEOMETRIES.L, totalRise: 2700 });
  const wild = flight({
    ...GEOMETRIES.L,
    totalRise: 2700,
    stringerCornerRadiusMm: 200,
    stringerRadiusScope: 'BOTH',
    stringerProfileOffsetMm: 80,
    stringerNotchRadiusMm: 10,
    manualStringerProfileOverrides: { outer: { mode: 'MANUAL', lower: { [anchorIdForTread(2)]: { dn: 30, ds: 20 } }, upper: {}, inserted: [] } },
  });
  for (const side of ['outer', 'inner']) {
    assert.deepEqual(
      wild.models[side].segments.map((s) => s.referenceLine),
      plain.models[side].segments.map((s) => s.referenceLine)
    );
  }
});

test('the profile solve is deterministic: two runs give deeply equal geometry', () => {
  const patch = { ...GEOMETRIES.U, totalRise: 2900, stringerCornerRadiusMm: 100, stringerRadiusScope: 'BOTH', stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' };
  assert.deepEqual(flight(patch).geo, flight(patch).geo);
});

// --- defaults preserve the old behaviour -----------------------------------------------------

test('with default profile parameters the lower contour is the plain straight offset — no arcs, one line per straight flight', () => {
  const { geo } = flight({ ...GEOMETRIES.straight, totalRise: 2600, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  for (const g of geo.outer) {
    assert.equal(g.lowerCurve.length, 1);
    assert.equal(g.lowerCurve[0].type, 'line');
    assert.ok(Math.abs(g.localDepthMm - 350) < 1e-6, 'the default depth is exactly the minimum');
  }
});

// --- local depth ---------------------------------------------------------------------------------

test('local depth may exceed the minimum (profile offset) but never falls below it', () => {
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerProfileOffsetMm: 60 });
  for (const g of [...geo.outer, ...geo.inner]) {
    assert.ok(g.localDepthMm >= 350 + 60 - 1e-3);
    assert.equal(g.requiredDepthMm, 350);
  }
});

test('a corner radius above the closed-form limit (r <= d) is clamped in AUTO so the minimum depth still holds, and the clamp is reported', () => {
  // A kinked reference (a winder-like bend upward) with the lower contour 300 deep and a 250 mm radius request.
  const reference = [
    { u: 0, v: 0, id: 'a' },
    { u: 600, v: 100, id: 'b' },
    { u: 1000, v: 500, id: 'c' },
    { u: 1600, v: 600, id: 'd' },
  ];
  const params = { ...profileParamsFromConfig({ minimumStringerDepthMm: 300, stringerCornerRadiusMm: 800, stringerRadiusScope: 'BOTTOM' }), topMarginMm: 0 };
  const solved = solveStringerProfile({ reference, constructionType: 'cut', params });
  assert.ok(solved.lowerCurve.some((p) => p.type === 'arc'), 'a corner was rounded');
  const depth = curveDistance(solved.lowerCurve, solved.depthReferenceCurve);
  assert.ok(depth >= 300 - 1e-3, `local depth ${depth}`);
  assert.ok(solved.findings.some((f) => f.ruleId === 'STRINGER-FILLET-CLAMPED'));
});

test('the solver rounds a corner exactly up to r = d without breaking the depth (closed form), and an explicit larger radius violates it', () => {
  const reference = [
    { u: 0, v: 0, id: 'a' },
    { u: 700, v: 0, id: 'b' },
    { u: 1300, v: 400, id: 'c' },
  ];
  const d = 300;
  const params = { ...profileParamsFromConfig({ minimumStringerDepthMm: d, stringerCornerRadiusMm: d, stringerRadiusScope: 'BOTTOM' }), topMarginMm: 0 };
  const atLimit = solveStringerProfile({ reference, constructionType: 'cut', params });
  assert.ok(curveDistance(atLimit.lowerCurve, atLimit.depthReferenceCurve) >= d - 1e-3);
  assert.equal(atLimit.findings.filter((f) => f.ruleId === 'STRINGER-FILLET-CLAMPED').length, 0, 'r = d needs no clamping');

  const explicit = solveStringerProfile({
    reference,
    constructionType: 'cut',
    params: profileParamsFromConfig({ minimumStringerDepthMm: d }),
    overrides: { mode: 'MANUAL', lower: { b: { radiusMm: 3 * d } }, upper: {}, inserted: [] },
  });
  assert.ok(curveDistance(explicit.lowerCurve, explicit.depthReferenceCurve) < d - 1, 'an explicit radius is a design decision — not silently reduced');
});

test('corners that only ADD material (turning away from the board) are always safe to round, whatever the radius', () => {
  // Reference bends DOWN (right turn) so the lower contour's corner is on the inside of the turn.
  const reference = [
    { u: 0, v: 400, id: 'a' },
    { u: 700, v: 400, id: 'b' },
    { u: 1300, v: 0, id: 'c' },
  ];
  const params = { ...profileParamsFromConfig({ minimumStringerDepthMm: 300, stringerCornerRadiusMm: 250, stringerRadiusScope: 'BOTTOM' }), topMarginMm: 0 };
  const solved = solveStringerProfile({ reference, constructionType: 'cut', params });
  assert.ok(solved.lowerCurve.some((p) => p.type === 'arc'));
  assert.ok(curveDistance(solved.lowerCurve, solved.depthReferenceCurve) >= 300 - 1e-3);
  assert.ok(!solved.findings.some((f) => f.ruleId === 'STRINGER-FILLET-CLAMPED' && /głębokość/.test(f.message)));
});

// --- geometry of the fillets on a real flight -----------------------------------------------------

test('winder: a rounded lower contour stays tangent-continuous (G1) at every arc join', () => {
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerCornerRadiusMm: 120, stringerRadiusScope: 'BOTTOM' });
  let arcs = 0;
  for (const g of [...geo.outer, ...geo.inner]) {
    const dirAt = (prim, atStart) => {
      if (prim.type === 'line') {
        const l = Math.hypot(prim.b.u - prim.a.u, prim.b.v - prim.a.v);
        return { u: (prim.b.u - prim.a.u) / l, v: (prim.b.v - prim.a.v) / l };
      }
      const ang = prim.startAngle + (atStart ? 0 : prim.sweep);
      const s = prim.sweep >= 0 ? 1 : -1;
      return { u: -Math.sin(ang) * s, v: Math.cos(ang) * s };
    };
    for (let i = 0; i < g.lowerCurve.length - 1; i++) {
      if (g.lowerCurve[i].type !== 'arc' && g.lowerCurve[i + 1].type !== 'arc') continue;
      arcs++;
      // The first join of a board right after a corner post is where the (existing) cross-segment
      // overshoot clamp may have nudged the board's start point — a sanity bound, not a design.
      if (i === 0 && g.segmentId !== 'outer-seg-0' && g.segmentId !== 'inner-seg-0') continue;
      const d1 = dirAt(g.lowerCurve[i], false);
      const d2 = dirAt(g.lowerCurve[i + 1], true);
      assert.ok(Math.abs(d1.u - d2.u) < 1e-6 && Math.abs(d1.v - d2.v) < 1e-6, 'tangent discontinuity at an arc join');
    }
  }
  assert.ok(arcs > 0, 'the winder profile has rounded corners');
});

test('the mesh polygon is the same curve as chords: arcs deviate from their chords by at most 0.1 mm', () => {
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerCornerRadiusMm: 150, stringerRadiusScope: 'BOTTOM', stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  for (const g of [...geo.outer, ...geo.inner]) {
    const chords = curveToPolyline(g.lowerCurve, 0.1);
    for (const p of chords) {
      // every chord vertex lies on the curve
      assert.ok(curveDistance(polylineToCurve([p, { u: p.u + 1e-3, v: p.v }]), g.lowerCurve) < 0.01);
    }
  }
});

test('housed board: scope TOP rounds only the upper contour, scope BOTTOM only the lower', () => {
  const base = { ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', stringerCornerRadiusMm: 100 };
  const top = flight({ ...base, stringerRadiusScope: 'TOP' }).geo.outer;
  const bottom = flight({ ...base, stringerRadiusScope: 'BOTTOM' }).geo.outer;
  assert.ok(top.some((g) => g.upperCurve.some((p) => p.type === 'arc')));
  assert.ok(top.every((g) => g.lowerCurve.every((p) => p.type === 'line')));
  assert.ok(bottom.some((g) => g.lowerCurve.some((p) => p.type === 'arc')));
  assert.ok(bottom.every((g) => g.upperCurve.every((p) => p.type === 'line')));
});

test('transition style SHARP switches the rounding off whatever the radius says', () => {
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerCornerRadiusMm: 200, stringerTransitionStyle: 'SHARP' });
  assert.ok([...geo.outer, ...geo.inner].every((g) => g.lowerCurve.every((p) => p.type === 'line')));
});

// --- notch (cut string) inside-corner radius ----------------------------------------------------

test('cut string: the notch radius rounds only the INSIDE corners of the comb; 0 leaves the comb exactly as before', () => {
  const base = { ...GEOMETRIES.straight, totalRise: 2600, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };
  const sharp = flight(base).geo.outer[0];
  const round = flight({ ...base, stringerNotchRadiusMm: 12 }).geo.outer[0];
  const arcs = round.upperCurve.filter((p) => p.type === 'arc');
  assert.ok(arcs.length > 0 && arcs.length <= 12);
  assert.ok(arcs.every((a) => a.sweep > 0 && Math.abs(Math.abs(a.sweep) - Math.PI / 2) < 1e-6), 'quarter-circle, counter-clockwise (an inside corner)');
  assert.ok(sharp.upperCurve.every((p) => p.type === 'line'));
  assert.ok(isSimplePolygon(round.outerContour));
  // rounding an inside corner only ever adds material: the rounded contour's area is not smaller
  const area = (poly) => Math.abs(poly.reduce((s, p, i) => s + (p.u * poly[(i + 1) % poly.length].v - poly[(i + 1) % poly.length].u * p.v), 0) / 2);
  assert.ok(area(round.outerContour) >= area(sharp.outerContour) - 1e-6);
});

// --- manual override layer --------------------------------------------------------------------

const STRAIGHT_CUT = { ...GEOMETRIES.straight, totalRise: 2600, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };

test('override: with an override present every tread is an addressable control point', () => {
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(5), { dn: 0.0001 });
  const { geo } = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides });
  const ids = geo.outer[0].lowerControl.map((c) => c.id);
  assert.ok(ids.includes(anchorIdForTread(5)) && ids.includes(END_ANCHOR_ID));
  assert.ok(geo.outer[0].profileOverridden);
  assert.equal(geo.inner[0].profileOverridden, false, 'the other stringer is unaffected');
});

test('override: moving a control point deeper (dn > 0) moves the lower contour there by that amount and keeps the minimum depth', () => {
  const nominal = flight(STRAIGHT_CUT).geo.outer[0];
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(6), { dn: 40 });
  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides }).geo.outer[0];
  assert.ok(edited.localDepthMm >= 350 - 1e-6);
  const moved = edited.lowerControl.find((c) => c.id === anchorIdForTread(6));
  // nominal position of that control point = the nominal lower line at the same offset; it sat on the line
  const line = nominal.lowerCurve[0];
  const dist = (p) => Math.abs((line.b.v - line.a.v) * (p.u - line.a.u) - (line.b.u - line.a.u) * (p.v - line.a.v)) / Math.hypot(line.b.u - line.a.u, line.b.v - line.a.v);
  assert.ok(Math.abs(dist(moved) - 40) < 1e-6, `moved ${dist(moved)} mm off the nominal line`);
  assert.ok(isSimplePolygon(edited.outerContour));
});

test('override: moving a control point shallower than the minimum is KEPT and reported as STRINGER-MIN-DEPTH (not silently rejected)', () => {
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(6), { dn: -60 });
  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides }).geo.outer[0];
  assert.ok(edited.localDepthMm < 350 - 1);
  const d = edited.diagnostics.find((x) => x.ruleId === 'STRINGER-MIN-DEPTH');
  assert.ok(d && d.severity === 'ERROR' && d.unit === 'mm');
});

// Regression: SPLINE's own AUTO minimum-depth safety net (solveContour pushes the WHOLE curve
// away from `opposite` when it locally undershoots — see stringerProfileSolver.js) must NEVER
// run once the user has manually moved a point on that contour. It is a GLOBAL push (every point
// shifts, not just the one being edited) — applying it after a manual edit undid/distorted a
// deliberately hand-shaped board the moment it dipped under the minimum, reported as "moving a
// point wrecks the whole geometry." A manual edit is a design decision: it must be KEPT and
// reported (STRINGER-MIN-DEPTH), exactly like an explicit fillet radius already is, never
// silently corrected — and unlike that global push, nothing OTHER than the point actually
// dragged should move at all.
test('SPLINE: a manually moved point violating the minimum depth is KEPT and reported, and does not drag the rest of the curve with it', () => {
  // A perfectly straight/uniform flight's control polygon simplifies down to just its two end
  // knots (see the "SPLINE: a perfectly straight flight..." test above) — nothing left over to
  // prove stayed untouched. An L-winder has real interior knots (support:step-4, step-9) to check.
  const winderPatch = { ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SPLINE', stringerRadiusScope: 'BOTH' };
  const nominal = flight(winderPatch).geo.outer[0];
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(4), { dn: -60 });
  const edited = flight({ ...winderPatch, manualStringerProfileOverrides: overrides }).geo.outer[0];

  // The violation is real and reported, not silently pushed back into compliance.
  assert.ok(edited.localDepthMm < 350 - 1, `expected a real violation, got localDepthMm=${edited.localDepthMm}`);
  const d = edited.diagnostics.find((x) => x.ruleId === 'STRINGER-MIN-DEPTH');
  assert.ok(d && d.severity === 'ERROR');

  // A point far from the one that was dragged is essentially untouched — proof the fix didn't
  // silently fall back to a global push (which would have moved EVERY point, not just this one).
  const untouchedId = anchorIdForTread(9);
  const before = nominal.lowerControl.find((c) => c.id === untouchedId);
  const after = edited.lowerControl.find((c) => c.id === untouchedId);
  assert.ok(before && after, 'both solves must have this knot');
  assert.ok(Math.hypot(after.u - before.u, after.v - before.v) < 1, `an untouched point moved by ${Math.hypot(after.u - before.u, after.v - before.v)} mm — the whole curve was pushed`);
});

test('SPLINE: with NO manual override, the AUTO safety push still keeps the minimum depth exactly as the grid test already checks', () => {
  // Same scenario as the test above, minus the override — confirms the guard only skips the push
  // when there IS a manual point, not unconditionally.
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', stringerTransitionStyle: 'SPLINE', stringerRadiusScope: 'BOTH' });
  for (const g of geo.outer) assert.ok(g.localDepthMm >= 350 - 1e-3);
});

test('override: an explicit corner radius on one control point is honoured (an arc appears there and only there)', () => {
  const overrides = setVertexOverride(setVertexOverride({}, 'outer', 'lower', anchorIdForTread(6), { dn: 80 }), 'outer', 'lower', anchorIdForTread(6), { radiusMm: 60 });
  const { geo } = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides });
  const arcs = geo.outer[0].lowerCurve.filter((p) => p.type === 'arc');
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].radius <= 60 + 1e-9, true);
  assert.ok(geo.inner[0].lowerCurve.every((p) => p.type === 'line'));
});

test('override: an inserted control point splits an edge and can be pulled deeper', () => {
  const overrides = sanitizeStringerProfileOverrides({
    outer: { mode: 'MANUAL', lower: {}, upper: {}, inserted: [{ id: 'belly', contour: 'lower', after: anchorIdForTread(3), t: 0.5, dn: 90 }] },
  });
  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides }).geo.outer[0];
  assert.ok(edited.lowerControl.some((c) => c.id === 'belly' && c.inserted));
  assert.ok(edited.lowerCurve.length >= 2);
  assert.ok(isSimplePolygon(edited.outerContour));
});

test('override: an anchor that no longer exists is reported (ORPHANED) and changes nothing', () => {
  const nominal = flight(STRAIGHT_CUT).geo.outer[0];
  const overrides = setVertexOverride({}, 'outer', 'lower', 'support:step-99', { dn: 50 });
  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides }).geo.outer[0];
  assert.ok(edited.diagnostics.some((d) => d.ruleId === 'STRINGER-OVERRIDE-ORPHANED' && d.severity === 'WARNING'));
  assert.deepEqual(edited.bottomProfile, nominal.bottomProfile);
});

test('override: a move that would fold the contour onto itself is rejected and reported (REJECTED), the rest of the profile is unchanged', () => {
  const nominal = flight(STRAIGHT_CUT).geo.outer[0];
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(6), { ds: 5000 });
  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: overrides }).geo.outer[0];
  assert.ok(edited.diagnostics.some((d) => d.ruleId === 'STRINGER-OVERRIDE-REJECTED'));
  assert.ok(isSimplePolygon(edited.outerContour));
  assert.equal(edited.lowerCurve.length, nominal.lowerCurve.length);
});

test('override: mode AUTO ignores the stored entries (they stay data, the profile is fully derived)', () => {
  const nominal = flight(STRAIGHT_CUT).geo.outer[0];
  const stored = { outer: { mode: 'AUTO', lower: { [anchorIdForTread(6)]: { dn: 80 } }, upper: {}, inserted: [] } };
  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: stored }).geo.outer[0];
  assert.deepEqual(edited.bottomProfile, nominal.bottomProfile);
  assert.equal(edited.profileOverridden, false);
  assert.equal(countProfileOverrides(stored), 0, 'an AUTO layer does not count as manual edits');
});

test('override: survives a change in the number of treads elsewhere (semantic anchors, not indices)', () => {
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(2), { dn: 25 });
  const a = flight({ ...STRAIGHT_CUT, treadsLegA: 12, manualStringerProfileOverrides: overrides }).geo.outer[0];
  const b = flight({ ...STRAIGHT_CUT, treadsLegA: 14, manualStringerProfileOverrides: overrides }).geo.outer[0];
  for (const g of [a, b]) {
    assert.ok(g.lowerControl.find((c) => c.id === anchorIdForTread(2)).overridden);
    assert.ok(!ruleIds([g]).includes('STRINGER-OVERRIDE-ORPHANED'));
  }
});

test('override: composes with a manual tread-edge override — both apply, geometry stays valid', () => {
  const edge = { 4: { movedEndpoint: 'outer', point: null } };
  void edge;
  const overrides = setVertexOverride({}, 'outer', 'lower', anchorIdForTread(4), { dn: 30 });
  const patch = { ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', manualStringerProfileOverrides: overrides, manualTreadOverhangs: { 3: { side: 'outer', offsetMm: 30 } } };
  const { geo } = flight(patch);
  assert.deepEqual(errorsOf(geo.outer).filter((d) => d.ruleId === 'STRINGER-MIN-DEPTH'), []);
  assert.ok(geo.outer.every((g) => isSimplePolygon(g.outerContour)));
});

// --- data layer ---------------------------------------------------------------------------------

test('setVertexOverride: merges, removes on null, drops empty overrides, never mutates its input', () => {
  const a = setVertexOverride({}, 'outer', 'lower', 'support:step-1', { dn: 10, radiusMm: 5 });
  const frozen = JSON.stringify(a);
  const b = setVertexOverride(a, 'outer', 'lower', 'support:step-1', { dn: null });
  assert.equal(JSON.stringify(a), frozen);
  assert.deepEqual(b.outer.lower['support:step-1'], { radiusMm: 5 });
  const c = setVertexOverride(b, 'outer', 'lower', 'support:step-1', { radiusMm: null });
  assert.deepEqual(c, {});
});

test('profileParamsFromConfig: defaults for missing/invalid values; depth = minimum + non-negative offset', () => {
  assert.equal(profileParamsFromConfig({}).minimumDepthMm, 350);
  assert.equal(profileParamsFromConfig({ minimumStringerDepthMm: 400, stringerProfileOffsetMm: 25 }).nominalDepthMm, 425);
  assert.equal(profileParamsFromConfig({ stringerProfileOffsetMm: -50 }).nominalDepthMm, 350, 'a negative offset would break the minimum — it is clamped to 0');
  assert.equal(profileParamsFromConfig({ stringerRadiusScope: 'nope', stringerTransitionStyle: 'nope' }).radiusScope, 'BOTTOM');
  assert.equal(profileParamsFromConfig({ stringerCornerRadiusMm: 'x' }).cornerRadiusMm, 0);
});

// --- side-view model + edit events -------------------------------------------------------------------

test('applyProfileEdit: move / radius / insert / reset / mode are pure and compose', () => {
  let o = {};
  o = applyProfileEdit(o, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', contour: 'lower', anchorId: 'support:step-2', ds: 5, dn: 20 });
  o = applyProfileEdit(o, { type: PROFILE_EDITS.SET_RADIUS, side: 'outer', contour: 'lower', anchorId: 'support:step-2', radiusMm: 40 });
  assert.deepEqual(o.outer.lower['support:step-2'], { ds: 5, dn: 20, radiusMm: 40 });

  const before = JSON.stringify(o);
  o = applyProfileEdit(o, { type: PROFILE_EDITS.INSERT_VERTEX, side: 'outer', contour: 'lower', id: 'p1', after: 'support:step-3', t: 0.4, dn: 10 });
  assert.equal(o.outer.inserted.length, 1);
  o = applyProfileEdit(o, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', anchorId: 'p1', dn: 33 });
  assert.equal(o.outer.inserted[0].dn, 33);
  o = applyProfileEdit(o, { type: PROFILE_EDITS.RESET_VERTEX, side: 'outer', contour: 'lower', anchorId: 'p1' });
  assert.equal(o.outer.inserted.length, 0);
  o = applyProfileEdit(o, { type: PROFILE_EDITS.RESET_VERTEX, side: 'outer', contour: 'lower', anchorId: 'support:step-2' });
  assert.deepEqual(o, {}, 'resetting every edit leaves an empty layer');
  assert.notEqual(before, JSON.stringify(o));

  const auto = applyProfileEdit({ outer: { mode: 'MANUAL', lower: { a: { dn: 1 } }, upper: {}, inserted: [] } }, { type: PROFILE_EDITS.SET_MODE, side: 'outer', mode: 'AUTO' });
  assert.equal(auto.outer.mode, 'AUTO');
});

test('view model: a drag becomes the same (ds, dn) that produces that position (round trip through the solver)', () => {
  const base = { ...STRAIGHT_CUT, manualStringerProfileOverrides: setVertexOverride({}, 'outer', 'lower', anchorIdForTread(6), { dn: 0.001 }) };
  const first = flight(base);
  const view = buildProfileViewModel(first.geo.outer, first.models.outer, first.config)[0];
  const cp = view.controlPoints.find((c) => c.id === anchorIdForTread(6) && c.contour === 'lower');
  const target = { u: cp.nominal.u + 12, v: cp.nominal.v - 70 };
  const { ds, dn } = offsetFromDrag(cp, target);

  const edited = flight({ ...STRAIGHT_CUT, manualStringerProfileOverrides: applyProfileEdit({}, { type: PROFILE_EDITS.MOVE_VERTEX, side: 'outer', contour: 'lower', anchorId: anchorIdForTread(6), ds, dn }) });
  const cp2 = buildProfileViewModel(edited.geo.outer, edited.models.outer, edited.config)[0].controlPoints.find((c) => c.id === anchorIdForTread(6) && c.contour === 'lower');
  assert.ok(Math.abs(cp2.u - target.u) < 1e-6 && Math.abs(cp2.v - target.v) < 1e-6, `${cp2.u},${cp2.v} vs ${target.u},${target.v}`);
});

test('view model: carries treads, contours, the minimum-depth envelope, depth samples and control points', () => {
  const { geo, models, config } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerCornerRadiusMm: 100 });
  const views = buildProfileViewModel(geo.outer, models.outer, config);
  assert.equal(views.length, geo.outer.length);
  for (const v of views) {
    assert.ok(v.treads.length > 0 && v.lowerCurve.length > 0 && v.depthSamples.length > 1);
    assert.ok(v.minimumDepthEnvelope.length >= 2);
    assert.equal(v.requiredDepthMm, 350);
    assert.ok(v.controlPoints.some((c) => c.kind === 'anchored'));
  }
  assert.ok(views.some((v) => v.arcs.length > 0));
});

// --- board ends: floor foot horizontal, every other end a plumb face -------------------------------

const END_CASES = [
  ['straight cut', { ...GEOMETRIES.straight, totalRise: 2600, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' }],
  ['straight closed', { ...GEOMETRIES.straight, totalRise: 2600, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' }],
  ['L cut, corner post', { ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' }],
  ['L cut, NO post (lap joint)', { ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasCornerPost: false }],
  ['L closed, NO post (lap joint)', { ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', hasCornerPost: false }],
  ['U cut', { ...GEOMETRIES.U, totalRise: 2900, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' }],
  ['U closed with radius', { ...GEOMETRIES.U, totalRise: 2900, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', stringerCornerRadiusMm: 100, stringerRadiusScope: 'BOTH' }],
];

for (const [label, patch] of END_CASES) {
  test(`board ends — ${label}: both end faces are vertical (plumb) planes, on every board`, () => {
    const { geo } = flight(patch);
    for (const side of ['outer', 'inner']) {
      for (const g of geo[side]) {
        const us = g.outerContour.map((p) => p.u);
        const minU = Math.min(...us);
        const maxU = Math.max(...us);
        // nothing sticks out past a face, and the faces are where `ends` says
        assert.ok(Math.abs(maxU - g.ends.end.u) < 1e-6, `${side}/${g.segmentId}: end face at ${maxU}, ends says ${g.ends.end.u}`);
        // a vertical edge exists at each end (two contour points share that u and are joined by an edge)
        const n = g.outerContour.length;
        const hasVerticalEdgeAt = (u) => g.outerContour.some((p, i) => Math.abs(p.u - u) < 1e-6 && Math.abs(g.outerContour[(i + 1) % n].u - u) < 1e-6 && Math.abs(g.outerContour[(i + 1) % n].v - p.v) > 1e-6);
        assert.ok(hasVerticalEdgeAt(maxU), `${side}/${g.segmentId}: the end at u=${maxU} is not a vertical face`);
        if (g.ends.start.cut === 'VERTICAL') {
          assert.ok(Math.abs(minU - g.ends.start.u) < 1e-6);
          assert.ok(hasVerticalEdgeAt(minU), `${side}/${g.segmentId}: the start at u=${minU} is not a vertical face`);
        }
      }
    }
  });

  test(`board ends — ${label}: the foot is cut horizontally along the floor line and nothing goes below the floor`, () => {
    const { geo } = flight(patch);
    for (const side of ['outer', 'inner']) {
      const first = geo[side][0];
      const vs = first.outerContour.map((p) => p.v);
      assert.ok(Math.min(...vs) >= -1e-9, `${side}: the first board dips below the floor`);
      assert.equal(first.ends.start.cut, 'FLOOR_HORIZONTAL');
      const n = first.outerContour.length;
      const horizontalOnFloor = first.outerContour.some((p, i) => Math.abs(p.v) < 1e-9 && Math.abs(first.outerContour[(i + 1) % n].v) < 1e-9 && Math.abs(first.outerContour[(i + 1) % n].u - p.u) > 1e-6);
      assert.ok(horizontalOnFloor, `${side}: no horizontal edge on the floor line`);
      // only the very first board is a foot; later boards keep plain vertical faces
      for (const later of geo[side].slice(1)) assert.equal(later.ends.start.cut, 'VERTICAL');
      assert.ok(isSimplePolygon(first.outerContour));
    }
  });
}

test('board ends: at a postless lap joint the top and the lower contour end at the SAME plane (no slanted end face)', () => {
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', hasCornerPost: false });
  const [a, b] = geo.outer;
  // the first board's end is the lap: its top ran one board thickness past the segment end, and the lower contour must too
  assert.ok(a.ends.end.u > a.pitchProfile[a.pitchProfile.length - 1].u + 1, 'the board reaches past the segment end (the lap)');
  assert.ok(b.ends.start.u < -1);
  const lowEnd = a.lowerCurve[a.lowerCurve.length - 1].b;
  assert.ok(Math.abs(lowEnd.u - a.ends.end.u) < 1e-6);
});

// --- regression: a near-vertical end edge (tight winder) must still reach its end face -----------------
//
// Reported with the user's own project (a 700 mm wide L, 4 winders, 210 mm treads, walkline offset 280):
// the first treads of the inner stringer's second board are only 15-55 mm deep against a ~190 mm riser, so
// the profile's first edge is 80+ degrees steep. Without risers the lower contour started 280 mm short of
// its start face (the board "detached from the post"); with risers the same edge was extrapolated to
// v = -1630 (1.6 m below the floor).
const TIGHT_WINDER = { stairType: 'L', turn1Type: 'winder', turnDirection: 'right', totalRise: 2930, stairWidth: 700, treadGoing: 210, treadsLegA: 6, treadsLegB: 2, windersPerTurn: 4, walklineOffset: 280, walklineSplitOffset: 400, minInnerWidth: 105, nosing: 20, riserBoardThickness: 16, postSize: 70, hasCornerPost: true, minimumStringerDepthMm: 330 };

for (const type of ['closed', 'cut']) {
  for (const risers of [false, true]) {
    test(`tight winder (${type}, ${risers ? 'with' : 'without'} risers): every board's lower and upper contour reach their start/end faces and never go below the floor`, () => {
      const { geo } = flight({ ...TIGHT_WINDER, stringerConstructionTypeOuter: type, stringerConstructionTypeInner: type, hasRiserBoards: risers });
      for (const side of ['outer', 'inner']) {
        for (const g of geo[side]) {
          assert.ok(Math.min(...g.outerContour.map((p) => p.v)) >= -1e-6, `${side}/${g.segmentId}: dips below the floor`);
          const lowStart = g.lowerCurve[0].a;
          const lowEnd = g.lowerCurve[g.lowerCurve.length - 1].b;
          if (g.ends.start.cut === 'VERTICAL') assert.ok(Math.abs(lowStart.u - g.ends.start.u) < 1e-6, `${side}/${g.segmentId}: lower contour starts at u=${lowStart.u}, its start face is at ${g.ends.start.u}`);
          assert.ok(Math.abs(lowEnd.u - g.ends.end.u) < 1e-6, `${side}/${g.segmentId}: lower contour ends at u=${lowEnd.u}, its end face is at ${g.ends.end.u}`);
          assert.ok(isSimplePolygon(g.outerContour), `${side}/${g.segmentId}: self-intersecting`);
        }
      }
    });
  }
}

test('sliceCurveByU: an end edge steeper than the limit is capped flat instead of extrapolated (or left detached when vertical)', () => {
  const steep = polylineToCurve([{ u: 300, v: 1500 }, { u: 302, v: 1700 }, { u: 900, v: 2200 }]); // 89 degrees at the start
  const capped = sliceCurveByU(steep, 0, 900, 2.75);
  assert.equal(capped[0].a.u, 0);
  assert.equal(capped[0].a.v, 1500, 'flat cap at the first vertex height');
  const vertical = polylineToCurve([{ u: 300, v: 1500 }, { u: 300, v: 1700 }, { u: 900, v: 2200 }]);
  assert.equal(sliceCurveByU(vertical, 0, 900, 2.75)[0].a.u, 0, 'a vertical first edge still reaches the face');
  const gentle = polylineToCurve([{ u: 300, v: 1500 }, { u: 900, v: 2000 }]); // slope 0.83
  assert.ok(sliceCurveByU(gentle, 0, 900, 2.75)[0].a.v < 1500 - 100, 'a gentle edge is still continued along its own line');
});

// --- at a structural post each board is independent (user decision) ------------------------------------
//
// Earlier stages forced continuity at a corner post: the next board's top was clamped to the previous board's top
// end and a steep start was "blended" down to the previous board's lower end with a horizontal run — stretching the
// board. With a post the boards need no common course: each butts into the post's face with its own profile and the
// post is the support. (Continuity is still solved where boards meet WITHOUT a post — a lap joint.)

for (const type of ['closed', 'cut']) {
  for (const risers of [false, true]) {
    test(`at a corner post (${type}, ${risers ? 'with' : 'without'} risers) the next board is independent of the previous one and starts plumb at the post face`, () => {
      const { config, models, geo } = flight({ ...TIGHT_WINDER, stringerConstructionTypeOuter: type, stringerConstructionTypeInner: type, hasRiserBoards: risers });
      const model = models.inner;
      assert.equal(model.segmentJoints[0].type, 'corner-post');
      const seg = model.segments[1];
      const g = geo.inner[1];
      assert.equal(g.ends.start.blendedToPreviousEnd, undefined, 'never blended down to the previous board');
      assert.equal(g.ends.start.cut, 'VERTICAL');
      assert.ok(Math.abs(g.ends.start.u - seg.startPost.faceU) < 1e-6, 'starts at the post face');
      // the same board solved on its own (no previous board at all) comes out identical
      const alone = buildStringerConstructionGeometry({ ...model, segments: [seg], segmentJoints: [] }, config)[0];
      assert.deepEqual(alone.outerContour, g.outerContour);
      assert.ok(isSimplePolygon(g.outerContour));
      assert.ok(Math.min(...g.outerContour.map((p) => p.v)) >= 0);
    });
  }
}

test('steep start blend: a start that is NOT steep is untouched (no blend, no cap) — the ordinary winder', () => {
  const { geo } = flight({ ...GEOMETRIES.L, totalRise: 2700, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  for (const g of [...geo.outer, ...geo.inner]) {
    assert.ok(!g.ends.start.blendedToPreviousEnd);
    assert.ok(!g.ends.start.capped);
  }
});
