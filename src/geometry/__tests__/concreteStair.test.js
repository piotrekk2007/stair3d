import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { concreteFromIndex, woodOnlyRailingSections } from '../concreteStair.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { buildStructuralReport } from '../../structural/index.js';
import { rawSlabTopZ, slabSoffitZ } from '../floors.js';

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
  const sections = [{ id: 'a', side: 'outer', fromStep: 0, toStep: null }, { id: 'b', side: 'inner', fromStep: 6, toStep: 9 }];
  assert.deepEqual(woodOnlyRailingSections(sections, { from: 4, to: 14 }, 14), [{ id: 'a', side: 'outer', fromStep: 0, toStep: 3 }]);
  // a lower concrete part: what lies above it stays
  assert.deepEqual(woodOnlyRailingSections(sections, { from: 0, to: 6 }, 14), [{ id: 'a', side: 'outer', fromStep: 7, toStep: null }, { id: 'b', side: 'inner', fromStep: 7, toStep: 9 }]);
  // concrete in the middle: a section across it in two
  assert.deepEqual(woodOnlyRailingSections([sections[0]], { from: 4, to: 8 }, 14).map((s) => [s.id, s.fromStep, s.toStep]), [['a', 0, 3], ['a-b', 9, null]]);
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
  // (where the opening runs on past the last step, the piece at the floor reaching the slab's edge)
  const top = c.blocks.find((x) => x.treadIndex === null);
  if (top) assert.ok(Math.abs(top.topZ - rawSlabTopZ(b.fullConfig)) < 1e-6 && Math.max(...top.bottomZ) <= slabSoffitZ(b.fullConfig) + 1e-6);
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

test('regression (user, 2026-11-02, "Schody_Pasek_1"): a U with one 180° winder zone and the concrete starting right after the dusza’s turning point — the inner wanga is ONE board, no zero-length second board (the profile editor could not edit it)', () => {
  const cfg = uCfg({ treadsLegA: 6, treadsLegB: 0, treadsLegC: 2, windersPerTurn: 5, uSingleWinderZone: true, uWindersTotal: 6, uAxisGapMm: 40, hasCornerPost: false, concreteEnabled: true, concreteFromTread: 10 });
  const b = buildStaircase(cfg);
  for (const side of ['inner', 'outer']) {
    for (const s of b.stringerModels[side].segments) assert.ok(s.referenceLine.length > 1 && s.treadBearings.length > 0, `${side} ${s.id}: ${Math.round(s.referenceLine.length)} mm, ${s.treadBearings.length} treads`);
  }
  assert.equal(b.stringerModels.inner.segments.length, 1);
  assert.ok(b.stringerConstruction.inner.every((g) => g.outerContour.length > 0));
});

// the client's project (user report 2026-11-02, "Schody_Pasek_1"): one 180° zone, concrete from tread 10, the ceiling
// opening given so that the slab starts right behind the last step
const pasek = (patch = {}) =>
  uCfg({
    treadsLegA: 6, treadsLegB: 0, treadsLegC: 2, windersPerTurn: 5, uSingleWinderZone: true, uWindersTotal: 6, uAxisGapMm: 40, hasCornerPost: false,
    totalRise: 3145, treadGoing: 269.37, stairwellRoomEnabled: true, stairwellSideAMm: 2008, stairwellSideBMm: 1800, stairwellSideCMm: 1540,
    stairwellSideAState: 'free', stairwellSideBState: 'rigid', stairwellSideCState: 'main', stairwellManualCounts: true, ceilingThickness: 250,
    openingShape: 'polygon', openingMode: 'given',
    openingPolygon: [{ x: 1800.1, y: 1540 }, { x: 1800.1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2079.5 }, { x: 903.6, y: 2089.5 }, { x: 903.6, y: 1540 }],
    concreteEnabled: true, concreteFromTread: 10, ...patch,
  });

test('regression (user, 2026-11-02): the slab starts right behind the last concrete step — no block past it (it hung 190 mm below the slab like a third step)', () => {
  const b = buildStaircase(pasek());
  const lastBack = b.planLayout.treads.at(-1).backEdge;
  assert.ok(lastBack.every((p) => b.ceilingFit.openingOutline.some((q) => Math.abs(q.y - p.y) < 1)), 'the opening ends at the last back edge');
  assert.equal(b.concrete.blocks.filter((x) => x.treadIndex === null).length, 0);
  assert.ok(b.concrete.blocks.every((x) => x.treadIndex !== null));
});

test('a wall under the concrete flight (user request 2026-11-02): along the chosen edge, the wall’s thickness into the stair, from the floor up to the soffit — not up to the slab', () => {
  const none = buildStaircase(pasek());
  assert.deepEqual(none.concrete.walls, []);
  const b = buildStaircase(pasek({ concreteWallSide: 'inner', concreteWallThicknessMm: 120 }));
  const c = b.concrete;
  assert.ok(c.walls.length > 0 && c.walls.every((w) => w.side === 'inner'));
  assert.deepEqual([...new Set(c.walls.map((w) => w.treadIndex))], b.treadModels.filter((t) => t.onConcrete).map((t) => t.index));
  for (const w of c.walls) {
    assert.ok(w.bottomZ.every((z) => z === 0), 'from the floor');
    const step = c.blocks.filter((x) => x.treadIndex === w.treadIndex);
    assert.ok(Math.max(...w.topZ) <= Math.max(...step.map((x) => x.topZ)) && Math.max(...w.topZ) < slabSoffitZ(b.fullConfig), 'up to the soffit only');
    if (w.toWall) continue; // (the piece carried back to the wall across — next test)
    // within the wall's thickness of the inner line
    const line = b.planLayout.treads[w.treadIndex].innerChain;
    const dist = (p) => Math.min(...line.slice(1).map((q, k) => { const a = line[k]; const dx = q.x - a.x, dy = q.y - a.y, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); }));
    assert.ok(w.outline.every((p) => dist(p) <= 120 * Math.SQRT2 + 1), JSON.stringify(w.outline));
  }
  assert.ok(b.root.getObjectByName('Concrete').children.some((m) => m.name.startsWith('ConcreteWall-inner')));
  const both = buildStaircase(pasek({ concreteWallSide: 'both' }));
  assert.deepEqual([...new Set(both.concrete.walls.map((w) => w.side))].sort(), ['inner', 'outer']);
});

test('regression (user, 2026-11-02): the wall under the concrete flight runs on back along its line, under the first concrete winder, to the nearest wall across it — up to that step’s soffit', () => {
  const b = buildStaircase(pasek({ concreteWallSide: 'inner', concreteWallThicknessMm: 120 }));
  const carried = b.concrete.walls.filter((w) => w.toWall);
  assert.ok(carried.length > 0, 'carried on');
  // in this stair: along x = 900 (the dusza line of flight C) from the dusza's turning point to the stairwell wall B
  const wallB = Math.max(...b.stairwellWalls.pieces.filter((p) => Math.abs(p.a.y - p.b.y) < 1).map((p) => p.a.y));
  const reach = Math.max(...carried.flatMap((w) => w.outline.map((p) => p.y)));
  assert.ok(Math.abs(reach - wallB) < 1, `reaches the wall across (${Math.round(reach)} vs ${Math.round(wallB)})`);
  assert.ok(carried.every((w) => w.outline.every((p) => p.x >= 900 - 1e-6 && p.x <= 1020 + 1e-6)), 'the wall’s thickness into the stair, on the same line');
  for (const w of carried) {
    const block = b.concrete.blocks.find((x) => x.treadIndex === w.treadIndex);
    assert.ok(w.bottomZ.every((z) => z === 0) && Math.max(...w.topZ) < block.topZ, 'from the floor up to the soffit');
  }
  // no wall across → nothing carried on
  const open = buildStaircase(pasek({ concreteWallSide: 'inner', stairwellRoomEnabled: false }));
  assert.ok(open.concrete.walls.every((w) => !w.toWall));
});

test('a wall above the concrete flight (user request 2026-11-02, the flight cast between walls): full height, the treads and risers on the concrete end at its face — shorter by its thickness, not a manual edit; the wooden part keeps its housing', () => {
  const base = uCfg({ concreteEnabled: true, hasRiserBoards: true, riserBoardThickness: 20 });
  const plain = buildStaircase(base);
  const walled = buildStaircase({ ...base, concreteWallSide: 'outer', concreteWallThicknessMm: 120, concreteWallAbove: true });
  const k = walled.planLayout.concreteFromIndex;
  for (const t of walled.treadModels) {
    const before = plain.treadModels[t.index];
    const d = len(before.frontEdge.final) - len(t.frontEdge.final);
    if (t.onConcrete) {
      if (t.type === 'straight') assert.ok(Math.abs(d - 120) < 1e-6, `tread ${t.index}: ${d}`);
      assert.equal(t.frontEdge.overridden, false);
    } else assert.ok(Math.abs(d) < 1e-6, `wooden tread ${t.index} unchanged`);
  }
  const walls = walled.concrete.walls;
  assert.ok(walls.length > 0 && walls.filter((w) => !w.toWall).every((w) => w.above && w.topZ.every((z) => Math.abs(z - rawSlabTopZ(walled.fullConfig)) < 1e-6)), 'up to the floor above');
  assert.ok(walls.every((w) => w.side === 'outer'));
  assert.ok(runTakeoffValidationGate(walled).errors.every((d) => d.ruleId !== 'CONSTRAINT-TOPOLOGY-CONTINUITY'));
  assert.ok(walled.treadModels[k].onConcrete);
});

test('the LOWER part on concrete (user request 2026-11-02): from the floor to the tread given, the wooden flight above standing on its last step; balustrade and posts on the wooden part only', () => {
  const b = buildStaircase(uCfg({ concreteEnabled: true, concretePart: 'lower', concreteToTread: 4 }));
  assert.deepEqual(b.planLayout.concreteRange, { from: 0, to: 3 });
  assert.deepEqual(b.treadModels.filter((t) => t.onConcrete).map((t) => t.index), [0, 1, 2, 3]);
  const h = b.derived.riserHeight;
  for (const side of ['outer', 'inner']) {
    const borne = b.stringerModels[side].segments.flatMap((s) => s.treadBearings.map((x) => x.treadIndex));
    assert.ok(borne.length && borne.every((i) => i >= 4), side);
    const first = b.stringerConstruction[side][0];
    // the first board's foot stands on the top of the last concrete step, not on the floor
    assert.ok(Math.abs(Math.min(...first.outerContour.map((p) => p.v)) - 4 * h) < 0.1, `${side} foot at ${Math.min(...first.outerContour.map((p) => p.v))}`);
    // and no board of the wooden flight reaches below it
    for (const g of b.stringerConstruction[side]) assert.ok(Math.min(...g.outerContour.map((p) => p.v)) > 4 * h - 0.1, `${side} ${g.segmentId}`);
  }
  assert.ok(!b.postModels.some((p) => p.postId === 'post-start'), 'no start newel down on the floor');
  assert.ok(b.railingModel.sections.every((s) => s.fromStep >= 4));
  const c = b.concrete;
  assert.equal(c.part, 'lower');
  assert.deepEqual([...new Set(c.blocks.map((x) => x.treadIndex))], [0, 1, 2, 3], 'no block into the slab: the flight goes on in wood');
  assert.ok(c.blocks.filter((x) => x.treadIndex === 0).every((x) => x.bottomZ.every((z) => z === 0)), 'solid at the floor');
  assert.ok(!runTakeoffValidationGate(b).errors.some((d) => ['CONSTRAINT-TOPOLOGY-CONTINUITY', 'VALIDATOR-MISSING-SURFACE'].includes(d.ruleId)));
});
