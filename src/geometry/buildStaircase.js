import * as THREE from 'three';
import { buildPlanLayout } from './planLayout.js';
import { buildTreadMesh } from './treadGeometry.js';
import { buildStringerGeometries } from './stringerGeometry.js';
import { buildPosts } from './postGeometry.js';
import { buildCeiling } from './ceilingGeometry.js';
import { buildRiserBoards } from './riserGeometry.js';
import { deriveStairData, deriveCeilingFit } from '../config/schema.js';

const treadMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.75, metalness: 0.02, side: THREE.DoubleSide });
// Jeden wspólny materiał dla wang wewn.+zewn. — dzięki temu "Zaznacz wg materiału" w SketchUp
// (działa niezależnie od tego, czy import zachował hierarchię grup z DAE) chwyta OD RAZU
// całe wangi, a nie tylko jedną stronę.
const stringerMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.7, metalness: 0.02, side: THREE.DoubleSide });
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.65, metalness: 0.02 });
const riserBoardMaterial = new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide });

export function buildStaircase(config) {
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);

  const root = new THREE.Group();
  root.name = 'Staircase';

  const treadsGroup = new THREE.Group();
  treadsGroup.name = 'Treads';
  for (const tread of planLayout.treads) {
    // Stopień o indeksie i leży NA szczycie i-tego podstopnia: góra stopnia = (i+1)*h.
    const elevation = (tread.index + 1) * derived.riserHeight - fullConfig.treadThickness;
    const geometry = buildTreadMesh(tread, elevation, fullConfig);
    const mesh = new THREE.Mesh(geometry, treadMaterial);
    mesh.name = `Tread_${tread.index}_${tread.type}`;
    treadsGroup.add(mesh);
  }
  root.add(treadsGroup);

  const stringerOuterGroup = new THREE.Group();
  stringerOuterGroup.name = 'StringerOuter';
  buildStringerGeometries(planLayout, fullConfig, 'outer').forEach((geo, i) => {
    const mesh = new THREE.Mesh(geo, stringerMaterial);
    mesh.name = `StringerOuter_${i}`;
    stringerOuterGroup.add(mesh);
  });
  root.add(stringerOuterGroup);

  const stringerInnerGroup = new THREE.Group();
  stringerInnerGroup.name = 'StringerInner';
  buildStringerGeometries(planLayout, fullConfig, 'inner').forEach((geo, i) => {
    const mesh = new THREE.Mesh(geo, stringerMaterial);
    mesh.name = `StringerInner_${i}`;
    stringerInnerGroup.add(mesh);
  });
  root.add(stringerInnerGroup);

  const postsGroup = buildPosts(planLayout, fullConfig);
  for (const mesh of postsGroup.children) mesh.material = postMaterial;
  root.add(postsGroup);

  if (config.hasRiserBoards) {
    const riserGroup = new THREE.Group();
    riserGroup.name = 'RiserBoards';
    buildRiserBoards(planLayout, fullConfig).forEach((geo, i) => {
      const mesh = new THREE.Mesh(geo, riserBoardMaterial);
      mesh.name = `RiserBoard_${i}`;
      riserGroup.add(mesh);
    });
    root.add(riserGroup);
  }

  const ceilingFit = deriveCeilingFit(config, planLayout, derived.riserHeight);
  const ceilingMesh = buildCeiling(ceilingFit, fullConfig);

  // root = tylko elementy schodów (do eksportu); strop jest osobno, tylko do wizualizacji.
  return { root, ceilingMesh, planLayout, derived, ceilingFit };
}
