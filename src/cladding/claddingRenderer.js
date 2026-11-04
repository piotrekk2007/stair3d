// The module "Schody na beton" in 3D: the concrete (grey, its soffit sloping under every flight) and the wooden
// cladding on it (treads, risers). Draws what buildCladdingStair returns, decides nothing.

import * as THREE from 'three';
import { applyWoodGrainToTree, getOakPhotoTexture } from '../scene/woodGrain.js';

// A solid between a plan outline's top and bottom heights (one height per outline point); plan (x, y) at z → three
// (x, z, −y). The outline is made counter-clockwise.
export function prismGeometry(outline, bottomZ, topZ) {
  let pts = outline;
  let bottoms = Array.isArray(bottomZ) ? bottomZ : outline.map(() => bottomZ);
  let tops = Array.isArray(topZ) ? topZ : outline.map(() => topZ);
  const area = pts.reduce((s, p, k) => s + p.x * pts[(k + 1) % pts.length].y - pts[(k + 1) % pts.length].x * p.y, 0);
  if (area < 0) {
    pts = [...pts].reverse();
    bottoms = [...bottoms].reverse();
    tops = [...tops].reverse();
  }
  const n = pts.length;
  const pos = [];
  const v = (k, z) => [pts[k].x, z, -pts[k].y];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const flat = THREE.ShapeUtils.triangulateShape(
    pts.map((p) => new THREE.Vector2(p.x, p.y)),
    []
  );
  for (const [a, b, c] of flat) {
    tri(v(a, tops[a]), v(b, tops[b]), v(c, tops[c]));
    tri(v(a, bottoms[a]), v(c, bottoms[c]), v(b, bottoms[b]));
  }
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    tri(v(k, bottoms[k]), v(k1, bottoms[k1]), v(k1, tops[k1]));
    tri(v(k, bottoms[k]), v(k1, tops[k1]), v(k, tops[k]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0xb4b1aa, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
let woodMaterial = null;
function wood() {
  if (!woodMaterial) woodMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: typeof document === 'undefined' ? null : getOakPhotoTexture(), roughness: 0.7, metalness: 0.02 });
  return woodMaterial;
}
const riserMaterial = new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.8, metalness: 0.02 });

/** @returns {THREE.Group} the stair: layers "Concrete", "Treads", "Risers" */
export function renderCladdingStair(built, { riserMaterial: riserMat = null } = {}) {
  const root = new THREE.Group();
  root.name = 'CladdingStair';
  const { concrete, cladding, config } = built;
  const slab = config.concreteSlabThicknessMm;
  const concreteGroup = new THREE.Group();
  concreteGroup.name = 'Concrete';
  for (const e of concrete.elements) {
    // the soffit: a slab of `slab` square to the pitch under a step (from the previous top at its front line to its own
    // top at its back line), flat under a landing; never below the floor
    const pitch = e.kind === 'step' ? Math.atan2(e.riseMm, e.goingMm) : 0;
    const t = slab / Math.cos(pitch);
    const frontBottom = Math.max(0, (e.kind === 'step' ? e.bottomZ : e.topZ) - t);
    const backBottom = Math.max(0, e.topZ - t);
    // a step: the soffit from its front line to its back line along the flight; a winder: level under its middle
    // height (the zone's soffit is not modelled yet), a landing: level
    const bottoms =
      e.kind === 'step'
        ? e.outline.map((p) => {
            const v = (p.x - e.frame.o.x) * e.frame.f.x + (p.y - e.frame.o.y) * e.frame.f.y;
            const k = e.v1 > e.v0 ? Math.min(1, Math.max(0, (v - e.v0) / (e.v1 - e.v0))) : 0;
            return frontBottom + (backBottom - frontBottom) * k;
          })
        : e.kind === 'winder'
          ? Math.max(0, (e.bottomZ + e.topZ) / 2 - t)
          : backBottom;
    const mesh = new THREE.Mesh(prismGeometry(e.outline, bottoms, e.topZ), concreteMaterial);
    mesh.name = `Concrete-${e.index}`;
    concreteGroup.add(mesh);
  }
  root.add(concreteGroup);
  const treads = new THREE.Group();
  treads.name = 'Treads';
  for (const t of cladding.treads) {
    const mesh = new THREE.Mesh(prismGeometry(t.outline, t.bottomZ, t.topZ), wood());
    mesh.name = `Tread-${t.index}`;
    // the grain across the flight, along the tread's front (as the self-supporting treads)
    mesh.userData = { geometrySourceId: `cladding:${t.id}`, grainDirection: [t.grain.x, 0, -t.grain.y] };
    treads.add(mesh);
  }
  root.add(treads);
  const risers = new THREE.Group();
  risers.name = 'Risers';
  for (const r of cladding.risers) {
    if (!(r.heightMm > 0)) continue;
    const mesh = new THREE.Mesh(prismGeometry(r.outline, r.bottomZ, r.topZ), riserMat || riserMaterial);
    mesh.name = `Riser-${r.index}`;
    mesh.userData = { geometrySourceId: `cladding:${r.id}`, grainDirection: [r.grain.x, 0, -r.grain.y] };
    risers.add(mesh);
  }
  root.add(risers);
  applyWoodGrainToTree(root);
  return root;
}
