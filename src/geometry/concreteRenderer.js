// The concrete flight in 3D (concreteStair.js): every block as a solid — its top and its soffit through the model's
// heights (one for the whole face or one per outline point), the side faces between them — and the walls under it.
// Draws what the model gives, decides nothing.

import * as THREE from 'three';

function blockGeometry({ outline, topZ, bottomZ }) {
  // plan (x, y) at height z → three (x, z, −y); the outline made counter-clockwise in plan
  let pts = outline;
  let bottoms = bottomZ;
  let tops = Array.isArray(topZ) ? topZ : outline.map(() => topZ);
  const area = pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0);
  if (area < 0) {
    pts = [...pts].reverse();
    bottoms = [...bottoms].reverse();
    tops = [...tops].reverse();
  }
  const n = pts.length;
  const triangles = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
  const position = [];
  const v = (p, z) => position.push(p.x, z, -p.y);
  for (const [a, b, c] of triangles) {
    // top (seen from above: CCW in plan stays CCW in three's x / −z), soffit reversed
    v(pts[a], tops[a]);
    v(pts[b], tops[b]);
    v(pts[c], tops[c]);
    v(pts[a], bottoms[a]);
    v(pts[c], bottoms[c]);
    v(pts[b], bottoms[b]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    v(pts[i], bottoms[i]);
    v(pts[j], bottoms[j]);
    v(pts[j], tops[j]);
    v(pts[i], bottoms[i]);
    v(pts[j], tops[j]);
    v(pts[i], tops[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.computeVertexNormals();
  return g;
}

// One straight piece of the handrail on a low wall: its section (w × h, bottom on the wall's top) along a → b.
function railPiece(a, b, w, h, material) {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const geo = new THREE.BoxGeometry(len, h, w);
  const mesh = new THREE.Mesh(geo, material);
  const A = new THREE.Vector3(a.x, a.z + h / 2, -a.y);
  const B = new THREE.Vector3(b.x, b.z + h / 2, -b.y);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  // the box's x along the piece, kept upright (its y up as far as the slope allows)
  const xAxis = B.clone().sub(A).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, new THREE.Vector3(0, 1, 0)).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** The handrail lying on the low wall above the concrete flight (concreteStair.js capRails) — its own group. */
export function renderConcreteCapRails(concrete, material) {
  if (!concrete?.capRails?.length) return null;
  const group = new THREE.Group();
  group.name = 'Railing';
  concrete.capRails.forEach((run, r) => {
    for (let k = 1; k < run.points.length; k++) {
      const mesh = railPiece(run.points[k - 1], run.points[k], run.widthMm, run.heightMm, material);
      mesh.name = `WallCapRail-${run.side}-${r}-${k - 1}`;
      group.add(mesh);
    }
  });
  return group;
}

/** @returns {THREE.Group|null} the layer "Concrete" (the flight and the walls under it) */
export function renderConcrete(concrete, material, wallMaterial = material) {
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
  for (const wall of concrete.walls || []) {
    const mesh = new THREE.Mesh(blockGeometry(wall), wallMaterial);
    mesh.name = `ConcreteWall-${wall.side}-${wall.treadIndex}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
