import test from 'node:test';
import assert from 'node:assert/strict';

import {
  polylineToCurve,
  filletArcAt,
  feasibleRadii,
  filletPolyline,
  curveToPolyline,
  sliceCurveByU,
  curveDistance,
  curveLength,
  curveStart,
  curveEnd,
  makeArc,
  lineSegment,
  pointToCurveDistance,
  mergeCollinearLines,
  reverseCurve,
  splineThroughPoints,
} from '../profileCurve.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (eps ${eps})`);

// Independent reference: densely sample both curves and take the smallest pairwise distance.
function sampledDistance(curveA, curveB, perPrim = 400) {
  const sample = (curve) => {
    const pts = [];
    for (const prim of curve) {
      for (let k = 0; k <= perPrim; k++) {
        const t = k / perPrim;
        if (prim.type === 'line') pts.push({ u: prim.a.u + (prim.b.u - prim.a.u) * t, v: prim.a.v + (prim.b.v - prim.a.v) * t });
        else {
          const ang = prim.startAngle + prim.sweep * t;
          pts.push({ u: prim.center.u + prim.radius * Math.cos(ang), v: prim.center.v + prim.radius * Math.sin(ang) });
        }
      }
    }
    return pts;
  };
  const a = sample(curveA);
  const b = sample(curveB);
  let min = Infinity;
  for (const p of a) for (const q of b) min = Math.min(min, Math.hypot(p.u - q.u, p.v - q.v));
  return min;
}

test('filletArcAt: a 90 degree corner gets a quarter circle tangent to both edges', () => {
  const arc = filletArcAt({ u: 0, v: 0 }, { u: 100, v: 0 }, { u: 100, v: 100 }, 20);
  assert.equal(arc.type, 'arc');
  near(arc.tangentLength, 20);
  near(arc.a.u, 80);
  near(arc.a.v, 0);
  near(arc.b.u, 100);
  near(arc.b.v, 20);
  near(arc.center.u, 80);
  near(arc.center.v, 20);
  near(Math.abs(arc.sweep), Math.PI / 2);
  assert.ok(arc.sweep > 0, 'a left turn sweeps counter-clockwise');
});

test('filletArcAt: a right turn sweeps clockwise; a straight run or radius 0 gives no arc', () => {
  const right = filletArcAt({ u: 0, v: 0 }, { u: 100, v: 0 }, { u: 100, v: -100 }, 20);
  assert.ok(right.sweep < 0);
  near(right.center.v, -20);
  assert.equal(filletArcAt({ u: 0, v: 0 }, { u: 50, v: 0 }, { u: 100, v: 0 }, 20), null);
  assert.equal(filletArcAt({ u: 0, v: 0 }, { u: 100, v: 0 }, { u: 100, v: 100 }, 0), null);
});

test('feasibleRadii: two fillets sharing an edge never consume more than its length', () => {
  const pts = [{ u: 0, v: 0 }, { u: 100, v: 0 }, { u: 150, v: 0 }, { u: 150, v: 100 }];
  // make the middle edge short: vertices 1 and 2 are both corners on a zig-zag
  const zig = [{ u: 0, v: 0 }, { u: 100, v: 0 }, { u: 130, v: 60 }, { u: 230, v: 60 }];
  const applied = feasibleRadii(zig, [0, 500, 500, 0]);
  const arcs = [1, 2].map((i) => filletArcAt(zig[i - 1], zig[i], zig[i + 1], applied[i]));
  const edgeLen = Math.hypot(30, 60);
  assert.ok(arcs[0].tangentLength + arcs[1].tangentLength <= edgeLen + 1e-9);
  assert.ok(applied[1] < 500 && applied[2] < 500, 'both were scaled down');
  assert.equal(pts.length, 4);
});

test('filletPolyline: keeps the ends, stays continuous and G1 (tangent) at every join', () => {
  const pts = [{ u: 0, v: 0 }, { u: 200, v: 0 }, { u: 400, v: 150 }, { u: 600, v: 150 }];
  const { curve, fillets } = filletPolyline(pts, [0, 60, 60, 0]);
  assert.equal(fillets.length, 2);
  near(curveStart(curve).u, 0);
  near(curveEnd(curve).u, 600);
  for (let i = 0; i < curve.length - 1; i++) {
    near(curve[i].b.u, curve[i + 1].a.u, 1e-9);
    near(curve[i].b.v, curve[i + 1].a.v, 1e-9);
  }
  // tangent continuity: the direction leaving one primitive equals the direction entering the next
  const dir = (prim, atStart) => {
    if (prim.type === 'line') {
      const l = Math.hypot(prim.b.u - prim.a.u, prim.b.v - prim.a.v);
      return { u: (prim.b.u - prim.a.u) / l, v: (prim.b.v - prim.a.v) / l };
    }
    const ang = prim.startAngle + (atStart ? 0 : prim.sweep);
    const s = prim.sweep >= 0 ? 1 : -1;
    return { u: -Math.sin(ang) * s, v: Math.cos(ang) * s };
  };
  for (let i = 0; i < curve.length - 1; i++) {
    const d1 = dir(curve[i], false);
    const d2 = dir(curve[i + 1], true);
    near(d1.u, d2.u, 1e-9);
    near(d1.v, d2.v, 1e-9);
  }
});

test('filletPolyline: radius 0 and straight vertices leave the polyline exactly as lines', () => {
  const pts = [{ u: 0, v: 0 }, { u: 100, v: 50 }, { u: 200, v: 100 }, { u: 300, v: 200 }];
  const { curve, fillets } = filletPolyline(pts, [0, 0, 0, 0]);
  assert.equal(fillets.length, 0);
  assert.ok(curve.every((p) => p.type === 'line'));
  assert.deepEqual(curveToPolyline(curve), pts);
});

test('curveToPolyline: arc chords never deviate from the arc by more than the tolerance', () => {
  const arc = makeArc({ u: 0, v: 0 }, 100, 0, Math.PI / 2);
  const pts = curveToPolyline([arc], 0.1);
  assert.ok(pts.length > 4);
  for (let i = 0; i < pts.length - 1; i++) {
    const mid = { u: (pts[i].u + pts[i + 1].u) / 2, v: (pts[i].v + pts[i + 1].v) / 2 };
    const sag = 100 - Math.hypot(mid.u, mid.v);
    assert.ok(sag <= 0.1 + 1e-9, `sag ${sag}`);
  }
  near(pts[0].u, 100);
  near(pts[pts.length - 1].v, 100);
});

test('curveLength: quarter arc = pi/2 * r', () => {
  near(curveLength([makeArc({ u: 0, v: 0 }, 100, 0, Math.PI / 2)]), (Math.PI / 2) * 100);
});

test('sliceCurveByU: cuts lines and arcs at exact u, keeps endpoints on the requested planes', () => {
  const pts = [{ u: 0, v: 0 }, { u: 200, v: 0 }, { u: 400, v: 150 }, { u: 600, v: 150 }];
  const { curve } = filletPolyline(pts, [0, 80, 80, 0]);
  const slice = sliceCurveByU(curve, 150, 450);
  near(curveStart(slice).u, 150);
  near(curveEnd(slice).u, 450);
  // every sliced point is on the original curve
  for (const p of curveToPolyline(slice, 0.01)) assert.ok(pointToCurveDistance(p, curve) < 0.02);
  // concatenating slices reproduces the whole curve's length
  const parts = [sliceCurveByU(curve, 0, 250), sliceCurveByU(curve, 250, 600)];
  near(curveLength(parts[0]) + curveLength(parts[1]), curveLength(curve), 1e-6);
});

test('sliceCurveByU: a span past the ends is continued along the end tangent', () => {
  const curve = polylineToCurve([{ u: 100, v: 0 }, { u: 300, v: 100 }]);
  const slice = sliceCurveByU(curve, 0, 400);
  near(curveStart(slice).u, 0);
  near(curveStart(slice).v, -50);
  near(curveEnd(slice).u, 400);
  near(curveEnd(slice).v, 150);
});

test('curveDistance: parallel offset lines are exactly the offset apart', () => {
  const a = polylineToCurve([{ u: 0, v: 0 }, { u: 100, v: 0 }]);
  const b = polylineToCurve([{ u: 0, v: -30 }, { u: 100, v: -30 }]);
  near(curveDistance(a, b), 30);
});

test('curveDistance: crossing curves are at distance 0', () => {
  const a = polylineToCurve([{ u: 0, v: 0 }, { u: 100, v: 100 }]);
  const b = polylineToCurve([{ u: 0, v: 100 }, { u: 100, v: 0 }]);
  assert.equal(curveDistance(a, b), 0);
});

test('curveDistance: agrees with dense sampling for line/arc and arc/arc pairs (independent implementation)', () => {
  const cases = [];
  const line = (a, b) => lineSegment(a, b);
  cases.push([[line({ u: 0, v: 0 }, { u: 200, v: 0 })], [makeArc({ u: 100, v: 80 }, 30, Math.PI, Math.PI)]]); // arc above line, bulging down
  cases.push([[line({ u: 0, v: 0 }, { u: 200, v: 40 })], [makeArc({ u: 100, v: 150 }, 60, 0, Math.PI * 1.2)]]);
  cases.push([[makeArc({ u: 0, v: 0 }, 50, 0, Math.PI / 2)], [makeArc({ u: 200, v: 0 }, 60, Math.PI / 2, Math.PI / 2)]]);
  cases.push([[makeArc({ u: 0, v: 0 }, 50, 0, Math.PI)], [makeArc({ u: 20, v: 10 }, 120, Math.PI * 0.9, Math.PI * 0.5)]]);
  cases.push([[line({ u: -50, v: 90 }, { u: 30, v: 90 })], [makeArc({ u: 0, v: 0 }, 60, 0, Math.PI)]]);
  for (const [a, b] of cases) near(curveDistance(a, b), sampledDistance(a, b), 0.05);
});

test('fillet of a convex corner: the arc apex stays >= d from the reference iff radius <= d (the closed-form claim)', () => {
  // Reference polyline with a 60 degree upward kink; lower contour = its miter offset at d.
  const d = 100;
  const ref = [{ u: 0, v: 0 }, { u: 400, v: 0 }, { u: 400 + 300 * Math.cos(Math.PI / 3), v: 300 * Math.sin(Math.PI / 3) }];
  // offset each edge by d on the right-hand side and intersect: the lower contour's convex tip
  const n1 = { u: 0, v: -1 };
  const dir2 = { u: Math.cos(Math.PI / 3), v: Math.sin(Math.PI / 3) };
  const n2 = { u: dir2.v, v: -dir2.u };
  const e1 = { a: { u: n1.u * d, v: n1.v * d }, dir: { u: 1, v: 0 } };
  const e2 = { a: { u: ref[1].u + n2.u * d, v: ref[1].v + n2.v * d }, dir: dir2 };
  // intersection of e1 and e2 lines
  const det = e1.dir.u * -e2.dir.v + e1.dir.v * e2.dir.u;
  const t = ((e2.a.u - e1.a.u) * -e2.dir.v + (e2.a.v - e1.a.v) * e2.dir.u) / det;
  const tip = { u: e1.a.u + e1.dir.u * t, v: e1.a.v + e1.dir.v * t };
  const start = { u: -300, v: -d };
  const end = { u: tip.u + dir2.u * 300, v: tip.v + dir2.v * 300 };
  const refCurve = polylineToCurve(ref);
  for (const [radius, shouldHold] of [[50, true], [100, true], [101, false], [200, false]]) {
    const arc = filletArcAt(start, tip, end, radius);
    const dEff = curveDistance([arc], refCurve);
    if (shouldHold) assert.ok(dEff >= d - 1e-6, `radius ${radius}: ${dEff} < ${d}`);
    else assert.ok(dEff < d - 1e-6, `radius ${radius}: ${dEff} should be < ${d}`);
  }
});

// Regression (was polylineProfile.test.js "sliceOffsetProfile never inserts the reference polyline's
// own endpoint as a spurious interior knot"): a riser-recess-shifted first bearing puts the
// profile's own first control point at u=25 while the physical board starts at u=0. Cutting the
// board's span out of a straight 2-knot profile must give ONE straight line, not two collinear
// pieces meeting at the profile's own end vertex, and must stay u-monotonic.
test('a straight profile sliced wider than its own control points stays ONE line (no spurious interior vertex)', () => {
  const profile = polylineToCurve([{ u: 25, v: 133.33 }, { u: 3920, v: 2544.52 }]);
  const wider = polylineToCurve([{ u: 0, v: 117.85381258023108 }, { u: 25, v: 133.33 }, { u: 3920, v: 2544.52 }]);
  assert.equal(mergeCollinearLines(sliceCurveByU(profile, 0, 3920)).length, 1);
  const merged = mergeCollinearLines(wider);
  assert.equal(merged.length, 1, 'collinear pieces merge back into one line');
  assert.ok(curveStart(merged).u < curveEnd(merged).u);
});

test('mergeCollinearLines never merges across a real corner or an arc', () => {
  const { curve } = filletPolyline([{ u: 0, v: 0 }, { u: 200, v: 0 }, { u: 400, v: 150 }, { u: 600, v: 150 }], [0, 60, 0, 0]);
  assert.equal(mergeCollinearLines(curve).length, curve.length);
});

test('reverseCurve: traversing a mixed line/arc curve backwards visits the same points, endpoints swapped', () => {
  const { curve } = filletPolyline([{ u: 0, v: 0 }, { u: 200, v: 0 }, { u: 400, v: 150 }, { u: 600, v: 150 }], [0, 60, 0, 0]);
  const reversed = reverseCurve(curve);
  near(reversed[0].a.u, curveEnd(curve).u);
  near(reversed[0].a.v, curveEnd(curve).v);
  near(curveEnd(reversed).u, curveStart(curve).u);
  near(curveEnd(reversed).v, curveStart(curve).v);
  // reversing twice gets back the original curve, primitive for primitive
  const roundTrip = reverseCurve(reversed);
  assert.equal(roundTrip.length, curve.length);
  for (let i = 0; i < curve.length; i++) {
    near(roundTrip[i].a.u, curve[i].a.u);
    near(roundTrip[i].a.v, curve[i].a.v);
    near(roundTrip[i].b.u, curve[i].b.u);
    near(roundTrip[i].b.v, curve[i].b.v);
    if (curve[i].type === 'arc') near(roundTrip[i].sweep, curve[i].sweep);
  }
  // consecutive primitives still connect after reversing
  for (let i = 0; i < reversed.length - 1; i++) near(dist2(reversed[i].b, reversed[i + 1].a), 0);
});

function dist2(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

test('splineThroughPoints: passes exactly through every given point', () => {
  const points = [{ u: 0, v: 0 }, { u: 100, v: 40 }, { u: 250, v: 30 }, { u: 400, v: 90 }, { u: 600, v: 100 }];
  const curve = splineThroughPoints(points);
  assert.ok(curve && curve.length > 0);
  near(curveStart(curve).u, 0);
  near(curveStart(curve).v, 0);
  near(curveEnd(curve).u, 600);
  near(curveEnd(curve).v, 100);
  // every input point must appear as a vertex somewhere along the sampled curve
  const chord = curveToPolyline(curve);
  for (const p of points) {
    assert.ok(chord.some((q) => Math.hypot(q.u - p.u, q.v - p.v) < 1e-6), `missing knot (${p.u},${p.v})`);
  }
});

test('splineThroughPoints: stays u-monotonic across widely varying segment lengths (a winder-like spacing)', () => {
  // Tread spacing along a real winder board can jump from ~15mm to ~270mm between neighbours —
  // exactly the case UNIFORM Catmull-Rom loops/cusps on; centripetal must stay well-behaved.
  const points = [
    { u: 0, v: 0 }, { u: 270, v: 30 }, { u: 540, v: 60 }, { u: 555, v: 90 }, { u: 585, v: 120 },
    { u: 630, v: 150 }, { u: 900, v: 180 }, { u: 1170, v: 210 },
  ];
  const curve = splineThroughPoints(points);
  assert.ok(curve !== null, 'this spacing is realistic, not pathological — must not be rejected');
  const chord = curveToPolyline(curve);
  for (let i = 1; i < chord.length; i++) assert.ok(chord[i].u >= chord[i - 1].u - 1e-6, `u went backward at index ${i}`);
});

test('splineThroughPoints: fewer than 3 points is just a straight line, not a degenerate spline', () => {
  const curve = splineThroughPoints([{ u: 0, v: 0 }, { u: 100, v: 50 }]);
  assert.equal(curve.length, 1);
  assert.equal(curve[0].type, 'line');
});

test('splineThroughPoints: returns null (never a folded/backward curve) for a genuinely too-sharp reversal', () => {
  // A near-180-degree hairpin between three points packed very close together in u: any smooth
  // interpolating curve through them would have to double back on itself.
  const points = [{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10.5, v: 200 }, { u: 11, v: 0 }, { u: 300, v: 5 }];
  const curve = splineThroughPoints(points);
  if (curve !== null) {
    const chord = curveToPolyline(curve);
    for (let i = 1; i < chord.length; i++) assert.ok(chord[i].u >= chord[i - 1].u - 1e-6);
  }
  // Either outcome (null, or a curve that stayed monotonic anyway) is acceptable — the invariant
  // this test actually protects is "never silently return a folded curve".
});
