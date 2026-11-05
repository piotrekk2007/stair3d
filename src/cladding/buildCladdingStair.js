// The one orchestrator of the module "Schody na beton" (docs/architecture/CONCRETE_CLADDING_MODULE.md): config →
// the measured concrete → the wooden cladding on it → findings. Pure (no Three.js — claddingRenderer.js draws the
// result). Independent of the self-supporting geometry/buildStaircase.js.

import { sanitizeCladdingConfig } from './schema.js';
import { buildConcreteModel } from './concreteModel.js';
import { buildCladdingModel } from './claddingModel.js';
import { buildWalls, buildSlab, resolveWalls } from './surroundingsModel.js';
import { buildFinishBoards } from './finishModel.js';
import { buildBalustrade } from './balustradeModel.js';
import { withGapWalls, buildSideWalls } from './sideWallsModel.js';
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

export function buildCladdingStair(rawConfig) {
  const sanitized = sanitizeCladdingConfig(rawConfig);
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
  // the finishing elements (stage 5): skirting boards, cover stringers, the balustrade with its decorative posts
  const finish = buildFinishBoards(concrete, cfg);
  const built = { config, concrete, cladding, walls, sideWalls, slab, totalRise, finish };
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
  return built;
}
