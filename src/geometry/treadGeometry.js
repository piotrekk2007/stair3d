import * as THREE from 'three';
import { buildPrism, planToWorld } from './geometryUtils.js';
import { sameAs, shiftRearEdge } from './nosingUtils.js';

function applyNosing(tread, nosing) {
  const { outline, rearRiser } = tread;
  if (nosing <= 0) return outline;
  const [inner0, outer0] = rearRiser;
  const { newInner0, newOuter0 } = shiftRearEdge(tread, nosing);

  return outline.map((p) => {
    if (sameAs(p, inner0)) return newInner0;
    if (sameAs(p, outer0)) return newOuter0;
    return p;
  });
}

export function buildTreadMesh(tread, elevation, config) {
  const { treadThickness, nosing } = config;
  // Podest to płaska płyta konstrukcyjna — bez wysuniętego noska jak przy zwykłym stopniu.
  const effectiveNosing = tread.type === 'landing' ? 0 : nosing;
  const outline = applyNosing(tread, effectiveNosing);

  const pts2D = outline.map((p) => ({ u: p.x, v: p.y }));
  const geometry = buildPrism(
    pts2D,
    (u, v) => planToWorld(u, v, elevation),
    new THREE.Vector3(0, 1, 0),
    treadThickness
  );
  return geometry;
}
