import * as THREE from 'three';
import { floorFinishes } from './floors.js';

const SLAB_MARGIN = 1500; // mm, wizualny margines płyty stropu wokół otworu

// `slabOutline` (plan frame): the slab's own outline — the stairwell room grown by its walls (stairwell.js
// stairwellWalls); without it the slab is the opening's box plus SLAB_MARGIN.
export function buildCeiling(ceilingFit, config, slabOutline = null) {
  const { ceilingThickness } = config;
  const { openMinX, openMaxX, openMinY, openMaxY, soffitZ, openingOutline } = ceilingFit;

  const slabMinX = openMinX - SLAB_MARGIN;
  const slabMaxX = openMaxX + SLAB_MARGIN;
  const slabMinY = openMinY - SLAB_MARGIN;
  const slabMaxY = openMaxY + SLAB_MARGIN;

  const shape = new THREE.Shape();
  const slab = slabOutline?.length >= 3 ? slabOutline : [{ x: slabMinX, y: slabMinY }, { x: slabMaxX, y: slabMinY }, { x: slabMaxX, y: slabMaxY }, { x: slabMinX, y: slabMaxY }];
  shape.moveTo(slab[0].x, slab[0].y);
  for (const p of slab.slice(1)) shape.lineTo(p.x, p.y);
  shape.closePath();

  // Otwór = obrys z deriveCeilingFit (prostokąt albo narysowany wielokąt — geometry/ceilingOpening.js).
  const outline = openingOutline && openingOutline.length >= 3
    ? openingOutline
    : [{ x: openMinX, y: openMinY }, { x: openMaxX, y: openMinY }, { x: openMaxX, y: openMaxY }, { x: openMinX, y: openMaxY }];
  const hole = new THREE.Path();
  hole.moveTo(outline[0].x, outline[0].y);
  for (const p of outline.slice(1)) hole.lineTo(p.x, p.y);
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
  // the top floor finish on the raw slab (geometry/floors.js), lighter: the same outline, up to the finished floor
  const top = floorFinishes(config).top;
  if (!(top > 0)) return mesh;
  const group = new THREE.Group();
  group.name = 'Ceiling';
  mesh.name = 'CeilingSlab';
  group.add(mesh);
  const finishGeo = new THREE.ExtrudeGeometry(shape, { depth: top, bevelEnabled: false });
  finishGeo.rotateX(-Math.PI / 2);
  finishGeo.translate(0, soffitZ + ceilingThickness, 0);
  const finish = new THREE.Mesh(finishGeo, new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.9, side: THREE.DoubleSide }));
  finish.name = 'CeilingFloorFinish';
  group.add(finish);
  return group;
}
