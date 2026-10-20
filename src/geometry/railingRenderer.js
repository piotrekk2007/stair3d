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

function profileGeometry(shape, width, height, length) {
  if (shape === 'round') {
    const g = new THREE.CylinderGeometry(width / 2, width / 2, length, ROUND_SEGMENTS);
    g.rotateZ(-Math.PI / 2); // axis Y -> X
    return g;
  }
  return new THREE.BoxGeometry(length, height, width);
}

// One handrail piece from start to end, its profile never rolled. Its two END FACES ARE PLUMB (vertical, square to the
// piece's plan direction): a handrail meets a post on the post's vertical face, and two pieces of one run meet on a
// plumb cut too (railingSolver.js annotateCuts gives the same cuts to the workshop). So the piece is a profile laid
// along its PLAN length and sheared up by its slope — its vertical size 1/cos(pitch) of the profile's, so that it is
// the profile's own height square to its axis. (A box cut square to its own axis left a wedge-shaped gap at a post.)
// A piece too steep to shear (the near-vertical stub of a winder's dusza) keeps the plain square-ended prism.
const PLUMB_CUT_MAX_SLOPE = 5; // tan(~79°)
function handrailPieceGeometry(piece, handrail) {
  const a = toWorld(piece.start);
  const b = toWorld(piece.end);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const planLength = Math.hypot(b.x - a.x, b.z - a.z);
  const rise = b.y - a.y;
  if (planLength > 1e-6 && Math.abs(rise) / planLength <= PLUMB_CUT_MAX_SLOPE) {
    const slope = rise / planLength;
    const along = new THREE.Vector3((b.x - a.x) / planLength, 0, (b.z - a.z) / planLength);
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(along, up);
    const geometry = profileGeometry(handrail.shape, handrail.widthMm, handrail.heightMm * Math.hypot(1, slope), planLength);
    // shear: local y += slope · local x (keeps every x = const face vertical), then into the piece's plan frame
    const shear = new THREE.Matrix4().set(1, 0, 0, 0, slope, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    geometry.applyMatrix4(new THREE.Matrix4().makeBasis(along, up, across).setPosition(mid).multiply(shear));
    geometry.computeVertexNormals();
    return geometry;
  }
  const dir = b.clone().sub(a);
  const length = dir.length();
  dir.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const yAxis = up.clone().addScaledVector(dir, -up.dot(dir));
  if (yAxis.lengthSq() < 1e-9) yAxis.set(1, 0, 0);
  yAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(dir, yAxis);
  const geometry = profileGeometry(handrail.shape, handrail.widthMm, handrail.heightMm, length);
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(dir, yAxis, zAxis).setPosition(mid));
  return geometry;
}

function balusterGeometry(baluster, shape, size) {
  const height = baluster.zTop - baluster.zBottom;
  const g = shape === 'round' ? new THREE.CylinderGeometry(size / 2, size / 2, height, ROUND_SEGMENTS) : new THREE.BoxGeometry(size, height, size);
  g.translate(baluster.position.x, baluster.zBottom + height / 2, -baluster.position.y);
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
      section.handrail.pieces.map((piece) => handrailPieceGeometry(piece, section.handrail)),
      material,
      `Railing_${section.id}_handrail`,
      `railing:${section.id}:handrail`,
      section.side
    );
    if (handrail) group.add(handrail);
    if (section.baseRail?.pieces?.length) {
      const baseRail = mergedMesh(
        section.baseRail.pieces.map((piece) => handrailPieceGeometry(piece, section.baseRail)),
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
