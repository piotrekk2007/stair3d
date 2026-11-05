import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { buildCladdingDXF, claddingPieces } from '../export/claddingDxf.js';
import { claddingExportRoot } from '../export/claddingMeshExport.js';

// export (user request 2026-11-04): the cladding flat 1:1 in a DXF, the 3D for SketchUp / OBJ
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], nosingFrontMm: 30, riserThicknessMm: 20, ...patch });
const sizeOf = (pts) => ({ w: Math.max(...pts.map((p) => p.u)) - Math.min(...pts.map((p) => p.u)), h: Math.max(...pts.map((p) => p.v)) - Math.min(...pts.map((p) => p.v)) });

test('DXF pieces: every tread at its blank size (grain along x), every riser its length × height, the boards in their plane', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true, coverStringers: { 0: { right: true } } }));
  const pieces = claddingPieces(b);
  const treads = pieces.filter((p) => /^ST-/.test(p.code));
  assert.deepEqual(treads.map((p) => p.code), ['ST-01', 'ST-02', 'ST-03', 'ST-04']);
  for (const [k, t] of b.cladding.treads.entries()) {
    const s = sizeOf(treads[k].pts);
    near(s.w, t.lengthMm, `tread ${k} length`, 1e-6);
    near(s.h, t.depthMm, `tread ${k} depth`, 1e-6);
  }
  const risers = pieces.filter((p) => /^PS-/.test(p.code));
  assert.deepEqual(risers.map((p) => p.code), ['PS-01', 'PS-02', 'PS-03', 'PS-04', 'PS-G']);
  near(sizeOf(risers[1].pts).h, b.cladding.risers[1].heightMm, 'riser height');
  near(sizeOf(risers[1].pts).w, b.cladding.risers[1].lengthMm, 'riser length');
  assert.ok(pieces.some((p) => p.code === 'NA'), 'the antresola nosing');
  const sk = pieces.find((p) => p.code === 'LS-1L');
  assert.ok(sk, 'the skirting board');
  near(sizeOf(sk.pts).w, Math.max(...b.finish.skirting[0].polygon.map((q) => q.s)) - Math.min(...b.finish.skirting[0].polygon.map((q) => q.s)), 'skirting length');
  assert.ok(pieces.some((p) => p.code === 'WO-1P'), 'the cover stringer');
});

test('DXF text: R12 ASCII, the outlines on OUTLINE, a profiled tread\'s milled edges on PROFILE, codes as text', () => {
  const b = buildCladdingStair(straight({ edgeProfile: 'chamfer', edgeProfileMm: 3 }));
  const dxf = buildCladdingDXF(b, { projectName: 'Kowalski – schody łączone' });
  assert.ok(dxf.startsWith('0\nSECTION\n2\nHEADER'));
  assert.ok(dxf.trimEnd().endsWith('0\nEOF'));
  assert.ok(/^[\x0a\x20-\x7e]*$/.test(dxf), 'ASCII only');
  assert.match(dxf, /Projekt: Kowalski - schody laczone/);
  assert.match(dxf, /ST-01 Stopien 1/);
  // the milled edges (the front, the nosed side) on PROFILE, the rest on OUTLINE
  const profileLines = (dxf.match(/LINE\n8\nPROFILE\n/g) || []).length;
  assert.equal(profileLines, b.cladding.treads.reduce((n, t) => n + t.exposed.filter(Boolean).length, 0));
  assert.ok(profileLines >= 4);
  const square = buildCladdingDXF(buildCladdingStair(straight({ edgeProfile: 'square' })));
  assert.equal((square.match(/LINE\n8\nPROFILE\n/g) || []).length, 0, 'none unprofiled');
});

test('DXF: a winder\'s fan riser panels get a / b codes; nothing to draw → null', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 1, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'winders', count: 3, riseMm: 180, turn: 'right' },
      { kind: 'steps', count: 1, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
  });
  const codes = claddingPieces(b).map((p) => p.code);
  const multi = b.cladding.risers.filter((r) => /^riser-\d+-\d+$/.test(r.id));
  for (const r of multi) assert.ok(codes.includes(`PS-${String(r.index + 1).padStart(2, '0')}${String.fromCharCode(97 + Number(r.id.split('-')[2]))}`), r.id);
  assert.equal(new Set(codes).size, codes.length, 'unique codes');
  assert.equal(buildCladdingDXF({ cladding: { treads: [], risers: [], exitNosing: [] }, concrete: { elements: [] } }), null);
});

test('3D export root: the cladding only, world-baked, in the shared exporters\' groups', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true, railingSides: { 0: { right: true } } }));
  const root = renderCladdingStair(b);
  root.position.set(100, 0, 0); // a transform on the way must be baked in
  const out = claddingExportRoot(root);
  assert.deepEqual(out.children.map((g) => g.name), ['Treads', 'RiserBoards', 'StringerOuter', 'Posts']);
  const meshes = (g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); return n; };
  assert.equal(meshes(out.children[0]), meshes(root.getObjectByName('Treads')));
  assert.equal(meshes(out.children[3]), meshes(root.getObjectByName('Railing')));
  for (const g of out.children) for (const m of g.children) assert.ok(m.isMesh && m.matrixWorld.equals(new THREE.Matrix4()), 'flat, no transforms');
  const a = new THREE.Box3().setFromObject(root.getObjectByName('Treads'));
  const c = new THREE.Box3().setFromObject(out.children[0]);
  near(c.min.x, a.min.x, 'baked x', 1e-6);
  near(c.max.y, a.max.y, 'baked y', 1e-6);
  assert.equal(out.getObjectByName('Concrete'), undefined, 'no concrete');
});
