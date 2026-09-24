import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { evaluateRailingChecks, legalClearOpeningMm, PL_CLEAR_OPENING_GENERAL_MM, PL_CLEAR_OPENING_STRICT_MM } from '../railingChecks.js';

function stair(patch = {}) {
  const config = {
    ...createDefaultConfig(),
    stairType: 'straight',
    treadsLegA: 10,
    totalRise: 2600,
    railingEnabled: true,
    railingSections: [{ id: 's', side: 'outer', fromStep: 0, toStep: null }],
    ...patch,
  };
  return buildStaircase(config);
}

const findings = (result, ruleId) => result.railingModel.diagnostics.filter((d) => d.ruleId === ruleId);

test('nothing is checked when the balustrade is off or has no valid section', () => {
  assert.deepEqual(stair({ railingEnabled: false }).railingModel.diagnostics, []);
  const bad = stair({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 8, toStep: 2 }] });
  assert.deepEqual(bad.railingModel.diagnostics.map((d) => d.ruleId), ['RAILING-SECTION-INVALID']);
});

test('PL-LEGAL-H-01: a handrail lower than 1100 mm is a WARNING (never a blocking ERROR); 1100 mm is fine', () => {
  const low = findings(stair({ railingHeightMm: 900 }), 'PL-LEGAL-H-01').filter((d) => d.parameter === 'railingHeightMm');
  assert.equal(low.length, 1);
  assert.equal(low[0].severity, 'WARNING');
  assert.equal(low[0].value, 900);
  assert.equal(findings(stair({ railingHeightMm: 1100 }), 'PL-LEGAL-H-01').filter((d) => d.parameter === 'railingHeightMm').length, 0);
});

test('clear opening limit follows the building type: 200 mm in general, 120 mm for multi-family', () => {
  assert.equal(legalClearOpeningMm({ buildingType: 'single_family' }), PL_CLEAR_OPENING_GENERAL_MM);
  assert.equal(legalClearOpeningMm({}), PL_CLEAR_OPENING_GENERAL_MM);
  assert.equal(legalClearOpeningMm({ buildingType: 'multi_family' }), PL_CLEAR_OPENING_STRICT_MM);
  const strict = stair({ buildingType: 'multi_family', railingMaxClearMm: 150 });
  assert.ok(findings(strict, 'PL-LEGAL-H-01').some((d) => d.parameter === 'railingMaxClearMm' && d.expected === '<= 120'));
  const fine = stair({ buildingType: 'multi_family', railingMaxClearMm: 110 });
  assert.equal(findings(fine, 'PL-LEGAL-H-01').filter((d) => d.parameter === 'railingMaxClearMm' || d.parameter === 'clearOpening').length, 0);
});

test('the real widest opening is measured on the solved balustrade, not only the configured limit', () => {
  const wide = stair({ railingMaxClearMm: 200, buildingType: 'multi_family', stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const measured = findings(wide, 'PL-LEGAL-H-01').filter((d) => d.parameter === 'clearOpening');
  assert.ok(measured.length >= 1, 'openings of up to 200 mm exceed the 120 mm limit of a multi-family building');
  assert.ok(measured[0].value > 120 && measured[0].value <= 200 + 1);
  const ok = stair({ railingMaxClearMm: 100, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  assert.equal(findings(ok, 'PL-LEGAL-H-01').filter((d) => d.parameter === 'clearOpening').length, 0);
});

test('BWF-GUID-B-02 minimums are INFO only', () => {
  const thin = stair({ railingBalusterSizeMm: 20, railingHandrailWidthMm: 40, railingHandrailHeightMm: 30, railingPostSizeMm: 60 });
  const bwf = findings(thin, 'BWF-GUID-B-02');
  assert.deepEqual(bwf.map((d) => d.parameter).sort(), ['balusterSize', 'handrailSection', 'newelSize']);
  assert.ok(bwf.every((d) => d.severity === 'INFO'));
  assert.equal(findings(stair({ railingBalusterSizeMm: 30, railingHandrailWidthMm: 70, railingHandrailHeightMm: 50, railingPostSizeMm: 90 }), 'BWF-GUID-B-02').length, 0);
});

test('the findings reach the validation gate (Walidacja + takeoff) without blocking it', () => {
  const m = stair({ railingHeightMm: 900 });
  const gate = runTakeoffValidationGate(m);
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'PL-LEGAL-H-01'));
  const baseline = runTakeoffValidationGate(stair({ railingEnabled: false }));
  assert.equal(gate.errors.length, baseline.errors.length, 'the balustrade adds no ERROR');
  assert.equal(typeof evaluateRailingChecks, 'function');
});
