// Balustrade (poręcz + tralki) -> MaterialTakeoffItem[]. Derived ONLY from the solved RailingModel
// (geometry/railingSolver.js) — the same numbers the 3D view draws — never from a mesh. End posts are not
// here: they are ordinary PostModels, so materialTakeoff.js already counts (and the post price list
// prices) them like any other post.
//
//  * HANDRAIL: one item per straight piece (a cut list: each piece is one board, cut to its true 3D length;
//    the mitre/angle waste is the waste factor's job, not a separate number).
//  * BALUSTER: one item per (section, length rounded to 1 mm) with a `quantity` — this IS the cut list of the
//    balusters: on an overlay wanga their heights differ tread by tread. Volumes on such an item are totals.
//
// Pricing is by material id (pricing.js): 'railing-baluster' per piece, 'railing-handrail' per running metre.

import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';
import { wasteFactorFor } from './wasteFactors.js';

const MM3_TO_M3 = 1 / 1_000_000_000;
export const RAILING_HANDRAIL_MATERIAL_ID = 'railing-handrail';
export const RAILING_BALUSTER_MATERIAL_ID = 'railing-baluster';
export const RAILING_BASERAIL_MATERIAL_ID = 'railing-baserail';

const sideLabel = (side) => (side === 'outer' ? 'zewn.' : 'wewn.');

function sectionArea(shape, a, b) {
  return shape === 'round' ? (Math.PI * a * a) / 4 : a * b;
}

function handrailItems(section, config, wasteFactors) {
  const items = [];
  const { shape, widthMm, heightMm } = section.handrail;
  section.runs.forEach((run, r) => {
    // A BENT run (railingSolver.js smoothRun) is ONE piece of handrail (bent/laminated to shape), however densely its
    // curve is sampled into chords — one item with its true length along the axis.
    const pieces = run.bent ? [{ lengthMm: run.pieces.reduce((sum, piece) => sum + piece.lengthMm, 0), bent: true }] : run.pieces;
    pieces.forEach((piece, p) => {
      const lengthMm = piece.lengthMm;
      const volume = sectionArea(shape, widthMm, heightMm) * lengthMm * MM3_TO_M3;
      items.push(
        createTakeoffItem({
          itemId: `railing-${section.id}-handrail-${r}-${p}`,
          elementType: ELEMENT_TYPES.HANDRAIL,
          sourceElementId: `railing:${section.id}:handrail:${r}-${p}`,
          material: 'Poręcz',
          materialId: RAILING_HANDRAIL_MATERIAL_ID,
          quantity: 1,
          unit: 'szt',
          nominalDimensions: { lengthMm, widthMm, heightMm, shape },
          calculatedDimensions: { lengthMm, widthMm, heightMm, shape },
          catalogStock: null,
          netVolume: volume,
          netArea: 0,
          stockVolume: volume,
          stockArea: 0,
          wasteFactor: wasteFactorFor(ELEMENT_TYPES.HANDRAIL, RAILING_HANDRAIL_MATERIAL_ID, wasteFactors),
          optional: true,
          status: TAKEOFF_ITEM_STATUS.OK,
          notes: [
            piece.bent
              ? `Poręcz GIĘTA ${sideLabel(section.side)} (odcinek ${section.id}), bieg ${r + 1} — jeden element wygięty w pionie/rzucie, długość po osi 3D; przekrój ${shape === 'round' ? `Ø ${widthMm}` : `${widthMm} × ${heightMm}`} mm (rozwinięcie w DXF balustrady).`
              : `Poręcz ${sideLabel(section.side)} (odcinek ${section.id}), bieg ${r + 1}, element ${p + 1} — prosty odcinek o prawdziwej długości 3D; przekrój ${shape === 'round' ? `Ø ${widthMm}` : `${widthMm} × ${heightMm}`} mm.`,
          ],
        })
      );
    });
  });
  return items;
}

// Base rail (podporęcz): one item per straight piece, like the handrail.
function baseRailItems(section, config, wasteFactors) {
  if (!section.baseRail?.pieces?.length) return [];
  const { widthMm, heightMm } = section.baseRail;
  return section.baseRail.pieces.map((piece, p) => {
    const lengthMm = piece.lengthMm;
    const volume = widthMm * heightMm * lengthMm * MM3_TO_M3;
    return createTakeoffItem({
      itemId: `railing-${section.id}-baserail-${p}`,
      elementType: ELEMENT_TYPES.BASERAIL,
      sourceElementId: `railing:${section.id}:baserail:${p}`,
      material: 'Podporęcz',
      materialId: RAILING_BASERAIL_MATERIAL_ID,
      quantity: 1,
      unit: 'szt',
      nominalDimensions: { lengthMm, widthMm, heightMm, shape: 'rect' },
      calculatedDimensions: { lengthMm, widthMm, heightMm, shape: 'rect' },
      catalogStock: null,
      netVolume: volume,
      netArea: 0,
      stockVolume: volume,
      stockArea: 0,
      wasteFactor: wasteFactorFor(ELEMENT_TYPES.BASERAIL, RAILING_BASERAIL_MATERIAL_ID, wasteFactors),
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: [`Podporęcz ${sideLabel(section.side)} (odcinek ${section.id}), element ${p + 1} — na górnej krawędzi wangi wpuszczanej, tralki wchodzą w nią; przekrój ${widthMm} × ${heightMm} mm.`],
    });
  });
}

function balusterItems(section, config, wasteFactors) {
  const byLength = new Map();
  for (const b of section.balusters) {
    const key = Math.round(b.heightMm);
    byLength.set(key, (byLength.get(key) || 0) + 1);
  }
  const shape = config.railingBalusterShape;
  const size = config.railingBalusterSizeMm;
  return [...byLength.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lengthMm, count]) => {
      const volume = sectionArea(shape, size, size) * lengthMm * count * MM3_TO_M3;
      return createTakeoffItem({
        itemId: `railing-${section.id}-baluster-${lengthMm}`,
        elementType: ELEMENT_TYPES.BALUSTER,
        sourceElementId: `railing:${section.id}:baluster:${lengthMm}`,
        material: 'Tralka',
        materialId: RAILING_BALUSTER_MATERIAL_ID,
        quantity: count,
        unit: 'szt',
        nominalDimensions: { lengthMm, crossSectionMm: size, shape },
        calculatedDimensions: { lengthMm, crossSectionMm: size, shape },
        catalogStock: null,
        netVolume: volume,
        netArea: 0,
        stockVolume: volume,
        stockArea: 0,
        wasteFactor: wasteFactorFor(ELEMENT_TYPES.BALUSTER, RAILING_BALUSTER_MATERIAL_ID, wasteFactors),
        optional: true,
        status: TAKEOFF_ITEM_STATUS.OK,
        notes: [`Lista cięcia: tralka ${shape === 'round' ? `okrągła Ø ${size}` : `kwadratowa ${size} × ${size}`} mm, długość ${lengthMm} mm × ${count} szt. — balustrada ${sideLabel(section.side)} (odcinek ${section.id}). Objętości są sumą dla wszystkich sztuk.`],
      });
    });
}

/**
 * @param {import('../geometry/railingSolver.js').RailingModel|null|undefined} railingModel
 * @param {Object} config  full config (railingBalusterShape/-SizeMm are read from it)
 * @param {Object} [wasteFactors]
 */
export function buildRailingItems(railingModel, config, wasteFactors = {}) {
  if (!railingModel || !railingModel.enabled) return [];
  return railingModel.sections.filter((s) => s.valid).flatMap((s) => [...handrailItems(s, config, wasteFactors), ...baseRailItems(s, config, wasteFactors), ...balusterItems(s, config, wasteFactors)]);
}
