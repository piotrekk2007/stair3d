// THE ONLY Three.js mesh builder for stringers (wangi). Consumes an ALREADY-BUILT
// StringerModel (stringerSolver.js) AND its StringerSegmentConstructionGeometry[]
// (stringerConstructionGeometry.js) — it never recomputes geometry, never decides the board's
// contour, never guesses a normal. Every geometric decision already happened in those two
// solver files; this file only turns their decisions into triangles. See
// stringerConstructionGeometry.js's header for why a continuous board contour replaced the
// old per-bearing-rectangle approach, and docs/architecture/STRINGER_CONSTRUCTION_MODEL.md for
// the full technical comparison.
//
// buildStaircase.js builds BOTH the StringerModel and the construction geometry, then calls
// renderStringers() with both — this module never calls either solver itself.

import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { rotate90CW } from './planLayout.js';
import { traceability } from '../scene/traceability.js';

// A board's thickness must extrude TOWARD the stair's interior (rule 5/RULES.md: the visible,
// outward face sits flush with the tread edge) — never away from it. "Interior" from the
// OUTER board's own straight-ahead direction is rotate90CW(direction) (the SAME canonical
// "kierunek poprzeczny" convention as planLayout.js's frame chaining: right = rotate90CW(fwd)
// always points from outer toward inner/dusza). From the INNER board it is the opposite
// rotation. One shared definition, reused here instead of re-derived.
function inwardDirection(direction, side) {
  const cw = rotate90CW(direction);
  return side === 'outer' ? cw : { x: -cw.x, y: -cw.y };
}

// Builds a world-space toWorld(u,v)->Vector3 function for one segment's own straight
// referenceLine — u = distance along it from its start, v = world elevation. Every mesh for
// this segment (the board itself, its housing indicators) is built through this
// SAME function, so they can never drift apart or rotate independently of one another.
function localFrameFor(segment) {
  const ref = segment.referenceLine;
  return (u, v) => planToWorld(ref.start.x + ref.direction.x * u, ref.start.y + ref.direction.y * u, v);
}

function extrude(pts2D, toWorld, direction, depth) {
  const extrudeDir = new THREE.Vector3(direction.x, 0, -direction.y);
  return buildPrism(pts2D, toWorld, extrudeDir, depth);
}

function rect(uStart, uEnd, vBottom, vTop) {
  return [
    { u: uStart, v: vBottom },
    { u: uEnd, v: vBottom },
    { u: uEnd, v: vTop },
    { u: uStart, v: vTop },
  ];
}

// Darkens a material's color for the housing-recess visual indicator — NOT a true boolean
// subtraction (Three.js has no built-in CSG and this project adds no new dependency without a
// concrete need — see .claude/RULES.md rule 11): the housing's real position/size/depth all
// come straight from StringerConstructionGeometry.housings, only its RENDERING as "a slightly
// recessed, slightly darker box" instead of an actually-subtracted volume is a simplification,
// documented here rather than left silent.
function housingIndicatorMaterial(material) {
  if (!material?.color?.clone) return material;
  const clone = material.clone();
  clone.color = material.color.clone().multiplyScalar(0.7);
  return clone;
}

function buildBoardMesh(segment, geo, side, material) {
  if (geo.outerContour.length === 0) return null;
  const toWorld = localFrameFor(segment);
  const direction = inwardDirection(segment.referenceLine.direction, side);
  const geometry = extrude(geo.outerContour, toWorld, direction, geo.thicknessMm);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = traceability({ elementType: 'stringer', stringerId: side, geometrySourceId: `stringer:${side}:${geo.segmentId}` });
  return mesh;
}

function buildHousingIndicatorMeshes(segment, geo, side, material) {
  if (!geo.housings) return [];
  const toWorld = localFrameFor(segment);
  const direction = inwardDirection(segment.referenceLine.direction, side);
  const indicatorMaterial = housingIndicatorMaterial(material);
  // Recessed by half the housing depth from the inner face — a visual cue only (see
  // housingIndicatorMaterial's comment); the ANALYTICAL depth (geo.housings[].depth) is what a
  // future manufacturing/CNC layer would actually read, not this rendered offset.
  return geo.housings.map((housing) => {
    const pts2D = rect(housing.uStart, housing.uEnd, housing.bottomV, housing.topV);
    const geometry = extrude(pts2D, toWorld, direction, housing.depth * 0.5);
    const mesh = new THREE.Mesh(geometry, indicatorMaterial);
    mesh.position.addScaledVector(new THREE.Vector3(direction.x, 0, -direction.y), segment.thickness);
    mesh.userData = traceability({
      elementType: 'stringer',
      stepId: `step-${housing.treadIndex}`,
      stringerId: side,
      geometrySourceId: `stringer:${side}:${geo.segmentId}:housing-${housing.kind === 'riser' ? 'riser-' : ''}${housing.treadIndex}`,
    });
    return mesh;
  });
}

/**
 * @param {import('./stringerModel.js').StringerModel} model
 * @param {import('./stringerModel.js').StringerSegmentConstructionGeometry[]} constructionGeometries
 *   Same length/order as model.segments — see stringerConstructionGeometry.js's
 *   buildStringerConstructionGeometry(), which builds exactly one entry per segment.
 * @param {THREE.Material} material
 * @param {string} groupName
 */
export function renderStringers(model, constructionGeometries, material, groupName) {
  const group = new THREE.Group();
  group.name = groupName;
  const side = model.side;

  model.segments.forEach((segment, i) => {
    const geo = constructionGeometries[i];
    const board = buildBoardMesh(segment, geo, side, material);
    if (board) {
      board.name = `${groupName}_${i}_board`;
      group.add(board);
    }
    buildHousingIndicatorMeshes(segment, geo, side, material).forEach((mesh, j) => {
      mesh.name = `${groupName}_${i}_housing_${j}`;
      group.add(mesh);
    });
  });

  return group;
}
