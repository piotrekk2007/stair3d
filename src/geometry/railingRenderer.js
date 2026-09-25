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

// One handrail piece: a straight prism from start to end, its profile's "up" kept as vertical as the slope
// allows (never rolled), positioned at the piece's midpoint.
function handrailPieceGeometry(piece, handrail) {
  const a = toWorld(piece.start);
  const b = toWorld(piece.end);
  const dir = b.clone().sub(a);
  const length = dir.length();
  dir.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const yAxis = up.clone().addScaledVector(dir, -up.dot(dir));
  if (yAxis.lengthSq() < 1e-9) yAxis.set(1, 0, 0);
  yAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(dir, yAxis);
  const geometry = profileGeometry(handrail.shape, handrail.widthMm, handrail.heightMm, length);
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(dir, yAxis, zAxis).setPosition(a.clone().add(b).multiplyScalar(0.5)));
  return geometry;
}

function balusterGeometry(baluster, shape, size) {
  const height = baluster.zTop - baluster.zBottom;
  const g = shape === 'round' ? new THREE.CylinderGeometry(size / 2, size / 2, height, ROUND_SEGMENTS) : new THREE.BoxGeometry(size, height, size);
  g.translate(baluster.position.x, baluster.zBottom + height / 2, -baluster.position.y);
  return g;
}

function mergedMesh(geometries, material, name, sourceId, sectionSide) {
  if (geometries.length === 0) return null;
  const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
  mesh.name = name;
  mesh.userData = traceability({ elementType: 'railing', stringerId: sectionSide, geometrySourceId: sourceId });
  return mesh;
}

/**
 * @param {import('./railingSolver.js').RailingModel} railingModel
 * @param {{ balusterShape:string, balusterSizeMm:number }} style  from config (a rendering choice, not geometry)
 * @param {THREE.Material} material  the handrail
 * @param {THREE.Material} [balusterMaterial]  the balusters (defaults to `material`). The section's end posts are ordinary PostModels
 *   (buildStaircase.js merges them into the post list), so postRenderer.js draws them, not this file.
 */
export function renderRailing(railingModel, style, material, balusterMaterial = material) {
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
    const balusters = mergedMesh(
      section.balusters.map((b) => balusterGeometry(b, style.balusterShape, style.balusterSizeMm)),
      balusterMaterial,
      `Railing_${section.id}_balusters`,
      `railing:${section.id}:balusters`,
      section.side
    );
    if (balusters) group.add(balusters);
  }
  return group;
}
