import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { buildPartList, partsForSelection } from '../partCodes.js';
import { labelsFor, labelSheetHTML } from '../labelSheet.js';

const L = (patch = {}) => buildStaircase({ ...createDefaultConfig(), hasRiserBoards: true, ...patch });
const codes = (b) => buildPartList(b).parts.map((p) => p.code);

test('part codes (user decisions 2026-10-28): by type, numbered walking up — a tread keeps its plan number, a fan riser one code per panel, the wangi per side, the posts', () => {
  const b = L();
  const { parts } = buildPartList(b);
  const c = parts.map((p) => p.code);
  assert.equal(new Set(c).size, c.length, 'every code once');
  b.treadModels.forEach((t) => assert.ok(c.includes(`ST-${String(t.index + 1).padStart(2, '0')}`)));
  assert.equal(parts.find((p) => p.code === 'ST-06').name, 'Stopień zabiegowy 6');
  // a winder's fan riser: one piece per flat panel, each with its own length
  const fan = b.riserModels.find((r) => r.panels.length > 1);
  const n = Number(fan.stepId.split('-')[1]) + 1;
  const fanParts = parts.filter((p) => p.code.startsWith(`PS-${String(n).padStart(2, '0')}`));
  assert.equal(fanParts.length, fan.panels.length);
  assert.match(fanParts[0].code, /a$/);
  assert.match(fanParts[0].dimensions, new RegExp(`dł. ${Math.round(fan.panels[0].width)} `));
  assert.ok(c.includes('PS-G'), 'the top riser');
  assert.deepEqual(c.filter((x) => /^W[ZW]-/.test(x)), ['WZ-1', 'WZ-2', 'WW-1', 'WW-2']);
  assert.deepEqual(c.filter((x) => x.startsWith('SL-')), ['SL-1', 'SL-2', 'SL-3']);
  // no hardware, no housings
  assert.ok(!parts.some((p) => p.elementType === 'CONNECTOR' || p.elementType === 'STRINGER_HOUSING'));
});

test('part codes exist with design errors too (no gate); an S names its wangi left / right; a cantilever tread’s cladding boards ST-01.1 …', () => {
  const tooLow = L({ minHeadroom: 3500 });
  assert.ok(codes(tooLow).includes('ST-01'));
  const s = codes(buildStaircase({ ...createDefaultConfig(), stairType: 'S', treadsLegA: 3, treadsLegB: 3, treadsLegC: 3, turnType: 'winder' }));
  assert.ok(s.some((x) => x.startsWith('WL-')) && s.some((x) => x.startsWith('WP-')));
  const cant = codes(buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, stairConstruction: 'cantilever' }));
  assert.ok(cant.includes('ST-01.1') && cant.includes('ST-01.2'));
  assert.ok(!cant.some((x) => /^W[ZW]-/.test(x)));
});

test('the Inspektor’s codes for a selection: a tread → its tread and riser; a wanga → its board (or the whole side); a post', () => {
  const b = L();
  const list = buildPartList(b);
  assert.deepEqual(partsForSelection(list, { elementType: 'tread', stepIndex: 0 }).map((p) => p.code), ['ST-01', 'PS-01']);
  const seg = b.stringerModels.outer.segments[1].id;
  assert.deepEqual(partsForSelection(list, { elementType: 'stringer', stringerId: 'outer', segmentId: seg }).map((p) => p.code), ['WZ-2']);
  assert.equal(partsForSelection(list, { elementType: 'stringer', stringerId: 'inner', segmentId: null }).length, 2);
  assert.deepEqual(partsForSelection(list, { elementType: 'post', postId: 'post-start' }).map((p) => p.code), ['SL-1']);
  assert.deepEqual(partsForSelection(null, { elementType: 'post', postId: 'post-start' }), []);
});

test('the label sheet: one label per piece, bulk parts once with their count, A4 pages of the chosen sheet', () => {
  const parts = [
    { code: 'ST-01', name: 'Stopień 1', dimensions: 'dł. 900 mm', material: 'dąb', quantity: 1, elementType: 'TREAD' },
    { code: 'TR-1', name: 'Tralki', dimensions: 'dł. 800 mm', material: 'dąb', quantity: 24, elementType: 'BALUSTER' },
    { code: 'SL-1', name: 'Słup', dimensions: '', material: 'dąb', quantity: 2, elementType: 'POST' },
  ];
  const labels = labelsFor(parts);
  assert.deepEqual(labels.map((l) => [l.code, l.count, l.copy]), [['ST-01', null, null], ['TR-1', 24, null], ['SL-1', null, '1/2'], ['SL-1', null, '2/2']]);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...parts[0], code: `ST-${i + 1}` }));
  const html = labelSheetHTML({ parts: many, projectName: 'Kowalski <dom>', layout: '3x8', date: '28.10.2026' });
  assert.equal((html.match(/class="page"/g) || []).length, 2, '24 per sheet');
  assert.equal((html.match(/class="label"/g) || []).length, 30);
  assert.match(html, /Kowalski &lt;dom&gt; · 28\.10\.2026/);
  assert.match(html, /grid-template-columns: repeat\(3, 70mm\)/);
  assert.match(labelSheetHTML({ parts: many, layout: '2x7' }), /grid-template-columns: repeat\(2, 105mm\)/);
});
