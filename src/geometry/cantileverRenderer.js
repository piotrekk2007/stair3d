// The steel profiles of a cantilever stair (cantileverModel.js) as boxes — they sit inside the cladding boxes and
// are drawn for completeness (hidden by the wood, visible with the treads layer off). Decides nothing: every profile
// is where the model put it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { traceability } from '../scene/traceability.js';

function profileGeometry(p) {
  const g = new THREE.BoxGeometry(p.lengthMm, p.heightMm, p.widthMm);
  // local X along the profile (dir), Y up; plan (x, y, z-up) -> world (x, z, -y)
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(p.dir.y, p.dir.x)));
  const c = { x: p.start.x + (p.dir.x * p.lengthMm) / 2, y: p.start.y + (p.dir.y * p.lengthMm) / 2 };
  g.translate(c.x, p.zBottom + p.heightMm / 2, -c.y);
  return g;
}

export function renderCantileverProfiles(treadModels, material) {
  const group = new THREE.Group();
  group.name = 'CantileverProfiles';
  const geometries = treadModels.flatMap((t) => (t.cantilever?.profiles || []).map(profileGeometry));
  if (geometries.length) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.name = 'CantileverProfiles_steel';
    mesh.geometry.userData.woodGrainUV = true;
    mesh.userData = traceability({ elementType: 'post', geometrySourceId: 'cantilever:profiles' });
    group.add(mesh);
  }
  return group;
}
