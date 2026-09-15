// Tests for the QUANTITIES layer (src/takeoff/materialTakeoff.js) — no cost involved (pricing
// is a separate layer, see pricing.test.js). Every scenario runs against real, solved geometry.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const postModels = buildPostModels(planLayout, fullConfig);
  return { config: fullConfig, models: { treadModels, riserModels, stringerModels, postModels } };
}

test('every item has the required shape: type, dimensions, quantity, volume, material, wasteFactor, cost fields', () => {
  const { config, models } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, hasRiserBoards: true, hasCornerPost: true });
  const items = computeMaterialTakeoff(models, config);
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(typeof item.type, 'string');
    assert.equal(typeof item.dimensions, 'object');
    assert.ok(item.quantity > 0);
    assert.equal(typeof item.netVolume, 'number');
    assert.equal(typeof item.material, 'string');
    assert.ok(item.wasteFactor >= 0);
    // Cost is a SEPARATE layer — must be null until pricing.js's applyPricing() runs.
    assert.equal(item.calculatedCost, null);
    assert.equal(item.unitPrice, null);
  }
});

test('straight flight: tread count matches the flight, and dimensions are exact (not approximated)', () => {
  const { config, models } = build({ stairType: 'straight', treadsLegA: 6 });
  const items = computeMaterialTakeoff(models, config);
  const treads = items.find((i) => i.itemId === 'tread-straight');
  assert.equal(treads.quantity, 6);
  assert.ok(Math.abs(treads.dimensions.avgWidthMm - config.stairWidth) < 1e-6);
  // The tread OUTLINE includes the nosing overhang (see treadSolver.js applyNosing) — its real
  // depth is treadGoing + nosing, not the bare treadGoing config value.
  const expectedDepth = config.treadGoing + config.nosing;
  assert.ok(Math.abs(treads.dimensions.avgDepthMm - expectedDepth) < 1e-6);
  assert.equal(treads.dimensions.thicknessMm, config.treadThickness);
  // Volume must be the real, geometry-derived value: width * (depth+nosing) * thickness * count.
  const expectedVolumeM3 = ((config.stairWidth * expectedDepth * config.treadThickness) / 1e9) * 6;
  assert.ok(Math.abs(treads.netVolume - expectedVolumeM3) < 1e-6);
});

test('winder flight: winder tread group is aggregated from REAL per-tread polygon areas, not a nominal formula', () => {
  const { config, models } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const items = computeMaterialTakeoff(models, config);
  const winders = items.find((i) => i.itemId === 'tread-winder');
  assert.equal(winders.quantity, 5);
  // A naive "nominal width x treadGoing" estimate would be way off for winders — the real
  // area, summed from each tread's own outline, must differ from that naive guess.
  const naiveVolumeM3 = ((config.stairWidth * config.treadGoing * config.treadThickness) / 1e9) * 5;
  assert.notEqual(Math.round(winders.netVolume * 1e6), Math.round(naiveVolumeM3 * 1e6));
  assert.ok(winders.netVolume > 0);
});

test('landing: produces a "Podesty" item (a landing tread is a tread of type landing)', () => {
  const { config, models } = build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 3, treadsLegB: 3 });
  const items = computeMaterialTakeoff(models, config);
  const landing = items.find((i) => i.itemId === 'tread-landing');
  assert.ok(landing);
  assert.equal(landing.quantity, 1);
  assert.equal(landing.label, 'Podesty');
});

test('stringers: quantity is the number of physical boards (segments), length/area/volume sum across them', () => {
  const { config, models } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 });
  const items = computeMaterialTakeoff(models, config);
  const outer = items.find((i) => i.itemId === 'stringer-outer');
  const inner = items.find((i) => i.itemId === 'stringer-inner');
  assert.equal(outer.quantity, models.stringerModels.outer.segments.length);
  assert.equal(inner.quantity, models.stringerModels.inner.segments.length);
  assert.ok(outer.dimensions.totalLengthMm > 0);
  assert.ok(Math.abs(outer.netVolume - (outer.dimensions.totalLengthMm * config.stringerHeight * config.stringerThickness) / 1e9) < 1e-9);
});

test('risers: absent entirely when hasRiserBoards is off', () => {
  const { config, models } = build({ stairType: 'straight', treadsLegA: 5, hasRiserBoards: false });
  const items = computeMaterialTakeoff(models, config);
  assert.equal(items.some((i) => i.type === 'riser'), false);
});

test('risers: present and marked optional when hasRiserBoards is on; quantity counts individual panels (winder fan included)', () => {
  const { config, models } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasRiserBoards: true });
  const items = computeMaterialTakeoff(models, config);
  const riser = items.find((i) => i.itemId === 'riser-board');
  assert.ok(riser);
  assert.equal(riser.optional, true);
  const expectedPanelCount = models.riserModels.reduce((sum, r) => sum + r.panels.length, 0);
  assert.equal(riser.quantity, expectedPanelCount);
});

test('posts: newel posts always present, corner posts only when hasCornerPost is on (and marked optional)', () => {
  const withoutCorner = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasCornerPost: false });
  const itemsNoCorner = computeMaterialTakeoff(withoutCorner.models, withoutCorner.config);
  assert.ok(itemsNoCorner.find((i) => i.itemId === 'post-newel'));
  assert.equal(itemsNoCorner.some((i) => i.itemId === 'post-corner'), false);

  const withCorner = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasCornerPost: true });
  const itemsWithCorner = computeMaterialTakeoff(withCorner.models, withCorner.config);
  const corner = itemsWithCorner.find((i) => i.itemId === 'post-corner');
  assert.ok(corner);
  assert.equal(corner.optional, true);
  assert.equal(itemsWithCorner.find((i) => i.itemId === 'post-newel').optional, false);
});

test('waste: grossVolume/grossArea = net * (1 + wasteFactor), and wasteVolume/wasteArea = gross - net, for every item', () => {
  const { config, models } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasRiserBoards: true, hasCornerPost: true });
  const items = computeMaterialTakeoff(models, config);
  for (const item of items) {
    assert.ok(Math.abs(item.grossVolume - item.netVolume * (1 + item.wasteFactor)) < 1e-9, `${item.itemId}: grossVolume mismatch`);
    assert.ok(Math.abs(item.grossArea - item.netArea * (1 + item.wasteFactor)) < 1e-9, `${item.itemId}: grossArea mismatch`);
    assert.ok(Math.abs(item.wasteVolume - (item.grossVolume - item.netVolume)) < 1e-9);
    assert.ok(Math.abs(item.wasteArea - (item.grossArea - item.netArea)) < 1e-9);
  }
});

test('waste factors are overridable per call, without touching geometry', () => {
  const { config, models } = build({ stairType: 'straight', treadsLegA: 5 });
  const withDefault = computeMaterialTakeoff(models, config);
  const withOverride = computeMaterialTakeoff(models, config, { wasteFactors: { tread: 0.5 } });
  const before = withDefault.find((i) => i.itemId === 'tread-straight');
  const after = withOverride.find((i) => i.itemId === 'tread-straight');
  assert.equal(after.wasteFactor, 0.5);
  assert.equal(before.netVolume, after.netVolume, 'overriding waste must never change the underlying quantity');
  assert.notEqual(before.grossVolume, after.grossVolume);
});

test('a manual edge override changes the affected takeoff quantities without any special-casing', () => {
  const boundaryIndex = 3;
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const outerPoint = base.models.treadModels[boundaryIndex - 1].backEdge.final[1];
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: { x: outerPoint.x + 15, y: outerPoint.y } } } });

  const itemsBase = computeMaterialTakeoff(base.models, base.config);
  const itemsEdited = computeMaterialTakeoff(edited.models, edited.config);
  assert.notEqual(itemsBase.find((i) => i.itemId === 'tread-straight').netArea, itemsEdited.find((i) => i.itemId === 'tread-straight').netArea);
});
