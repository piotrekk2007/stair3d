// The rods hung from the ceiling (ceilingRodsModel.js) in 3D: a steel cylinder per rod from the tread's underside to
// the ceiling, a round plate where it is hung (or, fixed to the slab's side, a flat bar to a plate on the slab's face)
// and a nut under the tread. Draws what the model gives, decides nothing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { traceability } from '../scene/traceability.js';

const PLATE_DIAMETER_MM = 50; // the ceiling plate / the nut — presentation only
const PLATE_THICKNESS_MM = 6;
const NUT_HEIGHT_MM = 10;
const BRACKET_BAR_MM = { height: 40, thickness: 8 }; // the flat bar from the rod to the slab's side — presentation only
const BRACKET_PLATE_MM = { size: 80, thickness: 6 }; // its plate on the slab's face

// A box `length` long along the plan direction (dx, dy) from `from`, centred on height z.
function barAlong(from, dx, dy, length, z, height, thickness) {
  const g = new THREE.BoxGeometry(length, height, thickness);
  g.rotateY(Math.atan2(dy, dx));
  g.translate(from.x + (dx * length) / 2, z, -(from.y + (dy * length) / 2));
  return g;
}

function cylinder(radius, z0, z1, x, y, segments = 16) {
  const g = new THREE.CylinderGeometry(radius, radius, z1 - z0, segments);
  // plan (x, y) at height z → three (x, z, −y)
  g.translate(x, (z0 + z1) / 2, -y);
  return g;
}

/** @returns {THREE.Group|null} in the root's "Railing" layer */
export function renderCeilingRods(model, material) {
  if (!model?.rods?.length) return null;
  const group = new THREE.Group();
  group.name = 'Railing';
  const r = model.diameterMm / 2;
  for (const rod of model.rods) {
    const { x, y } = rod.position;
    const parts = [cylinder(r, rod.bottomZ - NUT_HEIGHT_MM, rod.topZ, x, y), cylinder(r * 1.7, rod.bottomZ - NUT_HEIGHT_MM, rod.bottomZ, x, y, 6)];
    if (rod.bracket) {
      const { at, z, reachMm } = rod.bracket;
      const len = Math.hypot(at.x - x, at.y - y);
      // (a rod right at the edge: the bar points nowhere in particular — a plate only)
      if (len > 1) {
        const dx = (at.x - x) / len;
        const dy = (at.y - y) / len;
        parts.push(barAlong(rod.position, dx, dy, reachMm, z, BRACKET_BAR_MM.height, BRACKET_BAR_MM.thickness));
        parts.push(barAlong({ x: at.x - (dx * BRACKET_PLATE_MM.thickness) / 2, y: at.y - (dy * BRACKET_PLATE_MM.thickness) / 2 }, dx, dy, BRACKET_PLATE_MM.thickness, z, BRACKET_PLATE_MM.size, BRACKET_PLATE_MM.size));
      }
    } else {
      parts.push(cylinder(PLATE_DIAMETER_MM / 2, rod.topZ - PLATE_THICKNESS_MM, rod.topZ, x, y, 24));
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.name = `CeilingRod-${rod.id}`;
    mesh.castShadow = true;
    mesh.userData = traceability({ elementType: 'railing', stepId: `step-${rod.treadIndex}`, stringerId: model.side, geometrySourceId: `ceiling-rods:${rod.id}` });
    group.add(mesh);
  }
  return group;
}
