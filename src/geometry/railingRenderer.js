// THE ONLY Three.js mesh builder for the balustrade. Consumes a RailingModel (railingSolver.js) — it
// decides nothing: where a baluster stands, how long it is, where the handrail runs and where an end
// post goes were all decided by the solver. This file only turns those numbers into triangles.
//
// Per section: one mesh for the handrail pieces, one for all balusters (merged, so a stair with a few
// hundred balusters is still one draw call and exports like any other mesh).
// Plan (x, y, z-up) -> Three.js (x, y = z, z = -y), the same mapping as planToWorld().

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { traceability } from '../scene/traceability.js';
import { withWoodGrainUVs, textureOffsetFor } from '../scene/woodGrain.js';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { ROTULE_DIAMETER_MM } from './railingGlass.js';

const ROUND_SEGMENTS = 16;

function toWorld(p) {
  return new THREE.Vector3(p.x, p.z, -p.y);
}

// One handrail piece from start to end: its profile (square to its axis, never rolled — `up` is the vertical tilted
// into the axis' plane) swept along the axis and cut at each end by a plane given by the solver's cut there
// (railingSolver.js annotateCuts — the same cuts the workshop gets):
//  - 'post': PLUMB (vertical, square to the piece's plan direction) — it meets a post on the post's vertical face;
//  - 'join': the MITRE with the next / previous piece — the plane bisecting the two axes (normal = d₁ + d₂), so two
//    pieces of different pitch or plan direction meet face to face. (Both used to be plumb: at every pitch change
//    the steeper piece's taller plumb face stood out as a step — user report 2026-10-26.)
// A piece too steep for a plumb cut (the near-vertical stub of a winder's dusza) is cut square to its axis there.
const PLUMB_CUT_MAX_SLOPE = 5; // tan(~79°)
const MITRE_MIN_BISECTOR = 0.2; // |d₁ + d₂| below this (a near hairpin): square cuts instead
const JOIN_MATCH_MM = 0.5;

const v3 = (x, y, z) => ({ x, y, z });
const sub3 = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const add3 = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const mul3 = (a, k) => v3(a.x * k, a.y * k, a.z * k);
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const unit3 = (a) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};

// The plane normal of a piece's end cut (plan coordinates, z up). `dir` = this piece's unit axis, `other` = the
// neighbour's (null at a post).
function cutNormal(dir, other) {
  if (other) {
    const bis = add3(dir, other);
    if (Math.hypot(bis.x, bis.y, bis.z) >= MITRE_MIN_BISECTOR) return unit3(bis);
    return dir;
  }
  const plan = Math.hypot(dir.x, dir.y);
  if (plan > 1e-9 && Math.abs(dir.z) / plan <= PLUMB_CUT_MAX_SLOPE) return v3(dir.x / plan, dir.y / plan, 0);
  return dir;
}

// The profile's outline round the axis: [{u (across), w (up)}], counter-clockwise looking along the axis.
function profileOutline(shape, width, height) {
  if (shape === 'round') return Array.from({ length: ROUND_SEGMENTS }, (_, k) => ({ u: (width / 2) * Math.cos((2 * Math.PI * k) / ROUND_SEGMENTS), w: (width / 2) * Math.sin((2 * Math.PI * k) / ROUND_SEGMENTS) }));
  return [
    { u: -width / 2, w: -height / 2 },
    { u: width / 2, w: -height / 2 },
    { u: width / 2, w: height / 2 },
    { u: -width / 2, w: height / 2 },
  ];
}

/**
 * The swept, end-cut handrail piece in PLAN coordinates (pure numbers — the renderer turns them into a mesh): the
 * profile corners at the start and at the end cut, and the two cut normals. Exported for the tests.
 * @returns {{start:{x,y,z}[], end:{x,y,z}[], startNormal:{x,y,z}, endNormal:{x,y,z}, round:boolean, radial:{x,y,z}[]}|null}
 */
export function handrailPieceSolid(piece, handrail, prev = null, next = null) {
  const a = piece.start;
  const b = piece.end;
  const axis = sub3(b, a);
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) return null;
  const d = unit3(axis);
  // the profile's up: the vertical tilted into the axis' plane; across: horizontal
  let up = sub3(v3(0, 0, 1), mul3(d, d.z));
  if (Math.hypot(up.x, up.y, up.z) < 1e-9) up = v3(1, 0, 0);
  up = unit3(up);
  const across = unit3(cross3(d, up));
  const dirOf = (p) => unit3(sub3(p.end, p.start));
  const ns = cutNormal(d, prev ? dirOf(prev) : null);
  const ne = cutNormal(d, next ? dirOf(next) : null);
  const outline = profileOutline(handrail.shape, handrail.widthMm, handrail.heightMm);
  const offsets = outline.map((p) => add3(mul3(across, p.u), mul3(up, p.w)));
  // each corner's line a + o + t·d, cut by the plane through the piece's end point with that end's normal
  const onPlane = (origin, o, n) => add3(add3(origin, o), mul3(d, -dot3(o, n) / dot3(d, n)));
  return {
    start: offsets.map((o) => onPlane(a, o, ns)),
    end: offsets.map((o) => onPlane(b, o, ne)),
    startNormal: mul3(ns, -1),
    endNormal: ne,
    round: handrail.shape === 'round',
    radial: offsets.map(unit3),
  };
}

// The neighbours a piece is mitred to: the pieces of the same handrail joined to it (the solver's 'join' cuts — or,
// without cut data, sharing the end point).
function joinedNeighbours(pieces, i) {
  const piece = pieces[i];
  const meets = (p, q) => p && Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= JOIN_MATCH_MM;
  const prevKind = piece.startCut?.kind;
  const nextKind = piece.endCut?.kind;
  const prev = prevKind === 'post' ? null : pieces.find((p, k) => k !== i && meets(p.end, piece.start)) || null;
  const next = nextKind === 'post' ? null : pieces.find((p, k) => k !== i && meets(p.start, piece.end)) || null;
  return { prev, next };
}

// A plan-coordinate solid → a non-indexed BufferGeometry (world mapping x, z, −y), each triangle wound to its normal.
function solidGeometry(solid) {
  const pos = [];
  const nor = [];
  const W = (p) => [p.x, p.z, -p.y];
  const tri = (p, q, r, np, nq, nr, face) => {
    const n = cross3(sub3(q, p), sub3(r, p));
    if (dot3(n, face) < 0) [q, r, nq, nr] = [r, q, nr, nq];
    for (const [v, vn] of [[p, np], [q, nq], [r, nr]]) {
      pos.push(...W(v));
      nor.push(...W(vn));
    }
  };
  const n = solid.start.length;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const [s0, s1, e0, e1] = [solid.start[k], solid.start[k2], solid.end[k], solid.end[k2]];
    const face = unit3(add3(solid.radial[k], solid.radial[k2]));
    const [n0, n1] = solid.round ? [solid.radial[k], solid.radial[k2]] : [face, face];
    tri(s0, s1, e1, n0, n1, n1, face);
    tri(s0, e1, e0, n0, n1, n0, face);
  }
  for (const [ring, normal] of [[solid.start, solid.startNormal], [solid.end, solid.endNormal]]) {
    for (let k = 1; k < n - 1; k++) tri(ring[0], ring[k], ring[k + 1], normal, normal, normal, normal);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function handrailPieceGeometry(pieces, i, handrail) {
  const { prev, next } = joinedNeighbours(pieces, i);
  const solid = handrailPieceSolid(pieces[i], handrail, prev, next);
  return solid ? solidGeometry(solid) : null;
}

// A baluster: its section from zBottom to zTop at its axis, the two ends cut to the solver's angles (railingSolver.js
// topCutDeg / bottomCutDeg, rising along `cutDir` / `bottomCutDir`) — the bottom flush with a housed wanga's sloping top edge, the top
// under the handrail. Without cut data: square ends.
function balusterGeometry(baluster, shape, size) {
  const height = baluster.zTop - baluster.zBottom;
  const g = shape === 'round' ? new THREE.CylinderGeometry(size / 2, size / 2, height, ROUND_SEGMENTS, 1) : new THREE.BoxGeometry(size, height, size);
  g.translate(0, height / 2, 0);
  const dir = baluster.cutDir;
  const dirB = baluster.bottomCutDir || dir;
  const tTop = Math.tan(((baluster.topCutDeg || 0) * Math.PI) / 180);
  const tBottom = Math.tan(((baluster.bottomCutDeg || 0) * Math.PI) / 180);
  if (dir && (tTop || tBottom)) {
    // local x / z = plan x / −y offsets from the axis; the end vertices move by tan · (offset along the cut's direction)
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y > height - 1e-6) pos.setY(k, y + tTop * (pos.getX(k) * dir.x - pos.getZ(k) * dir.y));
      else if (y < 1e-6) pos.setY(k, y + tBottom * (pos.getX(k) * dirB.x - pos.getZ(k) * dirB.y));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }
  g.translate(baluster.position.x, baluster.zBottom, -baluster.position.y);
  return g;
}

// One glass pane (railingGlass.js): its outline (t along the pane, z up) extruded by the glass thickness, centred on
// the glass plane.
function glassPaneGeometry(pane) {
  const n = { x: -pane.dir.y, y: pane.dir.x };
  const h = pane.thicknessMm / 2;
  const toW = (u, v) => toWorld({ x: pane.start.x + pane.dir.x * u - n.x * h, y: pane.start.y + pane.dir.y * u - n.y * h, z: v });
  const extrude = new THREE.Vector3(n.x, 0, -n.y);
  return buildPrism(pane.outline.map((p) => ({ u: p.t, v: p.z })), toW, extrude, pane.thicknessMm);
}

// A fixing: a rotule = a Ø30 cylinder (user decision) through the glass towards the wanga (the stand-off); a clamp =
// a block on the post face reaching over the pane's edge (it is always fixed to the post). Clamp sizes are for the
// picture only.
const CLAMP_SIZE_MM = { grip: 30, up: 60 };
function fixingGeometry(pane, f, standoffMm) {
  const n = { x: -pane.dir.y, y: pane.dir.x };
  const at = { x: pane.start.x + pane.dir.x * f.t, y: pane.start.y + pane.dir.y * f.t, z: f.z };
  if (f.kind === 'rotule') {
    const length = standoffMm + pane.thicknessMm + 10;
    const g = new THREE.CylinderGeometry(ROTULE_DIAMETER_MM / 2, ROTULE_DIAMETER_MM / 2, length, 20);
    // axis Y -> the pane normal; from outside the glass to the wanga's face (the normal points into the stair)
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, 0, -n.y))));
    const c = { x: at.x + n.x * (length / 2 - pane.thicknessMm / 2 - 5), y: at.y + n.y * (length / 2 - pane.thicknessMm / 2 - 5), z: at.z };
    g.translate(c.x, c.z, -c.y);
    return g;
  }
  // from the post face over the pane's edge: [postFaceT .. t ± grip]
  const t0 = f.postFaceT ?? f.t;
  const t1 = f.t + (f.postFaceT !== undefined && f.postFaceT > f.t ? -CLAMP_SIZE_MM.grip : CLAMP_SIZE_MM.grip);
  const along = Math.abs(t1 - t0);
  const mid = (t0 + t1) / 2;
  const c = { x: pane.start.x + pane.dir.x * mid, y: pane.start.y + pane.dir.y * mid, z: f.z };
  const g = new THREE.BoxGeometry(along, CLAMP_SIZE_MM.up, pane.thicknessMm + 16);
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(pane.dir.y, pane.dir.x)));
  g.translate(c.x, c.z, -c.y);
  return g;
}

function mergedMesh(geometries, material, name, sourceId, sectionSide) {
  if (geometries.length === 0) return null;
  // Każdy kawałek (tralka, odcinek poręczy) dostaje własny kierunek włókien PRZED scaleniem — po scaleniu
  // najdłuższa oś całej siatki byłaby wzdłuż biegu, a tralki mają włókna pionowo.
  const mesh = new THREE.Mesh(mergeGeometries(geometries.map((g, i) => withWoodGrainUVs(g, { offset: textureOffsetFor(`${sourceId}:${i}`) }))), material);
  mesh.geometry.userData.woodGrainUV = true;
  mesh.name = name;
  mesh.userData = traceability({ elementType: 'railing', stringerId: sectionSide, geometrySourceId: sourceId });
  return mesh;
}

// One wall bracket: a 12 mm stem down from the handrail's underside, then an arm across to the wall (presentation
// sizes — the real fitting is chosen in the workshop).
const BRACKET_BAR_MM = 12;
const BRACKET_DROP_MM = 50;
function wallBracketGeometries(b) {
  const low = b.z - BRACKET_DROP_MM;
  const stem = new THREE.BoxGeometry(BRACKET_BAR_MM, BRACKET_DROP_MM, BRACKET_BAR_MM);
  stem.translate(0, BRACKET_DROP_MM / 2, 0);
  const at = planToWorld(b.position.x, b.position.y, low);
  stem.translate(at.x, at.y, at.z);
  const dx = b.wall.x - b.position.x;
  const dy = b.wall.y - b.position.y;
  const len = Math.hypot(dx, dy) || 1;
  const arm = new THREE.BoxGeometry(len, BRACKET_BAR_MM, BRACKET_BAR_MM);
  arm.rotateY(Math.atan2(dy, dx)); // plan (dx, dy) is world (dx, -dy): a turn by atan2(dy, dx) about +Y
  const mid = planToWorld((b.position.x + b.wall.x) / 2, (b.position.y + b.wall.y) / 2, low);
  arm.translate(mid.x, mid.y, mid.z);
  return [stem, arm];
}

/**
 * @param {import('./railingSolver.js').RailingModel} railingModel
 * @param {{ balusterShape:string, balusterSizeMm:number }} style  from config (a rendering choice, not geometry)
 * @param {THREE.Material} material  the handrail
 * @param {THREE.Material} [balusterMaterial]  the balusters (defaults to `material`). The section's end posts are ordinary PostModels
 *   (buildStaircase.js merges them into the post list), so postRenderer.js draws them, not this file.
 */
export function renderRailing(railingModel, style, material, balusterMaterial = material, { glassMaterial = null, metalMaterial = null, glassStandoffMm = 0 } = {}) {
  const group = new THREE.Group();
  group.name = 'Railing';
  for (const section of railingModel.sections) {
    if (!section.valid) continue;
    const handrail = mergedMesh(
      section.handrail.pieces.map((_, i, all) => handrailPieceGeometry(all, i, section.handrail)).filter(Boolean),
      material,
      `Railing_${section.id}_handrail`,
      `railing:${section.id}:handrail`,
      section.side
    );
    if (handrail) group.add(handrail);
    if (section.baseRail?.pieces?.length) {
      const baseRail = mergedMesh(
        section.baseRail.pieces.map((_, i, all) => handrailPieceGeometry(all, i, section.baseRail)).filter(Boolean),
        material,
        `Railing_${section.id}_baserail`,
        `railing:${section.id}:baserail`,
        section.side
      );
      if (baseRail) group.add(baseRail);
    }
    // wall handrail brackets (railingSolver.js buildWallRail): a short stem under the handrail and an arm to the wall
    const brackets = section.runs.filter((r) => r.wallRail).flatMap((r) => r.brackets || []);
    if (brackets.length && metalMaterial) {
      const mesh = new THREE.Mesh(mergeGeometries(brackets.flatMap(wallBracketGeometries)), metalMaterial);
      mesh.name = `Railing_${section.id}_wallBrackets`;
      mesh.geometry.userData.woodGrainUV = true;
      mesh.userData = traceability({ elementType: 'railing', stringerId: section.side, geometrySourceId: `railing:${section.id}:wall-brackets` });
      group.add(mesh);
    }
    const balusters = mergedMesh(
      section.balusters.map((b) => balusterGeometry(b, style.balusterShape, style.balusterSizeMm)),
      balusterMaterial,
      `Railing_${section.id}_balusters`,
      `railing:${section.id}:balusters`,
      section.side
    );
    if (balusters) group.add(balusters);
    if (section.glassPanes?.length && glassMaterial) {
      // glass: no wood grain, no shadow (a see-through pane would cast a solid one)
      const glass = new THREE.Mesh(mergeGeometries(section.glassPanes.map(glassPaneGeometry)), glassMaterial);
      glass.name = `Railing_${section.id}_glass`;
      glass.geometry.userData.woodGrainUV = true;
      glass.userData = traceability({ elementType: 'railing', stringerId: section.side, geometrySourceId: `railing:${section.id}:glass` });
      glass.renderOrder = 2;
      group.add(glass);
      const fixings = section.glassPanes.flatMap((pane) => pane.fixings.map((f) => fixingGeometry(pane, f, glassStandoffMm)));
      if (fixings.length && metalMaterial) {
        const metal = new THREE.Mesh(mergeGeometries(fixings), metalMaterial);
        metal.name = `Railing_${section.id}_glassFixings`;
        metal.geometry.userData.woodGrainUV = true;
        metal.userData = traceability({ elementType: 'railing', stringerId: section.side, geometrySourceId: `railing:${section.id}:glassFixings` });
        group.add(metal);
      }
    }
  }
  return group;
}
