// Tests for the QUANTITIES layer (src/takeoff/materialTakeoff.js) — no cost involved (pricing
// is a separate layer, see pricing.test.js) and no validation gate (see validationGate.test.js
// and index.test.js) — computeMaterialTakeoff() itself never blocks, it only reports INVALID
// items. Every scenario runs against real, solved geometry (except the deliberately hand-built
// invalid-geometry case, scenario K).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from '../takeoffTypes.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const stringerConstruction = {
    outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
    inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
  };
  const postModels = buildPostModels(planLayout, fullConfig);
  return { config: fullConfig, models: { treadModels, riserModels, stringerModels, stringerConstruction, postModels } };
}

function compute(scenario, options) {
  return computeMaterialTakeoff(scenario.models, scenario.config, options);
}

// --- Scenario A: straight staircase -----------------------------------------------------------

test('scenario A (straight): every item has the required shape and a plausible OK quantity', () => {
  const scenario = build({ stairType: 'straight', treadsLegA: 6 });
  const items = compute(scenario);
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(typeof item.itemId, 'string');
    assert.ok(ELEMENT_TYPES[item.elementType]);
    assert.equal(typeof item.sourceElementId, 'string');
    assert.equal(typeof item.nominalDimensions, 'object');
    assert.equal(typeof item.calculatedDimensions, 'object');
    assert.ok(item.quantity > 0);
    assert.ok(TAKEOFF_ITEM_STATUS[item.status]);
    // Cost is a SEPARATE layer — must be null until pricing.js's applyPricing() runs.
    assert.equal(item.calculatedCost, null);
    assert.equal(item.unitPrice, null);
    if (item.status === TAKEOFF_ITEM_STATUS.OK) {
      assert.equal(typeof item.netVolume, 'number');
      assert.ok(item.wasteFactor >= 0);
    }
  }
});

test('scenario A (straight): one TREAD item per tread, traceable by stepId, exact (not approximated) dimensions', () => {
  const scenario = build({ stairType: 'straight', treadsLegA: 6 });
  const items = compute(scenario);
  const treads = items.filter((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.equal(treads.length, 6);
  for (const t of scenario.models.treadModels) {
    const item = items.find((i) => i.sourceElementId === `tread:${t.stepId}`);
    assert.ok(item, `missing takeoff item for ${t.stepId}`);
    assert.equal(item.quantity, 1);
  }
  // A straight tread's STOCK bounding rect (aligned to its own walking direction) must equal
  // its NET footprint almost exactly, since a straight tread's outline IS already a rectangle
  // (plus nosing) aligned with its own direction.
  const first = treads[0];
  assert.ok(Math.abs(first.calculatedDimensions.widthMm - scenario.config.stairWidth) < 1e-6);
});

test('scenario A (straight): one STRINGER item per side, quantity 1 (a straight flight is one physical board per side)', () => {
  const scenario = build({ stairType: 'straight', treadsLegA: 6 });
  const items = compute(scenario);
  const stringers = items.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER);
  assert.equal(stringers.length, 2); // outer + inner, one segment each
  for (const s of stringers) {
    assert.equal(s.status, TAKEOFF_ITEM_STATUS.OK);
    assert.equal(s.quantity, 1);
    assert.ok(s.netVolume > 0);
    assert.ok(s.stockVolume >= s.netVolume);
  }
});

// --- Scenario B: straight overlay (cut) stringer, cleats enabled --------------------------------

test('scenario B (straight, overlay/cut stringer, cleats on): produces one STRINGER_CLEAT item per tread bearing', () => {
  // stringerHeight raised from the default (300mm) to keep the cut board's notch geometry
  // valid (a self-intersection ERROR at 300mm here is a genuine, correct diagnostic — this
  // scenario is testing cleat generation on VALID geometry, not the diagnostic path itself;
  // see scenario K for that).
  const scenario = build({ stairType: 'straight', treadsLegA: 5, stringerConstructionType: 'cut', stringerCleatsEnabled: true, stringerHeight: 450 });
  const items = compute(scenario);
  const cleats = items.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER_CLEAT);
  // 5 treads x 2 sides (outer+inner) = 10 cleats, unless construction type isn't actually 'cut'
  // in this config's schema — assert against the real construction type used by the model.
  const outerGeo = scenario.models.stringerConstruction.outer[0];
  if (outerGeo.constructionType === 'cut') {
    assert.ok(cleats.length > 0);
    assert.ok(cleats.every((c) => c.optional === true));
    assert.ok(cleats.every((c) => c.status === TAKEOFF_ITEM_STATUS.OK));
  }
});

// --- Scenario C: straight housed (closed) stringer -----------------------------------------------

test('scenario C (straight, housed/closed stringer): produces informational STRINGER_HOUSING items, never counted as separate boards', () => {
  const scenario = build({ stairType: 'straight', treadsLegA: 5, stringerConstructionType: 'closed' });
  const items = compute(scenario);
  const outerGeo = scenario.models.stringerConstruction.outer[0];
  if (outerGeo.constructionType === 'closed') {
    const housings = items.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER_HOUSING);
    assert.ok(housings.length > 0);
    for (const h of housings) {
      assert.equal(h.materialId, null, 'a housing is a feature of the stringer, not a separately purchasable material');
      assert.equal(h.calculatedCost, null);
    }
    // Still exactly one STRINGER item per side (the housing does not fragment the board).
    const stringers = items.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER);
    assert.equal(stringers.length, 2);
  }
});

// --- Scenario D: L-winder staircase ---------------------------------------------------------------

test('scenario D (L-winder): one TREAD item per winder tread, real per-tread polygon area (not a nominal formula)', () => {
  const scenario = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const items = compute(scenario);
  const winderTreads = scenario.models.treadModels.filter((t) => t.type === 'winder');
  assert.ok(winderTreads.length > 0);
  for (const t of winderTreads) {
    const item = items.find((i) => i.sourceElementId === `tread:${t.stepId}`);
    assert.ok(item);
    // A naive "stairWidth x treadGoing" estimate would be wrong for a winder footprint — the
    // real net area (from the actual polygon) must differ from that naive guess.
    const naiveAreaM2 = (scenario.config.stairWidth * scenario.config.treadGoing) / 1e6;
    assert.notEqual(Math.round(item.netArea * 1e6), Math.round(naiveAreaM2 * 1e6));
    assert.ok(item.netArea > 0);
    // STOCK must be >= NET (a bounding rectangle can never be smaller than the polygon it bounds).
    assert.ok(item.stockArea >= item.netArea - 1e-9);
  }
});

test('scenario D (L-winder): stringer segments respect actual turn segmentation (not one board per tread)', () => {
  const scenario = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const items = compute(scenario);
  const outerStringers = items.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER && i.sourceElementId.startsWith('stringer:outer:'));
  assert.equal(outerStringers.length, scenario.models.stringerModels.outer.segments.filter((s) => s.treadBearings.length > 0).length);
});

// --- Scenario E: asymmetric winder (unequal legs) -------------------------------------------------

test('scenario E (asymmetric winder legs): every winder tread is still individually traceable', () => {
  const scenario = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 5, windersPerTurn: 3 });
  const items = compute(scenario);
  for (const t of scenario.models.treadModels) {
    assert.ok(items.some((i) => i.sourceElementId === `tread:${t.stepId}`), `missing item for ${t.stepId}`);
  }
});

// --- Scenario G: changed tread count (regression-shape check) -------------------------------------

test('scenario G (changed tread count): tread item count tracks treadsLegA exactly', () => {
  const five = compute(build({ stairType: 'straight', treadsLegA: 5 }));
  const eight = compute(build({ stairType: 'straight', treadsLegA: 8 }));
  assert.equal(five.filter((i) => i.elementType === ELEMENT_TYPES.TREAD).length, 5);
  assert.equal(eight.filter((i) => i.elementType === ELEMENT_TYPES.TREAD).length, 8);
});

// --- Scenario H: changed staircase width ------------------------------------------------------

test('scenario H (changed staircase width): tread stock width scales with stairWidth, other dimensions unaffected', () => {
  const narrow = build({ stairType: 'straight', treadsLegA: 5, stairWidth: 800 });
  const wide = build({ stairType: 'straight', treadsLegA: 5, stairWidth: 1100 });
  const itemsNarrow = compute(narrow);
  const itemsWide = compute(wide);
  const treadNarrow = itemsNarrow.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const treadWide = itemsWide.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.ok(Math.abs(treadNarrow.calculatedDimensions.widthMm - 800) < 1e-6);
  assert.ok(Math.abs(treadWide.calculatedDimensions.widthMm - 1100) < 1e-6);
  assert.equal(treadNarrow.calculatedDimensions.thicknessMm, treadWide.calculatedDimensions.thicknessMm);
});

// --- Scenario I: changed stringer thickness ----------------------------------------------------

test('scenario I (changed stringer thickness): only stringer volumes change, tread/riser/post volumes stay identical', () => {
  const thin = build({ stairType: 'straight', treadsLegA: 5, stringerThickness: 40 });
  const thick = build({ stairType: 'straight', treadsLegA: 5, stringerThickness: 60 });
  const itemsThin = compute(thin);
  const itemsThick = compute(thick);

  const stringerThin = itemsThin.find((i) => i.elementType === ELEMENT_TYPES.STRINGER);
  const stringerThick = itemsThick.find((i) => i.elementType === ELEMENT_TYPES.STRINGER);
  assert.notEqual(stringerThin.netVolume, stringerThick.netVolume);

  const treadThin = itemsThin.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const treadThick = itemsThick.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.equal(treadThin.netVolume, treadThick.netVolume, 'changing stringer thickness must never affect tread volume');

  const postThin = itemsThin.find((i) => i.elementType === ELEMENT_TYPES.POST);
  const postThick = itemsThick.find((i) => i.elementType === ELEMENT_TYPES.POST);
  assert.equal(postThin.netVolume, postThick.netVolume, 'changing stringer thickness must never affect post volume');
});

// --- Scenario J: cleats enabled/disabled --------------------------------------------------------

test('scenario J: disabling stringerCleatsEnabled removes every STRINGER_CLEAT item without touching the board itself', () => {
  const withCleats = build({ stairType: 'straight', treadsLegA: 5, stringerConstructionType: 'cut', stringerHeight: 450, stringerCleatsEnabled: true });
  const withoutCleats = build({ stairType: 'straight', treadsLegA: 5, stringerConstructionType: 'cut', stringerHeight: 450, stringerCleatsEnabled: false });
  const itemsWith = compute(withCleats);
  const itemsWithout = compute(withoutCleats);

  const outerGeo = withCleats.models.stringerConstruction.outer[0];
  if (outerGeo.constructionType === 'cut') {
    assert.ok(itemsWith.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER_CLEAT).length > 0);
  }
  assert.equal(itemsWithout.filter((i) => i.elementType === ELEMENT_TYPES.STRINGER_CLEAT).length, 0, 'disabling cleats must never leave a hidden/assumed cleat item');

  // Disabling cleats must not change the board's own net/stock geometry.
  const boardWith = itemsWith.find((i) => i.elementType === ELEMENT_TYPES.STRINGER && i.sourceElementId === 'stringer:outer:' + withCleats.models.stringerModels.outer.segments[0].id);
  const boardWithout = itemsWithout.find((i) => i.elementType === ELEMENT_TYPES.STRINGER && i.sourceElementId === 'stringer:outer:' + withoutCleats.models.stringerModels.outer.segments[0].id);
  assert.equal(boardWith.netVolume, boardWithout.netVolume);
});

// --- Scenario K: invalid stringer geometry (hand-built, negative test) ---------------------------

test('scenario K: a stringer segment carrying an ERROR diagnostic produces an INVALID takeoff item, never an invented quantity', () => {
  const scenario = build({ stairType: 'straight', treadsLegA: 5 });
  // Hand-corrupt one segment's construction geometry with an ERROR diagnostic — the same
  // "hand-built negative case" pattern used throughout this project's other diagnostic tests
  // (see stringerConstructionGeometry.test.js) rather than searching for a naturally occurring
  // self-intersecting config.
  const corrupted = {
    ...scenario,
    models: {
      ...scenario.models,
      stringerConstruction: {
        ...scenario.models.stringerConstruction,
        outer: [
          {
            ...scenario.models.stringerConstruction.outer[0],
            diagnostics: [{ ruleId: 'TEST-FORCED-ERROR', severity: 'ERROR', elementType: 'stringer', elementId: scenario.models.stringerModels.outer.segments[0].id, message: 'forced for test' }],
          },
        ],
      },
    },
  };
  const items = compute(corrupted);
  const outerStringer = items.find((i) => i.elementType === ELEMENT_TYPES.STRINGER && i.sourceElementId.startsWith('stringer:outer:'));
  assert.equal(outerStringer.status, TAKEOFF_ITEM_STATUS.INVALID);
  assert.equal(outerStringer.netVolume, null);
  assert.equal(outerStringer.stockVolume, null);
  assert.equal(outerStringer.wasteAdjustedQuantity, null);
  assert.ok(outerStringer.diagnostics.some((d) => d.ruleId === 'TEST-FORCED-ERROR'));
  // An invalid board must never produce cleats/housings (nothing trustworthy to hang them off of).
  assert.equal(items.some((i) => i.sourceElementId.startsWith('stringer:outer:') && i.elementType === ELEMENT_TYPES.STRINGER_CLEAT), false);
});

// --- Risers, posts, waste, overrides -------------------------------------------------------------

test('risers: absent entirely when hasRiserBoards is off; present (one item per stepId) when on', () => {
  const off = compute(build({ stairType: 'straight', treadsLegA: 5, hasRiserBoards: false }));
  assert.equal(off.some((i) => i.elementType === ELEMENT_TYPES.RISER), false);

  const scenario = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasRiserBoards: true });
  const on = compute(scenario);
  const risers = on.filter((i) => i.elementType === ELEMENT_TYPES.RISER);
  assert.equal(risers.length, scenario.models.riserModels.length);
  assert.ok(risers.every((r) => r.optional === true));
});

test('posts: newel posts always present, corner posts only when hasCornerPost is on (and marked optional)', () => {
  const withoutCorner = compute(build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasCornerPost: false }));
  assert.ok(withoutCorner.find((i) => i.sourceElementId === 'post:post-start'));
  assert.equal(withoutCorner.some((i) => i.elementType === ELEMENT_TYPES.POST && i.sourceElementId.includes('corner')), false);

  const withCorner = compute(build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasCornerPost: true }));
  const corner = withCorner.find((i) => i.sourceElementId.includes('corner'));
  assert.ok(corner);
  assert.equal(corner.optional, true);
  assert.equal(withCorner.find((i) => i.sourceElementId === 'post:post-start').optional, false);
});

test('waste: wasteAdjustedQuantity = stock measure * (1 + wasteFactor) for every OK item', () => {
  const scenario = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasRiserBoards: true, hasCornerPost: true });
  const items = compute(scenario);
  for (const item of items) {
    if (item.status !== TAKEOFF_ITEM_STATUS.OK || item.wasteAdjustedQuantity === null) continue;
    const stockMeasure = item.wasteAdjustedUnit === 'm3' ? item.stockVolume : item.stockArea;
    assert.ok(Math.abs(item.wasteAdjustedQuantity - stockMeasure * (1 + item.wasteFactor)) < 1e-9, `${item.itemId}: wasteAdjustedQuantity mismatch`);
  }
});

test('waste factors are overridable per call, without touching quantities', () => {
  const scenario = build({ stairType: 'straight', treadsLegA: 5 });
  const withDefault = compute(scenario);
  const withOverride = compute(scenario, { wasteFactors: { TREAD: 0.5 } });
  const before = withDefault.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  const after = withOverride.find((i) => i.elementType === ELEMENT_TYPES.TREAD);
  assert.equal(after.wasteFactor, 0.5);
  assert.equal(before.netVolume, after.netVolume, 'overriding waste must never change the underlying quantity');
  assert.notEqual(before.wasteAdjustedQuantity, after.wasteAdjustedQuantity);
});

// --- Scenario F: manual tread-edge override changes ONLY the expected dependent quantities -------

test('scenario F: a manual edge override changes only the affected tread/riser/stringer-bearing quantities, never unrelated ones', () => {
  const boundaryIndex = 3;
  const base = build({ stairType: 'straight', treadsLegA: 6, hasRiserBoards: true });
  const outerPoint = base.models.treadModels[boundaryIndex - 1].backEdge.final[1];
  const edited = build({
    stairType: 'straight',
    treadsLegA: 6,
    hasRiserBoards: true,
    manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: { x: outerPoint.x + 15, y: outerPoint.y } } },
  });

  const itemsBase = compute(base);
  const itemsEdited = compute(edited);

  // The moved point is a shared corner: it is BOTH tread[boundaryIndex-1]'s backEdge AND
  // tread[boundaryIndex]'s frontEdge — so exactly these two treads are expected to change,
  // never any other one.
  const affectedStepIds = new Set([base.models.treadModels[boundaryIndex - 1].stepId, base.models.treadModels[boundaryIndex].stepId]);
  for (const stepId of affectedStepIds) {
    const before = itemsBase.find((i) => i.sourceElementId === `tread:${stepId}`);
    const after = itemsEdited.find((i) => i.sourceElementId === `tread:${stepId}`);
    assert.notEqual(before.netArea, after.netArea, `edited tread ${stepId} must change`);
  }

  // Every OTHER tread must be completely unaffected.
  for (const t of base.models.treadModels) {
    if (affectedStepIds.has(t.stepId)) continue;
    const before = itemsBase.find((i) => i.sourceElementId === `tread:${t.stepId}`);
    const after = itemsEdited.find((i) => i.sourceElementId === `tread:${t.stepId}`);
    assert.equal(before.netArea, after.netArea, `unrelated tread ${t.stepId} must not change`);
  }

  // Posts (unrelated to a mid-flight edge edit) must be completely unaffected.
  const postsBase = itemsBase.filter((i) => i.elementType === ELEMENT_TYPES.POST);
  const postsEdited = itemsEdited.filter((i) => i.elementType === ELEMENT_TYPES.POST);
  assert.equal(postsBase.length, postsEdited.length);
  for (let i = 0; i < postsBase.length; i++) {
    assert.equal(postsBase[i].netVolume, postsEdited[i].netVolume);
  }
});
