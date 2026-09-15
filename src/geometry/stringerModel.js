import { projectPointOntoLine } from './pathUtils.js';
import { GEOMETRY_EPS } from './tolerances.js';

// Data shape for a stringer (policzek/wanga) as a STRUCTURAL TIMBER COMPONENT — not a
// decorative 3D extrusion. This module defines the shape and the invariants a StringerModel
// must satisfy; stringerSolver.js builds one from a planLayout, stringerRenderer.js is the
// ONLY Three.js mesh builder that consumes it — see .claude/RULES.md rule 8: there is
// exactly one stringer geometry implementation in this codebase, not two.
//
// THE CENTRAL DISTINCTION THIS FILE EXISTS TO ENFORCE:
//
//   StringerReferenceGeometry  — the physical timber board's own straight line in plan.
//                                 Derived ONLY from the RAW/unedited tread chain
//                                 (tread.outerChain / tread.innerChain — see
//                                 edgeOverrides.js, which deliberately never touches these
//                                 fields). Manual tread edits can NEVER change this.
//
//   StringerTreadBearingGeometry — where, along that fixed board, each tread's housing/
//                                 notch/bearing surface actually sits. Derived from the
//                                 FINAL, possibly manually-edited tread geometry
//                                 (tread.outline / tread.frontEdge / tread.backEdge).
//                                 Manual tread edits change ONLY this.
//
// A manually edited tread therefore changes bearing geometry (position/offset of a notch
// along the board), never the reference line (the board's own straight axis). See
// stringerSolver.js for how this is computed, and geometry/__tests__/stringerModel.test.js
// for the tests proving it.

export const CONSTRUCTION_TYPES = Object.freeze({
  CLOSED: 'closed', // housed string — treads let into stopped/through housings, hidden end grain
  CUT: 'cut', // open/notched string — tread ends sit on top of a notch, visible end grain
});

export const CONNECTION_TYPES = Object.freeze({
  NEWEL_TENON: 'newel-tenon', // string end (top/bottom of flight) tenoned into a newel post mortice
  CORNER_POST: 'corner-post', // intermediate newel at a winder/landing turn
  LAP_JOINT: 'lap-joint', // two string segments overlapping directly at a corner (no post)
  WALL_FIXING: 'wall-fixing',
  FLOOR_FIXING: 'floor-fixing',
});

// --- BWF Timber Stair Design Guide 2013 joinery constants (see docs/rules/TECHNICAL_RULES_CATALOGUE.md,
// rules BWF-GUID-F-01 / BWF-GUID-F-02) — cited here as plain named constants, NOT via a
// runtime import of src/rules/, to keep the geometry solver layer independent of the rules
// knowledge-base layer (per .claude/RULES.md rule 10: model/solver/validation stay separate).
export const MIN_HOUSING_DEPTH_MM = 12; // BWF-GUID-F-01
export const HOUSING_DEPTH_THICKNESS_FRACTION = 0.4; // BWF-GUID-F-01: max(12mm, 0.4 * thickness)
export const MIN_NEWEL_TENON_THICKNESS_MM = 12; // BWF-GUID-F-02
export const MIN_NEWEL_TENON_LENGTH_MM = 45; // BWF-GUID-F-02

export function housingDepthFor(stringerThickness) {
  return Math.max(MIN_HOUSING_DEPTH_MM, HOUSING_DEPTH_THICKNESS_FRACTION * stringerThickness);
}

/**
 * @typedef {Object} StringerReferenceGeometry
 * @property {{x:number,y:number}} start   Plan-space start of the physical board's straight axis
 * @property {{x:number,y:number}} end     Plan-space end
 * @property {{x:number,y:number}} direction  Unit vector, start->end
 * @property {number} length               mm
 */

/**
 * @typedef {Object} StringerTreadBearing
 * @property {number} treadIndex
 * @property {boolean} partial   True if this tread's support is split across more than one
 *                                reference-line run (e.g. a winder tread whose raw chain
 *                                itself crosses a real corner) — see stringerSolver.js.
 * @property {boolean} ownsStart True if THIS bearing (not a sibling half of a `partial`
 *                                bearing) contains the tread's TRUE front boundary — only an
 *                                owning bearing's `finalUStart`/`offsetStart` come from a real
 *                                projection of the edited point; a renderer should only apply
 *                                riser-board recess to an owning-start bearing.
 * @property {boolean} ownsEnd   Same, for the tread's TRUE back boundary.
 * @property {number} uStart     Position along THIS run's reference line (mm from start),
 *                                from the tread's raw (unedited) boundary — the nominal seat.
 * @property {number} uEnd
 * @property {number} finalUStart  Position along the reference line of the tread's FINAL
 *                                  (possibly manually-edited) boundary point — can differ
 *                                  from uStart only because of a manual edit.
 * @property {number} finalUEnd
 * @property {number} offsetStart  Signed perpendicular distance (mm) from the reference line
 *                                  to the tread's FINAL boundary point (0 = unedited / still
 *                                  exactly on the board's axis).
 * @property {number} offsetEnd
 * @property {number} bearingElevation  mm, world Z of the top of this tread's bearing
 *                                       surface — derived from the final riserHeight/
 *                                       treadThickness, never from lateral tread edits.
 * @property {number} riserRecess  mm, how far the bearing is set back from the tread's raw
 *                                  rear edge to make room for a riser board (0 when there are
 *                                  no riser boards) — see riserGeometry.js for the mirrored
 *                                  logic on the riser-board side of this same joint.
 */

/**
 * @typedef {Object} StringerSegment  One physical, structurally straight run of board.
 * @property {string} id
 * @property {StringerReferenceGeometry} referenceLine
 * @property {number} width      mm — board depth (vertical dimension below the step line);
 *                                 config.stringerHeight
 * @property {number} thickness  mm — board thickness (the dimension set edgewise, horizontal
 *                                 in plan); config.stringerThickness
 * @property {keyof CONSTRUCTION_TYPES} constructionType
 * @property {StringerTreadBearing[]} treadBearings
 */

/**
 * @typedef {Object} StringerMaterial
 * @property {string} species        Free text, e.g. 'Świerk/sosna (C24)' — see
 *                                     BWF-GUID-E-02 / EC5-STRUCT-I-02 in the rules catalogue
 * @property {string} strengthClass  e.g. 'C24'
 * @property {string} serviceClass   e.g. 'SC1' (heated interior) — see EC5-STRUCT-I-03
 */

/**
 * @typedef {Object} StringerManufacturing
 * @property {number} housingDepth       mm, only meaningful when constructionType === CLOSED
 * @property {number} tenonThickness     mm
 * @property {number} tenonLength        mm
 */

/**
 * @typedef {Object} StringerConnection
 * @property {keyof CONNECTION_TYPES} type
 * @property {{x:number,y:number}} position
 */

/**
 * @typedef {Object} StringerModel  One full stringer (one side: 'outer' | 'inner').
 * @property {'outer'|'inner'} side
 * @property {StringerSegment[]} segments   In physical order, start of flight to end.
 * @property {StringerConnection} topConnection
 * @property {StringerConnection} bottomConnection
 * @property {StringerConnection[]} intermediateSupports
 * @property {StringerMaterial} material
 * @property {StringerManufacturing} manufacturing
 */

// Throws if `segment.referenceLine` is not, in fact, a straight line consistent with its own
// direction/length fields — a cheap internal-consistency guard, not a full geometry check.
export function assertReferenceLineIsStraight(segment) {
  const { start, end, direction, length } = segment.referenceLine;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const actualLength = Math.hypot(dx, dy);
  // 1e-3 mm here is deliberately its own, LOCAL tolerance, not one of tolerances.js's three —
  // it bounds the mismatch between two INDEPENDENTLY COMPUTED representations of the same
  // length/direction (the stored `length`/`direction` fields vs. recomputing them fresh from
  // `start`/`end`), a different mathematical question from "are two raw points identical"
  // (GEOMETRY_EPS) or "is this a real corner" (COLLINEAR_EPS). See tolerances.js header.
  if (Math.abs(actualLength - length) > 1e-3) {
    throw new Error(`Stringer segment ${segment.id}: referenceLine.length (${length}) does not match start/end distance (${actualLength})`);
  }
  if (actualLength > GEOMETRY_EPS) {
    const ux = dx / actualLength;
    const uy = dy / actualLength;
    if (Math.abs(ux - direction.x) > 1e-3 || Math.abs(uy - direction.y) > 1e-3) {
      throw new Error(`Stringer segment ${segment.id}: referenceLine.direction does not match start->end`);
    }
  }
}

// Checks the two invariants required for a pair of stringers belonging to the SAME straight
// flight run: their reference-line directions are parallel, and their perpendicular spacing
// equals the expected stair width. Returns { parallel, spacingOk, spacing, angleDeltaDeg } —
// it does not throw, so callers (including tests) can assert on the specific field that
// matters to them and get a precise failure message.
export function checkParallelAndSpaced(outerSegment, innerSegment, expectedSpacing, eps = 1) {
  const a = outerSegment.referenceLine.direction;
  const b = innerSegment.referenceLine.direction;
  const cross = a.x * b.y - a.y * b.x;
  const dot = a.x * b.x + a.y * b.y;
  const angleDeltaDeg = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
  // 1e-3 here bounds a cross product of two UNIT vectors (dimensionless, ~sin(angle)) — a
  // different quantity from tolerances.js's COLLINEAR_EPS (cross product of raw-coordinate
  // vectors, mm²-scale). Deliberately looser than INTERSECTION_EPS too: these two directions
  // come from independently-solved outer/inner segments, not the same computation, so more
  // float slack is expected than true degenerate-parallel detection needs.
  const parallel = Math.abs(cross) < 1e-3;

  const s = outerSegment.referenceLine.start;
  const { offset } = projectPointOntoLine(s, innerSegment.referenceLine.start, innerSegment.referenceLine.end);
  const spacing = Math.abs(offset);
  const spacingOk = Math.abs(spacing - expectedSpacing) <= eps;

  return { parallel, spacingOk, spacing, angleDeltaDeg };
}
