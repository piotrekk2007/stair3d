import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { ELEMENT_TYPES } from '../../takeoff/takeoffTypes.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';
import { computeSelfWeight } from '../selfWeight.js';
import { buildStructuralReport, STRUCTURAL_DISCLAIMER } from '../index.js';
import { TIMBER_STRENGTH_CLASSES, GRAVITY_M_S2, MDF_DENSITY, EC5_FACTORS, designValue, timberClass } from '../timberClasses.js';

const item = (elementType, netVolume, extra = {}) => ({ itemId: `${elementType}-${Math.random()}`, elementType, netVolume, quantity: 1, sourceElementId: 'x', ...extra });
const cat = (w, key) => w.categories.find((c) => c.key === key);

test('mass = ρmean · V and weight = mass · g, per category, with the configured strength class', () => {
  const w = computeSelfWeight([item(ELEMENT_TYPES.TREAD, 0.01), item(ELEMENT_TYPES.TREAD, 0.02)], { structuralMaterialClass: 'D30' });
  const treads = cat(w, 'treads');
  assert.equal(treads.count, 2);
  assert.ok(Math.abs(treads.massKg - 0.03 * TIMBER_STRENGTH_CLASSES.D30.rhomean) < 1e-9);
  assert.ok(Math.abs(treads.weightKn - (treads.massKg * GRAVITY_M_S2) / 1000) < 1e-12);
  assert.ok(Math.abs(w.totalMassKg - treads.massKg) < 1e-9);
  const c24 = computeSelfWeight([item(ELEMENT_TYPES.TREAD, 0.01)], { structuralMaterialClass: 'C24' });
  assert.ok(Math.abs(cat(c24, 'treads').massKg - 0.01 * TIMBER_STRENGTH_CLASSES.C24.rhomean) < 1e-9);
});

test('a wanga\'s housings are material removed: subtracted from the wanga, never added', () => {
  const w = computeSelfWeight([item(ELEMENT_TYPES.STRINGER, 0.05), item(ELEMENT_TYPES.STRINGER_HOUSING, 0.002)], { structuralMaterialClass: 'D30' });
  assert.ok(Math.abs(cat(w, 'stringers').volumeM3 - 0.048) < 1e-12);
  assert.equal(cat(w, 'stringers').count, 1);
});

test('structural posts and balustrade posts are separate categories (by the post model\'s kind)', () => {
  const items = [item(ELEMENT_TYPES.POST, 0.01, { sourceElementId: 'post:post-start' }), item(ELEMENT_TYPES.POST, 0.004, { sourceElementId: 'post:railing-post-1' })];
  const w = computeSelfWeight(items, { structuralMaterialClass: 'D30' }, { postModels: [{ postId: 'post-start', kind: 'start' }, { postId: 'railing-post-1', kind: 'railing' }] });
  assert.equal(cat(w, 'posts').volumeM3, 0.01);
  assert.equal(cat(w, 'railingPosts').volumeM3, 0.004);
});

test('MDF risers use the MDF density; wood risers the strength class density', () => {
  const risers = [item(ELEMENT_TYPES.RISER, 0.01)];
  assert.equal(cat(computeSelfWeight(risers, { structuralMaterialClass: 'D30' }, { riserMaterial: 'mdf' }), 'risers').densityKgM3, MDF_DENSITY.rhomean);
  assert.equal(cat(computeSelfWeight(risers, { structuralMaterialClass: 'D30' }, { riserMaterial: 'oak' }), 'risers').densityKgM3, TIMBER_STRENGTH_CLASSES.D30.rhomean);
});

test('an element without a volume (invalid geometry) is reported as missing, never estimated', () => {
  const w = computeSelfWeight([item(ELEMENT_TYPES.STRINGER, null), item(ELEMENT_TYPES.TREAD, 0.01)], { structuralMaterialClass: 'D30' });
  assert.equal(w.missing.length, 1);
  assert.equal(cat(w, 'stringers'), undefined);
});

test('an unknown strength class falls back to the default (D30), never to an invented one', () => {
  assert.equal(timberClass('XYZ'), TIMBER_STRENGTH_CLASSES.D30);
});

test('design value X_d = k_mod · X_k / γ_M', () => {
  assert.ok(Math.abs(designValue(30, EC5_FACTORS.kmod.mediumTerm) - (0.8 * 30) / 1.3) < 1e-12);
});

test('the report on a real stair weighs EVERYTHING, balustrade included, and the total is the sum', () => {
  const config = { ...createDefaultConfig(), hasRiserBoards: true, railingEnabled: true, railingSections: [{ id: 'r1', side: 'outer', fromStep: 0, toStep: null }] };
  const built = buildStaircase(config);
  const report = buildStructuralReport(built);
  const keys = report.selfWeight.categories.map((c) => c.key);
  for (const k of ['treads', 'risers', 'stringers', 'posts', 'handrail', 'balusters']) assert.ok(keys.includes(k), `missing category ${k}`);
  const sum = report.selfWeight.categories.reduce((s, c) => s + c.massKg, 0);
  assert.ok(Math.abs(sum - report.selfWeight.totalMassKg) < 1e-9);
  assert.ok(report.selfWeight.totalMassKg > 0);
  assert.equal(report.disclaimer, STRUCTURAL_DISCLAIMER);
  assert.ok(report.assumptions.some((a) => a.text.includes('(UK)')), 'the UK loads are listed as such');
});

test('a structural finding reaches the validation gate but never as an ERROR', () => {
  const built = buildStaircase(createDefaultConfig());
  built.structural = { ...buildStructuralReport(built), diagnostics: [{ ruleId: 'STRUCT-SELF-WEIGHT-INCOMPLETE', severity: 'WARNING', elementType: 'stair', elementId: null, message: 'x' }] };
  const gate = runTakeoffValidationGate(built);
  assert.ok(gate.diagnostics.some((d) => d.ruleId === 'STRUCT-SELF-WEIGHT-INCOMPLETE'));
  assert.ok(buildStructuralReport(built).diagnostics.every((d) => d.severity !== 'ERROR'));
});

test('config: the structural class is its own field (default D30); timberGrade (takeoff) is unchanged', () => {
  const d = createDefaultConfig();
  assert.equal(d.structuralMaterialClass, 'D30');
  assert.equal(d.timberGrade, 'C24');
});

// ---- A2: treads as beams between the wangi ----
import { checkTreads, treadBeamGeometry, bearingInsetMm } from '../treadCheck.js';
import { LOAD_COMBINATION } from '../timberClasses.js';

function builtWith(patch = {}) {
  return buildStaircase({ ...createDefaultConfig(), ...patch });
}

test('tread span = tread length minus the bearings read from the geometry\'s own recess (housed vs overlay)', () => {
  const housed = builtWith();
  const t = housed.treadModels[0];
  const g = treadBeamGeometry(t, housed.fullConfig);
  const len = Math.hypot(t.frontEdge.final[0].x - t.frontEdge.final[1].x, t.frontEdge.final[0].y - t.frontEdge.final[1].y);
  assert.ok(Math.abs(g.lengthMm - len) < 1e-9);
  assert.ok(Math.abs(g.spanMm - (len - bearingInsetMm(housed.fullConfig, 'inner') - bearingInsetMm(housed.fullConfig, 'outer'))) < 1e-9);
  const overlay = builtWith({ stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  assert.equal(bearingInsetMm(overlay.fullConfig, 'outer'), overlay.fullConfig.stringerThickness / 2, 'overlay: the tread rests across the whole wanga');
  assert.ok(Math.abs(g.bMm - (housed.fullConfig.treadGoing + housed.fullConfig.nosing)) < 1, 'a straight tread\'s b = going + nosing');
});

test('hand check of one straight tread: bending under the point load matches M = 1.35 gL²/8 + 1.5 QL/4', () => {
  const built = builtWith({ stairType: 'straight', treadsLegA: 14 });
  const config = built.fullConfig;
  const c = checkTreads(built.treadModels, config).checks[0];
  const wood = TIMBER_STRENGTH_CLASSES.D30;
  const { spanMm: L, bMm: b, hMm: h } = c;
  const g = wood.rhomean * 1e-9 * GRAVITY_M_S2 * b * h;
  const M = (LOAD_COMBINATION.gammaG * g * L * L) / 8 + (LOAD_COMBINATION.gammaQ * config.structuralStairPointKn * 1000 * L) / 4;
  const sigma = M / ((b * h * h) / 6);
  const fmd = designValue(wood.fmk, EC5_FACTORS.kmod.shortTerm);
  assert.ok(c.bendingUtil >= sigma / fmd - 1e-9, 'the point-load case is covered');
  const wPoint = (config.structuralStairPointKn * 1000 * L ** 3) / (48 * wood.e0mean * ((b * h ** 3) / 12));
  assert.ok(c.deflectionInstMm >= wPoint - 1e-9);
});

test('a thinner tread is more utilised; over 100 % gives a WARNING on that tread (never an ERROR)', () => {
  const thick = checkTreads(builtWith({ treadThickness: 50 }).treadModels, builtWith({ treadThickness: 50 }).fullConfig);
  const thinBuilt = builtWith({ treadThickness: 25 });
  const thin = checkTreads(thinBuilt.treadModels, thinBuilt.fullConfig);
  assert.ok(thin.checks[0].maxUtil > thick.checks[0].maxUtil);
  assert.ok(thin.diagnostics.length > 0);
  for (const d of thin.diagnostics) {
    assert.equal(d.severity, 'WARNING');
    assert.equal(d.elementType, 'tread');
    assert.match(d.elementId, /^step-\d+$/);
  }
  assert.equal(thick.diagnostics.length, 0);
});

test('a landing is not checked as a beam (it needs its own framing) and says so', () => {
  const built = builtWith({ stairType: 'L', turn1Type: 'landing' });
  const r = checkTreads(built.treadModels, built.fullConfig);
  assert.ok(r.skipped.length >= 1);
  assert.ok(!r.checks.some((c) => built.treadModels.find((t) => t.stepId === c.stepId).type === 'landing'));
});

test('the loads are parameters: a larger imposed load raises the utilisation', () => {
  const a = builtWith();
  const b = builtWith({ structuralStairPointKn: 4 });
  assert.ok(checkTreads(b.treadModels, b.fullConfig).checks[0].bendingUtil > checkTreads(a.treadModels, a.fullConfig).checks[0].bendingUtil);
});

test('the report carries the tread checks and their findings', () => {
  const built = builtWith({ treadThickness: 25 });
  const report = buildStructuralReport(built);
  assert.ok(report.treads.checks.length > 0);
  assert.ok(report.diagnostics.some((d) => d.ruleId === 'EC5-STRUCT-I-01' || d.ruleId === 'EC5-STRUCT-I-04'));
});
