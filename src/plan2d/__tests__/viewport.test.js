import test from 'node:test';
import assert from 'node:assert/strict';

import { createViewport, fitToBounds, zoomAt, panBy, screenToViewportPoint, pixelsPerMm, nearestStandardScale } from '../viewport.js';

test('fitToBounds: letterboxes content into the panel aspect ratio and centres it', () => {
  const bounds = { minX: 0, maxX: 1000, minY: 0, maxY: 500 };
  const vp = fitToBounds(bounds, 800, 400, 0); // panel aspect 2:1, content aspect 2:1 -> exact fit
  assert.ok(Math.abs(vp.width - 1000) < 1e-6);
  assert.ok(Math.abs(vp.height - 500) < 1e-6);
  assert.ok(Math.abs(vp.x - 0) < 1e-6);
  assert.ok(Math.abs(vp.y - 0) < 1e-6);
});

test('fitToBounds: adds margin on every side', () => {
  const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  const vp = fitToBounds(bounds, 400, 400, 10);
  assert.ok(Math.abs(vp.width - 120) < 1e-6, `expected width 120 (100 + 2*10), got ${vp.width}`);
});

test('zoomAt: the plan point under the cursor stays fixed after zooming in', () => {
  const vp0 = createViewport(0, 0, 1000, 1000);
  const panelW = 800, panelH = 800;
  const screenX = 200, screenY = 600;

  const before = screenToViewportPoint(vp0, screenX, screenY, panelW, panelH);
  const vp1 = zoomAt(vp0, screenX, screenY, panelW, panelH, 2); // zoom in 2x
  const after = screenToViewportPoint(vp1, screenX, screenY, panelW, panelH);

  assert.ok(Math.abs(before.x - after.x) < 1e-9, `x drifted: ${before.x} vs ${after.x}`);
  assert.ok(Math.abs(before.y - after.y) < 1e-9, `y drifted: ${before.y} vs ${after.y}`);
  assert.ok(Math.abs(vp1.width - 500) < 1e-9, 'zoom factor 2 should halve the viewport width');
});

test('zoomAt: zooming out (factor < 1) enlarges the viewport and still anchors correctly', () => {
  const vp0 = createViewport(100, 100, 400, 300);
  const vp1 = zoomAt(vp0, 0, 0, 400, 300, 0.5);
  assert.ok(vp1.width > vp0.width);
  const before = screenToViewportPoint(vp0, 0, 0, 400, 300);
  const after = screenToViewportPoint(vp1, 0, 0, 400, 300);
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test('zoomAt: repeated zoom-in is clamped and never collapses to zero/NaN', () => {
  let vp = createViewport(0, 0, 100, 100);
  for (let i = 0; i < 100; i++) {
    vp = zoomAt(vp, 50, 50, 100, 100, 10);
  }
  assert.ok(Number.isFinite(vp.width) && vp.width > 0, `viewport width degenerated: ${vp.width}`);
  assert.ok(Number.isFinite(vp.height) && vp.height > 0, `viewport height degenerated: ${vp.height}`);
});

test('panBy: dragging the pointer right moves the viewport origin left (content follows the drag)', () => {
  const vp0 = createViewport(0, 0, 1000, 1000);
  const vp1 = panBy(vp0, 100, 0, 500, 500); // dragged 100px right in a 500px-wide panel -> 200 plan units
  assert.ok(Math.abs(vp1.x - -200) < 1e-9, `expected x=-200, got ${vp1.x}`);
  assert.equal(vp1.y, vp0.y);
  assert.equal(vp1.width, vp0.width);
  assert.equal(vp1.height, vp0.height);
});

test('panBy then reverse pan returns to the original viewport', () => {
  const vp0 = createViewport(50, 50, 800, 600);
  const vp1 = panBy(vp0, 37, -19, 800, 600);
  const vp2 = panBy(vp1, -37, 19, 800, 600);
  assert.ok(Math.abs(vp2.x - vp0.x) < 1e-9);
  assert.ok(Math.abs(vp2.y - vp0.y) < 1e-9);
});

test('pixelsPerMm: smaller viewport width at the same panel size means more pixels per mm (zoomed in)', () => {
  const panelW = 1000;
  const zoomedIn = pixelsPerMm(createViewport(0, 0, 500, 500), panelW);
  const zoomedOut = pixelsPerMm(createViewport(0, 0, 2000, 2000), panelW);
  assert.ok(zoomedIn > zoomedOut);
});

test('nearestStandardScale: snaps to a conventional technical-drawing scale', () => {
  assert.equal(nearestStandardScale(19), 20);
  assert.equal(nearestStandardScale(48), 50);
  assert.equal(nearestStandardScale(1), 1);
  assert.equal(nearestStandardScale(900), 1000);
});
