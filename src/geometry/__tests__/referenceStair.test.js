import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildProjectPayload } from '../../project/projectIO.js';
import { referenceTransform, inverseReference, sanitizeReferenceStair } from '../referenceStair.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

// two straight stairs, 13 treads × 270 along +y, x 0..900; the lower one with a derived ceiling opening
const stairCfg = (patch = {}) => ({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, openingMode: 'derived', ...patch });
const file = (cfg) => JSON.parse(JSON.stringify(buildProjectPayload(cfg, { projectName: 'Piętro' })));
const withRef = (own, other, placement) => ({ ...own, referenceStair: { name: 'Piętro', level: 'above', file: file(other), dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false, ...placement } });
const ids = (b) => (b.reference?.diagnostics || []).map((d) => d.ruleId);

test('the placement (user decisions 2026-10-28): rotation, mirror, shift — and its inverse for „Zamień”', () => {
  const ref = { level: 'above', dxMm: 900, dyMm: 3510, rotationDeg: 180, mirror: false };
  const T = referenceTransform(ref, 2800, 2700);
  assert.deepEqual(T.toOwn({ x: 0, y: 0 }), { x: 900, y: 3510 });
  assert.deepEqual(T.toOwn({ x: 100, y: 200 }), { x: 800, y: 3310 });
  assert.deepEqual(T.toRef(T.toOwn({ x: 123, y: -45 })), { x: 123, y: -45 });
  assert.equal(T.dz, 2800, 'above: on this stair’s upper floor');
  assert.equal(referenceTransform({ ...ref, level: 'below' }, 2800, 2700).dz, -2700, 'below: it ends on this floor');
  for (const r of [ref, { ...ref, mirror: true }, { ...ref, rotationDeg: 90 }, { ...ref, rotationDeg: 270, mirror: true }]) {
    const inv = inverseReference(r);
    const A = referenceTransform(r, 2800, 2700);
    const B = referenceTransform({ ...inv }, 2700, 2800);
    for (const p of [{ x: 0, y: 0 }, { x: 350, y: -120 }, { x: -40, y: 900 }]) {
      const q = B.toOwn(A.toOwn(p));
      assert.ok(Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9, JSON.stringify(r));
    }
    assert.equal(inv.level, 'below');
    assert.deepEqual(sanitizeReferenceStair({ ...inverseReference(inv), file: {} }).rotationDeg, r.rotationDeg);
  }
});

test('the upper stair over the lower one’s opening, too low to walk under → ERROR REFERENCE-STAIR-HEADROOM on the lower treads (in the gate); beside it → nothing', () => {
  // the upper stair goes back over the lower one (rotated 180°, starting above the lower stair's top)
  const clash = buildStaircase(withRef(stairCfg(), stairCfg(), { dxMm: 900, dyMm: 3510, rotationDeg: 180 }));
  const d = clash.reference.diagnostics;
  assert.ok(d.length > 0);
  assert.ok(d.every((x) => x.ruleId === 'REFERENCE-STAIR-HEADROOM' && x.severity === 'ERROR' && x.elementType === 'tread'));
  assert.ok(d.every((x) => x.value < 2000));
  assert.ok(runTakeoffValidationGate(clash).errors.some((x) => x.ruleId === 'REFERENCE-STAIR-HEADROOM'));
  assert.ok(clash.referenceMesh?.getObjectByName('ReferenceStairClash'), 'a 3D marker per clash');
  assert.equal(clash.reference.planDrawing.treads.length, 13);
  const beside = buildStaircase(withRef(stairCfg(), stairCfg(), { dxMm: 3000 }));
  assert.deepEqual(ids(beside), []);
  assert.ok(beside.referenceMesh, 'still shown');
});

test('„Zamień”: seen from the upper stair (the lower one as the reference below) the same spots are reported — on the upper stair’s own parts', () => {
  const placement = { dxMm: 900, dyMm: 3510, rotationDeg: 180, mirror: false };
  const lowerView = buildStaircase(withRef(stairCfg(), stairCfg(), placement));
  const inv = inverseReference({ level: 'above', ...placement });
  const upperView = buildStaircase({ ...stairCfg(), referenceStair: { name: 'Parter', file: file(stairCfg()), ...inv } });
  const a = lowerView.reference.clashes.map((c) => Math.round(c.clearanceMm)).sort((x, y) => x - y);
  const b = upperView.reference.clashes.map((c) => Math.round(c.clearanceMm)).sort((x, y) => x - y);
  assert.deepEqual(b, a);
  assert.ok(upperView.reference.diagnostics.every((x) => ['tread', 'stringer', 'post'].includes(x.elementType)));
  assert.match(upperView.reference.diagnostics[0].message, /biegu niżej/);
});

test('a broken reference file is a WARNING, never a crash; no reference — no model', () => {
  const bad = buildStaircase({ ...stairCfg(), referenceStair: { name: 'x', level: 'above', file: { _type: 'nope' } } });
  assert.deepEqual(ids(bad), ['REFERENCE-STAIR-INVALID']);
  assert.equal(buildStaircase(stairCfg()).reference, null);
});
