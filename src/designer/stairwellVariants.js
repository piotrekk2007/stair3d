// Stairwell variants — the room-first designer (model v3, user decisions 2026-10-16): a SHORT list of stairs whose
// FIXED sides (stairwell.js) come out exactly; the FREE sides follow from the tread counts chosen for the riser.
//
// Few variants, decided by rules first (no sweeps of dozens of combinations):
//   - the stair TYPE and turn are the project's;
//   - the WIDTH is the user's (`stairWidth`), reduced only where a fixed side needs it (a U's wall-to-wall side B:
//     one 180° zone needs 2 × width − board ≤ B, two turns 2 × width + middle flight = B) — below
//     VARIANT_MIN_WIDTH_MM only a WARNING, below VARIANT_ABSOLUTE_MIN_WIDTH_MM no stair;
//   - WINDERS: three counts round n = round(walkline arc / going) + 1 (a quarter arc of `walklineOffset` per 90° turn,
//     a half circle for one 180° zone), at least 3 per 90° turn — plus ONE landing variant for comparison;
//   - a U is one 180° winder zone when its axis gap would be 0..U_ZONE_MAX_AXIS_GAP_MM, else two 90° turns with a
//     middle flight plus one zone variant (a wider dusza).
// Each variant is ONE stairwell fit (geometry/stairwellFit.js): the KEY side exact — the exit side when it is fixed
// (straight A, L B, U C), else the first fixed one —, the other fixed sides as close as the counts allow (a U's B
// exact by the axis gap / the width), the free sides' counts chosen for the riser / 2h+s (`freeSides`). A fixed side
// still off after that is a problem of the variant (listed, reported). Measured on a real layout (stairwell report,
// ceiling fit with the opening given from the walls, the validator) and sorted: fixed sides met, riser in range,
// width not below the minimum, distinct rules in error, ceiling collisions, 2h+s nearest the middle of its band.
//
// Pure: no Three.js, no config mutation. `patch` = the config fields applying a variant writes. It lives outside
// src/geometry because it reads the validator (geometry never imports validation — RULES.md).

import { deriveStairData, deriveCeilingFit } from '../config/schema.js';
import { buildPlanLayout } from '../geometry/planLayout.js';
import { solveFixedSides, BLONDEL_TARGET_MM } from '../geometry/stairwellFit.js';
import { stairwellReport, wellFixedTargets, wellSideLetters, exitSideLetter, WELL_TOLERANCE_MM } from '../geometry/stairwell.js';
import { treadGoingAtOffsetFromInner, WINDER_WIDTH_MEASURE_OFFSET_MM } from '../geometry/walklineModel.js';
import { validateStaircase } from '../validator/StaircaseValidator.js';

// PL-LEGAL-A-05* (stairWidth >= 0.8 m for the stair kinds the workshop builds) — below it a variant carries a
// WARNING; below VARIANT_ABSOLUTE_MIN_WIDTH_MM there is no usable stair and the variant is dropped
// (SOFTWARE_DESIGN_CHOICE, STAIR3D-WELL-01).
export const VARIANT_MIN_WIDTH_MM = 800;
export const VARIANT_ABSOLUTE_MIN_WIDTH_MM = 500;
// The widest axis gap a U still gets as ONE 180° zone first (wider: two turns + one zone variant). SOFTWARE_DESIGN_CHOICE
// (STAIR3D-WELL-01), not a published figure.
export const U_ZONE_MAX_AXIS_GAP_MM = 300;
// winders per 90° turn the designer proposes (the slider allows 2 — not a stair the workshop offers)
const WINDERS_PER_TURN_RANGE = { min: 3, max: 6 };
const ZONE_WINDERS_RANGE = { min: 3, max: 14 }; // the "Zabiegowe łącznie (klatka 180°)" slider

function stairLabel(type, turn) {
  if (type === 'straight') return 'schody proste';
  return `schody ${type}, skręt w ${turn === 'left' ? 'lewo' : 'prawo'}`;
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
 * The candidate variants (not solved yet) for the fixed / free sides in `config`.
 * @returns {{ok:boolean, message:string, required:Object, key:string|null, targets:Object, free:string[], rejected:string[], candidates:Object[]}}
 */
export function planStairwellVariants(config) {
  const required = { stairType: config.stairType, turnDirection: config.turnDirection, label: stairLabel(config.stairType, config.turnDirection) };
  const targets = wellFixedTargets(config);
  const letters = wellSideLetters(config.stairType);
  const fixed = letters.filter((s) => targets[s] !== null);
  const empty = { required, key: null, targets, free: [], rejected: [], candidates: [] };
  if (!config.stairwellRoomEnabled) return { ...empty, ok: false, message: 'Włącz wymiary klatki („3. Klatka schodowa”).' };
  if (fixed.length === 0) return { ...empty, ok: false, message: 'Zaznacz co najmniej jeden wymiar klatki jako sztywny.' };
  const exit = exitSideLetter(config.stairType);
  const key = fixed.includes(exit) ? exit : fixed[0];
  const free = letters.filter((s) => targets[s] === null);

  const userWidth = Number(config.stairWidth) || 900;
  const t = Number(config.stringerThickness) || 0;
  const base = { stairType: required.stairType, ...(required.stairType !== 'straight' ? { turnDirection: required.turnDirection } : {}) };
  const candidates = [];
  const rejected = [];
  const push = (id, label, patch, width) => {
    if (!(width >= VARIANT_ABSOLUTE_MIN_WIDTH_MM)) {
      rejected.push(`${label}: szerokość biegu musiałaby być ${Math.round(width)} mm — klatka jest za wąska na takie schody.`);
      return;
    }
    candidates.push({ id, label, patch: { ...base, ...patch, stairWidth: width }, width });
  };

  if (required.stairType === 'straight') {
    push('straight', 'Proste', {}, userWidth);
  } else if (required.stairType === 'L') {
    for (const n of around(naturalWinders(config, false), WINDERS_PER_TURN_RANGE)) push(`L-w${n}`, `L, ${n} zabiegowe`, { turn1Type: 'winder', windersPerTurn: n }, userWidth);
    push('L-landing', 'L, podest', { turn1Type: 'landing' }, userWidth);
  } else if (required.stairType === 'S') {
    // S (the second turn the other way): two 90° winder turns n − 1..n + 1, or two landings — its side B follows
    // flight B's count (no wall-to-wall width, no 180° zone)
    for (const n of around(naturalWinders(config, false), WINDERS_PER_TURN_RANGE)) push(`S-w${n}`, `S, 2 × ${n} zabiegowe`, { turn1Type: 'winder', turn2Type: 'winder', uSingleWinderZone: false, windersPerTurn: n }, userWidth);
    push('S-landing', 'S, podesty', { turn1Type: 'landing', turn2Type: 'landing', uSingleWinderZone: false, mergeLandings: false }, userWidth);
  } else {
    // one 180° zone needs B ≥ 2 × width − board (axis gap ≥ 0): the width narrows to that when B is fixed
    const B = targets.B;
    const zoneWidth = B !== null ? Math.min(userWidth, (B + t) / 2) : userWidth;
    const axisGap = B !== null ? B - 2 * zoneWidth + t : Number(config.uAxisGapMm) || 0;
    const zone = (n) => push(`U-zone${n}`, `U, strefa 180°, ${n} zabiegowych`, { turn1Type: 'winder', turn2Type: 'winder', uSingleWinderZone: true, uWindersTotal: n, treadsLegB: 0 }, zoneWidth);
    if (axisGap <= U_ZONE_MAX_AXIS_GAP_MM) {
      for (const n of around(naturalWinders(config, true), ZONE_WINDERS_RANGE)) zone(n);
    } else {
      for (const n of around(naturalWinders(config, false), WINDERS_PER_TURN_RANGE)) push(`U-w${n}`, `U, 2 × ${n} zabiegowe`, { turn1Type: 'winder', turn2Type: 'winder', uSingleWinderZone: false, windersPerTurn: n }, userWidth);
      zone(Math.min(ZONE_WINDERS_RANGE.max, Math.max(ZONE_WINDERS_RANGE.min, naturalWinders(config, true))));
    }
    push('U-landing', 'U, podesty', { turn1Type: 'landing', turn2Type: 'landing', uSingleWinderZone: false, mergeLandings: false }, userWidth);
  }
  const message = candidates.length ? '' : rejected.join(' ') || 'Brak wariantów.';
  return { ok: candidates.length > 0, message, required, key, targets, free, rejected, candidates };
}

// One candidate solved like the live stair (stairwellFit.js solveFixedSides — the same fixed-side rules), its counts
// always chosen (a variant is a proposal).
function fitCandidate(config, plan, cand) {
  const fit = solveFixedSides({ ...config, ...cand.patch, stairWidth: cand.width, stairwellManualCounts: false });
  return { fit, width: fit?.values?.stairWidth ?? cand.width };
}

/**
 * Solves and measures one candidate.
 * @returns {{id, label, ok:boolean, patch:Object|null, problems:string[], warnings:string[], sides:Object[], metrics:Object|null}}
 */
export function evaluateStairwellVariant(config, plan, cand) {
  const { fit, width } = fitCandidate(config, plan, cand);
  const out = { id: cand.id, label: cand.label, ok: false, patch: null, problems: [], warnings: [], sides: [], metrics: null };
  if (!fit?.values) {
    out.problems.push(fit?.message || 'Nie da się dobrać głębokości stopnia.');
    return out;
  }
  const patch = { ...cand.patch, stairWidth: width, ...fit.values, stairwellFitEnabled: false };
  const cfg = { ...config, ...patch, manualEdgeOverrides: {}, manualTreadOverhangs: {} };
  const derived = deriveStairData(cfg);
  const full = { ...cfg, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(full);
  const report = stairwellReport(full, planLayout);
  const ceiling = deriveCeilingFit(full, planLayout, derived.riserHeight);
  const validation = validateStaircase(full);
  const winders = planLayout.treads.filter((t) => t.type === 'winder');
  const winderGoingAt400 = winders.length ? Math.min(...winders.map((t) => treadGoingAtOffsetFromInner(t, WINDER_WIDTH_MEASURE_OFFSET_MM, planLayout))) : null;
  out.patch = patch;
  out.sides = report.sides;
  out.problems = report.diagnostics.map((d) => d.message);
  out.ok = report.sides.every((s) => !s.fixed || Math.abs(s.deviation) <= WELL_TOLERANCE_MM);
  if (patch.stairWidth < VARIANT_MIN_WIDTH_MM) out.warnings.push(`Szerokość biegu ${Math.round(patch.stairWidth)} mm — mniej niż ${VARIANT_MIN_WIDTH_MM} mm (PL-LEGAL-A-05).`);
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
    treadsLegB: config.stairType === 'straight' ? null : patch.treadsLegB ?? null,
    treadsLegC: config.stairType === 'U' || config.stairType === 'S' ? patch.treadsLegC ?? null : null,
    uAxisGapMm: patch.uSingleWinderZone ? patch.uAxisGapMm ?? null : null,
    ceilingCollisions: ceiling.violatingTreads.length,
    // the opening the variant needs (DERIVED mode): its size along the frame's axes
    openingSize: ceiling.openingMode === 'derived' ? openingSize(ceiling.openingRelativeOutline) : null,
    errors: validation.errors.length,
    // distinct rules broken (one rule failing on every winder is one problem, not five)
    errorRules: new Set(validation.errors.map((d) => d.ruleId)).size,
    warnings: validation.warnings.length,
  };
  return out;
}

function openingSize(outline) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys), corners: outline.length };
}

const sortKey = (v) =>
  v.metrics
    ? [v.ok ? 0 : 1, v.metrics.riserOk ? 0 : 1, v.patch.stairWidth < VARIANT_MIN_WIDTH_MM ? 1 : 0, v.metrics.errorRules, v.metrics.ceilingCollisions, Math.abs(v.metrics.blondel - BLONDEL_TARGET_MM)]
    : [2, 0, 0, 0, 0, 0];

/**
 * The variant list for the stairwell in `config`, best first.
 * @returns {{ok:boolean, message:string, required:Object, key:string|null, rejected:string[], variants:Object[]}}
 */
export function generateStairwellVariants(config) {
  const plan = planStairwellVariants(config);
  const variants = plan.candidates.map((c) => evaluateStairwellVariant(config, plan, c));
  variants.sort((x, y) => {
    const a = sortKey(x);
    const b = sortKey(y);
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] - b[i];
    return 0;
  });
  return { ok: plan.ok, message: plan.message, required: plan.required, key: plan.key, rejected: plan.rejected, variants };
}
