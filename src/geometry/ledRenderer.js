// The LED strips in 3D (ledModel.js): each strip a glowing band as wide as its profile, lying in its groove's face
// (0.5 mm proud, so it shows), facing the way it lights. Extrudes what it is given; the group 'LedLighting' is a layer
// of the stair root (3D HUD „LED”, photos, the client's model).

import * as THREE from 'three';
import { traceability } from '../scene/traceability.js';

const PROUD_MM = 0.5;

// The glow: a band up to this many times the profile's width round the strip (never past its face's edge — the strip's
// `roomMm`), a little prouder (drawn over the wood).
const GLOW_WIDTH_FACTOR = 5;
const GLOW_PROUD_MM = 1;

function bandGeometry(points, n, half, proud) {
  const pos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    // across the band: the axis × the face normal (in the face)
    let w = { x: d.y * n.z - d.z * n.y, y: d.z * n.x - d.x * n.z, z: d.x * n.y - d.y * n.x };
    const wl = Math.hypot(w.x, w.y, w.z) || 1;
    w = { x: (w.x / wl) * half, y: (w.y / wl) * half, z: (w.z / wl) * half };
    const corner = (p, k) => [p.x + w.x * k + n.x * proud, p.z + w.z * k + n.z * proud, -(p.y + w.y * k + n.y * proud)];
    pos.push(...corner(a, -1), ...corner(b, -1), ...corner(b, 1), ...corner(a, -1), ...corner(b, 1), ...corner(a, 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** @returns {THREE.Group|null} */
export function renderLed(led, material, glowMaterial = null) {
  if (!led?.strips?.length) return null;
  const group = new THREE.Group();
  group.name = 'LedLighting';
  const half = (led.profile?.widthMm || 17) / 2;
  for (const s of led.strips) {
    const trace = traceability({ elementType: 'led', stepId: s.kind === 'tread' ? s.elementId : null, stringerId: s.side ?? null, geometrySourceId: `led:${s.id}` });
    const mesh = new THREE.Mesh(bandGeometry(s.points, s.faceNormal, half, PROUD_MM), material);
    mesh.name = s.id;
    mesh.userData = trace;
    group.add(mesh);
    if (glowMaterial) {
      const glow = new THREE.Mesh(bandGeometry(s.points, s.faceNormal, Math.max(half, Math.min(half * GLOW_WIDTH_FACTOR, s.roomMm ?? half)), GLOW_PROUD_MM), glowMaterial);
      glow.name = `${s.id}-glow`;
      glow.userData = trace;
      glow.renderOrder = 3;
      group.add(glow);
    }
  }
  return group;
}
