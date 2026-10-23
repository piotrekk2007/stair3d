import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { buildStructuralReport } from '../../structural/index.js';
import { updateStructuralPanel } from '../structuralPanel.js';
import { updateInfoPanel } from '../ui.js';
import { updateInspectorPanel } from '../inspectorPanel.js';

// The side panels filled from a real stair, as rebuild() does — every stair type, with and without the stairwell
// (a panel that throws stops rebuild() half-way: the plan / 3D no longer follow the parameters).
const cases = [
  ['L', {}],
  ['U', {}],
  ['S', {}],
  ['S', { stairwellRoomEnabled: true, stairwellSideAMm: 2400, stairwellSideBMm: 1900, stairwellSideCMm: 1200, stairwellSideAFixed: true, stairwellSideBFixed: true, stairwellSideCFixed: true }],
];

test('regression (user, 2026-10-23): the side panels render for every stair type — the Konstrukcja panel and the stairwell rows used to throw (a name helper read a `config` out of scope)', () => {
  for (const [stairType, patch] of cases) {
    const config = { ...createDefaultConfig(), stairType, turnDirection: 'left', treadsLegA: 4, treadsLegB: 2, treadsLegC: 3, windersPerTurn: 3, railingEnabled: true, railingSections: [{ id: 'r', side: 'outer', fromStep: 0, toStep: null }], ...patch };
    const b = buildStaircase(config);
    const label = `${stairType}${patch.stairwellRoomEnabled ? ' in a stairwell' : ''}`;
    const structural = { innerHTML: '' };
    assert.doesNotThrow(() => updateStructuralPanel(structural, buildStructuralReport(b), config), label);
    assert.ok(structural.innerHTML.length > 0);
    const info = { innerHTML: '' };
    assert.doesNotThrow(() => updateInfoPanel(info, b.derived, b.planLayout, config, b.ceilingFit, b.stairwellFit), label);
    for (const selection of [{ elementType: 'stringer', stringerId: 'outer' }, { elementType: 'tread', stepIndex: 0 }, { elementType: 'post', postId: 'post-start' }, null]) {
      const panel = { innerHTML: '' };
      assert.doesNotThrow(() => updateInspectorPanel(panel, { selection, config, derived: b.derived, planLayout: b.planLayout, treadModels: b.treadModels, stringerModels: b.stringerModels, postModels: b.allPostModels, railingModel: b.railingModel, diagnostics: [] }), `${label}: ${selection?.elementType ?? 'summary'}`);
    }
  }
});
