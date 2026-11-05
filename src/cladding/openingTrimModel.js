// The opening's trim — „fajka” — of the module "Schody na beton" (user request 2026-11-05, as the self-supporting
// openingTrimModel.js; docs/architecture/CONCRETE_CLADDING_MODULE.md): along the chosen edges of the ceiling opening
// (`openingTrimEdges[k]`, toggled on the plan — mode „▬ Fajka”; never the stair's exit edge, the antresola nosing is
// there) a NOSE standing out into the opening (`openingTrimNoseWidthMm` × `openingTrimNoseHeightMm`, default the tread's
// thickness) and a BOARD lying on the slab behind it (`openingTrimBoardThicknessMm`, default the top floor finish, else
// 15; `openingTrimBoardDepthMm` onto the floor), their top flush with the finished floor; mitred at a corner with the
// next trimmed edge — and with the ANTRESOLA NOSING at the stair's exit (user request 2026-11-05: „przy fajkach na
// antresoli muszą się łączyć pod kątem 45°”: the trim and the nosing both cut on the corner's diagonal, their own
// overhangs kept — the nosing's mitred outline returned as `exitNosingOutlines`) —, square where the next edge has
// none. Sizes ASSUMPTION (as the self-supporting defaults). Pure.

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
  // the antresola nosing on the exit edge: its own lines (its overhang into the opening, its depth onto the slab) where
  // one of its ends is a corner of the opening
  const nosings = built.cladding.exitNosing || [];
  // (an end of the nosing at the corner — or short of it along its line by ≤ 200 mm: the opening wider than the stair
  // by its side nosing; the nosing is then carried on to the corner)
  const REACH = 200;
  const endNear = (nz, v) => {
    const { a, b } = nz.edge;
    const l = dist(a, b) || 1;
    const off = Math.abs((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x)) / l;
    if (off > 1) return null;
    const da = dist(a, v);
    const db = dist(b, v);
    if (Math.min(da, db) > REACH) return null;
    return da <= db ? 'a' : 'b';
  };
  const nosingAt = (v) => nosings.find((nz) => nz.edge && endNear(nz, v));
  const lines = edges.map((e) => {
    const l = dist(e.a, e.b) || 1;
    const t = { x: (e.b.x - e.a.x) / l, y: (e.b.y - e.a.y) / l };
    const nrm = { x: t.y, y: -t.x };
    const at = (d, from = e.a, to = e.b) => [add(from, nrm, d), add(to, nrm, d)];
    if (e.exit) {
      const nz = nosingAt(e.a) || nosingAt(e.b);
      if (nz) return { t, nrm, inner: at(-nz.overMm), mid: at(0), outer: at(nz.onSlabMm), nosing: nz };
    }
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
      const v = which === 'start' ? e.a : e.b;
      // (a trimmed neighbour, or the antresola nosing ending at this corner)
      if ((other.on || (other.exit && O.nosing && nosingAt(v))) && other.k !== e.k) {
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
  // the antresola nosing's ends at a trimmed corner: mitred the same way (its inner / outer lines crossing the trim's)
  const exitNosingOutlines = {};
  for (const e of edges) {
    const L = lines[e.k];
    if (!e.exit || !L.nosing) continue;
    const nz = L.nosing;
    const prev = edges[(e.k - 1 + n) % n];
    const next = edges[(e.k + 1) % n];
    // the nosing's own ends (its edge a → b runs along the opening's exit edge, either way round)
    const ends = ['a', 'b'].map((end) => {
      const atCorner = endNear(nz, e.a) === end ? prev : endNear(nz, e.b) === end ? next : null;
      if (!atCorner?.on) return null;
      const O = lines[atCorner.k];
      return { inner: crossing(L.inner[0], L.inner[1], O.inner[0], O.inner[1]), outer: crossing(L.outer[0], L.outer[1], O.outer[0], O.outer[1]) };
    });
    if (!ends[0] && !ends[1]) continue;
    // the nosing's outline as claddingModel.js builds it: [a − over, b − over, b + depth, a + depth] reversed — its own
    // outward normal is the opening's slab side
    const sideA = ends[0];
    const sideB = ends[1];
    const nn = L.nrm;
    const innerA = sideA?.inner ?? add(nz.edge.a, nn, -nz.overMm);
    const innerB = sideB?.inner ?? add(nz.edge.b, nn, -nz.overMm);
    const outerA = sideA?.outer ?? add(nz.edge.a, nn, nz.onSlabMm);
    const outerB = sideB?.outer ?? add(nz.edge.b, nn, nz.onSlabMm);
    exitNosingOutlines[nz.id] = [innerA, innerB, outerB, outerA].reverse();
  }
  return { pieces, noseWidthMm: W, noseHeightMm: H, boardThicknessMm: T, boardDepthMm: D, exitNosingOutlines };
}
