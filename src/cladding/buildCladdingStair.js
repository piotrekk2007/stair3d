// The one orchestrator of the module "Schody na beton" (docs/architecture/CONCRETE_CLADDING_MODULE.md): config →
// the measured concrete → the wooden cladding on it → findings. Pure (no Three.js — claddingRenderer.js draws the
// result). Independent of the self-supporting geometry/buildStaircase.js.

import { sanitizeCladdingConfig } from './schema.js';
import { buildConcreteModel } from './concreteModel.js';
import { buildCladdingModel } from './claddingModel.js';
import { buildWalls, buildSlab } from './surroundingsModel.js';

export function buildCladdingStair(rawConfig) {
  const config = sanitizeCladdingConfig(rawConfig);
  const concrete = buildConcreteModel(config);
  const cladding = buildCladdingModel(concrete, config);
  const totalRise = concrete.exit.rawSlabTopZ + config.floorFinishTopMm - config.floorFinishBottomMm;
  // the surroundings (stage 3): walls along the flights, the slab above with its opening
  const walls = buildWalls(concrete, config);
  const slab = buildSlab(concrete, cladding, config);
  return { config, concrete, cladding, walls, slab, totalRise, diagnostics: [...cladding.diagnostics] };
}
