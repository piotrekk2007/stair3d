import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { buildMetalStructure, isMetal, metalConfig, metalParams, planLineAt, treadStretches, toothedPlateOutline, maximizeLinear, STEEL_DENSITY_KG_M3 } from '../metalStructureModel.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { runTakeoffValidationGate, buildPricedMaterialTakeoff } from '../../takeoff/index.js';
import { buildMetalDXF } from '../../export/dxfExport.js';
import { renderMetalStructure } from '../metalStructureRenderer.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';
import { stairFacts } from '../../offer/offerModel.js';
import { checkTreads } from '../../structural/treadCheck.js';

const straight = { stairType: 'straight', treadsLegA: 10, totalRise: 1925, treadGoing: 270, stairWidth: 900 }; // 11 risers of 175
const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...straight, ...patch });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
// the beam's top line: through its highest corner (the upper end), at the beam's pitch
const topAt = (beam, u) => {
  const high = beam.outline.reduce((best, q) => (q.v > best.v ? q : best));
  return high.v - Math.tan((beam.slopeDeg * Math.PI) / 180) * (high.u - u);
};

test('maximizeLinear: the best vertex of a small LP; null when nothing is feasible', () => {
  // max x + y, x <= 3, y <= 2, x + y <= 4
  const x = maximizeLinear([1, 1], [{ row: [1, 0], rhs: 3 }, { row: [0, 1], rhs: 2 }, { row: [1, 1], rhs: 4 }]);
  assert.ok(near(x[0] + x[1], 4));
  assert.equal(maximizeLinear([1], [{ row: [1], rhs: 1 }, { row: [-1], rhs: -2 }]), null);
});

test('config: metal stairs are open, with no recessed treads, no wangi and no structural posts', () => {
  assert.equal(isMetal({ stairConstruction: 'metal-profile' }), true);
  assert.equal(isMetal({ stairConstruction: 'metal-flat' }), true);
  assert.equal(isMetal({ stairConstruction: 'stringers' }), false);
  assert.deepEqual(metalConfig({ stairConstruction: 'stringers', hasRiserBoards: true }), { stairConstruction: 'stringers', hasRiserBoards: true });
  assert.equal(metalParams({ metalBeamCount: 7 }).beamCount, 2);
  assert.equal(build().metalStructure, null);

  const m = build({ stairConstruction: 'metal-flat', hasRiserBoards: true, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', railingEnabled: true, railingSections: [{ id: 's', side: 'inner', fromStep: 0, toStep: null }] });
  assert.equal(m.fullConfig.hasRiserBoards, false);
  assert.deepEqual(m.riserModels, []);
  assert.ok(m.stringerModels.outer.absent && m.stringerModels.inner.absent);
  assert.deepEqual(m.stringerConstruction, { outer: [], inner: [] });
  assert.ok(m.postModels.length > 0 && m.postModels.every((p) => p.kind === 'railing'), 'only balustrade posts');
  // the tread runs the whole stair width (not recessed as for a housed wanga)
  const e = m.treadModels[3].frontEdge.final;
  assert.ok(near(Math.hypot(e[0].x - e[1].x, e[0].y - e[1].y), 900));
  // the steel is drawn in the wangi's 3D layers
  assert.ok(m.root.getObjectByName('StringerOuter').getObjectByName('MetalOuter').children.length === 1);
  assert.ok(m.root.getObjectByName('StringerInner').getObjectByName('MetalInner').children.length === 1);
});

test('a plan line and the treads along it: one stretch per tread, a going long, at the tread level', () => {
  const m = build({ stairConstruction: 'metal-profile' });
  const line = planLineAt(m.planLayout, 'outer', 450, 900);
  assert.equal(line.pieces.length, 1);
  assert.ok(near(line.length, 2700));
  const [stretches] = treadStretches(line, m.treadModels);
  assert.equal(stretches.length, 10);
  stretches.forEach((s, i) => {
    assert.ok(near(s.a, 270 * i) && near(s.b, 270 * (i + 1)));
    assert.equal(s.bottom, m.treadModels[i].elevation.bottom);
    assert.equal(s.skewA, 0);
  });
  assert.equal(planLineAt({ outerFullPath: [{ x: 0, y: 0 }, { x: 0, y: 1 }], innerFullPath: [{ x: 1, y: 0 }] }, 'outer', 10, 900), null);
});

test('wanga na profilu, 1 belka: a straight beam on the centre line touching every support plate at its back, one support per tread', () => {
  const m = build({ stairConstruction: 'metal-profile', metalBeamCount: 1 });
  const metal = m.metalStructure;
  const p = metal.params;
  assert.deepEqual(metal.rows, [{ id: 'beam-centre', side: 'centre', distanceMm: 450 }]);
  const beams = metal.members.filter((x) => x.kind === 'beam');
  assert.equal(beams.length, 1);
  const beam = beams[0];
  // on the centre line, as wide as the profile
  assert.ok(near(beam.origin.x, 450) && beam.nFrom === -50 && beam.nTo === 50);
  // pitch = the stair's pitch; the top passes exactly one plate thickness under every tread's back bottom corner
  assert.ok(near(beam.slopeDeg, (Math.atan(175 / 270) * 180) / Math.PI));
  m.treadModels.forEach((t, i) => assert.ok(near(topAt(beam, 270 * (i + 1)), t.elevation.bottom - p.supportPlateThicknessMm), `tread ${i + 1}`));
  // the foot is cut along the floor, the top end plumb at the last back edge
  assert.equal(beam.bounds.vMin, 0);
  assert.ok(beam.reachesFloor && near(beam.bounds.uMax, 2700));
  assert.ok(near(beam.lengthMm, 2700 * Math.hypot(1, 175 / 270)));
  // RHS 200 x 100 x 5: 2·5·(100 + 200 − 10) = 2900 mm² of steel
  assert.ok(near(beam.massKg, (2900 * beam.lengthMm * STEEL_DENSITY_KG_M3) / 1e9));

  const plates = metal.members.filter((x) => x.kind === 'support-plate');
  const webs = metal.members.filter((x) => x.kind === 'support-web');
  assert.equal(plates.length, 10);
  assert.equal(webs.length, 10);
  plates.forEach((pl, i) => {
    const t = m.treadModels[i];
    assert.equal(pl.treadIndex, i);
    assert.ok(near(pl.bounds.vMax, t.elevation.bottom) && near(pl.bounds.vMin, t.elevation.bottom - 8), 'directly under the tread');
    assert.ok(pl.bounds.uMin >= 270 * i + 20 - 1e-6 && pl.bounds.uMax <= 270 * (i + 1) - 20 + 1e-6, 'inside its own tread');
    assert.ok(pl.nFrom === -150 && pl.nTo === 150);
  });
  // every web stands on the beam and reaches the plate: the same height for every tread of a straight flight
  webs.forEach((w, i) => {
    assert.ok(near(w.bounds.vMax, plates[i].bounds.vMin));
    if (i > 0) assert.ok(near(w.heightMm, webs[1].heightMm, 1e-6));
    assert.ok(w.outline.every((q) => q.v >= topAt(beam, q.u) - 1e-6), 'never inside the beam');
  });
  assert.ok(near(webs[1].heightMm, (270 - 20) * (175 / 270)));
  assert.deepEqual(metal.diagnostics.map((d) => [d.ruleId, d.severity]), [['METAL-UNVERIFIED', 'INFO']]);
});

test('wanga na profilu, 2 belki: one beam at the setback from each side, every tread supported on both', () => {
  const m = build({ stairConstruction: 'metal-profile', metalBeamCount: 2, metalBeamSetbackMm: 180 });
  const metal = m.metalStructure;
  assert.deepEqual(metal.rows.map((r) => [r.id, r.side, r.distanceMm]), [['beam-outer', 'outer', 180], ['beam-inner', 'inner', 180]]);
  const beams = metal.members.filter((x) => x.kind === 'beam');
  const outerX = m.planLayout.outerFullPath[0].x;
  const innerX = m.planLayout.innerFullPath[0].x;
  assert.deepEqual(beams.map((b) => Math.round(Math.abs(b.origin.x - (b.side === 'outer' ? outerX : innerX)))), [180, 180]);
  assert.equal(metal.members.filter((x) => x.kind === 'support-plate').length, 20);
  assert.ok(!metal.diagnostics.some((d) => d.ruleId === 'METAL-SUPPORT-MISSING'));
  // a setback past the middle of the flight is refused and reported, never drawn
  const bad = build({ stairConstruction: 'metal-profile', metalBeamCount: 2, metalBeamSetbackMm: 500 }).metalStructure;
  assert.equal(bad.members.length, 0);
  assert.ok(bad.diagnostics.some((d) => d.ruleId === 'METAL-LAYOUT' && d.severity === 'WARNING'));
});

test('L stair with winders: one straight beam per plan run, joined at the corner, always below the treads; taller supports are reported', () => {
  const patch = { stairType: 'L', treadsLegA: 5, treadsLegB: 5, windersPerTurn: 5, totalRise: 2800, stairConstruction: 'metal-profile' };
  for (const metalBeamCount of [1, 2]) {
    const m = build({ ...patch, metalBeamCount });
    const metal = m.metalStructure;
    const tp = metal.params.supportPlateThicknessMm;
    for (const row of metal.rows) {
      const beams = metal.members.filter((x) => x.kind === 'beam' && x.rowId === row.id);
      assert.equal(beams.length, 2, `${row.id}: one beam per plan run`);
      const line = planLineAt(m.planLayout, row.side === 'inner' ? 'inner' : 'outer', row.distanceMm, m.fullConfig.stairWidth);
      const perPiece = treadStretches(line, m.treadModels);
      beams.forEach((beam, k) => {
        for (const s of perPiece[k]) {
          for (const u of [s.a, (s.a + s.b) / 2, s.b]) assert.ok(topAt(beam, u) <= s.bottom - tp + 1e-6, `${beam.id} under tread ${s.treadIndex + 1}`);
        }
      });
      // continuous at the plan corner
      assert.ok(near(topAt(beams[0], line.pieces[0].length), topAt(beams[1], 0), 1e-6));
      // and touching at least two treads' plates (it cannot be lifted any further)
      const touching = beams.flatMap((beam, k) => perPiece[k].filter((s) => near(topAt(beam, s.b), s.bottom - tp, 1e-4)));
      assert.ok(touching.length >= 2);
    }
    assert.ok(!metal.diagnostics.some((d) => d.ruleId === 'METAL-SUPPORT-MISSING'), 'every tread has its support(s)');
    assert.ok(metal.members.filter((x) => x.kind === 'support-plate').length >= m.treadModels.length * metal.rows.length);
  }
  const low = build({ ...patch, metalBeamCount: 2, metalSupportMaxHeightMm: 200 }).metalStructure;
  const tall = low.diagnostics.filter((d) => d.ruleId === 'METAL-SUPPORT-HEIGHT');
  assert.ok(tall.length > 0 && tall.every((d) => d.severity === 'WARNING' && d.value > 200 && d.elementType === 'tread'));
  // a required minimum support height lowers the whole beam by that much
  const a = build({ ...patch, metalBeamCount: 1 }).metalStructure.members.find((x) => x.kind === 'beam' && x.pieceIndex === 1);
  const b = build({ ...patch, metalBeamCount: 1, metalSupportClearanceMm: 50 }).metalStructure.members.find((x) => x.kind === 'beam' && x.pieceIndex === 1);
  assert.ok(near(a.bounds.vMax - b.bounds.vMax, 50, 1e-6));
});

test('toothedPlateOutline: level under each tread, plumb at each front edge, the same zig-zag below, exactly the neck apart', () => {
  const stretches = [0, 1, 2, 3].map((i) => ({ treadIndex: i, a: 270 * i, b: 270 * (i + 1), bottom: 135 + 175 * i }));
  const plate = toothedPlateOutline(stretches, 0, 1080, 120, { toFloor: true });
  const has = (u, v) => plate.outline.some((q) => near(q.u, u, 1e-6) && near(q.v, v, 1e-6));
  // top teeth
  for (const s of stretches) assert.ok(has(s.b, s.bottom), `the back of tooth ${s.treadIndex + 1}`);
  for (const s of stretches.slice(1)) assert.ok(has(s.a, s.bottom), `the front of tooth ${s.treadIndex + 1}`);
  // plumb front edge from the first tread down to the floor, foot along the floor, plumb top end
  assert.ok(has(0, 135) && has(0, 0));
  const b = { uMin: Math.min(...plate.outline.map((q) => q.u)), uMax: Math.max(...plate.outline.map((q) => q.u)), vMin: Math.min(...plate.outline.map((q) => q.v)) };
  assert.deepEqual([b.uMin, b.uMax, b.vMin].map((v) => Math.round(v * 1e6) / 1e6), [0, 1080, 0]);
  assert.ok(near(plate.pitchDeg, (Math.atan(175 / 270) * 180) / Math.PI));
  // The narrowest place is between an inner corner of the top (the back of a tooth) and the nearest outer corner of
  // the bottom — the next tooth's front corner moved by the shift w square to the pitch θ:
  // |(w·sinθ, r − w·cosθ)| = neck  =>  w = r·cosθ + √(neck² − r²·sin²θ)
  const theta = Math.atan(175 / 270);
  const w = 175 * Math.cos(theta) + Math.sqrt(120 ** 2 - (175 * Math.sin(theta)) ** 2);
  assert.ok(near(plate.shiftMm, w, 1e-3), `${plate.shiftMm} vs ${w}`);
  // the bottom has teeth too: an inner corner of the lower zig-zag = an upper back corner moved by the shift
  const d = { u: plate.shiftMm * Math.sin((plate.pitchDeg * Math.PI) / 180), v: -plate.shiftMm * Math.cos((plate.pitchDeg * Math.PI) / 180) };
  assert.ok(has(stretches[1].b + d.u, stretches[1].bottom + d.v));
  assert.ok(has(stretches[1].b + d.u, stretches[2].bottom + d.v));
  // without `toFloor` (a piece starting at a plan corner) the front end is plumb and as high as the shift's drop
  const mid = toothedPlateOutline(stretches.map((s) => ({ ...s, bottom: s.bottom + 1000 })), 0, 1080, 120);
  assert.ok(near(Math.min(...mid.outline.filter((q) => near(q.u, 0)).map((q) => q.v)), 1135 + d.v, 1e-3));
  assert.equal(toothedPlateOutline([], 0, 100, 120), null);
});

test('wanga na płaskowniku: two toothed bars set back from the sides; the treads lie on the teeth', () => {
  const m = build({ stairConstruction: 'metal-flat', metalFlatSetbackMm: 40, metalFlatThicknessMm: 10, metalFlatNeckMm: 100 });
  const metal = m.metalStructure;
  assert.deepEqual(metal.rows.map((r) => [r.side, r.distanceMm]), [['outer', 45], ['inner', 45]]);
  const plates = metal.members.filter((x) => x.kind === 'plate');
  assert.equal(plates.length, 2);
  assert.equal(metal.members.length, 2, 'no beams, no supports');
  for (const plate of plates) {
    assert.ok(plate.nTo - plate.nFrom === 10 && plate.thicknessMm === 10 && plate.neckMm === 100);
    assert.equal(plate.bearings.length, 10);
    plate.bearings.forEach((s, i) => {
      assert.equal(s.v, m.treadModels[i].elevation.bottom, 'the tooth top is the tread underside');
      assert.ok(plate.outline.some((q) => near(q.u, s.b, 1e-6) && near(q.v, s.v, 1e-6)));
    });
    assert.ok(near(plate.bounds.vMin, 0) && near(plate.bounds.vMax, m.treadModels[9].elevation.bottom));
    assert.ok(near(plate.massKg, (plate.areaMm2 * 10 * STEEL_DENSITY_KG_M3) / 1e9));
    assert.deepEqual(plate.blank, { lengthMm: plate.bounds.uMax - plate.bounds.uMin, heightMm: plate.bounds.vMax - plate.bounds.vMin });
  }
  // the bar's outer face is the setback from the stair's side
  const outer = plates.find((x) => x.side === 'outer');
  assert.ok(near(Math.abs(outer.origin.x - m.planLayout.outerFullPath[0].x), 45));

  // L and U: one bar per plan run and side, every tread borne on both sides
  for (const stairType of ['L', 'U']) {
    const s = build({ stairType, treadsLegA: 4, treadsLegB: 4, treadsLegC: 4, windersPerTurn: 4, totalRise: 2800, stairConstruction: 'metal-flat' }).metalStructure;
    const runs = stairType === 'L' ? 2 : 4;
    assert.equal(s.members.filter((x) => x.side === 'outer').length, runs, `${stairType}: outer bars`);
    assert.ok(!s.diagnostics.some((d) => d.severity !== 'INFO'), `${stairType}: no findings`);
    assert.ok(s.members.every((x) => x.outline.length >= 4 && x.areaMm2 > 0 && x.bounds.vMin >= -1e-9));
  }
});

test('gate, takeoff, structural check, DXF, plan and offer read the same metal model', () => {
  const flat = build({ stairConstruction: 'metal-flat' });
  const profile = build({ stairConstruction: 'metal-profile', metalBeamCount: 2 });
  const wood = build();

  // validation gate: the INFO reaches the list and never blocks
  for (const m of [flat, profile]) {
    const gate = runTakeoffValidationGate(m);
    assert.ok(gate.diagnostics.some((d) => d.ruleId === 'METAL-UNVERIFIED'));
    assert.ok(!gate.diagnostics.some((d) => d.ruleId.startsWith('METAL') && d.severity !== 'INFO'));
    // nothing about wangi, posts or joints that do not exist
    assert.ok(!gate.diagnostics.some((d) => /^(STRINGER|JOINT)/.test(d.ruleId)), gate.diagnostics.map((d) => d.ruleId).join(','));
  }

  // takeoff: steel items straight from the members, unpriced, no timber volume; no wangi, no risers
  const flatItems = computeMaterialTakeoff(flat, flat.fullConfig);
  const steel = flatItems.filter((i) => i.elementType === 'STEEL');
  assert.equal(steel.length, 2);
  assert.ok(steel.every((i) => i.netVolume === 0 && i.calculatedDimensions.massKg > 0 && /Blacha stalowa 12 mm/.test(i.material)));
  assert.ok(!flatItems.some((i) => i.elementType === 'STRINGER' || i.elementType === 'RISER'));
  const profileItems = computeMaterialTakeoff(profile, profile.fullConfig).filter((i) => i.elementType === 'STEEL');
  assert.deepEqual(profileItems.map((i) => [i.itemId, i.quantity]), [['beam-outer-beam-0', 1], ['beam-inner-beam-0', 1], ['beam-outer-supports', 10], ['beam-inner-supports', 10]]);
  assert.ok(/Profil stalowy zamknięty 200 × 100 × 5/.test(profileItems[0].material));
  assert.deepEqual(computeMaterialTakeoff(wood, wood.fullConfig).filter((i) => i.elementType === 'STEEL'), []);
  const priced = buildPricedMaterialTakeoff(profile, {});
  assert.ok(priced.items.filter((i) => i.elementType === 'STEEL').every((i) => i.calculatedCost == null), 'steel is never given a guessed price');

  // structural: a tread on a beam's supports is not checked as a beam between two wangi; on flat bars it spans them
  assert.equal(checkTreads(profile.treadModels, profile.fullConfig).checks.length, 0);
  const onBars = checkTreads(flat.treadModels, flat.fullConfig).checks;
  assert.equal(onBars.length, 10);
  assert.ok(near(onBars[0].spanMm, 900 - 2 * 36));

  // DXF: one sheet with every bar / beam; nothing for a wooden stair
  assert.equal(buildMetalDXF(wood.metalStructure), null);
  const dxf = buildMetalDXF(flat.metalStructure);
  assert.ok(dxf.includes('Plaskownik w zeby flat-outer-plate-0') && dxf.includes('Plaskownik w zeby flat-inner-plate-0') && dxf.endsWith('EOF'));
  assert.ok(!/[^\x00-\x7f]/.test(dxf), 'ASCII only');
  const beamDxf = buildMetalDXF(profile.metalStructure);
  assert.ok(beamDxf.includes('Belka beam-outer-beam-0') && beamDxf.includes('Podpory: 10 szt'));

  // plan 2D: the footprint of every beam under the treads
  const svg = renderPlan2DSVG(profile.planLayout, profile.fullConfig, profile.derived, { viewport: { x: -500, y: -3500, width: 2000, height: 4000 }, metalStructure: profile.metalStructure, stringerModels: profile.stringerModels, stringerConstruction: profile.stringerConstruction });
  assert.equal((svg.match(/class="metal-footprint"/g) || []).length, 2);
  assert.ok(!renderPlan2DSVG(wood.planLayout, wood.fullConfig, wood.derived, { viewport: { x: -500, y: -3500, width: 2000, height: 4000 } }).includes('metal-footprint'));

  // offer: names the construction
  const row = (m) => stairFacts(m.fullConfig, m.derived).rows.find((r) => r[0] === 'Konstrukcja')?.[1];
  assert.match(row(flat) || '', /płaskownikach/);
  assert.match(row(profile) || '', /dwóch belkach/);
});

test('renderer: every face of every steel prism looks outwards (right and left turn)', () => {
  for (const turnDirection of ['right', 'left']) {
    const m = build({ stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600, turnDirection, stairConstruction: 'metal-profile' });
    // convex members only (beam, support plate): a face looks outwards when its normal points away from the centre
    for (const member of m.metalStructure.members.filter((x) => x.kind === 'beam' || x.kind === 'support-plate')) {
      const pos = renderMetalStructure({ members: [member] }, [member.side], null, 'T').children[0].geometry.getAttribute('position');
      const c = [0, 1, 2].map((k) => Array.from({ length: pos.count }, (_, i) => pos.getComponent(i, k)).reduce((a, b) => a + b, 0) / pos.count);
      for (let i = 0; i < pos.count; i += 3) {
        const v = [0, 1, 2].map((j) => [0, 1, 2].map((k) => pos.getComponent(i + j, k)));
        const e1 = v[1].map((x, k) => x - v[0][k]);
        const e2 = v[2].map((x, k) => x - v[0][k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const out = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3 - c[k]);
        assert.ok(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0, `${turnDirection} ${member.id}: triangle ${i / 3}`);
      }
    }
  }
});
