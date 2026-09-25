import * as THREE from 'three';

// plan (x, y-w-kierunku-biegu, wysokość) -> świat three.js (X, Y-up, Z)
export function planToWorld(x, y, height) {
  return new THREE.Vector3(x, height, -y);
}

// Wyciąga płaski wielobok 2D (pts2D, w lokalnym układzie u,v) wzdłuż kierunku extrudeDir o głębokość depth.
// toWorld(u, v) -> THREE.Vector3 definiuje płaszczyznę "przednią" (front); "tylna" (back) to front + extrudeDir*depth.
// pts2D musi być prostym wielobokiem (bez dziur), w kolejności CCW patrząc pod kątem przeciwnym do extrudeDir.
export function buildPrism(pts2D, toWorld, extrudeDir, depth) {
  const front = pts2D.map((p) => toWorld(p.u, p.v));
  const back = front.map((v) => v.clone().add(extrudeDir.clone().multiplyScalar(depth)));

  const vec2s = pts2D.map((p) => new THREE.Vector2(p.u, p.v));
  const triangles = THREE.ShapeUtils.triangulateShape(vec2s, []);

  const positions = [];

  const pushTri = (a, b, c) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  for (const [a, b, c] of triangles) {
    pushTri(front[a], front[b], front[c]);
  }
  for (const [a, b, c] of triangles) {
    pushTri(back[a], back[c], back[b]);
  }

  const n = pts2D.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushTri(front[i], front[j], back[j]);
    pushTri(front[i], back[j], back[i]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// As buildPrism, but the face has HOLES (simple polygons strictly inside pts2D, not overlapping each other): the front
// and back faces are triangulated around them and every hole gets its own side walls — a pocket routed through this
// slab. Used for the inner layer of a housed wanga (stringerRenderer.js), where the housings are real recesses.
export function buildPrismWithHoles(pts2D, holes, toWorld, extrudeDir, depth) {
  const outer = THREE.ShapeUtils.isClockWise(pts2D.map((p) => new THREE.Vector2(p.u, p.v))) ? [...pts2D].reverse() : pts2D;
  const holeLoops = holes.map((h) => (THREE.ShapeUtils.isClockWise(h.map((p) => new THREE.Vector2(p.u, p.v))) ? h : [...h].reverse()));
  const all = [...outer, ...holeLoops.flat()];
  const front = all.map((p) => toWorld(p.u, p.v));
  const off = extrudeDir.clone().multiplyScalar(depth);
  const back = front.map((v) => v.clone().add(off));
  const triangles = THREE.ShapeUtils.triangulateShape(
    outer.map((p) => new THREE.Vector2(p.u, p.v)),
    holeLoops.map((h) => h.map((p) => new THREE.Vector2(p.u, p.v)))
  );

  const positions = [];
  const pushTri = (a, b, c) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (const [a, b, c] of triangles) pushTri(front[a], front[b], front[c]);
  for (const [a, b, c] of triangles) pushTri(back[a], back[c], back[b]);
  const walls = (start, n) => {
    for (let i = 0; i < n; i++) {
      const a = start + i;
      const b = start + ((i + 1) % n);
      pushTri(front[a], front[b], back[b]);
      pushTri(front[a], back[b], back[a]);
    }
  };
  walls(0, outer.length);
  let start = outer.length;
  for (const h of holeLoops) {
    walls(start, h.length);
    start += h.length;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
