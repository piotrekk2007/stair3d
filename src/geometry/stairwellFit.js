// Stairwell fit ("Dopasuj do klatki") — derives the tread going and the straight-tread counts from the
// stairwell's side lengths, the way totalRise already derives the riser height.
//
// A SIDE is one straight stretch of the stair's OUTER line (`planLayout.outerFullPath` — the outer face of
// the outer wanga, i.e. the wall line), measured from the first tread's front edge (WITHOUT its nosing, which
// projects `config.nosing` mm further) to the corner / to the back edge of the last tread. Side A runs along
// flight A, B along flight B, C along flight C (U only); a straight stair has side A only.
//
// The user gives any subset of sides plus a KEY side. The key side must come out exactly: for every possible
// number of treads on the key flight, the going is solved so that side is met to the millimetre; the other
// flights' tread counts are then chosen to bring their sides as close as possible (one going per stair — the
// going must stay constant, so a non-key side generally cannot be exact). Candidates whose going is outside
// FIT_GOING_RANGE_MM or whose turn is infeasible are dropped. THE GIVEN DIMENSIONS COME FIRST (user decision
// 2026-10-10 — the stairwell is what it is: a stair that fits it with too high a riser is reported, a stair with a
// comfortable riser that is a metre longer than the room is useless). The order of preference (`scoreOf`):
//   1. every non-key side within ONE GOING of its dimension (the nearest tread count or the one next to it);
//   2. the riser height inside [minRiser, maxRiser];
//   3. riser in range: the smallest total deviation of the non-key sides, then 2h+s closest to BLONDEL_TARGET_MM;
//      riser out of range (the room is too short for a regular stair): 2h+s first — it balances the going against
//      the riser, so the result is neither a ladder nor a row of slivers — then the deviation.
// Variants failing (1) come last, by deviation. A riser outside the range is reported as a WARNING here and judged
// by the validator as always.
//
// Manual counts (`stairwellManualCounts`): the user sets every flight's tread count by hand; the fit then only
// solves the going that makes the key side exact, and reports how far the other sides are off.
//
// Nothing here is a new geometric rule: every side length is MEASURED on a real buildPlanLayout() result
// (RULES.md #8) — this file only searches over parameters. It is pure (no Three.js, no config mutation). The
// winder count, stair width and everything else stay the user's; only treadGoing and treadsLegA/B/C change.

import { buildPlanLayout } from './planLayout.js';
import { deriveStairData, BLONDEL_RANGE_MM } from '../config/schema.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { wellEnabled, wellFixedTargets, wellSideLetters, wellMainSide, stairwellMeasureLine, lineSides } from './stairwell.js';

const COUNT_FIELD = { A: 'treadsLegA', B: 'treadsLegB', C: 'treadsLegC' };

// The going the fit may choose: the same range the "Głębokość stopnia" slider offers (a fitted value outside it
// could not be shown or edited there). Not a legal limit — PL-LEGAL-A-01 (2h+s) is what bounds it in practice.
// (150: a very tight stairwell — the user's own project needed 178.6 mm, below the former 180 minimum.)
export const FIT_GOING_RANGE_MM = { min: 150, max: 320 };
// Straight treads per flight the fit may choose — the "Proste (odc. …)" slider range.
export const FIT_MAX_TREADS_PER_LEG = 15;
// Tie-break only (see above): the middle of the PL-LEGAL-A-01 band, 600–650 mm. SOFTWARE_DESIGN_CHOICE (see
// src/rules/sets/stairwellFitAssumptions.js, STAIR3D-FIT-01), not a legal or published figure.
export const BLONDEL_TARGET_MM = (BLONDEL_RANGE_MM.min + BLONDEL_RANGE_MM.max) / 2;
// A non-key side within this of its target counts as met (sub-millimetre floating-point noise).
const SIDE_MET_TOLERANCE_MM = 0.5;
// Two directions closer than this (sin of the angle) are the same side of the outer line.
const SAME_DIRECTION_SIN = 1e-6;

// (an S has the U's three sides; its B — from the first turn's outer corner to the second turn's dusza — follows
// flight B's count and the going like A and C, not the width)
function sideLetters(stairType) {
  return stairType === 'U' || stairType === 'S' ? ['A', 'B', 'C'] : stairType === 'L' ? ['A', 'B'] : ['A'];
}

/**
 * Lengths of the straight sides of the stair's outer line (collinear points merged), in walking order.
 * @param {{outerFullPath:{x:number,y:number}[]}} planLayout
 * @returns {number[]}
 */
export function outerSideLengths(planLayout, line = 'outer', stairType = null) {
  // with the stair type: the sides found by direction (stairwell.js lineSides — a flight with no piece on this line is
  // a zero-length side, the letters do not shift)
  if (stairType) {
    const sides = lineSides(planLayout, line, stairType);
    return sideLetters(stairType).map((s) => sides[s]?.length ?? 0);
  }
  const path = (line === 'inner' ? planLayout.innerFullPath : planLayout.outerFullPath) || [];
  const sides = [];
  let dir = null;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const d = { x: dx / len, y: dy / len };
    const sameSide = dir && Math.abs(dir.x * d.y - dir.y * d.x) < SAME_DIRECTION_SIN && dir.x * d.x + dir.y * d.y > 0;
    if (sameSide) sides[sides.length - 1] += len;
    else sides.push(len);
    dir = d;
  }
  return sides;
}

/** The side targets the config asks for: { A: mm|null, ... } for the sides this stair type has. */
export function stairwellTargets(config) {
  const out = {};
  for (const s of sideLetters(config.stairType)) {
    const v = config[`stairwellSide${s}Mm`];
    out[s] = Number.isFinite(v) && v > 0 ? v : null;
  }
  return out;
}

// (a side is a stretch of the RAW outer line, which no manual edge edit moves — the edits are left out, so the
// search neither pays for them nor trips over an edit that does not fit a trial layout)
function measure(config) {
  const derived = deriveStairData(config);
  const planLayout = buildPlanLayout({ ...config, riserHeight: derived.riserHeight, manualEdgeOverrides: {}, manualTreadOverhangs: {} });
  // (along the line the sides are measured on — an S may be measured along its inner line, stairwell.js
  // stairwellMeasureLine)
  return { derived, sides: outerSideLengths(planLayout, stairwellMeasureLine(config), config.stairType) };
}

function sideOf(config, letter) {
  return measure(config).sides[sideLetters(config.stairType).indexOf(letter)];
}

// Going that makes `letter` come out at `target`, all counts fixed. A side grows with the going, but not along one
// straight line: with a small going the winder zone is laid out differently (the walkline split is clamped, or the
// walkline itself is moved — geometry/winderArc.js), so the side is sampled over the range, the stretch that crosses
// the target is found (the one with the largest going when there are several) and the crossing is narrowed down on
// real layouts.
const GOING_SAMPLE_STEP_MM = 10;
const GOING_SOLVE_ITERATIONS = 40;
function solveGoing(config, letter, target) {
  const at = (g) => sideOf({ ...config, treadGoing: g }, letter);
  const samples = [];
  for (let g = FIT_GOING_RANGE_MM.min; g < FIT_GOING_RANGE_MM.max; g += GOING_SAMPLE_STEP_MM) samples.push(g);
  samples.push(FIT_GOING_RANGE_MM.max);
  const values = samples.map(at);
  for (let i = samples.length - 1; i > 0; i--) {
    let lo = samples[i - 1];
    let hi = samples[i];
    let sLo = values[i - 1];
    let sHi = values[i];
    if (!Number.isFinite(sLo) || !Number.isFinite(sHi) || !(sLo <= target + SIDE_MET_TOLERANCE_MM && sHi >= target - SIDE_MET_TOLERANCE_MM)) continue;
    for (let k = 0; k < GOING_SOLVE_ITERATIONS; k++) {
      // the straight line through the two ends first (exact when the stretch is one regime), halving as a fallback
      const guess = sHi - sLo > 1e-9 ? lo + ((target - sLo) * (hi - lo)) / (sHi - sLo) : (lo + hi) / 2;
      const g = k % 2 === 0 ? Math.min(hi, Math.max(lo, guess)) : (lo + hi) / 2;
      const v = at(g);
      if (!Number.isFinite(v)) break;
      if (Math.abs(v - target) <= SIDE_MET_TOLERANCE_MM / 10) return g;
      if (v < target) [lo, sLo] = [g, v];
      else [hi, sHi] = [g, v];
    }
  }
  return null;
}

// How `letter`'s side grows with its own flight's tread count at the current going. One more straight tread adds one
// going to its own side and nothing else — except from 0 to 1: a flight that starts or ends with winders has them
// pinned to the inner corner (geometry/winderArc.js), so the first count is measured on its own and the line is
// fitted from minCount + 1 on. The chosen variant is always measured on a real layout afterwards.
function sideVsCount(config, letter, minCount) {
  const field = COUNT_FIELD[letter];
  const at = (n) => sideOf({ ...config, [field]: n }, letter);
  const s1 = at(minCount + 1);
  return { minCount, first: at(minCount), s1, step: at(minCount + 2) - s1 };
}

function sideAtCount(line, n) {
  return n === line.minCount ? line.first : line.s1 + (n - line.minCount - 1) * line.step;
}

// Every combination of tread counts for the given flights (each minCount..FIT_MAX_TREADS_PER_LEG).
function countCombos(letters, minCountFor, maxCountFor = () => FIT_MAX_TREADS_PER_LEG) {
  let combos = [{}];
  for (const s of letters) {
    const next = [];
    for (const c of combos) for (let n = minCountFor(s); n <= maxCountFor(s); n++) next.push({ ...c, [s]: n });
    combos = next;
  }
  return combos;
}

// Scores are compared term by term; differences below SCORE_EPS count as a tie (floating-point noise).
const SCORE_EPS = 1e-6;
function lexicographicallyLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > SCORE_EPS) return a[i] < b[i];
  }
  return false;
}

function fitDiag(severity, parameter, message, extra = {}) {
  return createDiagnostic({ ruleId: 'STAIR3D-FIT-01', severity, elementType: 'stair', elementId: null, parameter, message, ...extra });
}

/**
 * @typedef {Object} StairwellFit
 * @property {boolean} enabled
 * @property {'OFF'|'OK'|'APPROX'|'NO_SOLUTION'|'NO_KEY'} status   APPROX = key side exact, another side off
 * @property {Object|null} values   { treadGoing, treadsLegA, treadsLegB, treadsLegC } to use, or null
 * @property {{side:string, target:number|null, achieved:number, deviation:number|null, key:boolean}[]} sides
 * @property {number|null} blondel
 * @property {number|null} riserHeight
 * @property {string} message
 * @property {import('../diagnostics/diagnostic.js').Diagnostic[]} diagnostics
 */

/**
 * @param {Object} config  the user's config (targets in stairwellSide{A,B,C}Mm, key in stairwellKeySide)
 * @param {{limits?: Object<string, {min?:number, max?:number}>, freeSides?: string[], allowInfeasible?: boolean}} [opts]  `freeSides`: sides with no target
 *   whose flights' counts are still CHOSEN (for the riser / 2h+s — a FREE side of the room-first designer, user
 *   decision 2026-10-16); without it a side with no target keeps the config's count.  `limits`: a range a non-key side must stay in
 *   (a wall it must not pass, an exit edge it must reach — the room-first designer, designer/stairwellVariants.js): a
 *   variant outside it (± SIDE_MET_TOLERANCE_MM) is dropped; inside, the deviation from the target counts as usual
 * @returns {StairwellFit}
 */
export function solveStairwellFit(config, opts = {}) {
  const off = { enabled: false, status: 'OFF', values: null, sides: [], blondel: null, riserHeight: null, message: '', diagnostics: [] };
  if (!config.stairwellFitEnabled) return off;
  const limits = opts.limits || {};
  // |achieved − target|, or null for a side outside its limits (the variant is dropped)
  const deviationOf = (s, achieved, target) => {
    const lim = limits[s];
    if (lim && ((Number.isFinite(lim.max) && achieved > lim.max + SIDE_MET_TOLERANCE_MM) || (Number.isFinite(lim.min) && achieved < lim.min - SIDE_MET_TOLERANCE_MM))) return null;
    return Math.abs(achieved - target);
  };
  const letters = sideLetters(config.stairType);
  const targets = stairwellTargets(config);
  const key = letters.includes(config.stairwellKeySide) ? config.stairwellKeySide : letters[0];
  if (targets[key] === null) {
    const message = `Dopasowanie do klatki: bok kluczowy ${key} nie ma podanego wymiaru — podaj go albo wybierz inny bok kluczowy. Parametry schodów zostają bez zmian.`;
    return { ...off, enabled: true, status: 'NO_KEY', message, diagnostics: [fitDiag('ERROR', 'stairwellKeySide', message)] };
  }
  const others = letters.filter((s) => s !== key && targets[s] !== null);
  const minCountFor = (s) => (s === 'A' && config.stairType === 'straight' ? 1 : 0);
  // a U laid out as one 180° winder zone (winderArc.js isHalfTurnU) has no straight tread in B, and must keep none
  const oneZone = !!config.uSingleWinderZone && config.stairType === 'U' && config.turn1Type === 'winder' && config.turn2Type === 'winder';
  const maxCountFor = (s) => (oneZone && s === 'B' ? 0 : FIT_MAX_TREADS_PER_LEG);
  // ...and its side B is two widths plus the gap between A's and C's inner lines (axis gap − board thickness), whatever
  // the going: given B, the AXIS GAP is what meets it, exactly (no tread count could)
  const axisGapFromB = oneZone ? oneZoneAxisGapFor(config, targets.B) : null;
  if (axisGapFromB !== null) config = { ...config, uAxisGapMm: axisGapFromB };

  // The order of preference described in the header. `deviations` = |achieved − target| of every non-key side.
  const riserOff = (derived) => Math.max(0, config.minRiser - derived.riserHeight, derived.riserHeight - config.maxRiser);
  const scoreOf = (derived, deviations, going) => {
    const total = Math.round(deviations.reduce((sum, d) => sum + d, 0));
    const blondel = Math.abs(derived.blondel - BLONDEL_TARGET_MM);
    if (deviations.some((d) => d > going + SIDE_MET_TOLERANCE_MM)) return [1, 0, total, blondel, 0];
    return riserOff(derived) > 0 ? [0, 1, blondel, total, 0] : [0, 0, total, blondel, 0];
  };
  const manual = !!config.stairwellManualCounts;
  // a turn the layout calls infeasible (too few winders for the walkline, …) drops a variant — unless `allowInfeasible`
  // (the stairwell's fixed sides, which must hold anyway: then it only ranks last, and the validator reports the turn)
  const strictTurn = !manual && !opts.allowInfeasible;
  // manual counts: every flight keeps the user's count — one candidate, only the going is solved
  const free = (opts.freeSides || []).filter((s) => letters.includes(s) && s !== key && !others.includes(s));
  const varied = [...others, ...free];
  const combos = manual ? [Object.fromEntries(varied.map((s) => [s, config[COUNT_FIELD[s]]]))] : countCombos(varied, minCountFor, maxCountFor);
  const keyCounts = manual ? [config[COUNT_FIELD[key]]] : Array.from({ length: maxCountFor(key) - minCountFor(key) + 1 }, (_, i) => minCountFor(key) + i);

  let best = null;
  for (const nKey of keyCounts) {
    const base = { ...config, [COUNT_FIELD[key]]: nKey };
    const going = solveGoing(base, key, targets[key]);
    if (going === null) continue;
    const atGoing = { ...base, treadGoing: going };
    const lines = Object.fromEntries(others.map((s) => [s, sideVsCount(atGoing, s, minCountFor(s))]));

    // Every combination of the other flights' counts is scored from the linear side model and deriveStairData
    // (riser height, 2h+s, turn feasibility — no layout needed).
    let bestHere = null;
    for (const combo of combos) {
      const cand = { ...atGoing };
      for (const s of varied) cand[COUNT_FIELD[s]] = combo[s];
      const derived = deriveStairData(cand);
      if (!derived.turnFeasible && strictTurn) continue;
      const devs = others.map((s) => deviationOf(s, sideAtCount(lines[s], combo[s]), targets[s]));
      if (devs.some((d) => d === null)) continue;
      const score = [derived.turnFeasible ? 0 : 1, ...scoreOf(derived, devs, going)];
      if (!bestHere || lexicographicallyLess(score, bestHere.score)) bestHere = { cand, score };
    }
    if (!bestHere) continue;

    // The winner of this key count, re-solved and measured on a real layout.
    const finalGoing = solveGoing(bestHere.cand, key, targets[key]);
    if (finalGoing === null) continue;
    const cand = { ...bestHere.cand, treadGoing: finalGoing };
    const { derived, sides } = measure(cand);
    if (!derived.turnFeasible && strictTurn) continue;
    const devs = others.map((s) => deviationOf(s, sides[letters.indexOf(s)], targets[s]));
    if (devs.some((d) => d === null)) continue;
    const score = [derived.turnFeasible ? 0 : 1, ...scoreOf(derived, devs, finalGoing)];
    if (!best || lexicographicallyLess(score, best.score)) best = { cand, derived, sides, score };
  }

  if (!best) {
    const message = manual
      ? `Dopasowanie do klatki: przy ręcznie ustawionych liczbach stopni bok ${key} = ${targets[key]} mm wymagałby głębokości stopnia spoza zakresu ${FIT_GOING_RANGE_MM.min}–${FIT_GOING_RANGE_MM.max} mm — zmień liczbę stopni albo wymiar. Parametry schodów zostają bez zmian.`
      : `Dopasowanie do klatki: nie da się zmieścić schodów w boku ${key} = ${targets[key]} mm przy obecnej liczbie stopni zabiegowych ` +
        `i głębokości stopnia ${FIT_GOING_RANGE_MM.min}–${FIT_GOING_RANGE_MM.max} mm. Parametry schodów zostają bez zmian.`;
    return { ...off, enabled: true, status: 'NO_SOLUTION', message, diagnostics: [fitDiag('ERROR', 'stairwellFit', message, { value: targets[key], unit: 'mm' })] };
  }

  const sides = letters.map((s, i) => ({
    side: s,
    target: targets[s],
    achieved: best.sides[i],
    deviation: targets[s] === null ? null : best.sides[i] - targets[s],
    key: s === key,
  }));
  const missed = sides.filter((s) => !s.key && s.deviation !== null && Math.abs(s.deviation) > SIDE_MET_TOLERANCE_MM);
  const values = { treadGoing: best.cand.treadGoing };
  for (const s of letters) values[COUNT_FIELD[s]] = best.cand[COUNT_FIELD[s]];
  if (axisGapFromB !== null) values.uAxisGapMm = axisGapFromB;

  const diagnostics = missed.map((s) =>
    fitDiag(
      'WARNING',
      `stairwellSide${s.side}Mm`,
      `Dopasowanie do klatki: bok ${s.side} wychodzi ${Math.round(s.achieved)} mm zamiast ${s.target} mm (${s.deviation > 0 ? '+' : ''}${Math.round(s.deviation)} mm). ` +
        `Bok kluczowy ${key} jest dokładny; głębokość stopnia musi być jedna na całe schody, więc pozostałe boki mogą się różnić o część głębokości stopnia.`,
      { value: Math.round(s.achieved), expected: s.target, unit: 'mm' },
    ),
  );
  const h = best.derived.riserHeight;
  if (riserOff(best.derived) > 0) {
    diagnostics.push(
      fitDiag(
        'WARNING',
        'stairwellFit',
        `Dopasowanie do klatki: w podanych wymiarach mieści się ${best.derived.numTreads} stopni, co daje wysokość podstopnia ${h.toFixed(1).replace('.', ',')} mm — poza zakresem ${config.minRiser}–${config.maxRiser} mm. Wymiary klatki mają pierwszeństwo; ocenę zgodności podaje walidacja.`,
        { value: Math.round(h * 10) / 10, expected: `${config.minRiser}–${config.maxRiser}`, unit: 'mm' },
      ),
    );
  }
  return {
    enabled: true,
    manualCounts: manual,
    status: missed.length ? 'APPROX' : 'OK',
    values,
    sides,
    blondel: best.derived.blondel,
    riserHeight: best.derived.riserHeight,
    message: missed.length ? (manual ? 'Bok kluczowy dokładny; liczby stopni ustawione ręcznie.' : 'Bok kluczowy dokładny, pozostałe najbliżej jak się da.') : 'Wszystkie podane boki dokładnie.',
    diagnostics,
  };
}

// The axis gap of a U laid out as one 180° winder zone that makes its side B come out at `targetB`
// (B = 2 × stairWidth + axisGap − stringerThickness, planLayout.js buildHalfTurnLocal); null when it does not apply or
// would be negative.
function oneZoneAxisGapFor(config, targetB) {
  const oneZone = !!config.uSingleWinderZone && config.stairType === 'U' && config.turn1Type === 'winder' && config.turn2Type === 'winder';
  if (!oneZone || !(targetB > 0)) return null;
  const gap = targetB - 2 * config.stairWidth + (Number(config.stringerThickness) || 0);
  return gap >= 0 ? Math.round(gap * 1000) / 1000 : null;
}

/**
 * The config fields the fit is currently deriving (AUTO in the UI, not editable while it is on): the going, and the
 * tread count of every flight whose side has a target — only the going with manual counts. [] when the fit is off.
 */
export function stairwellDrivenFields(config) {
  // the stairwell's fixed sides, kept live (solveFixedSides): the going, the counts (unless set by hand) and a one-zone
  // U's axis gap when B is fixed
  const plan = fixedSidesPlan(config);
  if (plan) {
    const gap = isOneZoneU(config) && plan.targets.B !== null ? ['uAxisGapMm'] : [];
    if (config.stairwellManualCounts) return ['treadGoing', ...gap];
    return ['treadGoing', ...wellSideLetters(config.stairType).filter((s) => !(gap.length && s === 'B')).map((s) => COUNT_FIELD[s]), ...gap];
  }
  if (!config.stairwellFitEnabled) return [];
  const gap = oneZoneAxisGapFor(config, stairwellTargets(config).B) !== null ? ['uAxisGapMm'] : [];
  if (config.stairwellManualCounts) return ['treadGoing', ...gap];
  const targets = stairwellTargets(config);
  return ['treadGoing', ...Object.keys(targets).filter((s) => targets[s] !== null && !(gap.length && s === 'B')).map((s) => COUNT_FIELD[s]), ...gap];
}

/** The config the stair is built from: the user's config with the fitted going/counts applied (if any). */
export function applyStairwellFit(config, fit = solveStairwellFit(config)) {
  return fit.values ? { ...config, ...fit.values } : config;
}

// --- The stairwell's FIXED sides kept on every change (geometry/stairwell.js model v3) -------------------------------

const isOneZoneU = (config) => !!config.uSingleWinderZone && config.stairType === 'U' && config.turn1Type === 'winder' && config.turn2Type === 'winder' && !(Number(config.treadsLegB) > 0);

/**
 * The fit the stairwell's fixed sides call for, or null when the stairwell is off / has no fixed side: the key = the
 * exit side when it is fixed (straight A, L B, U C), else the first fixed one; `free` = the sides without a dimension.
 */
export function fixedSidesPlan(config) {
  if (!wellEnabled(config)) return null;
  const targets = wellFixedTargets(config);
  const letters = wellSideLetters(config.stairType);
  const fixed = letters.filter((s) => targets[s] !== null);
  if (fixed.length === 0) return null;
  // (the main side — stairwell.js wellMainSide: the one marked main, else the exit side when rigid, else the first)
  return { targets, key: wellMainSide(config), free: letters.filter((s) => targets[s] === null) };
}

const VARIANT_WIDTH_FLOOR_MM = 500; // no stair below this (designer/stairwellVariants.js VARIANT_ABSOLUTE_MIN_WIDTH_MM)
let fixedSidesCache = { key: null, result: null };

/**
 * Solves the going and the counts (unless `stairwellManualCounts`) so the FIXED sides come out — the key side exact,
 * the other fixed ones as close as the counts allow, the free sides' counts chosen for the riser (`freeSides`). A U's
 * fixed B is met exactly: one 180° zone by its axis gap (the fit derives it; a B under 2 × width − board narrows the
 * stair to (B + board) / 2), two turns by the width (re-solved up to WIDTH_ROUNDS times, never wider than given).
 * The same for the live stair (buildStaircase, every change — the user's winders / turns / width are kept, only the
 * driven fields change) and every variant of the designer. Without a solution the result says so (WARNING — the
 * user's values stay). Memoised on the inputs it reads (an edge drag does not re-solve it).
 * @returns {StairwellFit & {live:true}|null}
 */
export function solveFixedSides(config) {
  const plan = fixedSidesPlan(config);
  if (!plan) return null;
  // (the turns' own splits are this solver's OUTPUT — never read back as an input)
  config = { ...config, turnSplitOffsetsMm: null };
  const { manualEdgeOverrides, manualStringerProfileOverrides, manualPostOverrides, manualTreadOverhangs, railingProfileOverrides, ...inputs } = config;
  const cacheKey = JSON.stringify(inputs);
  if (fixedSidesCache.key === cacheKey) return fixedSidesCache.result;

  const t = Number(config.stringerThickness) || 0;
  const given = Number(config.stairWidth) || 0;
  const zone = isOneZoneU(config);
  const B = plan.targets.B;
  const width = zone && B !== null && 2 * given - t > B ? (B + t) / 2 : given;
  const run = (w) =>
    solveStairwellFit(
      {
        ...config,
        stairWidth: w,
        stairwellFitEnabled: true,
        stairwellSideAMm: plan.targets.A ?? 0,
        stairwellSideBMm: plan.targets.B ?? 0,
        stairwellSideCMm: plan.targets.C ?? 0,
        stairwellKeySide: plan.key,
      },
      { freeSides: plan.free, allowInfeasible: true },
    );
  const fit = run(width);
  let values = fit.values ? { ...fit.values, ...(Math.abs(width - given) > 1e-9 ? { stairWidth: width } : {}) } : null;
  let sides = fit.sides;
  // every rigid side exact (user decision 2026-10-23): the counts and the going above make the main side exact and the
  // others as close as one going allows; the rest is taken up by shifting each turn's winders along the walkline (its
  // own split, `turnSplitOffsetsMm`) and — only when that is not enough — by narrowing the stair (never wider than
  // given). What still misses is the stairwell report's ERROR (stairwell.js STAIRWELL-SIDE-FIXED).
  if (values) {
    let exact = exactRigidSides({ ...config, ...values }, plan, { maxWidth: given });
    // the counts were chosen with the winders where the user had them; when the rigid sides still miss, the counts next
    // to them (±1 on every rigid side's flight) are tried too — the shift / width may meet them there
    if (exact.worst > EXACT_SIDE_TOL_MM && !config.stairwellManualCounts) {
      const flights = wellSideLetters(config.stairType).filter((s) => plan.targets[s] !== null && !(zone && s === 'B'));
      let combos = [{}];
      for (const s of flights) combos = combos.flatMap((c) => [-1, 0, 1].map((d) => ({ ...c, [COUNT_FIELD[s]]: Math.max(s === 'A' && config.stairType === 'straight' ? 1 : 0, values[COUNT_FIELD[s]] + d) })));
      // ranked: the sides met first, then the riser inside its range, then the stair narrowed least (the width only
      // when needed — user decision 2026-10-23), then 2h+s closest to BLONDEL_TARGET_MM
      const rank = (cfg, e) => {
        const d = deriveStairData({ ...cfg, ...e.values });
        const met = e.score <= EXACT_SIDE_TOL_MM * MAIN_SIDE_WEIGHT;
        const narrowed = Math.round(Math.max(0, given - (e.values.stairWidth ?? cfg.stairWidth)));
        return [met ? 0 : 1, met ? 0 : e.score, Math.max(0, config.minRiser - d.riserHeight, d.riserHeight - config.maxRiser), narrowed, Math.abs(d.blondel - BLONDEL_TARGET_MM)];
      };
      let bestRank = rank({ ...config, ...values }, exact);
      for (const counts of combos) {
        if (Object.entries(counts).every(([f, n]) => n === values[f])) continue;
        const cfg = { ...config, ...values, ...counts };
        const trial = exactRigidSides(cfg, plan, { maxWidth: given });
        const r = rank(cfg, trial);
        if (lexicographicallyLess(r, bestRank)) [exact, bestRank] = [{ ...trial, values: { ...counts, ...trial.values } }, r];
      }
    }
    values = { ...values, ...exact.values };
    sides = sides.map((s) => {
      const achieved = exact.sides[s.side] ?? s.achieved;
      return { ...s, achieved, deviation: s.target === null ? null : achieved - s.target };
    });
  }
  // the user's own values stay when there is no solution: a warning, never a blocked takeoff; a rigid side that still
  // misses is reported once — by the stairwell report — not again here
  const diagnostics = fit.diagnostics
    .filter((d) => !(values && /^stairwellSide[ABC]Mm$/.test(d.parameter || '')))
    .map((d) => (d.severity === 'ERROR' ? { ...d, severity: 'WARNING' } : d));
  const missed = sides.filter((s) => s.deviation !== null && Math.abs(s.deviation) > SIDE_MET_TOLERANCE_MM);
  const status = !values ? fit.status : missed.length ? 'APPROX' : 'OK';
  const result = { ...fit, values, sides, status, diagnostics, live: true, key: plan.key };
  fixedSidesCache = { key: cacheKey, result };
  return result;
}

// --- Every rigid side exact: each turn's split, then the width (Gauss–Newton on real layouts) ------------------------

// A rigid side within this of its dimension is met (mm) — below the report's WELL_TOLERANCE_MM.
const EXACT_SIDE_TOL_MM = 0.1;
const EXACT_ITERATIONS = 14;
const DIFF_STEP_MM = 0.5;
// The main side's weight in the least squares: it stays exact while the rigid ones share what is left.
const MAIN_SIDE_WEIGHT = 100;

// The turns whose winders can be shifted along the walkline: winder turns laid out from the walkline whose zone is not
// pinned to the corner (a flight starting / ending with winders) — and not the one 180° zone. [{k, lo, hi}] with the
// split's range at going `g` (winderArc.js: the arc's half length ≤ before ≤ zone − half the arc).
function shiftableTurns(config, g) {
  if (isOneZoneU(config)) return [];
  const numTurns = config.stairType === 'L' ? 1 : config.stairType === 'U' || config.stairType === 'S' ? 2 : 0;
  const out = [];
  for (let k = 0; k < numTurns; k++) {
    if ((k === 0 ? config.turn1Type : config.turn2Type) !== 'winder') continue;
    const pinned = k === 0 ? Number(config.treadsLegA) === 0 || (numTurns === 1 && Number(config.treadsLegB) === 0) : Number(config.treadsLegC) === 0;
    if (pinned) continue;
    const q = (Math.PI * (Number(config.walklineOffset) || 0)) / 4;
    const Lw = (Number(config.windersPerTurn) || 0) * g;
    if (!(Lw - 2 * q > 1)) continue;
    out.push({ k, lo: q + 0.01, hi: Lw - q - 0.01 });
  }
  return out;
}

// Solves the small linear system A x = b (Gaussian elimination with pivoting); null when singular.
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * With the counts fixed, the going, each shiftable turn's split and (second) the width that bring every rigid side to
 * its dimension — least squares on real layouts when they cannot all be met. Returns the fields to apply
 * ({treadGoing, turnSplitOffsetsMm?, stairWidth?}) and the sides achieved ({A: mm, …}).
 */
export function exactRigidSides(config, plan, { maxWidth = Number(config.stairWidth) || 0 } = {}) {
  const letters = wellSideLetters(config.stairType);
  const rigid = letters.filter((s) => plan.targets[s] !== null);
  const baseSplit = Number(config.walklineSplitOffset) || 0;
  const g0 = Number(config.treadGoing) || 0;
  const turns = shiftableTurns(config, g0);
  const w0 = Number(config.stairWidth) || 0;
  // the variables: [going, split of each shiftable turn, (width)]
  const build = (x, withWidth) => {
    const cfg = { ...config, treadGoing: x[0] };
    if (turns.length) {
      const splits = [baseSplit, baseSplit];
      turns.forEach((t, i) => (splits[t.k] = x[1 + i]));
      cfg.turnSplitOffsetsMm = splits;
    }
    if (withWidth) cfg.stairWidth = x[1 + turns.length];
    return cfg;
  };
  const sidesAt = (x, withWidth) => {
    const s = measure(build(x, withWidth)).sides;
    return Object.fromEntries(letters.map((l, i) => [l, s[i]]));
  };
  const residual = (sides) => rigid.map((s) => sides[s] - plan.targets[s]);
  const worst = (r) => Math.max(0, ...r.map(Math.abs));
  const clamp = (x, withWidth) => {
    const out = [...x];
    out[0] = Math.min(FIT_GOING_RANGE_MM.max, Math.max(FIT_GOING_RANGE_MM.min, out[0]));
    // (the split's range follows the going)
    shiftableTurns(config, out[0]).forEach((t, i) => (out[1 + i] = Math.min(t.hi, Math.max(t.lo, out[1 + i]))));
    if (withWidth) out[1 + turns.length] = Math.min(maxWidth, Math.max(VARIANT_WIDTH_FLOOR_MM, out[1 + turns.length]));
    return out;
  };

  const solvePhase = (x, withWidth) => {
    x = clamp(x, withWidth);
    let sides = sidesAt(x, withWidth);
    let r = residual(sides);
    for (let it = 0; it < EXACT_ITERATIONS && worst(r) > EXACT_SIDE_TOL_MM; it++) {
      // the Jacobian by finite differences (one layout per variable)
      const J = rigid.map(() => []);
      x.forEach((_, j) => {
        const xp = [...x];
        xp[j] += DIFF_STEP_MM;
        const rp = residual(sidesAt(xp, withWidth));
        rigid.forEach((_, i) => (J[i][j] = (rp[i] - r[i]) / DIFF_STEP_MM));
      });
      // the least-norm least-squares step (JᵀWJ + λI) δ = −JᵀWr over the variables not held at a bound they are pushed
      // against (active set); the main side weighs most — it stays exact while the others take what is left
      const wt = rigid.map((s) => (s === plan.key ? MAIN_SIDE_WEIGHT : 1));
      const stepOver = (free) => {
        const n = free.length;
        const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => rigid.reduce((sum, _, i) => sum + wt[i] * J[i][free[a]] * J[i][free[b]], 0) + (a === b ? 1e-6 : 0)));
        const Jtr = Array.from({ length: n }, (_, a) => -rigid.reduce((sum, _, i) => sum + wt[i] * J[i][free[a]] * r[i], 0));
        const d = solveLinear(JtJ, Jtr);
        if (!d) return null;
        const full = x.map(() => 0);
        free.forEach((j, a) => (full[j] = d[a]));
        return full;
      };
      let free = x.map((_, j) => j);
      let delta = stepOver(free);
      for (let guard = 0; delta && guard < x.length; guard++) {
        const atBound = clamp(x.map((v, j) => v + delta[j] * 1e-3), withWidth).map((v, j) => Math.abs(v - (x[j] + delta[j] * 1e-3)) > 1e-9);
        const blocked = free.filter((j) => atBound[j]);
        if (!blocked.length) break;
        free = free.filter((j) => !atBound[j]);
        delta = free.length ? stepOver(free) : null;
      }
      if (!delta) break;
      // a damped step that makes the worst side better
      let improved = false;
      for (let f = 1; f > 1 / 32; f /= 2) {
        const xn = clamp(x.map((v, j) => v + f * delta[j]), withWidth);
        const sn = sidesAt(xn, withWidth);
        const rn = residual(sn);
        const cost = (res) => res.reduce((sum, v, i) => sum + wt[i] * v * v, 0);
        if (cost(rn) < cost(r) - 1e-9) {
          [x, sides, r] = [xn, sn, rn];
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
    return { x, sides, r };
  };

  const start = [g0, ...turns.map(() => baseSplit)];
  let best = solvePhase(start, false);
  // the width only when shifting the winders is not enough, and never wider than given
  if (worst(best.r) > EXACT_SIDE_TOL_MM && w0 > VARIANT_WIDTH_FLOOR_MM) {
    const withWidth = solvePhase([...best.x, w0], true);
    if (worst(withWidth.r) < worst(best.r) - EXACT_SIDE_TOL_MM) best = { ...withWidth, withWidth: true };
  }
  const { x } = best;
  const values = { treadGoing: x[0] };
  if (turns.length) {
    const splits = [baseSplit, baseSplit];
    turns.forEach((t, i) => (splits[t.k] = x[1 + i]));
    if (splits.some((v) => Math.abs(v - baseSplit) > 0.01)) values.turnSplitOffsetsMm = splits.map((v) => Math.round(v * 100) / 100);
  }
  if (best.withWidth) values.stairWidth = Math.round(x[1 + turns.length] * 10) / 10;
  // how good it is: the main side first, then the worst rigid one
  const mainOff = Math.abs(best.sides[plan.key] - plan.targets[plan.key]);
  const off = worst(best.r);
  return { values, sides: best.sides, worst: off, score: Math.max(mainOff * MAIN_SIDE_WEIGHT, off) };
}
