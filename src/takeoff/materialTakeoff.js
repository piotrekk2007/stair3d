// MATERIAL TAKEOFF LAYER — computes a bill-of-quantities from the already-solved constructional
// model (TreadModel[]/RiserModel[]/StringerModel/PostModel[]). Pure data in, pure data out:
// zero Three.js, zero geometry solving of its own (every quantity comes from a model another
// layer already built — see src/geometry/treadSolver.js/riserSolver.js/stringerSolver.js/
// postSolver.js), and zero cost calculation (see pricing.js — a deliberately separate layer,
// so a price change never touches these quantities and a geometry change never touches prices).
//
// Grouping: one TakeoffItem per (element type, subtype) — e.g. "tread-straight" aggregates
// every straight tread into one purchasable line, rather than one line per individual tread.
// Winder treads are still aggregated (their dimensions genuinely vary tread-to-tread — see
// planLayout.js), so a winder group's `dimensions` reports AVERAGES with `netArea`/`netVolume`
// summed from the real, individual per-tread polygon area (never a nominal formula) — the
// averages are honest approximations for a cutlist, the totals are exact.

import { signedPolygonArea } from '../geometry/pathUtils.js';
import { createTakeoffItem } from './takeoffTypes.js';
import { wasteFactorFor } from './wasteFactors.js';

const MM2_TO_M2 = 1 / 1_000_000;
const MM3_TO_M3 = 1 / 1_000_000_000;

const TREAD_LABELS = Object.freeze({
  straight: 'Stopnie proste',
  winder: 'Stopnie zabiegowe',
  landing: 'Podesty',
});

// --- Treads (also covers "podesty" — a landing tread IS a tread of type 'landing') -----------

function buildTreadItems(treadModels, config, wasteFactors) {
  const groups = new Map(); // type -> { count, areaMm2, volumeMm3, widthSumMm, depthSumMm, thicknessMm }
  for (const t of treadModels) {
    const areaMm2 = Math.abs(signedPolygonArea(t.outline));
    const volumeMm3 = areaMm2 * t.thickness;
    const avgWidthMm = (t.widths.atFront + t.widths.atBack) / 2;
    const avgDepthMm = avgWidthMm > 0 ? areaMm2 / avgWidthMm : 0;

    const g = groups.get(t.type) || { count: 0, areaMm2: 0, volumeMm3: 0, widthSumMm: 0, depthSumMm: 0, thicknessMm: t.thickness };
    g.count += 1;
    g.areaMm2 += areaMm2;
    g.volumeMm3 += volumeMm3;
    g.widthSumMm += avgWidthMm;
    g.depthSumMm += avgDepthMm;
    groups.set(t.type, g);
  }

  const items = [];
  for (const [type, g] of groups) {
    items.push(
      createTakeoffItem({
        itemId: `tread-${type}`,
        type: 'tread',
        subtype: type,
        label: TREAD_LABELS[type] || `Stopnie (${type})`,
        dimensions: {
          avgWidthMm: g.widthSumMm / g.count,
          avgDepthMm: g.depthSumMm / g.count,
          thicknessMm: g.thicknessMm,
        },
        quantity: g.count,
        quantityUnit: 'szt',
        netArea: g.areaMm2 * MM2_TO_M2,
        netVolume: g.volumeMm3 * MM3_TO_M3,
        material: config.timberGrade,
        wasteFactor: wasteFactorFor('tread', wasteFactors),
        optional: false,
      })
    );
  }
  return items;
}

// --- Stringers (wangi) -------------------------------------------------------------------------

const STRINGER_LABELS = Object.freeze({ outer: 'Wanga zewnętrzna', inner: 'Wanga wewnętrzna' });

function buildStringerItems(stringerModels, config, wasteFactors) {
  return ['outer', 'inner'].map((side) => {
    const model = stringerModels[side];
    const totalLengthMm = model.segments.reduce((sum, seg) => sum + seg.referenceLine.length, 0);
    const areaMm2 = totalLengthMm * config.stringerHeight; // face area: length x board height
    const volumeMm3 = areaMm2 * config.stringerThickness;

    return createTakeoffItem({
      itemId: `stringer-${side}`,
      type: 'stringer',
      subtype: side,
      label: STRINGER_LABELS[side],
      dimensions: {
        totalLengthMm,
        heightMm: config.stringerHeight,
        thicknessMm: config.stringerThickness,
        boardCount: model.segments.length,
      },
      quantity: model.segments.length,
      quantityUnit: 'szt',
      netArea: areaMm2 * MM2_TO_M2,
      netVolume: volumeMm3 * MM3_TO_M3,
      material: config.timberGrade,
      wasteFactor: wasteFactorFor('stringer', wasteFactors),
      optional: false,
    });
  });
}

// --- Risers (podstopnie) — optional: only produced when hasRiserBoards is on -------------------

function buildRiserItems(riserModels, config, wasteFactors) {
  if (!config.hasRiserBoards || !riserModels || riserModels.length === 0) return [];

  let panelCount = 0;
  let areaMm2 = 0;
  let volumeMm3 = 0;
  let widthSumMm = 0;
  let heightSumMm = 0;

  for (const r of riserModels) {
    const heightMm = r.elevation.top - r.elevation.bottom;
    for (const panel of r.panels) {
      panelCount += 1;
      const panelAreaMm2 = panel.width * heightMm;
      areaMm2 += panelAreaMm2;
      volumeMm3 += panelAreaMm2 * r.thickness;
      widthSumMm += panel.width;
      heightSumMm += heightMm;
    }
  }
  if (panelCount === 0) return [];

  return [
    createTakeoffItem({
      itemId: 'riser-board',
      type: 'riser',
      subtype: 'riser-board',
      label: 'Podstopnie',
      dimensions: {
        avgWidthMm: widthSumMm / panelCount,
        avgHeightMm: heightSumMm / panelCount,
        thicknessMm: riserModels[0].thickness,
      },
      quantity: panelCount,
      quantityUnit: 'szt',
      netArea: areaMm2 * MM2_TO_M2,
      netVolume: volumeMm3 * MM3_TO_M3,
      material: 'Sklejka/płyta MDF', // panel material, not structural timber — distinct from treads/stringers/posts
      wasteFactor: wasteFactorFor('riser', wasteFactors),
      optional: true, // conditional on config.hasRiserBoards — "opcjonalny element konstrukcyjny"
    }),
  ];
}

// --- Posts (słupy) — newel posts always present; corner posts optional -------------------------

function postGroupItem(itemId, subtype, label, posts, config, wasteFactors, optional) {
  if (posts.length === 0) return null;
  const totalVolumeMm3 = posts.reduce((sum, p) => sum + p.size * p.size * (p.elevation.top - p.elevation.bottom), 0);
  const avgHeightMm = posts.reduce((sum, p) => sum + (p.elevation.top - p.elevation.bottom), 0) / posts.length;

  return createTakeoffItem({
    itemId,
    type: 'post',
    subtype,
    label,
    dimensions: { crossSectionMm: config.postSize, avgHeightMm },
    quantity: posts.length,
    quantityUnit: 'szt',
    netArea: 0,
    netVolume: totalVolumeMm3 * MM3_TO_M3,
    material: config.timberGrade,
    wasteFactor: wasteFactorFor('post', wasteFactors),
    optional,
  });
}

function buildPostItems(postModels, config, wasteFactors) {
  const newels = postModels.filter((p) => p.kind === 'start' || p.kind === 'end');
  const corners = postModels.filter((p) => p.kind === 'corner');
  return [
    postGroupItem('post-newel', 'newel', 'Słupki początkowy/końcowy', newels, config, wasteFactors, false),
    // Corner posts only exist when config.hasCornerPost is on (see postSolver.js) — "opcjonalny
    // element konstrukcyjny": when the config disables them, postModels simply contains none,
    // so this item is naturally absent rather than reported with quantity 0.
    postGroupItem('post-corner', 'corner', 'Słupy narożne (konstrukcyjne)', corners, config, wasteFactors, true),
  ].filter(Boolean);
}

// --- Aggregator ----------------------------------------------------------------------------

/**
 * @param {Object} models
 * @param {import('../geometry/treadSolver.js').TreadModel[]} models.treadModels
 * @param {import('../geometry/riserSolver.js').RiserModel[]} models.riserModels
 * @param {{outer, inner}} models.stringerModels
 * @param {import('../geometry/postSolver.js').PostModel[]} models.postModels
 * @param {Object} config  Full config (post riserHeight merge) — read-only, used for material/
 *   thickness/hasRiserBoards, never mutated.
 * @param {{wasteFactors?: Partial<import('./wasteFactors.js').DEFAULT_WASTE_FACTORS>}} [options]
 * @returns {import('./takeoffTypes.js').TakeoffItem[]}  Cost fields are all null — see pricing.js.
 */
export function computeMaterialTakeoff({ treadModels, riserModels, stringerModels, postModels }, config, options = {}) {
  const wasteFactors = options.wasteFactors || {};
  return [
    ...buildTreadItems(treadModels, config, wasteFactors),
    ...buildStringerItems(stringerModels, config, wasteFactors),
    ...buildRiserItems(riserModels, config, wasteFactors),
    ...buildPostItems(postModels, config, wasteFactors),
  ];
}
