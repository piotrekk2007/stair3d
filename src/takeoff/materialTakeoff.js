// MATERIAL TAKEOFF LAYER — computes a bill-of-quantities from the already-solved constructional
// model. Pure data in, pure data out: zero Three.js, zero geometry solving of its own, zero
// cost calculation (see pricing.js — a deliberately separate layer).
//
// Dependency direction (never inverted):
//   StaircaseModel -> solved geometry -> construction models -> MATERIAL TAKEOFF -> cost
// Every quantity here comes from TreadModel / RiserModel / StringerModel +
// StringerConstructionGeometry / PostModel — never from a THREE.Mesh, a bounding box measured
// off rendered geometry, or an invented number.
//
// GRANULARITY — one item per PHYSICAL COMPONENT, not per element-type group: one tread = one
// item, one riser = one item (even a multi-panel winder fan — RiserModel already represents
// exactly one physical riser per stepId), one stringer SEGMENT = one item (a 14-step straight
// flight's stringer is ONE segment, hence ONE item — never one item per tread bearing), one
// post = one item, one cleat/housing = one item per tread. This maximizes traceability
// (sourceElementId is always unambiguous) — grouping/rollup for display is a UI/export concern
// (see export/*.js), never baked into this core model.

import { signedPolygonArea } from '../geometry/pathUtils.js';
import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';
import { wasteFactorFor } from './wasteFactors.js';
import { boundingRectAlong } from './stockGeometry.js';
import { profileLength } from '../geometry/polylineProfile.js';

const MM2_TO_M2 = 1 / 1_000_000;
const MM3_TO_M3 = 1 / 1_000_000_000;

const TIMBER_MATERIAL_ID = (grade) => `timber-${(grade || 'c24').toLowerCase()}`;
const RISER_MATERIAL_ID = 'sheet-plywood-mdf';
const RISER_MATERIAL_LABEL = 'Sklejka/płyta MDF';

// --- Treads (also covers "podesty" — a landing tread is elementType LANDING) -----------------

function buildTreadItem(t, config, wasteFactors) {
  const materialId = TIMBER_MATERIAL_ID(config.timberGrade);
  const netAreaMm2 = Math.abs(signedPolygonArea(t.outline));
  const netVolumeMm3 = netAreaMm2 * t.thickness;
  const { lengthMm, widthMm } = boundingRectAlong(t.outline, t.direction);
  const stockAreaMm2 = lengthMm * widthMm;
  const stockVolumeMm3 = stockAreaMm2 * t.thickness;
  const elementType = t.type === 'landing' ? ELEMENT_TYPES.LANDING : ELEMENT_TYPES.TREAD;

  const notes = [];
  if (t.type === 'winder') {
    notes.push('Wymiar zakupowy (stock) to prostokąt otaczający kontur zabiegowego stopnia, zorientowany wzdłuż kierunku wchodzenia — świadome przybliżenie zakupowe, nie rzeczywisty kształt.');
  }

  return createTakeoffItem({
    itemId: `tread-${t.stepId}`,
    elementType,
    sourceElementId: `tread:${t.stepId}`,
    material: config.timberGrade,
    materialId,
    quantity: 1,
    unit: 'szt',
    nominalDimensions: { footprintAreaMm2: netAreaMm2, thicknessMm: t.thickness },
    calculatedDimensions: { lengthMm, widthMm, thicknessMm: t.thickness },
    netVolume: netVolumeMm3 * MM3_TO_M3,
    netArea: netAreaMm2 * MM2_TO_M2,
    stockVolume: stockVolumeMm3 * MM3_TO_M3,
    stockArea: stockAreaMm2 * MM2_TO_M2,
    wasteFactor: wasteFactorFor(elementType, materialId, wasteFactors),
    optional: false,
    status: TAKEOFF_ITEM_STATUS.OK,
    notes,
  });
}

function buildTreadItems(treadModels, config, wasteFactors) {
  return treadModels.map((t) => buildTreadItem(t, config, wasteFactors));
}

// --- Risers (podstopnie) — one item per RiserModel (per stepId), including multi-panel winder fans ---

function buildRiserItem(riser, config, wasteFactors) {
  const heightMm = riser.elevation.top - riser.elevation.bottom;
  let netAreaMm2 = 0;
  for (const panel of riser.panels) netAreaMm2 += panel.width * heightMm;
  const netVolumeMm3 = netAreaMm2 * riser.thickness;

  // Each fan panel is already a flat rectangle (riserSolver.js) — stock == net at the
  // per-panel level (no shape waste beyond ordinary sheet-layout loss, which wasteFactor
  // already captures separately); a multi-panel riser's STOCK is simply the sum of its panels.
  const notes = riser.panels.length > 1 ? [`Podstopień wielopanelowy (wachlarz, ${riser.panels.length} paneli) — każdy panel jest już płaskim prostokątem; stock = net na poziomie panelu.`] : [];

  return createTakeoffItem({
    itemId: `riser-${riser.stepId}`,
    elementType: ELEMENT_TYPES.RISER,
    sourceElementId: `riser:${riser.stepId}`,
    material: RISER_MATERIAL_LABEL,
    materialId: RISER_MATERIAL_ID,
    quantity: 1,
    unit: 'szt',
    nominalDimensions: { panelCount: riser.panels.length, heightMm, thicknessMm: riser.thickness },
    calculatedDimensions: { panelCount: riser.panels.length, heightMm, thicknessMm: riser.thickness, totalWidthMm: riser.panels.reduce((s, p) => s + p.width, 0) },
    netVolume: netVolumeMm3 * MM3_TO_M3,
    netArea: netAreaMm2 * MM2_TO_M2,
    // Sheet material (plywood/MDF) is purchased and priced by AREA, never volume — stockVolume
    // stays null so createTakeoffItem's wasteAdjustedQuantity picks the area path (see
    // materialCatalog.js's note on RISER_MATERIAL_ID).
    stockVolume: null,
    stockArea: netAreaMm2 * MM2_TO_M2,
    wasteFactor: wasteFactorFor(ELEMENT_TYPES.RISER, RISER_MATERIAL_ID, wasteFactors),
    optional: true, // conditional on config.hasRiserBoards
    status: TAKEOFF_ITEM_STATUS.OK,
    notes,
  });
}

function buildRiserItems(riserModels, config, wasteFactors) {
  if (!config.hasRiserBoards || !riserModels || riserModels.length === 0) return [];
  return riserModels.map((r) => buildRiserItem(r, config, wasteFactors));
}

// --- Stringers (wangi) — one item per physical board (= one StringerConstructionGeometry segment) ---

function invalidStringerItem(side, segment, geo, config, materialId) {
  return createTakeoffItem({
    itemId: `stringer-${side}-${segment.id}`,
    elementType: ELEMENT_TYPES.STRINGER,
    sourceElementId: `stringer:${side}:${segment.id}`,
    constructionType: segment.constructionType,
    material: config.timberGrade,
    materialId,
    quantity: 1,
    unit: 'szt',
    nominalDimensions: {},
    calculatedDimensions: {},
    wasteFactor: 0,
    optional: false,
    status: TAKEOFF_ITEM_STATUS.INVALID,
    diagnostics: geo.diagnostics,
    notes: ['Geometria wangi jest nieprawidłowa (patrz diagnostics) — ilość i wymiary NIE zostały wyliczone, aby uniknąć wprowadzającej w błąd liczby.'],
  });
}

function buildStringerBoardItem(side, segment, geo, config, wasteFactors) {
  const materialId = TIMBER_MATERIAL_ID(config.timberGrade);
  if (segment.treadBearings.length === 0) return null; // no physical board needed — nothing to take off
  if (geo.diagnostics.some((d) => d.severity === 'ERROR')) return invalidStringerItem(side, segment, geo, config, materialId);

  // NET: the actual polygon area of the solved contour (already accounts for the notched top
  // on a 'cut' board, and for nothing extra on a 'closed' board — see stringerConstructionGeometry.js).
  const netAreaMm2 = Math.abs(signedPolygonArea(geo.outerContour.map((p) => ({ x: p.u, y: p.v }))));
  const netVolumeMm3 = netAreaMm2 * geo.thicknessMm;

  // STOCK: the plain rectangular board this would actually be cut FROM — length is the TRUE
  // physical length of geo.pitchProfile (arc length in the (u,v) plane, where u = plan
  // distance along the board and v = world elevation — its hypotenuse, not just its u-extent:
  // a raked board is measurably longer than its horizontal plan projection). NOT the bounding
  // box of geo.outerContour: the contour's top/bottom edges are now genuine PERPENDICULAR
  // offsets of the pitch profile (see stringerConstructionGeometry.js), so the contour itself
  // is a sheared quadrilateral whose axis-aligned bounding box doesn't equal true board length
  // either. WIDTH is the DESIGN parameter (boardWidthMm) — the offset distance IS the true
  // perpendicular board depth now, so this is no longer an approximation.
  const lengthMm = profileLength(geo.pitchProfile);
  const stockAreaMm2 = lengthMm * geo.boardWidthMm;
  const stockVolumeMm3 = stockAreaMm2 * geo.thicknessMm;

  const notes = [];
  if (geo.diagnostics.length > 0) notes.push(`Diagnostyka konstrukcyjna: ${geo.diagnostics.map((d) => d.ruleId).join(', ')}`);

  return createTakeoffItem({
    itemId: `stringer-${side}-${segment.id}`,
    elementType: ELEMENT_TYPES.STRINGER,
    sourceElementId: `stringer:${side}:${segment.id}`,
    constructionType: geo.constructionType,
    material: config.timberGrade,
    materialId,
    quantity: 1,
    unit: 'szt',
    nominalDimensions: { lengthMm, boardWidthMm: geo.boardWidthMm, thicknessMm: geo.thicknessMm, netAreaMm2 },
    calculatedDimensions: { lengthMm, boardWidthMm: geo.boardWidthMm, thicknessMm: geo.thicknessMm },
    netVolume: netVolumeMm3 * MM3_TO_M3,
    netArea: netAreaMm2 * MM2_TO_M2,
    stockVolume: stockVolumeMm3 * MM3_TO_M3,
    stockArea: stockAreaMm2 * MM2_TO_M2,
    wasteFactor: wasteFactorFor(ELEMENT_TYPES.STRINGER, materialId, wasteFactors),
    optional: false,
    status: TAKEOFF_ITEM_STATUS.OK,
    diagnostics: geo.diagnostics.filter((d) => d.severity === 'WARNING'),
    notes,
  });
}

// Cleats are separate, genuinely distinct physical pieces (small support blocks) — one item
// PER TREAD, never merged into the board item, and never created when cleats[] is empty
// (config.stringerCleatsEnabled === false, or constructionType !== 'cut' — see
// stringerConstructionGeometry.js). "If cleats are disabled: do not create them as hidden or
// assumed material" — an empty cleats[] on the model produces zero items here, truthfully.
function buildCleatItems(side, segment, geo, config, wasteFactors) {
  if (!geo.cleats || geo.cleats.length === 0) return [];
  const materialId = TIMBER_MATERIAL_ID(config.timberGrade);
  return geo.cleats.map((cleat) => {
    const netVolumeMm3 = (cleat.uEnd - cleat.uStart) * cleat.height * cleat.thickness;
    return createTakeoffItem({
      itemId: `stringer-${side}-${segment.id}-cleat-${cleat.treadIndex}`,
      elementType: ELEMENT_TYPES.STRINGER_CLEAT,
      sourceElementId: `stringer:${side}:${segment.id}:cleat-${cleat.treadIndex}`,
      constructionType: geo.constructionType,
      material: config.timberGrade,
      materialId,
      quantity: 1,
      unit: 'szt',
      nominalDimensions: { lengthMm: cleat.uEnd - cleat.uStart, heightMm: cleat.height, thicknessMm: cleat.thickness },
      calculatedDimensions: { lengthMm: cleat.uEnd - cleat.uStart, heightMm: cleat.height, thicknessMm: cleat.thickness },
      netVolume: netVolumeMm3 * MM3_TO_M3,
      netArea: 0,
      stockVolume: netVolumeMm3 * MM3_TO_M3,
      stockArea: 0,
      wasteFactor: wasteFactorFor(ELEMENT_TYPES.STRINGER_CLEAT, materialId, wasteFactors),
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
    });
  });
}

// Housings are informational — a FEATURE of the stringer board, never a separate purchasable
// item ("do not treat a housing as a separate board"). `netVolume` here reports the material
// REMOVED by the housing (useful for waste/scrap tracking), never a purchase quantity —
// materialId is null so pricing.js correctly leaves it unpriced.
function buildHousingItems(side, segment, geo) {
  if (!geo.housings || geo.housings.length === 0) return [];
  return geo.housings.map((housing) => {
    const removedVolumeMm3 = (housing.uEnd - housing.uStart) * (housing.topV - housing.bottomV) * housing.depth;
    return createTakeoffItem({
      itemId: `stringer-${side}-${segment.id}-housing-${housing.treadIndex}`,
      elementType: ELEMENT_TYPES.STRINGER_HOUSING,
      sourceElementId: `stringer:${side}:${segment.id}:housing-${housing.treadIndex}`,
      constructionType: geo.constructionType,
      material: 'n/a — cecha wangi, nie osobny materiał',
      materialId: null,
      quantity: 1,
      unit: 'szt',
      nominalDimensions: { lengthMm: housing.uEnd - housing.uStart, depthMm: housing.depth },
      calculatedDimensions: { lengthMm: housing.uEnd - housing.uStart, depthMm: housing.depth },
      netVolume: removedVolumeMm3 * MM3_TO_M3, // material REMOVED, not purchased
      netArea: 0,
      stockVolume: null,
      stockArea: null,
      wasteFactor: 0,
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: ['Informacyjne — wręg jest cechą geometrii wangi, nie osobnym elementem zakupowym. netVolume = materiał usunięty (do śledzenia odpadu), nie ilość do zakupu.'],
    });
  });
}

function buildStringerSideItems(side, stringerModel, constructionGeometries, config, wasteFactors) {
  const items = [];
  stringerModel.segments.forEach((segment, i) => {
    const geo = constructionGeometries[i];
    const board = buildStringerBoardItem(side, segment, geo, config, wasteFactors);
    if (board) items.push(board);
    if (board && board.status === TAKEOFF_ITEM_STATUS.OK) {
      items.push(...buildCleatItems(side, segment, geo, config, wasteFactors));
      items.push(...buildHousingItems(side, segment, geo));
    }
  });
  return items;
}

// --- Posts (słupy) — one item per physical post -------------------------------------------------

function buildPostItem(post, config, wasteFactors) {
  const materialId = TIMBER_MATERIAL_ID(config.timberGrade);
  const heightMm = post.elevation.top - post.elevation.bottom;
  const netVolumeMm3 = post.size * post.size * heightMm;
  const label = { start: 'Słupek początkowy', end: 'Słupek końcowy', corner: 'Słup narożny (konstrukcyjny)' }[post.kind] || post.kind;
  return createTakeoffItem({
    itemId: `post-${post.postId}`,
    elementType: ELEMENT_TYPES.POST,
    sourceElementId: `post:${post.postId}`,
    material: config.timberGrade,
    materialId,
    quantity: 1,
    unit: 'szt',
    nominalDimensions: { crossSectionMm: post.size, heightMm },
    calculatedDimensions: { crossSectionMm: post.size, heightMm },
    netVolume: netVolumeMm3 * MM3_TO_M3,
    netArea: 0,
    stockVolume: netVolumeMm3 * MM3_TO_M3, // already a plain rectangular prism — net === stock
    stockArea: 0,
    wasteFactor: wasteFactorFor(ELEMENT_TYPES.POST, materialId, wasteFactors),
    optional: post.kind === 'corner', // corner posts are conditional on config.hasCornerPost
    status: TAKEOFF_ITEM_STATUS.OK,
    notes: [label],
  });
}

function buildPostItems(postModels, config, wasteFactors) {
  return postModels.map((p) => buildPostItem(p, config, wasteFactors));
}

// --- Aggregator ----------------------------------------------------------------------------

/**
 * @param {Object} models
 * @param {import('../geometry/treadSolver.js').TreadModel[]} models.treadModels
 * @param {import('../geometry/riserSolver.js').RiserModel[]} models.riserModels
 * @param {{outer, inner}} models.stringerModels
 * @param {{outer: import('../geometry/stringerModel.js').StringerSegmentConstructionGeometry[], inner: [...]}} models.stringerConstruction
 * @param {import('../geometry/postSolver.js').PostModel[]} models.postModels
 * @param {Object} config  Full config (post riserHeight merge) — read-only, never mutated.
 * @param {{wasteFactors?: Object}} [options]
 * @returns {import('./takeoffTypes.js').MaterialTakeoffItem[]}  Cost fields are all null — see pricing.js.
 */
export function computeMaterialTakeoff({ treadModels, riserModels, stringerModels, stringerConstruction, postModels }, config, options = {}) {
  const wasteFactors = options.wasteFactors || {};
  return [
    ...buildTreadItems(treadModels, config, wasteFactors),
    ...buildRiserItems(riserModels, config, wasteFactors),
    ...buildStringerSideItems('outer', stringerModels.outer, stringerConstruction.outer, config, wasteFactors),
    ...buildStringerSideItems('inner', stringerModels.inner, stringerConstruction.inner, config, wasteFactors),
    ...buildPostItems(postModels, config, wasteFactors),
  ];
}
