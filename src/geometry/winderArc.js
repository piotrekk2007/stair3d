// WINDER LAYOUT FROM THE WALKLINE (stage C, "linia biegu jako łuk"). Pure; imports nothing, so config/schema.js can
// use it for the feasibility check without a cycle.
//
// One turn, in the same local frame as planLayout.js buildTurnLocal: +y = the entrance direction, +x = the exit
// direction after a right turn, x = 0 the outer line (wall), x = W the inner line (dusza); the inner corner is
// Ic = (W, Yc), the outer corner Oc = (0, Yc + W).
//
// The walkline runs `off` (config.walklineOffset) from the inner line: a straight at x = W − off, a QUARTER ARC of
// radius `off` round the inner corner Ic, a straight at y = Yc + off. The winder zone is windersCount equal goings
// along it; `before` (config.walklineSplitOffset) is how much of the zone lies before the arc's middle (the 45°
// point), clamped so the zone always contains the whole arc. Every winder edge passes through its own walkline point
// (equal goings on the walkline, by construction) and through its own point on the inner line: the inner ends are
// spread evenly along the whole inner line of the zone (through the corner), so every winder has the SAME width at the
// dusza, g·(Lw − π·off/2)/Lw — never a zero-width (triangle) tread; with a symmetric zone the middle edge runs exactly
// through Ic and Oc. The inner ends and the walkline points both advance monotonically, so two edges can never cross
// between the inner line and the walkline. (Collapsing the dusza ends of one side onto Ic — a pure fan at the corner,
// tried first — gave zero-width treads when little of the zone lay before the corner.)
// User decision 2026-10-02: every project uses this layout; the old proportional layout stays only as the fallback
// when the arc does not fit (planLayout.js buildTurnLocalProportional).

const ARC_SAMPLE_DEG = 3; // the drawn walkline arc: one chord per 3°
const MIN_DUSZA_ZONE_MM = 1; // the inner line of the zone must be longer than this, or the arc does not fit

/**
 * @param {{stairWidth:number, treadGoing:number, walklineOffset:number, walklineSplitOffset:number}} params
 * @param {number} treadsIn  straight treads before the turn (the zone starts at station treadsIn × going)
 * @param {number} windersCount
 * @param {{startsFlight?: boolean, endsFlight?: boolean}} [pins]  A flight that STARTS with these winders (no straight
 *   tread before them) starts at the inner corner; one that ENDS with them ends there — the start/end post and the
 *   corner post are then one post (postSolver.js), exactly as with the old layout. Otherwise the split decides.
 * @returns {null | {s0, s1, sm, Yc, arcEnd, xTurnEnd, before, after, Ic, Oc,
 *   boundaries: Array<{station, walk:{x,y}, inner:{x,y}, outer:{x,y}}>, walkAt:(s)=>{x,y}, tangentAt:(s)=>{x,y},
 *   arcPoints: {x,y}[], duszaWidth: number}}  null when the arc does not fit in the zone
 */
export function arcWinderGeometry(params, treadsIn, windersCount, pins = {}) {
  const W = params.stairWidth;
  const g = params.treadGoing;
  const off = params.walklineOffset;
  const Lw = windersCount * g;
  const q = (Math.PI * off) / 4; // half the arc's length
  if (!(windersCount >= 1) || !(g > 0) || !(off > 0) || !(off < W) || Lw - 2 * q < MIN_DUSZA_ZONE_MM) return null;

  const s0 = treadsIn * g;
  const before = pins.startsFlight ? q : pins.endsFlight ? Lw - q : Math.min(Lw - q, Math.max(q, params.walklineSplitOffset));
  const after = Lw - before;
  const Yc = s0 + before - q; // the arc starts level with the inner corner
  const sm = s0 + before;
  const arcEnd = Yc + 2 * q;
  const s1 = s0 + Lw;
  const xTurnEnd = W + (s1 - arcEnd);
  const Ic = { x: W, y: Yc };
  const Oc = { x: 0, y: Yc + W };

  const walkAt = (s) => {
    if (s <= Yc) return { x: W - off, y: s };
    if (s >= arcEnd) return { x: W + (s - arcEnd), y: Yc + off };
    const phi = (s - Yc) / off;
    return { x: W - off * Math.cos(phi), y: Yc + off * Math.sin(phi) };
  };
  const tangentAt = (s) => {
    if (s <= Yc) return { x: 0, y: 1 };
    if (s >= arcEnd) return { x: 1, y: 0 };
    const phi = (s - Yc) / off;
    return { x: Math.sin(phi), y: Math.cos(phi) };
  };
  // the inner ends: evenly along the inner line of the zone, (W, s0) -> Ic -> (xTurnEnd, Yc)
  const innerBefore = Yc - s0;
  const innerAfter = xTurnEnd - W;
  const innerTotal = innerBefore + innerAfter; // = Lw − π·off/2
  const innerAt = (s) => {
    const u = (innerTotal * (s - s0)) / Lw;
    return u <= innerBefore ? { x: W, y: s0 + u } : { x: W + (u - innerBefore), y: Yc };
  };

  // the outer line, extended far past its ends so an edge always meets it
  const outerLine = [{ x: 0, y: s0 - 1e6 }, Oc, { x: xTurnEnd + 1e6, y: Yc + W }];
  const boundaries = [];
  for (let k = 0; k <= windersCount; k++) {
    const station = s0 + k * g;
    const walk = walkAt(station);
    const inner = innerAt(station);
    const outer = beyond(inner, walk, outerLine);
    boundaries.push({ station, walk, inner, outer });
  }

  const arcPoints = [];
  const steps = Math.max(2, Math.ceil(90 / ARC_SAMPLE_DEG));
  for (let i = 0; i <= steps; i++) arcPoints.push(walkAt(Yc + (2 * q * i) / steps));

  return {
    s0, s1, sm, Yc, arcEnd, xTurnEnd, before, after, Ic, Oc, boundaries, walkAt, tangentAt, arcPoints,
    duszaWidth: (g * innerTotal) / Lw,
  };
}

/**
 * The walkline offset a turn is laid out with: the configured one when its arc fits the zone; otherwise the largest
 * one at which it fits with a usable dusza — `minInnerWidth` per winder, or half the zone if even that does not fit
 * (e.g. 2 winders × 270 mm cannot turn 90° on a walkline 400 mm from the dusza: the quarter arc alone is 628 mm).
 * Never more than the configured offset, always inside the stair. null for an impossible zone (no winders, no going).
 */
export function fittingWalklineOffset(params, windersCount) {
  const Lw = windersCount * params.treadGoing;
  if (!(windersCount >= 1) || !(params.treadGoing > 0) || !(params.stairWidth > 0)) return null;
  const configured = Math.min(params.walklineOffset, params.stairWidth - 1);
  if (configured > 0 && Lw - (Math.PI * configured) / 2 >= MIN_DUSZA_ZONE_MM) return configured;
  const dusza = Math.min(windersCount * (params.minInnerWidth > 0 ? params.minInnerWidth : 0), Lw / 2);
  const fitted = Math.min(configured, (2 * (Lw - Math.max(dusza, MIN_DUSZA_ZONE_MM))) / Math.PI);
  return fitted > 0 ? fitted : null;
}

// The quarter arc of a landing's walkline (same radius and centre convention), for drawing.
export function landingArcPoints(stairWidth, walklineOffset, Yc) {
  const pts = [];
  const steps = Math.max(2, Math.ceil(90 / ARC_SAMPLE_DEG));
  for (let i = 0; i <= steps; i++) {
    const phi = (Math.PI / 2) * (i / steps);
    pts.push({ x: stairWidth - walklineOffset * Math.cos(phi), y: Yc + walklineOffset * Math.sin(phi) });
  }
  return pts;
}

// Where the line from `a` through `b` meets the polyline beyond `b` (the nearest such crossing).
function beyond(a, b, path) {
  const d = { x: b.x - a.x, y: b.y - a.y };
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const e = { x: path[i].x - p.x, y: path[i].y - p.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const ap = { x: p.x - a.x, y: p.y - a.y };
    const t = (ap.x * e.y - ap.y * e.x) / den; // along a -> b
    const s = (ap.x * d.y - ap.y * d.x) / den; // along the segment
    if (s < -1e-9 || s > 1 + 1e-9 || t < 1 - 1e-9) continue;
    // the point from the SEGMENT's own parameter, so it lies exactly on that line (x = 0 on the wall, not 1e-13)
    if (!best || t < best.t) best = { t, point: { x: p.x + e.x * s, y: p.y + e.y * s } };
  }
  return best ? best.point : { ...b };
}
