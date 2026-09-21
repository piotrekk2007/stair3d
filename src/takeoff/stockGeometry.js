// STOCK GEOMETRY — pure helpers answering "what rectangular blank would this be cut from?"
// (the NET-vs-STOCK distinction, see takeoffTypes.js). Never used for finished/net geometry —
// that always comes straight from the construction models themselves (TreadModel.outline,
// StringerConstructionGeometry.outerContour). This file has zero geometry-solving logic of its
// own: it only measures already-solved shapes.

/**
 * Bounding rectangle of `points` ({x,y}[]) in a frame ROTATED to align with `forward` (a unit
 * vector) — e.g. a tread's own walking direction, so the rectangle's "length" axis matches the
 * direction grain would actually run, not an arbitrary global-X/Y box (which would overstate a
 * rotated winder tread's stock size for no physical reason).
 *
 * @param {{x:number,y:number}[]} points
 * @param {{x:number,y:number}} forward  Unit vector.
 * @returns {{lengthMm:number, widthMm:number}}
 */
export function boundingRectAlong(points, forward) {
  const across = { x: -forward.y, y: forward.x };
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = p.x * forward.x + p.y * forward.y;
    const v = p.x * across.x + p.y * across.y;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { lengthMm: maxU - minU, widthMm: maxV - minV };
}

/**
 * Bounding rectangle of points already expressed in a flat local (u,v) plane — used for a
 * StringerConstructionGeometry contour, which is already in the board's own local frame (no
 * rotation needed, unlike a tread's plan-space outline).
 *
 * @param {{u:number,v:number}[]} points
 * @returns {{lengthMm:number, heightMm:number}}
 */
export function boundingRectUV(points) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    if (p.u < minU) minU = p.u;
    if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v;
    if (p.v > maxV) maxV = p.v;
  }
  return { lengthMm: maxU - minU, heightMm: maxV - minV };
}

// Convex hull (Andrew's monotone chain) of {u,v} points; deterministic, collinear points dropped.
function convexHullUV(points) {
  const pts = points.map((p) => ({ u: p.u, v: p.v })).sort((a, b) => a.u - b.u || a.v - b.v);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
  const build = (list) => {
    const hull = [];
    for (const p of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  return [...build(pts), ...build(pts.slice().reverse())];
}

/**
 * The BLANK a stringer board is cut from: the smallest-area rectangle that covers the whole
 * solved contour, in any rotation. One side of an optimal rectangle always lies along a convex-hull
 * edge, so those directions are tried (first minimum wins — deterministic). Unlike the design
 * depth (`minimumStringerDepthMm`), this is the real raw-board size: it also covers the stepped
 * comb, the slanted ends and any deeper local profile (a winder, a corner radius).
 *
 * @param {{u:number,v:number}[]} points  A contour in the board's flat (u,v) plane.
 * @returns {{lengthMm:number, widthMm:number, angleDeg:number}}  length >= width; angle = the
 *   direction of the length axis relative to u.
 */
export function minAreaRectUV(points) {
  const hull = convexHullUV(points);
  if (hull.length < 3) {
    const r = boundingRectUV(points);
    return { lengthMm: Math.max(r.lengthMm, r.heightMm), widthMm: Math.min(r.lengthMm, r.heightMm), angleDeg: 0 };
  }
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.u - a.u, b.v - a.v);
    if (len === 0) continue;
    const du = (b.u - a.u) / len;
    const dv = (b.v - a.v) / len;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of hull) {
      const along = p.u * du + p.v * dv;
      const across = -p.u * dv + p.v * du;
      if (along < minA) minA = along;
      if (along > maxA) maxA = along;
      if (across < minB) minB = across;
      if (across > maxB) maxB = across;
    }
    const w1 = maxA - minA;
    const w2 = maxB - minB;
    const area = w1 * w2;
    if (!best || area < best.area - 1e-9) {
      const longAlong = w1 >= w2;
      best = { area, lengthMm: Math.max(w1, w2), widthMm: Math.min(w1, w2), angleDeg: (Math.atan2(longAlong ? dv : du, longAlong ? du : -dv) * 180) / Math.PI };
    }
  }
  // Rounded to 0.01 mm: a sawmill list has no use for float noise, and 329.99999999 must not price as a different board.
  const r2 = (x) => Math.round(x * 100) / 100;
  return { lengthMm: r2(best.lengthMm), widthMm: r2(best.widthMm), angleDeg: r2(best.angleDeg) };
}
