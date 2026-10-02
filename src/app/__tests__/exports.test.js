import test from 'node:test';
import assert from 'node:assert/strict';

import { projectFileBaseName } from '../exports.js';

test('projectFileBaseName: the project name as a safe file-name stem (Polish letters kept), "schody" when empty', () => {
  assert.equal(projectFileBaseName('Dom Kowalskich — schody L'), 'Dom_Kowalskich_schody_L');
  assert.equal(projectFileBaseName('  Łódź/ćwierć  '), 'Łódź_ćwierć');
  assert.equal(projectFileBaseName(''), 'schody');
  assert.equal(projectFileBaseName(undefined), 'schody');
  assert.equal(projectFileBaseName('***'), 'schody');
});
