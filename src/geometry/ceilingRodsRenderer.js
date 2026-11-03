// The rods hung from the ceiling (ceilingRodsModel.js) in 3D: a steel cylinder per rod from the tread's underside to
// the ceiling, a round plate where it is hung and a nut under the tread. Draws what the model gives, decides nothing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { traceability } from '../scene/traceability.js';

const PLATE_DIAMETER_MM = 50; // the ceiling plate / the nut — presentation only
const PLATE_THICKNESS_MM = 6;
const NUT_HEIGHT_MM = 10;

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
    const parts = [
      cylinder(r, rod.bottomZ - NUT_HEIGHT_MM, rod.topZ, x, y),
      cylinder(PLATE_DIAMETER_MM / 2, rod.topZ - PLATE_THICKNESS_MM, rod.topZ, x, y, 24),
      cylinder(r * 1.7, rod.bottomZ - NUT_HEIGHT_MM, rod.bottomZ, x, y, 6),
    ];
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.name = `CeilingRod-${rod.id}`;
    mesh.castShadow = true;
    mesh.userData = traceability({ elementType: 'railing', stepId: `step-${rod.treadIndex}`, stringerId: model.side, geometrySourceId: `ceiling-rods:${rod.id}` });
    group.add(mesh);
  }
  return group;
}
