// The concrete stair as ONE FLOOR of a building (stage 3 part 2 — linking floors, docs/architecture/
// CONCRETE_CLADDING_MODULE.md): the shape the self-supporting reference-stair check reads from the other floor
// (geometry/referenceStair.js buildReferenceModel — `fullConfig.totalRise / minHeadroom / referenceStair`,
// `treadModels[] {stepId, index, outline, elevation {top, bottom}}`, `ceilingFit.openingOutline`, `postModels`,
// `root`). Heights from the FINISHED floor (the self-supporting frame): the module's z (from the raw floor) less the
// bottom floor finish. A tread's `elevation.bottom` = the concrete's underside under it (what a lower stair's headroom
// is measured to).

import { buildCladdingStair } from './buildCladdingStair.js';
import { parseCladdingProjectFile, CLADDING_PROJECT_TYPE } from './projectFile.js';
import { renderCladdingStair } from './claddingRenderer.js';

export { CLADDING_PROJECT_TYPE };

/** The concrete's underside under an element (the lowest point of the soffit as drawn — claddingRenderer.js). */
function undersideZ(e, slabMm) {
  const pitch = e.kind === 'step' ? Math.atan2(e.riseMm, e.goingMm) : 0;
  const t = slabMm / Math.cos(pitch);
  if (e.kind === 'step') return Math.max(0, e.bottomZ - t);
  if (e.kind === 'winder') return Math.max(0, (e.bottomZ + e.topZ) / 2 - t);
  return Math.max(0, e.topZ - t);
}

/**
 * @param {object} built  buildCladdingStair's result
 * @param {{withRoot?: boolean}} opts  root = the 3D stair (no walls / slab — the other project has its own)
 */
export function claddingAsFloor(built, { withRoot = false } = {}) {
  const { config, concrete, cladding } = built;
  const dz = -config.floorFinishBottomMm;
  const byIndex = new Map(concrete.elements.map((e) => [e.index, e]));
  const treadModels = cladding.treads.map((t) => ({
    stepId: `${t.kind}-${t.index}`,
    index: t.index,
    outline: t.outline,
    elevation: { top: t.topZ + dz, bottom: undersideZ(byIndex.get(t.index), config.concreteSlabThicknessMm) + dz },
  }));
  let root = null;
  let slabMesh = null;
  let wallsMesh = null;
  if (withRoot) {
    // the stair, and apart from it its slab (always — a linked floor shows its ceiling, user request 2026-11-06) and
    // its walls: the room taken out of the root so the view switches them on their own
    root = renderCladdingStair({ ...built, config: { ...config, showSlab: true } }, { room: true });
    root.position.y = dz;
    const room = root.getObjectByName('Room');
    if (room) {
      root.remove(room);
      const slab = room.getObjectByName('Slab');
      if (slab) {
        room.remove(slab);
        slabMesh = slab;
        slabMesh.position.y += dz;
      }
      if (room.children.length) {
        wallsMesh = room;
        wallsMesh.position.y += dz;
      }
    }
  }
  return {
    kind: 'cladding',
    fullConfig: { totalRise: built.totalRise, minHeadroom: config.minHeadroomMm, referenceStair: config.referenceFloor ?? null },
    treadModels,
    ceilingFit: { openingOutline: built.slab?.opening ?? null },
    postModels: [],
    root,
    slabMesh,
    wallsMesh,
  };
}

/** A concrete project FILE (as saved) → the floor (for a self-supporting project's reference, or another concrete one). */
export function buildCladdingFloorFromFile(file) {
  const { config } = parseCladdingProjectFile(file);
  return claddingAsFloor(buildCladdingStair({ ...config, referenceFloor: null }), { withRoot: true });
}
