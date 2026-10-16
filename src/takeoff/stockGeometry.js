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

// --- Stringer blanks for fairer pricing (user decision 2026-10-16) ----------------------------------------------
// A wanga's minimal straight rectangle (minAreaRectUV) is what a board must be to cut the whole wanga from ONE piece;
// a profile that bends (a flight, then steeper winders) or widens at an end makes that rectangle much deeper than the
// board mostly is. Two other readings of the same contour, chosen in the takeoff settings (boardPricing.js):
//  * strips — the blank's length cut into STRIP_MM pieces, each as deep as the contour is within it;
//  * split  — the contour covered by TWO straight blanks, split where that saves the most material.

const STRIP_MM = 400;
const SPLIT_STEP_MM = 50;
const SPLIT_MIN_PART_MM = 300;
const SPLIT_MIN_SAVING = 0.02; // a split saving less than 2 % of the one blank's area is not worth a second piece

// The contour in the frame of its minimal rectangle: x along the blank's length, y across it.
function inBlankFrame(points) {
  const rect = minAreaRectUV(points);
  const a = (rect.angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { rect, pts: points.map((p) => ({ x: p.u * c + p.v * s, y: -p.u * s + p.v * c })) };
}

// The part of a polygon (x, y) with x within [x0, x1] (two straight cuts, Sutherland–Hodgman).
function sliceX(pts, x0, x1) {
  const cut = (poly, keep) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const kp = keep(p);
      const kq = keep(q);
      if (kp >= 0) out.push(p);
      if ((kp > 0 && kq < 0) || (kp < 0 && kq > 0)) {
        const t = kp / (kp - kq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    return out;
  };
  return cut(cut(pts, (p) => p.x - x0), (p) => x1 - p.x);
}

// How deep one strip is: the narrowest it gets across, measured at the board's own local slant there (within
// ±STRIP_MAX_TILT_DEG of the blank's axis) — a strip of a bending board lies slightly askew in the long blank's frame.
const STRIP_MAX_TILT_DEG = 30;
function stripDepth(part) {
  let best = Infinity;
  for (let deg = -STRIP_MAX_TILT_DEG; deg <= STRIP_MAX_TILT_DEG; deg += 0.5) {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of part) {
      const y = -p.x * s + p.y * c;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    best = Math.min(best, hi - lo);
  }
  return best;
}

/** The blank cut into STRIP_MM pieces along its length: [{lengthMm, depthMm}] (each as deep as the contour there). */
export function stringerStrips(points, stripMm = STRIP_MM) {
  if (!points || points.length < 3) return [];
  const { pts } = inBlankFrame(points);
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const strips = [];
  for (let a = x0; a < x1 - 1e-6; a += stripMm) {
    const b = Math.min(x1, a + stripMm);
    const part = sliceX(pts, a, b);
    if (part.length < 3) continue;
    strips.push({ lengthMm: Math.round((b - a) * 100) / 100, depthMm: Math.round(stripDepth(part) * 100) / 100 });
  }
  return strips;
}

/**
 * The contour covered by two straight blanks, split across the blank's length where the two (each its own minimal
 * rectangle) take the least material; one blank when no split saves at least SPLIT_MIN_SAVING. [{lengthMm, depthMm}].
 */
export function stringerSplitBlanks(points) {
  if (!points || points.length < 3) return [];
  const { rect, pts } = inBlankFrame(points);
  const whole = [{ lengthMm: rect.lengthMm, depthMm: rect.widthMm }];
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  // each part measured like a strip: its length ALONG the board, its depth across it (at its own slant) — never the
  // longer side of its own rectangle (a short, wide end piece would swap them)
  const r2 = (x) => Math.round(x * 100) / 100;
  let best = null;
  for (let s = x0 + SPLIT_MIN_PART_MM; s <= x1 - SPLIT_MIN_PART_MM + 1e-6; s += SPLIT_STEP_MM) {
    const a = sliceX(pts, x0, s);
    const b = sliceX(pts, s, x1);
    if (a.length < 3 || b.length < 3) continue;
    const parts = [
      { lengthMm: r2(s - x0), depthMm: r2(stripDepth(a)) },
      { lengthMm: r2(x1 - s), depthMm: r2(stripDepth(b)) },
    ];
    const area = parts[0].lengthMm * parts[0].depthMm + parts[1].lengthMm * parts[1].depthMm;
    if (!best || area < best.area) best = { area, parts };
  }
  if (!best || best.area > rect.lengthMm * rect.widthMm * (1 - SPLIT_MIN_SAVING)) return whole;
  return best.parts;
}
