import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { slabSoffitZ, rawSlabTopZ } from '../floors.js';
import { pointInPolygon } from '../polygonClip.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { buildPricedMaterialTakeoff } from '../../takeoff/index.js';
import { buildPartList } from '../../production/partCodes.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';
import { editRailingSections, sanitizeRailingSections } from '../railingSolver.js';

// the user's stair (2026-11-03 photo): straight, on a central steel beam, rods from the ceiling through the open side's
// tread ends, a handrail on brackets on the wall side
const cfg = (patch = {}) => ({
  ...createDefaultConfig(),
  stairType: 'straight',
  treadsLegA: 14,
  stairConstruction: 'metal-profile',
  metalBeamCount: 1,
  ceilingRodsEnabled: true,
  openingMode: 'derived', // the opening the stair needs — no slab collisions
  ...patch,
});
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

test('rods: n per tread along its end, inset from it, from the tread underside to the ceiling above (opening: the upper storey, else the soffit)', () => {
  const b = buildStaircase(cfg({ ceilingRodsFromTread: 4, ceilingRodsTop: 'ceiling' }));
  const { rods } = b.ceilingRods;
  const treads = b.planLayout.treads.length;
  assert.equal(rods.length, 2 * (treads - 3), 'two per tread from tread 4 on');
  assert.equal(rods[0].treadIndex, 3);
  const config = b.fullConfig;
  for (const rod of rods) {
    const tread = b.treadModels[rod.treadIndex];
    assert.equal(rod.bottomZ, tread.elevation.bottom, 'through the tread, from its underside');
    const inOpening = pointInPolygon(rod.position, b.ceilingFit.openingOutline);
    assert.equal(rod.hung, inOpening ? 'opening' : 'soffit');
    assert.equal(rod.topZ, inOpening ? config.totalRise + config.ceilingRodsTopAboveFloorMm : slabSoffitZ(config));
    // the axis 40 mm in from the tread's end on the inner line
    const pt = b.planLayout.treads[rod.treadIndex];
    const line = pt.innerSide || pt.innerChain;
    const a = line[0];
    const c = line[line.length - 1];
    const off = Math.abs(((rod.position.x - a.x) * (c.y - a.y) - (rod.position.y - a.y) * (c.x - a.x)) / dist(a, c));
    assert.ok(Math.abs(off - 40) < 1e-6, `inset ${off}`);
  }
  // even spacing: within a tread and across to the next one — half a going
  const going = config.treadGoing;
  for (let r = 1; r < rods.length; r++) assert.ok(Math.abs(dist(rods[r - 1].position, rods[r].position) - going / 2) < 1, `spacing ${dist(rods[r - 1].position, rods[r].position)}`);
  // some rods under the slab and some in the opening (the default opening covers only the stair's upper part)
  assert.ok(rods.some((r) => r.hung === 'opening'));
});

test('rods: the clear gap above the balusters limit is a WARNING in the gate; more rods per tread clear it', () => {
  const two = buildStaircase(cfg({ treadGoing: 280 }));
  const gate = runTakeoffValidationGate(two);
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'CEILING-RODS-GAP' && d.severity === 'WARNING'), '140 − 12 = 128 > 120');
  const three = buildStaircase(cfg({ treadGoing: 280, ceilingRodsPerTread: 3 }));
  assert.ok(!three.ceilingRods.diagnostics.length);
  assert.equal(buildStaircase(cfg({ ceilingRodsEnabled: false })).ceilingRods.rods.length, 0, 'off by default');
  assert.equal(createDefaultConfig().ceilingRodsEnabled, false);
});

test('rods: 3D (railing layer), plan dots, takeoff by length priced per piece, part codes', () => {
  const b = buildStaircase(cfg());
  const meshes = [];
  b.root.traverse((o) => o.name?.startsWith('CeilingRod-') && meshes.push(o));
  assert.equal(meshes.length, b.ceilingRods.rods.length);
  assert.equal(meshes[0].parent.name, 'Railing');
  const svg = renderPlan2DSVG(b.planLayout, b.fullConfig, b.derived, { viewport: { x: -500, y: -500, width: 6000, height: 4000 }, ceilingRods: b.ceilingRods });
  assert.equal((svg.match(/class="ceiling-rod"/g) || []).length, b.ceilingRods.rods.length);
  const priceList = [{ materialId: 'railing-ceiling-rod', price: 85, currency: 'PLN', unit: 'piece' }];
  const takeoff = buildPricedMaterialTakeoff(b, { priceList });
  const items = takeoff.items.filter((i) => i.materialId === 'railing-ceiling-rod');
  assert.equal(items.reduce((s, i) => s + i.quantity, 0), b.ceilingRods.rods.length, 'every rod in the cut list');
  assert.equal(items.reduce((s, i) => s + i.calculatedCost, 0), 85 * b.ceilingRods.rods.length);
  const parts = buildPartList(b).parts.filter((p) => p.name === 'Pręty od sufitu');
  assert.equal(parts.length, items.length);
  assert.ok(parts.every((p) => /^TR-\d+$/.test(p.code)));
});

test('a balustrade section as a wall handrail only: brackets along its whole path, no posts, no infill', () => {
  const sections = [{ id: 'w', side: 'outer', fromStep: 0, toStep: null, mount: 'wall' }];
  assert.deepEqual(sanitizeRailingSections(sections), sections, 'kept by the sanitizer');
  const b = buildStaircase(cfg({ railingEnabled: true, railingSections: sections }));
  const s = b.railingModel.sections.find((x) => x.id === 'w');
  assert.equal(s.valid, true);
  assert.equal(s.posts.length, 0);
  assert.equal(s.balusters.length, 0);
  assert.equal(s.runs.length, 1);
  assert.equal(s.runs[0].wallRail, true);
  assert.ok(s.runs[0].brackets.length >= 3);
  assert.ok(s.handrail.totalLengthMm > 3000);
  const takeoff = buildPricedMaterialTakeoff(b, {});
  assert.ok(takeoff.items.some((i) => i.itemId.endsWith('-wall-brackets')));
  assert.ok(takeoff.items.every((i) => i.elementType !== 'POST'), 'no posts at all (metal stair, wall handrail)');
  // switched back and forth in the Inspektor
  const back = editRailingSections(sections, { action: 'mount', sectionId: 'w' });
  assert.equal(back[0].mount, undefined);
  assert.equal(editRailingSections(back, { action: 'mount', sectionId: 'w' })[0].mount, 'wall');
});

test('treads up to 80 mm thick: the stair builds and the treads have that thickness', () => {
  const b = buildStaircase(cfg({ treadThickness: 80 }));
  const t = b.treadModels[2];
  assert.equal(Math.round(t.elevation.top - t.elevation.bottom), 80);
  assert.ok(b.ceilingRods.rods.every((r) => r.bottomZ === b.treadModels[r.treadIndex].elevation.bottom));
});

test('rods: a through hole per rod in the tread DXF (rod Ø + 2 mm), only on the treads that carry rods', async () => {
  const { buildTreadDXF, buildAllTreadsDXF } = await import('../../export/dxfExport.js');
  const b = buildStaircase(cfg({ ceilingRodsFromTread: 4 }));
  const circles = (dxf) => (dxf.match(/\nCIRCLE\r?\n/g) || []).length;
  // CIRCLE, 8, layer, 10, u, 20, v, 30, 0, 40, radius
  const radii = (dxf) => {
    const lines = dxf.split(/\r?\n/);
    return lines.flatMap((l, i) => (l === 'CIRCLE' && lines[i + 9] === '40' ? [Number(lines[i + 10])] : []));
  };
  const opts = { ceilingRods: b.ceilingRods };
  assert.equal(circles(buildTreadDXF(b.treadModels[0], null, opts)), 0, 'tread 1 has no rods');
  const withRods = buildTreadDXF(b.treadModels[5], null, opts);
  assert.equal(circles(withRods), 2);
  assert.deepEqual(radii(withRods), [7, 7], 'Ø12 rod → Ø14 hole');
  assert.match(withRods, /otwor przelotowy na pret 2 x O14/);
  assert.equal(circles(buildTreadDXF(b.treadModels[5], null, {})), 0, 'without the rods model: none');
  assert.equal(circles(buildAllTreadsDXF(b.treadModels, {}, opts)), b.ceilingRods.rods.length);
});

// user report 2026-11-03: the rods in the opening stuck up above it — they end at the slab's top, fixed to its side
test('rods in the opening (default): up to the slab top, a bracket square to the opening edge at mid slab; none above the floor', () => {
  const b = buildStaircase(cfg());
  const config = b.fullConfig;
  const inOpening = b.ceilingRods.rods.filter((r) => r.hung === 'slab-edge');
  assert.ok(inOpening.length > 0);
  assert.ok(b.ceilingRods.rods.every((r) => r.hung !== 'opening'), 'nothing hung from the upper ceiling');
  assert.ok(b.ceilingRods.rods.every((r) => r.topZ <= rawSlabTopZ(config) + 1e-9), 'no rod above the slab');
  for (const r of inOpening) {
    assert.equal(r.topZ, rawSlabTopZ(config));
    assert.equal(r.bracket.z, (slabSoffitZ(config) + rawSlabTopZ(config)) / 2);
    // the bracket ends ON the opening's outline, the nearest point of it
    const o = b.ceilingFit.openingOutline;
    const onEdge = o.some((a, i) => {
      const c = o[(i + 1) % o.length];
      const cross = (c.x - a.x) * (r.bracket.at.y - a.y) - (c.y - a.y) * (r.bracket.at.x - a.x);
      return Math.abs(cross) / Math.hypot(c.x - a.x, c.y - a.y) < 1e-6;
    });
    assert.ok(onEdge);
    assert.ok(Math.abs(Math.hypot(r.bracket.at.x - r.position.x, r.bracket.at.y - r.position.y) - r.bracket.reachMm) < 1e-9);
  }
  // the rods under the slab are as before, no bracket
  assert.ok(b.ceilingRods.rods.filter((r) => r.hung === 'soffit').every((r) => !r.bracket && r.topZ === slabSoffitZ(config)));
  // the derived opening lies along the stair: short brackets, no warning
  assert.ok(!b.ceilingRods.diagnostics.some((d) => d.ruleId === 'CEILING-RODS-BRACKET'));
  // 3D: a bar + plate per bracketed rod, no ceiling plate above the slab
  let top = -Infinity;
  b.root.traverse((m) => {
    if (m.name?.startsWith('CeilingRod-')) {
      m.geometry.computeBoundingBox();
      top = Math.max(top, m.geometry.boundingBox.max.y);
    }
  });
  assert.ok(top <= rawSlabTopZ(config) + 1e-6, `3D top ${top}`);
});

test('rods: a rod far from the opening edge reports its long bracket', async () => {
  const { buildCeilingRods } = await import('../ceilingRodsModel.js');
  const b = buildStaircase(cfg());
  const rods = b.ceilingRods.rods.filter((r) => r.hung === 'slab-edge');
  // the same opening, grown 400 mm past the rods' side: every rod in it stands 400+ mm from its nearest edge
  const xs = b.ceilingFit.openingOutline.map((p) => p.x);
  const ys = b.ceilingFit.openingOutline.map((p) => p.y);
  const grow = 400 + Math.max(...rods.map((r) => r.bracket.reachMm));
  const big = [
    { x: Math.min(...xs) - grow, y: Math.min(...ys) - grow },
    { x: Math.max(...xs) + grow, y: Math.min(...ys) - grow },
    { x: Math.max(...xs) + grow, y: Math.max(...ys) + grow },
    { x: Math.min(...xs) - grow, y: Math.max(...ys) + grow },
  ];
  const far = buildCeilingRods({ planLayout: b.planLayout, treadModels: b.treadModels, openingOutline: big }, b.fullConfig);
  const d = far.diagnostics.find((x) => x.ruleId === 'CEILING-RODS-BRACKET');
  assert.ok(d, 'reported');
  assert.equal(d.severity, 'WARNING');
  assert.ok(d.value >= 400);
});
