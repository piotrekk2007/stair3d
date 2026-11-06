// The one orchestrator of the module "Schody na beton" (docs/architecture/CONCRETE_CLADDING_MODULE.md): config →
// the measured concrete → the wooden cladding on it → findings. Pure (no Three.js — claddingRenderer.js draws the
// result). Independent of the self-supporting geometry/buildStaircase.js.

import { sanitizeCladdingConfig } from './schema.js';
import { buildConcreteModel, signedOnZoneLine } from './concreteModel.js';
import { buildCladdingModel, riserOn, riserThicknessOf } from './claddingModel.js';
import { buildWalls, buildSlab, resolveWalls } from './surroundingsModel.js';
import { buildFinishBoards } from './finishModel.js';
import { buildBalustrade } from './balustradeModel.js';
import { withGapWalls, buildSideWalls, joinSideWalls } from './sideWallsModel.js';
import { buildCladdingLed } from './ledModel.js';
import { buildOpeningTrim } from './openingTrimModel.js';
import { buildSideRuns } from './sideRuns.js';

/**
 * The concrete sizes behind the groups measured as FINISHED elements (user request 2026-11-05 — "gotowe stopnie": the
 * contractor's sizes of the treads / landings he wants to order): built once with the entered numbers as the concrete,
 * every element's finished minus concrete size is its offset (the nosing, a carpet riser, the side nosings, the finishes
 * on the first / last rise — additive, so one pass is exact) and the concrete = the entered − that offset: a step's
 * going (from its tread's depth) and width (from its length), a landing's depth, every element's rise (from its finished
 * rise). A winder zone's A / B and its edges stay measured on the walls / the dusza (as on the concrete).
 * @returns {object|null} `{[index]: {riseMm?, goingMm?, widthMm?, depthMm?}}`, null when no group is measured so
 */
export function concreteFromFinished(config) {
  if (!config.sequence.some((g) => g.measured === 'finished')) return null;
  const concrete = buildConcreteModel(config);
  const cfg = withGapWalls(concrete, config);
  cfg.wallIndex = resolveWalls(concrete, cfg);
  const cladding = buildCladdingModel(concrete, cfg);
  const tread = new Map(cladding.treads.map((t) => [t.index, t]));
  const height = new Map(cladding.heights.filter((h) => h.kind !== 'exit').map((h) => [h.index, h]));
  const out = {};
  for (const e of concrete.elements) {
    if (config.sequence[e.groupIndex]?.measured !== 'finished') continue;
    const t = tread.get(e.index);
    const h = height.get(e.index);
    const d = {};
    if (h && Number.isFinite(h.finishedRiseMm)) d.riseMm = e.riseMm - (h.finishedRiseMm - e.riseMm);
    if (t && e.kind === 'step' && !t.starter) {
      d.goingMm = e.goingMm - (t.depthMm - e.goingMm);
      d.widthMm = e.widthMm - (t.lengthMm - e.widthMm);
    }
    if (t && e.kind === 'landing' && config.sequence[e.groupIndex]?.depthMm) {
      const entered = config.sequence[e.groupIndex].depthMm;
      // (the landing's depth along its flight = its tread's extent across its grain)
      d.depthMm = entered - (t.depthMm - entered);
    }
    out[e.index] = d;
  }
  return out;
}

// the crossing of a line (p, q extended) with a polyline (its end pieces extended), nearest to `near`
function crossPolyline(p, q, path, near) {
  const d = { x: q.x - p.x, y: q.y - p.y };
  let best = null;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const u = (d.x * (p.y - a.y) - d.y * (p.x - a.x)) / den; // along the piece
    const lo = k === 1 ? -Infinity : 0;
    const hi = k === path.length - 1 ? Infinity : 1;
    if (u < lo - 1e-9 || u > hi + 1e-9) continue;
    const x = { x: a.x + e.x * u, y: a.y + e.y * u };
    const dd = Math.hypot(x.x - near.x, x.y - near.y);
    if (!best || dd < best.dd) best = { x, dd };
  }
  return best?.x ?? null;
}

/**
 * Where the nose of the winder whose front is the zone's edge `k` meets the wall and the dusza line: its concrete
 * front edge moved forward by the nosing + its riser board, crossed with the zone's paths. `{outer, inner}` plan points
 * (null where it misses), null without that winder.
 */
export function winderNose(concrete, config, zone, k) {
  const el = concrete.elements.find((e) => e.groupIndex === zone.groupIndex && e.kind === 'winder' && e.k === k);
  const front = el?.edges.find((e) => e.role === 'front');
  if (!front) return null;
  const l = Math.hypot(front.b.x - front.a.x, front.b.y - front.a.y) || 1;
  const n = { x: (front.b.y - front.a.y) / l, y: -(front.b.x - front.a.x) / l };
  const f = config.nosingFrontMm + (riserOn(el, config) ? riserThicknessOf(config) : 0);
  const p = { x: front.a.x + n.x * f, y: front.a.y + n.y * f };
  const q = { x: front.b.x + n.x * f, y: front.b.y + n.y * f };
  return { outer: crossPolyline(p, q, zone.outerPath, zone.edges[k].outer), inner: crossPolyline(p, q, zone.innerPath, zone.edges[k].inner) };
}

/**
 * A winder zone measured as FINISHED treads (user request 2026-11-05): its edges' numbers are where the finished
 * treads' NOSES meet the wall and the dusza line. A winder's nose line = its concrete front edge moved forward by the
 * nosing + its riser board, so it meets the walls elsewhere (by that offset / the angle); the concrete edges are moved
 * until the noses land on the measured numbers (a few rounds — the offset point depends on the edge's angle).
 * @returns {object[]} the sequence with the concrete edges (the user's numbers where nothing is finished)
 */
export function concreteWinderEdges(config) {
  const targets = config.sequence.map((g) => (g.kind === 'winders' && g.measured === 'finished' && g.edges?.some(Boolean) ? g.edges : null));
  if (!targets.some(Boolean)) return config.sequence;
  const seq = config.sequence.map((g) => (g.kind === 'winders' ? { ...g, edges: (g.edges || []).map((e) => (e ? { ...e } : e)) } : g));
  for (let round = 0; round < 6; round++) {
    const concrete = buildConcreteModel({ ...config, sequence: seq });
    let worst = 0;
    for (const zone of concrete.zones || []) {
      const want = targets[zone.groupIndex];
      if (!want) continue;
      for (let k = 1; k < zone.edges.length - 1; k++) {
        const t = want[k - 1];
        if (!t) continue;
        const noses = winderNose(concrete, config, zone, k);
        if (!noses) continue;
        const own = seq[zone.groupIndex].edges[k - 1] || (seq[zone.groupIndex].edges[k - 1] = {});
        for (const [which, path, field] of [
          ['outer', zone.outerPath, 'outerMm'],
          ['inner', zone.innerPath, 'innerMm'],
        ]) {
          if (!Number.isFinite(t[field])) continue;
          const x = noses[which];
          if (!x) continue;
          const err = t[field] - signedOnZoneLine(zone, which, x);
          // (kept within the line — a nose asked for where no edge can put it is reported by the zone's checks)
          const lo = signedOnZoneLine(zone, which, path[0]);
          const hi = signedOnZoneLine(zone, which, path[path.length - 1]);
          const next = Math.max(lo, Math.min(hi, (own[field] ?? t[field]) + err));
          worst = Math.max(worst, Math.abs(next - (own[field] ?? t[field])));
          own[field] = next;
        }
      }
    }
    if (worst < 0.05) break;
  }
  return seq;
}

export function buildCladdingStair(rawConfig) {
  const sanitized0 = sanitizeCladdingConfig(rawConfig);
  // (winder zones measured as finished: their concrete edges first — the rest of the conversion reads the zones)
  const winderSeq = concreteWinderEdges(sanitized0);
  const sanitized = winderSeq === sanitized0.sequence ? sanitized0 : { ...sanitized0, sequence: winderSeq };
  const derived = concreteFromFinished(sanitized);
  const config = derived ? { ...sanitized, derivedConcrete: derived } : sanitized;
  const concrete = buildConcreteModel(config);
  // (the wall between two flights set apart walls their facing sides — the cladding, skirting and balustrade see it)
  const cfg = withGapWalls(concrete, config);
  // (the walls placed along their sides in mm — every consumer splits the stair's sides where a wall ends)
  cfg.wallIndex = resolveWalls(concrete, cfg);
  const cladding = buildCladdingModel(concrete, cfg);
  const totalRise = concrete.exit.rawSlabTopZ + config.floorFinishTopMm - config.floorFinishBottomMm;
  // the surroundings (stage 3): walls along the flights, the slab above with its opening
  const walls = buildWalls(concrete, cfg);
  const slab = buildSlab(concrete, cladding, cfg);
  // the walls that follow the stair: above the steps to a height, under the flight, between flights set apart
  const sideWalls = buildSideWalls(concrete, cfg);
  // (the pieces meeting round a turn as one folded wall — the 3D draws those)
  const sideWallBodies = joinSideWalls(sideWalls, cfg.wallThicknessMm);
  // the finishing elements (stage 5): skirting boards, cover stringers, the balustrade with its decorative posts
  const finish = buildFinishBoards(concrete, cfg);
  const built = { config, concrete, cladding, walls, sideWalls, sideWallBodies, slab, totalRise, finish };
  built.balustrade = buildBalustrade(built, cfg);
  // the opening's trim („fajka”) along the chosen opening edges
  built.openingTrim = buildOpeningTrim(built, cfg);
  // (the antresola nosing mitred where a trim meets it — the trim model's corner rule, one place)
  for (const nz of cladding.exitNosing || []) {
    const o = built.openingTrim.exitNosingOutlines?.[nz.id];
    if (!o) continue;
    // (carried on to the corner where the opening is wider than the stair: its length along its grain anew)
    const us = o.map((p) => p.x * nz.grain.x + p.y * nz.grain.y);
    Object.assign(nz, { outline: o, mitred: true, lengthMm: Math.max(...us) - Math.min(...us) });
  }
  // the LED lighting (under the noses, in the skirting, under the handrail)
  built.led = buildCladdingLed(built, cfg);
  built.diagnostics = [...cladding.diagnostics, ...built.balustrade.diagnostics];
  // (the panel / the plan's wall mode: every side's stretches with their walls, the gap walls among them)
  built.sideRuns = buildSideRuns(concrete, cfg);
  built.gapWalls = cfg.gapWalls || [];
  // (every wall's stretch along its side, mm — the plan's wall ends)
  built.wallEntries = cfg.wallIndex.entries;
  // (a winder zone measured as finished treads: its edges' handles on the plan at the noses — what its numbers mean)
  built.winderNoses = {};
  for (const zone of concrete.zones || []) {
    if (config.sequence[zone.groupIndex]?.measured !== 'finished') continue;
    built.winderNoses[zone.groupIndex] = zone.edges.map((e, k) => (e.boundary ? null : winderNose(concrete, config, zone, k)));
  }
  return built;
}
