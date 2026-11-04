import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { claddingProjectToFile, parseCladdingProjectFile } from '../projectFile.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';

const cfg = (patch = {}) => ({ ...createDefaultCladdingConfig(), ...patch });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const straight = (patch = {}) => cfg({ sequence: [{ kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 }, { kind: 'steps', count: 2, riseMm: 185, goingMm: 265, widthMm: 900 }], ...patch });
const xs = (o) => o.map((p) => p.x);
const ys = (o) => o.map((p) => p.y);

test('the sequence in walking order: groups expanded, every step its measured rise / going / width, tops cumulative', () => {
  const b = buildCladdingStair(straight());
  const els = b.concrete.elements;
  assert.equal(els.length, 5);
  assert.deepEqual(els.map((e) => e.riseMm), [180, 180, 180, 185, 185]);
  assert.deepEqual(els.map((e) => e.topZ), [180, 360, 540, 725, 910]);
  // one after another along +y, the left (outer) line straight at x = 0 whatever the width
  assert.deepEqual(els.map((e) => [Math.min(...ys(e.outline)), Math.max(...ys(e.outline))]), [[0, 270], [270, 540], [540, 810], [810, 1075], [1075, 1340]]);
  assert.ok(els.every((e) => Math.min(...xs(e.outline)) === 0));
  assert.equal(Math.max(...xs(els[4].outline)), 900);
  // the exit: the last rise again up to the slab by default
  assert.equal(b.concrete.exit.rawSlabTopZ, 910 + 185);
  assert.equal(buildCladdingStair(straight({ exitRiseMm: 170 })).concrete.exit.rawSlabTopZ, 910 + 170);
});

test('one step its own values (override): the heights after it follow', () => {
  const b = buildCladdingStair(straight({ stepOverrides: { 1: { riseMm: 200, widthMm: 950 } } }));
  assert.deepEqual(b.concrete.elements.map((e) => e.topZ), [180, 380, 560, 745, 930]);
  assert.equal(Math.max(...xs(b.concrete.elements[1].outline)), 950);
  assert.equal(b.concrete.elements[1].overridden, true);
});

test('a landing turning right (L): the next flight runs along +x, its outer line on the landing back edge', () => {
  const b = buildCladdingStair(cfg({ sequence: [{ kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 }, { kind: 'landing', riseMm: 180, depthMm: null, turn: 'right' }, { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 900 }] }));
  const [, , landing, s1, s2] = b.concrete.elements;
  // the landing: as wide as flight A, as deep as flight B is wide
  assert.deepEqual([Math.min(...xs(landing.outline)), Math.max(...xs(landing.outline)), Math.min(...ys(landing.outline)), Math.max(...ys(landing.outline))], [0, 1000, 540, 1440]);
  // flight B: from x = 1000 on, its outer (left) line is y = 1440
  assert.deepEqual([Math.min(...xs(s1.outline)), Math.max(...xs(s1.outline))], [1000, 1270]);
  assert.deepEqual([Math.min(...ys(s1.outline)), Math.max(...ys(s1.outline))], [540, 1440]);
  assert.deepEqual([Math.min(...xs(s2.outline)), Math.max(...xs(s2.outline))], [1270, 1540]);
  assert.equal(landing.exitSide, 'right');
});

test('a landing turning left: mirrored — the next flight along −x, the RIGHT line is the outer one all the way', () => {
  const b = buildCladdingStair(cfg({ sequence: [{ kind: 'steps', count: 1, riseMm: 180, goingMm: 270, widthMm: 1000 }, { kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'left' }, { kind: 'steps', count: 1, riseMm: 180, goingMm: 270, widthMm: 1000 }] }));
  const [s0, landing, s1] = b.concrete.elements;
  assert.deepEqual([Math.min(...xs(s0.outline)), Math.max(...xs(s0.outline))], [-1000, 0], 'flight A hangs left of its right (outer) line');
  assert.deepEqual([Math.min(...xs(landing.outline)), Math.max(...xs(landing.outline))], [-1000, 0]);
  assert.deepEqual([Math.min(...xs(s1.outline)), Math.max(...xs(s1.outline)), Math.min(...ys(s1.outline)), Math.max(...ys(s1.outline))], [-1270, -1000, 270, 1270]);
});

test('a U landing turning right with the flights apart: the return flight beside flight A, the gap between them', () => {
  const b = buildCladdingStair(cfg({ sequence: [{ kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 }, { kind: 'landing', riseMm: 180, depthMm: 1100, turn: 'u-right', gapMm: 200 }, { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 900 }] }));
  const [, , landing, c1, c2] = b.concrete.elements;
  assert.deepEqual([Math.min(...xs(landing.outline)), Math.max(...xs(landing.outline)), Math.min(...ys(landing.outline)), Math.max(...ys(landing.outline))], [0, 2100, 540, 1640]);
  // return flight: x from 1000 + 200 to 2100, walking down the plan (−y) from the landing's front line
  assert.deepEqual([Math.min(...xs(c1.outline)), Math.max(...xs(c1.outline)), Math.min(...ys(c1.outline)), Math.max(...ys(c1.outline))], [1200, 2100, 270, 540]);
  assert.deepEqual([Math.min(...ys(c2.outline)), Math.max(...ys(c2.outline))], [0, 270]);
  assert.equal(c2.topZ, 5 * 180);
});

test('cladding: the tread covers the step + the front nosing past the riser board + the side nosing on an open side only', () => {
  const b = buildCladdingStair(straight({ nosingFrontMm: 30, riserThicknessMm: 20, sideNosingMm: 25, sideNosingLeft: false, sideNosingRight: true }));
  const t = b.cladding.treads[1];
  near(Math.min(...ys(t.outline)), 270 - 30 - 20, 'front: nosing + riser board');
  near(Math.max(...ys(t.outline)), 540, 'back: the next riser face');
  near(Math.min(...xs(t.outline)), 0, 'left (wall): none');
  near(Math.max(...xs(t.outline)), 1025, 'right (open): 25 past the concrete');
  assert.equal(t.bottomZ, 360);
  assert.equal(t.topZ, 400);
  // without riser boards the nosing alone
  const n = buildCladdingStair(straight({ riserBoards: false })).cladding.treads[1];
  near(Math.min(...ys(n.outline)), 240, 'nosing only');
  // per step: a side nosing switched on by hand
  const o = buildCladdingStair(straight({ stepOverrides: { 2: { nosingLeft: true } } })).cladding.treads[2];
  near(Math.min(...xs(o.outline)), -30, 'own left nosing');
});

test('cladding: a riser board per step from the tread below up to the tread above, and one up to the floor above', () => {
  const b = buildCladdingStair(straight({ treadThicknessMm: 40, floorFinishBottomMm: 15, floorFinishTopMm: 20 }));
  const r = b.cladding.risers;
  assert.equal(r.length, 6);
  assert.equal(r[0].bottomZ, 15, 'the first on the finished floor');
  assert.equal(r[0].topZ, 180);
  assert.equal(r[1].bottomZ, 220, 'on the tread below');
  const top = r.at(-1);
  assert.equal(top.id, 'riser-top');
  assert.equal(top.bottomZ, 950);
  // (under the antresola nosing — stage 3 —, up to the floor without one)
  assert.equal(top.topZ, 910 + 185 + 20 - 40);
  assert.equal(buildCladdingStair(straight({ treadThicknessMm: 40, floorFinishBottomMm: 15, floorFinishTopMm: 20, exitNosing: false })).cladding.risers.at(-1).topZ, 910 + 185 + 20);
  assert.equal(buildCladdingStair(straight({ riserBoards: false })).cladding.risers.length, 0);
});

test('finished heights: every finished rise, the floors included; an uneven one is a WARNING', () => {
  // floor finish = tread thickness: the first finished rise equals the concrete one
  const even = buildCladdingStair(cfg({ sequence: [{ kind: 'steps', count: 5, riseMm: 180, goingMm: 270, widthMm: 1000 }], treadThicknessMm: 40, floorFinishBottomMm: 40, floorFinishTopMm: 40 }));
  assert.deepEqual(even.cladding.heights.map((h) => h.finishedRiseMm), [180, 180, 180, 180, 180, 180]);
  assert.equal(even.diagnostics.length, 0);
  // a thin floor finish: the first step 25 mm higher, the exit 25 mm lower
  const uneven = buildCladdingStair(cfg({ sequence: [{ kind: 'steps', count: 5, riseMm: 180, goingMm: 270, widthMm: 1000 }], treadThicknessMm: 40, floorFinishBottomMm: 15, floorFinishTopMm: 15, riseToleranceMm: 5 }));
  const h = uneven.cladding.heights;
  assert.equal(h[0].finishedRiseMm, 205);
  assert.equal(h.at(-1).finishedRiseMm, 155);
  assert.deepEqual(uneven.diagnostics.map((d) => [d.ruleId, d.severity, d.elementId]), [['CLAD-RISE-UNEVEN', 'WARNING', 'step-0'], ['CLAD-RISE-UNEVEN', 'WARNING', 'exit']]);
});

test('sanitize: bad input never breaks the build', () => {
  const c = sanitizeCladdingConfig({ sequence: [{ kind: 'x' }, { kind: 'steps', count: -3, riseMm: 'a' }, { kind: 'landing', turn: 'sideways' }], stepOverrides: { a: { riseMm: 1 }, 2: { riseMm: '190', nosingLeft: 'yes' } } });
  assert.deepEqual(c.sequence.map((g) => g.kind), ['steps', 'landing']);
  assert.equal(c.sequence[0].count, 1);
  assert.equal(c.sequence[1].turn, 'none');
  assert.deepEqual(c.stepOverrides, { 2: { riseMm: 190 } });
  assert.ok(buildCladdingStair(c).concrete.elements.length === 2);
});

test('project file: its own type, round trip; a self-supporting project is refused with a hint', () => {
  const config = straight({ stepOverrides: { 1: { riseMm: 200 } } });
  const file = claddingProjectToFile({ config, projectName: 'Kowalski', notes: 'pomiar 3.11' });
  assert.equal(file._type, 'schody3d-beton');
  const back = parseCladdingProjectFile(JSON.stringify(file));
  assert.equal(back.projectName, 'Kowalski');
  assert.deepEqual(back.config.stepOverrides, { 1: { riseMm: 200 } });
  assert.deepEqual(back.config.sequence, sanitizeCladdingConfig(config).sequence);
  assert.throws(() => parseCladdingProjectFile(JSON.stringify({ _type: 'schody3d-project', config: {} })), /samonośnych/);
  assert.throws(() => parseCladdingProjectFile('{'), /JSON/);
});

test('plan: a polygon per concrete element and per tread, a number per element', () => {
  const b = buildCladdingStair(createDefaultCladdingConfig());
  const svg = renderCladdingPlanSVG(b, { selectedIndex: 2 });
  assert.equal((svg.match(/class="clad-concrete"/g) || []).length, b.concrete.elements.length);
  assert.equal((svg.match(/class="clad-tread/g) || []).length, b.cladding.treads.length);
  assert.equal((svg.match(/class="clad-tread selected"/g) || []).length, 1);
});
