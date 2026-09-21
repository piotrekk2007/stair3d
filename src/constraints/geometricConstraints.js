// GEOMETRIC / STRUCTURAL CONSTRAINTS — conditions the geometry SOLVER is already supposed to
// preserve. These operate purely on already-built MODEL data (TreadModel[]/RiserModel[]/
// StringerModel/PlanLayout) — never on a THREE.Mesh, never on config directly, and never with
// renderer-specific conditionals. A violation here means the solver produced geometry that
// breaks a basic invariant of "a staircase" — it is always severity ERROR (see the
// CONSTRAINT vs VALIDATION distinction in docs/architecture/CONSTRAINTS_AND_VALIDATION.md):
// a self-intersecting tread is not "a bit uncomfortable", it is not a staircase.
//
// This file produces Diagnostic[] (src/diagnostics/diagnostic.js) — the same shape the
// technical-rule VALIDATION layer (src/validation/) produces — so callers/tests/UI never need
// to know which of the two layers a given diagnostic came from unless they care about ruleId.

import { pointsEqual, segmentsProperlyIntersect } from '../geometry/pathUtils.js';
import { assertReferenceLineIsStraight, checkParallelAndSpaced } from '../geometry/stringerModel.js';
import { GEOMETRY_EPS } from '../geometry/tolerances.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

function err(ruleId, elementType, elementId, message, extra = {}) {
  return createDiagnostic({ ruleId, severity: 'ERROR', elementType, elementId, message, ...extra });
}

// --- 1. Steps remain ordered ------------------------------------------------------------

export function checkStepOrdering(treadModels) {
  const diags = [];
  for (let i = 0; i < treadModels.length; i++) {
    const t = treadModels[i];
    if (t.index !== i) {
      diags.push(err('CONSTRAINT-STEP-ORDER', 'tread', t.stepId, `Kolejność stopni naruszona: pozycja ${i} zawiera stopień o indeksie ${t.index}.`, { parameter: 'index', value: t.index, expected: i }));
    }
    if (i > 0 && !(t.elevation.top > treadModels[i - 1].elevation.top)) {
      diags.push(
        err('CONSTRAINT-STEP-ORDER', 'tread', t.stepId, `Wysokość stopnia nie rośnie monotonicznie względem poprzedniego stopnia.`, {
          parameter: 'elevation.top',
          value: t.elevation.top,
          expected: `> ${treadModels[i - 1].elevation.top}`,
          unit: 'mm',
        })
      );
    }
  }
  return diags;
}

// --- 2. frontEdge/backEdge semantics + non-degenerate edges -----------------------------

function edgeLength(edge) {
  return Math.hypot(edge[1].x - edge[0].x, edge[1].y - edge[0].y);
}

// frontEdge must lie strictly "before" backEdge along the tread's own walking direction (dot
// product of (backMid - frontMid) with direction must be positive) — this is what
// frontEdge/backEdge naming actually PROMISES (see docs/model/STAIRCASE_DATA_MODEL.md §2.7);
// if this were ever violated, "front"/"back" would be lies rather than geometry.
export function checkEdgeDirectionSemantics(treadModels) {
  const diags = [];
  for (const t of treadModels) {
    const front = t.frontEdge.final;
    const back = t.backEdge.final;
    const frontMid = { x: (front[0].x + front[1].x) / 2, y: (front[0].y + front[1].y) / 2 };
    const backMid = { x: (back[0].x + back[1].x) / 2, y: (back[0].y + back[1].y) / 2 };
    const dot = (backMid.x - frontMid.x) * t.direction.x + (backMid.y - frontMid.y) * t.direction.y;
    if (!(dot > 0)) {
      diags.push(
        err('CONSTRAINT-EDGE-DIRECTION', 'tread', t.stepId, `backEdge nie leży za frontEdge w kierunku wchodzenia — front/back tego stopnia są odwrócone.`, {
          parameter: 'frontEdge/backEdge direction',
          value: dot,
          expected: '> 0',
        })
      );
    }
  }
  return diags;
}

export function checkNoZeroLengthEdges(treadModels) {
  const diags = [];
  for (const t of treadModels) {
    const frontLen = edgeLength(t.frontEdge.final);
    const backLen = edgeLength(t.backEdge.final);
    if (frontLen < GEOMETRY_EPS) {
      diags.push(err('CONSTRAINT-EDGE-NONDEGENERATE', 'tread', t.stepId, `frontEdge ma zerową długość.`, { parameter: 'frontEdge length', value: frontLen, expected: '> 0', unit: 'mm' }));
    }
    if (backLen < GEOMETRY_EPS) {
      diags.push(err('CONSTRAINT-EDGE-NONDEGENERATE', 'tread', t.stepId, `backEdge ma zerową długość.`, { parameter: 'backEdge length', value: backLen, expected: '> 0', unit: 'mm' }));
    }
  }
  return diags;
}

// --- 3. No negative tread width -----------------------------------------------------------

export function checkNoNegativeTreadWidth(treadModels) {
  const diags = [];
  for (const t of treadModels) {
    if (!(t.widths.atFront > 0)) {
      diags.push(err('CONSTRAINT-TREAD-WIDTH-POSITIVE', 'tread', t.stepId, `Szerokość stopnia przy czole nie jest dodatnia.`, { parameter: 'widths.atFront', value: t.widths.atFront, expected: '> 0', unit: 'mm' }));
    }
    if (!(t.widths.atBack > 0)) {
      diags.push(err('CONSTRAINT-TREAD-WIDTH-POSITIVE', 'tread', t.stepId, `Szerokość stopnia przy tyle nie jest dodatnia.`, { parameter: 'widths.atBack', value: t.widths.atBack, expected: '> 0', unit: 'mm' }));
    }
  }
  return diags;
}

// --- 4. No self-intersecting tread outline ------------------------------------------------

// Brute-force O(n^2) proper-intersection test over a tread's own outline edges — outlines here
// are always small polygons (4-6 vertices), so this is cheap and needs no spatial index. Only
// NON-ADJACENT edges are tested (adjacent edges legitimately share an endpoint).
export function checkOutlineNotSelfIntersecting(treadModels) {
  const diags = [];
  for (const t of treadModels) {
    const pts = t.outline;
    const n = pts.length;
    if (n < 4) continue; // a triangle can never self-intersect
    outer: for (let i = 0; i < n; i++) {
      const a1 = pts[i];
      const a2 = pts[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i) continue;
        const adjacent = j === i || (j + 1) % n === i || (i + 1) % n === j;
        if (adjacent) continue;
        const b1 = pts[j];
        const b2 = pts[(j + 1) % n];
        if (segmentsProperlyIntersect(a1, a2, b1, b2)) {
          diags.push(err('CONSTRAINT-TREAD-SIMPLE-POLYGON', 'tread', t.stepId, `Kontur stopnia jest samoprzecinający się (bok ${i} przecina bok ${j}).`, { parameter: 'outline' }));
          break outer;
        }
      }
    }
  }
  return diags;
}

// --- 5. Stringer reference lines remain straight -------------------------------------------

export function checkStringerReferenceLinesStraight(stringerModel, label) {
  const diags = [];
  for (const seg of stringerModel.segments) {
    try {
      assertReferenceLineIsStraight(seg);
    } catch (e) {
      diags.push(err('CONSTRAINT-STRINGER-STRAIGHT', 'stringer', seg.id, `${label}: ${e.message}`, { parameter: 'referenceLine' }));
    }
  }
  return diags;
}

// --- 6/7. Paired stringers remain parallel and correctly spaced ----------------------------

// Only meaningful when both sides have the same number of reference-line runs (1:1 segment
// correspondence) — true for any all-straight flight and the common winder/landing cases this
// project generates. When topology differs (a documented, currently-rare case) this check is
// skipped rather than guessing at a correspondence — see docs/architecture/CONSTRAINTS_AND_VALIDATION.md.
export function checkStringerPairInvariants(outerModel, innerModel, stairWidth) {
  const diags = [];
  if (outerModel.segments.length !== innerModel.segments.length) return diags;
  outerModel.segments.forEach((outerSeg, i) => {
    const innerSeg = innerModel.segments[i];
    const result = checkParallelAndSpaced(outerSeg, innerSeg, stairWidth);
    if (!result.parallel) {
      diags.push(
        err('CONSTRAINT-STRINGER-PAIR-PARALLEL', 'stringer', `${outerSeg.id}/${innerSeg.id}`, `Wangi nie są równoległe (odchylenie ${result.angleDeltaDeg.toFixed(2)}°).`, {
          parameter: 'stringerParallelism',
          value: result.angleDeltaDeg,
          expected: '0',
          unit: 'deg',
        })
      );
    }
    if (!result.spacingOk) {
      diags.push(
        err('CONSTRAINT-STRINGER-PAIR-SPACING', 'stringer', `${outerSeg.id}/${innerSeg.id}`, `Odstęp między wangami nie odpowiada szerokości biegu.`, {
          parameter: 'stringerSpacing',
          value: result.spacing,
          expected: stairWidth,
          unit: 'mm',
        })
      );
    }
  });
  return diags;
}

// --- 8. Dependent support geometry remains attached to the appropriate tread ---------------

export function checkBearingAttachment(stringerModel, numTreads, label) {
  const diags = [];
  for (const seg of stringerModel.segments) {
    for (const bearing of seg.treadBearings) {
      if (!Number.isInteger(bearing.treadIndex) || bearing.treadIndex < 0 || bearing.treadIndex >= numTreads) {
        diags.push(
          err('CONSTRAINT-BEARING-ATTACHMENT', 'stringer', seg.id, `${label}: wspornik odwołuje się do nieistniejącego stopnia (treadIndex=${bearing.treadIndex}).`, {
            parameter: 'treadIndex',
            value: bearing.treadIndex,
            expected: `0..${numTreads - 1}`,
          })
        );
      }
    }
  }
  return diags;
}

// --- 9. Geometry remains continuous through landings and winders ---------------------------

// Consecutive treads must share their boundary point exactly (tread[i].backEdge ===
// tread[i+1].frontEdge, on both inner and outer side) — this is what "continuous" means for a
// chain of quads; a gap or overlap here would mean two adjacent treads don't actually share a
// riser line.
export function checkTopologicalContinuity(treadModels) {
  const diags = [];
  for (let i = 0; i < treadModels.length - 1; i++) {
    const a = treadModels[i];
    const b = treadModels[i + 1];
    // Celowe wysunięcie krawędzi bocznej JEDNEGO stopnia (manualTreadOverhangs) z definicji nie
    // dzieli punktu z sąsiadem po tej stronie — to nie jest przerwa w ciągłości biegu.
    const innerOverhung = a.overhang?.side === 'inner' || b.overhang?.side === 'inner';
    const outerOverhung = a.overhang?.side === 'outer' || b.overhang?.side === 'outer';
    const innerOk = innerOverhung || pointsEqual(a.backEdge.final[0], b.frontEdge.final[0]);
    const outerOk = outerOverhung || pointsEqual(a.backEdge.final[1], b.frontEdge.final[1]);
    if (!innerOk || !outerOk) {
      diags.push(
        err('CONSTRAINT-TOPOLOGY-CONTINUITY', 'tread', b.stepId, `Granica między stopniem ${a.stepId} a ${b.stepId} nie jest ciągła (${!innerOk ? 'strona wewnętrzna' : ''}${!innerOk && !outerOk ? ' i ' : ''}${!outerOk ? 'strona zewnętrzna' : ''}).`, {
          parameter: 'boundary continuity',
        })
      );
    }
  }
  return diags;
}

// --- 10. Riser panel geometry must correspond to the tread's FINAL boundary ----------------

// The exact invariant the manual-edit trace found broken: a riser's visible panel boundary
// must track `TreadModel.frontEdge.final` (i.e. `RiserModel.frontEdge.final`, the same value),
// never silently fall back to nominal/raw geometry — see riserSolver.js's module header for
// the full nominal-vs-final design this checks. For a winder's N-panel fan, only the very
// first panel's `p0` (inner) and the very last panel's `p1` (outer) are checked against the
// tread's final edge — the interior fan points are themselves interpolated, not boundary
// points, so they have no independent "final" value to match.
export function checkRiserFollowsFinalTreadEdge(treadModels, riserModels) {
  const diags = [];
  const treadByStep = new Map(treadModels.map((t) => [t.stepId, t]));
  for (const riser of riserModels) {
    const tread = treadByStep.get(riser.stepId);
    if (!tread || riser.panels.length === 0) continue;
    const [innerFinal, outerFinal] = tread.frontEdge.final;
    const first = riser.panels[0];
    const last = riser.panels[riser.panels.length - 1];
    if (!pointsEqual(first.p0, innerFinal)) {
      diags.push(
        err('CONSTRAINT-RISER-FOLLOWS-FINAL-EDGE', 'riser', riser.riserId, `Podstopień ${riser.riserId} nie zaczyna się w finalnym (wewnętrznym) punkcie krawędzi czołowej stopnia ${riser.stepId}.`, {
          parameter: 'frontEdge.final',
          value: first.p0,
          expected: innerFinal,
        })
      );
    }
    if (!pointsEqual(last.p1, outerFinal)) {
      diags.push(
        err('CONSTRAINT-RISER-FOLLOWS-FINAL-EDGE', 'riser', riser.riserId, `Podstopień ${riser.riserId} nie kończy się w finalnym (zewnętrznym) punkcie krawędzi czołowej stopnia ${riser.stepId}.`, {
          parameter: 'frontEdge.final',
          value: last.p1,
          expected: outerFinal,
        })
      );
    }
  }
  return diags;
}

// --- Aggregator ------------------------------------------------------------------------------

/**
 * @param {Object} input
 * @param {import('../geometry/treadSolver.js').TreadModel[]} input.treadModels
 * @param {import('../geometry/riserSolver.js').RiserModel[]} [input.riserModels]
 * @param {{outer: import('../geometry/stringerModel.js').StringerModel, inner: import('../geometry/stringerModel.js').StringerModel}} input.stringerModels
 * @param {Object} input.config  Full config (post riserHeight merge), needs `stairWidth`
 * @returns {import('../diagnostics/diagnostic.js').Diagnostic[]}
 */
export function evaluateGeometricConstraints({ treadModels, riserModels, stringerModels, config }) {
  const diagnostics = [
    ...checkStepOrdering(treadModels),
    ...checkEdgeDirectionSemantics(treadModels),
    ...checkNoZeroLengthEdges(treadModels),
    ...checkNoNegativeTreadWidth(treadModels),
    ...checkOutlineNotSelfIntersecting(treadModels),
    ...checkTopologicalContinuity(treadModels),
  ];

  if (riserModels) {
    diagnostics.push(...checkRiserFollowsFinalTreadEdge(treadModels, riserModels));
  }

  if (stringerModels) {
    diagnostics.push(...checkStringerReferenceLinesStraight(stringerModels.outer, 'StringerOuter'));
    diagnostics.push(...checkStringerReferenceLinesStraight(stringerModels.inner, 'StringerInner'));
    diagnostics.push(...checkStringerPairInvariants(stringerModels.outer, stringerModels.inner, config.stairWidth));
    diagnostics.push(...checkBearingAttachment(stringerModels.outer, treadModels.length, 'StringerOuter'));
    diagnostics.push(...checkBearingAttachment(stringerModels.inner, treadModels.length, 'StringerInner'));
  }

  return diagnostics;
}
