import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { renderPlan2DSVG, planSvgBounds } from '../plan2dRenderer.js';

function plan(patch = {}, layers = {}) {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 8, totalRise: 2000, railingEnabled: true, railingSections: [{ id: 's', side: 'outer', fromStep: 1, toStep: 5 }], ...patch };
  const built = buildStaircase(config);
  const svg = renderPlan2DSVG(built.planLayout, built.fullConfig, built.derived, {
    viewport: planSvgBounds(built.planLayout, 600),
    layers,
    railingModel: built.railingModel,
    extraPosts: built.allPostModels.filter((p) => p.kind === 'railing'),
  });
  return { svg, built };
}

test('the plan shows each balustrade section: its path, the handrail run, one dot per baluster and a ring at both ends', () => {
  const { svg, built } = plan();
  const section = built.railingModel.sections[0];
  assert.ok(svg.includes('class="railing-section" data-section-id="s"'));
  const group = svg.slice(svg.indexOf('class="railing-section"'));
  const upToEnd = group.slice(0, group.indexOf('</g>'));
  assert.equal((upToEnd.match(/<circle [^>]*fill="#5a3d24"/g) || []).length, section.balusters.length);
  assert.equal((upToEnd.match(/stroke="#1a5fb4"/g) || []).length, 2, 'a ring at each end of the section');
  assert.ok(upToEnd.includes('stroke-dasharray'), 'the full path is drawn dashed');
});

test('the layer can be switched off, and nothing is drawn without a balustrade', () => {
  assert.ok(!plan({}, { railing: false }).svg.includes('railing-section'));
  assert.ok(!plan({ railingEnabled: false }).svg.includes('railing-section'));
});

test('an invalid section is not drawn', () => {
  assert.ok(!plan({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 6, toStep: 2 }] }).svg.includes('railing-section'));
});
