// Stairwell variants — stage 2 of the room-first designer: a SHORT list of stairs that fit the room (stairwell.js),
// start at its entry and end on the opening's exit edge.
//
// Few variants, decided by rules first (user decision 2026-10-16 — no sweeps of dozens of combinations):
//   - the stair TYPE and turn direction follow from the entry and the exit (stairwell.js requiredStair);
//   - the WIDTH is the user's (`stairWidth`), reduced (in 10 mm steps, never below VARIANT_MIN_WIDTH_MM) only when the
//     room or the exit edge is narrower than that — the variant says so;
//   - WINDERS: n − 1, n, n + 1 around n = round(walkline arc / going) + 1 (a quarter arc of `walklineOffset` per 90°
//     turn, a half circle for one 180° zone) — plus ONE landing variant for comparison;
//   - a U is one 180° winder zone when the room's width leaves an axis gap of 0..U_ZONE_MAX_AXIS_GAP_MM, else two
//     90° turns with a middle flight.
// Each variant is solved once: a straight or L stair by ONE stairwell fit (stairwellFit.js — the going and the
// straight counts), the exit side exact (the key), the side along the far wall within limits (never past the wall,
// always reaching the exit edge); a U by `solveUExit` (its exit lies at A − C from the far wall, so the going is
// solved for that difference, then equal straights are added to A and C up to the wall). The result is measured on a
// real layout (stairwellReport, ceiling fit, the validator) and the list is sorted: fitting first, then the riser in
// its range, the number of distinct rules in error, collisions with the ceiling, 2h+s nearest the middle of its band.
//
// Pure: no Three.js, no config mutation. `patch` = the config fields applying a variant writes. It lives outside
// src/geometry because it reads the validator (geometry never imports validation — RULES.md).

import { deriveStairData, deriveCeilingFit } from '../config/schema.js';
import { buildPlanLayout } from '../geometry/planLayout.js';
import { solveStairwellFit, outerSideLengths, BLONDEL_TARGET_MM, FIT_GOING_RANGE_MM, FIT_MAX_TREADS_PER_LEG } from '../geometry/stairwellFit.js';
import { entryFrame, openingExitEdge, requiredStair, stairPlacement, stairwellReport, ROOM_SIDES } from '../geometry/stairwell.js';
import { resolveOpening, openingFrame } from '../geometry/ceilingOpening.js';
import { treadGoingAtOffsetFromInner, WINDER_WIDTH_MEASURE_OFFSET_MM } from '../geometry/walklineModel.js';
import { validateStaircase } from '../validator/StaircaseValidator.js';

// PL-LEGAL-A-05* (stairWidth >= 0.8 m for the stair kinds the workshop builds) — the narrowest width the designer
// may reduce to.
export const VARIANT_MIN_WIDTH_MM = 800;
const WIDTH_STEP_MM = 10;
// The widest axis gap a U still gets as ONE 180° zone (wider: two turns with a middle flight). SOFTWARE_DESIGN_CHOICE
// (STAIR3D-WELL-01, src/rules/sets/stairwellFitAssumptions.js), not a published figure.
export const U_ZONE_MAX_AXIS_GAP_MM = 300;
// winders per 90° turn the designer proposes: the "Zabiegowe (każdy skręt)" slider allows 2, but two winders
// turning 90° are not a stair the workshop offers (SOFTWARE_DESIGN_CHOICE, STAIR3D-WELL-01)
const WINDERS_PER_TURN_RANGE = { min: 3, max: 6 };
const ZONE_WINDERS_RANGE = { min: 3, max: 14 }; // the "Zabiegowe łącznie (klatka 180°)" slider
const GOING_SAMPLE_STEP_MM = 10;
const EXIT_TOLERANCE_MM = 1;
// The straight-count differences nA − nC a U is tried with (the flights of one U never differ by more in practice).
const U_COUNT_DIFFERENCE_MAX = 8;

const floorTo = (v, step) => Math.floor(v / step + 1e-9) * step;
const lexLess = (a, b) => {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return a[i] < b[i];
  return false;
};

// The opening's outline in the ROOM frame (its own coordinates — the frame does not matter for that).
function openingRoomOutline(config) {
  return resolveOpening(config, { toPlan: (p) => p, toRelative: (p) => p }).relativeOutline;
}

function naturalWinders(config, halfTurn) {
  const arc = (halfTurn ? Math.PI : Math.PI / 2) * (Number(config.walklineOffset) || 400);
  const g = Number(config.treadGoing) > 0 ? config.treadGoing : 250;
  return Math.round(arc / g) + 1;
}

// Three counts centred on n, the window slid to stay inside the range.
function around(n, range) {
  const lo = Math.max(range.min, Math.min(n - 1, range.max - 2));
  const out = [];
  for (let k = lo; k <= Math.min(range.max, lo + 2); k++) out.push(k);
  return out;
}

/**
 * The side targets the room sets for one stair type (entry-local frame: a across from the entry side's left end,
 * b depth into the room), and the widest stair width they allow.
 */
function roomTargets(config, frame, exit, required, oneZone) {
  const gap = Math.max(0, Number(config.stairwellWallGapMm) || 0);
  const offset = Number(config.stairwellEntryOffsetMm) || 0;
  const t = Number(config.stringerThickness) || 0;
  const e1 = frame.toLocal(exit.a);
  const e2 = frame.toLocal(exit.b);
  const aLo = Math.min(e1.a, e2.a);
  const aHi = Math.max(e1.a, e2.a);
  const bLo = Math.min(e1.b, e2.b);
  const bHi = Math.max(e1.b, e2.b);
  const { across, depth } = frame;
  const right = required.turnDirection !== 'left';
  if (required.stairType === 'straight') {
    const wallRight = config.stairwellStraightWall === 'right';
    const widthMax = Math.min(across - 2 * gap, wallRight ? across - gap - aLo : aHi - gap);
    return { kind: 'fit', targets: { A: (e1.b + e2.b) / 2 - offset }, key: 'A', limits: {}, widthMax };
  }
  if (required.stairType === 'L') {
    const top = Math.min(depth - gap, bHi);
    const B = right ? (e1.a + e2.a) / 2 - gap : across - gap - (e1.a + e2.a) / 2;
    // side A: never past the far wall / the exit edge's far end, and long enough for flight B's back edge to lie on
    // the exit edge (that lower limit depends on the width — set per candidate)
    return { kind: 'fit', targets: { A: top - offset, B }, key: 'B', limits: { A: { max: top - offset } }, aMinForWidth: (w) => bLo + w - offset, widthMax: Math.min(across - 2 * gap, top - bLo) };
  }
  // U: A up to the far wall, B across to the other wall (or the exit edge's end), C back to the exit line
  const A = depth - gap - offset;
  const B = right ? Math.min(across - gap, aHi) - gap : across - gap - Math.max(gap, aLo);
  const exitB = (e1.b + e2.b) / 2;
  // the width the exit edge leaves flight C (its back edge must lie on the edge)
  const cEdge = right ? gap + B - aLo : aHi - (across - gap - B);
  const widthMax = Math.min(oneZone ? (B + t) / 2 : B / 2, cEdge);
  return { kind: 'u', targets: { A, B, C: A + offset - exitB }, widthMax, exitB, offset };
}

function sidesPatch(targets, key) {
  return {
    stairwellFitEnabled: true,
    stairwellManualCounts: false,
    stairwellSideAMm: targets.A ?? 0,
    stairwellSideBMm: targets.B ?? 0,
    stairwellSideCMm: targets.C ?? 0,
    stairwellKeySide: key,
  };
}

/**
 * The candidate variants (not solved yet) for the room, entry and exit in `config`.
 * @returns {{ok:boolean, message:string, required:Object|null, rejected:string[], candidates:{id, label, patch, width, widthReduced, roomTargets}[]}}
 */
export function planStairwellVariants(config) {
  const frame = entryFrame(config);
  if (!frame) return { ok: false, message: 'Włącz klatkę (pomieszczenie) i podaj jej wymiary.', required: null, rejected: [], candidates: [] };
  const side = ROOM_SIDES.includes(config.stairwellExitSide) ? config.stairwellExitSide : null;
  const exit = side ? openingExitEdge(openingRoomOutline(config), side) : null;
  if (!exit) return { ok: false, message: `Otwór w stropie nie ma krawędzi od strony ${side || '—'} — wskaż krawędź wyjścia.`, required: null, rejected: [], candidates: [] };
  const required = requiredStair(frame, exit, config.turnDirection);
  if (!required) return { ok: false, message: 'Krawędź wyjścia jest ukośna względem wejścia — żaden obsługiwany typ schodów nie kończy się prostopadle do niej.', required: null, rejected: [], candidates: [] };

  const userWidth = Number(config.stairWidth) || 900;
  const t = Number(config.stringerThickness) || 0;
  const base = { stairType: required.stairType, ...(required.turnDirection ? { turnDirection: required.turnDirection } : {}) };
  const candidates = [];
  const rejected = [];
  const widthFor = (rt) => (userWidth <= rt.widthMax + 1e-6 ? userWidth : floorTo(rt.widthMax, WIDTH_STEP_MM));
  const push = (id, label, patch, rt) => {
    const width = widthFor(rt);
    if (!(width >= VARIANT_MIN_WIDTH_MM)) {
      rejected.push(`${label}: szerokość biegu musiałaby być ≤ ${Math.floor(rt.widthMax)} mm, mniej niż ${VARIANT_MIN_WIDTH_MM} mm.`);
      return;
    }
    const limits = rt.aMinForWidth ? { ...rt.limits, A: { ...rt.limits.A, min: rt.aMinForWidth(width) } } : rt.limits;
    candidates.push({ id, label, patch: { ...base, ...patch, stairWidth: width }, width, widthReduced: width < userWidth, roomTargets: { ...rt, limits } });
  };

  if (required.stairType === 'straight') {
    push('straight', 'Proste', {}, roomTargets(config, frame, exit, required, false));
  } else if (required.stairType === 'L') {
    const rt = roomTargets(config, frame, exit, required, false);
    for (const n of around(naturalWinders(config, false), WINDERS_PER_TURN_RANGE)) push(`L-w${n}`, `L, ${n} zabiegowe`, { turn1Type: 'winder', windersPerTurn: n }, rt);
    push('L-landing', 'L, podest', { turn1Type: 'landing' }, rt);
  } else {
    // one 180° zone when the axis gap it needs is 0..U_ZONE_MAX_AXIS_GAP_MM at the width it gets
    const zoneRt = roomTargets(config, frame, exit, required, true);
    const zoneWidth = widthFor(zoneRt);
    const axisGap = zoneRt.targets.B - 2 * zoneWidth + t;
    const twoRt = roomTargets(config, frame, exit, required, false);
    if (axisGap >= -1e-6 && axisGap <= U_ZONE_MAX_AXIS_GAP_MM) {
      for (const n of around(naturalWinders(config, true), ZONE_WINDERS_RANGE)) {
        push(`U-zone${n}`, `U, strefa 180°, ${n} zabiegowych`, { turn1Type: 'winder', turn2Type: 'winder', uSingleWinderZone: true, uWindersTotal: n, treadsLegB: 0 }, zoneRt);
      }
    } else {
      for (const n of around(naturalWinders(config, false), WINDERS_PER_TURN_RANGE)) {
        push(`U-w${n}`, `U, 2 × ${n} zabiegowe`, { turn1Type: 'winder', turn2Type: 'winder', uSingleWinderZone: false, windersPerTurn: n }, twoRt);
      }
    }
    push('U-landing', 'U, podesty', { turn1Type: 'landing', turn2Type: 'landing', uSingleWinderZone: false, mergeLandings: false }, twoRt);
  }
  const message = candidates.length ? '' : rejected.join(' ') || 'Brak wariantów.';
  return { ok: candidates.length > 0, message, required, rejected, candidates };
}

// One fit for a straight / L candidate; the exit-driven solve for a U.
function fitCandidate(config, cand) {
  const rt = cand.roomTargets;
  if (rt.kind === 'u') return solveUExit(config, cand);
  return solveStairwellFit({ ...config, ...cand.patch, ...sidesPatch(rt.targets, rt.key) }, { limits: rt.limits });
}

// Sides A, B, C of the outer line of a trial U (no hand edits).
function uSides(config) {
  const derived = deriveStairData(config);
  const layout = buildPlanLayout({ ...config, riserHeight: derived.riserHeight, manualEdgeOverrides: {}, manualTreadOverhangs: {} });
  const [A, B, C] = outerSideLengths(layout);
  return { A, B, C };
}

/**
 * A U ends at depth offset + A − C (the outer line runs up A, across B, back down C). For each difference d = nA − nC
 * of the straight counts the going is solved so that this is the exit line (sampled over the going range, then
 * halved — the turns' shape changes with the going); at that going one more straight tread in BOTH flights keeps the
 * exit and lengthens A by one going (checked on the real layout — not when a flight starts with winders), so A is
 * filled up to the far wall and the counts with the best riser / 2h+s are kept. Side B must be met too (flight C has
 * to reach the side wall / the exit edge): a one-zone U gets it from the axis gap (exact); a two-turn U from its
 * middle flight (a few counts the room allows) and, for the rest, a NARROWER stair — never below
 * VARIANT_MIN_WIDTH_MM, re-solved at the width it gets.
 * @returns {{values:Object|null, message:string}}
 */
function solveUExit(config, cand) {
  const rt = cand.roomTargets;
  const zone = !!cand.patch.uSingleWinderZone;
  const t = Number(config.stringerThickness) || 0;
  let width = cand.width;
  // middle-flight counts worth trying: B ≈ 2 × width + nB × going, the going 150..320, the width down to the minimum
  let nBs = [0];
  if (!zone) {
    const lo = Math.max(0, Math.floor((rt.targets.B - 2 * width) / FIT_GOING_RANGE_MM.max) - 1);
    const hi = Math.min(FIT_MAX_TREADS_PER_LEG, Math.ceil((rt.targets.B - 2 * VARIANT_MIN_WIDTH_MM) / FIT_GOING_RANGE_MM.min));
    nBs = [];
    for (let n = lo; n <= hi && nBs.length < 8; n++) nBs.push(n);
  }
  let result = null;
  for (let round = 0; round < 4; round++) {
    const base = { ...config, ...cand.patch, stairWidth: width, stairwellFitEnabled: false };
    if (zone) base.uAxisGapMm = Math.max(0, Math.round((rt.targets.B - 2 * width + t) * 1000) / 1000);
    result = solveUExitAt(config, base, rt, zone, nBs);
    if (!result || zone) break;
    // the width that makes side B exact at these counts and going (B grows by 2 mm per mm of width); never wider than
    // the candidate's (the user's) width
    const nextWidth = Math.min(cand.width, Math.round((width - (result.sideB - rt.targets.B) / 2) * 10) / 10);
    if (Math.abs(nextWidth - width) <= 0.05) break;
    if (nextWidth < VARIANT_MIN_WIDTH_MM) return { values: null, message: `Bok B wymagałby szerokości biegu ${Math.round(nextWidth)} mm (mniej niż ${VARIANT_MIN_WIDTH_MM} mm).` };
    width = nextWidth;
    nBs = [result.cfg.treadsLegB];
  }
  if (!result) return { values: null, message: 'Nie da się dobrać głębokości stopnia, przy której ostatni stopień kończy się na krawędzi wyjścia, a bieg C dochodzi do ściany.' };
  if (!zone && Math.abs(result.sideB - rt.targets.B) > EXIT_TOLERANCE_MM) {
    return { values: null, message: `Bok B wychodzi ${Math.round(result.sideB)} mm zamiast ${Math.round(rt.targets.B)} mm — bieg C nie trafia w krawędź wyjścia.` };
  }
  const c = result.cfg;
  const values = { treadGoing: c.treadGoing, treadsLegA: c.treadsLegA, treadsLegB: c.treadsLegB, treadsLegC: c.treadsLegC, stairWidth: c.stairWidth };
  if (zone) values.uAxisGapMm = c.uAxisGapMm;
  return { values, message: '' };
}

// The U solve at a fixed width for the given middle counts (see solveUExit). Every kept variant is measured on its
// real layout: exit within EXIT_TOLERANCE_MM, A not past the far wall, B not short of its target (a longer B is met
// by narrowing the stair).
function solveUExitAt(config, base, rt, zone, nBs) {
  const exitDepth = rt.exitB - rt.offset; // A − C must come out at this
  const riserOff = (h) => Math.max(0, config.minRiser - h, h - config.maxRiser);
  const scoreOf = (derived, shrink, slack) => [derived.turnFeasible ? 0 : 1, riserOff(derived.riserHeight) > 0 ? 1 : 0, Math.round(Math.abs(derived.blondel - BLONDEL_TARGET_MM) / 5), shrink, slack];
  const samples = [];
  for (let g = FIT_GOING_RANGE_MM.min; g < FIT_GOING_RANGE_MM.max; g += GOING_SAMPLE_STEP_MM) samples.push(g);
  samples.push(FIT_GOING_RANGE_MM.max);

  let best = null;
  for (const nB of nBs) {
    for (let d = -U_COUNT_DIFFERENCE_MAX; d <= U_COUNT_DIFFERENCE_MAX; d++) {
      const nC0 = Math.max(0, -d);
      const nA0 = nC0 + d;
      const trial = (g, k = 0) => ({ ...base, treadGoing: g, treadsLegA: nA0 + k, treadsLegB: nB, treadsLegC: nC0 + k });
      const off = (g) => {
        const s = uSides(trial(g));
        return s.A - s.C - exitDepth;
      };
      // the bracket with the largest going where the exit offset changes sign
      const values = samples.map(off);
      let g = null;
      for (let i = samples.length - 1; i > 0 && g === null; i--) {
        let lo = samples[i - 1];
        let hi = samples[i];
        let fLo = values[i - 1];
        const fHi = values[i];
        if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) continue;
        if (Math.abs(fHi) <= EXIT_TOLERANCE_MM / 10) {
          g = hi;
          break;
        }
        if (Math.sign(fLo) === Math.sign(fHi)) continue;
        for (let k = 0; k < 40 && hi - lo > 1e-4; k++) {
          const mid = (lo + hi) / 2;
          const fm = off(mid);
          if (Math.sign(fm) === Math.sign(fLo)) {
            lo = mid;
            fLo = fm;
          } else hi = mid;
        }
        g = (lo + hi) / 2;
      }
      if (g === null) continue;
      for (let k = 0; nA0 + k <= FIT_MAX_TREADS_PER_LEG && nC0 + k <= FIT_MAX_TREADS_PER_LEG; k++) {
        const cfg = trial(g, k);
        const s = uSides(cfg);
        if (s.A > rt.targets.A + EXIT_TOLERANCE_MM) break;
        if (Math.abs(s.A - s.C - exitDepth) > EXIT_TOLERANCE_MM) continue;
        if (!zone && s.B < rt.targets.B - EXIT_TOLERANCE_MM) continue;
        if (!zone && base.stairWidth - (s.B - rt.targets.B) / 2 < VARIANT_MIN_WIDTH_MM) continue; // would need too narrow a stair
        const derived = deriveStairData(cfg);
        const score = scoreOf(derived, zone ? 0 : (s.B - rt.targets.B) / 2, rt.targets.A - s.A);
        if (!best || lexLess(score, best.score)) best = { cfg, score, sideB: s.B };
      }
    }
  }
  return best;
}

/**
 * Solves and measures one candidate.
 * @returns {{id, label, ok:boolean, patch:Object|null, problems:string[], metrics:Object|null, width:number, widthReduced:boolean}}
 */
export function evaluateStairwellVariant(config, cand) {
  const fit = fitCandidate(config, cand);
  const out = { id: cand.id, label: cand.label, width: cand.width, widthReduced: cand.widthReduced, ok: false, patch: null, problems: [], metrics: null };
  if (!fit?.values) {
    out.problems.push(fit?.message || 'Nie da się dopasować głębokości stopnia.');
    return out;
  }
  const patch = { ...cand.patch, ...fit.values, stairwellFitEnabled: false };
  const cfg = { ...config, ...patch, manualEdgeOverrides: {}, manualTreadOverhangs: {} };
  const derived = deriveStairData(cfg);
  const full = { ...cfg, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(full);
  const report = stairwellReport(full, planLayout, stairPlacement(full, planLayout), resolveOpening(full, openingFrame(full, planLayout)).relativeOutline);
  const ceiling = deriveCeilingFit(full, planLayout, derived.riserHeight);
  const validation = validateStaircase(full);
  const winders = planLayout.treads.filter((t) => t.type === 'winder');
  const winderGoingAt400 = winders.length ? Math.min(...winders.map((t) => treadGoingAtOffsetFromInner(t, WINDER_WIDTH_MEASURE_OFFSET_MM, planLayout))) : null;
  out.patch = patch;
  out.problems = report.diagnostics.map((d) => d.message);
  out.ok = report.diagnostics.length === 0;
  out.metrics = {
    numTreads: derived.numTreads,
    riserHeight: derived.riserHeight,
    riserOk: !!derived.riserRangeOk,
    treadGoing: patch.treadGoing,
    blondel: derived.blondel,
    blondelOk: !!derived.blondelOk,
    winders: winders.length,
    winderGoingAt400,
    treadsLegA: patch.treadsLegA,
    treadsLegB: patch.treadsLegB ?? null,
    treadsLegC: patch.treadsLegC ?? null,
    uAxisGapMm: patch.uAxisGapMm ?? null,
    ceilingCollisions: ceiling.violatingTreads.length,
    errors: validation.errors.length,
    // distinct rules broken (one rule failing on every winder is one problem, not five)
    errorRules: new Set(validation.errors.map((d) => d.ruleId)).size,
    warnings: validation.warnings.length,
    exitOffsetMm: report.exitOffsetMm,
    protrusionMm: report.protrusionMm,
  };
  return out;
}

const sortKey = (v) =>
  v.metrics ? [v.ok ? 0 : 1, v.metrics.riserOk ? 0 : 1, v.metrics.errorRules, v.metrics.ceilingCollisions, Math.abs(v.metrics.blondel - BLONDEL_TARGET_MM)] : [2, 0, 0, 0, 0];

/**
 * The variant list for the room in `config`, best first.
 * @returns {{ok:boolean, message:string, required:Object|null, rejected:string[], variants:Object[]}}
 */
export function generateStairwellVariants(config) {
  const plan = planStairwellVariants(config);
  const variants = plan.candidates.map((c) => evaluateStairwellVariant(config, c));
  variants.sort((x, y) => {
    const a = sortKey(x);
    const b = sortKey(y);
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] - b[i];
    return 0;
  });
  return { ok: plan.ok, message: plan.message, required: plan.required, rejected: plan.rejected, variants };
}
