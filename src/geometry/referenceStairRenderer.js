// The stair on the next floor in 3D (referenceStair.js): its own built root placed by the reference's transform
// (rotation about the vertical, mirror, shift, the height offset) and a red marker at every spot where the passage
// under the upper stair is too low (from the lower tread up to the upper stair's underside). Presentation only — a
// scene object of its own beside the stair root (never selected, never exported with this project).

import * as THREE from 'three';

const clashMaterial = new THREE.LineBasicMaterial({ color: 0xd62828 });

/** @returns {THREE.Group|null} */
export function renderReferenceStair(reference) {
  if (!reference?.other?.root) return null;
  const group = new THREE.Group();
  group.name = 'ReferenceStair';
  const placed = new THREE.Group();
  const { ref, transform } = reference;
  // plan (x, y, z) → three (x, z, −y); a plan rotation counter-clockwise = about +y; the mirror (plan x → −x) first
  placed.scale.set(ref.mirror ? -1 : 1, 1, 1);
  const wrap = new THREE.Group();
  wrap.rotation.y = (ref.rotationDeg * Math.PI) / 180;
  wrap.position.set(ref.dxMm, transform.dz, -ref.dyMm);
  placed.add(reference.other.root);
  wrap.add(placed);
  group.add(wrap);
  for (const m of reference.markers || []) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(m.at.x, m.fromZ, -m.at.y), new THREE.Vector3(m.at.x, m.toZ, -m.at.y)]);
    const line = new THREE.Line(g, clashMaterial);
    line.name = 'ReferenceStairClash';
    group.add(line);
  }
  // the reference is never picked / highlighted as this project's element
  group.traverse((o) => {
    o.userData = { referenceStair: true };
  });
  return group;
}
