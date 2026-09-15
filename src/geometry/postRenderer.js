// THE ONLY Three.js mesh builder for posts. Consumes PostModel[] (postSolver.js) — it does
// not decide positions, only builds a box mesh at an already-decided position/size.

import * as THREE from 'three';

function boxMeshFor(model) {
  const height = model.elevation.top - model.elevation.bottom;
  const geometry = new THREE.BoxGeometry(model.size, height, model.size);
  geometry.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(model.position.x, model.elevation.bottom, -model.position.y);
  return mesh;
}

const MESH_NAME_BY_KIND = { start: 'Post_Start', end: 'Post_End' };

export function renderPosts(postModels, material) {
  const group = new THREE.Group();
  group.name = 'Posts';
  let cornerIndex = 0;
  for (const model of postModels) {
    const mesh = boxMeshFor(model);
    mesh.material = material;
    mesh.name = model.kind === 'corner' ? `Post_Corner_${cornerIndex++}` : MESH_NAME_BY_KIND[model.kind];
    group.add(mesh);
  }
  return group;
}
