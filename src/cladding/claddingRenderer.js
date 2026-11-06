// The module "Schody na beton" in 3D: the concrete (grey, its soffit sloping under every flight) and the wooden
// cladding on it (treads, risers). Draws what buildCladdingStair returns, decides nothing.

import * as THREE from 'three';
import { applyWoodGrainToTree, getOakPhotoTexture, getOakTexture, getOakMeanLuminance, OAK_PHOTO_MEAN_HEX } from '../scene/woodGrain.js';
import { applyAppearanceToMaterials, defaultAppearance } from '../scene/appearance.js';
import { insetExposed, profileRings } from './starterProfile.js';
import { GLASS_TINTS } from './balustradeModel.js';

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
// one material per element group, coloured by the presentation's appearance (the SHARED scene/appearance.js: the same
// colour presets and finishes — oak photo / generated oak / solid — as the self-supporting module): tread (treads,
// landings, noses), riser, stringer (the skirting boards and cover stringers), post, railing (the handrail), baluster,
// glassFixing (user request 2026-11-04)
const woodMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.02 });
const MATERIALS = { tread: woodMat(), riser: woodMat(), stringer: woodMat(), post: woodMat(), railing: woodMat(), baluster: woodMat(), glassFixing: new THREE.MeshStandardMaterial({ color: 0xb9bdc1, roughness: 0.3, metalness: 0.9 }) };
const OAK_BUMP_SCALE = 0.6; // as the self-supporting renderer — visual only
let appearance = defaultAppearance();
function woodTextures() {
  if (typeof document === 'undefined') return null;
  return { texture: getOakTexture(), meanLuminance: getOakMeanLuminance(), bumpScale: OAK_BUMP_SCALE, photo: { texture: getOakPhotoTexture(), meanHex: OAK_PHOTO_MEAN_HEX } };
}
/** The module's colours / finishes (presentation state, not the config — kept in the project file). */
export function setCladdingAppearance(next) {
  appearance = next || defaultAppearance();
  applyAppearanceToMaterials(MATERIALS, appearance, woodTextures());
}
setCladdingAppearance(appearance);
const wood = () => MATERIALS.tread;
const riserMaterial = MATERIALS.riser;
// the LED strips: a warm glowing band (presentation only)
const ledMaterial = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc23a, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 });
const osbMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.9, metalness: 0 });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e5de, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
// a wall carrying the stair (under it, between its flights): solid masonry
const concreteWallMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
const slabMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });

const steelFixing = MATERIALS.glassFixing;
const grooveMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.8, metalness: 0 });

// a board in its own vertical plane (finishModel.js): the polygon in (s along `dir`, z up), its thickness along
// `normal`, s = 0 at `origin`
function planeBoardGeometry(board) {
  const shape = new THREE.Shape(board.polygon.map((p) => new THREE.Vector2(p.s, p.z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: board.thicknessMm, bevelEnabled: false });
  // a corner cut (finishModel.js cornerCuts): the end's vertices moved along s by k × their depth from the wall's face
  const cuts = [board.corners?.start, board.corners?.end].filter(Boolean);
  if (cuts.length) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const cut = cuts.find((c) => Math.abs(pos.getX(i) - c.s) < 0.5);
      if (cut) pos.setX(i, pos.getX(i) + cut.k * pos.getZ(i));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }
  // (a mirrored basis turns the faces inside out — the materials are two-sided)
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(board.dir.x, 0, -board.dir.y), new THREE.Vector3(0, 1, 0), new THREE.Vector3(board.normal.x, 0, -board.normal.y));
  m.setPosition(board.origin.x, 0, -board.origin.y);
  g.applyMatrix4(m);
  return g;
}
// A folded wall (sideWallsModel.js joinSideWalls): the region between its bottom and top lines in (cs, z) laid on its
// face line in plan and on the mitred back line, one strip per straight segment (a triangle never spans a corner),
// the outline's edges closed by side faces — one closed body, no inner faces (the walls are see-through).
function foldedWallGeometry(body) {
  const { path, cs, back } = body;
  const EPS = 1e-6;
  const valueAt = (line, s, fromRight) => {
    const hit = line.filter((p) => Math.abs(p.s - s) < EPS);
    if (hit.length) return (fromRight ? hit[hit.length - 1] : hit[0]).z;
    for (let k = 1; k < line.length; k++)
      if (s >= line[k - 1].s - EPS && s <= line[k].s + EPS) return line[k - 1].z + ((line[k].z - line[k - 1].z) * (s - line[k - 1].s)) / (line[k].s - line[k - 1].s || 1);
    return line[s < line[0].s ? 0 : line.length - 1].z;
  };
  const clip = (line, c0, c1) => [{ s: c0, z: valueAt(line, c0, true) }, ...line.filter((p) => p.s > c0 + EPS && p.s < c1 - EPS), { s: c1, z: valueAt(line, c1, false) }];
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let k = 0; k < path.length - 1; k++) {
    const c0 = cs[k];
    const c1 = cs[k + 1];
    if (c1 - c0 < EPS) continue;
    const at = (line, s, z) => {
      const t = (s - c0) / (c1 - c0);
      return [line[k].x + (line[k + 1].x - line[k].x) * t, z, -(line[k].y + (line[k + 1].y - line[k].y) * t)];
    };
    const strip = [...clip(body.bottom, c0, c1), ...clip(body.top, c0, c1).reverse()].filter((p, i, all) => i === 0 || Math.abs(p.s - all[i - 1].s) > EPS || Math.abs(p.z - all[i - 1].z) > EPS);
    if (strip.length < 3) continue;
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(strip.map((p) => new THREE.Vector2(p.s, p.z)), [])) {
      tri(at(path, strip[a].s, strip[a].z), at(path, strip[b].s, strip[b].z), at(path, strip[c].s, strip[c].z));
      tri(at(back, strip[a].s, strip[a].z), at(back, strip[c].s, strip[c].z), at(back, strip[b].s, strip[b].z));
    }
    // the side faces: every edge of the strip but the joints with the next / previous strip
    for (let i = 0; i < strip.length; i++) {
      const p = strip[i];
      const q = strip[(i + 1) % strip.length];
      const joint = (Math.abs(p.s - c0) < EPS && Math.abs(q.s - c0) < EPS && k > 0) || (Math.abs(p.s - c1) < EPS && Math.abs(q.s - c1) < EPS && k < path.length - 2);
      if (joint) continue;
      const fp = at(path, p.s, p.z);
      const fq = at(path, q.s, q.z);
      const bp = at(back, p.s, p.z);
      const bq = at(back, q.s, q.z);
      tri(fp, fq, bq);
      tri(fp, bq, bp);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
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
  // (no cap: the shaft up to the post's top)
  const shaftTop = p.cap === 'none' ? p.topZ : p.topZ - p.capHeightMm;
  group.add(column(p.at, p.bottomZ, shaftTop, p.size, MATERIALS.post));
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
    group.add(new THREE.Mesh(g, MATERIALS.post));
  } else if (p.cap === 'round') {
    // a turned, rounded top: a lathe profile — a collar the shaft's width, a neck, the dome (user request 2026-11-05)
    const h = Math.max(20, p.capHeightMm);
    const w = p.size / 2;
    const prof = [[w * 1.02, 0], [w * 1.02, h * 0.12], [w * 0.72, h * 0.22], [w * 0.8, h * 0.4], [w * 0.86, h * 0.55], [w * 0.78, h * 0.72], [w * 0.55, h * 0.88], [w * 0.28, h * 0.97], [0, h]];
    const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24);
    g.translate(p.at.x, shaftTop, -p.at.y);
    group.add(Object.assign(new THREE.Mesh(g, MATERIALS.post), { name: 'PostCapRound' }));
  } else if (p.cap === 'none') {
    // (nothing on top)
  } else if (p.cap === 'ball') {
    const r = Math.min(p.size * 0.6, p.capHeightMm);
    const g = new THREE.SphereGeometry(r, 20, 14);
    g.translate(p.at.x, shaftTop + r * 0.9, -p.at.y);
    group.add(new THREE.Mesh(g, MATERIALS.post));
  } else {
    group.add(column(p.at, shaftTop, shaftTop + Math.max(15, p.capHeightMm / 3), p.size * 1.25, MATERIALS.post));
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
  // the opening's trim („fajka”): the nose into the opening and the board on the slab, one wood
  for (const t of built.openingTrim?.pieces || []) {
    for (const [part, x] of [['nose', t.nose], ['board', t.board]]) treads.add(Object.assign(new THREE.Mesh(prismGeometry(x.outline, x.bottomZ, x.topZ), wood()), { name: `OpeningTrim-${t.edge}-${part}`, userData: { geometrySourceId: `cladding:${t.id}`, grainDirection: grainOf(t) } }));
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
    // (a stepped skirting: one mesh per piece — a vertical piece's grain up)
    for (const part of b.parts || [null]) {
      const mesh = new THREE.Mesh(planeBoardGeometry(part ? { ...b, polygon: part.polygon } : b), MATERIALS.stringer);
      mesh.name = part ? `${b.kind}-${b.id}-${part.id}` : `${b.kind}-${b.id}`;
      mesh.userData = { geometrySourceId: `cladding:${b.id}${part ? `:${part.id}` : ''}`, grainDirection: part?.part === 'vertical' ? [0, 1, 0] : [b.dir.x, 0, -b.dir.y] };
      finish.add(mesh);
    }
  }
  root.add(finish);
  const railing = new THREE.Group();
  railing.name = 'Railing';
  for (const s of built.balustrade?.sections || []) {
    for (let k = 1; k < s.handrail.length; k++) railing.add(Object.assign(beam(s.handrail[k - 1], s.handrail[k], config.handrailWidthMm, config.handrailHeightMm, MATERIALS.railing), { name: `Handrail-${s.id}-${k}` }));
    for (const b of s.balusters) {
      // a round baluster (toczona) or a square one
      if (b.shape === 'round') {
        const g = new THREE.CylinderGeometry(b.size / 2, b.size / 2, b.topZ - b.bottomZ, 16);
        g.translate(b.at.x, (b.bottomZ + b.topZ) / 2, -b.at.y);
        railing.add(Object.assign(new THREE.Mesh(g, MATERIALS.baluster), { name: 'Baluster' }));
      } else railing.add(Object.assign(column(b.at, b.bottomZ, b.topZ, b.size, MATERIALS.baluster), { name: 'Baluster' }));
    }
    for (const p of s.posts) railing.add(decorativePost(p));
    // glass panes (see-through, the tint) and, on the concrete's side, their point fixings
    const tint = GLASS_TINTS[config.glassTint] || GLASS_TINTS.clear;
    const glass = new THREE.MeshStandardMaterial({ color: tint.color, transparent: true, opacity: tint.opacity, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    for (const pane of s.panes || []) {
      const mesh = new THREE.Mesh(planeBoardGeometry(pane), glass);
      mesh.name = `Glass-${s.id}`;
      mesh.renderOrder = 3;
      railing.add(mesh);
      // glass between posts: a clamp on the post's face reaching over the pane's edge (picture sizes, as the
      // self-supporting renderer: 30 mm grip, 60 high, the pane + 16 thick)
      for (const c of pane.clamps || []) {
        const grip = c.postFaceS < c.s ? 30 : -30;
        const t0 = c.postFaceS;
        const t1 = c.s + grip;
        const mid = (t0 + t1) / 2;
        const g = new THREE.BoxGeometry(Math.abs(t1 - t0), 60, pane.thicknessMm + 16);
        g.rotateY(Math.atan2(pane.dir.y, pane.dir.x));
        const cx = pane.origin.x + pane.dir.x * mid + pane.normal.x * (pane.thicknessMm / 2);
        const cy = pane.origin.y + pane.dir.y * mid + pane.normal.y * (pane.thicknessMm / 2);
        g.translate(cx, c.z, -cy);
        railing.add(Object.assign(new THREE.Mesh(g, steelFixing), { name: 'GlassClamp' }));
      }
      if (s.infill === 'glass-side') {
        const zs = pane.polygon.map((p) => p.z);
        const z = Math.min(...zs) + config.glassOverlapMm / 2;
        const sMin = Math.min(...pane.polygon.map((p) => p.s));
        const sMax = Math.max(...pane.polygon.map((p) => p.s));
        for (let k = 0; k < config.glassFixingsPerPane; k++) {
          const sk = sMin + ((k + 0.5) * (sMax - sMin)) / config.glassFixingsPerPane;
          const c = { x: pane.origin.x + pane.dir.x * sk + pane.normal.x * pane.thicknessMm / 2, y: pane.origin.y + pane.dir.y * sk + pane.normal.y * pane.thicknessMm / 2 };
          const g = new THREE.CylinderGeometry(15, 15, pane.thicknessMm + 40, 12);
          g.rotateX(Math.PI / 2);
          g.rotateY(Math.atan2(pane.normal.y, -pane.normal.x) + Math.PI / 2);
          g.translate(c.x, z, -c.y);
          railing.add(Object.assign(new THREE.Mesh(g, steelFixing), { name: 'GlassFixing' }));
        }
      }
    }
  }
  // the wall handrails (balustradeModel.js wallRail): the handrail, each bracket an arm off the wall under it + a stub
  // up to its underside and a round plate on the wall
  for (const w of built.balustrade?.wallRails || []) {
    for (let k = 1; k < w.handrail.length; k++) railing.add(Object.assign(beam(w.handrail[k - 1], w.handrail[k], config.handrailWidthMm, config.handrailHeightMm, MATERIALS.railing), { name: `WallRail-${w.id}-${k}` }));
    for (const b of w.brackets) {
      const armZ = b.z - 30;
      railing.add(Object.assign(beam({ ...b.wall, z: armZ }, { ...b.rail, z: armZ }, 12, 12, steelFixing), { name: 'WallRailBracket' }));
      railing.add(Object.assign(column(b.rail, armZ - 6, b.z, 12, steelFixing), { name: 'WallRailBracket' }));
      const plate = new THREE.CylinderGeometry(30, 30, 8, 20);
      plate.rotateZ(Math.PI / 2);
      plate.rotateY(Math.atan2(w.outward.y, w.outward.x));
      plate.translate(b.wall.x - w.outward.x * 4, armZ, -(b.wall.y - w.outward.y * 4));
      railing.add(Object.assign(new THREE.Mesh(plate, steelFixing), { name: 'WallRailBracket' }));
    }
  }
  root.add(railing);
  // the LED lighting (ledModel.js): a thin glowing band along every strip
  const leds = new THREE.Group();
  leds.name = 'LedLighting';
  for (const s of built.led?.strips || []) {
    for (let k = 1; k < s.points.length; k++) leds.add(Object.assign(beam(s.points[k - 1], s.points[k], s.kind === 'skirting' ? 3 : config.ledProfileWidthMm, s.kind === 'skirting' ? config.ledProfileWidthMm : 3, ledMaterial), { name: `Led-${s.id}` }));
  }
  root.add(leds);
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
  // (the pieces meeting round a turn: one folded wall each — sideWallBodies)
  for (const body of built.sideWallBodies || []) {
    const mesh = new THREE.Mesh(foldedWallGeometry(body), body.kind === 'wall-under' ? concreteWallMaterial : wallMaterial);
    mesh.name = `${body.kind}-${body.id}`;
    mesh.renderOrder = 2;
    room.add(mesh);
  }
  for (const w of built.sideWalls || []) {
    if (w.bodyId) continue;
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
