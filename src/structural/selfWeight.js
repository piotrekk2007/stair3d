// Self-weight of every element (docs/architecture/STRUCTURAL_CHECKS.md, check 1): mass = ρmean · V_net, weight =
// mass · g. The volumes are the takeoff's NET volumes (takeoff/materialTakeoff.js computeMaterialTakeoff) — the one
// place that knows how much material an element has (RULES.md #8) — so nothing here measures geometry. Pure.

import { ELEMENT_TYPES } from '../takeoff/takeoffTypes.js';
import { GRAVITY_M_S2, MDF_DENSITY, timberClass } from './timberClasses.js';

// Display order and labels of the weight categories.
export const WEIGHT_CATEGORIES = Object.freeze([
  { key: 'treads', label: 'Stopnie' },
  { key: 'landings', label: 'Podesty' },
  { key: 'risers', label: 'Podstopnie' },
  { key: 'stringers', label: 'Wangi' },
  { key: 'posts', label: 'Słupy konstrukcyjne' },
  { key: 'railingPosts', label: 'Słupki balustrady' },
  { key: 'handrail', label: 'Poręcz' },
  { key: 'balusters', label: 'Tralki' },
]);

/**
 * Density used for one weight category (the one rule, shared by the self-weight table and the member checks):
 * risers of MDF (takeoff settings) use MDF_DENSITY, everything else the structural class's ρmean.
 * @returns {{rho:number, label:string}}
 */
export function densityFor(key, config, options = {}) {
  if (key === 'risers' && options.riserMaterial === 'mdf') return { rho: MDF_DENSITY.rhomean, label: 'MDF' };
  const wood = timberClass(config.structuralMaterialClass);
  return { rho: wood.rhomean, label: wood.label };
}

function categoryOf(item, postKinds) {
  switch (item.elementType) {
    case ELEMENT_TYPES.TREAD:
      return 'treads';
    case ELEMENT_TYPES.LANDING:
      return 'landings';
    case ELEMENT_TYPES.RISER:
      return 'risers';
    case ELEMENT_TYPES.STRINGER:
    case ELEMENT_TYPES.STRINGER_HOUSING: // material REMOVED from a wanga — subtracted below
      return 'stringers';
    case ELEMENT_TYPES.POST:
      return postKinds[item.sourceElementId.replace(/^post:/, '')] === 'railing' ? 'railingPosts' : 'posts';
    case ELEMENT_TYPES.HANDRAIL:
      return 'handrail';
    case ELEMENT_TYPES.BALUSTER:
      return 'balusters';
    default:
      return null;
  }
}

/**
 * @typedef {Object} WeightCategory
 * @property {string} key
 * @property {string} label
 * @property {number} volumeM3
 * @property {number} densityKgM3
 * @property {string} densityLabel
 * @property {number} massKg
 * @property {number} weightKn
 * @property {number} count   physical pieces (quantity) contributing
 */

/**
 * @param {import('../takeoff/takeoffTypes.js').MaterialTakeoffItem[]} items  ungated takeoff items
 * @param {Object} config  full config (structuralMaterialClass)
 * @param {{postModels?: {postId:string, kind:string}[], riserMaterial?: 'oak'|'mdf'}} [options]
 * @returns {{categories: WeightCategory[], totalMassKg:number, totalWeightKn:number, missing:{itemId:string, label:string}[]}}
 */
export function computeSelfWeight(items, config, options = {}) {
  const postKinds = Object.fromEntries((options.postModels || []).map((p) => [p.postId, p.kind]));
  const densityOf = (key) => densityFor(key, config, options);

  const acc = new Map(WEIGHT_CATEGORIES.map((c) => [c.key, { volumeM3: 0, count: 0 }]));
  const missing = [];
  for (const item of items) {
    const key = categoryOf(item, postKinds);
    if (!key) continue;
    if (!Number.isFinite(item.netVolume)) {
      // e.g. a wanga whose geometry is invalid: no trustworthy volume exists, so it is reported, never guessed
      if (item.elementType !== ELEMENT_TYPES.STRINGER_HOUSING) missing.push({ itemId: item.itemId, label: key });
      continue;
    }
    const a = acc.get(key);
    if (item.elementType === ELEMENT_TYPES.STRINGER_HOUSING) {
      a.volumeM3 -= item.netVolume;
    } else {
      a.volumeM3 += item.netVolume;
      a.count += item.quantity || 1;
    }
  }

  const categories = WEIGHT_CATEGORIES.map(({ key, label }) => {
    const { volumeM3, count } = acc.get(key);
    const { rho, label: densityLabel } = densityOf(key);
    const massKg = Math.max(0, volumeM3) * rho;
    return { key, label, volumeM3: Math.max(0, volumeM3), densityKgM3: rho, densityLabel, massKg, weightKn: (massKg * GRAVITY_M_S2) / 1000, count };
  }).filter((c) => c.count > 0);

  const totalMassKg = categories.reduce((s, c) => s + c.massKg, 0);
  return { categories, totalMassKg, totalWeightKn: (totalMassKg * GRAVITY_M_S2) / 1000, missing };
}
