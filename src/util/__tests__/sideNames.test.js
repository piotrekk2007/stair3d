import test from 'node:test';
import assert from 'node:assert/strict';

import { sideShort, sideAdjective, wangaName, sideGenitive, sideHand } from '../sideNames.js';
import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { updateInspectorPanel } from '../../ui/inspectorPanel.js';

test('side names: an L / U keeps zewn. / wewn.; an S is lewa / prawa — the inner line on the side of its first turn', () => {
  for (const stairType of ['L', 'U']) {
    const c = { stairType, turnDirection: 'left' };
    assert.equal(sideShort('outer', c), 'zewn.');
    assert.equal(sideShort('inner', c), 'wewn.');
    assert.equal(wangaName('inner', c), 'Wanga wewnętrzna (dusza)');
    assert.equal(sideHand('inner', c), null);
  }
  const left = { stairType: 'S', turnDirection: 'left' };
  assert.equal(sideShort('inner', left), 'lewa');
  assert.equal(sideShort('outer', left), 'prawa');
  assert.equal(wangaName('outer', left), 'Wanga prawa');
  assert.equal(sideGenitive('outer', left), 'prawej');
  const right = { stairType: 'S', turnDirection: 'right' };
  assert.equal(sideAdjective('inner', right), 'prawa');
  assert.equal(sideAdjective('outer', right), 'lewa');
  // the ceiling opening's balustrade has no side
  assert.equal(sideShort(null, left), 'przy otworze');
});

test('regression (user, 2026-10-23): an S names its wangi and balustrade lewa / prawa in the takeoff and the Inspektor', () => {
  const config = { ...createDefaultConfig(), stairType: 'S', turnDirection: 'left', treadsLegA: 4, treadsLegB: 2, treadsLegC: 3, windersPerTurn: 3, railingEnabled: true, railingSections: [{ id: 'r', side: 'outer', fromStep: 0, toStep: null }] };
  const b = buildStaircase(config);
  const notes = computeMaterialTakeoff(b, b.fullConfig).flatMap((i) => i.notes || []).join('\n');
  assert.ok(/Poręcz prawa/.test(notes), 'the outer balustrade of a first-left S is on the right');
  assert.ok(!/Poręcz zewn\./.test(notes));
  const panel = { innerHTML: '' };
  updateInspectorPanel(panel, { selection: { elementType: 'stringer', stringerId: 'inner' }, config, stringerModels: b.stringerModels, diagnostics: [] });
  assert.ok(panel.innerHTML.includes('Wanga lewa'), panel.innerHTML.slice(0, 120));
});
