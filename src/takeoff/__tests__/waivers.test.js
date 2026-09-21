import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';
import { createDiagnostic } from '../../diagnostics/diagnostic.js';
import { waiverKey, createWaiver, partitionByWaivers, addWaiver, removeWaiver, sanitizeWaivers } from '../../diagnostics/waivers.js';
import { buildMaterialTakeoff, buildPricedMaterialTakeoff, GATE_STATUS } from '../index.js';

function buildModels() {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, openingLength: 6000 };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  return {
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
  };
}

// Wstrzykuje ERROR do diagnostyk konstrukcji wangi — ta sama technika co index.test.js.
function withInjectedError(models, ruleId = 'TEST-INJECTED-ERROR', elementId = 'outer-seg-0') {
  const diag = createDiagnostic({ ruleId, severity: 'ERROR', elementType: 'stringer', elementId, message: 'wstrzyknięty błąd' });
  models.stringerConstruction.outer[0].diagnostics = [...(models.stringerConstruction.outer[0].diagnostics || []), diag];
  return diag;
}

test('a waiver matches on (ruleId, elementId), not on the rule alone', () => {
  const a = createDiagnostic({ ruleId: 'R-1', severity: 'ERROR', elementType: 'tread', elementId: 'step-1', message: 'm' });
  const b = createDiagnostic({ ruleId: 'R-1', severity: 'ERROR', elementType: 'tread', elementId: 'step-2', message: 'm' });
  const { active, waived } = partitionByWaivers([a, b], [createWaiver(a)]);
  assert.deepEqual(waived, [a]);
  assert.deepEqual(active, [b]);
});

test('waiverKey treats a missing elementId consistently', () => {
  const d = createDiagnostic({ ruleId: 'R-2', severity: 'WARNING', elementType: 'stair', elementId: null, message: 'm' });
  assert.equal(waiverKey(d), waiverKey(createWaiver(d)));
});

test('addWaiver is idempotent and does not mutate; removeWaiver undoes it', () => {
  const d = createDiagnostic({ ruleId: 'R-3', severity: 'ERROR', elementType: 'tread', elementId: 'step-3', message: 'm' });
  const original = [];
  const once = addWaiver(original, d);
  assert.equal(original.length, 0);
  assert.equal(addWaiver(once, d), once, 'adding the same waiver twice changes nothing');
  assert.equal(removeWaiver(once, d).length, 0);
});

test('waivers that match nothing are reported as stale, not silently applied', () => {
  const d = createDiagnostic({ ruleId: 'R-4', severity: 'ERROR', elementType: 'tread', elementId: 'step-4', message: 'm' });
  const { staleWaivers } = partitionByWaivers([], [createWaiver(d)]);
  assert.equal(staleWaivers.length, 1);
});

test('sanitizeWaivers drops malformed entries instead of throwing', () => {
  assert.deepEqual(sanitizeWaivers(null), []);
  assert.deepEqual(sanitizeWaivers([{ ruleId: 'OK', elementId: 'step-1' }, { nope: 1 }, null, { ruleId: '' }]), [{ ruleId: 'OK', elementId: 'step-1' }]);
});

test('WITHOUT a waiver an ERROR blocks the takeoff', () => {
  const models = buildModels();
  withInjectedError(models);
  const takeoff = buildMaterialTakeoff(models);
  assert.equal(takeoff.status, GATE_STATUS.BLOCKED);
  assert.deepEqual(takeoff.items, []);
});

test('WITH a waiver the same ERROR no longer blocks, yet is still reported as waived', () => {
  const models = buildModels();
  const diag = withInjectedError(models);
  const takeoff = buildPricedMaterialTakeoff(models, { waivers: [createWaiver(diag)] });
  assert.notEqual(takeoff.status, GATE_STATUS.BLOCKED);
  assert.ok(takeoff.items.length > 0, 'quantities are computed');
  assert.ok(takeoff.totalCost > 0);
  assert.ok(takeoff.diagnostics.includes(diag), 'the finding stays in the full list — never hidden');
  assert.deepEqual(takeoff.waivedDiagnostics, [diag]);
  assert.ok(!takeoff.activeDiagnostics.includes(diag));
});

test('waiving one element does not unblock an identical rule on another element', () => {
  const models = buildModels();
  const d1 = withInjectedError(models, 'TEST-INJECTED-ERROR', 'outer-seg-0');
  withInjectedError(models, 'TEST-INJECTED-ERROR', 'inner-seg-0');
  const takeoff = buildMaterialTakeoff(models, { waivers: [createWaiver(d1)] });
  assert.equal(takeoff.status, GATE_STATUS.BLOCKED);
});

test('a waiver never fabricates numbers: the flagged segment stays INVALID, every other item is unchanged', () => {
  const clean = buildPricedMaterialTakeoff(buildModels());
  const models = buildModels();
  const diag = withInjectedError(models);
  const waived = buildPricedMaterialTakeoff(models, { waivers: [createWaiver(diag)] });

  const bad = waived.items.find((i) => i.sourceElementId === 'stringer:outer:outer-seg-0');
  assert.equal(bad.status, 'INVALID', 'a construction-level ERROR still marks its own item as not computable');
  assert.equal(bad.calculatedCost, null);

  const others = (t) => t.items.filter((i) => i.sourceElementId !== 'stringer:outer:outer-seg-0' && !i.sourceElementId.startsWith('stringer:outer:outer-seg-0:'));
  assert.deepEqual(others(waived), others(clean));
});
