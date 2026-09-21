import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { buildPricedMaterialTakeoff } from '../../takeoff/index.js';
import { GROUP_BY, groupTakeoffItems, summarizeTakeoff, describeDimensions } from '../takeoffView.js';

function realTakeoff() {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, openingLength: 6000 };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  return buildPricedMaterialTakeoff({
    fullConfig,
    derived,
    planLayout,
    treadModels: buildTreadModels(planLayout, fullConfig),
    riserModels: buildRiserModels(planLayout, fullConfig),
    stringerModels,
    stringerConstruction: {
      outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
      inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
    },
    postModels: buildPostModels(planLayout, fullConfig),
  });
}

test('groupTakeoffItems partitions every item exactly once, for every grouping', () => {
  const { items } = realTakeoff();
  assert.ok(items.length > 0);
  for (const groupBy of Object.values(GROUP_BY)) {
    const groups = groupTakeoffItems(items, groupBy);
    assert.equal(groups.reduce((n, g) => n + g.items.length, 0), items.length, groupBy);
  }
});

test('grouping by element type separates treads from stringers', () => {
  const { items } = realTakeoff();
  const keys = groupTakeoffItems(items, GROUP_BY.ELEMENT).map((g) => g.key);
  assert.ok(keys.includes('Stopnie'));
  assert.ok(keys.includes('Wangi'));
});

test('summarizeTakeoff total cost equals the facade totalCost and stock >= net per material', () => {
  const takeoff = realTakeoff();
  const summary = summarizeTakeoff(takeoff.items);
  assert.ok(summary.rows.length > 0);
  assert.ok(Math.abs(summary.totalCost - takeoff.totalCost) < 0.02, `${summary.totalCost} vs ${takeoff.totalCost}`);
  for (const row of summary.rows) {
    assert.ok(row.stock >= row.net - 1e-9, `stock must cover net for ${row.materialId}`);
    assert.ok(row.withWaste >= row.stock - 1e-9, `waste-adjusted must cover stock for ${row.materialId}`);
  }
});

test('summarizeTakeoff of a BLOCKED (empty) takeoff is empty, never a fabricated total', () => {
  const summary = summarizeTakeoff([]);
  assert.deepEqual(summary.rows, []);
  assert.equal(summary.totalCost, 0);
});

test('describeDimensions handles empty and typical shapes', () => {
  assert.equal(describeDimensions({}), '');
  assert.equal(describeDimensions(null), '');
  assert.match(describeDimensions({ lengthMm: 4610.3, boardWidthMm: 300, thicknessMm: 40 }), /dł\. 4610 × szer\. 300 × grub\. 40 mm/);
  assert.match(describeDimensions({ crossSectionMm: 110, heightMm: 2600 }), /przekrój 110×110/);
});
