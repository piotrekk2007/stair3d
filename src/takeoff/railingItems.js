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
import { RAILING_WALL_BRACKET_SPACING_MM } from '../geometry/railingSolver.js';
import { sideShort } from '../util/sideNames.js';

const MM3_TO_M3 = 1 / 1_000_000_000;
export const RAILING_HANDRAIL_MATERIAL_ID = 'railing-handrail';
export const RAILING_BALUSTER_MATERIAL_ID = 'railing-baluster';
export const RAILING_BASERAIL_MATERIAL_ID = 'railing-baserail';
export const RAILING_GLASS_MATERIAL_ID = 'railing-glass';
export const RAILING_GLASS_FIXING_MATERIAL_ID = 'railing-glass-fixing';

// Glass balustrade (railingGlass.js): one item per pane — the blank (the rectangle it is cut from) is what is
// ordered and priced per m², the net area is the pane itself; plus one item per section for its fixings.
function glassItems(section, config, wasteFactors) {
  if (!section.glassPanes?.length) return [];
  const label = section.glass?.label || 'VSG';
  const items = section.glassPanes.map((pane, k) =>
    createTakeoffItem({
      itemId: `railing-${pane.id}`,
      elementType: ELEMENT_TYPES.GLASS_PANE,
      sourceElementId: `railing:${section.id}:glass:${k}`,
      material: `Szkło ${label}`,
      materialId: RAILING_GLASS_MATERIAL_ID,
      quantity: 1,
      unit: 'szt',
      nominalDimensions: { lengthMm: pane.widthMm, widthMm: pane.blank.heightMm, thicknessMm: pane.thicknessMm, netAreaMm2: pane.areaMm2 },
      calculatedDimensions: { lengthMm: pane.widthMm, widthMm: pane.blank.heightMm, thicknessMm: pane.thicknessMm },
      catalogStock: null,
      netVolume: (pane.areaMm2 * pane.thicknessMm) / 1e9,
      netArea: pane.areaMm2 / 1e6,
      stockVolume: null,
      stockArea: (pane.blank.widthMm * pane.blank.heightMm) / 1e6,
      wasteFactor: wasteFactorFor(ELEMENT_TYPES.GLASS_PANE, RAILING_GLASS_MATERIAL_ID, wasteFactors),
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: [
        `Tafla ${k + 1} (${sideLabel(section.side, config)}, odcinek ${section.id}): ${label}, prostokąt ${Math.round(pane.blank.widthMm)} × ${Math.round(pane.blank.heightMm)} mm, kształt i otwory w DXF balustrady; ${pane.fixings.length} ${pane.fixings[0]?.kind === 'rotule' ? 'rotul(e)' : 'uchwyt(y)'}.`,
      ],
    })
  );
  const byKind = new Map();
  for (const f of section.glassPanes.flatMap((p) => p.fixings)) byKind.set(f.kind, (byKind.get(f.kind) || 0) + 1);
  for (const [kind, count] of byKind) {
    items.push(
      createTakeoffItem({
        itemId: `railing-${section.id}-glass-${kind}`,
        elementType: ELEMENT_TYPES.GLASS_FIXING,
        sourceElementId: `railing:${section.id}:glassFixings:${kind}`,
        material: kind === 'rotule' ? 'Rotula (mocowanie punktowe szkła)' : 'Uchwyt szyby (do słupka)',
        materialId: RAILING_GLASS_FIXING_MATERIAL_ID,
        quantity: count,
        unit: 'szt',
        nominalDimensions: {},
        calculatedDimensions: {},
        catalogStock: null,
        netVolume: 0,
        netArea: 0,
        stockVolume: 0,
        stockArea: 0,
        wasteFactor: wasteFactorFor(ELEMENT_TYPES.GLASS_FIXING, RAILING_GLASS_FIXING_MATERIAL_ID, wasteFactors),
        optional: true,
        status: TAKEOFF_ITEM_STATUS.OK,
        notes: [`Mocowania szkła (${sideLabel(section.side, config)}, odcinek ${section.id}) — typ i wielkość wg producenta, do weryfikacji.`],
      })
    );
  }
  return items;
}

// zewn. / wewn. — an S: lewa / prawa (util/sideNames.js)
const sideLabel = (side, config) => sideShort(side, config);

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
              ? `Poręcz GIĘTA ${sideLabel(section.side, config)} (odcinek ${section.id}), bieg ${r + 1} — jeden element wygięty w pionie/rzucie, długość po osi 3D; przekrój ${shape === 'round' ? `Ø ${widthMm}` : `${widthMm} × ${heightMm}`} mm (rozwinięcie w DXF balustrady).`
              : `Poręcz ${sideLabel(section.side, config)} (odcinek ${section.id}), bieg ${r + 1}, element ${p + 1} — prosty odcinek o prawdziwej długości 3D; przekrój ${shape === 'round' ? `Ø ${widthMm}` : `${widthMm} × ${heightMm}`} mm.`,
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
      notes: [`Podporęcz ${sideLabel(section.side, config)} (odcinek ${section.id}), element ${p + 1} — na górnej krawędzi wangi wpuszczanej, tralki wchodzą w nią; przekrój ${widthMm} × ${heightMm} mm.`],
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
        notes: [`Lista cięcia: tralka ${shape === 'round' ? `okrągła Ø ${size}` : `kwadratowa ${size} × ${size}`} mm, długość ${lengthMm} mm × ${count} szt. — balustrada ${sideLabel(section.side, config)} (odcinek ${section.id}). Objętości są sumą dla wszystkich sztuk.`],
      });
    });
}

/**
 * @param {import('../geometry/railingSolver.js').RailingModel|null|undefined} railingModel
 * @param {Object} config  full config (railingBalusterShape/-SizeMm are read from it)
 * @param {Object} [wasteFactors]
 */
// Wall brackets of the wall handrails (railingSolver.js buildWallRail): one item per section, by the piece — a
// fitting, not priced by default (like the joint connectors).
export const RAILING_WALL_BRACKET_MATERIAL_ID = 'railing-wall-bracket';
function wallBracketItems(section, config) {
  const count = section.runs.filter((r) => r.wallRail).reduce((n, r) => n + (r.brackets?.length || 0), 0);
  if (!count) return [];
  return [
    createTakeoffItem({
      itemId: `railing-${section.id}-wall-brackets`,
      elementType: ELEMENT_TYPES.HANDRAIL,
      sourceElementId: `railing:${section.id}:wall-brackets`,
      material: 'Wspornik poręczy ściennej',
      materialId: RAILING_WALL_BRACKET_MATERIAL_ID,
      quantity: count,
      unit: 'szt',
      nominalDimensions: {},
      calculatedDimensions: {},
      catalogStock: null,
      netVolume: 0,
      netArea: 0,
      stockVolume: 0,
      stockArea: 0,
      wasteFactor: 0,
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: [`Wsporniki poręczy przyściennej ${sideLabel(section.side, config)} (odcinek ${section.id}): ${count} szt., co maks. ${config.railingWallBracketSpacingMm ?? RAILING_WALL_BRACKET_SPACING_MM} mm — dobór i mocowanie do ściany DO WERYFIKACJI.`],
    }),
  ];
}

/**
 * The handrail lying on the low wall above a concrete flight (geometry/concreteStair.js capRails): one item per straight
 * piece, like the balustrade's handrail (same material, priced per metre).
 */
export function buildWallCapRailItems(concrete, config, wasteFactors = {}) {
  const items = [];
  (concrete?.capRails || []).forEach((run, r) => {
    const { widthMm, heightMm, shape } = run;
    for (let k = 1; k < run.points.length; k++) {
      const a = run.points[k - 1];
      const b = run.points[k];
      const lengthMm = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (!(lengthMm > 1)) continue;
      const volume = sectionArea(shape, widthMm, heightMm) * lengthMm * MM3_TO_M3;
      items.push(
        createTakeoffItem({
          itemId: `wallcap-${run.side}-${r}-handrail-${k - 1}`,
          elementType: ELEMENT_TYPES.HANDRAIL,
          sourceElementId: `wallcap:${run.side}:${r}:${k - 1}`,
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
          notes: [`Poręcz ${run.mount === 'wall' ? 'przy ścianie (na uchwytach)' : 'na murku'} nad biegiem betonowym (${sideLabel(run.side, config)}), odcinek ${k} — prosty element o prawdziwej długości 3D; przekrój ${shape === 'round' ? `Ø ${widthMm}` : `${widthMm} × ${heightMm}`} mm.`],
        })
      );
    }
    // its brackets (by the piece, like the wall handrail's)
    const count = run.brackets?.length || 0;
    if (count) {
      items.push(
        createTakeoffItem({
          itemId: `wallcap-${run.side}-${r}-wall-brackets`,
          elementType: ELEMENT_TYPES.HANDRAIL,
          sourceElementId: `wallcap:${run.side}:${r}:wall-brackets`,
          material: 'Wspornik poręczy ściennej',
          materialId: RAILING_WALL_BRACKET_MATERIAL_ID,
          quantity: count,
          unit: 'szt',
          nominalDimensions: {},
          calculatedDimensions: {},
          catalogStock: null,
          netVolume: 0,
          netArea: 0,
          stockVolume: 0,
          stockArea: 0,
          wasteFactor: 0,
          optional: true,
          status: TAKEOFF_ITEM_STATUS.OK,
          notes: [`Wsporniki poręczy przy ścianie nad biegiem betonowym (${sideLabel(run.side, config)}): ${count} szt., co maks. ${config.railingWallBracketSpacingMm ?? RAILING_WALL_BRACKET_SPACING_MM} mm — dobór i mocowanie do ściany DO WERYFIKACJI.`],
        })
      );
    }
  });
  return items;
}

export function buildRailingItems(railingModel, config, wasteFactors = {}) {
  if (!railingModel || !railingModel.enabled) return [];
  return railingModel.sections.filter((s) => s.valid).flatMap((s) => [...handrailItems(s, config, wasteFactors), ...baseRailItems(s, config, wasteFactors), ...balusterItems(s, config, wasteFactors), ...glassItems(s, config, wasteFactors), ...wallBracketItems(s, config)]);
}

// The rods hung from the ceiling (geometry/ceilingRodsModel.js): one item per length (rounded to 1 mm) with the count —
// the cut list, like the balusters'; priced per piece (`railing-ceiling-rod`, the fixings included).
export const RAILING_CEILING_ROD_MATERIAL_ID = 'railing-ceiling-rod';
export function buildCeilingRodItems(model, config) {
  if (!model?.rods?.length) return [];
  const byLength = new Map();
  for (const rod of model.rods) {
    const lengthMm = Math.round(rod.lengthMm);
    byLength.set(lengthMm, [...(byLength.get(lengthMm) || []), rod]);
  }
  const d = model.diameterMm;
  return [...byLength.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lengthMm, rods]) => {
      const volume = Math.PI * (d / 2) ** 2 * lengthMm * rods.length * MM3_TO_M3;
      const treads = [...new Set(rods.map((r) => r.treadIndex + 1))];
      return createTakeoffItem({
        itemId: `ceiling-rods-${lengthMm}`,
        elementType: ELEMENT_TYPES.BALUSTER,
        sourceElementId: `ceiling-rods:${lengthMm}`,
        material: `Pręt stalowy Ø${d}`,
        materialId: RAILING_CEILING_ROD_MATERIAL_ID,
        quantity: rods.length,
        unit: 'szt',
        nominalDimensions: { lengthMm, crossSectionMm: d, shape: 'round' },
        calculatedDimensions: { lengthMm, crossSectionMm: d, shape: 'round' },
        catalogStock: null,
        netVolume: volume,
        netArea: 0,
        stockVolume: volume,
        stockArea: 0,
        wasteFactor: 0,
        optional: true,
        status: TAKEOFF_ITEM_STATUS.OK,
        notes: [`Pręty od sufitu (${sideLabel(model.side, config)}): ${rods.length} szt. × ${lengthMm} mm (od spodu stopnia do sufitu), stopnie ${treads.join(', ')}; ${rods[0].hung === 'opening' ? 'zawieszone w otworze — sufit piętra' : 'pod stropem'}. Otwór przelotowy Ø${Math.ceil(d + 2)} w stopniu (DXF stopni), mocowanie do sufitu i nakrętka — DO WERYFIKACJI.`],
      });
    });
}
