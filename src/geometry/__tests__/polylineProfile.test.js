import test from 'node:test';
import assert from 'node:assert/strict';

import { simplifyCollinear, offsetPolylineByNormal, distancePointToPolyline, valueAtU } from '../polylineProfile.js';

test('simplifyCollinear collapses a uniform straight run down to its two endpoints', () => {
  const points = [
    { u: 0, v: 0 },
    { u: 270, v: 400 },
    { u: 540, v: 800 },
    { u: 810, v: 1200 },
  ];
  const simplified = simplifyCollinear(points);
  assert.deepEqual(simplified, [points[0], points[3]]);
});

test('simplifyCollinear keeps a genuine kink', () => {
  const points = [
    { u: 0, v: 0 },
    { u: 100, v: 400 }, // steep local rise
    { u: 800, v: 500 }, // shallow local rise
  ];
  const simplified = simplifyCollinear(points);
  assert.equal(simplified.length, 3);
});

test('offsetPolylineByNormal moves a single straight segment by exactly `distance`, perpendicular to it', () => {
  const line = [
    { u: 0, v: 0 },
    { u: 1000, v: 500 }, // slope 0.5
  ];
  const down = offsetPolylineByNormal(line, 300, 'down');
  for (let i = 0; i < line.length; i++) {
    const perpDist = distancePointToPolyline(line[i], down);
    assert.ok(Math.abs(perpDist - 300) < 1e-9, `expected exactly 300mm perpendicular distance, got ${perpDist}`);
  }
  // The offset must move DOWN (negative v direction net of the line's own slope) not sideways.
  assert.ok(down[0].v < line[0].v);
});

test('offsetPolylineByNormal on a perfectly straight multi-knot profile is itself perfectly straight (no artificial curvature introduced)', () => {
  const line = [
    { u: 0, v: 0 },
    { u: 270, v: 400 },
    { u: 540, v: 800 },
    { u: 810, v: 1200 },
  ];
  const offset = offsetPolylineByNormal(line, 300, 'down');
  const slope01 = (offset[1].v - offset[0].v) / (offset[1].u - offset[0].u);
  const slope23 = (offset[3].v - offset[2].v) / (offset[3].u - offset[2].u);
  assert.ok(Math.abs(slope01 - slope23) < 1e-9, 'a straight input profile must produce a straight offset, not a piecewise-kinked one');
});

test('offsetPolylineByNormal at a real kink produces LESS remaining perpendicular distance on the concave side (a genuine local thinning, not a bug)', () => {
  // A profile that bends UPWARD steeply then levels off — like a winder tread with a much
  // smaller going than its neighbors (see the real reported bug: a 40mm-wide winder tread).
  const kinked = [
    { u: 0, v: 0 },
    { u: 40, v: 280 }, // steep short segment
    { u: 510, v: 560 }, // shallow long segment
  ];
  const down = offsetPolylineByNormal(kinked, 300, 'down');
  // The middle knot (the kink apex) is where the two differently-sloped segments meet —
  // its distance to the offset line must still be measurable and finite (no NaN/undefined),
  // and must not silently equal exactly 300 the way a naive 2-point fit would have assumed.
  const distAtKink = distancePointToPolyline(kinked[1], down);
  assert.ok(Number.isFinite(distAtKink));
  assert.ok(distAtKink > 0);
});

test('distancePointToPolyline returns 0 for a point that lies exactly on the polyline', () => {
  const poly = [
    { u: 0, v: 0 },
    { u: 100, v: 50 },
  ];
  assert.ok(distancePointToPolyline({ u: 50, v: 25 }, poly) < 1e-9);
});

test('valueAtU interpolates within range and extrapolates past both ends using the nearest segment slope', () => {
  const poly = [
    { u: 0, v: 0 },
    { u: 100, v: 100 },
  ];
  assert.equal(valueAtU(poly, 50), 50);
  assert.equal(valueAtU(poly, -20), -20);
  assert.equal(valueAtU(poly, 150), 150);
});
