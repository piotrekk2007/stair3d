// MATERIAL TAKEOFF — core data shapes. Pure data, no geometry, no Three.js, no pricing logic.
//
// Dependency direction (never the other way around):
//   StaircaseModel -> solved geometry -> construction models -> MATERIAL TAKEOFF -> cost
// A MaterialTakeoffItem is ALWAYS derived from an already-solved construction model
// (TreadModel / RiserModel / StringerModel+StringerConstructionGeometry / PostModel) — never
// from a THREE.Mesh, a bounding box, or a guess. See materialTakeoff.js for the solver that
// builds these from those models.
//
// NET vs STOCK (see docs — this distinction is load-bearing, not decorative):
//   NET      = what the finished staircase geometrically contains (the actual polygon/volume).
//   STOCK    = what raw material must be purchased/prepared to produce that NET geometry —
//              always a plain, cuttable rectangular (or rectangular-prism) size, always >= NET.
// `nominalDimensions` holds the NET, finished dimensions; `calculatedDimensions` holds the
// derived STOCK/purchase dimensions — matching the task's own naming exactly.

export const ELEMENT_TYPES = Object.freeze({
  TREAD: 'TREAD',
  RISER: 'RISER',
  STRINGER: 'STRINGER',
  STRINGER_HOUSING: 'STRINGER_HOUSING',
  LANDING: 'LANDING',
  POST: 'POST',
  HANDRAIL: 'HANDRAIL', // one straight handrail piece (railingItems.js)
  BASERAIL: 'BASERAIL', // one straight base-rail (podporęcz) piece on a housed wanga (railingItems.js)
  BALUSTER: 'BALUSTER', // balusters of one length (quantity > 1) — the balusters' cut list
  SUPPORT: 'SUPPORT', // reserved — no solved model produces this yet; never fabricated
  OTHER: 'OTHER', // reserved — catch-all for a future element type, never fabricated today
});

// A takeoff item's own validity — distinct from a Diagnostic's severity, because an item can
// legitimately carry WARNING-level diagnostics (see the validation gate in index.js) while
// still being OK to quantify; UNSUPPORTED/INVALID specifically mean "no trustworthy quantity
// exists", which is a stronger statement than "there is something to warn about".
export const TAKEOFF_ITEM_STATUS = Object.freeze({
  OK: 'OK', // quantities were computed from valid geometry
  UNSUPPORTED: 'UNSUPPORTED', // this component exists conceptually but no model can quantify it yet
  INVALID: 'INVALID', // the source geometry itself is invalid (self-intersecting, degenerate, etc.)
});

/**
 * @typedef {Object} MaterialTakeoffItem
 * @property {string} itemId                Stable id within one takeoff run, e.g. "stringer-outer-outer-seg-0".
 * @property {keyof ELEMENT_TYPES} elementType
 * @property {string} sourceElementId       Traceability — the SAME id scheme as
 *                                            src/scene/traceability.js's geometrySourceId
 *                                            (e.g. "tread:step-3", "stringer:outer:outer-seg-0",
 *                                            "riser:step-3:panel-1", "post:post-start") — lets a
 *                                            future UI select a takeoff line and highlight the
 *                                            corresponding 2D/3D element (not implemented here).
 * @property {string|null} constructionType 'cut' | 'closed' | null (not construction-type-specific)
 * @property {string} material              Human-readable material label (e.g. "C24", "Sklejka/płyta MDF")
 * @property {string} materialId            Stable catalog key (e.g. 'timber-c24') — see materialCatalog.js;
 *                                            pricing/catalog lookups key on THIS, never on `material` free text.
 * @property {number} quantity              Discrete piece count (the purchase unit count).
 * @property {string} unit                  'szt' — the only unit `quantity` currently uses.
 * @property {Object} nominalDimensions     NET/finished dimensions — shape varies by elementType
 *                                            (e.g. {lengthMm, widthMm, thicknessMm} for a tread,
 *                                            {lengthMm, boardWidthMm, thicknessMm} for a stringer).
 * @property {Object} calculatedDimensions  STOCK/purchase dimensions — same shape family as
 *                                            nominalDimensions, always >= it in every dimension.
 * @property {number|null} netVolume        m³ — the actual finished/net volume (null if status != OK).
 * @property {number|null} netArea          m² — the actual finished/net surface area, 0 if not
 *                                            area-relevant for this elementType, null if status != OK.
 * @property {number|null} stockVolume      m³ — required rough-stock volume (>= netVolume).
 * @property {number|null} stockArea        m² — required rough-stock area (>= netArea).
 * @property {number} wasteFactor           Fraction (e.g. 0.1 = 10%) — see wasteFactors.js; a
 *                                            purchasing/manufacturing assumption, never a physical property.
 * @property {number|null} wasteAdjustedQuantity  stockVolume or stockArea (see `wasteAdjustedUnit`)
 *                                            multiplied by (1 + wasteFactor) — the actual amount
 *                                            to purchase. null if status != OK.
 * @property {'m3'|'m2'|null} wasteAdjustedUnit   Which measure `wasteAdjustedQuantity` is in.
 * @property {number|null} unitPrice        Filled in by pricing.js's applyPricing() — null until priced.
 * @property {string|null} priceUnit        'volume' | 'area' | 'piece'.
 * @property {string|null} currency
 * @property {number|null} calculatedCost   quantity/measure x unitPrice — see pricing.js.
 * @property {boolean} optional             True for config-conditional elements (riser boards,
 *                                            corner posts, housings) — absent entirely
 *                                            when the config disables them, never quantity 0.
 * @property {keyof TAKEOFF_ITEM_STATUS} status
 * @property {import('../diagnostics/diagnostic.js').Diagnostic[]} diagnostics  Any per-item
 *                                            validity issues (populated for UNSUPPORTED/INVALID,
 *                                            or carrying a WARNING even when status is OK).
 * @property {string[]} notes               Human-readable caveats (e.g. "purchasing
 *                                            approximation: winder bounding rectangle").
 * @property {CatalogStock|null} catalogStock  The nearest REAL orderable board for this item,
 *                                            per materialCatalog.js — null for element types
 *                                            that don't map onto a single-board catalog lookup
 *                                            (sheet goods bought/nested by area, informational
 *                                            housings, or a material with no catalog entry at
 *                                            all). See materialCatalog.js's roundUpToCatalogSize.
 */

/**
 * @typedef {Object} CatalogStock
 * @property {number|null} lengthMm      Smallest catalog length >= the computed requirement,
 *                                         or null if none is long enough.
 * @property {number|null} widthMm       Same, for width/board-depth. null if not applicable
 *                                         (e.g. a post has no separate "width").
 * @property {number|null} thicknessMm   Same, for thickness.
 * @property {boolean} exact             True only if EVERY dimension above already matched a
 *                                         catalog size exactly (no rounding needed anywhere).
 * @property {boolean} unsupported       True if ANY dimension exceeds every available catalog
 *                                         size — the part cannot be cut from one stock piece as
 *                                         specified; see the item's own `notes` for which
 *                                         dimension and by how much.
 */

const REQUIRED_FIELDS = ['itemId', 'elementType', 'sourceElementId', 'material', 'materialId', 'quantity', 'unit', 'nominalDimensions', 'calculatedDimensions', 'wasteFactor', 'optional', 'status'];

/**
 * @param {Partial<MaterialTakeoffItem>} fields
 * @returns {MaterialTakeoffItem}
 */
export function createTakeoffItem(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined) throw new Error(`createTakeoffItem: missing required field "${key}"`);
  }
  if (!ELEMENT_TYPES[fields.elementType]) throw new Error(`createTakeoffItem: unknown elementType "${fields.elementType}"`);
  if (!TAKEOFF_ITEM_STATUS[fields.status]) throw new Error(`createTakeoffItem: unknown status "${fields.status}"`);
  if (fields.status === TAKEOFF_ITEM_STATUS.OK && !(fields.wasteFactor >= 0)) {
    throw new Error(`createTakeoffItem: wasteFactor must be >= 0 for an OK item, got ${fields.wasteFactor}`);
  }

  const netVolume = fields.netVolume ?? null;
  const netArea = fields.netArea ?? null;
  const stockVolume = fields.stockVolume ?? null;
  const stockArea = fields.stockArea ?? null;

  let wasteAdjustedQuantity = null;
  let wasteAdjustedUnit = null;
  if (fields.status === TAKEOFF_ITEM_STATUS.OK) {
    if (stockVolume !== null && stockVolume > 0) {
      wasteAdjustedQuantity = stockVolume * (1 + fields.wasteFactor);
      wasteAdjustedUnit = 'm3';
    } else if (stockArea !== null && stockArea > 0) {
      wasteAdjustedQuantity = stockArea * (1 + fields.wasteFactor);
      wasteAdjustedUnit = 'm2';
    }
  }

  return {
    itemId: fields.itemId,
    elementType: fields.elementType,
    sourceElementId: fields.sourceElementId,
    constructionType: fields.constructionType ?? null,
    material: fields.material,
    materialId: fields.materialId,
    quantity: fields.quantity,
    unit: fields.unit,
    nominalDimensions: fields.nominalDimensions,
    calculatedDimensions: fields.calculatedDimensions,
    netVolume,
    netArea,
    stockVolume,
    stockArea,
    wasteFactor: fields.wasteFactor,
    wasteAdjustedQuantity,
    wasteAdjustedUnit,
    unitPrice: null,
    priceUnit: null,
    currency: null,
    calculatedCost: null,
    optional: fields.optional,
    status: fields.status,
    diagnostics: fields.diagnostics ?? [],
    notes: fields.notes ?? [],
    catalogStock: fields.catalogStock ?? null,
  };
}
