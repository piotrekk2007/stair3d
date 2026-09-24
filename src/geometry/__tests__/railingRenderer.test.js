import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { renderRailing } from '../railingRenderer.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

function stair(patch = {}) {
  const config = {
    ...createDefaultConfig(),
    stairType: 'straight',
    treadsLegA: 8,
    totalRise: 2000,
    railingEnabled: true,
    railingSections: [{ id: 's', side: 'outer', fromStep: 0, toStep: null }],
    ...patch,
  };
  return { config, result: buildStaircase(config) };
}

const bounds = (mesh) => new THREE.Box3().setFromObject(mesh);

test('no balustrade group when it is switched off or has no sections', () => {
  assert.equal(stair({ railingEnabled: false }).result.root.getObjectByName('Railing'), undefined);
  const { result } = stair({ railingSections: [] });
  assert.equal(result.railingModel.sections.length, 0);
  assert.equal(result.root.getObjectByName('Railing').children.length, 0);
});

test('one handrail mesh, one balusters mesh and the new end posts per section, each traceable', () => {
  const { result } = stair();
  const group = result.root.getObjectByName('Railing');
  const names = group.children.map((c) => c.name);
  assert.ok(names.includes('Railing_s_handrail'));
  assert.ok(names.includes('Railing_s_balusters'));
  assert.equal(names.filter((n) => n.startsWith('Railing_railing-post-')).length, result.railingModel.sections[0].posts.length);
  for (const child of group.children) {
    assert.equal(child.userData.elementType, 'railing');
    assert.ok(child.userData.geometrySourceId.startsWith('railing:'));
  }
});

test('the balusters mesh spans exactly the solver\'s heights; the handrail top sits railingHeightMm above the nosing line at its start', () => {
  const { config, result } = stair();
  const section = result.railingModel.sections[0];
  const group = result.root.getObjectByName('Railing');
  const balusters = bounds(group.getObjectByName('Railing_s_balusters'));
  assert.ok(Math.abs(balusters.min.y - Math.min(...section.balusters.map((b) => b.zBottom))) < 1e-2);
  assert.ok(Math.abs(balusters.max.y - Math.max(...section.balusters.map((b) => b.zTop))) < 1e-2);
  const handrail = bounds(group.getObjectByName('Railing_s_handrail'));
  const riserHeight = deriveStairData(config).riserHeight;
  const topAtEnd = 9 * riserHeight + config.railingHeightMm; // the nosing line ends at the back of tread 8: (8+1) risers up
  assert.ok(handrail.max.y > riserHeight + config.railingHeightMm);
  assert.ok(handrail.max.y <= topAtEnd + config.railingHandrailHeightMm, 'never above the end of the nosing line plus the profile');
});

test('round profiles build too (round handrail + round balusters)', () => {
  const { result } = stair({ railingHandrailShape: 'round', railingBalusterShape: 'round' });
  const group = result.root.getObjectByName('Railing');
  assert.ok(group.getObjectByName('Railing_s_balusters').geometry.getAttribute('position').count > 0);
  assert.ok(group.getObjectByName('Railing_s_handrail').geometry.getAttribute('position').count > 0);
});

test('an invalid section renders nothing and does not throw', () => {
  const { result } = stair({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 6, toStep: 2 }] });
  assert.equal(result.root.getObjectByName('Railing').children.length, 0);
  assert.equal(result.railingModel.diagnostics.length, 1);
  assert.equal(typeof renderRailing, 'function');
});

test('a stale/invalid balustrade section shows up in the validation gate (Walidacja), as a WARNING that does not block the takeoff', () => {
  const { result } = stair({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 6, toStep: 2 }] });
  const gate = runTakeoffValidationGate(result);
  const finding = gate.diagnostics.find((d) => d.ruleId === 'RAILING-SECTION-INVALID');
  assert.ok(finding);
  assert.equal(finding.severity, 'WARNING');
  const baseline = runTakeoffValidationGate(stair({ railingSections: [] }).result);
  assert.equal(gate.errors.length, baseline.errors.length, 'the railing warning adds no ERROR, so it can never block the takeoff');
});
