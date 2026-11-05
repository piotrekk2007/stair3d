import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';

// groups measured as FINISHED elements (user request 2026-11-05): the contractor's tread sizes, the concrete derived
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const cfg = (group, patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [group], treadThicknessMm: 40, riserThicknessMm: 20, nosingFrontMm: 30, sideNosingMm: 30, sideNosingLeft: false, sideNosingRight: true, floorFinishBottomMm: 15, ...patch });

test('steps measured as finished: the generated treads have exactly the entered size, the concrete derived', () => {
  // finished treads 310 deep, 1100 long, 180 high (the first one on the finished floor)
  const b = buildCladdingStair(cfg({ kind: 'steps', count: 4, riseMm: 180, goingMm: 310, widthMm: 1100, measured: 'finished' }));
  for (const t of b.cladding.treads) {
    near(t.depthMm, 310, `tread ${t.index + 1} depth`);
    near(t.lengthMm, 1100, `tread ${t.index + 1} length`);
  }
  // the concrete: the going without the nosing (riser behind the tread: 310 − 30), the width without the right side nosing
  const e = b.concrete.elements;
  near(e[1].goingMm, 280, 'concrete going');
  near(e[1].widthMm, 1070, 'concrete width');
  // the heights: every finished rise 180 — the first concrete rise less the tread's thickness, plus the floor finish
  for (const h of b.cladding.heights.filter((x) => x.kind !== 'exit')) near(h.finishedRiseMm, 180, `rise ${h.index + 1}`);
  near(e[0].riseMm, 180 - 40 + 15, 'the first concrete rise');
  near(e[1].riseMm, 180, 'the next ones as given');
});

test('carpet risers: the riser\'s thickness off the depth too; a landing\'s depth; measured on the concrete — as before', () => {
  const carpet = buildCladdingStair(cfg({ kind: 'steps', count: 3, riseMm: 180, goingMm: 330, widthMm: 1000, measured: 'finished' }, { riserMount: 'carpet' }));
  near(carpet.cladding.treads[1].depthMm, 330, 'the finished depth');
  near(carpet.concrete.elements[1].goingMm, 330 - 30 - 40, 'going = depth − nosing − the carpet riser (40)');
  const landing = buildCladdingStair({
    ...cfg({ kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 }),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, depthMm: 1030, turn: 'none', measured: 'finished' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
  });
  const lt = landing.cladding.treads.find((t) => t.kind === 'landing');
  near(lt.depthMm, 1030, 'the finished landing as entered');
  const plain = buildCladdingStair(cfg({ kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 }));
  near(plain.concrete.elements[1].goingMm, 270, 'concrete as entered');
  assert.equal(sanitizeCladdingConfig({ sequence: [{ kind: 'steps', count: 2, measured: 'finished' }, { kind: 'steps', count: 2, measured: 'x' }] }).sequence.map((g) => g.measured ?? null).join(), 'finished,');
});

// user request 2026-11-05: the winders' edges measured on the FINISHED treads — where their noses meet the wall
test('winders measured as finished: the treads\' noses meet the wall where measured (the concrete edges moved back)', async () => {
  const { signedOnZoneLine } = await import('../concreteModel.js');
  const seq = (measured) => [
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    { kind: 'winders', count: 3, riseMm: 180, turn: 'right', measured, edges: [{ outerMm: -300 }, { outerMm: 300 }] },
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
  ];
  const b = buildCladdingStair(cfg(null, { sequence: seq('finished') }));
  const z = b.concrete.zones[0];
  // the concrete edges further on along the wall: the nose (nosing + riser) stands out in front of each, toward the step below
  assert.ok(z.edges[1].outerMm > -300 && z.edges[2].outerMm > 300, 'the concrete edges further on — the noses stand out in front of them');
  const onPath = (p, path) => path.slice(1).some((b2, k) => {
    const a = path[k];
    const l = Math.hypot(b2.x - a.x, b2.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b2.x - a.x) + (p.y - a.y) * (b2.y - a.y)) / (l * l)));
    return Math.hypot(p.x - (a.x + (b2.x - a.x) * t), p.y - (a.y + (b2.y - a.y) * t)) < 0.5;
  });
  for (const [k, want] of [[1, -300], [2, 300]]) {
    const el = b.concrete.elements.find((e) => e.kind === 'winder' && e.k === k);
    const t = b.cladding.treads.find((x) => x.index === el.index);
    const hits = t.outline.filter((p) => onPath(p, z.outerPath)).map((p) => signedOnZoneLine(z, 'outer', p));
    assert.ok(hits.some((s) => Math.abs(s - want) < 0.5), `winder ${k + 1}: its nose at ${want} on the wall (${hits.map(Math.round)})`);
  }
  // measured on the concrete: the edges as entered
  const c = buildCladdingStair(cfg(null, { sequence: seq(undefined) })).concrete.zones[0];
  assert.deepEqual([c.edges[1].outerMm, c.edges[2].outerMm], [-300, 300]);
});

// user request 2026-11-05: in a finished winder zone the plan's edge handles stand at the treads' noses
test('the plan\'s winder handles at the noses in a finished zone (the drag sets what the numbers mean)', async () => {
  const { signedOnZoneLine } = await import('../concreteModel.js');
  const { renderCladdingPlanSVG } = await import('../claddingPlanRenderer.js');
  const seq = [
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    { kind: 'winders', count: 3, riseMm: 180, turn: 'right', measured: 'finished', edges: [{ outerMm: -300 }, { outerMm: 300 }] },
    { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
  ];
  const b = buildCladdingStair(cfg(null, { sequence: seq }));
  const z = b.concrete.zones[0];
  const svg = renderCladdingPlanSVG(b, {});
  const m = svg.match(/<circle class="clad-edge-handle" data-zone="0" data-edge="1" data-end="outer" cx="([-\d.]+)" cy="([-\d.]+)"/);
  assert.ok(m, 'the handle');
  const p = { x: Number(m[1]), y: -Number(m[2]) };
  near(signedOnZoneLine(z, 'outer', p), -300, 'at the nose, where measured', 0.2);
  assert.ok(Math.abs(signedOnZoneLine(z, 'outer', z.edges[1].outer) + 300) > 10, 'not at the concrete edge');
  // measured on the concrete: at the concrete edge
  const c = buildCladdingStair(cfg(null, { sequence: seq.map((g) => ({ ...g, measured: undefined })) }));
  const mc = renderCladdingPlanSVG(c, {}).match(/<circle class="clad-edge-handle" data-zone="0" data-edge="1" data-end="outer" cx="([-\d.]+)" cy="([-\d.]+)"/);
  near(signedOnZoneLine(c.concrete.zones[0], 'outer', { x: Number(mc[1]), y: -Number(mc[2]) }), -300, 'at the concrete', 0.2);
});
