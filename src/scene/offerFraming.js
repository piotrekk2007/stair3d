// The framing of an offer picture (user request 2026-11-06 — the modern offer's portrait 3D box, 84 × 150 mm): the
// standard view's camera (sceneSetup.js computeStandardView — position = centre + direction × 2.4 × radius) moved
// so that the stair's bounding box, as SEEN from that direction, fills the picture: its projected corners within the
// frame less a margin, the box's projection centred. Camera maths only (never the stair's geometry). Pure (three).

import * as THREE from 'three';
import { computeStandardView } from './sceneSetup.js';

/**
 * @param {THREE.Box3} box  the stair's world box
 * @param {{view?: string, aspect: number, fovDeg?: number, margin?: number, fill?: 'contain'|'height'|number}} opts
 *   aspect = width / height of the picture; margin = the free share kept at the frame's edges (0.06 = 6 %); fill:
 *   'contain' (0) = the whole box inside, 'height' (1) = the box fills the picture's HEIGHT (its sides cut off — a tall
 *   narrow picture of a wide stair), a number between = that far between the two in the picture's SCALE (the modern
 *   offer's full-height strip takes 0.5 — user decision 2026-11-06)
 * @returns {{center: THREE.Vector3, radius: number}}  what renderViewImage takes for that framing
 */
export function fitViewToBox(box, opts = {}) {
  const t = opts.fill === 'height' ? 1 : typeof opts.fill === 'number' ? Math.min(1, Math.max(0, opts.fill)) : 0;
  if (t > 0 && t < 1) {
    // the scale (∝ 1 / distance) interpolated between the two fits; centred like them
    const a = fitViewToBox(box, { ...opts, fill: 'contain' });
    const b = fitViewToBox(box, { ...opts, fill: 'height' });
    const radius = 1 / ((1 - t) / a.radius + t / b.radius);
    return { center: a.center.clone().lerp(b.center, t), radius };
  }
  return fitBox(box, { ...opts, fill: t === 1 ? 'height' : 'contain' });
}

function fitBox(box, { view = 'iso', aspect, fovDeg = 50, margin = 0.06, fill = 'contain' } = {}) {
  let center = box.getCenter(new THREE.Vector3());
  const { position } = computeStandardView(view, center, 1);
  const dir = position.clone().sub(center).normalize(); // from the target to the camera
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const tanH = tanV * aspect;
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  // the corners' screen extents (normalised, −1 … 1) for the camera at distance D from `c`
  const extents = (c, D) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of corners) {
      const rel = p.clone().sub(c);
      const depth = D - rel.dot(dir);
      if (depth <= 1) return null;
      const sx = rel.dot(right) / (depth * tanH);
      const sy = rel.dot(up) / (depth * tanV);
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1 };
  };
  const size = box.getSize(new THREE.Vector3()).length() || 1000;
  let D = size;
  for (let round = 0; round < 3; round++) {
    // the distance: the smallest one at which every corner is inside the frame less the margin (bisection)
    let lo = size * 0.05;
    let hi = size * 50;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      const e = extents(center, mid);
      const fits = e && (fill === 'height' ? Math.max(-e.y0, e.y1) : Math.max(-e.x0, e.x1, -e.y0, e.y1)) <= 1 - margin;
      if (fits) hi = mid;
      else lo = mid;
    }
    D = hi;
    // centre the projection: move the target by the extents' middle (in world units at the target's depth)
    const e = extents(center, D);
    if (!e) break;
    const mx = (e.x0 + e.x1) / 2;
    const my = (e.y0 + e.y1) / 2;
    if (Math.abs(mx) < 1e-3 && Math.abs(my) < 1e-3) break;
    center = center.clone().addScaledVector(right, mx * D * tanH).addScaledVector(up, my * D * tanV);
  }
  return { center, radius: D / 2.4 };
}
