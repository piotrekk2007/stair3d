// PROFILE EDITOR SNAPPING — pure helpers turning a raw drag target into either an EXACT snap
// (another control point's own elevation, or the minimum-depth envelope) or a value rounded to a
// small mm grid. No DOM, no geometry decisions of its own — profileEditorPanel.js calls this
// before turning a drag into a PROFILE_EDITS.MOVE_VERTEX event; the solver still has the final
// say (e.g. STRINGER-MIN-DEPTH still fires if a snap somehow put a point below the minimum).

export const SNAP_GRID_MM = 5;
export const SNAP_TOLERANCE_MM = 6;

/** Nearest point on a piecewise-linear polyline to `target`, clamped to each segment (never past an end). */
function nearestOnPolyline(polyline, target) {
  let best = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len2 = du * du + dv * dv || 1;
    let t = ((target.u - a.u) * du + (target.v - a.v) * dv) / len2;
    t = Math.max(0, Math.min(1, t));
    const u = a.u + du * t;
    const v = a.v + dv * t;
    const dist = Math.hypot(target.u - u, target.v - v);
    if (!best || dist < best.dist) best = { u, v, dist };
  }
  return best;
}

/**
 * Snaps a raw drag target, in priority order: (1) another control point's own elevation — lets two
 * points line up into a flat run without eyeballing it, the same idea as the 2D plan editor's own
 * alignment snap; (2) the minimum-depth envelope (lower contour only) — lets a point be pulled
 * exactly onto the constraint boundary instead of a millimetre short or long of it. Neither changes
 * `u` on its own (a point snapping to a neighbour's depth keeps its own position along the board).
 *
 * @param {{u:number,v:number}} target
 * @param {{id:string,contour:string}} exclude       the point being dragged — never snaps to itself
 * @param {{id:string,contour:string,v:number}[]} points   every other control point on this board's view
 * @param {{u:number,v:number}[]|null} envelope      the minimum-depth envelope, only passed for the lower contour
 * @param {number} [toleranceMm]
 * @returns {{u:number,v:number,snap:{type:'point'|'envelope',label:string}|null}}
 */
export function snapDragTarget(target, exclude, points, envelope, toleranceMm = SNAP_TOLERANCE_MM) {
  let nearestPoint = null;
  for (const p of points || []) {
    if (p.id === exclude.id && p.contour === exclude.contour) continue;
    const dv = Math.abs(p.v - target.v);
    if (dv <= toleranceMm && (!nearestPoint || dv < nearestPoint.dv)) nearestPoint = { v: p.v, dv, id: p.id };
  }
  if (nearestPoint) return { u: target.u, v: nearestPoint.v, snap: { type: 'point', label: nearestPoint.id } };

  if (envelope && envelope.length >= 2) {
    const near = nearestOnPolyline(envelope, target);
    if (near && near.dist <= toleranceMm) return { u: near.u, v: near.v, snap: { type: 'envelope', label: 'min. głębokość' } };
  }

  return { u: target.u, v: target.v, snap: null };
}

/** Rounds an override offset (ds or dn, mm) to a clean grid step — used only when no exact snap applied. */
export function roundToGrid(value, gridMm = SNAP_GRID_MM) {
  return Math.round(value / gridMm) * gridMm;
}

/**
 * A "nice" grid step (1/2/5 x a power of ten, in mm) for ruler ticks: the largest such step whose
 * on-screen spacing does not exceed `targetPx`, so ticks stay dense enough to read at any zoom
 * without ever crowding into an unreadable smear.
 *
 * @param {number} pxToMm        mm of profile space per screen pixel (viewport.width / panelWidthPx)
 * @param {number} [targetPx]
 */
export function niceGridStepMm(pxToMm, targetPx = 90) {
  const targetMm = targetPx * pxToMm;
  if (!(targetMm > 0)) return SNAP_GRID_MM;
  const magnitude = 10 ** Math.floor(Math.log10(targetMm));
  const residual = targetMm / magnitude;
  const step = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
  return step * magnitude;
}

/** Tick positions (mm, in profile/world space) covering [from, to] at a `stepMm` grid. */
export function tickPositions(from, to, stepMm) {
  const ticks = [];
  const start = Math.ceil(from / stepMm) * stepMm;
  for (let v = start; v <= to + 1e-6; v += stepMm) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
