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

// --- ONE 180° WINDER ZONE (U stair, no straight treads between the turns) ----------------------------------------
// User decision 2026-10-14: in a U stair whose middle flight has no straight tread, the two turns can be one winder
// zone ("jedna klatka zabiegowa") with any number of winders, round ONE central post, flights A and C set by the
// distance between their inner wangi's AXES (0 = the wanga of C exactly above the wanga of A, both entering the same
// post). Frame as above (right turn): A goes +y with its outer line at x = 0 and inner line at x = W; C comes back
// (−y) with its inner line at x = W + gap, gap = axisGap − stringerThickness (negative when the axes are closer than
// a board's thickness: C's treads then reach over A's by that much — they are half a storey higher).
//
// The walkline: a straight `off` from A's inner line, a HALF CIRCLE round the dusza's middle (radius off + gap/2), a
// straight `off` from C's inner line. The zone is windersCount equal goings on it, centred on the half circle (a
// flight starting / ending with the winders pins the zone to the arc's start / end); every edge passes through its
// walkline point and its point on the inner line, the inner ends spread evenly along it (A's line, the dusza,
// C's line) — the same rule as one quarter turn. The zone is always centred on the half circle, also when A or C has
// no straight tread (unlike a quarter turn it is not pinned to the corner: C's inner line runs back past A's, so a
// pinned zone's edges would cross the stair's first / last edge); such a flight simply starts / ends with winders.

/** True when a config asks for the one-zone 180° turn and it applies (U, both turns winders, no middle flight). */
export function isHalfTurnU(config) {
  return !!config?.uSingleWinderZone && config.stairType === 'U' && config.turn1Type === 'winder' && config.turn2Type === 'winder' && Number(config.treadsLegB) === 0;
}

/** The winder count of the one zone (config.uWindersTotal, at least 2). */
export function halfTurnWinderCount(config) {
  const n = Math.round(Number(config?.uWindersTotal));
  return Number.isFinite(n) && n >= 2 ? n : 2;
}

/** Gap between A's and C's inner LINES (mm) from the axis distance and the board thickness. */
export function halfTurnInnerGap(axisGapMm, stringerThicknessMm) {
  const d = Number.isFinite(Number(axisGapMm)) && Number(axisGapMm) >= 0 ? Number(axisGapMm) : 0;
  const t = Number.isFinite(Number(stringerThicknessMm)) && Number(stringerThicknessMm) > 0 ? Number(stringerThicknessMm) : 0;
  return d - t;
}

/**
 * @param {{stairWidth:number, treadGoing:number, walklineOffset:number, innerGap:number}} params
 * @param {number} treadsIn  straight treads of flight A
 * @param {number} windersCount  all the winders of the zone
 * @returns {null | {s0, s1, Yc, arcEnd, R, centre, c1, c2, xInnerC, xOuterC, yZoneEndC, boundaries, walkAt, tangentAt,
 *   arcPoints, duszaWidth}}  null when the half circle does not fit in the zone
 */
export function halfTurnWinderGeometry(params, treadsIn, windersCount) {
  const W = params.stairWidth;
  const g = params.treadGoing;
  const off = params.walklineOffset;
  const gap = params.innerGap;
  const R = off + gap / 2;
  const Lw = windersCount * g;
  const q = (Math.PI * R) / 2; // half the half circle's length
  if (!(windersCount >= 1) || !(g > 0) || !(off > 0) || !(off < W) || !(R > 0) || !(W + gap > 0) || Lw - 2 * q < MIN_DUSZA_ZONE_MM) return null;

  const s0 = treadsIn * g;
  const before = Lw / 2;
  const Yc = s0 + before - q;
  const arcEnd = Yc + 2 * q;
  const s1 = s0 + Lw;
  const xInnerC = W + gap;
  const xOuterC = xInnerC + W;
  const centre = { x: W + gap / 2, y: Yc };
  const yZoneEndC = Yc - (s1 - arcEnd);
  const c1 = { x: W, y: Yc };
  const c2 = { x: xInnerC, y: Yc };

  const walkAt = (s) => {
    if (s <= Yc) return { x: W - off, y: s };
    if (s >= arcEnd) return { x: xInnerC + off, y: Yc - (s - arcEnd) };
    const phi = (s - Yc) / R;
    return { x: centre.x - R * Math.cos(phi), y: Yc + R * Math.sin(phi) };
  };
  const tangentAt = (s) => {
    if (s <= Yc) return { x: 0, y: 1 };
    if (s >= arcEnd) return { x: 0, y: -1 };
    const phi = (s - Yc) / R;
    return { x: Math.sin(phi), y: Math.cos(phi) };
  };
  // the inner ends: evenly along (W, s0) -> c1 -> c2 -> (xInnerC, yZoneEndC)
  const innerPath = [{ x: W, y: s0 }, c1, c2, { x: xInnerC, y: yZoneEndC }].filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9);
  const cum = [0];
  for (let i = 1; i < innerPath.length; i++) cum.push(cum[i - 1] + Math.hypot(innerPath[i].x - innerPath[i - 1].x, innerPath[i].y - innerPath[i - 1].y));
  const innerTotal = cum[cum.length - 1];
  const innerAt = (s) => {
    const u = (innerTotal * (s - s0)) / Lw;
    for (let i = 1; i < innerPath.length; i++) {
      if (u <= cum[i] + 1e-9 || i === innerPath.length - 1) {
        const span = cum[i] - cum[i - 1];
        const t = span > 0 ? Math.min(1, Math.max(0, (u - cum[i - 1]) / span)) : 0;
        return { x: innerPath[i - 1].x + (innerPath[i].x - innerPath[i - 1].x) * t, y: innerPath[i - 1].y + (innerPath[i].y - innerPath[i - 1].y) * t };
      }
    }
    return innerPath[innerPath.length - 1];
  };

  const outerLine = [{ x: 0, y: s0 - 1e6 }, { x: 0, y: Yc + W }, { x: xOuterC, y: Yc + W }, { x: xOuterC, y: yZoneEndC - 1e6 }];
  const boundaries = [];
  for (let k = 0; k <= windersCount; k++) {
    const station = s0 + k * g;
    const walk = walkAt(station);
    const inner = innerAt(station);
    // innerAlong: where the inner end lies along innerPath — given, because where A's and C's inner lines coincide
    // (axis gap = board thickness) a point alone cannot tell which of the two it is on
    boundaries.push({ station, walk, inner, innerAlong: (innerTotal * (station - s0)) / Lw, outer: beyond(inner, walk, outerLine) });
  }

  const arcPoints = [];
  const steps = Math.max(2, Math.ceil(180 / ARC_SAMPLE_DEG));
  for (let i = 0; i <= steps; i++) arcPoints.push(walkAt(Yc + (2 * q * i) / steps));

  return { s0, s1, Yc, arcEnd, R, centre, c1, c2, xInnerC, xOuterC, yZoneEndC, innerPath, boundaries, walkAt, tangentAt, arcPoints, duszaWidth: (g * innerTotal) / Lw };
}

/**
 * The walkline offset the 180° zone is laid out with: the configured one when its half circle fits; otherwise the
 * largest one that fits with a usable dusza (minInnerWidth per winder, or half the zone). null when nothing fits.
 */
export function fittingHalfTurnOffset(params, windersCount) {
  const Lw = windersCount * params.treadGoing;
  if (!(windersCount >= 1) || !(params.treadGoing > 0) || !(params.stairWidth > 0)) return null;
  const gap = params.innerGap;
  const configured = Math.min(params.walklineOffset, params.stairWidth - 1);
  const arcOf = (off) => Math.PI * (off + gap / 2);
  if (configured > 0 && configured + gap / 2 > 0 && Lw - arcOf(configured) >= MIN_DUSZA_ZONE_MM) return configured;
  const dusza = Math.min(windersCount * (params.minInnerWidth > 0 ? params.minInnerWidth : 0), Lw / 2);
  const fitted = Math.min(configured, (Lw - Math.max(dusza, MIN_DUSZA_ZONE_MM)) / Math.PI - gap / 2);
  return fitted > 0 && fitted + gap / 2 > 0 ? fitted : null;
}
