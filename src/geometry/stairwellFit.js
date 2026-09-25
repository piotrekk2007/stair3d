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
// going must stay constant, so a non-key side generally cannot be exact). Candidates whose riser height is out
// of [minRiser, maxRiser], whose going is outside FIT_GOING_RANGE_MM or whose turn is infeasible are dropped.
// Among the rest the best is the one with the smallest total deviation of the non-key sides. The 2h+s rule
// (PL-LEGAL-A-01) is INFORMATIONAL only (user decision): it never overrides a dimension — it is used solely to
// break a tie between variants that meet the given sides equally well (e.g. only the key side is given, so every
// key-flight count meets it exactly), where the one with 2h+s closest to BLONDEL_TARGET_MM is taken. Whether the
// result complies is reported by the validator, not decided here.
//
// Nothing here is a new geometric rule: every side length is MEASURED on a real buildPlanLayout() result
// (RULES.md #8) — this file only searches over parameters. It is pure (no Three.js, no config mutation). The
// winder count, stair width and everything else stay the user's; only treadGoing and treadsLegA/B/C change.

import { buildPlanLayout } from './planLayout.js';
import { deriveStairData, BLONDEL_RANGE_MM } from '../config/schema.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

export const STAIRWELL_SIDES = ['A', 'B', 'C'];
const COUNT_FIELD = { A: 'treadsLegA', B: 'treadsLegB', C: 'treadsLegC' };

// The going the fit may choose: the same range the "Głębokość stopnia" slider offers (a fitted value outside it
// could not be shown or edited there). Not a legal limit — PL-LEGAL-A-01 (2h+s) is what bounds it in practice.
export const FIT_GOING_RANGE_MM = { min: 180, max: 320 };
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

function measure(config) {
  const derived = deriveStairData(config);
  const planLayout = buildPlanLayout({ ...config, riserHeight: derived.riserHeight });
  return { derived, sides: outerSideLengths(planLayout) };
}

function sideOf(config, letter) {
  return measure(config).sides[sideLetters(config.stairType).indexOf(letter)];
}

// Going that makes `letter` come out at `target`, all counts fixed. A side is affine in the going (every tread
// and winder scales with it), so two measurements give it; a third checks that assumption.
function solveGoing(config, letter, target) {
  const g1 = FIT_GOING_RANGE_MM.min;
  const g2 = FIT_GOING_RANGE_MM.max;
  const s1 = sideOf({ ...config, treadGoing: g1 }, letter);
  const s2 = sideOf({ ...config, treadGoing: g2 }, letter);
  if (!Number.isFinite(s1) || !Number.isFinite(s2) || s2 - s1 < 1e-6) return null; // this side does not grow with the going
  const g = g1 + ((target - s1) * (g2 - g1)) / (s2 - s1);
  if (!(g >= g1 && g <= g2)) return null;
  const check = sideOf({ ...config, treadGoing: g }, letter);
  return Math.abs(check - target) <= SIDE_MET_TOLERANCE_MM ? g : null;
}

// How `letter`'s side grows with its own flight's tread count at the current going: { s0, step } such that
// side(n) = s0 + (n - minCount) * step. One more straight tread adds one going to its own side and nothing else,
// so two measurements give it; the chosen variant is always measured on a real layout afterwards.
function sideVsCount(config, letter, minCount) {
  const field = COUNT_FIELD[letter];
  const s0 = sideOf({ ...config, [field]: minCount }, letter);
  return { s0, step: sideOf({ ...config, [field]: minCount + 1 }, letter) - s0 };
}

// Every combination of tread counts for the given flights (each minCount..FIT_MAX_TREADS_PER_LEG).
function countCombos(letters, minCountFor) {
  let combos = [{}];
  for (const s of letters) {
    const next = [];
    for (const c of combos) for (let n = minCountFor(s); n <= FIT_MAX_TREADS_PER_LEG; n++) next.push({ ...c, [s]: n });
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
 * @returns {StairwellFit}
 */
export function solveStairwellFit(config) {
  const off = { enabled: false, status: 'OFF', values: null, sides: [], blondel: null, riserHeight: null, message: '', diagnostics: [] };
  if (!config.stairwellFitEnabled) return off;
  const letters = sideLetters(config.stairType);
  const targets = stairwellTargets(config);
  const key = letters.includes(config.stairwellKeySide) ? config.stairwellKeySide : letters[0];
  if (targets[key] === null) {
    const message = `Dopasowanie do klatki: bok kluczowy ${key} nie ma podanego wymiaru — podaj go albo wybierz inny bok kluczowy. Parametry schodów zostają bez zmian.`;
    return { ...off, enabled: true, status: 'NO_KEY', message, diagnostics: [fitDiag('ERROR', 'stairwellKeySide', message)] };
  }
  const others = letters.filter((s) => s !== key && targets[s] !== null);
  const minCountFor = (s) => (s === 'A' && config.stairType === 'straight' ? 1 : 0);

  // Dimensions first; 2h+s only breaks a tie (it is informational, never a reason to miss a given side).
  const scoreOf = (derived, deviation) => [Math.round(deviation), Math.abs(derived.blondel - BLONDEL_TARGET_MM)];
  const combos = countCombos(others, minCountFor);

  let best = null;
  for (let nKey = minCountFor(key); nKey <= FIT_MAX_TREADS_PER_LEG; nKey++) {
    const base = { ...config, [COUNT_FIELD[key]]: nKey };
    const going = solveGoing(base, key, targets[key]);
    if (going === null) continue;
    const atGoing = { ...base, treadGoing: going };
    const lines = Object.fromEntries(others.map((s) => [s, sideVsCount(atGoing, s, minCountFor(s))]));

    // Every combination of the other flights' counts is scored from the linear side model and deriveStairData
    // (riser height, 2h+s, turn feasibility — no layout needed), so a count that is not the nearest one for its own
    // side can still win when the nearest one would make too many treads (riser height below minRiser).
    let bestHere = null;
    for (const combo of combos) {
      const cand = { ...atGoing };
      for (const s of others) cand[COUNT_FIELD[s]] = combo[s];
      const derived = deriveStairData(cand);
      if (!derived.riserRangeOk || !derived.turnFeasible) continue;
      const deviation = others.reduce((sum, s) => sum + Math.abs(lines[s].s0 + (combo[s] - minCountFor(s)) * lines[s].step - targets[s]), 0);
      const score = scoreOf(derived, deviation);
      if (!bestHere || lexicographicallyLess(score, bestHere.score)) bestHere = { cand, score };
    }
    if (!bestHere) continue;

    // The winner of this key count, re-solved and measured on a real layout.
    const finalGoing = solveGoing(bestHere.cand, key, targets[key]);
    if (finalGoing === null) continue;
    const cand = { ...bestHere.cand, treadGoing: finalGoing };
    const { derived, sides } = measure(cand);
    if (!derived.riserRangeOk || !derived.turnFeasible) continue;
    const deviation = others.reduce((sum, s) => sum + Math.abs(sides[letters.indexOf(s)] - targets[s]), 0);
    const score = scoreOf(derived, deviation);
    if (!best || lexicographicallyLess(score, best.score)) best = { cand, derived, sides, score };
  }

  if (!best) {
    const message =
      `Dopasowanie do klatki: nie da się zmieścić schodów w boku ${key} = ${targets[key]} mm przy obecnej wysokości kondygnacji, ` +
      `liczbie stopni zabiegowych i zakresie wysokości podstopnia (${config.minRiser}–${config.maxRiser} mm, głębokość ${FIT_GOING_RANGE_MM.min}–${FIT_GOING_RANGE_MM.max} mm). Parametry schodów zostają bez zmian.`;
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

  const diagnostics = missed.map((s) =>
    fitDiag(
      'WARNING',
      `stairwellSide${s.side}Mm`,
      `Dopasowanie do klatki: bok ${s.side} wychodzi ${Math.round(s.achieved)} mm zamiast ${s.target} mm (${s.deviation > 0 ? '+' : ''}${Math.round(s.deviation)} mm). ` +
        `Bok kluczowy ${key} jest dokładny; głębokość stopnia musi być jedna na całe schody, więc pozostałe boki mogą się różnić o część głębokości stopnia.`,
      { value: Math.round(s.achieved), expected: s.target, unit: 'mm' },
    ),
  );
  return {
    enabled: true,
    status: missed.length ? 'APPROX' : 'OK',
    values,
    sides,
    blondel: best.derived.blondel,
    riserHeight: best.derived.riserHeight,
    message: missed.length ? 'Bok kluczowy dokładny, pozostałe najbliżej jak się da.' : 'Wszystkie podane boki dokładnie.',
    diagnostics,
  };
}

/**
 * The config fields the fit is currently deriving (AUTO in the UI, not editable while it is on): the going, and the
 * tread count of every flight whose side has a target. [] when the fit is off.
 */
export function stairwellDrivenFields(config) {
  if (!config.stairwellFitEnabled) return [];
  const targets = stairwellTargets(config);
  return ['treadGoing', ...Object.keys(targets).filter((s) => targets[s] !== null).map((s) => COUNT_FIELD[s])];
}

/** The config the stair is built from: the user's config with the fitted going/counts applied (if any). */
export function applyStairwellFit(config, fit = solveStairwellFit(config)) {
  return fit.values ? { ...config, ...fit.values } : config;
}
