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

function sideLetters(stairType) {
  return stairType === 'U' ? ['A', 'B', 'C'] : stairType === 'L' ? ['A', 'B'] : ['A'];
}

/**
 * Lengths of the straight sides of the stair's outer line (collinear points merged), in walking order.
 * @param {{outerFullPath:{x:number,y:number}[]}} planLayout
 * @returns {number[]}
 */
export function outerSideLengths(planLayout) {
  const path = planLayout.outerFullPath || [];
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
  return { derived, sides: outerSideLengths(planLayout) };
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
 * @param {{limits?: Object<string, {min?:number, max?:number}>}} [opts]  `limits`: a range a non-key side must stay in
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
  // manual counts: every flight keeps the user's count — one candidate, only the going is solved
  const combos = manual ? [Object.fromEntries(others.map((s) => [s, config[COUNT_FIELD[s]]]))] : countCombos(others, minCountFor, maxCountFor);
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
      for (const s of others) cand[COUNT_FIELD[s]] = combo[s];
      const derived = deriveStairData(cand);
      if (!derived.turnFeasible && !manual) continue;
      const devs = others.map((s) => deviationOf(s, sideAtCount(lines[s], combo[s]), targets[s]));
      if (devs.some((d) => d === null)) continue;
      const score = scoreOf(derived, devs, going);
      if (!bestHere || lexicographicallyLess(score, bestHere.score)) bestHere = { cand, score };
    }
    if (!bestHere) continue;

    // The winner of this key count, re-solved and measured on a real layout.
    const finalGoing = solveGoing(bestHere.cand, key, targets[key]);
    if (finalGoing === null) continue;
    const cand = { ...bestHere.cand, treadGoing: finalGoing };
    const { derived, sides } = measure(cand);
    if (!derived.turnFeasible && !manual) continue;
    const devs = others.map((s) => deviationOf(s, sides[letters.indexOf(s)], targets[s]));
    if (devs.some((d) => d === null)) continue;
    const score = scoreOf(derived, devs, finalGoing);
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
