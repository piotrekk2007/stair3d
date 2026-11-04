// The measured concrete stair (module "Schody na beton", docs/architecture/CONCRETE_CLADDING_MODULE.md): the
// sequence of step groups, landings and winder zones → every concrete element as a plan polygon with its edges named
// (front / back / left / right walking up) and its top height. Pure, no Three.js; independent of the self-supporting
// planLayout.js (user decision 2026-11-04).
//
// Plan frame: mm, the first step's front edge starts at the origin, walking up = +y at the start; z = up from the RAW
// floor. A flight has a frame {o, f, r}: f = walking direction, r = its right (f turned 90° clockwise), o = a point on
// its ANCHOR line — the outer side of the stair (the side away from the turn: a right turn keeps the left line
// straight, a left turn the right line), so steps of different measured widths keep the wall side in one line. A
// step spans u ∈ [0, w] (anchor left) or [−w, 0] (anchor right) across, v ∈ [v0, v0 + going] along f.
//
// A WINDER ZONE (stage 2, user decisions 2026-11-04) turns the stair 90° like an L landing, split into `count`
// winders. In the zone's own coordinates x runs across from the OUTER line (0) to the inner one (W, the incoming
// width), y along the incoming flight from the zone's start: the outer (wall) corner O = (0, A), the dusza corner
// C = (W, A − Wn), the exit flight leaving along +x, its outer line y = A, the zone ending at x = B. A = `spaceAMm`
// (zone start → wall corner along the incoming wall), B = `spaceBMm` (wall corner → zone end along the exit wall).
// Every edge between two winders is given by two numbers measured on site FROM THE CORNERS (user, 2026-11-04): on the
// wall, signed from the wall corner (negative = on the incoming wall, positive = on the exit wall), and at the dusza,
// signed from the dusza corner the same way. Unmeasured ones are generated: the dusza ends spread evenly along the
// dusza line, the edge through its walkline point (equal goings on a walkline `walklineOffsetMm` from the dusza: a
// straight, a quarter arc round C, a straight) carried on to the wall.

const rotCW = (v) => ({ x: v.y, y: -v.x });
const neg = (v) => ({ x: -v.x, y: -v.y });
/** A point of a flight's frame (u across, v along) in plan. */
export const planPoint = (frame, u, v) => ({ x: frame.o.x + frame.r.x * u + frame.f.x * v, y: frame.o.y + frame.r.y * u + frame.f.y * v });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const signedArea = (pts) => pts.reduce((s, p, k) => s + p.x * pts[(k + 1) % pts.length].y - pts[(k + 1) % pts.length].x * p.y, 0) / 2;
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export const WINDER_TURNS = Object.freeze(['left', 'right']);
// default reach of a winder zone past the corner square on each side, per winder beyond the first (ASSUMPTION — a
// starting point the user overwrites with the measured A / B)
const ZONE_EXTENSION_PER_WINDER_MM = 125;
const ARC_CHORDS = 16;

/** The steps, landings and winders one by one (groups expanded, a step's own override applied), in walking order. */
export function expandSequence(config) {
  const out = [];
  (config.sequence || []).forEach((g, groupIndex) => {
    if (g.kind === 'steps') {
      for (let k = 0; k < g.count; k++) out.push({ kind: 'step', groupIndex, riseMm: g.riseMm, goingMm: g.goingMm, widthMm: g.widthMm });
    } else if (g.kind === 'landing') {
      out.push({ kind: 'landing', groupIndex, riseMm: g.riseMm, depthMm: g.depthMm, turn: g.turn, gapMm: g.gapMm || 0 });
    } else if (g.kind === 'winders') {
      for (let k = 0; k < g.count; k++) out.push({ kind: 'winder', groupIndex, k, riseMm: g.riseMm, turn: g.turn });
    }
  });
  return out.map((e, i) => {
    const o = config.stepOverrides?.[i] || {};
    const own = {};
    if (o.riseMm !== undefined) own.riseMm = o.riseMm;
    if (o.goingMm !== undefined && e.kind === 'step') own.goingMm = o.goingMm;
    if (o.widthMm !== undefined && e.kind === 'step') own.widthMm = o.widthMm;
    return { ...e, index: i, ...own, overridden: Object.keys(o).length > 0 };
  });
}

const turnOf = (e) => (e.kind === 'landing' && e.turn !== 'none') || e.kind === 'winder' ? e.turn : null;
// the outer side for a turn: away from it
const anchorFor = (turn) => (turn === 'left' || turn === 'u-left' ? 'right' : 'left');

/**
 * @returns {{elements, zones, flights, exit: {topZ, rawSlabTopZ, riseMm}, bounds}}
 *  element: {index, kind, groupIndex, flight, frame, outline (CCW), edges [{a, b, role: front|back|left|right|
 *  front-covered}], riseMm, goingMm, widthMm, topZ, bottomZ (prev top), turn, exitSide, walkGoingMm?, zone?, k?}
 */
export function buildConcreteModel(config) {
  const items = expandSequence(config);
  const elements = [];
  const zones = [];
  let anchor = anchorFor(items.map(turnOf).find(Boolean) ?? 'none');
  let frame = { o: { x: 0, y: 0 }, f: { x: 0, y: 1 }, r: rotCW({ x: 0, y: 1 }) };
  let flight = 0;
  let v = 0;
  let z = 0;
  let lastWidth = items.find((e) => e.kind === 'step')?.widthMm ?? 1000;
  const across = (w) => (anchor === 'left' ? [0, w] : [-w, 0]);
  const nextWidth = (i) => items.slice(i + 1).find((e) => e.kind === 'step')?.widthMm ?? lastWidth;
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind === 'step') {
      const bottomZ = z;
      z += item.riseMm;
      const [u0, u1] = across(item.widthMm);
      elements.push(rectElement(item, { flight, frame, u0, u1, v0: v, v1: v + item.goingMm, topZ: z, bottomZ }));
      v += item.goingMm;
      lastWidth = item.widthMm;
      i += 1;
      continue;
    }
    if (item.kind === 'winder') {
      // the whole zone at once
      const group = config.sequence[item.groupIndex];
      const run = items.slice(i, i + group.count);
      const W = lastWidth;
      const Wn = nextWidth(i + run.length - 1);
      const [a0, a1] = across(W);
      const sign = item.turn === 'left' ? -1 : 1;
      const uOut = sign > 0 ? a0 : a1;
      const zone = winderZone({ group, frame, uOut, sign, v0: v, W, Wn, groupIndex: item.groupIndex });
      zones.push(zone);
      run.forEach((w, k) => {
        const bottomZ = z;
        z += w.riseMm;
        const geo = zone.winders[k];
        elements.push({ index: w.index, kind: 'winder', groupIndex: w.groupIndex, k, zone: zones.length - 1, flight, frame, outline: geo.outline, edges: geo.edges, riseMm: w.riseMm, goingMm: zone.walkGoingsMm[k], walkGoingMm: zone.walkGoingsMm[k], widthMm: W, topZ: z, bottomZ, turn: w.turn, exitSide: null, overridden: !!w.overridden });
      });
      frame = zone.exitFrame;
      anchor = sign > 0 ? 'left' : 'right';
      flight += 1;
      v = 0;
      i += run.length;
      continue;
    }
    // a landing: a rectangle in the incoming flight's frame; for a turn the next flight starts at its far side
    const bottomZ = z;
    z += item.riseMm;
    const W = lastWidth;
    const Wn = nextWidth(i);
    const G = item.turn === 'u-left' || item.turn === 'u-right' ? item.gapMm : 0;
    const depth = item.depthMm ?? (item.turn === 'none' ? W : item.turn === 'left' || item.turn === 'right' ? Wn : Math.max(W, Wn));
    const [a0, a1] = across(W);
    let u0 = a0;
    let u1 = a1;
    // a U landing: the front line is covered by the return flight's first riser beyond the incoming flight + the gap
    let coveredFrom = null;
    if (item.turn === 'u-right') {
      u1 = a1 + G + Wn;
      coveredFrom = { side: 'right', u: a1 + G };
    }
    if (item.turn === 'u-left') {
      u0 = a0 - G - Wn;
      coveredFrom = { side: 'left', u: a0 - G };
    }
    elements.push(rectElement({ ...item, goingMm: depth, widthMm: u1 - u0 }, { flight, frame, u0, u1, v0: v, v1: v + depth, topZ: z, bottomZ, exitSide: item.turn === 'none' ? null : item.turn.endsWith('left') ? 'left' : 'right', coveredFrom }));
    i += 1;
    if (item.turn === 'none') {
      v += depth;
      continue;
    }
    let o;
    let f;
    let nextAnchor;
    if (item.turn === 'right') {
      // walking +r; its left (outer) line is the landing's back edge
      o = planPoint(frame, a1, v + depth);
      f = frame.r;
      nextAnchor = 'left';
    } else if (item.turn === 'left') {
      // walking −r; its right (outer) line is the landing's back edge
      o = planPoint(frame, a0, v + depth);
      f = neg(frame.r);
      nextAnchor = 'right';
    } else if (item.turn === 'u-right') {
      // back down beside the incoming flight, on its right: the return flight's left (outer) line is the landing's far
      // right side, starting at the landing's front line
      o = planPoint(frame, u1, v);
      f = neg(frame.f);
      nextAnchor = 'left';
    } else {
      o = planPoint(frame, u0, v);
      f = neg(frame.f);
      nextAnchor = 'right';
    }
    frame = { o, f, r: rotCW(f) };
    anchor = nextAnchor;
    flight += 1;
    v = 0;
  }
  const lastTop = z;
  const exitRiseMm = config.exitRiseMm ?? items.filter((e) => e.kind !== 'landing').at(-1)?.riseMm ?? 180;
  const pts = elements.flatMap((e) => e.outline);
  const bounds = pts.length
    ? { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) }
    : { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
  return { elements, zones, flights: flight + 1, exit: { topZ: lastTop, riseMm: exitRiseMm, rawSlabTopZ: lastTop + exitRiseMm }, bounds };
}

// A rectangle u0..u1 × v0..v1 of a frame: CCW (the frames are right-handed), edges front, right, back, left.
function rectElement(item, { flight, frame, u0, u1, v0, v1, topZ, bottomZ, exitSide = null, coveredFrom = null }) {
  const A = planPoint(frame, u0, v0);
  const B = planPoint(frame, u1, v0);
  const C = planPoint(frame, u1, v1);
  const D = planPoint(frame, u0, v1);
  let front = [{ a: A, b: B, role: 'front' }];
  if (coveredFrom) {
    const X = planPoint(frame, coveredFrom.u, v0);
    front = coveredFrom.side === 'right' ? [{ a: A, b: X, role: 'front' }, { a: X, b: B, role: 'front-covered' }] : [{ a: A, b: X, role: 'front-covered' }, { a: X, b: B, role: 'front' }];
  }
  const edges = [...front, { a: B, b: C, role: 'right' }, { a: C, b: D, role: 'back' }, { a: D, b: A, role: 'left' }];
  return {
    index: item.index,
    kind: item.kind,
    groupIndex: item.groupIndex,
    flight,
    frame,
    u0,
    u1,
    v0,
    v1,
    outline: edges.map((e) => e.a),
    edges,
    riseMm: item.riseMm,
    goingMm: item.goingMm,
    widthMm: item.widthMm,
    topZ,
    bottomZ,
    turn: item.turn ?? null,
    exitSide,
    overridden: !!item.overridden,
  };
}

// --- the winder zone ------------------------------------------------------------------------------------------

/** The zone's sizes as used: A, B (each at least the corner square), the walkline's distance from the dusza. */
export function zoneSizes(group, W, Wn) {
  const ext = ZONE_EXTENSION_PER_WINDER_MM * Math.max(0, group.count - 1);
  const A = Math.max(Wn, group.spaceAMm ?? Wn + ext);
  const B = Math.max(W, group.spaceBMm ?? W + ext);
  const d = Math.min(W, Wn, Math.max(50, group.walklineOffsetMm ?? Math.min(W, Wn) / 2));
  return { A, B, d };
}

// a signed corner distance → the zone's (x, y): the wall line / the dusza line
const outerAt = (s, { A }) => (s < 0 ? { x: 0, y: A + s } : { x: s, y: A });
const innerAt = (s, { A, W, Wn }) => (s < 0 ? { x: W, y: A - Wn + s } : { x: W + s, y: A - Wn });

function winderZone({ group, frame, uOut, sign, v0, W, Wn, groupIndex }) {
  const { A, B, d } = zoneSizes(group, W, Wn);
  const dims = { A, B, W, Wn };
  const toPlan = (p) => planPoint(frame, uOut + sign * p.x, v0 + p.y);
  const n = group.count;
  // the walkline (zone coordinates): straight at x = W − d, a quarter arc round C, straight at y = A − Wn + d
  const C = { x: W, y: A - Wn };
  const walk = [{ x: W - d, y: 0 }, { x: W - d, y: C.y }];
  for (let j = 1; j <= ARC_CHORDS; j++) {
    const t = Math.PI - (Math.PI / 2) * (j / ARC_CHORDS);
    walk.push({ x: C.x + d * Math.cos(t), y: C.y + d * Math.sin(t) });
  }
  walk.push({ x: B, y: C.y + d });
  const walkCum = cumulative(walk);
  const walkLen = walkCum.at(-1);
  const innerLen = A - Wn + (B - W);
  const innerMin = -(A - Wn);
  // edges 0..n: 0 = the zone's start (across the incoming flight), n = its end (across the exit flight)
  const edges = [];
  for (let k = 0; k <= n; k++) {
    if (k === 0 || k === n) {
      const s = k === 0 ? { outerMm: -A, innerMm: innerMin } : { outerMm: B, innerMm: B - W };
      edges.push({ ...s, measuredOuter: false, measuredInner: false, boundary: true });
      continue;
    }
    const own = group.edges?.[k - 1] || {};
    const innerMm = Number.isFinite(own.innerMm) ? clamp(own.innerMm, innerMin, B - W) : innerMin + (innerLen * k) / n;
    let outerMm = Number.isFinite(own.outerMm) ? clamp(own.outerMm, -A, B) : null;
    if (outerMm === null) {
      const p = innerAt(innerMm, dims);
      const q = pointAt(walk, walkCum, (walkLen * k) / n);
      outerMm = hitOuter(p, q, dims) ?? (-A + ((A + B) * k) / n);
    }
    edges.push({ outerMm, innerMm, measuredOuter: Number.isFinite(own.outerMm), measuredInner: Number.isFinite(own.innerMm), boundary: false });
  }
  // the winders between them
  const leftIsOuter = sign > 0;
  const winders = [];
  for (let k = 0; k < n; k++) {
    const e0 = edges[k];
    const e1 = edges[k + 1];
    const o0 = outerAt(e0.outerMm, dims);
    const o1 = outerAt(e1.outerMm, dims);
    const i0 = innerAt(e0.innerMm, dims);
    const i1 = innerAt(e1.innerMm, dims);
    const innerPts = [i0, ...(e0.innerMm < 0 && e1.innerMm > 0 ? [C] : []), i1];
    const outerPts = [o1, ...(e0.outerMm < 0 && e1.outerMm > 0 ? [{ x: 0, y: A }] : []), o0];
    const inSide = leftIsOuter ? 'right' : 'left';
    const outSide = leftIsOuter ? 'left' : 'right';
    const raw = [];
    raw.push({ a: o0, b: i0, role: 'front' });
    for (let j = 0; j < innerPts.length - 1; j++) raw.push({ a: innerPts[j], b: innerPts[j + 1], role: inSide });
    raw.push({ a: i1, b: o1, role: 'back' });
    for (let j = 0; j < outerPts.length - 1; j++) raw.push({ a: outerPts[j], b: outerPts[j + 1], role: outSide });
    let es = raw.filter((e) => dist(e.a, e.b) > 1e-6).map((e) => ({ a: toPlan(e.a), b: toPlan(e.b), role: e.role }));
    if (signedArea(es.map((e) => e.a)) < 0) es = es.reverse().map((e) => ({ a: e.b, b: e.a, role: e.role }));
    winders.push({ outline: es.map((e) => e.a), edges: es });
  }
  // the goings on the walkline (where each edge crosses it)
  const crossings = edges.map((e) => walklineCrossing(walk, walkCum, outerAt(e.outerMm, dims), innerAt(e.innerMm, dims)));
  const walkGoingsMm = edges.slice(0, -1).map((_, k) => (crossings[k] !== null && crossings[k + 1] !== null ? crossings[k + 1] - crossings[k] : null));
  // the order of the edges: each one further on along both lines (a dusza end may repeat — a triangle at the corner)
  const orderOk = edges.every((e, k) => k === 0 || (e.outerMm > edges[k - 1].outerMm + 1e-6 && e.innerMm >= edges[k - 1].innerMm - 1e-6));
  const exitFrame = { o: planPoint(frame, uOut + sign * B, v0 + A), f: sign > 0 ? frame.r : neg(frame.r) };
  exitFrame.r = rotCW(exitFrame.f);
  return {
    groupIndex,
    turn: group.turn,
    count: n,
    A,
    B,
    walklineOffsetMm: d,
    mapping: { frame, uOut, sign, v0, W, Wn },
    wallCorner: toPlan({ x: 0, y: A }),
    duszaCorner: toPlan(C),
    outerPath: [toPlan({ x: 0, y: 0 }), toPlan({ x: 0, y: A }), toPlan({ x: B, y: A })],
    innerPath: [toPlan({ x: W, y: 0 }), toPlan(C), toPlan({ x: B, y: C.y })],
    walkline: walk.map(toPlan),
    edges: edges.map((e) => ({ ...e, outer: toPlan(outerAt(e.outerMm, dims)), inner: toPlan(innerAt(e.innerMm, dims)) })),
    winders,
    walkGoingsMm,
    orderOk,
    exitFrame,
  };
}

/** A plan point → the signed corner distance of the nearest point on the zone's wall line ('outer') or dusza line
 *  ('inner') — what dragging an edge end on the plan writes. */
export function signedOnZoneLine(zone, which, p) {
  const { frame, uOut, sign, v0, W, Wn } = zone.mapping;
  const rel = { x: p.x - frame.o.x, y: p.y - frame.o.y };
  const x = (dot(rel, frame.r) - uOut) * sign;
  const y = dot(rel, frame.f) - v0;
  const { A, B } = zone;
  if (which === 'outer') {
    const a = { s: clamp(y, 0, A) - A, d: Math.hypot(x, y - clamp(y, 0, A)) };
    const b = { s: clamp(x, 0, B), d: Math.hypot(x - clamp(x, 0, B), y - A) };
    return a.d <= b.d ? a.s : b.s;
  }
  const cy = A - Wn;
  const a = { s: clamp(y, 0, cy) - cy, d: Math.hypot(x - W, y - clamp(y, 0, cy)) };
  const b = { s: clamp(x, W, B) - W, d: Math.hypot(x - clamp(x, W, B), y - cy) };
  return a.d <= b.d ? a.s : b.s;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function cumulative(pts) {
  const c = [0];
  for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + dist(pts[k - 1], pts[k]));
  return c;
}
function pointAt(pts, cum, s) {
  for (let k = 1; k < pts.length; k++) {
    if (s <= cum[k] || k === pts.length - 1) {
      const len = cum[k] - cum[k - 1] || 1;
      const t = clamp((s - cum[k - 1]) / len, 0, 1);
      return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t };
    }
  }
  return pts.at(-1);
}
// the line from the dusza point p through the walkline point q, carried on to the wall line → its signed distance
function hitOuter(p, q, { A, B }) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  let best = null;
  // the incoming wall x = 0, y ∈ [0, A]
  if (Math.abs(dx) > 1e-12) {
    const t = -p.x / dx;
    const y = p.y + t * dy;
    if (t > 0 && y >= -1e-6 && y <= A + 1e-6) best = { t, s: y - A };
  }
  // the exit wall y = A, x ∈ [0, B]
  if (Math.abs(dy) > 1e-12) {
    const t = (A - p.y) / dy;
    const x = p.x + t * dx;
    if (t > 0 && x >= -1e-6 && x <= B + 1e-6 && (!best || t < best.t)) best = { t, s: x };
  }
  return best ? clamp(best.s, -A, B) : null;
}
// where the edge (wall point o → dusza point i) crosses the walkline: the distance along it, or null
function walklineCrossing(walk, cum, o, i) {
  for (let k = 1; k < walk.length; k++) {
    const a = walk[k - 1];
    const b = walk[k];
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: i.x - o.x, y: i.y - o.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) continue;
    const qp = { x: o.x - a.x, y: o.y - a.y };
    const t = (qp.x * s.y - qp.y * s.x) / den;
    const u = (qp.x * r.y - qp.y * r.x) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return cum[k - 1] + t * (cum[k] - cum[k - 1]);
  }
  return null;
}
