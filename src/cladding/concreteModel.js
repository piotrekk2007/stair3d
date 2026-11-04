// The measured concrete stair (module "Schody na beton", docs/architecture/CONCRETE_CLADDING_MODULE.md): the
// sequence of step groups and landings → every concrete element as a plan rectangle in its flight's frame, with its
// top height. Pure, no Three.js; independent of the self-supporting planLayout.js (user decision 2026-11-04).
//
// Plan frame: mm, the first step's front edge starts at the origin, walking up = +y at the start; z = up from the RAW
// floor. A flight has a frame {o, f, r}: f = walking direction, r = its right (f turned 90° clockwise), o = a point on
// its ANCHOR line — the outer side of the stair (the side away from the turn: a right turn keeps the left line
// straight, a left turn the right line), so steps of different measured widths keep the wall side in one line. A
// step spans u ∈ [0, w] (anchor left) or [−w, 0] (anchor right) across, v ∈ [v0, v0 + going] along f.

const rotCW = (v) => ({ x: v.y, y: -v.x });
const neg = (v) => ({ x: -v.x, y: -v.y });
/** A point of a flight's frame (u across, v along) in plan. */
export const planPoint = (frame, u, v) => ({ x: frame.o.x + frame.r.x * u + frame.f.x * v, y: frame.o.y + frame.r.y * u + frame.f.y * v });

/** The steps and landings one by one (groups expanded, a step's own override applied), in walking order. */
export function expandSequence(config) {
  const out = [];
  for (const g of config.sequence || []) {
    if (g.kind === 'steps') {
      for (let k = 0; k < g.count; k++) out.push({ kind: 'step', riseMm: g.riseMm, goingMm: g.goingMm, widthMm: g.widthMm });
    } else if (g.kind === 'landing') {
      out.push({ kind: 'landing', riseMm: g.riseMm, depthMm: g.depthMm, turn: g.turn, gapMm: g.gapMm || 0 });
    }
  }
  return out.map((e, i) => {
    const o = config.stepOverrides?.[i] || {};
    return { ...e, index: i, ...(o.riseMm !== undefined ? { riseMm: o.riseMm } : {}), ...(o.goingMm !== undefined && e.kind === 'step' ? { goingMm: o.goingMm } : {}), ...(o.widthMm !== undefined ? { widthMm: o.widthMm } : {}), overridden: Object.keys(o).length > 0 };
  });
}

const firstTurn = (items) => items.find((e) => e.kind === 'landing' && e.turn !== 'none')?.turn ?? 'none';
// the outer side for a turn: away from it
const anchorFor = (turn) => (turn === 'left' || turn === 'u-left' ? 'right' : 'left');

/**
 * @returns {{elements: object[], flights: object[], exit: {topZ, rawSlabTopZ, riseMm}, bounds: {minX,maxX,minY,maxY}}}
 *  element: {index, kind, flight, frame, anchor, u0, u1, v0, v1, outline (CCW plan rectangle), frontEdge [left,right],
 *  backEdge [left,right], riseMm, goingMm, widthMm, topZ, bottomZ (prev top), turn?, exitSide?}
 */
export function buildConcreteModel(config) {
  const items = expandSequence(config);
  const elements = [];
  let anchor = anchorFor(firstTurn(items));
  let frame = { o: { x: 0, y: 0 }, f: { x: 0, y: 1 }, r: rotCW({ x: 0, y: 1 }) };
  let flight = 0;
  let v = 0;
  let z = 0;
  let lastWidth = items.find((e) => e.kind === 'step')?.widthMm ?? 1000;
  const across = (w) => (anchor === 'left' ? [0, w] : [-w, 0]);
  const nextWidth = (i) => items.slice(i + 1).find((e) => e.kind === 'step')?.widthMm ?? lastWidth;
  items.forEach((item, i) => {
    const bottomZ = z;
    z += item.riseMm;
    if (item.kind === 'step') {
      const [u0, u1] = across(item.widthMm);
      elements.push(element(item, { flight, frame, anchor, u0, u1, v0: v, v1: v + item.goingMm, topZ: z, bottomZ }));
      v += item.goingMm;
      lastWidth = item.widthMm;
      return;
    }
    // a landing: a rectangle in the incoming flight's frame; for a turn the next flight starts at its far side
    const W = lastWidth;
    const Wn = nextWidth(i);
    const G = item.turn === 'u-left' || item.turn === 'u-right' ? item.gapMm : 0;
    const depth = item.depthMm ?? (item.turn === 'none' ? W : item.turn === 'left' || item.turn === 'right' ? Wn : Math.max(W, Wn));
    const [a0, a1] = across(W);
    let u0 = a0;
    let u1 = a1;
    if (item.turn === 'u-right') u1 = a1 + G + Wn;
    if (item.turn === 'u-left') u0 = a0 - G - Wn;
    elements.push(element({ ...item, goingMm: depth, widthMm: u1 - u0 }, { flight, frame, anchor, u0, u1, v0: v, v1: v + depth, topZ: z, bottomZ, exitSide: item.turn === 'none' ? null : item.turn.endsWith('left') ? 'left' : 'right' }));
    if (item.turn === 'none') {
      v += depth;
      return;
    }
    // the next flight's frame
    let o;
    let f;
    let nextAnchor;
    if (item.turn === 'right') {
      // walking +r; its left (outer) line is the landing's back edge
      o = planPoint(frame, anchor === 'left' ? W : 0, v + depth);
      f = frame.r;
      nextAnchor = 'left';
    } else if (item.turn === 'left') {
      // walking −r; its right (outer) line is the landing's back edge
      o = planPoint(frame, anchor === 'left' ? 0 : -W, v + depth);
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
  });
  const lastTop = z;
  const exitRiseMm = config.exitRiseMm ?? items.filter((e) => e.kind === 'step').at(-1)?.riseMm ?? 180;
  const pts = elements.flatMap((e) => e.outline);
  const bounds = pts.length
    ? { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) }
    : { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
  return { elements, flights: flight + 1, exit: { topZ: lastTop, riseMm: exitRiseMm, rawSlabTopZ: lastTop + exitRiseMm }, bounds };
}

function element(item, { flight, frame, anchor, u0, u1, v0, v1, topZ, bottomZ, exitSide = null }) {
  const outline = [planPoint(frame, u0, v0), planPoint(frame, u1, v0), planPoint(frame, u1, v1), planPoint(frame, u0, v1)];
  // (CCW in plan for a right-handed frame; reversed otherwise)
  const area = outline.reduce((s, p, k) => s + p.x * outline[(k + 1) % 4].y - outline[(k + 1) % 4].x * p.y, 0);
  return {
    index: item.index,
    kind: item.kind,
    flight,
    frame,
    anchor,
    u0,
    u1,
    v0,
    v1,
    outline: area < 0 ? [...outline].reverse() : outline,
    frontEdge: [planPoint(frame, u0, v0), planPoint(frame, u1, v0)],
    backEdge: [planPoint(frame, u0, v1), planPoint(frame, u1, v1)],
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
