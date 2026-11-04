// The stair's SIDES unfolded (module "Schody na beton", stage 5 — docs/architecture/CONCRETE_CLADDING_MODULE.md): per
// flight and side (walking up), the pieces of the stair's edge along that line in walking order, each with its plan
// span along the flight (s from the flight frame's origin), its lateral position, its finished top and the height below
// it. Read by the skirting boards (on a walled side), the cover stringer (on an open side) and the balustrade. Pure.

import { edgeWallKey, edgeHasWall } from './surroundingsModel.js';
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
 * @returns {{key: {flight, side}, walled: boolean, frame, u, pieces: {element, s0, s1, top, concreteTop, below, flat,
 *   soffit: {front, back}}[]}[]}  one run per (flight, side) that has pieces; `top` = the finished tread top, `below` =
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
      const frame = frames.get(key.flight);
      if (!frame) continue;
      const sa = dot({ x: edge.a.x - frame.o.x, y: edge.a.y - frame.o.y }, frame.f);
      const sb = dot({ x: edge.b.x - frame.o.x, y: edge.b.y - frame.o.y }, frame.f);
      // (an edge square to the flight — a landing's back edge seen from the next flight is along it; one square to
      // its own flight adds no length)
      if (Math.abs(sb - sa) < 1) continue;
      const id = `${key.flight}:${key.side}`;
      if (!runs.has(id)) runs.set(id, { key, walled: edgeHasWall(e, edge, config), frame, u: dot({ x: edge.a.x - frame.o.x, y: edge.a.y - frame.o.y }, frame.r), pieces: [] });
      runs.get(id).pieces.push({ element: e, s0: Math.min(sa, sb), s1: Math.max(sa, sb), top: finishedTop(e), concreteTop: e.topZ, below, flat: e.kind === 'landing', soffit: soffitAt(e, config.concreteSlabThicknessMm) });
    }
  });
  const out = [...runs.values()];
  for (const r of out) r.pieces.sort((a, b) => a.s0 - b.s0);
  return out.sort((a, b) => a.key.flight - b.key.flight || (a.key.side < b.key.side ? -1 : 1));
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
