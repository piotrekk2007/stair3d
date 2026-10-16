// The stairwell's walls in 3D (geometry/stairwell.js stairwellWalls): translucent boxes, presentation only — never
// part of the stair root (not exported, not selectable, not measured). Extrudes what it is given.

import * as THREE from 'three';
import { planToWorld } from './geometryUtils.js';

/** @returns {THREE.Group|null} */
export function buildStairwellWalls(walls) {
  if (!walls?.pieces?.length) return null;
  const group = new THREE.Group();
  group.name = 'StairwellWalls';
  const material = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  for (const w of walls.pieces) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (!(len > 0) || !(w.height > 0)) continue;
    const geometry = new THREE.BoxGeometry(len, w.height, w.thickness);
    const mesh = new THREE.Mesh(geometry, material);
    // centre: the middle of the inner face, half a thickness outward, half the height up
    const mid = { x: (w.a.x + w.b.x) / 2 + (w.outward.x * w.thickness) / 2, y: (w.a.y + w.b.y) / 2 + (w.outward.y * w.thickness) / 2 };
    mesh.position.copy(planToWorld(mid.x, mid.y, w.height / 2));
    // the box's X axis along the wall: plan direction (dx, dy) is world (dx, -dy) on the ground
    mesh.rotation.y = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
    mesh.name = `StairwellWall-${w.side}`;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  return group;
}
