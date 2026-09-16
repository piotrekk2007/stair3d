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
