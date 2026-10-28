import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { valueAtU } from '../polylineProfile.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { buildAllTreadsDXF, buildStringerAllBoardsDXF, buildRailingDXF } from '../../export/dxfExport.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';

// a straight stair along +y, x 0..900, treads 270 deep, nosing 25, risers
const base = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, hasRiserBoards: true, railingEnabled: true, railingSections: [{ id: 's1', side: 'outer', fromStep: 0, toStep: 12 }], ...patch });
const all = { ledTreadEnabled: true, ledStringerEnabled: true, ledHandrailEnabled: true };
const ids = (b, id) => b.led.diagnostics.filter((d) => d.ruleId === id);

test('LED (user decisions 2026-10-28): off by default — no strips, no 3D layer, no takeoff', () => {
  const b = base();
  assert.equal(b.led.enabled, false);
  assert.equal(b.led.strips.length, 0);
  assert.equal(b.root.getObjectByName('LedLighting'), undefined);
  assert.ok(!computeMaterialTakeoff(b, b.fullConfig).some((i) => i.elementType === 'LED'));
});

test('LED under a tread’s nose: on the underside, the groove 4 mm behind the nosed face and in front of the riser, 30 mm short of each end', () => {
  const b = base({ ledTreadEnabled: true });
  const t = b.treadModels[1];
  const s = b.led.strips.find((x) => x.elementId === t.stepId);
  assert.ok(s);
  // front edge y = 270, the nose to y = 245; the groove (17 wide) from 249 to 266 — the riser stands behind 270
  for (const p of s.points) {
    assert.equal(p.y, 257.5);
    assert.equal(p.z, t.elevation.bottom);
  }
  assert.deepEqual(s.points.map((p) => p.x).sort((a, c) => a - c), [50, 850]);
  assert.deepEqual(s.faceNormal, { x: 0, y: 0, z: -1 });
  assert.deepEqual(b.led.diagnostics, []);
  // a nose too short for the groove in front of the riser → WARNING
  const short = base({ ledTreadEnabled: true, nosing: 15 });
  assert.equal(ids(short, 'LED-TREAD-NOSING').length, 1);
  assert.equal(ids(base({ ledTreadEnabled: true, nosing: 15, hasRiserBoards: false }), 'LED-TREAD-NOSING').length, 0, 'no riser — no limit');
});

test('LED in the wanga: on the board’s face toward the stair, 25 mm under its top edge; into the treads’ housings → WARNING; a cut board is skipped', () => {
  const b = base({ ledStringerEnabled: true, ledStringerSide: 'outer' });
  const strips = b.led.strips.filter((x) => x.kind === 'stringer');
  assert.ok(strips.length >= 1 && strips.every((x) => x.side === 'outer'));
  const s = strips[0];
  const seg = b.stringerModels.outer.segments.find((x) => x.id === s.segmentId);
  const geo = b.stringerConstruction.outer.find((g) => g.segmentId === s.segmentId);
  for (const { u, v } of s.groove.path) assert.ok(Math.abs(v - (valueAtU(geo.topProfile, u) - 25)) < 1e-6);
  // the face toward the stair: the reference line + the board thickness inward
  const p = s.points[0];
  const w = (p.x - seg.referenceLine.start.x) * seg.inwardNormal.x + (p.y - seg.referenceLine.start.y) * seg.inwardNormal.y;
  assert.ok(Math.abs(w - seg.thickness) < 1e-6);
  assert.deepEqual(ids(b, 'LED-STRINGER-HOUSING'), []);
  assert.equal(ids(base({ ledStringerEnabled: true, ledStringerFromTopMm: 70 }), 'LED-STRINGER-HOUSING').length > 0, true);
  const cut = base({ ledStringerEnabled: true, stringerConstructionTypeOuter: 'cut' });
  assert.equal(ids(cut, 'LED-STRINGER-CUT').length, 1);
  assert.ok(!cut.led.strips.some((x) => x.side === 'outer'));
});

test('LED under the handrail: along every piece, half the handrail’s height under its axis', () => {
  const b = base({ ledHandrailEnabled: true });
  const s = b.led.strips.find((x) => x.kind === 'handrail');
  const piece = b.railingModel.sections[0].handrail.pieces[s.pieceIndex];
  const h = b.railingModel.sections[0].handrail.heightMm;
  // the strip's line is parallel to the axis, h/2 below it measured square to the axis
  const d = { x: piece.end.x - piece.start.x, y: piece.end.y - piece.start.y, z: piece.end.z - piece.start.z };
  const L = Math.hypot(d.x, d.y, d.z);
  const q = s.points[0];
  const r = { x: q.x - piece.start.x, y: q.y - piece.start.y, z: q.z - piece.start.z };
  const along = (r.x * d.x + r.y * d.y + r.z * d.z) / L;
  const off = Math.hypot(r.x - (d.x / L) * along, r.y - (d.y / L) * along, r.z - (d.z / L) * along);
  assert.ok(Math.abs(off - h / 2) < 1e-6);
  assert.ok(q.z < piece.start.z + (d.z / L) * along);
  assert.equal(ids(base({ ledHandrailEnabled: true, ledProfileWidthMm: 65 }), 'LED-HANDRAIL-NARROW').length, 1);
});

test('LED consumers: the 3D layer, the plan, the DXF grooves, the unpriced takeoff (strip per place + supply), the gate', () => {
  const b = base(all);
  assert.equal(b.root.getObjectByName('LedLighting').children.filter((m) => !m.name.endsWith('-glow')).length, b.led.strips.length);
  const items = computeMaterialTakeoff(b, b.fullConfig).filter((i) => i.elementType === 'LED');
  assert.deepEqual(items.map((i) => i.itemId), ['led-tread', 'led-stringer', 'led-handrail', 'led-supply']);
  assert.equal(items[0].quantity, Math.round(b.led.totals.tread / 10) / 100);
  assert.equal(items[0].unit, 'mb');
  assert.match(items[3].material, new RegExp(`≥ ${Math.ceil(b.led.supplyW)} W`));
  assert.ok(Math.abs(b.led.supplyW - (b.led.totals.all / 1000) * 9.6 * 1.2) < 1e-6);
  assert.match(buildAllTreadsDXF(b.treadModels, {}, { led: b.led }), /frez LED od spodu 17 x 8 mm/);
  assert.doesNotMatch(buildAllTreadsDXF(b.treadModels, {}), /frez LED/);
  assert.match(buildStringerAllBoardsDXF(b.stringerConstruction.outer, { model: b.stringerModels.outer, config: b.fullConfig, led: b.led }), /frez LED 17 x 8 mm/);
  assert.match(buildRailingDXF(b.railingModel, { config: b.fullConfig, led: b.led }), /Frez LED od spodu poreczy 17 x 8 mm/);
  const svg = renderPlan2DSVG(b.planLayout, b.fullConfig, b.derived, { viewport: { x: -1000, y: -5000, width: 4000, height: 6000 }, led: b.led });
  assert.equal((svg.match(/class="led-strip"/g) || []).length, b.led.strips.length);
  const warned = base({ ledTreadEnabled: true, nosing: 15 });
  assert.ok(runTakeoffValidationGate(warned).warnings.some((d) => d.ruleId === 'LED-TREAD-NOSING'));
});
