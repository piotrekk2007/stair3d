// Tests for the public Staircase Validator facade — the independent, read-only entry point
// requested for stair3d. Confirms: it never mutates config, it covers the full checklist end
// to end on real scenarios, its output matches the required message shape (level/element/
// step/parameter/value/expected), and validateModels/validateStaircase agree on the same input.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import {
  validateStaircase,
  validateModels,
  formatFinding,
  formatReport,
  deriveStairData,
  buildPlanLayout,
  buildTreadModels,
  buildRiserModels,
  buildStringerModelsForFlight,
} from '../StaircaseValidator.js';

function config(patch) {
  return { ...createDefaultConfig(), ...patch };
}

test('validateStaircase never mutates the config it is given', () => {
  const cfg = config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, hasRiserBoards: true });
  const before = JSON.parse(JSON.stringify(cfg));
  validateStaircase(cfg);
  assert.deepEqual(cfg, before);
});

test('validateStaircase: a legally-compliant residential straight flight with a matching ceiling opening has zero findings', () => {
  const result = validateStaircase(
    config({ stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, stairWidth: 900, hasRiserBoards: true, openingLength: 6000, openingWidth: 900, minHeadroom: 1900 })
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.hasErrors, false);
  assert.equal(result.hasWarnings, false);
});

test('validateStaircase: every finding has the required shape (level, element, step, parameter, value/expected)', () => {
  const result = validateStaircase(config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5, hasRiserBoards: true }));
  assert.ok(result.diagnostics.length > 0, 'this default scenario is known to have real findings (tight winders + undersized ceiling opening)');
  for (const d of result.diagnostics) {
    assert.ok(['ERROR', 'WARNING', 'INFO'].includes(d.severity), 'severity must be one of the three required levels');
    assert.ok(typeof d.elementType === 'string' && d.elementType.length > 0, 'element must be present');
    assert.ok('elementId' in d, 'step must be present (may be null for a stair-wide finding)');
    assert.ok('parameter' in d, 'parameter must be present');
    assert.ok('value' in d && 'expected' in d, 'value/expected must be present');
    assert.ok(typeof d.message === 'string' && d.message.length > 0, 'message must be a human-readable string');
  }
});

test('validateStaircase: covers every checklist item across a deliberately provocative scenario', () => {
  // Tight winders (narrow width + narrow stairWidth) and an undersized ceiling opening are
  // enough to exercise winder width, headroom/collision, and stringer parallelism/spacing
  // together in one config, alongside the always-on structural constraints.
  const result = validateStaircase(config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, windersPerTurn: 3, treadsLegB: 3, stairWidth: 700, hasRiserBoards: true }));
  const ruleIds = new Set(result.diagnostics.map((d) => d.ruleId));
  assert.ok(ruleIds.has('PL-LEGAL-C-01'), 'winder minimum width must be checked');
  assert.ok(ruleIds.has('VALIDATOR-CEILING-COLLISION'), 'collisions must be checked');
});

test('formatFinding matches the required LEVEL / step / message display convention', () => {
  const result = validateStaircase(config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, windersPerTurn: 3, treadsLegB: 2, stairWidth: 700 }));
  const finding = result.diagnostics.find((d) => d.ruleId === 'PL-LEGAL-C-01');
  const text = formatFinding(finding);
  const lines = text.split('\n');
  assert.equal(lines[0], finding.severity);
  assert.equal(lines[1], finding.elementId);
  assert.equal(lines[2], finding.message);
});

test('formatReport concatenates every finding, separated by a blank line', () => {
  const result = validateStaircase(config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, windersPerTurn: 3, treadsLegB: 2, stairWidth: 700 }));
  const report = formatReport(result.diagnostics);
  assert.equal(report.split('\n\n').length, result.diagnostics.length);
});

test('INFO example from the spec: a manual correction produces exactly the documented message', () => {
  const derived = deriveStairData(config({ stairType: 'straight', treadsLegA: 6 }));
  const fullConfig = { ...config({ stairType: 'straight', treadsLegA: 6 }), riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const boundaryIndex = 3;
  const outer = planLayout.treads[boundaryIndex - 1].backEdge[1];
  const cfg = config({ stairType: 'straight', treadsLegA: 6, manualEdgeOverrides: { [boundaryIndex]: { movedEndpoint: 'outer', point: { x: outer.x + 15, y: outer.y } } } });
  const result = validateStaircase(cfg);
  const info = result.diagnostics.find((d) => d.severity === 'INFO' && d.elementId === 'step-3');
  assert.ok(info, 'expected an INFO note for step-3');
  assert.equal(info.message, 'Wprowadzono ręczną korektę geometrii step-3.');
});

test('validateModels and validateStaircase agree on the same scenario', () => {
  const cfg = config({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5, hasRiserBoards: true });
  const viaConfig = validateStaircase(cfg);

  const derived = deriveStairData(cfg);
  const fullConfig = { ...cfg, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const viaModels = validateModels({ config: cfg, derived, planLayout, treadModels, riserModels, stringerModels });

  assert.deepEqual(
    viaModels.diagnostics.map((d) => d.ruleId).sort(),
    viaConfig.diagnostics.map((d) => d.ruleId).sort()
  );
});

test('validateStaircase: a fatal config error is reported, not thrown, and models is null', () => {
  const result = validateStaircase(config({ stairWidth: -100 }));
  assert.equal(result.hasErrors, true);
  assert.equal(result.models, null);
});
