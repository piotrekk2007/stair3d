// The one orchestrator of the module "Schody na beton" (docs/architecture/CONCRETE_CLADDING_MODULE.md): config →
// the measured concrete → the wooden cladding on it → findings. Pure (no Three.js — claddingRenderer.js draws the
// result). Independent of the self-supporting geometry/buildStaircase.js.

import { sanitizeCladdingConfig } from './schema.js';
import { buildConcreteModel } from './concreteModel.js';
import { buildCladdingModel } from './claddingModel.js';
import { buildWalls, buildSlab } from './surroundingsModel.js';
import { buildFinishBoards } from './finishModel.js';
import { buildBalustrade } from './balustradeModel.js';
import { withGapWalls, buildSideWalls } from './sideWallsModel.js';
import { buildCladdingLed } from './ledModel.js';

export function buildCladdingStair(rawConfig) {
  const config = sanitizeCladdingConfig(rawConfig);
  const concrete = buildConcreteModel(config);
  // (the wall between two flights set apart walls their facing sides — the cladding, skirting and balustrade see it)
  const cfg = withGapWalls(concrete, config);
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
  // the LED lighting (under the noses, in the skirting, under the handrail)
  built.led = buildCladdingLed(built, cfg);
  built.diagnostics = [...cladding.diagnostics, ...built.balustrade.diagnostics];
  return built;
}
