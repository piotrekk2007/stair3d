// The stairwell (klatka schodowa) as a ROOM the stair is placed in — stage 1 of the room-first designer.
//
// The room is a rectangle in its own frame: X across (0..width), Y along (0..length), (0,0) its south-west corner as
// seen on the plan; the sides are named by compass: S (y = 0), N (y = length), W (x = 0), E (x = width). The user
// gives (user decision 2026-10-16, both by hand):
//   - the ENTRY: the side of the room one enters through (`stairwellEntrySide`; walking starts perpendicular to it,
//     into the room) and how far inside the first tread's front edge stands (`stairwellEntryOffsetMm`, without the
//     nosing); a straight stair also says which wall its flight runs along (`stairwellStraightWall`);
//   - the EXIT: the edge of the ceiling opening where the upper floor is — by default FOLLOWING FROM THE STAIR TYPE
//     (user decision 2026-10-16: the type is the user's; `stairwellExitSide: 'auto'`, `exitSideFor`): a straight
//     stair exits on the edge opposite the entry, an L on the side edge toward its turn, a U on the edge on the entry
//     side; a compass side (S/N/W/E) set by hand overrides it. The last tread's back edge must lie on it.
// The ceiling opening (rectangle or polygon, geometry/ceilingOpening.js) is then given in the ROOM frame.
//
// The stair is not moved by any of this: the plan stays in its own frame (flight A from the origin along +Y, the
// outer line at x = 0 — planLayout.js) and the room is placed AROUND it by one rigid transform (`stairPlacement`):
// plan +Y = the entry walking direction, the outer line along the wall on the side the stair does not turn to (a
// right-turning stair has its outer wanga on the walker's left), the wanga face `stairwellWallGapMm` off that wall.
// Everything here is pure (no Three.js, no config mutation); `stairwellReport` measures the result and reports what
// does not match — the automatic layout that makes it match is stage 2.

import { createDiagnostic } from '../diagnostics/diagnostic.js';

export const ROOM_SIDES = Object.freeze(['S', 'N', 'W', 'E']);
export const ROOM_SIDE_LABELS_PL = Object.freeze({ S: 'S (dół planu)', N: 'N (góra planu)', W: 'W (lewo)', E: 'E (prawo)' });
// Outward normal of each room side (= the compass direction).
const OUT = Object.freeze({ S: { x: 0, y: -1 }, N: { x: 0, y: 1 }, W: { x: -1, y: 0 }, E: { x: 1, y: 0 } });

// A point within this of a line/wall counts as on it (mm).
export const STAIRWELL_TOLERANCE_MM = 1;
// An opening edge faces a compass side when its outward normal is within 45° of it.
const FACING_COS = Math.SQRT1_2 - 1e-9;
// The stair's last walking direction matches the exit when within ~5°.
const SAME_DIRECTION_COS = Math.cos((5 * Math.PI) / 180);

const dot = (a, b) => a.x * b.x + a.y * b.y;
const sideFacing = (dir) => ROOM_SIDES.find((s) => Math.abs(OUT[s].x - dir.x) < 1e-9 && Math.abs(OUT[s].y - dir.y) < 1e-9) || null;

/**
 * The exit side (compass) the stair ends on: the hand-set `stairwellExitSide`, or ('auto') the one its type and turn
 * call for, seen from the entry — straight: walking on; L: toward the turn; U: back to the entry side.
 */
export function exitSideFor(config) {
  if (ROOM_SIDES.includes(config.stairwellExitSide)) return config.stairwellExitSide;
  const entry = ROOM_SIDES.includes(config.stairwellEntrySide) ? config.stairwellEntrySide : 'S';
  const walk = { x: -OUT[entry].x, y: -OUT[entry].y };
  const right = { x: walk.y, y: -walk.x };
  if (config.stairType === 'U') return entry;
  if (config.stairType === 'L') return sideFacing(config.turnDirection === 'left' ? { x: -right.x, y: -right.y } : right);
  return sideFacing(walk);
}
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });

/** The room, or null when the stairwell is off / has no size. */
export function stairwellRoom(config) {
  if (!config.stairwellRoomEnabled) return null;
  const width = Number(config.stairwellRoomWidthMm);
  const length = Number(config.stairwellRoomLengthMm);
  if (!(width > 0) || !(length > 0)) return null;
  return {
    width,
    length,
    outline: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: length },
      { x: 0, y: length },
    ],
  };
}

function sideSegment(room, side) {
  const [a, b, c, d] = room.outline;
  return { S: [a, b], E: [b, c], N: [c, d], W: [d, a] }[side];
}

/**
 * The room seen from its entry: `walk` = into the room, `right` = the walker's right, the entry side from `leftEnd` to
 * `rightEnd`; `toLocal(q)` = {a: across from the left end, b: depth into the room}; `across` / `depth` = the room's
 * size that way. null without a room.
 */
export function entryFrame(config) {
  const room = stairwellRoom(config);
  if (!room) return null;
  const entrySide = ROOM_SIDES.includes(config.stairwellEntrySide) ? config.stairwellEntrySide : 'S';
  const walk = mul(OUT[entrySide], -1); // into the room
  const right = { x: walk.y, y: -walk.x };
  const [p, q] = sideSegment(room, entrySide);
  const [leftEnd, rightEnd] = dot(p, right) <= dot(q, right) ? [p, q] : [q, p];
  const across = entrySide === 'S' || entrySide === 'N' ? room.width : room.length;
  const depth = entrySide === 'S' || entrySide === 'N' ? room.length : room.width;
  const toLocal = (pt) => {
    const d = sub(pt, leftEnd);
    return { a: dot(d, right), b: dot(d, walk) };
  };
  return { room, entrySide, walk, right, leftEnd, rightEnd, entryLine: [leftEnd, rightEnd], across, depth, toLocal };
}

/**
 * The rigid transform between the plan frame and the room frame, or null without a room.
 * @returns {{room, entrySide:string, walk:{x,y}, right:{x,y}, origin:{x,y}, outerOnLeft:boolean,
 *   toRoom:(p)=>{x,y}, toPlan:(q)=>{x,y}, entryLine:[{x,y},{x,y}]} | null}
 */
export function stairPlacement(config, planLayout) {
  const frame = entryFrame(config);
  if (!frame || !planLayout) return null;
  const { room, entrySide, walk, right, leftEnd, rightEnd } = frame;
  const gap = Math.max(0, Number(config.stairwellWallGapMm) || 0);
  const inward = mul(walk, Number(config.stairwellEntryOffsetMm) || 0);
  const bounds = planLayout.bounds || { minX: 0, maxX: 0 };
  const straight = config.stairType === 'straight';
  // plan x >= 0 for a right turn (outer line at x = 0 on the walker's left), x <= 0 for a mirrored left turn
  const outerOnLeft = straight ? config.stairwellStraightWall !== 'right' : (planLayout.handedness ?? 1) > 0;
  let origin;
  if (straight && !outerOnLeft) origin = add(sub(rightEnd, mul(right, bounds.maxX + gap)), inward); // inner wanga at the right wall
  else if (outerOnLeft) origin = add(add(leftEnd, mul(right, gap)), inward);
  else origin = add(sub(rightEnd, mul(right, gap)), inward);
  // plan (x, y) -> origin + x * right + y * walk
  const toRoom = (pt) => add(origin, add(mul(right, pt.x), mul(walk, pt.y)));
  const toPlan = (pt) => {
    const d = sub(pt, origin);
    return { x: dot(d, right), y: dot(d, walk) };
  };
  return { room, entrySide, walk, right, origin, outerOnLeft, toRoom, toPlan, entryLine: [leftEnd, rightEnd] };
}

/**
 * The edge of the opening (ROOM frame, CCW outline) facing `side`: of the edges whose outward normal is within 45°
 * of it, the one lying farthest that way (the longer on a tie). null when no edge faces that way.
 */
export function openingExitEdge(outline, side) {
  const dir = OUT[side];
  if (!dir || !Array.isArray(outline) || outline.length < 3) return null;
  let best = null;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const normal = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }; // outward for a CCW outline
    if (dot(normal, dir) < FACING_COS) continue;
    const reach = dot(mul(add(a, b), 0.5), dir);
    if (!best || reach > best.reach + 1e-6 || (Math.abs(reach - best.reach) <= 1e-6 && len > best.length)) best = { a, b, normal, index: i, reach, length: len };
  }
  return best && { a: best.a, b: best.b, normal: best.normal, index: best.index, length: best.length };
}

/** What the entry and exit directions call for ({stairType, turnDirection?, label}, null for an oblique exit); `placement`
 * = stairPlacement or entryFrame (walk, right, entryLine). */
export function requiredStair(placement, exitEdge, preferredTurn = 'right') {
  const n = exitEdge.normal;
  const along = dot(n, placement.walk);
  const across = dot(n, placement.right);
  if (along > SAME_DIRECTION_COS) return { stairType: 'straight', label: 'schody proste' };
  if (along < -SAME_DIRECTION_COS) {
    const mid = mul(add(exitEdge.a, exitEdge.b), 0.5);
    const entryMid = mul(add(placement.entryLine[0], placement.entryLine[1]), 0.5);
    // the turn toward the side the exit edge lies on; an edge reaching across the entry's middle says nothing — the
    // project's own turn direction is kept
    const across = [exitEdge.a, exitEdge.b].map((p) => dot(sub(p, entryMid), placement.right));
    const ambiguous = Math.min(...across) < 0 && Math.max(...across) > 0;
    const side = ambiguous ? (preferredTurn === 'left' ? -1 : 1) : dot(sub(mid, entryMid), placement.right);
    return side >= 0 ? { stairType: 'U', turnDirection: 'right', label: 'schody U, skręt w prawo' } : { stairType: 'U', turnDirection: 'left', label: 'schody U, skręt w lewo' };
  }
  if (across > SAME_DIRECTION_COS) return { stairType: 'L', turnDirection: 'right', label: 'schody L, skręt w prawo' };
  if (across < -SAME_DIRECTION_COS) return { stairType: 'L', turnDirection: 'left', label: 'schody L, skręt w lewo' };
  return null; // an oblique exit edge: no supported stair ends square to it
}

const diag = (ruleId, severity, parameter, message, extra = {}) =>
  createDiagnostic({ ruleId, severity, elementType: 'stair', elementId: null, parameter, message, ...extra });
const mm = (v) => `${Math.round(v)} mm`;

/**
 * Measures the placed stair against its room and exit edge.
 * @param {Object} config
 * @param {Object} planLayout
 * @param {Object|null} placement   stairPlacement(config, planLayout)
 * @param {{x,y}[]|null} openingRoomOutline   the opening's outline in the ROOM frame (CCW)
 * @returns {{enabled:boolean, placement, exitEdge, required, protrusionMm:number, exitOffsetMm:number|null, diagnostics:Object[]}}
 */
export function stairwellReport(config, planLayout, placement, openingRoomOutline) {
  const off = { enabled: false, placement: null, exitEdge: null, required: null, protrusionMm: 0, exitOffsetMm: null, diagnostics: [] };
  if (!placement) return off;
  const { room } = placement;
  const diagnostics = [];

  // 1. the stair inside the room: every tread outline and both stringer lines (the outer one is the wall line)
  const pts = [...(planLayout.outerFullPath || []), ...(planLayout.innerFullPath || []), ...planLayout.treads.flatMap((t) => t.outline || [])].map(placement.toRoom);
  let protrusion = 0;
  const sides = new Set();
  for (const p of pts) {
    const over = { W: -p.x, E: p.x - room.width, S: -p.y, N: p.y - room.length };
    for (const [s, v] of Object.entries(over)) {
      if (v > STAIRWELL_TOLERANCE_MM) sides.add(s);
      protrusion = Math.max(protrusion, v);
    }
  }
  if (sides.size) {
    diagnostics.push(
      diag('STAIRWELL-OUTSIDE', 'WARNING', 'stairwellRoom', `Schody wychodzą poza klatkę o ${mm(protrusion)} (po stronie ${[...sides].join(', ')}). Zmień wymiary klatki, wejście albo parametry schodów.`, {
        value: Math.round(protrusion),
        expected: 0,
        unit: 'mm',
      }),
    );
  }

  // 2. the exit: the last tread's back edge on the opening edge where the upper floor is
  const side = exitSideFor(config);
  const exitEdge = side ? openingExitEdge(openingRoomOutline, side) : null;
  let required = null;
  let exitOffsetMm = null;
  if (side && !exitEdge) {
    diagnostics.push(diag('STAIRWELL-EXIT-EDGE', 'WARNING', 'stairwellExitSide', `Otwór w stropie nie ma krawędzi od strony ${side} — wyjście ze schodów nie jest określone.`));
  } else if (exitEdge) {
    required = requiredStair(placement, exitEdge, config.turnDirection);
    const last = planLayout.treads[planLayout.treads.length - 1];
    const back = last ? last.backEdge.map(placement.toRoom) : [];
    const front = last ? last.frontEdge.map(placement.toRoom) : [];
    const walkEnd = back.length === 2 ? sub(mul(add(back[0], back[1]), 0.5), mul(add(front[0], front[1]), 0.5)) : null;
    const walkLen = walkEnd ? Math.hypot(walkEnd.x, walkEnd.y) : 0;
    const sameWay = walkLen > 1e-6 && dot(walkEnd, exitEdge.normal) / walkLen > SAME_DIRECTION_COS;
    const typeOk = required && required.stairType === config.stairType && (required.stairType === 'straight' || required.turnDirection === config.turnDirection);
    if (!required) {
      diagnostics.push(diag('STAIRWELL-EXIT-DIRECTION', 'WARNING', 'stairwellExitSide', 'Krawędź wyjścia otworu jest ukośna względem wejścia — żaden obsługiwany typ schodów nie kończy się prostopadle do niej.'));
    } else if (!typeOk || !sameWay) {
      diagnostics.push(
        diag('STAIRWELL-EXIT-DIRECTION', 'WARNING', 'stairType', `Wejście od strony ${placement.entrySide} i wyjście na krawędzi ${side} otworu wymagają: ${required.label}. Obecne schody kończą się w innym kierunku.`, {
          expected: required.label,
        }),
      );
    } else {
      // signed distance of the back edge's ends past the exit line (+ = under the upper floor)
      const offsets = back.map((p) => dot(sub(p, exitEdge.a), exitEdge.normal));
      exitOffsetMm = offsets.reduce((s, v) => s + v, 0) / offsets.length;
      const t = (p) => dot(sub(p, exitEdge.a), sub(exitEdge.b, exitEdge.a)) / (exitEdge.length * exitEdge.length);
      const beyond = back.some((p) => t(p) * exitEdge.length < -STAIRWELL_TOLERANCE_MM || (t(p) - 1) * exitEdge.length > STAIRWELL_TOLERANCE_MM);
      if (Math.abs(exitOffsetMm) > STAIRWELL_TOLERANCE_MM) {
        diagnostics.push(
          diag(
            'STAIRWELL-EXIT-OFFSET',
            'WARNING',
            'stairwellExitSide',
            exitOffsetMm > 0
              ? `Ostatni stopień wchodzi ${mm(exitOffsetMm)} pod strop za krawędzią wyjścia ${side} otworu — schody są za długie.`
              : `Ostatni stopień kończy się ${mm(-exitOffsetMm)} przed krawędzią wyjścia ${side} otworu — schody są za krótkie.`,
            { value: Math.round(exitOffsetMm), expected: 0, unit: 'mm' },
          ),
        );
      }
      if (beyond) {
        diagnostics.push(diag('STAIRWELL-EXIT-EDGE', 'WARNING', 'stairwellExitSide', `Ostatni stopień nie leży w całości przy krawędzi wyjścia ${side} otworu — wychodzi poza jej długość.`));
      }
    }
  }
  return { enabled: true, placement, exitEdge, required, protrusionMm: Math.max(0, protrusion), exitOffsetMm, diagnostics };
}

/**
 * What the plan 2D draws of the stairwell, in the PLAN frame: the room's walls, the entry side, the exit edge.
 * @param {ReturnType<typeof stairwellReport>} report
 * @returns {{room:{x,y}[], entry:[{x,y},{x,y}], exit:[{x,y},{x,y}]|null, entrySide:string, exitSide:string|null}|null}
 */
export function stairwellPlanDrawing(report, config, openingRoomOutline = null) {
  const placement = report?.placement;
  if (!placement) return null;
  const toPlan = placement.toPlan;
  const { room } = placement;
  // the room's sides, CCW from S (the outline's order) — what a click picks as the entry
  const sides = ['S', 'E', 'N', 'W'].map((side, i) => ({ side, a: toPlan(room.outline[i]), b: toPlan(room.outline[(i + 1) % 4]) }));
  // the opening's edges facing a compass side — what a click picks as the exit
  const exitCandidates = [];
  const outline = Array.isArray(openingRoomOutline) && openingRoomOutline.length >= 3 ? openingRoomOutline : [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const side = ROOM_SIDES.find((s) => dot(n, OUT[s]) >= FACING_COS);
    if (side) exitCandidates.push({ side, a: toPlan(a), b: toPlan(b) });
  }
  // how far the opening's box stands from each wall, drawn from the wall to the box at the box's middle
  const openingDims = [];
  if (outline.length >= 3) {
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const dim = (p, q) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > STAIRWELL_TOLERANCE_MM) openingDims.push({ a: toPlan(p), b: toPlan(q), value: d });
    };
    dim({ x: 0, y: my }, { x: x0, y: my });
    dim({ x: x1, y: my }, { x: room.width, y: my });
    dim({ x: mx, y: 0 }, { x: mx, y: y0 });
    dim({ x: mx, y: y1 }, { x: mx, y: room.length });
  }
  return {
    room: room.outline.map(toPlan),
    entry: placement.entryLine.map(toPlan),
    exit: report.exitEdge ? [toPlan(report.exitEdge.a), toPlan(report.exitEdge.b)] : null,
    entrySide: placement.entrySide,
    exitSide: report.exitEdge ? exitSideFor(config) : null,
    exitAuto: !ROOM_SIDES.includes(config.stairwellExitSide),
    sides,
    exitCandidates,
    openingDims,
  };
}

/**
 * The outline the exit edge is taken from (ROOM frame, CCW): the ceiling opening — or, with the opening DERIVED from
 * the stair (`openingMode: 'derived'`, there is no given edge to end on), the room itself with its
 * `stairwellExitSide` wall moved `stairwellExitInsetMm` into the room.
 */
export function stairwellExitOutline(config, openingRoomOutline) {
  const room = stairwellRoom(config);
  if (config.openingMode !== 'derived' || !room) return openingRoomOutline;
  const d = Math.max(0, Number(config.stairwellExitInsetMm) || 0);
  let [x0, y0, x1, y1] = [0, 0, room.width, room.length];
  const side = exitSideFor(config);
  if (side === 'S') y0 += d;
  else if (side === 'N') y1 -= d;
  else if (side === 'W') x0 += d;
  else if (side === 'E') x1 -= d;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

// Drawn thickness of the stairwell's walls in 3D — presentation only (the walls are not part of the stair, not
// exported, not measured); the real walls are the user's building.
export const STAIRWELL_WALL_DRAWN_THICKNESS_MM = 120;

/**
 * The stairwell's walls and slab for the 3D view, in the PLAN frame: one piece per room side except the open entry
 * side — its inner face from `a` to `b` (extended past a corner shared with another wall so the corners close),
 * `outward` = away from the room — up to the slab's underside; `slab` = the room grown by the wall thickness.
 * null without a room.
 */
export function stairwellWalls(report, config) {
  const placement = report?.placement;
  if (!placement) return null;
  const { room, entrySide } = placement;
  const T = STAIRWELL_WALL_DRAWN_THICKNESS_MM;
  const height = Math.max(0, (Number(config.totalRise) || 0) - (Number(config.ceilingThickness) || 0));
  const order = ['S', 'E', 'N', 'W']; // the room outline's sides in CCW order
  const pieces = [];
  for (let i = 0; i < 4; i++) {
    const side = order[i];
    if (side === entrySide) continue;
    let [a, b] = sideSegment(room, side);
    const dir = normalize(sub(b, a));
    if (order[(i + 3) % 4] !== entrySide) a = sub(a, mul(dir, T));
    if (order[(i + 1) % 4] !== entrySide) b = add(b, mul(dir, T));
    const out = OUT[side];
    pieces.push({ side, a: placement.toPlan(a), b: placement.toPlan(b), outward: sub(placement.toPlan(add(a, out)), placement.toPlan(a)), thickness: T, height });
  }
  const grow = [
    { x: -T, y: -T },
    { x: room.width + T, y: -T },
    { x: room.width + T, y: room.length + T },
    { x: -T, y: room.length + T },
  ];
  return { pieces, slab: grow.map(placement.toPlan) };
}

function normalize(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}
