// Check 2 of the orientative structural check (docs/architecture/STRUCTURAL_CHECKS.md): every straight and winder
// tread as a simply supported timber beam between its two wangi (EC5-STRUCT-I-01), bending + shear (ULS) and
// deflection (SLS, EC5-STRUCT-I-04). Pure: reads the solved TreadModels and config, measures nothing new except
// lengths/areas of the tread's own final outline. Units inside: N, mm, N/mm².
//
// Model (all ASSUMPTIONS, listed in the report):
//  * tread length = the mean of its front and back edge lengths (final edges, dusza -> outer wanga). For a straight
//    tread both are its width; a winder is a long wedge whose two edges differ — the mean is its equivalent length.
//  * span L = tread length minus the two bearing insets. A wanga occupies the band [0, t] in from its chain line
//    (stringerRenderer extrudes inward); the tread's end sits `recess` in from the chain (edgeOverrides.js
//    housingRecessMm: t − housing depth on a housed side = the housing's bottom, 0 on an overlay side). So the tread
//    bears on the wanga over t − recess (the housing depth, or the whole thickness), and its bearing centre is
//    (t − recess)/2 in from the tread's end — read from the SAME recess the geometry uses, never re-derived.
//  * section b × h: b = outline area / tread length (a straight tread: going + nosing; a winder: its mean depth —
//    an equivalent rectangle), h = config.treadThickness. A winder really behaves like a wedge-shaped plate (the
//    corner one supported on two wangi at the corner); the equivalent beam is a simplification, not proven to be on
//    the safe side. The riser groove underneath is ignored (small, near the support-free front edge).
//  * loads: self-weight (ρmean) + either the imposed UDL (medium-term) or the concentrated load at mid-span
//    (short-term) — never both together (EN 1991-1-1 treats them separately). ULS 1.35 G + 1.5 Q.
//  * landings are not checked: a landing needs its own framing, which the model does not describe.

import { housingRecessMm } from '../geometry/edgeOverrides.js';
import { signedPolygonArea } from '../geometry/pathUtils.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { EC5_FACTORS, GRAVITY_M_S2, LOAD_COMBINATION, designValue, timberClass } from './timberClasses.js';

const KN_TO_N = 1000;
const KN_PER_M2_TO_N_PER_MM2 = 1e-3;
const KG_PER_M3_TO_KG_PER_MM3 = 1e-9;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// One decimal, Polish decimal comma (the message is shown as is).
const mm1 = (v) => v.toFixed(1).replace('.', ',');
// 1-based, as the plan 2D labels the treads.
const stepNumberOf = (t) => Number(String(t.stepId).replace('step-', '')) + 1;

/** How far in from the tread's end its bearing centre on that side's wanga lies (see header). */
export function bearingInsetMm(config, side) {
  return Math.max(0, config.stringerThickness - housingRecessMm(config)[side]) / 2;
}

/**
 * Span and section of one tread as a beam.
 * @returns {{spanMm:number, lengthMm:number, bMm:number, hMm:number}}
 */
export function treadBeamGeometry(tread, config) {
  const edgeLen = (e) => dist(e.final[0], e.final[1]);
  const lengthMm = (edgeLen(tread.frontEdge) + edgeLen(tread.backEdge)) / 2;
  const spanMm = lengthMm - bearingInsetMm(config, 'inner') - bearingInsetMm(config, 'outer');
  const bMm = Math.abs(signedPolygonArea(tread.outline)) / lengthMm;
  return { spanMm, lengthMm, bMm, hMm: tread.thickness };
}

/**
 * @typedef {Object} TreadCheck
 * @property {string} stepId
 * @property {number} stepNumber   1-based, as in the plan 2D
 * @property {'straight'|'winder'} type
 * @property {number} spanMm
 * @property {number} bMm
 * @property {number} hMm
 * @property {number} bendingUtil      max over the two load cases (1 = 100 %)
 * @property {number} shearUtil
 * @property {number} deflectionInstMm   instantaneous, imposed load only (worse of UDL / point)
 * @property {number} deflectionInstLimitMm
 * @property {number} deflectionFinMm    final incl. creep (self-weight + UDL)
 * @property {number} deflectionFinLimitMm
 * @property {number} maxUtil          the governing of all four ratios
 * @property {'bending'|'shear'|'deflectionInst'|'deflectionFin'} governing
 */

/**
 * @param {import('../geometry/treadSolver.js').TreadModel[]} treadModels
 * @param {Object} config  full config
 * @returns {{checks: TreadCheck[], skipped: {stepId:string, reason:string}[], diagnostics: Object[]}}
 */
export function checkTreads(treadModels, config) {
  const wood = timberClass(config.structuralMaterialClass);
  const { gammaG, gammaQ, psi2CategoryA } = LOAD_COMBINATION;
  const { kmod, kdef, kcr } = EC5_FACTORS;
  const udl = config.structuralStairUdlKnM2 * KN_PER_M2_TO_N_PER_MM2; // N/mm²
  const point = config.structuralStairPointKn * KN_TO_N; // N
  const fmdMedium = designValue(wood.fmk, kmod.mediumTerm);
  const fmdShort = designValue(wood.fmk, kmod.shortTerm);
  const fvdMedium = designValue(wood.fvk, kmod.mediumTerm);
  const fvdShort = designValue(wood.fvk, kmod.shortTerm);
  const E = wood.e0mean;

  const checks = [];
  const skipped = [];
  const diagnostics = [];
  for (const t of treadModels) {
    if (t.type === 'landing') {
      skipped.push({ stepId: t.stepId, reason: 'podest — wymaga własnej konstrukcji (legary), której model nie opisuje' });
      continue;
    }
    const { spanMm: L, bMm: b, hMm: h } = treadBeamGeometry(t, config);
    if (!(L > 0 && b > 0 && h > 0)) {
      skipped.push({ stepId: t.stepId, reason: 'brak sensownej rozpiętości lub przekroju' });
      continue;
    }
    const W = (b * h * h) / 6;
    const I = (b * h ** 3) / 12;
    const g = wood.rhomean * KG_PER_M3_TO_KG_PER_MM3 * GRAVITY_M_S2 * b * h; // N/mm, self-weight per length
    const q = udl * b; // N/mm, imposed UDL per length

    // ULS — case 1: G + UDL (medium-term); case 2: G + point load at mid-span (short-term).
    const m1 = ((gammaG * g + gammaQ * q) * L * L) / 8;
    const m2 = (gammaG * g * L * L) / 8 + (gammaQ * point * L) / 4;
    const bendingUtil = Math.max(m1 / W / fmdMedium, m2 / W / fmdShort);
    const v1 = ((gammaG * g + gammaQ * q) * L) / 2;
    const v2 = (gammaG * g * L) / 2 + (gammaQ * point) / 2;
    const tau = (v) => (1.5 * v) / (kcr * b * h); // rectangular section, effective width k_cr·b (EC5 6.1.7)
    const shearUtil = Math.max(tau(v1) / fvdMedium, tau(v2) / fvdShort);

    // SLS — instantaneous from the imposed load (worse of UDL / point), final incl. creep from G + UDL.
    const wUdl = (5 * q * L ** 4) / (384 * E * I);
    const wPoint = (point * L ** 3) / (48 * E * I);
    const wG = (5 * g * L ** 4) / (384 * E * I);
    const deflectionInstMm = Math.max(wUdl, wPoint);
    const deflectionFinMm = wG * (1 + kdef) + wUdl * (1 + psi2CategoryA * kdef);
    const deflectionInstLimitMm = L / config.structuralTreadDeflectionRatio;
    const deflectionFinLimitMm = L / config.structuralTreadFinalDeflectionRatio;

    const ratios = {
      bending: bendingUtil,
      shear: shearUtil,
      deflectionInst: deflectionInstMm / deflectionInstLimitMm,
      deflectionFin: deflectionFinMm / deflectionFinLimitMm,
    };
    const governing = Object.keys(ratios).reduce((a, k) => (ratios[k] > ratios[a] ? k : a), 'bending');
    checks.push({ stepId: t.stepId, stepNumber: stepNumberOf(t), type: t.type, spanMm: L, bMm: b, hMm: h, bendingUtil, shearUtil, deflectionInstMm, deflectionInstLimitMm, deflectionFinMm, deflectionFinLimitMm, maxUtil: ratios[governing], governing });

    const strength = Math.max(bendingUtil, shearUtil);
    if (strength > 1) {
      diagnostics.push(
        createDiagnostic({
          ruleId: 'EC5-STRUCT-I-01',
          severity: 'WARNING',
          elementType: 'tread',
          elementId: t.stepId,
          parameter: bendingUtil >= shearUtil ? 'treadBending' : 'treadShear',
          value: Math.round(strength * 100),
          expected: '<= 100',
          unit: '%',
          message: `Stopień nr ${stepNumberOf(t)}: wykorzystanie nośności ${Math.round(strength * 100)}% (${bendingUtil >= shearUtil ? 'zginanie' : 'ścinanie'}) przy rozpiętości ${Math.round(L)} mm i przekroju ${Math.round(b)}×${h} mm — kontrola orientacyjna, sprawdź grubość stopnia lub rozpiętość.`,
        })
      );
    }
    const defl = Math.max(ratios.deflectionInst, ratios.deflectionFin);
    if (defl > 1) {
      diagnostics.push(
        createDiagnostic({
          ruleId: 'EC5-STRUCT-I-04',
          severity: 'WARNING',
          elementType: 'tread',
          elementId: t.stepId,
          parameter: 'treadDeflection',
          value: Math.round(defl * 100),
          expected: '<= 100',
          unit: '%',
          message: `Stopień nr ${stepNumberOf(t)}: ugięcie ${Math.round(defl * 100)}% limitu (chwilowe ${mm1(deflectionInstMm)} / ${mm1(deflectionInstLimitMm)} mm, końcowe ${mm1(deflectionFinMm)} / ${mm1(deflectionFinLimitMm)} mm) — stopień może być wyczuwalnie sprężysty.`,
        })
      );
    }
  }
  return { checks, skipped, diagnostics };
}
