// The concrete flight in 3D (concreteStair.js): every block as a solid — its flat top, its soffit through the model's
// per-vertex heights, the side faces between them. Draws what the model gives, decides nothing.

import * as THREE from 'three';

function blockGeometry({ outline, topZ, bottomZ }) {
  // plan (x, y) at height z → three (x, z, −y); the outline made counter-clockwise in plan
  let pts = outline;
  let bottoms = bottomZ;
  const area = pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0);
  if (area < 0) {
    pts = [...pts].reverse();
    bottoms = [...bottoms].reverse();
  }
  const n = pts.length;
  const triangles = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
  const position = [];
  const v = (p, z) => position.push(p.x, z, -p.y);
  for (const [a, b, c] of triangles) {
    // top (seen from above: CCW in plan stays CCW in three's x / −z), soffit reversed
    v(pts[a], topZ);
    v(pts[b], topZ);
    v(pts[c], topZ);
    v(pts[a], bottoms[a]);
    v(pts[c], bottoms[c]);
    v(pts[b], bottoms[b]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    v(pts[i], bottoms[i]);
    v(pts[j], bottoms[j]);
    v(pts[j], topZ);
    v(pts[i], bottoms[i]);
    v(pts[j], topZ);
    v(pts[i], topZ);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.computeVertexNormals();
  return g;
}

/** @returns {THREE.Group|null} the layer "Concrete" */
export function renderConcrete(concrete, material) {
  if (!concrete?.blocks?.length) return null;
  const group = new THREE.Group();
  group.name = 'Concrete';
  for (const block of concrete.blocks) {
    const mesh = new THREE.Mesh(blockGeometry(block), material);
    mesh.name = block.treadIndex === null ? 'ConcreteTop' : `ConcreteStep-${block.treadIndex}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // a cast-on-site part: shown, never priced, not a selectable element (no traceability id)
    group.add(mesh);
  }
  return group;
}
