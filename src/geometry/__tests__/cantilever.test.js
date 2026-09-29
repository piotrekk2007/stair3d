import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { cantileverBoxHeightMm, cantileverParams } from '../cantileverModel.js';
import { polygonArea, clipToConvex } from '../polygonClip.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { runTakeoffValidationGate } from '../../takeoff/index.js';
import { buildTreadDXF } from '../../export/dxfExport.js';
import { stairFacts } from '../../offer/offerModel.js';

const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairConstruction: 'cantilever', ...patch });
const byKind = (t) => Object.fromEntries(t.cantilever.parts.map((p) => [p.kind, p]));

test('box height = profile + clearance + top + bottom; the tread IS the box; at least 2 profiles', () => {
  const c = createDefaultConfig();
  assert.equal(cantileverBoxHeightMm(c), 60 + 2 + 40 + 20);
  assert.equal(cantileverParams({ ...c, cantileverProfileCount: 1 }).profileCount, 2, 'never fewer than 2');
  const m = build({ stairType: 'straight', treadsLegA: 10, cantileverProfileHeightMm: 80 });
  for (const t of m.treadModels) {
    assert.equal(t.thickness, 80 + 2 + 40 + 20);
    assert.equal(t.cantilever.heightMm, t.thickness);
    assert.equal(t.cantilever.profiles.length, 2);
  }
});

test('the five boards: top 40 over everything, front 40 and back 20 under it, bottom between them, side at the free end', () => {
  const m = build({ stairType: 'straight', treadsLegA: 10 });
  const p = cantileverParams(m.fullConfig);
  for (const t of m.treadModels) {
    const k = byKind(t);
    assert.deepEqual(Object.keys(k).sort(), ['back', 'bottom', 'front', 'side', 'top']);
    const top = t.elevation.top;
    const bottom = t.elevation.bottom;
    assert.deepEqual([k.top.zBottom, k.top.zTop, k.top.thicknessMm], [top - p.topMm, top, 40]);
    assert.deepEqual([k.front.zBottom, k.front.zTop, k.front.thicknessMm], [bottom, top - p.topMm, 40]);
    assert.deepEqual([k.back.zBottom, k.back.zTop, k.back.thicknessMm], [bottom, top - p.topMm, 20]);
    assert.deepEqual([k.bottom.zBottom, k.bottom.zTop], [bottom, bottom + 20]);
    assert.deepEqual([k.side.zBottom, k.side.zTop], [bottom + 20, top - p.topMm]);
    // the boards under the top do not overlap each other in plan (front/back vs bottom vs side)
    for (const [a, b] of [['front', 'bottom'], ['back', 'bottom'], ['front', 'side'], ['back', 'side']]) {
      assert.ok(polygonArea(clipToConvex(k[b].outline, k[a].outline)) < 1, `${t.stepId}: ${a} overlaps ${b}`);
    }
    // front strip is exactly the front thickness deep along the going, back the shell thickness
    const going = Math.abs((t.backEdge.final[0].x - t.frontEdge.final[0].x) * t.direction.x + (t.backEdge.final[0].y - t.frontEdge.final[0].y) * t.direction.y);
    const width = polygonArea(k.front.outline) / 40;
    assert.ok(Math.abs(polygonArea(k.bottom.outline) - width * (going - 40 - 20)) < 1, `${t.stepId}: bottom between front and back`);
  }
});

test('the box ends a small gap before the wall; profiles come square out of the wall, inside the box', () => {
  const m = build({ stairType: 'straight', treadsLegA: 10, cantileverWallGapMm: 8 });
  for (const [i, t] of m.treadModels.entries()) {
    const wall = m.planLayout.treads[i].outerChain;
    const d = { x: wall[1].x - wall[0].x, y: wall[1].y - wall[0].y };
    const L = Math.hypot(d.x, d.y);
    const dist = (q) => Math.abs((q.x - wall[0].x) * d.y - (q.y - wall[0].y) * d.x) / L;
    assert.ok(Math.abs(Math.min(...t.frontEdge.final.map(dist)) - 8) < 1e-6, 'box ends 8 mm from the wall');
    for (const pr of t.cantilever.profiles) {
      assert.ok(Math.abs(pr.dir.x * d.x + pr.dir.y * d.y) < 1e-6, 'square to the wall');
      assert.ok(dist(pr.start) < 1e-6, 'starts on the wall line');
    }
  }
  assert.deepEqual(m.cantilever.diagnostics, [], 'a straight flight fits');
});

test('no wangi, no structural posts, no risers — and no false "gap in the stringer" error; winders report short profiles', () => {
  const m = build({ stairType: 'L' });
  assert.equal(m.stringerModels.outer.segments.length + m.stringerModels.inner.segments.length, 0);
  assert.equal(m.postModels.filter((p) => p.kind !== 'railing').length, 0);
  assert.equal(m.riserModels.length, 0);
  const gate = runTakeoffValidationGate(m);
  assert.ok(!gate.diagnostics.some((d) => d.ruleId === 'VALIDATOR-MISSING-SURFACE'), 'the absent stringer is not a gap');
  // winder boxes near the corner cannot hold a 700 mm profile: reported with how long one may be there
  assert.ok(m.cantilever.diagnostics.length > 0);
  assert.ok(m.cantilever.diagnostics.every((d) => d.ruleId === 'CANTILEVER-PROFILE' && d.severity === 'WARNING'));
  assert.ok(m.cantilever.diagnostics.some((d) => /mieści się profil do ok\. \d+ mm/.test(d.message)));
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'CANTILEVER-PROFILE'), 'through the validation gate');
  // the same stair on stringers has no such findings and keeps its wangi
  const plain = buildStaircase({ ...createDefaultConfig(), stairType: 'L' });
  assert.ok(plain.stringerModels.outer.segments.length > 0);
  assert.equal(plain.cantilever, null);
  // too wide a box is reported
  const wide = build({ stairType: 'straight', treadsLegA: 10, stairWidth: 2000 });
  assert.ok(wide.cantilever.diagnostics.some((d) => d.ruleId === 'CANTILEVER-WIDTH'));
});

test('takeoff: one board item per cladding part, in its thickness; DXF lists the parts; offer names the construction', () => {
  const m = build({ stairType: 'straight', treadsLegA: 10 });
  const items = computeMaterialTakeoff(m, m.fullConfig);
  const t0 = items.filter((i) => i.sourceElementId.startsWith('tread:step-0:'));
  assert.deepEqual(t0.map((i) => i.sourceElementId.split(':')[2]).sort(), ['back', 'bottom', 'front', 'side', 'top']);
  const thk = Object.fromEntries(t0.map((i) => [i.sourceElementId.split(':')[2], i.calculatedDimensions.thicknessMm]));
  assert.deepEqual(thk, { top: 40, front: 40, back: 20, bottom: 20, side: 20 });
  assert.ok(!items.some((i) => i.elementType === 'STRINGER' || i.elementType === 'RISER'));
  const dxf = buildTreadDXF(m.treadModels[0]);
  assert.match(dxf, /Stopien wspornikowy - okladzina \(skrzynka\) wys\. 122 mm/);
  assert.match(dxf, /front 40 mm: formatka \d+ x \d+ mm/);
  assert.match(dxf, /Profile: 2 x 40x60 mm/);
  const facts = stairFacts(m.fullConfig, m.derived);
  assert.ok(facts.rows.some(([k, v]) => k === 'Konstrukcja' && /wspornikowe/.test(v)));
});
