import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { concreteFromIndex, woodOnlyRailingSections } from '../concreteStair.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { buildStructuralReport } from '../../structural/index.js';
import { rawSlabTopZ } from '../floors.js';

// the client's case (user request 2026-11-02): a U with winders, wooden up to the first turn, concrete from there on
const uCfg = (patch = {}) => ({
  ...createDefaultConfig(),
  stairType: 'U',
  treadsLegA: 4,
  treadsLegB: 2,
  treadsLegC: 3,
  windersPerTurn: 3,
  railingEnabled: true,
  railingSections: [
    { id: 'o', side: 'outer', fromStep: 0, toStep: null },
    { id: 'i', side: 'inner', fromStep: 2, toStep: 9 },
  ],
  ...patch,
});
const len = ([a, b]) => Math.hypot(b.x - a.x, b.y - a.y);

test('which treads lie on concrete: the tread number given (1-based), by default the first tread of the first turn; only on wangi', () => {
  assert.equal(concreteFromIndex(uCfg(), 15), null, 'off by default');
  assert.equal(concreteFromIndex(uCfg({ concreteEnabled: true }), 15), 4, 'flight A + 1');
  assert.equal(concreteFromIndex(uCfg({ concreteEnabled: true, concreteFromTread: 7 }), 15), 6);
  assert.equal(concreteFromIndex(uCfg({ concreteEnabled: true, concreteFromTread: 99 }), 15), 14, 'clamped to the stair');
  assert.equal(concreteFromIndex(uCfg({ concreteEnabled: true, stairConstruction: 'cantilever' }), 15), null);
  assert.deepEqual(woodOnlyRailingSections([{ id: 'a', side: 'outer', fromStep: 0, toStep: null }, { id: 'b', side: 'inner', fromStep: 6, toStep: 9 }], 4), [{ id: 'a', side: 'outer', fromStep: 0, toStep: 3 }]);
});

test('a U wooden up to the turn, concrete from its first winder: wangi, posts and balustrade only on the wooden part; the concrete treads full width, not housed', () => {
  const b = buildStaircase(uCfg({ concreteEnabled: true }));
  const k = b.planLayout.concreteFromIndex;
  assert.equal(k, 4);
  assert.deepEqual(b.treadModels.filter((t) => t.onConcrete).map((t) => t.index), [...Array(b.treadModels.length - k).keys()].map((i) => i + k));
  for (const side of ['outer', 'inner']) {
    const borne = b.stringerModels[side].segments.flatMap((s) => s.treadBearings.map((x) => x.treadIndex));
    assert.ok(borne.length > 0 && borne.every((i) => i < k), `${side}: the wanga carries the wooden treads only`);
    // the board ends at the concrete with a plumb cut — not cut level at the floor like the stair's last board
    const g = b.stringerConstruction[side][b.stringerConstruction[side].length - 1];
    assert.ok(Math.max(...g.outerContour.map((p) => p.v)) < (k + 1) * b.derived.riserHeight + 500, `${side}: no part of the board reaches up to the slab`);
  }
  assert.deepEqual(b.postModels.filter((p) => p.kind !== 'railing').map((p) => p.postId), ['post-start'], 'no corner post in the concrete turn, no end newel');
  assert.ok(b.railingModel.sections.every((s) => s.toStep <= k - 1), 'no balustrade on the concrete');
  // housed wangi: a wooden tread is recessed into them, a tread on concrete runs from line to line
  const wood = b.treadModels[k - 1];
  const onConcrete = b.treadModels[b.treadModels.length - 1];
  assert.ok(len(wood.backEdge.final) < len(wood.backEdge.nominal) + 1e-6 && len(wood.backEdge.final) < b.fullConfig.stairWidth - 1);
  assert.ok(Math.abs(len(onConcrete.frontEdge.final) - b.fullConfig.stairWidth) < 1, 'full width');
  assert.equal(onConcrete.frontEdge.overridden, false, 'not reported as a manual edit');
  // nothing reports the missing wanga under a concrete tread; the structural check skips them
  const gate = runTakeoffValidationGate(b);
  assert.ok(!gate.errors.some((d) => d.ruleId === 'VALIDATOR-MISSING-SURFACE'), JSON.stringify(gate.errors.slice(0, 3)));
  // the boundary where the (recessed) wooden tread meets the (full-width) concrete one is one riser line
  assert.ok(!gate.errors.some((d) => d.ruleId === 'CONSTRAINT-TOPOLOGY-CONTINUITY'), 'the wood / concrete boundary is continuous');
  const report = buildStructuralReport(b);
  assert.ok(report.treads.skipped.filter((s) => /betonow/.test(s.reason)).length === b.treadModels.length - k);
});

test('the concrete flight: a block under every concrete step at its tread’s underside, one smooth soffit (slab thickness under the steps, never below the floor), cast into the slab at the top', () => {
  const cfg = uCfg({ concreteEnabled: true, hasRiserBoards: true, riserBoardThickness: 20 });
  const b = buildStaircase(cfg);
  const c = b.concrete;
  const h = b.derived.riserHeight;
  const tt = b.fullConfig.treadThickness;
  const steps = c.blocks.filter((x) => x.treadIndex !== null);
  assert.deepEqual([...new Set(steps.map((x) => x.treadIndex))], b.treadModels.filter((t) => t.onConcrete).map((t) => t.index));
  for (const x of steps) {
    assert.ok(Math.abs(x.topZ - b.treadModels[x.treadIndex].elevation.bottom) < 1e-6, 'top = the tread’s underside');
    assert.ok(x.bottomZ.every((z) => z >= 0 && z < x.topZ));
  }
  // the soffit is continuous: where step i ends and step i+1 begins both give the same height
  const plumb = 150 / Math.cos(Math.atan2(h, b.fullConfig.treadGoing));
  for (let i = c.fromIndex; i < b.treadModels.length - 1; i++) {
    const expected = (i + 1) * h - tt - plumb;
    const lows = steps.filter((x) => x.treadIndex === i + 1).flatMap((x) => x.bottomZ);
    assert.ok(Math.abs(Math.min(...lows) - Math.max(0, expected)) < 1, `step ${i + 1} starts on the soffit where step ${i} ends`);
  }
  const top = c.blocks.find((x) => x.treadIndex === null);
  assert.ok(top && Math.abs(top.topZ - rawSlabTopZ(b.fullConfig)) < 1e-6);
  assert.ok(c.volumeM3 > 0.3 && c.volumeM3 < 3, String(c.volumeM3));
  // in 3D: its own layer
  const group = b.root.getObjectByName('Concrete');
  assert.ok(group && group.children.length === c.blocks.length);
  // off: none of it
  const off = buildStaircase(uCfg());
  assert.equal(off.concrete, null);
  assert.equal(off.root.getObjectByName('Concrete'), undefined);
  assert.ok(off.treadModels.every((t) => !t.onConcrete));
});
