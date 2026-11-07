// The stair's SIDES unfolded (module "Schody na beton", stage 5 — docs/architecture/CONCRETE_CLADDING_MODULE.md): per
// flight and side (walking up), the pieces of the stair's edge along that line in walking order, each with its plan
// span along the flight (s from the flight frame's origin), its lateral position, its finished top and the height below
// it. Read by the skirting boards (on a walled side), the cover stringer (on an open side) and the balustrade. Pure.

import { edgeWallKey, wallOn } from './surroundingsModel.js';
import { finishThicknessMm } from './claddingModel.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;

/** The concrete's underside at an element's front / back line (as claddingRenderer.js draws it). */
export function soffitAt(e, slabMm) {
  const pitch = e.kind === 'step' ? Math.atan2(e.riseMm, e.goingMm) : 0;
  const t = slabMm / Math.cos(pitch);
  if (e.kind === 'step') return { front: Math.max(0, e.bottomZ - t), back: Math.max(0, e.topZ - t) };
  const flat = e.kind === 'winder' ? Math.max(0, (e.bottomZ + e.topZ) / 2 - t) : Math.max(0, e.topZ - t);
  return { front: flat, back: flat };
}

/**
 * @returns {{key: {flight, side}, id, seg, wall, walled: boolean, frame, u, pieces: {element, s0, s1, top, concreteTop,
 *   below, flat, soffit: {front, back}, wall}[]}[]}  one run per stretch of a (flight, side) under one wall (or none)
 *   that has pieces; `top` = the finished tread top, `below` =
 *   the finished top of the element before (or the floor finish), `u` = the side line's lateral position (the first
 *   piece's)
 */
export function buildSideRuns(concrete, config) {
  const els = concrete.elements;
  // every flight's frame: from its first straight step (a flight that is only winders / a landing has none)
  const frames = new Map();
  for (const e of els) if (e.kind === 'step' && !frames.has(e.flight)) frames.set(e.flight, e.frame);
  const finishedTop = (e) => e.topZ + finishThicknessMm(e, config);
  const runs = new Map();
  els.forEach((e, i) => {
    const below = i === 0 ? config.floorFinishBottomMm : finishedTop(els[i - 1]);
    for (const edge of e.edges) {
      if (edge.role !== 'left' && edge.role !== 'right' && edge.role !== 'back') continue;
      // (the side of a turning landing the next flight leaves from is the way on — no side there)
      if (edge.role === e.exitSide) continue;
      const key = edgeWallKey(e, edge);
      if (!key || (edge.role === 'back' && !key)) continue;
      const flightFrame = frames.get(key.flight);
      if (!flightFrame) continue;
      let frame = flightFrame;
      let id = `${key.flight}:${key.side}`;
      let idBase = null;
      if (Math.abs(dot({ x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y }, flightFrame.f)) < 1) {
        // an edge square to its flight: a U landing's back edge — the end wall (user report 2026-11-06: no skirting
        // there). Its own run along it, walking from the incoming flight's side to the return flight's: r = the side's
        // outward direction turned to the frame's convention (r = f turned clockwise), f from it
        if (e.kind !== 'landing') continue;
        const len = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
        const out = { x: (edge.b.y - edge.a.y) / len, y: -(edge.b.x - edge.a.x) / len };
        const k = key.side === 'left' ? -1 : 1;
        const r = { x: out.x * k, y: out.y * k };
        const f = { x: -r.y, y: r.x };
        const o = dot({ x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y }, f) > 0 ? edge.a : edge.b;
        frame = { o, f, r };
        id = `${key.flight}:${key.side}:end`;
        idBase = `${key.flight}-${key.side}-end`;
      }
      const sa = dot({ x: edge.a.x - frame.o.x, y: edge.a.y - frame.o.y }, frame.f);
      const sb = dot({ x: edge.b.x - frame.o.x, y: edge.b.y - frame.o.y }, frame.f);
      if (Math.abs(sb - sa) < 1) continue;
      if (!runs.has(id)) runs.set(id, { key, frame, idBase, u: dot({ x: edge.a.x - frame.o.x, y: edge.a.y - frame.o.y }, frame.r), pieces: [] });
      const lo = Math.min(sa, sb);
      const hi = Math.max(sa, sb);
      const soffit = soffitAt(e, config.concreteSlabThicknessMm);
      // (split where a wall ends part-way along it — each piece its wall; `cutStart` / `cutEnd` = that end is such a
      // cut, not the element's own end; the soffit interpolated)
      const spans = config.wallIndex ? config.wallIndex.spansOf(e, edge) : [{ a: edge.a, b: edge.b, s0: sa, s1: sb, wall: wallOn(key, config, e.index) }];
      for (const sp of spans) {
        // (in this run's own frame — the wall index measures along the flight, which an end-wall run is not)
        const q0 = sp.a ? dot({ x: sp.a.x - frame.o.x, y: sp.a.y - frame.o.y }, frame.f) : sp.s0;
        const q1 = sp.b ? dot({ x: sp.b.x - frame.o.x, y: sp.b.y - frame.o.y }, frame.f) : sp.s1;
        const p0 = Math.min(q0, q1);
        const p1 = Math.max(q0, q1);
        const at = (s) => soffit.front + (soffit.back - soffit.front) * ((s - lo) / (hi - lo || 1));
        runs.get(id).pieces.push({ element: e, s0: p0, s1: p1, top: finishedTop(e), concreteTop: e.topZ, below, flat: e.kind === 'landing', soffit: { front: at(p0), back: at(p1) }, wall: sp.wall, cutStart: p0 > lo + 1e-6, cutEnd: p1 < hi - 1e-6 });
      }
    }
  });
  // a side split where its wall changes (user request 2026-11-05 — walls on some steps only): every run one stretch
  // under one wall (or none); the first keeps the side's id (`${flight}-${side}`, the balustrade's / finish's ids and
  // the user's post edits), the next ones get `-s<k>`
  const out = [];
  for (const r of runs.values()) {
    r.pieces.sort((a, b) => a.s0 - b.s0);
    let seg = null;
    for (const p of r.pieces) {
      const wid = p.wall?.id ?? null;
      if (!seg || seg.wallId !== wid) {
        const k = out.filter((x) => x.key.flight === r.key.flight && x.key.side === r.key.side && !!x.end === !!r.idBase).length;
        const base = r.idBase || `${r.key.flight}-${r.key.side}`;
        seg = { key: r.key, frame: r.frame, u: r.u, pieces: [], wall: p.wall, wallId: wid, walled: !!p.wall && p.wall.type !== 'under', seg: k, end: !!r.idBase, id: `${base}${k ? `-s${k}` : ''}` };
        out.push(seg);
      }
      seg.pieces.push(p);
    }
  }
  return out.sort((a, b) => a.key.flight - b.key.flight || (a.key.side < b.key.side ? -1 : 1) || a.seg - b.seg);
}

/** A plan point of a run's line at s (on its side line, `offset` mm further out — negative = into the stair). */
export function runPoint(run, s, offset = 0) {
  const out = run.key.side === 'left' ? -1 : 1;
  const u = run.u + out * offset;
  return { x: run.frame.o.x + run.frame.f.x * s + run.frame.r.x * u, y: run.frame.o.y + run.frame.f.y * s + run.frame.r.y * u };
}

/** The run's outward plan normal (away from the stair). */
export function runOutward(run) {
  const k = run.key.side === 'left' ? -1 : 1;
  return { x: run.frame.r.x * k, y: run.frame.r.y * k };
}
