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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPrism, buildPrismWithHoles, planToWorld } from './geometryUtils.js';
import { traceability } from '../scene/traceability.js';

// A board's thickness extrudes TOWARD the stair's interior (the visible, outward face sits on the reference line)
// — the direction is decided by the solver (StringerSegment.inwardNormal, planLayout.js inwardNormal, which also
// handles a mirrored left-turn plan); the renderer only reads it.

// Builds a world-space toWorld(u,v)->Vector3 function for one segment's own straight
// referenceLine — u = distance along it from its start, v = world elevation. Every mesh for
// this segment (the board itself, its housing indicators) is built through this
// SAME function, so they can never drift apart or rotate independently of one another.
function localFrameFor(segment) {
  const ref = segment.referenceLine;
  return (u, v) => planToWorld(ref.start.x + ref.direction.x * u, ref.start.y + ref.direction.y * u, v);
}

function extrudeVector(direction) {
  return new THREE.Vector3(direction.x, 0, -direction.y);
}

function extrude(pts2D, toWorld, direction, depth) {
  return buildPrism(pts2D, toWorld, extrudeVector(direction), depth);
}

function buildBoardMesh(segment, geo, side, material) {
  if (geo.outerContour.length === 0) return null;
  const toWorld = localFrameFor(segment);
  const direction = segment.inwardNormal;
  const pockets = geo.housingPockets || [];
  const depth = geo.pocketDepthMm || 0;
  let geometry;
  if (pockets.length > 0 && depth > 0 && depth < geo.thicknessMm) {
    // A housed board with REAL recesses: the outer layer (the wanga's outer face, thickness − pocket depth) is solid;
    // the inner layer (pocket depth, at the inner face) has the pockets (StringerSegmentConstructionGeometry
    // .housingPockets) as holes — the tread ends sit in them. No CSG needed: both layers are plain extrusions.
    const solidDepth = geo.thicknessMm - depth;
    const shift = new THREE.Vector3(direction.x, 0, -direction.y).multiplyScalar(solidDepth);
    const innerToWorld = (u, v) => toWorld(u, v).add(shift);
    geometry = mergeGeometries([extrude(geo.outerContour, toWorld, direction, solidDepth), buildPrismWithHoles(geo.outerContour, pockets, innerToWorld, extrudeVector(direction), depth)]);
  } else {
    geometry = extrude(geo.outerContour, toWorld, direction, geo.thicknessMm);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = traceability({ elementType: 'stringer', stringerId: side, geometrySourceId: `stringer:${side}:${geo.segmentId}` });
  return mesh;
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
  });

  return group;
}
