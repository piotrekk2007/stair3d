import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { snapMeasurePoint, planMeasureText, planMeasureRefs } from '../planMeasure.js';
import { measuresXML } from '../plan2dRenderer.js';
import { snapHitPoint, measureValues, measureText } from '../../viewer/measure3d.js';
import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';

test('the plan tape measure (user request 2026-10-28): a click snaps onto the nearest plan point within the tolerance, else to whole mm', () => {
  const refs = [{ x: 0, y: 0 }, { x: 900, y: 270 }];
  assert.deepEqual(snapMeasurePoint({ x: 6, y: -4 }, refs, 10), { x: 0, y: 0, snapped: true });
  assert.deepEqual(snapMeasurePoint({ x: 450.4, y: 99.6 }, refs, 10), { x: 450, y: 100, snapped: false });
  assert.equal(planMeasureText({ x: 0, y: 0 }, { x: 900, y: 270 }), '940 mm (Δx 900 · Δy 270)');
});

test("the plan measure's points come from the solved models (tread corners, stringer lines, posts, opening, walls); its drawing has the label and the rubber band", () => {
  const b = buildStaircase({ ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 3 });
  const refs = planMeasureRefs({ planLayout: b.planLayout, treadModels: b.treadModels, posts: b.allPostModels, openingOutline: b.ceilingFit.openingOutline, walls: [] });
  const corner = b.treadModels[0].outline[0];
  assert.ok(refs.some((p) => p === corner));
  const xml = measuresXML([{ a: { x: 0, y: 0 }, b: { x: 900, y: 270 } }], { a: { x: 0, y: 0 }, cursor: { x: 0, y: 500 } });
  assert.ok(xml.includes('940 mm (Δx 900 · Δy 270)'));
  assert.ok(xml.includes('500 mm (Δx 0 · Δy 500)'), 'the measure being drawn');
  assert.equal(measuresXML([], null), '');
});

test('the 3D tape measure: a hit snaps onto a corner of the face, then onto its edge, near on screen; the values are distance, height and horizontal', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2));
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(495, 100, 495), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(mesh)[0];
  // a screen = plan x / z directly (1 px = 1 mm): the corner (500, 0, 500) is 7 px away
  const toScreen = (p) => ({ x: p.x, y: p.z });
  const snapped = snapHitPoint(hit, { x: 495, y: 495 }, toScreen, 14);
  assert.deepEqual([snapped.x, snapped.y, snapped.z].map((v) => Math.round(v) + 0), [500, 0, 500]);
  const free = snapHitPoint(ray.intersectObject(mesh)[0], { x: 495, y: 495 }, toScreen, 2);
  assert.deepEqual([free.x, free.z].map(Math.round), [495, 495]);
  const v = measureValues(new THREE.Vector3(0, 0, 0), new THREE.Vector3(300, 400, 0), 1);
  assert.deepEqual([v.distanceMm, v.heightMm, v.horizontalMm].map(Math.round), [500, 400, 300]);
  assert.equal(measureText(measureValues(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 0.4, 0), 1000)), '500 mm  ·  wys. 400  ·  poziomo 300');
});
