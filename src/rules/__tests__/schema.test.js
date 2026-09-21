// Tests for the schema extension added by the stringer-construction "technical specification
// lock" stage: RULE_TYPES.SOFTWARE_DESIGN_CHOICE, RULE_STATUS, CONSTRUCTION_TYPE_SCOPES, and
// assertValidRule's new optional-field validation. Pure data-layer tests — no geometry.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertValidRule, RULE_TYPES, RULE_STATUS, CONSTRUCTION_TYPE_SCOPES, defineRuleSet } from '../schema.js';
import { getFullCatalogue, getRulesByStatus, getRulesByConstructionType, getRuleById } from '../catalogue.js';
import { stringerConstructionAssumptions } from '../sets/stringerConstructionAssumptions.js';

function baseRule(overrides = {}) {
  return {
    ruleId: 'TEST-RULE',
    category: 'F',
    description: 'test',
    ruleType: 'SOFTWARE_DESIGN_CHOICE',
    jurisdiction: 'COMPANY',
    source: 'test',
    severity: 'INFO',
    blocksGeneration: false,
    ...overrides,
  };
}

test('RULE_TYPES includes SOFTWARE_DESIGN_CHOICE', () => {
  assert.equal(RULE_TYPES.SOFTWARE_DESIGN_CHOICE, 'SOFTWARE_DESIGN_CHOICE');
});

test('RULE_STATUS has exactly CONFIRMED/ASSUMPTION/CONFIGURABLE', () => {
  assert.deepEqual(Object.keys(RULE_STATUS).sort(), ['ASSUMPTION', 'CONFIGURABLE', 'CONFIRMED']);
});

test('assertValidRule accepts a rule with no status/constructionType (backward compatible)', () => {
  assert.doesNotThrow(() => assertValidRule(baseRule()));
});

test('assertValidRule accepts every valid status value', () => {
  for (const status of Object.keys(RULE_STATUS)) {
    assert.doesNotThrow(() => assertValidRule(baseRule({ status })));
  }
});

test('assertValidRule rejects an unknown status', () => {
  assert.throws(() => assertValidRule(baseRule({ status: 'MAYBE' })), /unknown status/);
});

test('assertValidRule accepts every valid constructionType value, and null', () => {
  for (const constructionType of Object.values(CONSTRUCTION_TYPE_SCOPES)) {
    assert.doesNotThrow(() => assertValidRule(baseRule({ constructionType })));
  }
  assert.doesNotThrow(() => assertValidRule(baseRule({ constructionType: null })));
});

test('assertValidRule rejects an unknown constructionType', () => {
  assert.throws(() => assertValidRule(baseRule({ constructionType: 'diagonal' })), /unknown constructionType/);
});

test('stringerConstructionAssumptions rule set is well-formed (every entry passes assertValidRule via defineRuleSet)', () => {
  assert.doesNotThrow(() => defineRuleSet(stringerConstructionAssumptions));
  assert.ok(stringerConstructionAssumptions.length > 0);
});

test('every stringerConstructionAssumptions rule declares status, constructionType, and all three "affects" flags', () => {
  for (const rule of stringerConstructionAssumptions) {
    assert.ok(rule.status, `${rule.ruleId} must declare a status`);
    assert.ok(rule.constructionType, `${rule.ruleId} must declare a constructionType`);
    assert.equal(typeof rule.affectsGeometry, 'boolean', `${rule.ruleId}.affectsGeometry must be a boolean`);
    assert.equal(typeof rule.affectsValidation, 'boolean', `${rule.ruleId}.affectsValidation must be a boolean`);
    assert.equal(typeof rule.affectsMaterialTakeoff, 'boolean', `${rule.ruleId}.affectsMaterialTakeoff must be a boolean`);
  }
});

test('no CONFIGURABLE-status rule is presented with blocksGeneration:true (a configurable default must never be enforced as mandatory)', () => {
  for (const rule of getRulesByStatus('CONFIGURABLE')) {
    assert.equal(rule.blocksGeneration, false, `${rule.ruleId} is CONFIGURABLE — it must never block generation`);
  }
});

test('the stringer-construction rule set is reachable through the full catalogue', () => {
  const ids = new Set(getFullCatalogue().map((r) => r.ruleId));
  for (const rule of stringerConstructionAssumptions) {
    assert.ok(ids.has(rule.ruleId), `${rule.ruleId} must be present in the full catalogue`);
  }
});

test('getRulesByConstructionType("cut") returns cut-specific and "both" rules, never closed-only rules', () => {
  const rules = getRulesByConstructionType('cut');
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.notEqual(rule.constructionType, 'closed');
  }
  assert.ok(!rules.some((r) => r.ruleId === 'STAIR3D-STRINGER-CLEATS-OPTIONALITY'), 'cleats were removed from the model');
});

test('getRuleById resolves a stringer-construction rule by id', () => {
  const rule = getRuleById('STAIR3D-STRINGER-PITCH-LINE-METHOD');
  assert.ok(rule);
  assert.equal(rule.status, 'ASSUMPTION');
  assert.equal(rule.needsVerification, true);
});
