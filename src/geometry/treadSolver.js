// TreadModel / TreadGeometryData — plain-data description of one stopień (tread), fully
// independent of Three.js. treadRenderer.js is the ONLY consumer that turns this into a
// THREE.BufferGeometry; every geometric decision (which edge is nominal vs final, the nosing
// shift) happens here, never in the renderer.
//
// Terminology (see docs/model/STAIRCASE_DATA_MODEL.md §2.7 — always relative to the walking
// direction, never to global X/Y): frontEdge = czoło stopnia (first contact when walking up),
// backEdge = tył stopnia (shared with the next tread).

import { pointsEqual, normalizeVector } from './pathUtils.js';
import { shiftFrontEdge } from './nosingUtils.js';
import { computeWinderBlank } from './winderBlank.js';
import { recessedEdges, housingRecessMm } from './edgeOverrides.js';

/**
 * @typedef {Object} TreadEdgeInfo
 * @property {[{x,y},{x,y}]} nominal  [inner, outer] — from the RAW, unedited chain (see
 *   planLayout.js tread.innerChain/outerChain); never affected by manual edge edits.
 * @property {[{x,y},{x,y}]} final    [inner, outer] — the edge actually used to build the
 *   visible outline; identical to nominal unless a manual edit changed it (edgeOverrides.js).
 * @property {boolean} overridden     True if `final` differs from `nominal` at either endpoint
 *   — computed by comparison, not by checking config.manualEdgeOverrides, so a REJECTED
 *   override (edgeOverrides.js signedArea guard) correctly reads as `false`.
 */

/**
 * @typedef {Object} TreadModel
 * @property {string} stepId          e.g. "step-3"
 * @property {number} index
 * @property {'straight'|'winder'|'landing'} type
 * @property {{bottom:number, top:number}} elevation  mm, world Z of the tread slab — top =
 *   the walking surface = (index+1)*riserHeight; bottom = top - thickness.
 * @property {number} thickness       mm (config.treadThickness, carried for self-containment).
 * @property {{x:number,y:number}} direction  Best-known local walking direction for this tread.
 * @property {{atFront:number, atBack:number}} widths
 * @property {TreadEdgeInfo} frontEdge
 * @property {TreadEdgeInfo} backEdge
 * @property {{side:'inner'|'outer', offsetMm:number}|null} overhang  Set only when a manual
 *   per-tread overhang (config.manualTreadOverhangs) was actually applied — an INTENTIONAL
 *   lateral extension of this one tread, so validators must not read the resulting mismatch with
 *   the neighbour's shared edge as a discontinuity.
 * @property {{length:number, depth:number, corners:{x:number,y:number}[]}|null} winderBlank  The
 *   PRODUCTION blank ("formatka") of a winder tread — exactly what the 2D plan and 3D labels show
 *   (winderBlank.js, the plan outline plus the nosing, config.nosing) — so drawings and the material
 *   takeoff can never disagree on it. `null` for straight/landing treads.
 * @property {object|null} winderInfo  Passthrough of tread.winderInfo (planLayout.js) — null
 *   for straight/landing treads.
 * @property {{x:number,y:number}[]} outline  FINAL, nosed footprint — the real as-built shape.
 * @property {{depthMm:number, outline:{x:number,y:number}[]}|null} notch  A groove cut into THIS
 *   tread's own UNDERSIDE, right behind its structural front edge, that the riser directly BELOW
 *   it slots its own overlap (config.riserTopOverlapMm) into — see buildNotch(). `outline` is
 *   this tread's own outline with its front edge receded by `config.riserBoardThickness` (the
 *   groove's back boundary); `depthMm` is how far up from the tread's own bottom it's routed.
 *   `null` whenever there is nothing to notch (no riser boards, a landing, or the overlap/riser
 *   thickness is 0).
 */

// Exported — THE canonical "are these two [inner,outer] edges the same" comparison. Used by
// riserSolver.js too (see its own nominal/final split), so a tread's nominal-vs-final
// question is answered identically everywhere, never reimplemented per solver.
export function edgesEqual(a, b) {
  return pointsEqual(a[0], b[0]) && pointsEqual(a[1], b[1]);
}

// Exported — THE canonical "what was this tread's boundary BEFORE any MANUAL edit" answer,
// for both front and back. riserSolver.js reuses this directly (rather than re-deriving its
// own notion of "nominal") so there is exactly one nominal/final split per tread, not one per
// consumer — see docs/architecture/CONSTRAINTS_AND_VALIDATION.md "RiserModel nominal/final".
//
// `config` is required so the automatic housing recess (edgeOverrides.js applyHousingRecess) can
// be folded into "nominal" too: a housed wanga narrows a tread's own edge as a CONSEQUENCE of the
// chosen construction type, not because anyone dragged anything, so it must never make
// TreadEdgeInfo.overridden (final !== nominal) read as true — that badge/diagnostic is reserved
// for a genuine manual edit (manualEdgeOverrides / manualTreadOverhangs). recessedEdge() applies
// the exact same per-side depth/formula applyHousingRecess uses on `final`, so an unedited tread's
// nominal and final match bit-for-bit; a tread that WAS also manually edited still correctly
// differs (both are recessed by the same amount, but from different starting points).
export function nominalEdgesOf(tread, config) {
  // Podest ma PUSTY innerChain (patrz planLayout.js buildLandingLocal — punkt wejścia-wewnątrz
  // i wyjścia-wewnątrz to ten sam punkt Ic, zerowa długość, więc nie ma osobnego surowego
  // łańcucha). Bez niezależnego źródła nie da się odróżnić "nominalnej" pozycji od "final" na
  // tej stronie — nominal = final jest jedynym uczciwym określeniem (overridden zawsze
  // wyjdzie false dla podestu, co jest poprawne: podest i tak nie jest typowym celem edycji).
  const hasRawChain = tread.innerChain?.length > 0 && tread.outerChain?.length > 0;
  if (!hasRawChain) return { front: tread.frontEdge, back: tread.backEdge };

  const front = [tread.innerChain[0], tread.outerChain[0]];
  const back = [tread.innerChain[tread.innerChain.length - 1], tread.outerChain[tread.outerChain.length - 1]];
  if (!config) return { front, back };

  const recessMm = housingRecessMm(config);
  if (recessMm.inner === 0 && recessMm.outer === 0) return { front, back };
  return recessedEdges({ frontEdge: front, backEdge: back, innerChain: tread.innerChain, outerChain: tread.outerChain }, recessMm);
}

// Stopień prosty nie ma jednego globalnego "kierunku wchodzenia" w danych — da się go jednak
// wprost odczytać z jego własnego, surowego łańcucha wewnętrznego (kierunek od frontu do tyłu
// wzdłuż duszy), niezależnie od ewentualnej edycji. Podest ma PUSTY innerChain (patrz
// nominalEdgesOf powyżej) — dla niego jedyny dostępny wzdłużny odcinek to outerChain (choć
// koncepcyjnie podest ma DWA różne kierunki wejścia/wyjścia, więc to tylko przybliżenie —
// podest i tak nie ma jednego "kierunku wchodzenia" w sensie fizycznym).
function fallbackDirection(tread) {
  const chain = tread.innerChain?.length > 0 ? tread.innerChain : tread.outerChain;
  const a = chain[0];
  const b = chain[chain.length - 1];
  return normalizeVector({ x: b.x - a.x, y: b.y - a.y });
}

function applyNosing(tread, nosing) {
  const { outline, frontEdge } = tread;
  if (nosing <= 0) return outline;
  const [inner0, outer0] = frontEdge;
  const { newInner0, newOuter0 } = shiftFrontEdge(tread, nosing);
  return outline.map((p) => {
    if (pointsEqual(p, inner0)) return newInner0;
    if (pointsEqual(p, outer0)) return newOuter0;
    return p;
  });
}

// The riser below this tread is deliberately taller than its own structural gap by
// `riserTopOverlapMm` (config.js, riserSolver.js RiserModel.elevation.top) — it overlaps UP into
// this tread's own underside instead of butting flush, so wood movement can never open a light
// gap at the joint. For that overlap to have somewhere to GO, this tread needs a matching groove
// (a rabbet, "podfrezowanie") cut into its own underside, right where the riser's own edge sits:
// `riserTopOverlapMm` deep, `riserBoardThickness` wide (along the going direction), starting at
// the tread's own STRUCTURAL front edge (never the nosed one — the nosing overhangs freely past
// the riser with nothing under it, so it must stay solid, full-thickness material; only the
// portion actually above the riser needs to be hollow).
//
// Reuses shiftFrontEdge() with a NEGATIVE distance — its own doc comment already anticipates
// exactly this ("ujemne = do wewnątrz/do przodu, jak przy cofaniu wangi pod podstopień") — the
// same recede-the-front-edge-and-reproject-the-sides math applyNosing() above uses to extend it,
// just in the opposite direction, to get the notch's own BACK boundary (the groove spans from
// there forward to the tread's own structural front edge).
//
// Never for a landing: its innerChain is empty by design (nominalEdgesOf's own doc comment) so
// shiftFrontEdge (which needs innerChain[1]) has nothing to recede along — the same reason nosing
// itself is already zeroed for a landing.
function buildNotch(tread, config) {
  const { hasRiserBoards, riserBoardThickness, riserTopOverlapMm } = config;
  if (!hasRiserBoards || tread.type === 'landing') return null;
  if (!(riserTopOverlapMm > 0) || !(riserBoardThickness > 0)) return null;
  if (!(tread.innerChain?.length > 1) || !(tread.outerChain?.length > 1)) return null;

  const [inner0, outer0] = tread.frontEdge;
  const { newInner0, newOuter0 } = shiftFrontEdge(tread, -riserBoardThickness);
  const outline = tread.outline.map((p) => {
    if (pointsEqual(p, inner0)) return newInner0;
    if (pointsEqual(p, outer0)) return newOuter0;
    return p;
  });
  return { depthMm: riserTopOverlapMm, outline };
}

/**
 * @param {import('./planLayout.js').Tread} tread
 * @param {Object} config  Full staircase config, plus `riserHeight` (see buildStaircase.js)
 * @returns {TreadModel}
 */
export function buildTreadModel(tread, config) {
  const { riserHeight, treadThickness, nosing } = config;
  const isLanding = tread.type === 'landing';
  const effectiveNosing = isLanding ? 0 : nosing; // podest to płaska płyta, bez wysuniętego noska

  const { front: frontNominal, back: backNominal } = nominalEdgesOf(tread, config);
  const frontEdge = { nominal: frontNominal, final: tread.frontEdge, overridden: !edgesEqual(frontNominal, tread.frontEdge) };
  const backEdge = { nominal: backNominal, final: tread.backEdge, overridden: !edgesEqual(backNominal, tread.backEdge) };

  const direction = tread.winderInfo ? tread.winderInfo.direction : fallbackDirection(tread);
  const widths = tread.winderInfo
    ? tread.winderInfo.widths
    : {
        atFront: Math.hypot(frontEdge.final[1].x - frontEdge.final[0].x, frontEdge.final[1].y - frontEdge.final[0].y),
        atBack: Math.hypot(backEdge.final[1].x - backEdge.final[0].x, backEdge.final[1].y - backEdge.final[0].y),
      };

  const top = (tread.index + 1) * riserHeight;
  const bottom = top - treadThickness;

  return {
    stepId: `step-${tread.index}`,
    index: tread.index,
    type: tread.type,
    elevation: { bottom, top },
    thickness: treadThickness,
    direction,
    widths,
    frontEdge,
    backEdge,
    winderInfo: tread.winderInfo || null,
    winderBlank: tread.type === 'winder' ? computeWinderBlank(tread, nosing) : null,
    overhang: tread.overhang ?? null,
    outline: applyNosing(tread, effectiveNosing),
    notch: buildNotch(tread, config),
  };
}

export function buildTreadModels(planLayout, config) {
  return planLayout.treads.map((tread) => buildTreadModel(tread, config));
}
