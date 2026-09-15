// Additional, previously-uncovered checks feeding the Staircase Validator
// (src/validator/StaircaseValidator.js). Every function here is pure and READ-ONLY: it takes
// already-built model data and returns Diagnostic[] (src/diagnostics/diagnostic.js) — it never
// mutates a model, never touches Three.js, and never calls a solver itself. Checks that
// already exist elsewhere (self-intersection, zero-length tread edges, topological
// continuity, stringer parallelism/spacing, bearing attachment, the riser nominal/final
// invariant) are NOT reimplemented here — see geometricConstraints.js — this file exists
// specifically for the items on the Validator's checklist that had no home yet: walkline
// consistency, collisions, invalid points, reversed normals, and missing surfaces.

import { pointsEqual, signedPolygonArea } from '../geometry/pathUtils.js';
import { outwardNormalFromOutline } from '../geometry/nosingUtils.js';
import { buildWalklineModel } from '../geometry/walklineModel.js';
import { deriveCeilingFit } from '../config/schema.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { GEOMETRY_EPS } from '../geometry/tolerances.js';

function finding(severity, ruleId, elementType, elementId, parameter, message, extra = {}) {
  return createDiagnostic({ ruleId, severity, elementType, elementId, parameter, message, ...extra });
}

// --- Walkline consistency ------------------------------------------------------------------

// The walkline (src/geometry/walklineModel.js) is built independently per tread (each point is
// "offsetMm across THIS tread's own width"). At a shared boundary, two neighbouring treads
// computing the SAME physical edge at the SAME offset must land on the exact same point — if
// they don't, the walkline itself is inconsistent (a real defect, not a rounding artifact),
// which would silently corrupt any rule measured "from the walkline" (e.g. winder width).
export function checkWalklineConsistency(walklineModel, treadModels) {
  const diags = [];
  if (walklineModel.points.length !== treadModels.length) {
    diags.push(
      finding('ERROR', 'VALIDATOR-WALKLINE-COVERAGE', 'stair', null, 'walkline.points.length', 'Linia biegu (walkline) nie ma jednego punktu na każdy stopień.', {
        value: walklineModel.points.length,
        expected: treadModels.length,
      })
    );
    return diags;
  }
  for (let i = 0; i < walklineModel.points.length - 1; i++) {
    const a = walklineModel.points[i];
    const b = walklineModel.points[i + 1];
    if (!pointsEqual(a.back, b.front)) {
      diags.push(
        finding(
          'ERROR',
          'VALIDATOR-WALKLINE-CONTINUITY',
          'stair',
          treadModels[i + 1].stepId,
          'walkline continuity',
          `Linia biegu jest nieciągła między ${treadModels[i].stepId} a ${treadModels[i + 1].stepId}.`,
          { value: b.front, expected: a.back }
        )
      );
    }
  }
  for (const point of walklineModel.points) {
    const dist = Math.hypot(point.back.x - point.front.x, point.back.y - point.front.y);
    if (!(dist > GEOMETRY_EPS)) {
      const stepId = treadModels[walklineModel.points.indexOf(point)]?.stepId ?? null;
      diags.push(
        finding('ERROR', 'VALIDATOR-WALKLINE-DEGENERATE', 'tread', stepId, 'walkline segment length', `Odcinek linii biegu na tym stopniu ma zerową długość.`, {
          value: dist,
          expected: '> 0',
          unit: 'mm',
        })
      );
    }
  }
  return diags;
}

// --- Collisions (headroom / ceiling opening) ------------------------------------------------

// Wraps config/schema.js's existing deriveCeilingFit (already computed for the 3D ceiling
// visualisation) as a Validator-level diagnostic — this was previously only surfaced as a
// boolean `fits`/`violatingTreads` pair consumed ad hoc by the UI banner, never as a structured
// finding alongside everything else.
export function checkCollisions(config, planLayout, riserHeight, treadModels) {
  const ceilingFit = deriveCeilingFit(config, planLayout, riserHeight);
  if (ceilingFit.fits) return [];
  const treadByIndex = new Map(treadModels.map((t) => [t.index, t]));
  return ceilingFit.violatingTreads.map((index) => {
    const stepId = treadByIndex.get(index)?.stepId ?? `step-${index}`;
    return finding('ERROR', 'VALIDATOR-CEILING-COLLISION', 'tread', stepId, 'headroom', `Stopień koliduje ze stropem — nie mieści się w otworze i nie ma wymaganej skrajni (minHeadroom) pod stropem.`, {
      expected: `wewnątrz otworu [${ceilingFit.openMinX.toFixed(0)}..${ceilingFit.openMaxX.toFixed(0)}] x [${ceilingFit.openMinY.toFixed(0)}..${ceilingFit.openMaxY.toFixed(0)}] mm`,
    });
  });
}

// --- Invalid points (NaN / Infinity anywhere in the solved geometry) ------------------------

function isFinitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function checkInvalidPoints(treadModels, riserModels, stringerModels) {
  const diags = [];
  for (const t of treadModels) {
    for (const p of t.outline) {
      if (!isFinitePoint(p)) diags.push(finding('ERROR', 'VALIDATOR-INVALID-POINT', 'tread', t.stepId, 'outline', 'Kontur stopnia zawiera nieprawidłowy punkt (NaN/Infinity).', { value: p }));
    }
    if (!isFinitePoint(t.direction)) diags.push(finding('ERROR', 'VALIDATOR-INVALID-POINT', 'tread', t.stepId, 'direction', 'Kierunek stopnia jest nieprawidłowy (NaN/Infinity).', { value: t.direction }));
  }
  for (const r of riserModels || []) {
    for (const panel of r.panels) {
      if (!isFinitePoint(panel.p0) || !isFinitePoint(panel.p1)) {
        diags.push(finding('ERROR', 'VALIDATOR-INVALID-POINT', 'riser', r.stepId, 'panel endpoints', 'Panel podstopnia zawiera nieprawidłowy punkt (NaN/Infinity).', { value: [panel.p0, panel.p1] }));
      }
    }
  }
  if (stringerModels) {
    for (const [label, model] of [['StringerOuter', stringerModels.outer], ['StringerInner', stringerModels.inner]]) {
      for (const seg of model.segments) {
        if (!isFinitePoint(seg.referenceLine.start) || !isFinitePoint(seg.referenceLine.end)) {
          diags.push(finding('ERROR', 'VALIDATOR-INVALID-POINT', 'stringer', seg.id, 'referenceLine', `${label}: linia odniesienia wangi zawiera nieprawidłowy punkt (NaN/Infinity).`, {}));
        }
      }
    }
  }
  return diags;
}

// --- Zero-length geometry (riser panels / stringer segments) --------------------------------

// geometricConstraints.js's checkNoZeroLengthEdges is deliberately scoped to TREAD edges only
// (frontEdge/backEdge) — see that file. This extends the same "zerowe długości" checklist item
// to the two other element types that could, in principle, produce a degenerate span: a riser
// panel with zero width, or a stringer reference-line segment with zero length (the solver
// itself already guards against the latter at construction time — see stringerSolver.js's
// splitWalkIntoRuns — so this exists as a regression net, not because it is expected to fire).
export function checkZeroLengthGeometry(riserModels, stringerModels) {
  const diags = [];
  for (const r of riserModels || []) {
    for (const panel of r.panels) {
      if (!(panel.width > GEOMETRY_EPS)) {
        diags.push(finding('ERROR', 'VALIDATOR-ZERO-LENGTH', 'riser', r.stepId, 'panel width', 'Panel podstopnia ma zerową szerokość.', { value: panel.width, expected: '> 0', unit: 'mm' }));
      }
    }
  }
  if (stringerModels) {
    for (const [label, model] of [['StringerOuter', stringerModels.outer], ['StringerInner', stringerModels.inner]]) {
      for (const seg of model.segments) {
        if (!(seg.referenceLine.length > GEOMETRY_EPS)) {
          diags.push(finding('ERROR', 'VALIDATOR-ZERO-LENGTH', 'stringer', seg.id, 'referenceLine.length', `${label}: odcinek wangi ma zerową długość.`, { value: seg.referenceLine.length, expected: '> 0', unit: 'mm' }));
        }
      }
    }
  }
  return diags;
}

// --- Reversed normals ------------------------------------------------------------------------

// (a) Outline winding order must be consistent across the whole flight — a flipped winding on
// one tread means that ONE tread's face normal points the opposite way from every other tread
// (visible as an inside-out face in the 3D view / a wrong-side normal in an export).
export function checkOutlineWindingConsistency(treadModels) {
  const diags = [];
  const signs = treadModels.map((t) => Math.sign(signedPolygonArea(t.outline)));
  const positive = signs.filter((s) => s > 0).length;
  const negative = signs.filter((s) => s < 0).length;
  const majoritySign = positive >= negative ? 1 : -1;
  treadModels.forEach((t, i) => {
    if (signs[i] !== 0 && signs[i] !== majoritySign) {
      diags.push(
        finding('ERROR', 'VALIDATOR-REVERSED-NORMAL', 'tread', t.stepId, 'outline winding', 'Kontur stopnia ma odwróconą orientację (kolejność wierzchołków) względem reszty biegu — normalna powierzchni wskazuje w złą stronę.', {
          value: signs[i],
          expected: majoritySign,
        })
      );
    }
  });
  return diags;
}

// (b) A straight/landing riser panel's actual extrusion normal (-panel.direction, per
// riserRenderer.js's own outwardNormalFromForward convention) must point outward, agreeing
// with the tread's own outward direction (outwardNormalFromOutline) — a mismatch means the
// riser board would be extruded INTO the stairs instead of outward. Scoped to straight/landing
// only: a winder's panel direction is a NOMINAL construction reference (see riserSolver.js
// header) computed in a different frame, so comparing it against a FINAL-outline-derived
// normal would produce false positives, not a real defect.
export function checkRiserNormalOrientation(treadModels, riserModels) {
  const diags = [];
  const treadByStep = new Map(treadModels.map((t) => [t.stepId, t]));
  for (const riser of riserModels || []) {
    if (riser.type === 'winder') continue;
    const tread = treadByStep.get(riser.stepId);
    if (!tread || riser.panels.length === 0) continue;
    const { normal: expectedOutward } = outwardNormalFromOutline({ outline: tread.outline, frontEdge: tread.frontEdge.final });
    const panel = riser.panels[0];
    const actualOutward = { x: -panel.direction.x, y: -panel.direction.y };
    const dot = expectedOutward.x * actualOutward.x + expectedOutward.y * actualOutward.y;
    if (dot < 0) {
      diags.push(
        finding('ERROR', 'VALIDATOR-REVERSED-NORMAL', 'riser', riser.riserId, 'panel direction', `Podstopień stopnia ${riser.stepId} ma odwróconą normalną — wytłoczenie wskazuje do wnętrza schodów zamiast na zewnątrz.`, {
          value: dot,
          expected: '> 0',
        })
      );
    }
  }
  return diags;
}

// --- Missing surfaces ------------------------------------------------------------------------

// (a) Every tread that SHOULD have a riser board (hasRiserBoards on, and this tread's computed
// thickness is > 0 — see riserSolver.js's own filter) must actually have one; a tread silently
// dropped between buildRiserModel and buildRiserModels' filter would be a "missing surface".
export function checkMissingRiserSurfaces(treadModels, riserModels, config) {
  if (!config.hasRiserBoards) return [];
  const diags = [];
  const coveredSteps = new Set((riserModels || []).map((r) => r.stepId));
  for (const t of treadModels) {
    const expectedThickness = t.type === 'landing' ? config.riserBoardThickness : config.nosing;
    if (expectedThickness > 0 && !coveredSteps.has(t.stepId)) {
      diags.push(finding('ERROR', 'VALIDATOR-MISSING-SURFACE', 'riser', t.stepId, 'riser coverage', `Brakuje podstopnia dla stopnia ${t.stepId}, mimo że konfiguracja go wymaga.`, { expected: 'RiserModel obecny' }));
    }
  }
  return diags;
}

// (b) Every tread must be structurally supported by at least one bearing on EACH stringer side
// — the reverse direction of checkBearingAttachment (which checks a bearing points at a real
// tread; this checks every real tread has a bearing at all). A tread with no bearing on one
// side would mean that side's stringer has a gap exactly where this tread needs support.
export function checkMissingStringerSupport(treadModels, stringerModels) {
  const diags = [];
  for (const [label, model] of [['StringerOuter', stringerModels.outer], ['StringerInner', stringerModels.inner]]) {
    const covered = new Set();
    for (const seg of model.segments) {
      for (const b of seg.treadBearings) covered.add(b.treadIndex);
    }
    for (const t of treadModels) {
      if (!covered.has(t.index)) {
        diags.push(finding('ERROR', 'VALIDATOR-MISSING-SURFACE', 'stringer', t.stepId, 'bearing coverage', `${label}: brak wspornika (bearing) dla stopnia ${t.stepId} — wanga ma lukę dokładnie w miejscu tego stopnia.`, {}));
      }
    }
  }
  return diags;
}

// --- Informational: manual corrections applied ----------------------------------------------

// Not a defect — an INFO-level record that a tread's geometry actually differs from nominal,
// read directly off TreadModel's own overridden flag (treadSolver.js) rather than merely
// checking whether config.manualEdgeOverrides HAS an entry for a boundary: an edit the
// solver's own admission-time guard rejected (edgeOverrides.js's signedArea check) leaves the
// tread's final geometry identical to nominal, so it correctly produces NO note here — this
// reports what actually took effect, not what was merely requested.
export function checkManualOverridesApplied(treadModels) {
  return treadModels
    .filter((t) => t.frontEdge.overridden || t.backEdge.overridden)
    .map((t) => finding('INFO', 'VALIDATOR-MANUAL-OVERRIDE', 'tread', t.stepId, 'manualEdgeOverrides', `Wprowadzono ręczną korektę geometrii ${t.stepId}.`, {}));
}

// --- Aggregator --------------------------------------------------------------------------------

/**
 * @param {Object} input
 * @param {Object} input.config       Full config, including `riserHeight`
 * @param {Object} input.derived
 * @param {import('../geometry/planLayout.js').PlanLayout} input.planLayout
 * @param {import('../geometry/treadSolver.js').TreadModel[]} input.treadModels
 * @param {import('../geometry/riserSolver.js').RiserModel[]} input.riserModels
 * @param {{outer, inner}} input.stringerModels
 * @returns {import('../diagnostics/diagnostic.js').Diagnostic[]}
 */
export function evaluateAdditionalChecks({ config, derived, planLayout, treadModels, riserModels, stringerModels }) {
  const walklineModel = buildWalklineModel(planLayout, config);
  return [
    ...checkWalklineConsistency(walklineModel, treadModels),
    ...checkCollisions(config, planLayout, derived.riserHeight, treadModels),
    ...checkInvalidPoints(treadModels, riserModels, stringerModels),
    ...checkZeroLengthGeometry(riserModels, stringerModels),
    ...checkOutlineWindingConsistency(treadModels),
    ...checkRiserNormalOrientation(treadModels, riserModels),
    ...checkMissingRiserSurfaces(treadModels, riserModels, config),
    ...checkMissingStringerSupport(treadModels, stringerModels),
    ...checkManualOverridesApplied(treadModels),
  ];
}
