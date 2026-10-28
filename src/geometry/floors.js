// Floors: RAW and FINISHED (user decisions 2026-10-28). The ONE place for the heights between the raw slabs and the
// finished floors.
//
// The user gives the height measured on site between the RAW slabs (`rawStoreyHeightMm`) and the floor finish at the
// bottom and at the top (`floorFinishBottomMm`, `floorFinishTopMm`). The stair stands on the FINISHED bottom floor
// (z = 0 of every model) and arrives at the FINISHED top floor, so its rise is
//     totalRise = raw − bottom finish + top finish
// (copied into the config as AUTO — `floorDrivenFields`). The upper slab's RAW top is one top finish below the
// finished floor, its underside (the soffit, what the headroom is measured to) a slab thickness lower still; the
// opening's trim lies on the raw top. `rawStoreyHeightMm: null` = an older project: `totalRise` given as before.
//
// Pure: no Three.js.

const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

/** The floor finishes (mm): {bottom, top}. */
export function floorFinishes(config) {
  return { bottom: num(config?.floorFinishBottomMm), top: num(config?.floorFinishTopMm) };
}

/** The stair's rise between the finished floors from the raw height, or null when the raw height is not given. */
export function stairRiseFromRaw(config) {
  const raw = Number(config?.rawStoreyHeightMm);
  if (config?.rawStoreyHeightMm === null || config?.rawStoreyHeightMm === undefined || !(raw > 0)) return null;
  const { bottom, top } = floorFinishes(config);
  return raw - bottom + top;
}

/** The config with `totalRise` from the raw height (unchanged without one). */
export function withFloorRise(config) {
  const rise = stairRiseFromRaw(config);
  return rise === null || rise === config.totalRise ? config : { ...config, totalRise: rise };
}

/** The config fields derived here (AUTO in the panel). */
export function floorDrivenFields(config) {
  return stairRiseFromRaw(config) === null ? [] : ['totalRise'];
}

/** The upper slab's RAW top (z, mm): the finished floor less the top finish. */
export function rawSlabTopZ(config) {
  return (Number(config?.totalRise) || 0) - floorFinishes(config).top;
}

/** The upper slab's underside — the soffit the headroom is measured to (z, mm). */
export function slabSoffitZ(config) {
  return rawSlabTopZ(config) - (Number(config?.ceilingThickness) || 0);
}
