import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { slabSoffitZ } from '../floors.js';
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
  const b = buildStaircase(cfg({ ceilingRodsFromTread: 4 }));
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
