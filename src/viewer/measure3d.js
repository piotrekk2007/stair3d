// The 3D TAPE MEASURE's one rule (user request 2026-10-28) — shared by the designer's 3D view (scene/measureTool.js)
// and the client's viewer (viewer/clientViewer.js, which may import only three.js and this folder): where a click on the
// model lands (snapped onto a corner of the face hit, else onto its nearest edge, when close on screen), and what a
// measure between two points says.

import * as THREE from 'three';

export const MEASURE_SNAP_PX = 14;

/**
 * The measured point of a raycast hit: a corner of the face hit within `snapPx` (on screen), else its nearest edge
 * within 0.6 × that, else the hit point itself.
 * @param {THREE.Intersection} hit
 * @param {{x:number,y:number}} click     the click in screen px
 * @param {(p: THREE.Vector3) => {x:number,y:number}} toScreen
 */
export function snapHitPoint(hit, click, toScreen, snapPx = MEASURE_SNAP_PX) {
  const p = hit.point.clone();
  if (!hit.face || !hit.object?.geometry) return p;
  const pos = hit.object.geometry.getAttribute('position');
  const corners = [hit.face.a, hit.face.b, hit.face.c].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld));
  const px = (q) => {
    const s = toScreen(q);
    return Math.hypot(s.x - click.x, s.y - click.y);
  };
  let best = null;
  for (const c of corners) if (px(c) <= snapPx && (!best || px(c) < best.d)) best = { p: c, d: px(c) };
  if (best) return best.p;
  for (let k = 0; k < 3; k++) {
    const q = new THREE.Line3(corners[k], corners[(k + 1) % 3]).closestPointToPoint(p, true, new THREE.Vector3());
    if (px(q) <= snapPx * 0.6 && (!best || px(q) < best.d)) best = { p: q, d: px(q) };
  }
  return best ? best.p : p;
}

/**
 * A measure between two points (Y up): the distance, the height difference and the horizontal distance, in mm —
 * `toMm` the scene unit's size in mm (1 in the designer, 1000 in the client's file, which is in metres).
 */
export function measureValues(a, b, toMm = 1) {
  return {
    distanceMm: a.distanceTo(b) * toMm,
    heightMm: Math.abs(b.y - a.y) * toMm,
    horizontalMm: Math.hypot(b.x - a.x, b.z - a.z) * toMm,
  };
}

export function measureText(v) {
  return `${Math.round(v.distanceMm)} mm  ·  wys. ${Math.round(v.heightMm)}  ·  poziomo ${Math.round(v.horizontalMm)}`;
}
