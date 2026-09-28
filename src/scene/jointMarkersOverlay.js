// "ZŁĄCZA" VIEW LAYER — draws geometry/jointMarkers.js (the pockets and bolt holes the DXF exports mark) over the 3D
// model. A pure visualisation layer like debugOverlay.js: its own THREE.Group, added to the scene next to the model (not
// into it), so OBJ/DAE exports never see it; it computes nothing — every box/cylinder is placed where the marker data
// says. Drawn see-through and on top of the wood (depthTest off), because every pocket and hole is inside a post or a
// board, hidden by the element that goes into it.

import * as THREE from 'three';
import { planToWorld } from '../geometry/geometryUtils.js';

export const JOINT_MARKER_COLORS = Object.freeze({
  'post-pocket': 0xff8c00, // gniazdo w słupie
  'wanga-housing': 0xffc107, // gniazdo (wpust/wręg) w wandze
  bolt: 0xe53935, // otwór na śrubę
  'nut-bore': 0x8e24aa, // gniazdo nakrętki
});

function overlayMaterial(kind) {
  return new THREE.MeshBasicMaterial({ color: JOINT_MARKER_COLORS[kind] ?? 0xffffff, transparent: true, opacity: kind === 'wanga-housing' ? 0.35 : 0.6, depthTest: false, depthWrite: false });
}

const planVec = (v) => new THREE.Vector3(v.x, 0, -v.y);

/** @param {{boxes: Array, cylinders: Array}} markers  geometry/jointMarkers.js buildJointMarkers() */
export function buildJointMarkersOverlay(markers) {
  const group = new THREE.Group();
  group.name = 'JointMarkers';
  const materials = new Map();
  const mat = (kind) => {
    if (!materials.has(kind)) materials.set(kind, overlayMaterial(kind));
    return materials.get(kind);
  };
  for (const b of markers?.boxes || []) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.sizeU, b.sizeZ, b.sizeN), mat(b.kind));
    // local X = the box's U axis, local Y = up, local Z = its N axis (right-handed basis from U and up)
    const xAxis = planVec(b.axisU).normalize();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    mesh.matrix.makeBasis(xAxis, yAxis, zAxis).setPosition(planToWorld(b.center.x, b.center.y, b.center.z));
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 10;
    mesh.userData.jointMarker = { kind: b.kind, label: b.label };
    group.add(mesh);
  }
  for (const c of markers?.cylinders || []) {
    const a = planToWorld(c.a.x, c.a.y, c.a.z);
    const b = planToWorld(c.b.x, c.b.y, c.b.z);
    const length = a.distanceTo(b);
    if (!(length > 1e-6)) continue;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.diameterMm / 2, c.diameterMm / 2, length, 16), mat(c.kind));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.renderOrder = 11;
    mesh.userData.jointMarker = { kind: c.kind, label: c.label };
    group.add(mesh);
  }
  return group;
}
