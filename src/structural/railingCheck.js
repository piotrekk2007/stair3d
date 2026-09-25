// Check 4 of the orientative structural check (docs/architecture/STRUCTURAL_CHECKS.md): the balustrade under its
// horizontal line load — every handrail run as a beam between its two posts, and every post that carries it as a
// cantilever from its base. Pure: reads the solved RailingModel and PostModels; measures nothing new. Units: N, mm.
//
// Model (all ASSUMPTIONS, listed in the report):
//  * load: a horizontal line load q on the handrail (config.structuralHandrailLineKnM, default 0.36 kN/m —
//    UK-GUID-I-02, a UK value), short-term (k_mod 0.9), ULS factor γQ. Self-weight of the balustrade is vertical and
//    only compresses the posts — it does not enter these bending checks (it is carried by the wangi, check 3).
//  * handrail run: simply supported between its two posts over its true 3D length (continuity over a post
//    ignored); the balusters are NOT counted as lateral supports (they are cantilevers themselves). Bending about
//    the vertical axis: a rectangular rail's horizontal dimension is its width (railing preset widthMm).
//    Deflection limit: config.structuralHandrailMaxDeflectionMm (25 mm, UK-GUID-I-02).
//  * post: the rail's load from half of each run it ends, applied at the rail's height, the post a cantilever fixed
//    at its own bottom (a balustrade post) or at the floor (the start newel): M = F · H. Corner and end posts are
//    part of the stair's structure (tied to the wangi / the upper floor) and are not checked as free cantilevers.
//    The connection of a post to the stair is outside this check.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { EC5_FACTORS, LOAD_COMBINATION, designValue, timberClass } from './timberClasses.js';

const KN_PER_M_TO_N_PER_MM = 1; // 1 kN/m = 1 N/mm
const mm1 = (v) => v.toFixed(1).replace('.', ',');
// Post kinds that are free cantilevers under the rail's load; corner/end posts are tied into the structure.
const CANTILEVER_POST_KINDS = new Set(['railing', 'start']);

function railSection(handrail) {
  if (handrail.shape === 'round') {
    const d = handrail.widthMm;
    return { W: (Math.PI * d ** 3) / 32, I: (Math.PI * d ** 4) / 64, label: `Ø${d}` };
  }
  // bending about the vertical axis: the horizontal dimension (width) is the "depth" of the section
  const b = handrail.heightMm;
  const h = handrail.widthMm;
  return { W: (b * h * h) / 6, I: (b * h ** 3) / 12, label: `${handrail.widthMm}×${handrail.heightMm}` };
}

const runLength = (run) => run.pieces.reduce((s, p) => s + p.lengthMm, 0);

/**
 * @param {Object} models  buildStaircase() result (fullConfig, railingModel, allPostModels)
 * @returns {{rails: Object[], posts: Object[], skipped: {id:string, reason:string}[], diagnostics: Object[]}}
 */
export function checkRailing(models) {
  const config = models.fullConfig;
  const railing = models.railingModel;
  const out = { rails: [], posts: [], skipped: [], diagnostics: [] };
  if (!railing?.enabled) return out;

  const wood = timberClass(config.structuralMaterialClass);
  const E = wood.e0mean;
  const fmd = designValue(wood.fmk, EC5_FACTORS.kmod.shortTerm);
  const q = config.structuralHandrailLineKnM * KN_PER_M_TO_N_PER_MM;
  const gammaQ = LOAD_COMBINATION.gammaQ;
  const limit = config.structuralHandrailMaxDeflectionMm;
  const postsById = new Map((models.allPostModels || []).filter((p) => !p.removed).map((p) => [p.postId, p]));

  // post id -> { force N (characteristic), rail height z at the post }
  const postLoads = new Map();
  const addPostLoad = (postId, force, z) => {
    const entry = postLoads.get(postId) || { force: 0, z: -Infinity, runs: 0 };
    entry.force += force;
    entry.z = Math.max(entry.z, z);
    entry.runs += 1;
    postLoads.set(postId, entry);
  };

  for (const section of railing.sections.filter((s) => s.valid && s.handrail)) {
    const { W, I, label } = railSection(section.handrail);
    section.runs.forEach((run, r) => {
      const L = runLength(run);
      if (!(L > 0)) return;
      const M = (gammaQ * q * L * L) / 8;
      const bendingUtil = M / W / fmd;
      const deflectionMm = (5 * q * L ** 4) / (384 * E * I);
      const check = {
        id: `${section.id}-run-${r}`,
        sectionId: section.id,
        side: section.side,
        runIndex: r,
        spanMm: L,
        section: label,
        bendingUtil,
        deflectionMm,
        deflectionLimitMm: limit,
        maxUtil: Math.max(bendingUtil, deflectionMm / limit),
      };
      out.rails.push(check);
      const first = run.pieces[0].start;
      const last = run.pieces[run.pieces.length - 1].end;
      addPostLoad(run.startPostId, (q * L) / 2, first.z);
      addPostLoad(run.endPostId, (q * L) / 2, last.z);

      if (bendingUtil > 1) {
        out.diagnostics.push(
          createDiagnostic({
            ruleId: 'UK-GUID-I-02',
            severity: 'WARNING',
            elementType: 'railing',
            elementId: section.id,
            parameter: 'handrailBending',
            value: Math.round(bendingUtil * 100),
            expected: '<= 100',
            unit: '%',
            message: `Poręcz (odcinek ${section.id}, bieg ${r + 1}): zginanie ${Math.round(bendingUtil * 100)}% nośności przy rozpiętości między słupkami ${Math.round(L)} mm i przekroju ${label} mm — dodaj słupek pośredni lub powiększ poręcz (kontrola orientacyjna).`,
          })
        );
      }
      if (deflectionMm > limit) {
        out.diagnostics.push(
          createDiagnostic({
            ruleId: 'UK-GUID-I-02',
            severity: 'WARNING',
            elementType: 'railing',
            elementId: section.id,
            parameter: 'handrailDeflection',
            value: Math.round(deflectionMm * 10) / 10,
            expected: `<= ${limit}`,
            unit: 'mm',
            message: `Poręcz (odcinek ${section.id}, bieg ${r + 1}): ugięcie poziome ${mm1(deflectionMm)} mm przy limicie ${limit} mm (rozpiętość ${Math.round(L)} mm, tralki nie liczone jako podpory).`,
          })
        );
      }
    });
  }

  for (const [postId, load] of postLoads) {
    const post = postsById.get(postId);
    if (!post) {
      out.skipped.push({ id: postId, reason: 'słupek usunięty lub nieznany' });
      continue;
    }
    if (!CANTILEVER_POST_KINDS.has(post.kind)) {
      out.skipped.push({ id: postId, reason: 'słup konstrukcyjny związany z wangami / stropem — nie liczony jako wspornik' });
      continue;
    }
    const base = post.kind === 'start' ? 0 : post.elevation.bottom;
    const H = load.z - base;
    if (!(H > 0)) {
      out.skipped.push({ id: postId, reason: 'poręcz nie jest powyżej podstawy słupka' });
      continue;
    }
    const a = post.size;
    const W = a ** 3 / 6;
    const I = a ** 4 / 12;
    const M = gammaQ * load.force * H;
    const bendingUtil = M / W / fmd;
    const deflectionMm = (load.force * H ** 3) / (3 * E * I);
    const check = { postId, kind: post.kind, sizeMm: a, leverMm: H, forceKn: load.force / 1000, bendingUtil, deflectionMm, deflectionLimitMm: limit, maxUtil: Math.max(bendingUtil, deflectionMm / limit) };
    out.posts.push(check);
    if (bendingUtil > 1 || deflectionMm > limit) {
      out.diagnostics.push(
        createDiagnostic({
          ruleId: 'UK-GUID-I-02',
          severity: 'WARNING',
          elementType: 'post',
          elementId: postId,
          parameter: bendingUtil > 1 ? 'postBending' : 'postDeflection',
          value: Math.round(check.maxUtil * 100),
          expected: '<= 100',
          unit: '%',
          message: `Słupek ${postId}: zginanie ${Math.round(bendingUtil * 100)}%, wychylenie ${mm1(deflectionMm)} mm (limit ${limit} mm) od siły ${mm1(load.force / 1000)} kN na wysokości ${Math.round(H)} mm nad podstawą — przekrój ${a}×${a} mm (kontrola orientacyjna, bez mocowania).`,
        })
      );
    }
  }
  return out;
}
