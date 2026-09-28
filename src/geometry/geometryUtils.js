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

// An axis-aligned box with axis-aligned box-shaped pockets taken out (a post with its housings — jointSolver.js), as
// one closed mesh WITHOUT CSG: the box is cut into a grid along every pocket boundary, the cells inside a pocket are
// dropped, and only faces between a kept cell and a dropped/outside one are emitted (so there are no internal faces).
// `outer` and `holes` are {minX,maxX,minY,maxY,minZ,maxZ} in WORLD coordinates (three.js: y up).
export function buildBoxWithBoxPockets(outer, holes) {
  const cuts = (lo, hi, key) => {
    const vals = [outer[lo], outer[hi]];
    for (const h of holes) vals.push(Math.min(Math.max(h[lo], outer[lo]), outer[hi]), Math.min(Math.max(h[hi], outer[lo]), outer[hi]));
    return [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  };
  const xs = cuts('minX', 'maxX');
  const ys = cuts('minY', 'maxY');
  const zs = cuts('minZ', 'maxZ');
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const nz = zs.length - 1;
  const solid = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    const cz = (zs[k] + zs[k + 1]) / 2;
    return !holes.some((h) => cx > h.minX && cx < h.maxX && cy > h.minY && cy < h.maxY && cz > h.minZ && cz < h.maxZ);
  };
  const positions = [];
  const normals = [];
  const quad = (p0, p1, p2, p3, n) => {
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        if (!solid(i, j, k)) continue;
        const [x0, x1, y0, y1, z0, z1] = [xs[i], xs[i + 1], ys[j], ys[j + 1], zs[k], zs[k + 1]];
        if (!solid(i + 1, j, k)) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
        if (!solid(i - 1, j, k)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
        if (!solid(i, j + 1, k)) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
        if (!solid(i, j - 1, k)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
        if (!solid(i, j, k + 1)) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
        if (!solid(i, j, k - 1)) quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}
