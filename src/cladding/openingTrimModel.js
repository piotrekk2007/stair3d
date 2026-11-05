// The opening's trim — „fajka” — of the module "Schody na beton" (user request 2026-11-05, as the self-supporting
// openingTrimModel.js; docs/architecture/CONCRETE_CLADDING_MODULE.md): along the chosen edges of the ceiling opening
// (`openingTrimEdges[k]`, toggled on the plan — mode „▬ Fajka”; never the stair's exit edge, the antresola nosing is
// there) a NOSE standing out into the opening (`openingTrimNoseWidthMm` × `openingTrimNoseHeightMm`, default the tread's
// thickness) and a BOARD lying on the slab behind it (`openingTrimBoardThicknessMm`, default the top floor finish, else
// 15; `openingTrimBoardDepthMm` onto the floor), their top flush with the finished floor; mitred at a corner with the
// next trimmed edge, square where the next edge has none. Sizes ASSUMPTION (as the self-supporting defaults). Pure.

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const add = (p, n, d) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

function crossing(a1, b1, a2, b2) {
  const r = { x: b1.x - a1.x, y: b1.y - a1.y };
  const s = { x: b2.x - a2.x, y: b2.y - a2.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a2.x - a1.x) * s.y - (a2.y - a1.y) * s.x) / den;
  return { x: a1.x + r.x * t, y: a1.y + r.y * t };
}

/** The opening's edges: `[{k, a, b, exit, on}]` — `exit` = along the stair's last back edge (no trim there). */
export function trimEdges(built, config) {
  const o = built.slab?.opening || [];
  const last = built.concrete.elements.at(-1);
  const exitEdges = (last?.edges || []).filter((e) => e.role === 'back');
  const onExit = (a, b) => exitEdges.some((e) => [a, b].every((p) => Math.abs((e.b.x - e.a.x) * (p.y - e.a.y) - (e.b.y - e.a.y) * (p.x - e.a.x)) / (dist(e.a, e.b) || 1) < 1));
  return o.map((a, k) => {
    const b = o[(k + 1) % o.length];
    const exit = onExit(a, b);
    return { k, a, b, exit, on: !!config.openingTrimEnabled && !exit && config.openingTrimEdges?.[k] !== false };
  });
}

/**
 * @returns {{pieces: {id, edge, outline, nose: {outline, bottomZ, topZ}, board: {outline, bottomZ, topZ}, grain,
 *   lengthMm, depthMm, thicknessMm}[], noseWidthMm, noseHeightMm, boardThicknessMm, boardDepthMm}}
 */
export function buildOpeningTrim(built, config) {
  const empty = { pieces: [] };
  if (!config.openingTrimEnabled || !built.slab?.opening?.length) return empty;
  const W = config.openingTrimNoseWidthMm;
  const D = config.openingTrimBoardDepthMm;
  const T = config.openingTrimBoardThicknessMm ?? (config.floorFinishTopMm > 0 ? config.floorFinishTopMm : 15);
  const H = Math.max(T, config.openingTrimNoseHeightMm ?? config.treadThicknessMm);
  const slabTop = built.concrete.exit.rawSlabTopZ;
  const top = slabTop + T;
  const edges = trimEdges(built, config);
  const n = edges.length;
  // every edge's three lines: into the opening (−W), the edge itself, onto the slab (+D) — the slab to the right of a
  // counter-clockwise opening's edge
  const lines = edges.map((e) => {
    const l = dist(e.a, e.b) || 1;
    const t = { x: (e.b.x - e.a.x) / l, y: (e.b.y - e.a.y) / l };
    const nrm = { x: t.y, y: -t.x };
    const at = (d) => [add(e.a, nrm, d), add(e.b, nrm, d)];
    return { t, nrm, inner: at(-W), mid: at(0), outer: at(D) };
  });
  const pieces = [];
  for (const e of edges) {
    if (!e.on) continue;
    const L = lines[e.k];
    const prev = edges[(e.k - 1 + n) % n];
    const next = edges[(e.k + 1) % n];
    // a corner shared with a trimmed edge: mitred (the offset lines crossing), else square through the vertex
    const endAt = (which, side) => {
      const other = which === 'start' ? prev : next;
      const O = lines[other.k];
      if (other.on && other.k !== e.k) {
        const c = crossing(L[side][0], L[side][1], O[side][0], O[side][1]);
        if (c) return c;
      }
      return L[side][which === 'start' ? 0 : 1];
    };
    const p = (side) => [endAt('start', side), endAt('end', side)];
    const inner = p('inner');
    const mid = p('mid');
    const outer = p('outer');
    const along = [...inner, ...outer].map((q) => q.x * L.t.x + q.y * L.t.y);
    pieces.push({
      id: `trim-${e.k}`,
      edge: e.k,
      outline: [inner[0], inner[1], outer[1], outer[0]].reverse(),
      nose: { outline: [inner[0], inner[1], mid[1], mid[0]].reverse(), bottomZ: top - H, topZ: top },
      board: { outline: [mid[0], mid[1], outer[1], outer[0]].reverse(), bottomZ: slabTop, topZ: top },
      grain: L.t,
      lengthMm: Math.max(...along) - Math.min(...along),
      depthMm: W + D,
      thicknessMm: H,
    });
  }
  return { pieces, noseWidthMm: W, noseHeightMm: H, boardThicknessMm: T, boardDepthMm: D };
}
