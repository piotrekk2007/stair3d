// The ceiling opening's trim ("fajka", openingTrimModel.js) in 3D: every solid of every piece — a plan outline between
// two heights — extruded as it is given. Decides nothing.

import * as THREE from 'three';
import { traceability } from '../scene/traceability.js';

// A hole's outline in plan (axis-aligned like the posts and balusters standing in it; a circle for a round baluster).
function holePath(h) {
  const path = new THREE.Path();
  const r = h.sizeMm / 2;
  if (h.shape === 'round') path.absarc(h.x, h.y, r, 0, Math.PI * 2, true);
  else {
    path.moveTo(h.x - r, h.y - r);
    path.lineTo(h.x - r, h.y + r);
    path.lineTo(h.x + r, h.y + r);
    path.lineTo(h.x + r, h.y - r);
    path.closePath();
  }
  return path;
}

function solidGeometry(solid, holes = []) {
  const shape = new THREE.Shape(solid.outline.map((p) => new THREE.Vector2(p.x, p.y)));
  // the balustrade's holes through it (openingTrimModel.js withTrimHoles; one across a mitre — a corner post — is not cut
  // here: the post stands through both pieces' corner)
  for (const h of holes) shape.holes.push(holePath(h));
  const g = new THREE.ExtrudeGeometry(shape, { depth: solid.zTop - solid.zBottom, bevelEnabled: false });
  // shape (x, y_plan) extruded along z → world (x, z_up, −y_plan): a turn of −90° about X, then up to its bottom
  g.rotateX(-Math.PI / 2);
  g.translate(0, solid.zBottom, 0);
  return g;
}

/** @returns {THREE.Group|null} */
export function renderOpeningTrim(trim, material) {
  if (!trim?.enabled || !trim.pieces?.length) return null;
  const group = new THREE.Group();
  group.name = 'OpeningTrim';
  for (const piece of trim.pieces) {
    for (const solid of piece.solids) {
      const mesh = new THREE.Mesh(solidGeometry(solid, (piece.holes || []).filter((h) => h.solid === solid.kind && h.whole)), material);
      mesh.name = `OpeningTrim_${piece.id}_${solid.kind}`;
      mesh.userData = traceability({ elementType: 'openingTrim', geometrySourceId: `opening-trim:${piece.id}:${solid.kind}` });
      // the grain along the piece (plan (dx, dy) → world (dx, 0, −dy)) — presentation only
      const len = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) || 1;
      mesh.userData.grainDirection = [(piece.b.x - piece.a.x) / len, 0, -(piece.b.y - piece.a.y) / len];
      group.add(mesh);
    }
  }
  return group;
}
