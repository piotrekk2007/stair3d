import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { claddingPieces } from '../export/claddingDxf.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';

// user requests 2026-11-05: the skirting cut at the wall corner of a turn; every tread typed L / P / CZ by its side
// nosings
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const L = (patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [
    { kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 },
    { kind: 'landing', riseMm: 180, goingMm: 1000, widthMm: 1000, turn: 'right' },
    { kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 },
  ],
  walls: { 0: { left: true }, 1: { left: true } },
  skirtingEnabled: true,
  skirtingThicknessMm: 15,
  ...patch,
});

test('the skirting at the turn\'s wall corner: both ends cut at 45° through the thickness (an inside corner)', () => {
  for (const style of ['raked', 'stepped']) {
    const [a, b] = buildCladdingStair(L({ skirtingStyle: style })).finish.skirting;
    assert.equal(a.corners.end.k, -1, `${style}: flight 1 shorter at its face`);
    assert.equal(b.corners.start.k, 1, `${style}: flight 2 starts later at its face`);
    assert.equal(a.corners.end.angleDeg, 45);
    // the cut ends meet: flight 1's end at the stair face = flight 2's start at the stair face (one plan point)
    const at = (bd, s, off) => ({ x: bd.origin.x + bd.dir.x * s + bd.normal.x * off, y: bd.origin.y + bd.dir.y * s + bd.normal.y * off });
    const pa = at(a, a.corners.end.s + a.corners.end.k * 15, 15);
    const pb = at(b, b.corners.start.s + b.corners.start.k * 15, 15);
    near(Math.hypot(pa.x - pb.x, pa.y - pb.y), 0, `${style}: the faces meet on the bisector`, 1e-6);
  }
  // stepped: the second flight goes on round the corner at the landing's height — no vertical piece at its start
  const [, b] = buildCladdingStair(L({ skirtingStyle: 'stepped' })).finish.skirting;
  assert.equal(b.parts[0].part, 'horizontal');
});

test('the corner cut in 3D (the end sheared), on the plan and noted in the DXF; no cut on a straight stair', () => {
  const built = buildCladdingStair(L({ skirtingStyle: 'raked' }));
  const [a] = built.finish.skirting;
  const mesh = renderCladdingStair(built).getObjectByName(`skirting-${a.id}`);
  const box = new THREE.Box3().setFromObject(mesh);
  // the wall of flight 1 at x = 0 (the board 0..15 in x); its end at the far wall: y up to the corner at the wall, 15
  // shorter at the stair face
  const pos = mesh.geometry.attributes.position;
  let atWall = -Infinity;
  let atFace = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = -pos.getZ(i);
    if (Math.abs(x) < 1e-6) atWall = Math.max(atWall, y);
    if (Math.abs(x - 15) < 1e-6) atFace = Math.max(atFace, y);
  }
  near(atWall - atFace, 15, 'shorter by its thickness at the face');
  assert.ok(box.max.x <= 15 + 1e-6);
  assert.match(renderCladdingPlanSVG(built, {}), /clad-board/);
  assert.ok(claddingPieces(built).some((p) => p.code === 'LS-1L' && p.notes.some((n) => /narożnik: koniec cięty 45°/.test(n))));
  const straight = buildCladdingStair({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], walls: { 0: { left: true } }, skirtingEnabled: true });
  assert.equal(straight.finish.skirting[0].corners, undefined);
});

test('the tread type: L / P by the side nosing, CZ between walls, LP both free; the user\'s own; shown everywhere', () => {
  const cfg = (patch) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 }], sideNosingLeft: false, sideNosingRight: true, ...patch });
  assert.deepEqual(buildCladdingStair(cfg({})).cladding.treads.map((t) => t.sideType), ['P', 'P', 'P']);
  assert.deepEqual(buildCladdingStair(cfg({ sideNosingLeft: true, sideNosingRight: false })).cladding.treads.map((t) => t.sideType), ['L', 'L', 'L']);
  assert.deepEqual(buildCladdingStair(cfg({ sideNosingLeft: true })).cladding.treads.map((t) => t.sideType), ['LP', 'LP', 'LP']);
  // between walls: czołowy
  assert.deepEqual(buildCladdingStair(cfg({ sideNosingLeft: true, walls: { 0: { left: true, right: true } } })).cladding.treads.map((t) => t.sideType), ['CZ', 'CZ', 'CZ']);
  // the user's own on one tread (the step editor's L / P / CZ / LP = both side nosings set)
  const own = buildCladdingStair(cfg({ stepOverrides: { 1: { nosingLeft: false, nosingRight: false } } }));
  assert.deepEqual(own.cladding.treads.map((t) => t.sideType), ['P', 'CZ', 'P']);
  assert.equal(own.cladding.treads[1].nosing.rightMm, 0, 'no side nosing on the CZ tread');
  // the plan, the DXF / cut list, the quote
  assert.match(renderCladdingPlanSVG(own, {}), /class="clad-type-label"[^>]*>CZ</);
  const st = claddingPieces(own).find((p) => p.code === 'ST-02');
  assert.equal(st.name, 'Stopień 2 CZ');
  assert.ok(st.notes.includes('czołowy'));
  assert.ok(buildCladdingQuote(own, createDefaultQuoteSettings()).lines.some((l) => l.name === 'Stopień 2 CZ'));
});
