import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../schema.js';
import { NEW_PROJECT_START } from '../newProject.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

test('a new project, once generated, has no design errors: its ceiling opening is derived from the stair (user decision 2026-10-28)', () => {
  // what "▶ Generuj schody" builds from a new project (main.js generateStair clears stairPending)
  const config = { ...createDefaultConfig(), ...NEW_PROJECT_START, stairPending: false };
  assert.equal(config.openingMode, 'derived');
  const gate = runTakeoffValidationGate(buildStaircase(config));
  assert.notEqual(gate.status, 'BLOCKED');
  assert.deepEqual(gate.errors.map((d) => d.ruleId), []);
  // an older project without the field keeps the schema's given opening
  assert.equal(createDefaultConfig().openingMode, 'given');
});
