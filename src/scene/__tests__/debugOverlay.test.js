// The debug overlay is a pure visualization layer — these tests confirm it builds cleanly
// against real models (straight, winder, U-shape) and produces the expected group structure,
// never that it "looks right" visually (that's the browser-verification step, not a unit test).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildDebugOverlay } from '../debugOverlay.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return {
    planLayout,
    treadModels: buildTreadModels(planLayout, fullConfig),
    stringerModels: buildStringerModelsForFlight(planLayout, fullConfig),
  };
}

const EXPECTED_SUBGROUPS = ['DebugReferenceLines', 'DebugConstructionPoints', 'DebugIntersections', 'DebugNormals', 'DebugBearingPositions'];

for (const [label, patch] of [
  ['straight flight', { stairType: 'straight', treadsLegA: 6 }],
  ['L-winder', { stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 }],
  ['U-double-winder', { stairType: 'U', turn1Type: 'winder', turn2Type: 'winder', treadsLegA: 2, treadsLegB: 2, treadsLegC: 2, windersPerTurn: 5 }],
]) {
  test(`buildDebugOverlay: ${label} builds without crashing and has every expected subgroup`, () => {
    const models = build(patch);
    const overlay = buildDebugOverlay(models);
    assert.equal(overlay.name, 'DebugOverlay');
    const subgroupNames = overlay.children.map((c) => c.name);
    assert.deepEqual(subgroupNames.sort(), [...EXPECTED_SUBGROUPS].sort());
  });
}

test('buildDebugOverlay: construction points include exactly 4 points per tread (front inner/outer, back inner/outer)', () => {
  const { planLayout, treadModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 5 });
  const overlay = buildDebugOverlay({ planLayout, treadModels, stringerModels });
  const points = overlay.children.find((c) => c.name === 'DebugConstructionPoints');
  assert.equal(points.children.length, treadModels.length * 4);
});

test('buildDebugOverlay: one normal arrow per tread', () => {
  const { planLayout, treadModels, stringerModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const overlay = buildDebugOverlay({ planLayout, treadModels, stringerModels });
  const normals = overlay.children.find((c) => c.name === 'DebugNormals');
  assert.equal(normals.children.length, treadModels.length);
});

test('buildDebugOverlay: bearing positions include 2 markers per bearing (start+end), per side', () => {
  const { planLayout, treadModels, stringerModels } = build({ stairType: 'straight', treadsLegA: 5 });
  const overlay = buildDebugOverlay({ planLayout, treadModels, stringerModels });
  const bearingGroup = overlay.children.find((c) => c.name === 'DebugBearingPositions');
  const expectedCount = ['outer', 'inner'].reduce((sum, side) => sum + stringerModels[side].segments.reduce((s, seg) => s + seg.treadBearings.length * 2, 0), 0);
  assert.equal(bearingGroup.children.length, expectedCount);
});

test('buildDebugOverlay: intersections include every turn corner for a winder scenario', () => {
  const { planLayout, treadModels, stringerModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const overlay = buildDebugOverlay({ planLayout, treadModels, stringerModels });
  const intersections = overlay.children.find((c) => c.name === 'DebugIntersections');
  assert.ok(intersections.children.length >= planLayout.turns.length);
});
