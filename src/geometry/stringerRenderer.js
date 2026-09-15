// THE ONLY Three.js mesh builder for stringers (wangi). Consumes a StringerModel (see
// stringerModel.js/stringerSolver.js) — it never recomputes geometry, never decides where a
// board sits, never guesses a normal. Every geometric decision already happened in
// stringerSolver.js; this file only turns that decision into triangles.
//
// This replaces stringerGeometry.js (removed in this consolidation pass — see
// .claude/RULES.md rule 8: one canonical implementation per geometric concept). What
// stringerGeometry.js used to do, and where it now lives:
//
//   - Per-tread flat panel from raw chain points  -> StringerSupport (kind: 'tread-bearing'),
//     one THREE panel per bearing, spanning [finalUStart, finalUEnd] along the segment's own
//     straight referenceLine (never recomputed per-panel — see buildBearingPanel below).
//   - computeNormal() centroid/inheritance heuristic -> GONE. Every bearing on one
//     StringerSegment shares that segment's single, already-known `direction` — there is
//     nothing left to infer, so there is nothing left to get wrong.
//   - extendToCloseCorner() (lap-joint extension when hasCornerPost is false) ->
//     extendBearingsAtOpenCorners() below, driven by real geometric adjacency between
//     consecutive StringerSegments (see its own comment for why that is equivalent).
//   - Winder-fan riser normal blending -> N/A here (that lives in riserSolver.js/
//     riserRenderer.js; a stringer segment is always straight by construction, so it never
//     needs a blended normal — only the recess amount, already computed as
//     StringerSupport.riserRecess).
//
// buildStringerMeshGeometries()/renderStringers() take an ALREADY-BUILT StringerModel — this
// module never calls stringerSolver.js itself (see buildStaircase.js, the orchestrator that
// builds every *Model first, then renders each one).

import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { rotate90CW } from './planLayout.js';
import { pointsEqual } from './pathUtils.js';

// A board's thickness must extrude TOWARD the stair's interior (rule 5/RULES.md: the visible,
// outward face sits flush with the tread edge) — never away from it. "Interior" from the
// OUTER board's own straight-ahead direction is rotate90CW(direction) (the SAME canonical
// "kierunek poprzeczny" convention as planLayout.js's frame chaining: right = rotate90CW(fwd)
// always points from outer toward inner/dusza). From the INNER board it is the opposite
// rotation. One shared definition, reused here instead of re-derived — see item 3 of the
// consolidation pass (".claude/RULES.md" companion doc on unifying direction primitives).
function inwardDirection(direction, side) {
  const cw = rotate90CW(direction);
  return side === 'outer' ? cw : { x: -cw.x, y: -cw.y };
}

// Builds one flat rectangular panel for a single StringerSupport bearing: spans
// [uStart, uEnd] along the segment's OWN straight referenceLine (so it is geometrically
// impossible for the panel to be crooked or rotated — it is defined entirely in terms of a
// line that was already asserted straight by stringerModel.js), at
// [bearingElevation - segment.width, bearingElevation], extruded inward by segment.thickness.
function buildBearingPanel(segment, uStart, uEnd, bearingElevation, side) {
  const ref = segment.referenceLine;
  const segLen = uEnd - uStart;
  if (segLen <= 0) return null;
  const zTop = bearingElevation;
  const zBottom = bearingElevation - segment.width;
  if (zTop <= zBottom) return null;

  const p0 = { x: ref.start.x + ref.direction.x * uStart, y: ref.start.y + ref.direction.y * uStart };

  const toWorld = (u, v) => {
    const px = p0.x + ref.direction.x * u;
    const py = p0.y + ref.direction.y * u;
    return planToWorld(px, py, v);
  };

  const pts2D = [
    { u: 0, v: zBottom },
    { u: segLen, v: zBottom },
    { u: segLen, v: zTop },
    { u: 0, v: zTop },
  ];

  const normal = inwardDirection(ref.direction, side);
  const extrudeDir = new THREE.Vector3(normal.x, 0, -normal.y);
  return buildPrism(pts2D, toWorld, extrudeDir, segment.thickness);
}

// When there is no corner post (config.hasCornerPost === false), two stringer segments that
// meet at a real corner (their reference lines share an endpoint) would otherwise leave a
// visible notch at the joint once thickness is extruded, because each board's own extrusion
// direction differs on either side of the corner. stringerGeometry.js's old
// extendToCloseCorner() fixed this by extending each board past the corner by its own
// thickness, so they physically overlap at the joint (a simple lap-joint equivalent).
//
// Here the SAME fix is expressed generically: any two segments that are adjacent in the
// model's `segments` array (which is built in physical/tread order — see stringerSolver.js)
// AND whose facing endpoints coincide are, by construction, exactly the turn corners that
// need this (a winder's outer bend, a landing's outer or inner corner) — there is no other
// reason two stringer segments would share an endpoint. This is checked once per stringer,
// not per rendered panel, and returns which segment INDEX needs extension at which end.
function computeOpenCornerExtensions(segments, hasCornerPost) {
  const extendEndOf = new Set(); // segment index whose LAST bearing should extend past uEnd
  const extendStartOf = new Set(); // segment index whose FIRST bearing should extend before uStart
  if (hasCornerPost) return { extendEndOf, extendStartOf };

  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i].referenceLine;
    const b = segments[i + 1].referenceLine;
    if (pointsEqual(a.end, b.start)) {
      extendEndOf.add(i);
      extendStartOf.add(i + 1);
    }
  }
  return { extendEndOf, extendStartOf };
}

/**
 * @param {import('./stringerModel.js').StringerModel} model  Already built by
 *   stringerSolver.js's buildStringerModel() — this function NEVER calls the solver itself
 *   (see buildStaircase.js, which builds the model and passes it in explicitly).
 * @param {boolean} hasCornerPost
 */
export function buildStringerMeshGeometries(model, hasCornerPost) {
  const { extendEndOf, extendStartOf } = computeOpenCornerExtensions(model.segments, hasCornerPost);
  const side = model.side;

  const geometries = [];
  model.segments.forEach((segment, segIdx) => {
    const bearings = segment.treadBearings;
    bearings.forEach((bearing, i) => {
      let uStart = bearing.finalUStart;
      let uEnd = bearing.finalUEnd;

      // Recess for a riser board bites into the bearing's OWN front, and only when this
      // bearing actually owns the tread's true front boundary (see stringerSolver.js —
      // a `partial` bearing's non-owning half must not be recessed a second time).
      if (bearing.ownsStart && bearing.riserRecess > 0) {
        uStart = Math.min(uEnd, uStart + bearing.riserRecess);
      }

      if (i === 0 && extendStartOf.has(segIdx)) uStart -= segment.thickness;
      if (i === bearings.length - 1 && extendEndOf.has(segIdx)) uEnd += segment.thickness;

      const geo = buildBearingPanel(segment, uStart, uEnd, bearing.bearingElevation, side);
      if (geo) geometries.push(geo);
    });
  });
  return geometries;
}

export function renderStringers(model, hasCornerPost, material, groupName) {
  const group = new THREE.Group();
  group.name = groupName;
  buildStringerMeshGeometries(model, hasCornerPost).forEach((geo, i) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `${groupName}_${i}`;
    group.add(mesh);
  });
  return group;
}
