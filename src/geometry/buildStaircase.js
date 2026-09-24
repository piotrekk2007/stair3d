import * as THREE from 'three';
import { buildPlanLayout } from './planLayout.js';
import { buildTreadModels } from './treadSolver.js';
import { renderTreads } from './treadRenderer.js';
import { buildRiserModels } from './riserSolver.js';
import { renderRisers } from './riserRenderer.js';
import { buildStringerModelsForFlight } from './stringerSolver.js';
import { buildStringerConstructionGeometry } from './stringerConstructionGeometry.js';
import { renderStringers } from './stringerRenderer.js';
import { buildPostModels, buildAllPostModels } from './postSolver.js';
import { renderPosts } from './postRenderer.js';
import { buildCeiling } from './ceilingGeometry.js';
import { deriveStairData, deriveCeilingFit } from '../config/schema.js';
import { applyAppearanceToMaterials } from '../scene/appearance.js';

const treadMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.75, metalness: 0.02, side: THREE.DoubleSide });
// Jeden wspólny materiał dla wang wewn.+zewn. — dzięki temu "Zaznacz wg materiału" w SketchUp
// (działa niezależnie od tego, czy import zachował hierarchię grup z DAE) chwyta OD RAZU
// całe wangi, a nie tylko jedną stronę.
const stringerMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.7, metalness: 0.02, side: THREE.DoubleSide });
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.65, metalness: 0.02 });
const riserBoardMaterial = new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide });

// Kolory prezentacji (scene/appearance.js) ustawiane na tych wspólnych materiałach; kolejny rebuild()
// odtwarza zależne od nich materiały pochodne (np. znacznik gniazda w wandze).
export function setAppearance(appearance) {
  applyAppearanceToMaterials({ tread: treadMaterial, riser: riserBoardMaterial, stringer: stringerMaterial, post: postMaterial }, appearance);
}

// ORKIESTRATOR — żadna geometria nie jest tu ROZWIĄZYWANA, tylko SKŁADANA. Kolejność:
//
//   config -> buildPlanLayout() -----------------------------------------------[MODEL 2D]
//          -> buildTreadModels() / buildRiserModels() / buildStringerModelsForFlight()
//             / buildPostModels() ----------------------------------------[MODELE, bez THREE]
//          -> renderTreads() / renderRisers() / renderStringers() / renderPosts() -[RENDER]
//
// Każdy `build*Models()` jest czystą funkcją (planLayout, config) -> dane; każdy `render*()`
// przyjmuje TYLKO już gotowy model i zwraca THREE.Group — żaden renderer nie woła solvera
// sam, i żaden solver nie zagląda do Three.js. Patrz docs/architecture/CONSOLIDATION.md.
export function buildStaircase(config) {
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);

  const treadModels = buildTreadModels(planLayout, fullConfig);
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  // Construction geometry (the real, continuous board contour — see
  // stringerConstructionGeometry.js) is a SEPARATE solver step on top of the analytical
  // StringerModel, never merged into it and never computed inside the renderer.
  const stringerConstruction = {
    outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
    inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
  };
  const postModels = buildPostModels(planLayout, fullConfig);
  // Also the removed ones (flagged), for the UI — a removed post is drawn as a ghost and can be restored.
  const allPostModels = buildAllPostModels(planLayout, fullConfig);

  const root = new THREE.Group();
  root.name = 'Staircase';

  root.add(renderTreads(treadModels, treadMaterial));
  root.add(renderStringers(stringerModels.outer, stringerConstruction.outer, stringerMaterial, 'StringerOuter'));
  root.add(renderStringers(stringerModels.inner, stringerConstruction.inner, stringerMaterial, 'StringerInner'));

  const postsGroup = renderPosts(postModels, postMaterial);
  root.add(postsGroup);

  if (config.hasRiserBoards) {
    root.add(renderRisers(riserModels, riserBoardMaterial));
  }

  const ceilingFit = deriveCeilingFit(config, planLayout, derived.riserHeight);
  const ceilingMesh = buildCeiling(ceilingFit, fullConfig);

  // root = tylko elementy schodów (do eksportu); strop jest osobno, tylko do wizualizacji.
  // treadModels/riserModels/stringerModels/postModels są tu już policzone raz — zwracamy je też
  // jawnie, żeby np. src/validator/StaircaseValidator.js (validateModels) albo
  // src/takeoff/materialTakeoff.js (computeMaterialTakeoff) mogły ocenić/zestawić DOKŁADNIE tę
  // geometrię bez ponownego jej liczenia (patrz main.js/rebuild()) — nigdy nie licz jej drugi
  // raz tylko po to, żeby ją zwalidować albo zestawić materiałowo.
  return { root, ceilingMesh, planLayout, derived, ceilingFit, fullConfig, treadModels, riserModels, stringerModels, stringerConstruction, postModels, allPostModels };
}
