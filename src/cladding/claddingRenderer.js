// The module "Schody na beton" in 3D: the concrete (grey, its soffit sloping under every flight) and the wooden
// cladding on it (treads, risers). Draws what buildCladdingStair returns, decides nothing.

import * as THREE from 'three';
import { applyWoodGrainToTree, getOakPhotoTexture } from '../scene/woodGrain.js';
import { insetExposed, profileRings } from './starterProfile.js';

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

// A solid through rings of the same point count, bottom to top ({pts, z}): the side faces between consecutive rings, a
// cap at each end — a tread with a milled edge (starterProfile.js profileRings)
export function loftGeometry(rings) {
  const ccw = (pts) => pts.reduce((s, p, k) => s + p.x * pts[(k + 1) % pts.length].y - pts[(k + 1) % pts.length].x * p.y, 0) >= 0;
  const flip = !ccw(rings[0].pts);
  const R = flip ? rings.map((r) => ({ ...r, pts: [...r.pts].reverse() })) : rings;
  const pos = [];
  const v = (p, z) => [p.x, z, -p.y];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const n = R[0].pts.length;
  for (let k = 0; k < R.length - 1; k++) {
    const A = R[k];
    const B = R[k + 1];
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      tri(v(A.pts[j], A.z), v(A.pts[j1], A.z), v(B.pts[j1], B.z));
      tri(v(A.pts[j], A.z), v(B.pts[j1], B.z), v(B.pts[j], B.z));
    }
  }
  const cap = (ring, up) => {
    const faces = THREE.ShapeUtils.triangulateShape(ring.pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
    for (const [a, b, c] of faces) {
      if (up) tri(v(ring.pts[a], ring.z), v(ring.pts[b], ring.z), v(ring.pts[c], ring.z));
      else tri(v(ring.pts[a], ring.z), v(ring.pts[c], ring.z), v(ring.pts[b], ring.z));
    }
  };
  cap(R[0], false);
  cap(R[R.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// a tread: a plain prism, or (a milled edge) a loft through its profile's rings — the exposed edges moved in
function treadGeometry(t) {
  const kind = t.profile?.kind || 'square';
  if (kind === 'square' || !t.exposed?.some(Boolean)) return prismGeometry(t.outline, t.bottomZ, t.topZ);
  const rings = profileRings(kind, t.profile.sizeMm, t.topZ - t.bottomZ).map((r) => ({ pts: insetExposed(t.outline, t.exposed, r.inset), z: t.bottomZ + r.z }));
  return loftGeometry(rings);
}

const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0xb4b1aa, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
let woodMaterial = null;
function wood() {
  if (!woodMaterial) woodMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: typeof document === 'undefined' ? null : getOakPhotoTexture(), roughness: 0.7, metalness: 0.02 });
  return woodMaterial;
}
const riserMaterial = new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.8, metalness: 0.02 });
const osbMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.9, metalness: 0 });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e5de, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
// a wall carrying the stair (under it, between its flights): solid masonry
const concreteWallMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
const slabMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });

const railingWood = () => wood();
const grooveMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.8, metalness: 0 });

// a board in its own vertical plane (finishModel.js): the polygon in (s along `dir`, z up), its thickness along
// `normal`, s = 0 at `origin`
function planeBoardGeometry(board) {
  const shape = new THREE.Shape(board.polygon.map((p) => new THREE.Vector2(p.s, p.z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: board.thicknessMm, bevelEnabled: false });
  // (a mirrored basis turns the faces inside out — the materials are two-sided)
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(board.dir.x, 0, -board.dir.y), new THREE.Vector3(0, 1, 0), new THREE.Vector3(board.normal.x, 0, -board.normal.y));
  m.setPosition(board.origin.x, 0, -board.origin.y);
  g.applyMatrix4(m);
  return g;
}
// a box from plan point a (at za) to b (at zb), `w` wide across, `h` high (its centre line a → b)
function beam(a, b, w, h, material) {
  const A = new THREE.Vector3(a.x, a.z, -a.y);
  const B = new THREE.Vector3(b.x, b.z, -b.y);
  const len = A.distanceTo(B);
  const g = new THREE.BoxGeometry(len, h, w);
  const mesh = new THREE.Mesh(g, material);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A).normalize();
  const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), flat);
  // pitched: turn about the beam's own horizontal across axis
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  mesh.rotateZ(pitch);
  return mesh;
}
function column(at, z0, z1, size, material) {
  const g = new THREE.BoxGeometry(size, z1 - z0, size);
  g.translate(at.x, (z0 + z1) / 2, -at.y);
  return new THREE.Mesh(g, material);
}
// a decorative post (user, 2026-11-04): the square shaft, milled rings under the top, a flat / pyramid / ball cap
function decorativePost(p) {
  const group = new THREE.Group();
  group.name = `Post-${p.id}`;
  const shaftTop = p.topZ - p.capHeightMm;
  group.add(column(p.at, p.bottomZ, shaftTop, p.size, railingWood()));
  for (let k = 0; k < p.grooves; k++) {
    const z = shaftTop - 40 - k * 30;
    const ring = column(p.at, z - 4, z + 4, p.size + 4, grooveMaterial);
    ring.name = 'Groove';
    group.add(ring);
  }
  if (p.cap === 'pyramid') {
    // (a 4-sided cone, its corners over the shaft's corners, a little wider)
    const g = new THREE.ConeGeometry((p.size * 1.1) / Math.SQRT2, p.capHeightMm, 4);
    g.rotateY(Math.PI / 4);
    g.translate(p.at.x, shaftTop + p.capHeightMm / 2, -p.at.y);
    group.add(new THREE.Mesh(g, railingWood()));
  } else if (p.cap === 'ball') {
    const r = Math.min(p.size * 0.6, p.capHeightMm);
    const g = new THREE.SphereGeometry(r, 20, 14);
    g.translate(p.at.x, shaftTop + r * 0.9, -p.at.y);
    group.add(new THREE.Mesh(g, railingWood()));
  } else {
    group.add(column(p.at, shaftTop, shaftTop + Math.max(15, p.capHeightMm / 3), p.size * 1.25, railingWood()));
  }
  return group;
}

// the slab with its opening: a plan outline with a hole, from its soffit to its top (three: y up, plan y → −z)
function slabGeometry(outline, hole, bottomZ, topZ) {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
  shape.holes.push(new THREE.Path([...hole].reverse().map((p) => new THREE.Vector2(p.x, p.y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: topZ - bottomZ, bevelEnabled: false });
  // the shape lies in x / y, extruded along +z: turn it so plan y → −z and the extrusion goes up
  g.rotateX(-Math.PI / 2);
  g.translate(0, bottomZ, 0);
  return g;
}

/** @returns {THREE.Group} the stair: layers "Concrete", "Treads", "Risers" */
export function renderCladdingStair(built, { riserMaterial: riserMat = null, room: withRoom = true } = {}) {
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
  // a starter step's support under its widening (inside its bent riser)
  for (const b of cladding.starterBlocks || []) {
    const mesh = new THREE.Mesh(prismGeometry(b.outline, b.bottomZ, b.topZ), concreteMaterial);
    mesh.name = `StarterBlock-${b.index}`;
    concreteGroup.add(mesh);
  }
  root.add(concreteGroup);
  const treads = new THREE.Group();
  treads.name = 'Treads';
  const grainOf = (t) => [t.grain.x, 0, -t.grain.y];
  for (const t of cladding.treads) {
    if (t.parts) {
      // a floor-board landing: the solid nosing, the OSB, the boards on it
      const { nosing, osb, boards } = t.parts;
      if (nosing) treads.add(Object.assign(new THREE.Mesh(prismGeometry(nosing.outline, nosing.bottomZ, nosing.topZ), wood()), { name: `LandingNosing-${t.index}`, userData: { geometrySourceId: `cladding:${t.id}:nosing`, grainDirection: grainOf(t) } }));
      if (osb) treads.add(Object.assign(new THREE.Mesh(prismGeometry(osb.outline, osb.bottomZ, osb.topZ), osbMaterial), { name: `LandingOSB-${t.index}` }));
      if (boards) treads.add(Object.assign(new THREE.Mesh(prismGeometry(boards.outline, boards.bottomZ, boards.topZ), wood()), { name: `LandingBoards-${t.index}`, userData: { geometrySourceId: `cladding:${t.id}:boards`, grainDirection: [t.grain.y, 0, t.grain.x] } }));
      continue;
    }
    const mesh = new THREE.Mesh(treadGeometry(t), wood());
    mesh.name = `Tread-${t.index}`;
    // the grain across the flight, along the tread's front (as the self-supporting treads)
    mesh.userData = { geometrySourceId: `cladding:${t.id}`, grainDirection: grainOf(t) };
    treads.add(mesh);
  }
  // the antresola nosing at the exit
  for (const n of cladding.exitNosing || []) {
    treads.add(Object.assign(new THREE.Mesh(prismGeometry(n.outline, n.bottomZ, n.topZ), wood()), { name: `ExitNosing`, userData: { geometrySourceId: `cladding:${n.id}`, grainDirection: grainOf(n) } }));
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
  // stage 5: skirting boards, cover stringers, the balustrade with its decorative posts
  const finish = new THREE.Group();
  finish.name = 'Finish';
  for (const b of [...(built.finish?.skirting || []), ...(built.finish?.coverStringers || [])]) {
    const mesh = new THREE.Mesh(planeBoardGeometry(b), wood());
    mesh.name = `${b.kind}-${b.id}`;
    mesh.userData = { geometrySourceId: `cladding:${b.id}`, grainDirection: [b.dir.x, 0, -b.dir.y] };
    finish.add(mesh);
  }
  root.add(finish);
  const railing = new THREE.Group();
  railing.name = 'Railing';
  for (const s of built.balustrade?.sections || []) {
    for (let k = 1; k < s.handrail.length; k++) railing.add(Object.assign(beam(s.handrail[k - 1], s.handrail[k], config.handrailWidthMm, config.handrailHeightMm, railingWood()), { name: `Handrail-${s.id}-${k}` }));
    for (const b of s.balusters) railing.add(Object.assign(column(b.at, b.bottomZ, b.topZ, b.size, railingWood()), { name: 'Baluster' }));
    for (const p of s.posts) railing.add(decorativePost(p));
  }
  root.add(railing);
  applyWoodGrainToTree(root);
  // the surroundings (stage 3) — no wood grain: the walls see-through, the slab with its opening
  const room = new THREE.Group();
  room.name = 'Room';
  for (const w of built.walls || []) {
    const mesh = new THREE.Mesh(prismGeometry(w.outline, w.bottomZ, w.topZ), wallMaterial);
    mesh.name = `Wall-${w.id}`;
    mesh.renderOrder = 2;
    room.add(mesh);
  }
  // the walls following the stair (sideWallsModel.js): above the steps, under the flight, between flights set apart
  for (const w of built.sideWalls || []) {
    const mesh = new THREE.Mesh(planeBoardGeometry(w), w.kind === 'wall-under' || w.kind === 'wall-gap' ? concreteWallMaterial : wallMaterial);
    mesh.name = `${w.kind}-${w.id}`;
    mesh.renderOrder = 2;
    room.add(mesh);
  }
  if (built.slab && config.showSlab) {
    const s = built.slab;
    const mesh = new THREE.Mesh(slabGeometry(s.outline, s.opening, s.bottomZ, s.topZ), slabMaterial);
    mesh.name = 'Slab';
    mesh.receiveShadow = true;
    room.add(mesh);
  }
  if (withRoom) root.add(room);
  return root;
}
