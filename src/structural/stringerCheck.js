// Check 3 of the orientative structural check (docs/architecture/STRUCTURAL_CHECKS.md): every wanga board as an
// inclined, simply supported timber beam between its two end faces (EC5-STRUCT-I-01, modelled per the string type —
// EC5-STRUCT-F-01). Pure: reads the solved StringerModel/StringerConstructionGeometry, TreadModels, the balustrade
// and the takeoff's net volumes; measures nothing new. Units inside: N, mm, N/mm².
//
// Model (all ASSUMPTIONS, listed in the report):
//  * supports: the board's two end faces (floor, post face, landing/trimmer, a lap joint at a post-less corner) —
//    each board simply supported on its own; continuity over a lap joint is ignored (on the safe side for bending).
//  * span: horizontal Lh = the board's own end faces (StringerSegmentConstructionGeometry.ends); pitch α from the
//    first and last tread seat; inclined length L = Lh / cos α. A board steeper than STEEP_BOARD_MAX_DEG (the dusza
//    side of a tight winder) is not a beam in any useful sense and is skipped, with the reason shown.
//  * section: HOUSED ("wpuszczana") — b = t − housing depth (the housings run the whole board), h = the board's
//    solved local depth; CUT ("nakładana") — b = t, h = the throat under the notches (minRemainingSectionMm).
//  * loads, spread uniformly over Lh: self-weight of the board (net volume minus housings), of every tread and riser
//    it carries — each shared 50/50 between the two wangi, and among this side's boards by seat length — and of the
//    balustrade on this side: every baluster and every balustrade post on the board it stands on (by plan position;
//    a post standing on the floor loads the floor, not the wanga), the handrail shared among this side's boards by
//    length (it is carried down through those balusters and posts); imposed
//    UDL on the carried tread area (the same half share); OR the whole concentrated load at mid-span (a point load
//    next to the wanga goes almost entirely into it). Never UDL and point load together.
//  * ULS as for the treads (bending, shear with k_cr); SLS perpendicular to the board over L. The axial component of
//    the load along the pitch is ignored.

import { housingDepthMm, CONSTRUCTION_TYPES } from '../geometry/stringerModel.js';
import { signedPolygonArea } from '../geometry/pathUtils.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { ELEMENT_TYPES } from '../takeoff/takeoffTypes.js';
import { EC5_FACTORS, GRAVITY_M_S2, LOAD_COMBINATION, designValue, timberClass } from './timberClasses.js';
import { densityFor } from './selfWeight.js';

// Steeper than this, a board (the narrow dusza treads of a tight winder) is not checked as a beam.
export const STEEP_BOARD_MAX_DEG = 60;

const KN_TO_N = 1000;
const KN_PER_M2_TO_N_PER_MM2 = 1e-3;
const M3_TO_MM3 = 1e9;
const KG_PER_MM3 = (rhoKgM3) => rhoKgM3 / M3_TO_MM3;
const WANGA_SHARE = 0.5; // each tread (and its riser, and its imposed load) is carried half by each wanga

const seatLength = (b) => Math.max(0, b.finalUEnd - b.finalUStart);
// A balustrade post whose foot is at (or below) this height stands on the floor, not on a wanga.
const FLOOR_TOLERANCE_MM = 1;

/**
 * Index of the board (of one side) a plan point stands on: the board whose own span (its end faces, along its
 * reference line) contains the point's projection, nearest across; if none, the nearest board end. -1 if no board.
 */
export function boardIndexAt(point, segments, geos) {
  let best = -1;
  let bestScore = Infinity;
  segments.forEach((seg, i) => {
    const g = geos[i];
    if (!g?.ends) return;
    const { start, direction } = seg.referenceLine;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const u = dx * direction.x + dy * direction.y;
    const across = Math.abs(dx * direction.y - dy * direction.x);
    const outside = Math.max(0, g.ends.start.u - u, u - g.ends.end.u);
    const score = outside * 1e6 + across; // inside the span first, then nearest across
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
const mm1 = (v) => v.toFixed(1).replace('.', ',');

/**
 * @typedef {Object} StringerCheck
 * @property {'outer'|'inner'} side
 * @property {string} segmentId
 * @property {'closed'|'cut'} constructionType
 * @property {number} spanHMm      horizontal span
 * @property {number} spanMm       inclined span
 * @property {number} angleDeg
 * @property {number} bMm
 * @property {number} hMm
 * @property {number} permanentKn  total self-weight carried (board, treads, risers, balustrade)
 * @property {number} railingKn    of which the balustrade
 * @property {{handrail:number, balusters:number, posts:number}} railingDetailKn  the balustrade split by element
 * @property {number} imposedKn    total imposed UDL carried
 * @property {number} bendingUtil
 * @property {number} shearUtil
 * @property {number} deflectionInstMm
 * @property {number} deflectionInstLimitMm
 * @property {number} deflectionFinMm
 * @property {number} deflectionFinLimitMm
 * @property {number} maxUtil
 * @property {string} governing
 */

/**
 * @param {Object} models  buildStaircase() result (fullConfig, treadModels, stringerModels, stringerConstruction, railingModel)
 * @param {Object[]} items  ungated takeoff items (net volumes)
 * @param {{riserMaterial?: 'oak'|'mdf'}} [options]
 * @returns {{checks: StringerCheck[], skipped: {side:string, segmentId:string, reason:string}[], diagnostics: Object[]}}
 */
export function checkStringers(models, items, options = {}) {
  const config = models.fullConfig;
  const wood = timberClass(config.structuralMaterialClass);
  const { gammaG, gammaQ, psi2CategoryA } = LOAD_COMBINATION;
  const { kmod, kdef, kcr } = EC5_FACTORS;
  const E = wood.e0mean;
  const udl = config.structuralStairUdlKnM2 * KN_PER_M2_TO_N_PER_MM2;
  const point = config.structuralStairPointKn * KN_TO_N;
  const fmdMedium = designValue(wood.fmk, kmod.mediumTerm);
  const fmdShort = designValue(wood.fmk, kmod.shortTerm);
  const fvdMedium = designValue(wood.fvk, kmod.mediumTerm);
  const fvdShort = designValue(wood.fvk, kmod.shortTerm);

  const volumeOf = new Map(items.filter((i) => Number.isFinite(i.netVolume)).map((i) => [i.sourceElementId, i.netVolume * M3_TO_MM3]));
  const weightN = (volMm3, key) => (volMm3 || 0) * KG_PER_MM3(densityFor(key, config, options).rho) * GRAVITY_M_S2;
  const treadById = new Map((models.treadModels || []).map((t) => [t.index, t]));
  const railingSides = new Map((models.railingModel?.sections || []).map((s) => [s.id, s.side]));

  const checks = [];
  const skipped = [];
  const diagnostics = [];

  for (const side of ['outer', 'inner']) {
    const model = models.stringerModels?.[side];
    const geos = models.stringerConstruction?.[side] || [];
    if (!model) continue;

    // How much of each tread's seat on this side sits on each board (a tread split over a lap joint is shared).
    const seatTotal = new Map();
    for (const seg of model.segments) for (const b of seg.treadBearings) seatTotal.set(b.treadIndex, (seatTotal.get(b.treadIndex) || 0) + seatLength(b));

    // The balustrade on this side (see the header): per board, split into handrail / balusters / posts.
    const railingByBoard = model.segments.map(() => ({ handrail: 0, balusters: 0, posts: 0 }));
    const boardAt = (point) => boardIndexAt(point, model.segments, geos);
    const handrailN = items
      .filter((i) => i.elementType === ELEMENT_TYPES.HANDRAIL && railingSides.get(String(i.sourceElementId).split(':')[1]) === side)
      .reduce((sum, i) => sum + weightN((i.netVolume || 0) * M3_TO_MM3, 'handrail'), 0);
    const sideLengthH = geos.reduce((sum, g) => sum + (g?.ends ? Math.max(0, g.ends.end.u - g.ends.start.u) : 0), 0);
    geos.forEach((g, k) => {
      if (sideLengthH > 0 && g?.ends) railingByBoard[k].handrail = (handrailN * Math.max(0, g.ends.end.u - g.ends.start.u)) / sideLengthH;
    });
    for (const section of (models.railingModel?.sections || []).filter((sec) => sec.valid && sec.side === side)) {
      for (const baluster of section.balusters) {
        // one baluster's volume = its cut-list item's volume / quantity (takeoff/railingItems.js — one volume rule)
        const item = items.find((it) => it.sourceElementId === `railing:${section.id}:baluster:${Math.round(baluster.heightMm)}`);
        const k = boardAt(baluster.position);
        if (item && k >= 0) railingByBoard[k].balusters += weightN(((item.netVolume || 0) * M3_TO_MM3) / (item.quantity || 1), 'balusters');
      }
      for (const post of section.posts.filter((p) => !p.removed && p.elevation.bottom > FLOOR_TOLERANCE_MM)) {
        const k = boardAt(post.position);
        if (k >= 0) railingByBoard[k].posts += weightN(volumeOf.get(`post:${post.postId}`), 'railingPosts');
      }
    }

    model.segments.forEach((seg, i) => {
      const g = geos[i];
      const skip = (reason) => skipped.push({ side, segmentId: seg.id, reason });
      if (!g || !g.ends || !(g.lowerCurve?.length > 0)) return skip('brak geometrii deski');
      const Lh = g.ends.end.u - g.ends.start.u;
      if (!(Lh > 0)) return skip('zerowa długość');

      const seats = seg.treadBearings;
      const first = seats[0];
      const last = seats[seats.length - 1];
      const run = last && first ? last.finalUStart - first.finalUStart : 0;
      const slope = run > 1e-6 ? (last.bearingElevation - first.bearingElevation) / run : 0;
      const alpha = Math.atan(slope);
      const angleDeg = (alpha * 180) / Math.PI;
      if (angleDeg > STEEP_BOARD_MAX_DEG) return skip(`stroma deska (${Math.round(angleDeg)}°) przy duszy zabiegu — model belki nie ma zastosowania`);
      const cos = Math.cos(alpha);
      const L = Lh / cos;

      const closed = g.constructionType === CONSTRUCTION_TYPES.CLOSED;
      const b = closed ? config.stringerThickness - housingDepthMm(config) : config.stringerThickness;
      const h = closed ? g.localDepthMm : g.minRemainingSectionMm;
      if (!(b > 0 && h > 0 && Number.isFinite(h))) return skip('brak wyliczonego przekroju');
      const W = (b * h * h) / 6;
      const I = (b * h ** 3) / 12;

      // --- loads (N), spread uniformly over Lh
      const housingsVol = [...volumeOf.entries()].filter(([id]) => id.startsWith(`stringer:${side}:${seg.id}:housing-`)).reduce((s, [, v]) => s + v, 0);
      let G = weightN((volumeOf.get(`stringer:${side}:${seg.id}`) || 0) - housingsVol, 'stringers');
      let Q = 0;
      for (const bearing of seats) {
        const tread = treadById.get(bearing.treadIndex);
        if (!tread) continue;
        const share = WANGA_SHARE * (seatTotal.get(bearing.treadIndex) > 0 ? seatLength(bearing) / seatTotal.get(bearing.treadIndex) : 0);
        G += share * weightN(volumeOf.get(`tread:${tread.stepId}`), tread.type === 'landing' ? 'landings' : 'treads');
        G += share * weightN(volumeOf.get(`riser:${tread.stepId}`), 'risers');
        Q += share * udl * Math.abs(signedPolygonArea(tread.outline));
      }
      const rail = railingByBoard[i];
      const railingHere = rail.handrail + rail.balusters + rail.posts;
      G += railingHere;
      const gh = G / Lh; // N/mm per horizontal mm
      const qh = Q / Lh;

      // --- ULS (vertical loads per horizontal length: the bending moment of the inclined beam equals that of its
      // horizontal projection; the shear perpendicular to the board carries cos α)
      const m1 = ((gammaG * gh + gammaQ * qh) * Lh * Lh) / 8;
      const m2 = (gammaG * gh * Lh * Lh) / 8 + (gammaQ * point * Lh) / 4;
      const bendingUtil = Math.max(m1 / W / fmdMedium, m2 / W / fmdShort);
      const v1 = (((gammaG * gh + gammaQ * qh) * Lh) / 2) * cos;
      const v2 = ((gammaG * gh * Lh) / 2 + (gammaQ * point) / 2) * cos;
      const tau = (v) => (1.5 * v) / (kcr * b * h);
      const shearUtil = Math.max(tau(v1) / fvdMedium, tau(v2) / fvdShort);

      // --- SLS perpendicular to the board over L (a load per horizontal length q gives q·cos²α per inclined length
      // perpendicular to it)
      const perp = (q) => q * cos * cos;
      const wUdl = (5 * perp(qh) * L ** 4) / (384 * E * I);
      const wPoint = (point * cos * L ** 3) / (48 * E * I);
      const wG = (5 * perp(gh) * L ** 4) / (384 * E * I);
      const deflectionInstMm = Math.max(wUdl, wPoint);
      const deflectionFinMm = wG * (1 + kdef) + wUdl * (1 + psi2CategoryA * kdef);
      const deflectionInstLimitMm = L / config.structuralStringerDeflectionRatio;
      const deflectionFinLimitMm = L / config.structuralStringerFinalDeflectionRatio;

      const ratios = { bending: bendingUtil, shear: shearUtil, deflectionInst: deflectionInstMm / deflectionInstLimitMm, deflectionFin: deflectionFinMm / deflectionFinLimitMm };
      const governing = Object.keys(ratios).reduce((a, k) => (ratios[k] > ratios[a] ? k : a), 'bending');
      checks.push({
        side,
        segmentId: seg.id,
        constructionType: g.constructionType,
        spanHMm: Lh,
        spanMm: L,
        angleDeg,
        bMm: b,
        hMm: h,
        permanentKn: G / KN_TO_N,
        railingKn: railingHere / KN_TO_N,
        railingDetailKn: { handrail: rail.handrail / KN_TO_N, balusters: rail.balusters / KN_TO_N, posts: rail.posts / KN_TO_N },
        imposedKn: Q / KN_TO_N,
        bendingUtil,
        shearUtil,
        deflectionInstMm,
        deflectionInstLimitMm,
        deflectionFinMm,
        deflectionFinLimitMm,
        maxUtil: ratios[governing],
        governing,
      });

      const label = `Wanga ${side === 'outer' ? 'zewn.' : 'wewn.'} ${seg.id}`;
      const strength = Math.max(bendingUtil, shearUtil);
      if (strength > 1) {
        diagnostics.push(
          createDiagnostic({
            ruleId: 'EC5-STRUCT-I-01',
            severity: 'WARNING',
            elementType: 'stringer',
            elementId: seg.id,
            parameter: bendingUtil >= shearUtil ? 'stringerBending' : 'stringerShear',
            value: Math.round(strength * 100),
            expected: '<= 100',
            unit: '%',
            message: `${label}: wykorzystanie nośności ${Math.round(strength * 100)}% (${bendingUtil >= shearUtil ? 'zginanie' : 'ścinanie'}) przy rozpiętości ${Math.round(L)} mm i przekroju ${Math.round(b)}×${Math.round(h)} mm — kontrola orientacyjna.`,
          })
        );
      }
      const defl = Math.max(ratios.deflectionInst, ratios.deflectionFin);
      if (defl > 1) {
        diagnostics.push(
          createDiagnostic({
            ruleId: 'EC5-STRUCT-I-04',
            severity: 'WARNING',
            elementType: 'stringer',
            elementId: seg.id,
            parameter: 'stringerDeflection',
            value: Math.round(defl * 100),
            expected: '<= 100',
            unit: '%',
            message: `${label}: ugięcie ${Math.round(defl * 100)}% limitu (chwilowe ${mm1(deflectionInstMm)} / ${mm1(deflectionInstLimitMm)} mm, końcowe ${mm1(deflectionFinMm)} / ${mm1(deflectionFinLimitMm)} mm).`,
          })
        );
      }
    });
  }
  return { checks, skipped, diagnostics };
}
