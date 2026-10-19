import * as THREE from 'three';
import { buildPlanLayout } from './planLayout.js';
import { buildTreadModels } from './treadSolver.js';
import { renderTreads } from './treadRenderer.js';
import { buildRiserModels } from './riserSolver.js';
import { renderRisers } from './riserRenderer.js';
import { buildStringerModelsForFlight } from './stringerSolver.js';
import { buildStringerConstructionGeometry } from './stringerConstructionGeometry.js';
import { renderStringers } from './stringerRenderer.js';
import { buildPostModels, buildAllPostModels, raisePostsToHandrail } from './postSolver.js';
import { renderPosts } from './postRenderer.js';
import { buildJointModel } from './jointSolver.js';
import { buildRailingModel, endNewelOntoSlab } from './railingSolver.js';
import { renderRailing } from './railingRenderer.js';
import { GLASS_TINTS } from './railingGlass.js';
import { isCantilever, cantileverConfig, buildCantileverBox } from './cantileverModel.js';
import { renderCantileverProfiles } from './cantileverRenderer.js';
import { isMetal, metalConfig, buildMetalStructure } from './metalStructureModel.js';
import { renderMetalStructure } from './metalStructureRenderer.js';
import { checkStackedInnerStringers } from './stackedStringers.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { evaluateRailingChecks } from '../validator/railingChecks.js';
import { buildCeiling } from './ceilingGeometry.js';
import { deriveStairData, deriveCeilingFit } from '../config/schema.js';
import { solveStairwellFit, applyStairwellFit, solveFixedSides } from './stairwellFit.js';
import { stairwellReport, stairwellWalls } from './stairwell.js';
import { buildStairwellWalls } from './stairwellWallsRenderer.js';
import { applyAppearanceToMaterials } from '../scene/appearance.js';
import { applyWoodGrainToTree, getOakTexture, getOakMeanLuminance, getOakPhotoTexture, OAK_PHOTO_MEAN_HEX } from '../scene/woodGrain.js';

// Wypukłość porów/słojów z tekstury dębu (bumpMap) — wartość dobrana na oko w widoku 3D, tylko wizualna.
const OAK_BUMP_SCALE = 0.6;

const treadMaterial = new THREE.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.75, metalness: 0.02, side: THREE.DoubleSide });
// Jeden wspólny materiał dla wang wewn.+zewn. — dzięki temu "Zaznacz wg materiału" w SketchUp
// (działa niezależnie od tego, czy import zachował hierarchię grup z DAE) chwyta OD RAZU
// całe wangi, a nie tylko jedną stronę.
const stringerMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.7, metalness: 0.02, side: THREE.DoubleSide });
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.65, metalness: 0.02 });
const railingMaterial = new THREE.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.7, metalness: 0.02 });
// Own material for the balusters, so their colour can differ from the handrail's (scene/appearance.js 'baluster').
const balusterMaterial = new THREE.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.7, metalness: 0.02 });
// Glass balustrade (railingGlass.js): a slightly green, see-through pane, and brushed steel for its fixings.
const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xcfe7e2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
const glassFixingMaterial = new THREE.MeshStandardMaterial({ color: 0xb9bdc1, roughness: 0.3, metalness: 0.9 });
// cantilever stair: the steel profiles out of the wall (inside the cladding boxes)
const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x5f6368, roughness: 0.5, metalness: 0.8 });
// metal stair (metalStructureModel.js): the beams with their supports / the toothed flat bars — painted steel
const metalStructureMaterial = new THREE.MeshStandardMaterial({ color: 0x565b61, roughness: 0.6, metalness: 0.25 });
const riserBoardMaterial = new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide });

// Kolory prezentacji (scene/appearance.js) ustawiane na tych wspólnych materiałach; kolejny rebuild()
// odtwarza zależne od nich materiały pochodne (np. znacznik gniazda w wandze).
export function setAppearance(appearance) {
  applyAppearanceToMaterials(
    { tread: treadMaterial, riser: riserBoardMaterial, stringer: stringerMaterial, post: postMaterial, railing: railingMaterial, baluster: balusterMaterial, glassFixing: glassFixingMaterial },
    appearance,
    typeof document === 'undefined' && typeof window === 'undefined' ? null : { texture: getOakTexture(), meanLuminance: getOakMeanLuminance(), bumpScale: OAK_BUMP_SCALE, photo: { texture: getOakPhotoTexture(), meanHex: OAK_PHOTO_MEAN_HEX } }
  );
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
export function buildStaircase(inputConfig) {
  // "Dopasuj do klatki" (stairwellFit.js): the going and straight-tread counts derived from the stairwell's side
  // lengths replace the user's values BEFORE anything is solved, so every model, the validation and the takeoff
  // see one and the same stair. With the fit off (or without a solution) this is the user's config unchanged.
  // The stairwell's FIXED sides (stairwell.js) are kept the same way on every change — the going and the counts follow
  // whatever the user edits (winders, turns, axis gap), so a fixed exit side stays "pinned" (user decision 2026-10-16).
  const stairwellFit = solveFixedSides(inputConfig) || solveStairwellFit(inputConfig);
  const config = applyStairwellFit(inputConfig, stairwellFit);
  const derived = deriveStairData(config);
  // Cantilever stair (cantileverModel.js): the tread is the whole cladding box, no risers, no wangi, no structural posts.
  const cantilever = isCantilever(config);
  // Metal stair (metalStructureModel.js): steel beams with supports or toothed flat bars instead of the wangi; open
  // (no risers), no structural posts either.
  const metal = isMetal(config);
  const noWangi = cantilever || metal;
  const fullConfig = metalConfig(cantileverConfig({ ...config, riserHeight: derived.riserHeight }));
  const planLayout = buildPlanLayout(fullConfig);
  // the ceiling opening and the stairwell (they depend on the plan only): the balustrade round the opening stands on its
  // edges and leaves out the ones along the walls; where it ends at the stair's end newel that newel moves onto the slab
  // (railingSolver.js endNewelOntoSlab) — decided before the posts and wangi are built, both read it from the config
  const ceilingFit = deriveCeilingFit(config, planLayout, derived.riserHeight);
  // the stairwell (stairwell.js): every side measured, a fixed side off its dimension reported; its walls and slab for
  // the 3D view (presentation only, like the ceiling)
  const stairwell = stairwellReport(config, planLayout);
  const walls = stairwellWalls(stairwell, fullConfig, planLayout);
  const slabNewel = noWangi ? null : endNewelOntoSlab({ config: fullConfig, planLayout, openingOutline: ceilingFit.openingOutline, wallSegments: walls?.pieces || [] });
  if (slabNewel) fullConfig.endNewelOntoSlab = slabNewel;

  let treadModels = buildTreadModels(planLayout, fullConfig);
  const cantileverResult = { diagnostics: [] };
  if (cantilever) {
    treadModels = treadModels.map((t, i) => {
      const box = buildCantileverBox(t, planLayout.treads[i], fullConfig);
      for (const w of box.warnings) cantileverResult.diagnostics.push(createDiagnostic({ ruleId: 'CANTILEVER-PROFILE', severity: 'WARNING', elementType: 'tread', elementId: t.stepId, message: `Schody wspornikowe, ${w}` }));
      return { ...t, cantilever: box };
    });
    const widthMm = fullConfig.stairWidth - (fullConfig.cantileverWallGapMm || 0);
    if (widthMm > (fullConfig.cantileverMaxWidthMm || 1800)) {
      cantileverResult.diagnostics.push(createDiagnostic({ ruleId: 'CANTILEVER-WIDTH', severity: 'WARNING', elementType: 'stair', elementId: 'stair', parameter: 'stairWidth', value: Math.round(widthMm), expected: `<= ${fullConfig.cantileverMaxWidthMm || 1800}`, unit: 'mm', message: `Okładzina stopnia wspornikowego ma ${Math.round(widthMm)} mm szerokości — więcej niż maks. ${fullConfig.cantileverMaxWidthMm || 1800} mm.` }));
    }
  }
  const riserModels = buildRiserModels(planLayout, fullConfig);
  const metalStructure = metal ? buildMetalStructure({ planLayout, treadModels }, fullConfig) : null;
  // A cantilever or metal stair has no wangi and no structural posts: empty models, so nothing downstream (render,
  // joints, takeoff, validation, the structural check) sees a board or a post that does not exist.
  const noStringer = (side) => ({ side, segments: [], segmentJoints: [], absent: true });
  const stringerModels = noWangi ? { outer: noStringer('outer'), inner: noStringer('inner') } : buildStringerModelsForFlight(planLayout, fullConfig);
  // Construction geometry (the real, continuous board contour — see
  // stringerConstructionGeometry.js) is a SEPARATE solver step on top of the analytical
  // StringerModel, never merged into it and never computed inside the renderer.
  const stringerConstruction = noWangi
    ? { outer: [], inner: [] }
    : {
        outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
        inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
      };
  // A 180° winder zone whose inner wangi stand one above the other (stackedStringers.js): their height overlap at the
  // central post is reported on the upper board (corrected by hand in the profile editor — user decision 2026-10-14)
  const stacked = noWangi ? [] : checkStackedInnerStringers({ planLayout, stringerModels, stringerConstruction, config: fullConfig });
  if (stacked.length) {
    stringerConstruction.inner = stringerConstruction.inner.map((g) => {
      const own = stacked.filter((d) => d.elementId === g.segmentId);
      return own.length ? { ...g, diagnostics: [...(g.diagnostics || []), ...own] } : g;
    });
  }
  const structuralPostModels = noWangi ? [] : buildPostModels(planLayout, fullConfig);

  // Balustrade: depends on the treads/wangi/posts above, changes none of them (RULES.md #6). Its end
  // posts are ordinary posts from here on (rendered, priced, exported, editable in the Inspektor).
  const solvedRailing = buildRailingModel({ planLayout, treadModels, stringerModels, stringerConstruction, postModels: structuralPostModels, openingOutline: ceilingFit.openingOutline, wallSegments: walls?.pieces || [] }, fullConfig);
  // Legal/reference checks on the solved balustrade (validator/railingChecks.js) join its own findings, which
  // reach the Walidacja tab and the takeoff gate like the stringer construction diagnostics do.
  const railingModel = { ...solvedRailing, diagnostics: [...solvedRailing.diagnostics, ...evaluateRailingChecks(solvedRailing, fullConfig, structuralPostModels)] };
  // Also the removed ones (flagged), for the UI — a removed post is drawn as a ghost and can be restored.
  // (a structural post a handrail ends at is raised to the handrail's top — postSolver.js raisePostsToHandrail)
  const allPostModels = [...(noWangi ? [] : raisePostsToHandrail(buildAllPostModels(planLayout, fullConfig), railingModel.postTopNeeds)), ...railingModel.posts];
  const postModels = allPostModels.filter((p) => !p.removed);

  // How the elements are joined (jointSolver.js): stringers into posts (stage 1), treads/risers cut around posts and
  // into them (stage 2). Decided before any rendering — treads, risers and posts are drawn from it.
  const joints = buildJointModel({ stringerModels, stringerConstruction, postModels, treadModels, riserModels: config.hasRiserBoards ? riserModels : [], config: fullConfig });

  const root = new THREE.Group();
  root.name = 'Staircase';

  root.add(renderTreads(treadModels, treadMaterial, joints.treadCuts));
  const outerGroup = renderStringers(stringerModels.outer, stringerConstruction.outer, stringerMaterial, 'StringerOuter');
  const innerGroup = renderStringers(stringerModels.inner, stringerConstruction.inner, stringerMaterial, 'StringerInner');
  if (metalStructure) {
    // the steel takes the wangi's place in the 3D layers: outer + central rows with "Wanga zewn.", inner with "Wanga wewn."
    outerGroup.add(renderMetalStructure(metalStructure, ['outer', 'centre'], metalStructureMaterial, 'MetalOuter'));
    innerGroup.add(renderMetalStructure(metalStructure, ['inner'], metalStructureMaterial, 'MetalInner'));
  }
  root.add(outerGroup);
  root.add(innerGroup);

  const postsGroup = renderPosts(postModels, postMaterial, joints.pocketsByPost);
  root.add(postsGroup);
  if (cantilever) root.add(renderCantileverProfiles(treadModels, steelMaterial));

  if (config.hasRiserBoards) {
    root.add(renderRisers(riserModels, riserBoardMaterial, joints.riserCuts));
  }

  if (railingModel.enabled) {
    // glass colour (railingGlass.js GLASS_TINTS): clear / optiwhite / graphite / bronze
    const tint = GLASS_TINTS[config.railingGlassTint] || GLASS_TINTS.clear;
    glassMaterial.color.setHex(tint.color);
    glassMaterial.opacity = tint.opacity;
    root.add(
      renderRailing(railingModel, { balusterShape: config.railingBalusterShape, balusterSizeMm: config.railingBalusterSizeMm }, railingMaterial, balusterMaterial, {
        glassMaterial,
        metalMaterial: glassFixingMaterial,
        glassStandoffMm: config.railingGlassStandoffMm || 0,
      })
    );
  }

  // Prezentacja: współrzędne tekstury z kierunkiem włókien (wzdłuż najdłuższej osi każdego elementu) + cienie.
  // Nie zmienia żadnego wierzchołka — tylko dokłada `uv` (scene/woodGrain.js).
  applyWoodGrainToTree(root);

  const ceilingMesh = buildCeiling(ceilingFit, fullConfig, walls?.slab);
  const wallsMesh = buildStairwellWalls(walls);
  // strop przyjmuje cień, ale go nie rzuca — inaczej słońce z góry zostawiłoby schody w cieniu płyty
  ceilingMesh.receiveShadow = true;

  // root = tylko elementy schodów (do eksportu); strop jest osobno, tylko do wizualizacji.
  // treadModels/riserModels/stringerModels/postModels są tu już policzone raz — zwracamy je też
  // jawnie, żeby np. src/validator/StaircaseValidator.js (validateModels) albo
  // src/takeoff/materialTakeoff.js (computeMaterialTakeoff) mogły ocenić/zestawić DOKŁADNIE tę
  // geometrię bez ponownego jej liczenia (patrz main.js/rebuild()) — nigdy nie licz jej drugi
  // raz tylko po to, żeby ją zwalidować albo zestawić materiałowo.
  return { root, ceilingMesh, wallsMesh, planLayout, derived, ceilingFit, fullConfig, treadModels, riserModels: fullConfig.hasRiserBoards ? riserModels : [], stringerModels, stringerConstruction, postModels, allPostModels, railingModel, stairwellFit, stairwell, joints, cantilever: cantilever ? cantileverResult : null, metalStructure };
}
