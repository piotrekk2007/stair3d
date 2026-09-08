import * as THREE from 'three';

const SLAB_MARGIN = 1500; // mm, wizualny margines płyty stropu wokół otworu

export function buildCeiling(ceilingFit, config) {
  const { ceilingThickness } = config;
  const { openMinX, openMaxX, openMinY, openMaxY, soffitZ } = ceilingFit;

  const slabMinX = openMinX - SLAB_MARGIN;
  const slabMaxX = openMaxX + SLAB_MARGIN;
  const slabMinY = openMinY - SLAB_MARGIN;
  const slabMaxY = openMaxY + SLAB_MARGIN;

  const shape = new THREE.Shape();
  shape.moveTo(slabMinX, slabMinY);
  shape.lineTo(slabMaxX, slabMinY);
  shape.lineTo(slabMaxX, slabMaxY);
  shape.lineTo(slabMinX, slabMaxY);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(openMinX, openMinY);
  hole.lineTo(openMaxX, openMinY);
  hole.lineTo(openMaxX, openMaxY);
  hole.lineTo(openMinX, openMaxY);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: ceilingThickness, bevelEnabled: false });
  // Shape leży w płaszczyźnie (planX, planY), extrude wzdłuż lokalnego +Z.
  // rotateX(-90°) mapuje (x,y,z) -> (x,z,-y): local z (extrude) staje się światową wysokością,
  // local y (planY) staje się -world Z — zgodnie z konwencją planToWorld używaną w całym projekcie.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, soffitZ, 0);

  const material = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.95, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Ceiling';
  return mesh;
}
