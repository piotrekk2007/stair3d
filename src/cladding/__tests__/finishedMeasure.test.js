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
