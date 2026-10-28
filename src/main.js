import * as THREE from 'three';
import './style.css';
import { createDefaultConfig } from './config/schema.js';
import { buildStaircase, setAppearance } from './geometry/buildStaircase.js';
import { defaultAppearance, sanitizeAppearance } from './scene/appearance.js';
import { editRailingSections, sanitizeRailingEndOffsets } from './geometry/railingSolver.js';
import { sanitizePostOverrides } from './geometry/postSolver.js';
import { applyProfileEdit } from './geometry/stringerProfileModel.js';
import { createProfileEditor } from './ui/profileEditorPanel.js';
import { createRailingEditor } from './ui/railingEditorPanel.js';
import { applyRailingProfileEdit } from './geometry/railingProfileModel.js';
import { planToWorld } from './geometry/geometryUtils.js';
import { createScene } from './scene/sceneSetup.js';
import { buildDimensionLabels, buildStringerLengthLabels, buildWinderBlankLabels } from './scene/dimensionLabels.js';
import { buildHeadroomOverlay } from './scene/headroomOverlay.js';
import { buildDebugOverlay } from './scene/debugOverlay.js';
import { buildJointMarkers } from './geometry/jointMarkers.js';
import { buildJointMarkersOverlay } from './scene/jointMarkersOverlay.js';
import { resolveTraceability } from './scene/elementInspector.js';
import { applySelectionHighlight } from './scene/selectionHighlight.js';
import { createUI, createInfoPanel, updateInfoPanel, createValidatorPanel, updateValidatorPanel, markValidatorSelection, refreshUI } from './ui/ui.js';
import { createWorkspace } from './ui/workspace.js';
import { createInspectorPanel, updateInspectorPanel, selectionLabel } from './ui/inspectorPanel.js';
import { createTakeoffPanel, updateTakeoffPanel, markTakeoffSelection } from './ui/takeoffPanel.js';
import { createStructuralPanel, updateStructuralPanel } from './ui/structuralPanel.js';
import { buildStructuralReport } from './structural/index.js';
import { createViewportHud, LAYERS_3D } from './ui/viewportHud.js';
import { GROUP_BY } from './ui/takeoffView.js';
import { stepIndexFromElementId, selectionFromTakeoffSourceId } from './ui/selection.js';
import { buildPricedMaterialTakeoff, DEFAULT_PRICE_LIST } from './takeoff/index.js';
import { DEFAULT_WASTE_FACTORS } from './takeoff/wasteFactors.js';
import { createDefaultBoardPricing, sanitizeBoardPricing } from './takeoff/boardPricing.js';
import { createPricingEditor } from './ui/pricingEditor.js';
import { createManualItemsEditor } from './ui/manualItemsEditor.js';
import { createDefaultManualItems, sanitizeManualItems, applyManualItems } from './takeoff/manualItems.js';
import { addWaiver, removeWaiver } from './diagnostics/waivers.js';
import { renderPlan2DSVG, planSvgBounds } from './plan2d/plan2dRenderer.js';
import { resolveOpening, openingFrame, sanitizeOpeningPolygon, moveOpeningVertex, insertOpeningVertex, removeOpeningVertex, translateOpening, OPENING_SHAPES } from './geometry/ceilingOpening.js';
import { exportPlan2DSVG } from './plan2d/exportPlan2D.js';
import { fitToBounds, zoomAt, nearestStandardScale, pixelsPerMm } from './plan2d/viewport.js';
import { boundaryEditPoints, closestOnPolyline } from './plan2d/edgeEdit.js';
import { applyRailingPostEdit, manualRailingPostId } from './geometry/railingPostEdits.js';
import { defaultStarterSpec, starterDragValue } from './geometry/starterSteps.js';
import { withEdgeOverride, effectiveEdgeOverrides } from './geometry/edgeOverrides.js';
import { stairwellPlanDrawing, treadsOpenOnOuterSide, openOuterRailingRanges } from './geometry/stairwell.js';
import { generateStairwellVariants } from './designer/stairwellVariants.js';
import { createStairwellVariantsPanel, renderStairwellVariants } from './ui/stairwellVariantsPanel.js';
import { attachPlanInteractions } from './plan2d/planInteractions.js';
import { exportProjectJSON, parseProjectFile, CURRENT_PROJECT_VERSION } from './project/projectIO.js';
import { createPresentationLogo, savePresentationSnapshot } from './app/presentation.js';
import { createOfferController } from './app/offerController.js';
import { createExports, projectFileBaseName } from './app/exports.js';
import { createHistory, commit, undo as historyUndo, redo as historyRedo, canUndo, canRedo } from './history/modelHistory.js';
import { sideShort } from './util/sideNames.js';
import { lineHasWall, stairwellWallList } from './geometry/stairwell.js';
import { applyWallEdit } from './geometry/stairwellWallEdits.js';
import { createMeasureTool } from './scene/measureTool.js';
import { snapMeasurePoint, planMeasureRefs } from './plan2d/planMeasure.js';
import { floorDrivenFields } from './geometry/floors.js';

// What a NEW project starts with (the app's start and "Nowy"): no stair yet, the stairwell's walls on.
const NEW_PROJECT_START = Object.freeze({ stairPending: true, stairwellRoomEnabled: true });

// ARCHITEKTURA (etap 10): main.js tylko ŁĄCZY moduły — UI zmienia model (config), woła rebuild(),
// a wszystkie panele/widoki są renderowane z już-rozwiązanych modeli. Żaden panel ani interakcja
// nie liczy geometrii: model -> rebuild() -> modele -> (2D SVG | 3D renderer | walidacja | kosztorys).
const app = document.getElementById('app');

const config = createDefaultConfig();
// the app starts with no stair (user decision 2026-10-23): the stairwell's walls and the opening first, then "Generuj"
Object.assign(config, NEW_PROJECT_START);
const viewState = {
  showCeiling: true,
  showWalls: true, // the stairwell room's walls (stairwell.js stairwellWalls), when there is a room
  showHeadroom: false, // the headroom curtain under the opening (scene/headroomOverlay.js) — also in the presentation mode
  showDimensions: true,
  showStringerLengths: false,
  showWinderBlanks: false,
  // Debug mode (src/scene/debugOverlay.js): reference lines, construction points,
  // intersections, normals, bearing positions, naruszenia reguł — czysta wizualizacja
  // już-rozwiązanych danych modelu, nigdy drugie liczenie geometrii.
  showDebug: false,
  // "Złącza" layer (3D HUD): the pockets and bolt holes of the joint model, drawn see-through over the model
  showJoints: false,
  plan2dShowWinderBlanks: true,
  plan2dEditMode: false,
  // Tryb prezentacji: czysto wizualny (chowa panele i nakładki techniczne) — NIE dotyka `config`.
  clientMode: false,
  view: '2d', // '2d' | '3d' — 2D jest głównym środowiskiem technicznym
  // Widoczność warstw 3D (grupy Three.js po nazwie) — tylko podgląd, eksport OBJ/DAE ich nie widzi.
  layers3d: Object.fromEntries(LAYERS_3D.map(([key]) => [key, true])),
  // Warstwy linii konstrukcyjnych na planie 2D — czysto wizualne, nie zapisywane w projekcie.
  plan2dLayers: {
    grid: false,
    axes: false,
    widths: true,
    walkline: true,
    runBoundaries: true,
    stepBoundaries: false,
    stringers: true,
    railing: true,
    winderWidth: false,
    stringerSpacing: false,
    ceilingOpening: true,
    stairwell: true,
  },
};
const exportSelection = { Stopnie: true, Wangi: true, Slupy: true, Podstopnie: true };

// Wycena to warstwa Material Takeoff, NIE parametr geometrii: osobny stan, poza `config` i poza
// historią modelu (zmiana ceny nie jest "cofnięciem schodów"), ale zapisywany w pliku projektu.
const takeoffSettings = {
  priceList: DEFAULT_PRICE_LIST.map((p) => ({ ...p })), // pozostałe materiały (wangi, słupy…)
  wasteFactors: { ...DEFAULT_WASTE_FACTORS },
  boardPricing: createDefaultBoardPricing(), // cennik desek: stopnie/podesty/podstopnie/wangi + słupy
  manualItems: createDefaultManualItems(), // wpisywane ręcznie: tralki, poręcze…
};
const projectMeta = { name: '', notes: '', lastFileNote: '' };
// The "Oferta" tab (app/offerController.js — offer settings are project data, company data a browser setting);
// created with the other panels below.
let offer = null;
let takeoffGroupBy = GROUP_BY.ELEMENT;

// Wyjątki walidacji ("Dodaj wyjątek"): świadomie zaakceptowane pary (ruleId, elementId), które
// przestają blokować kosztorys. Decyzja projektowa (zapisywana w pliku), ale nie parametr
// geometrii — poza `config` i poza historią modelu, tak jak ceny.
let waivers = [];

// Zaznaczenie (wspólne dla 2D, 3D, Walidacji i Kosztorysu) — kształt z ui/selection.js. Nie jest
// stanem modelu: nie trafia do historii ani do pliku projektu.
let selection = null;
let selectedStepIndex = null; // pochodna `selection` dla tread/riser — używana przez plan 2D
let selectedDiagnostic = null;
let selectedTakeoffItemId = null;

// Historia cofania działa WYŁĄCZNIE na modelu (config) — nigdy na widoku, zaznaczeniu ani meshach.
const history = createHistory(config);

// Kolory prezentacji (scene/appearance.js) — zapisywane w pliku projektu, poza `config` i historią modelu.
const appearance = defaultAppearance();

let currentRoot = null;
let currentCeiling = null;
let currentWalls = null;
let currentHeadroom = null;
let currentDimLabels = null;
let currentStringerLengthLabels = null;
let currentWinderBlankLabels = null;
let currentDebugOverlay = null;
let currentJointMarkers = null;
let currentPlanLayout = null;
let currentDerived = null;
let currentPlan2DSVG = '';
let lastModels = null;
let variantsPanel = null; // the stairwell variant list (set once the panels exist)
let lastDiagnostics = []; // AKTYWNE (bez objętych wyjątkiem)
let lastWaived = [];
let lastStaleWaivers = [];
let lastTakeoff = null;
let planViewport = null; // {x,y,width,height} — patrz plan2d/viewport.js; null = jeszcze nie dopasowany
// Otwór w stropie na planie 2D: 'off' | 'edit' (uchwyty wierzchołków) | 'draw' (klikanie nowego wielokąta).
// Stan WIDOKU — nie trafia do historii ani do pliku; zmienia się tylko config.openingShape/openingPolygon.
let openingMode = 'off';
let railingPostMode = false; // the plan's "▮ Słupki" mode: balustrade posts placed / moved / switched off by hand
let wallMode = false; // the plan's "▥ Ściany" mode: the stairwell's walls added / stretched / removed by hand
let trimMode = false; // the plan's "▬ Fajka" mode: the opening's trim switched on / off per edge
// the plan's tape measure (plan2d/planMeasure.js) — view state only: the measures (plan mm) and the one being drawn
let planMeasureMode = false;
let planMeasures = [];
let planMeasureDraft = null; // {a, cursor}
let openingBase = null; // wielokąt (względny) zapamiętany na początku przeciągania
let planApi = null; // {redrawDraft, resetDraft} z attachPlanInteractions

const PLAN_VIEW_MARGIN_MM = 600;

// ---------------------------------------------------------------------------------------------
// Workspace (layout) + widok 3D
// ---------------------------------------------------------------------------------------------
const ws = createWorkspace(app, {
  onNew: handleNewProject,
  onSave: handleSaveProject,
  onLoad: () => fileInput.click(),
  onUndo: handleUndo,
  onRedo: handleRedo,
  onViewChange: (view) => setView(view),
  onToggleClientMode: () => setClientMode(!viewState.clientMode),
  onProjectNameChange: (name) => {
    projectMeta.name = name;
    document.title = name ? `${name} — Kalkulator schodów 3D` : 'Kalkulator schodów 3D';
  },
  onProjectNotesChange: (notes) => {
    projectMeta.notes = notes;
  },
});

const viewport = document.createElement('div');
viewport.id = 'viewport';
ws.mainEl.appendChild(viewport);

const sceneApi = createScene(viewport);
// the 3D tape measure (scene/measureTool.js): a view tool — on the stair, the slab and the stairwell's walls as shown
const measureTool = createMeasureTool({ scene: sceneApi.scene, getCamera: () => sceneApi.getCamera(), domElement: sceneApi.renderer.domElement, getTargets: () => [currentRoot, currentCeiling, currentWalls] });
sceneApi.addFrameHook(() => measureTool.update());
const { scene, renderer } = sceneApi;

// ---------------------------------------------------------------------------------------------
// Historia (undo/redo na poziomie modelu)
// ---------------------------------------------------------------------------------------------
function updateHistoryButtons() {
  ws.setHistoryState({ canUndo: canUndo(history), canRedo: canRedo(history) });
}

function commitHistory() {
  commit(history, config);
  updateHistoryButtons();
}

function restoreFromHistory(snapshot) {
  if (!snapshot) return;
  Object.assign(config, snapshot);
  refreshUI(gui);
  clearSelectionState();
  rebuild();
  updateHistoryButtons();
}

function handleUndo() {
  restoreFromHistory(historyUndo(history));
}
function handleRedo() {
  restoreFromHistory(historyRedo(history));
}

window.addEventListener('keydown', (e) => {
  // W polach tekstowych (nazwa/notatki projektu) Ctrl+Z ma cofać tekst, nie model schodów.
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
  const isRedo = ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y');
  if (isUndo) {
    e.preventDefault();
    handleUndo();
  } else if (isRedo) {
    e.preventDefault();
    handleRedo();
  }
});

// ---------------------------------------------------------------------------------------------
// rebuild(): model -> solvery -> render 3D / plan 2D / walidacja / kosztorys / panele
// ---------------------------------------------------------------------------------------------
// Set once the parameter panel exists (it is created after rebuild() is defined); see the stairwell fit in rebuild().
let uiRefresh = null;
// panels created after rebuild() is defined that follow the stair on every rebuild (the 3D HUD's wangi names)
const afterRebuild = [];
let fitWasEnabled = false;

function rebuild() {
  if (currentHeadroom) {
    // its label is a sprite with its own canvas texture
    currentHeadroom.traverse((o) => {
      o.material?.map?.dispose();
      o.material?.dispose();
    });
  }
  for (const group of [currentRoot, currentCeiling, currentWalls, currentHeadroom, currentDimLabels, currentStringerLengthLabels, currentWinderBlankLabels, currentDebugOverlay, currentJointMarkers]) {
    if (!group) continue;
    scene.remove(group);
    disposeGroup(group);
  }

  // Kolejność zgodna z architekturą: solver 2D (planLayout) -> wangi -> podstopnie -> słupy ->
  // 3D. buildStaircase.js jest jedynym miejscem, które składa modele w drzewo Three.js.
  const built = buildStaircase(config);
  const { root, ceilingMesh, wallsMesh, derived, planLayout, ceilingFit, fullConfig, treadModels, riserModels, stringerModels } = built;
  lastModels = built;
  afterRebuild.forEach((hook) => hook());
  // "Dopasuj do klatki": the stair was built from the fitted going/counts (buildStaircase applies the fit itself);
  // they are copied into config so the sliders, the project file and undo show what the stair really is — like an
  // AUTO value. The fit depends only on the targets and the other parameters, never on these fields, so copying
  // them back changes nothing on the next rebuild.
  // (not the turns' own winder shifts, `turnSplitOffsetsMm`: the solver's output only, re-derived on every build and
  // gone when the stairwell is off — stairwellFit.js solveFixedSides)
  const { turnSplitOffsetsMm: _shifts, ...fitValues } = built.stairwellFit?.values || {};
  if (built.stairwellFit?.values) Object.assign(config, fitValues);
  // the rise from the raw height and the floor finishes (geometry/floors.js) — AUTO in the panel
  if (config.rawStoreyHeightMm !== null && config.rawStoreyHeightMm !== undefined) config.totalRise = fullConfig.totalRise;
  const fitOn = !!(config.stairwellFitEnabled || built.stairwellFit?.live);
  if (fitOn || fitWasEnabled || floorDrivenFields(config).length) uiRefresh?.();
  fitWasEnabled = fitOn;

  // not generated yet (config.stairPending): the stair is built (the walls and the opening follow it) but not shown
  root.visible = !config.stairPending;
  scene.add(root);
  scene.add(ceilingMesh);
  currentRoot = root;
  // cień słońca obejmuje dokładnie te schody (sceneSetup.js fitShadowToBox)
  sceneApi.fitShadowToBox(new THREE.Box3().setFromObject(root));
  currentCeiling = ceilingMesh;
  currentWalls = wallsMesh;
  if (wallsMesh) scene.add(wallsMesh);
  currentHeadroom = buildHeadroomOverlay(built.headroom);
  if (currentHeadroom) scene.add(currentHeadroom);

  currentDimLabels = buildDimensionLabels(planLayout, config, derived);
  scene.add(currentDimLabels);
  currentStringerLengthLabels = buildStringerLengthLabels(planLayout, config, derived);
  scene.add(currentStringerLengthLabels);
  currentWinderBlankLabels = buildWinderBlankLabels(planLayout, config, derived);
  scene.add(currentWinderBlankLabels);

  // Walidacja + kosztorys z JEDNEGO wywołania fasady: buildPricedMaterialTakeoff() najpierw
  // przepuszcza modele przez bramkę walidacji (StaircaseValidator + diagnostyki konstrukcji
  // wang), więc jej diagnostyki są kompletnym wynikiem walidacji — panel Walidacji i Kosztorys
  // zawsze pokazują ten sam stan (bez drugiego, osobnego przebiegu walidatora). Nic z tego nie
  // liczy geometrii: wszystko czyta te modele, które buildStaircase() już policzył.
  // Orientative structural check (structural/index.js) — before the takeoff, so its findings join the same
  // validation gate (Walidacja). Never blocks anything by itself (WARNING at most).
  built.structural = buildStructuralReport(built, { riserMaterial: takeoffSettings.boardPricing?.riserMaterial });
  lastTakeoff = computeTakeoff();
  lastDiagnostics = lastTakeoff.activeDiagnostics;
  lastWaived = lastTakeoff.waivedDiagnostics;
  lastStaleWaivers = lastTakeoff.staleWaivers;

  currentDebugOverlay = buildDebugOverlay({ planLayout, treadModels, stringerModels, diagnostics: lastDiagnostics });
  scene.add(currentDebugOverlay);
  // the joints layer: the same pockets and holes the DXF exports mark (geometry/jointMarkers.js), next to the model
  currentJointMarkers = buildJointMarkersOverlay(buildJointMarkers(built));
  scene.add(currentJointMarkers);

  // Zaznaczenie wskazuje element po ID — jeśli po zmianie parametrów stary element nie istnieje
  // (np. mniej stopni), zaznaczenie znika zamiast wskazywać przypadkowy inny.
  if (selection && !selectionStillExists(selection, built)) clearSelectionState();

  currentPlanLayout = planLayout;
  currentDerived = derived;
  if (!planViewport) fitPlanView();

  updateInfoPanel(infoPanel, derived, planLayout, config, ceilingFit, built.stairwellFit);
  if (variantsPanel) showStairwellVariants();
  // (before "Generuj schody" there is no stair to check or price: only the stairwell's own findings)
  const shownDiagnostics = config.stairPending ? lastDiagnostics.filter((d) => /^(STAIRWELL|STAIR3D-FIT)/.test(d.ruleId)) : lastDiagnostics;
  const counts = updateValidatorPanel(validatorPanel, shownDiagnostics, { selectedDiagnostic, waivedDiagnostics: config.stairPending ? [] : lastWaived, staleWaivers: lastStaleWaivers });
  renderTakeoffPanel();
  updateStructuralPanel(structuralPanel, built.structural, config);

  applyOverlayVisibility();
  applyLayerVisibility();
  refreshSelectionViews();
  updateStatus(counts);
  // Edytor profilu rysuje się z TYCH SAMYCH modeli — po każdym przeliczeniu (także w trakcie przeciągania
  // punktu) odświeżamy go, jeśli jest widoczny.
  if (viewState.view === 'profile' && typeof profileEditor !== 'undefined') profileEditor.refresh();
  if (viewState.view === 'railing' && typeof railingEditor !== 'undefined') railingEditor.refresh();
}

function selectionStillExists(sel, built) {
  switch (sel.elementType) {
    case 'tread':
    case 'riser':
      return built.planLayout.treads.some((t) => t.index === sel.stepIndex);
    case 'stringer':
      return !!built.stringerModels[sel.stringerId];
    case 'post':
      return !sel.postId || built.allPostModels.some((p) => p.postId === sel.postId);
    default:
      return false;
  }
}

// Kosztorys liczony z TYCH SAMYCH modeli co reszta (bez drugiego rozwiązywania geometrii).
function computeTakeoff() {
  const takeoff = buildPricedMaterialTakeoff(lastModels, {
    priceList: takeoffSettings.priceList,
    wasteFactors: takeoffSettings.wasteFactors,
    boardPricing: takeoffSettings.boardPricing,
    waivers,
  });
  // Pozycje wpisane ręcznie (tralki, poręcze…) dochodzą do sumy dopiero tu — nie są wyliczane z modelu.
  return applyManualItems(takeoff, takeoffSettings.manualItems);
}

// ID stopni zabiegowych — kosztorys pokazuje je w osobnej kategorii ("Stopnie zabiegowe").
function winderStepIds() {
  return new Set((lastModels?.treadModels ?? []).filter((t) => t.type === 'winder').map((t) => t.stepId));
}

// Zmiana cen/odpadów przelicza tylko kosztorys — geometria i historia modelu zostają nietknięte.
function refreshTakeoff() {
  if (!lastModels) return;
  // The riser material (oak/MDF) lives in the takeoff settings and changes the risers' weight.
  lastModels.structural = buildStructuralReport(lastModels, { riserMaterial: takeoffSettings.boardPricing?.riserMaterial });
  lastTakeoff = computeTakeoff();
  renderTakeoffPanel();
  updateStructuralPanel(structuralPanel, lastModels.structural, config);
}

function renderTakeoffPanel() {
  // before "Generuj schody": a note instead of the takeoff (the panel itself is only hidden — it keeps its elements)
  let pendingNote = takeoffPanel.parentElement?.querySelector('.takeoff-pending-note');
  if (!pendingNote && takeoffPanel.parentElement) {
    pendingNote = document.createElement('div');
    pendingNote.className = 'insp-hint takeoff-pending-note';
    pendingNote.textContent = 'Kosztorys pojawi się po wygenerowaniu schodów („▶ Generuj schody” w folderze „1. Schody”).';
    takeoffPanel.parentElement.insertBefore(pendingNote, takeoffPanel);
  }
  if (pendingNote) pendingNote.hidden = !config.stairPending;
  takeoffPanel.hidden = !!config.stairPending;
  if (config.stairPending) {
    ws.setTabBadge('takeoff', '', 'info');
    offer?.refresh();
    return;
  }
  updateTakeoffPanel(takeoffPanel, lastTakeoff, {
    groupBy: takeoffGroupBy,
    selectedItemId: selectedTakeoffItemId,
    priceList: takeoffSettings.priceList,
    wasteFactors: takeoffSettings.wasteFactors,
    boardPricing: takeoffSettings.boardPricing,
    winderStepIds: winderStepIds(),
  });
  offer?.refresh();
  if (lastTakeoff.status === 'BLOCKED') ws.setTabBadge('takeoff', '!', 'error');
  else ws.setTabBadge('takeoff', `≈${Math.round(lastTakeoff.totalCost).toLocaleString('pl-PL')} zł`, lastTakeoff.status === 'WARNING' ? 'warning' : 'info');
}

function manualEditCount() {
  return Object.keys(config.manualEdgeOverrides || {}).length + Object.keys(config.manualTreadOverhangs || {}).length + Object.keys(config.manualPostOverrides || {}).length;
}

// "Generuj schody": the stair appears and follows the parameters live from now on (one undo step)
function generateStair() {
  if (!config.stairPending) return;
  config.stairPending = false;
  refreshUI(gui);
  rebuild();
  fitPlanView();
  commitHistory();
}

function updateStatus(counts) {
  if (config.stairPending) {
    ws.setStatus({ validity: { level: 'warning', html: '● Schody jeszcze nie wygenerowane — ustaw klatkę, otwór i parametry, potem „Generuj schody”' } });
    return;
  }
  let level = 'ok';
  let text = '● Geometria poprawna';
  if (counts.ERROR === 0 && counts.WARNING === 0 && lastWaived.length > 0) {
    level = 'warning';
    text = `● Brak aktywnych problemów · zaakceptowanych wyjątków: ${lastWaived.length}`;
  } else if (counts.ERROR > 0) {
    level = 'error';
    text = `● Geometria z błędami: ${counts.ERROR}`;
  } else if (counts.WARNING > 0) {
    level = 'warning';
    text = `● Geometria z ostrzeżeniami: ${counts.WARNING}`;
  }
  const manual = manualEditCount();
  const waivedNote = lastWaived.length > 0 && (counts.ERROR > 0 || counts.WARNING > 0) ? ` · wyjątków: ${lastWaived.length}` : '';
  ws.setStatus({ validity: { level, html: `${text}${waivedNote}${manual ? ` · ✎ ręcznych zmian: ${manual}` : ''}` } });
  if (counts.ERROR > 0) ws.setTabBadge('validation', String(counts.ERROR), 'error');
  else if (counts.WARNING > 0) ws.setTabBadge('validation', String(counts.WARNING), 'warning');
  else ws.setTabBadge('validation', '', 'info');
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    // CSS2DObject: usuwa własny <div> tylko gdy .remove() jest wywołane bezpośrednio na nim,
    // a nie na nadrzędnej grupie — sprzątamy ręcznie, inaczej etykiety wymiarów zostają w DOM.
    if (obj.element && obj.element.parentNode) obj.element.remove();
  });
}

// ---------------------------------------------------------------------------------------------
// Widoczność nakładek / warstw 3D / tryb prezentacji (czysty widok — model nietknięty)
// ---------------------------------------------------------------------------------------------
function applyOverlayVisibility() {
  const technical = !viewState.clientMode;
  if (currentCeiling) currentCeiling.visible = viewState.showCeiling;
  if (currentWalls) currentWalls.visible = viewState.showWalls;
  // the headroom is meant for the client too: shown in the presentation mode as well
  if (currentHeadroom) currentHeadroom.visible = viewState.showHeadroom && !config.stairPending;
  const stair = !config.stairPending; // (nothing of the stair before "Generuj schody")
  if (currentDimLabels) currentDimLabels.visible = viewState.showDimensions && technical && stair;
  if (currentStringerLengthLabels) currentStringerLengthLabels.visible = viewState.showStringerLengths && technical && stair;
  if (currentWinderBlankLabels) currentWinderBlankLabels.visible = viewState.showWinderBlanks && technical && stair;
  if (currentDebugOverlay) currentDebugOverlay.visible = viewState.showDebug && technical && stair;
  if (currentJointMarkers) currentJointMarkers.visible = viewState.showJoints && technical && stair;
  sceneApi.helpers.grid.visible = technical;
  sceneApi.helpers.axes.visible = technical;
  sceneApi.helpers.ground.visible = !technical;
  sceneApi.helpers.shadowCatcher.visible = technical; // w prezentacji cień pada na podłogę
}

function applyLayerVisibility() {
  if (!currentRoot) return;
  for (const child of currentRoot.children) {
    if (child.name in viewState.layers3d) child.visible = viewState.layers3d[child.name];
  }
}

let ceilingBeforeClientMode = true;

function setClientMode(on) {
  viewState.clientMode = on;
  ws.setClientMode(on);
  // Strop przesłaniałby czysty widok schodów — na czas prezentacji jest domyślnie ukryty (można go
  // włączyć w HUD), a po wyjściu wraca poprzedni wybór użytkownika.
  if (on) {
    ceilingBeforeClientMode = viewState.showCeiling;
    handleViewChange('showCeiling', false);
    setView('3d');
  } else {
    handleViewChange('showCeiling', ceilingBeforeClientMode);
  }
  refreshUI(gui); // suwaki/checkboxy w panelu parametrów odzwierciedlają zmiany viewState
  sceneApi.setBackground(on ? viewportHudApi.hud.querySelector('[data-bg]').value : '#eef1f5');
  applyOverlayVisibility();
  refreshSelectionViews();
}

function frameStandardView(view) {
  if (!lastModels) return;
  const b = lastModels.planLayout.bounds;
  const rise = lastModels.fullConfig.totalRise;
  const center = planToWorld((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, rise / 2);
  const radius = 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, rise);
  sceneApi.frameView(view, center, radius);
  ws.setStatus({ view: `3D: ${sceneApi.getCameraMode() === 'orthographic' ? 'ortogonalny' : 'perspektywa'} · widok ${view}` });
}

const viewportHudApi = createViewportHud(ws.mainEl, {
  layers: viewState.layers3d,
  viewState,
  onLayerChange: () => applyLayerVisibility(),
  onStandardView: frameStandardView,
  onCameraMode: (mode) => {
    sceneApi.setCameraMode(mode);
    ws.setStatus({ view: `3D: ${mode === 'orthographic' ? 'ortogonalny' : 'perspektywa'}` });
  },
  onCeilingChange: (visible) => handleViewChange('showCeiling', visible),
  onWallsChange: (visible) => {
    handleViewChange('showWalls', visible);
    uiRefresh?.(); // the same switch in the panel's "Widok 3D" folder
  },
  onJointsChange: (visible) => handleViewChange('showJoints', visible),
  onHeadroomChange: (visible) => {
    handleViewChange('showHeadroom', visible);
    uiRefresh?.(); // the same switch in the panel's "Widok 3D" folder
  },
  onBackgroundChange: (hex) => sceneApi.setBackground(hex),
  onSnapshot: () => savePresentationSnapshot({ sceneApi, logo, projectName: projectMeta.name }),
  onLogoFile: (file) => logo.loadFile(file),
  onLogoRemove: () => logo.remove(),
  onLogoSettings: (patch) => logo.update(patch),
  onMeasureToggle: () => {
    measureTool.setActive(!measureTool.active);
    viewportHudApi.syncMeasure(measureTool.active);
    ws.setStatus({ selection: measureTool.active ? 'Miarka: kliknij pierwszy punkt na modelu, potem drugi (przyciąga do narożników i krawędzi). Wyłącz przyciskiem „📏 Miarka”.' : '' });
  },
  onMeasureClear: () => measureTool.clear(),
});
// the wangi layers' names follow the stair type (an S: lewa / prawa)
afterRebuild.push(() => viewportHudApi.syncSideNames(config));
viewportHudApi.syncSideNames(config);

// ---------------------------------------------------------------------------------------------
// Tryb prezentacji: logo firmy na ekranie i na zdjęciach, „Zapisz zdjęcie" — app/presentation.js
// ---------------------------------------------------------------------------------------------
const logo = createPresentationLogo({ hostEl: ws.mainEl, viewportEl: viewport, onStatus: (settings, message) => viewportHudApi.syncLogo(settings, message) });

// Obraz 3D do oferty: wygląd jak w trybie prezentacji (bez siatki, osi, stropu i nakładek technicznych), osobna kamera
// w widoku izometrycznym; potem przywrócenie tego, co było widać.
function offerImage3D() {
  if (!lastModels) return null;
  const b = lastModels.planLayout.bounds;
  const rise = lastModels.fullConfig.totalRise;
  const center = planToWorld((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, rise / 2);
  // a little more room than the on-screen "Dopasuj" — the whole stair with its posts must fit the picture
  const radius = 0.6 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, rise);
  const hidden = [sceneApi.helpers.grid, sceneApi.helpers.axes, sceneApi.helpers.shadowCatcher, currentCeiling, currentWalls, currentDebugOverlay, currentJointMarkers, currentDimLabels, currentStringerLengthLabels, currentWinderBlankLabels].filter(Boolean);
  const was = hidden.map((o) => o.visible);
  hidden.forEach((o) => (o.visible = false));
  const groundWas = sceneApi.helpers.ground.visible;
  sceneApi.helpers.ground.visible = true;
  applySelectionHighlight(currentRoot, null);
  try {
    return sceneApi.renderViewImage({ width: 1400, height: 1000, view: 'iso', center, radius }).toDataURL('image/jpeg', 0.9);
  } finally {
    hidden.forEach((o, i) => (o.visible = was[i]));
    sceneApi.helpers.ground.visible = groundWas;
    applySelectionHighlight(currentRoot, viewState.clientMode ? null : selection);
  }
}

// Rzut do oferty: ten sam renderer planu co zakładka Plan 2D, dopasowany do całych schodów, bez warstw edycyjnych.
function offerPlanSVG() {
  if (!lastModels) return null;
  const viewport = fitToBounds(planSvgBounds(lastModels.planLayout), 900, 700, PLAN_VIEW_MARGIN_MM);
  return renderPlan2DSVG(lastModels.planLayout, config, lastModels.derived, {
    viewport,
    showWinderBlanks: false,
    layers: { widths: true, walkline: true, runBoundaries: true, stepBoundaries: false, stringers: true, railing: true, ceilingOpening: false },
    clientView: true, // no editing aids in the client's offer
    posts: lastModels.postModels || [],
    stringerModels: lastModels.stringerModels,
    stringerConstruction: lastModels.stringerConstruction,
    metalStructure: lastModels.metalStructure || null,
    railingModel: lastModels.railingModel ?? null,
  });
}

logo.apply();

// ---------------------------------------------------------------------------------------------
// Zaznaczenie: jedno źródło prawdy, wiele widoków (2D, 3D, Inspektor, Walidacja, Kosztorys)
// ---------------------------------------------------------------------------------------------
function clearSelectionState() {
  selection = null;
  selectedStepIndex = null;
  selectedDiagnostic = null;
  selectedTakeoffItemId = null;
}

function setSelection(sel, { diagnostic = null, takeoffItem = null } = {}) {
  selection = sel;
  selectedStepIndex = sel && (sel.elementType === 'tread' || sel.elementType === 'riser') ? sel.stepIndex : null;
  selectedDiagnostic = diagnostic;
  selectedTakeoffItemId = takeoffItem ? takeoffItem.itemId : null;
  refreshSelectionViews();
}

function refreshSelectionViews() {
  regeneratePlan2D();
  // W trybie prezentacji nic nie jest podświetlone — klient widzi czysty model.
  applySelectionHighlight(currentRoot, viewState.clientMode ? null : selection);
  if (lastModels) {
    updateInspectorPanel(inspectorPanel, {
      selection,
      diagnostics: lastDiagnostics,
      config,
      derived: lastModels.derived,
      planLayout: lastModels.planLayout,
      treadModels: lastModels.treadModels,
      stringerModels: lastModels.stringerModels,
      railingModel: lastModels.railingModel ?? null,
      postModels: lastModels.allPostModels, // także usunięte (oznaczone) — Inspektor pokazuje "Przywróć"
      manualCount: manualEditCount(),
    });
  }
  markValidatorSelection(validatorPanel, selectedDiagnostic);
  markTakeoffSelection(takeoffPanel, selectedTakeoffItemId);
  ws.setStatus({ selection: selectionLabel(selection, config) });
}

// Diagnostyka -> zaznaczenie. Diagnostic niesie tylko elementType/elementId (bez ID meshów),
// więc podświetlamy wyłącznie to, co da się wskazać jednoznacznie po ID modelu; resztę
// (diagnostyki ogólne) tylko zaznaczamy na liście i mówimy o tym w statusie.
function handleSelectDiagnostic(d) {
  const stepIndex = stepIndexFromElementId(d.elementId);
  if (stepIndex !== null) {
    setSelection({ elementType: 'tread', stepIndex }, { diagnostic: d });
    return;
  }
  if (d.elementType === 'stringer') {
    const side = ['outer', 'inner'].find((s) => d.elementId?.includes(s));
    if (side) {
      setSelection({ elementType: 'stringer', stringerId: side, segmentId: null }, { diagnostic: d });
      return;
    }
  }
  if (d.elementType === 'post' && lastModels?.postModels.some((p) => p.postId === d.elementId)) {
    setSelection({ elementType: 'post', postId: d.elementId }, { diagnostic: d });
    return;
  }
  setSelection(null, { diagnostic: d });
  ws.setStatus({ selection: 'Ta diagnostyka dotyczy całych schodów/parametrów — brak konkretnego elementu do podświetlenia' });
}

// Wyjątek nie zmienia geometrii ani historii modelu — przelicza tylko bramkę walidacji i kosztorys
// (pełny rebuild() jest najprostszą drogą do spójnego stanu wszystkich paneli).
function handleWaive(diagnostic) {
  waivers = addWaiver(waivers, diagnostic);
  rebuild();
}
function handleUnwaive(diagnostic) {
  waivers = removeWaiver(waivers, diagnostic);
  rebuild();
}
function handleClearStaleWaivers() {
  waivers = waivers.filter((w) => !lastStaleWaivers.includes(w));
  rebuild();
}

function handleSelectTakeoffItem(item) {
  const sel = selectionFromTakeoffSourceId(item.sourceElementId);
  setSelection(sel, { takeoffItem: item });
}

// ---------------------------------------------------------------------------------------------
// Plan 2D
// ---------------------------------------------------------------------------------------------
function fitPlanView() {
  if (!currentPlanLayout) return;
  const walls = stairwellPlanDrawing(lastModels?.stairwell, config, currentPlanLayout)?.walls || [];
  const bounds = planSvgBounds(currentPlanLayout, [...(lastModels?.ceilingFit?.openingOutline || []), ...walls.flatMap((w) => [w.a, w.b])]);
  const rect = plan2dPanel.getBoundingClientRect();
  planViewport = fitToBounds(bounds, rect.width || 800, rect.height || 600, PLAN_VIEW_MARGIN_MM);
  regeneratePlan2D();
}

function updateScaleReadout() {
  if (!planViewport) return;
  const rect = plan2dPanel.getBoundingClientRect();
  const pxPerMm = pixelsPerMm(planViewport, rect.width || 800);
  // "1 mm na ekranie" jest umowne (zależy od fizycznego DPI wyświetlacza, którego strona WWW nie
  // może wiarygodnie odczytać) — pokazujemy nominalną skalę zaokrągloną do podziałek rysunku
  // technicznego, z jawnym zastrzeżeniem, zamiast udawać skalibrowaną dokładność.
  const nice = nearestStandardScale(1 / pxPerMm);
  scaleReadout.textContent = `Skala (orientacyjna): 1:${nice}`;
  if (viewState.view === '2d') ws.setStatus({ view: `Plan 2D · skala orientacyjna 1:${nice}` });
}

let activeEdgeBoundary = null; // view state: the plan edge being dragged right now (drawn highlighted)

function regeneratePlan2D() {
  if (!currentPlanLayout || !planViewport) return;
  const panelRect = plan2dPanel.getBoundingClientRect();
  // the SVG fits the viewBox into the panel by the tighter axis (preserveAspectRatio "meet") — that is the real scale
  const mmPerPx = Math.max(planViewport.width / (panelRect.width || 800), planViewport.height / (panelRect.height || 600));
  currentPlan2DSVG = renderPlan2DSVG(currentPlanLayout, config, currentDerived, {
    viewport: planViewport,
    mmPerPx, // lines, handles and labels keep one size on screen
    activeBoundary: activeEdgeBoundary,
    showWinderBlanks: viewState.plan2dShowWinderBlanks,
    editMode: viewState.plan2dEditMode,
    selectedStepIndex,
    selection,
    layers: viewState.plan2dLayers,
    postStates: Object.fromEntries((lastModels?.allPostModels || []).map((p) => [p.postId, { removed: p.removed, overridden: p.overridden }])),
    posts: lastModels?.allPostModels || [],
    stringerModels: lastModels?.stringerModels || null,
    stringerConstruction: lastModels?.stringerConstruction || null,
    metalStructure: lastModels?.metalStructure || null,
    railingModel: lastModels?.railingModel ?? null,
    opening: lastModels?.ceilingFit
      ? { outline: lastModels.ceilingFit.openingOutline, shape: lastModels.ceilingFit.openingShape, invalidReason: lastModels.ceilingFit.openingInvalidReason }
      : null,
    stairwell: stairwellPlanDrawing(lastModels?.stairwell, config, currentPlanLayout),
    openingEdit: openingMode === 'edit',
    railingPostEdit: railingPostMode,
    wallEdit: wallMode,
    openingTrim: lastModels?.openingTrim ?? null,
    trimEdit: trimMode,
    measures: planMeasures,
    measureDraft: planMeasureMode ? planMeasureDraft : null,
  });
  if (plan2dPanel.classList.contains('visible')) {
    plan2dSvgContainer.innerHTML = currentPlan2DSVG;
    planApi?.redrawDraft();
    updateScaleReadout();
  }
}

// ---------------------------------------------------------------------------------------------
// Otwór w stropie rysowany/edytowany na planie 2D. Każda zmiana pisze WYŁĄCZNIE config.openingShape/
// openingPolygon (punkty względem lewego-dolnego rogu rzutu, jak offsety prostokąta — geometry/ceilingOpening.js),
// potem zwykły rebuild(); historia dopiero po puszczeniu przeciągnięcia / zamknięciu rysunku.
// ---------------------------------------------------------------------------------------------
// (the opening's own frame: relative to the plan's lower-left corner, or the stairwell ROOM — ceilingOpening.js openingFrame)
function toOpeningRelative(p) {
  const q = openingFrame(config, currentPlanLayout).toRelative(p);
  return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 };
}
// Otwór, jaki jest teraz (prostokąt albo wielokąt), jako wielokąt względny — z niego startuje każda edycja,
// więc pierwsze przeciągnięcie prostokąta zamienia go w wielokąt o tych samych 4 narożnikach.
function currentOpeningRelative() {
  if (!currentPlanLayout) return [];
  // the opening as it is now — also a derived one (editing it turns it into a given polygon)
  const rel = lastModels?.ceilingFit?.openingRelativeOutline || resolveOpening(config, openingFrame(config, currentPlanLayout)).relativeOutline;
  return rel.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
}
function setOpeningPolygon(points, final) {
  config.openingShape = OPENING_SHAPES.POLYGON;
  config.openingMode = 'given'; // a hand edit of the opening makes it a given one
  config.openingPolygon = final ? sanitizeOpeningPolygon(points) : points;
  rebuild();
  if (final) {
    uiRefresh?.();
    commitHistory();
  }
}
// --- balustrade posts by hand (geometry/railingPostEdits.js): every gesture writes config.railingPostEdits only --------

// Where the stairwell wall along a balustrade's end stops (for the wall handrail past that end): the plan distance
// along the section's path of the wall's far end, when a wall runs beside the path's start ('start') / end ('end');
// else null. The wall: stairwellWalls pieces (inner face a→b), near the path within the wanga + gap + 150 mm.
function railingWallEnd(section, end) {
  const path = section?.path;
  const pieces = lastModels?.stairwellWalls?.pieces || [];
  if (!path?.length || !pieces.length) return null;
  const tip = end === 'start' ? path[0] : path[path.length - 1];
  const tol = (Number(config.stringerThickness) || 0) + Math.max(0, Number(config.stairwellWallGapMm) || 0) + 150;
  let best = null;
  for (const w of pieces) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (!(len > 0)) continue;
    const d = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
    const along = (tip.x - w.a.x) * d.x + (tip.y - w.a.y) * d.y;
    const off = Math.abs((tip.x - w.a.x) * d.y - (tip.y - w.a.y) * d.x);
    if (off > tol || along < -tol || along > len + tol) continue;
    const ends = [w.a, w.b].map((p) => closestOnPolyline(path, p).along);
    const s = end === 'start' ? Math.max(...ends) : Math.min(...ends);
    if (best === null || (end === 'start' ? s > best : s < best)) best = s;
  }
  return best === null ? null : Math.round(best / 10) * 10;
}

// A plan point → the distance along a section's path (`section.path`): on a tread edge (a path vertex) within 8 px it
// snaps to it, else to whole 10 mm.
function railingSAlong(sectionId, raw, mmPerPx) {
  const section = lastModels?.railingModel?.sections?.find((s) => s.id === sectionId);
  if (!section?.path?.length) return null;
  const path = section.path;
  const along = closestOnPolyline(path, raw).along;
  let acc = 0;
  let best = null;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const d = Math.abs(acc - along);
    if (d <= 8 * (mmPerPx || 1) && (!best || d < best.d)) best = { s: acc, d };
  }
  return best ? best.s : Math.round(along / 10) * 10;
}
function applyRailingPosts(change, { final = true } = {}) {
  config.railingPostEdits = applyRailingPostEdit(config.railingPostEdits, change);
  rebuild();
  if (final) commitHistory();
}
// --- the stairwell's walls by hand (geometry/stairwellWallEdits.js): every gesture writes config.stairwellWallList only
function applyWallChange(change, { final = true } = {}) {
  config.stairwellWallList = applyWallEdit(stairwellWallList(config, currentPlanLayout), change);
  rebuild();
  if (final) {
    uiRefresh?.();
    commitHistory();
  }
}
// A wall's end dragged to a plan point: along its side, snapped to the side's ends and the tread edges on that line
// within 8 px, else to whole 10 mm.
function wallDrag(wallId, end, raw, final, mmPerPx) {
  const w = stairwellPlanDrawing(lastModels?.stairwell, config, currentPlanLayout)?.walls?.find((x) => x.id === wallId);
  if (!w || !raw) return;
  const start = { x: w.spanA.x - w.dir.x * w.t0, y: w.spanA.y - w.dir.y * w.t0 };
  const along = (p) => (p.x - start.x) * w.dir.x + (p.y - start.y) * w.dir.y;
  const across = (p) => Math.abs((p.x - start.x) * w.dir.y - (p.y - start.y) * w.dir.x);
  const t = along(raw);
  const tol = 8 * (mmPerPx || 1);
  const snaps = [0, w.sideLength];
  for (const tread of currentPlanLayout?.treads || []) {
    for (const p of (w.line === 'inner' ? tread.innerChain : tread.outerChain) || []) if (across(p) < 1) snaps.push(along(p));
  }
  let best = null;
  for (const s of snaps) if (Math.abs(s - t) <= tol && (best === null || Math.abs(s - t) < Math.abs(best - t))) best = s;
  const value = best ?? Math.round(t / 10) * 10;
  applyWallChange({ action: 'set-span', id: wallId, end, t0: end === 'a' ? value : w.t0, t1: end === 'b' ? value : w.t1, sideLength: w.sideLength }, { final });
}
// --- the plan's tape measure (plan2d/planMeasure.js): two clicks, snapped to the plan's points within 10 px
function planMeasurePoint(raw, mmPerPx) {
  const refs = planMeasureRefs({ planLayout: currentPlanLayout, treadModels: lastModels?.treadModels, posts: lastModels?.allPostModels, openingOutline: lastModels?.ceilingFit?.openingOutline, walls: stairwellPlanDrawing(lastModels?.stairwell, config, currentPlanLayout)?.walls });
  return snapMeasurePoint(raw, refs, 10 * (mmPerPx || 1));
}
function setPlanMeasureMode(on) {
  planMeasureMode = !!on;
  if (planMeasureMode) {
    if (openingMode !== 'off') setOpeningMode('off');
    if (railingPostMode) setRailingPostMode(false);
    if (wallMode) setWallMode(false);
    if (trimMode) setTrimMode(false);
  }
  planMeasureDraft = null;
  plan2dHud.querySelector('[data-action="measure"]')?.classList.toggle('active', planMeasureMode);
  plan2dPanel.classList.toggle('measuring', planMeasureMode);
  const hint = plan2dHud.querySelector('#plan2d-opening-hint');
  if (hint) {
    hint.hidden = !planMeasureMode;
    if (planMeasureMode) hint.textContent = 'Miarka: kliknij pierwszy punkt, potem drugi (przyciąga do narożników stopni, linii wang, słupów, otworu i ścian w promieniu 10 px). Prawy klik — usuń wszystkie pomiary. Pomiary zostają do wyłączenia miarki.';
  }
  if (!planMeasureMode) planMeasures = [];
  regeneratePlan2D();
}

// The opening's trim per edge (openingTrimModel.js): a click flips the edge against its automatic state
function setTrimMode(on) {
  trimMode = on && !!config.openingTrimEnabled;
  if (trimMode && planMeasureMode) setPlanMeasureMode(false);
  if (trimMode && openingMode !== 'off') setOpeningMode('off');
  if (trimMode && railingPostMode) setRailingPostMode(false);
  if (trimMode && wallMode) setWallMode(false);
  plan2dHud.querySelector('[data-action="trim"]')?.classList.toggle('active', trimMode);
  const hint = plan2dHud.querySelector('#plan2d-opening-hint');
  if (hint) {
    hint.hidden = !trimMode && !on;
    if (trimMode) hint.textContent = 'Obróbka otworu (fajka): kliknij krawędź otworu — zielona = z obróbką, szara przerywana = bez; pomarańczowy odcinek przy wyjściu ze schodów (stopień fajkowy) — osobno. Wymiary noska i deski — folder „4. Otwór w stropie”.';
    else if (on) hint.textContent = 'Najpierw włącz „Obróbka otworu (fajka)” w folderze „4. Otwór w stropie”.';
  }
  regeneratePlan2D();
}
function toggleTrimEdge(index) {
  const edge = lastModels?.openingTrim?.edges?.find((e) => e.index === index);
  if (!edge) return;
  const next = { ...(config.openingTrimEdges || {}) };
  if (!edge.enabled === edge.auto) delete next[index];
  else next[index] = !edge.enabled;
  config.openingTrimEdges = next;
  rebuild();
  commitHistory();
}
function setWallMode(on) {
  if (on && trimMode) setTrimMode(false);
  if (on && planMeasureMode) setPlanMeasureMode(false);
  wallMode = on && !!config.stairwellRoomEnabled;
  if (wallMode && openingMode !== 'off') setOpeningMode('off');
  if (wallMode && railingPostMode) setRailingPostMode(false);
  plan2dHud.querySelector('[data-action="walls"]')?.classList.toggle('active', wallMode);
  const hint = plan2dHud.querySelector('#plan2d-opening-hint');
  if (hint) {
    hint.hidden = !wallMode && !on;
    if (wallMode) hint.textContent = 'Ściany klatki: klik na przerywanej linii przy boku schodów — nowa ściana na całym boku (także po drugiej stronie biegu); przeciągnij kółko na końcu ściany — skróć / wydłuż (przyciąga do końców boku i krawędzi stopni); prawy klik na ścianie — usuń. Lista ścian — folder „3. Klatka schodowa”.';
    else if (on) hint.textContent = 'Najpierw włącz wymiary klatki (folder „3. Klatka schodowa”).';
  }
  regeneratePlan2D();
}
function setRailingPostMode(on) {
  railingPostMode = on && !!lastModels?.railingModel?.enabled;
  if (railingPostMode && wallMode) setWallMode(false);
  if (railingPostMode && openingMode !== 'off') setOpeningMode('off');
  plan2dHud.querySelector('[data-action="railing-posts"]')?.classList.toggle('active', railingPostMode);
  const hint = plan2dHud.querySelector('#plan2d-opening-hint');
  if (hint) {
    hint.hidden = !railingPostMode && openingMode === 'off';
    if (railingPostMode) hint.textContent = 'Słupki balustrady: klik na linii balustrady — nowy słupek; przeciągnij słupek (ręczny, narożny albo końcowy) — przesuń (przyciąga do krawędzi stopni); prawy klik — usuń ręczny / przywróć AUTO przesuniętego / wyłącz narożny; klik na przerywanym kółku — przywróć. Bieg bez tralek i poręcz przyścienna — w Inspektorze słupka. Krawędzie otworu (zielone = z balustradą): klik — włącz / wyłącz.';
  }
  if (on && !railingPostMode) {
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'Najpierw włącz balustradę (odcinek przy schodach albo „Balustrada przy otworze w stropie” w folderze „9. Balustrada”).';
    }
  }
  regeneratePlan2D();
}

function setOpeningMode(mode) {
  openingMode = mode;
  if (mode !== 'off' && wallMode) {
    wallMode = false;
    plan2dHud.querySelector('[data-action="walls"]')?.classList.remove('active');
  }
  if (mode !== 'off' && railingPostMode) {
    railingPostMode = false;
    plan2dHud.querySelector('[data-action="railing-posts"]')?.classList.remove('active');
  }

  planApi?.resetDraft();
  const hud = document.querySelector('#plan2d-hud');
  hud?.querySelector('[data-action="opening-edit"]')?.classList.toggle('active', mode === 'edit');
  hud?.querySelector('[data-action="opening-draw"]')?.classList.toggle('active', mode === 'draw');
  const hint = hud?.querySelector('#plan2d-opening-hint');
  if (hint) {
    hint.hidden = mode === 'off';
    hint.textContent =
      mode === 'draw'
        ? 'Rysowanie otworu: klikaj kolejne narożniki (przyciąga do stopni, wang i siatki 5 mm). Zamknij: klik w pierwszy punkt, Enter albo dwuklik. Backspace / prawy klik cofa punkt, Esc anuluje.'
        : 'Edycja otworu: przeciągnij kółko = narożnik, kropkę na boku = nowy narożnik, wnętrze = cały otwór. Prawy klik na narożniku usuwa go.';
  }
  plan2dPanel.classList.toggle('opening-drawing', mode === 'draw');
  regeneratePlan2D();
}
function startOpeningDraw() {
  if (viewState.view !== '2d') setView('2d');
  setOpeningMode('draw');
}
function getOpeningSnapPoints() {
  if (!currentPlanLayout) return [];
  const b = currentPlanLayout.bounds;
  const pts = [...getSnapPoints(), ...(currentPlanLayout.outerFullPath || []), ...(currentPlanLayout.innerFullPath || [])];
  pts.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY });
  for (const p of lastModels?.ceilingFit?.openingOutline || []) pts.push(p);
  // the stairwell's walls: the opening snaps to them
  for (const w of stairwellPlanDrawing(lastModels?.stairwell, config, currentPlanLayout)?.walls || []) pts.push(w.a, w.b);
  return pts;
}

function setView(view) {
  viewState.view = view;
  app.dataset.view = view;
  ws.setView(view);
  const show2d = view === '2d';
  plan2dPanel.classList.toggle('visible', show2d);
  profilePanel.classList.toggle('visible', view === 'profile');
  railingPanel.classList.toggle('visible', view === 'railing');
  if (show2d) {
    if (!planViewport) fitPlanView();
    plan2dSvgContainer.innerHTML = currentPlan2DSVG;
    planApi?.redrawDraft();
    updateScaleReadout();
  } else if (view === 'profile') {
    ws.setStatus({ view: 'Profil wangi (widok z boku)' });
    profileEditor.refresh();
  } else if (view === 'railing') {
    ws.setStatus({ view: 'Profil poręczy (widok z boku)' });
    railingEditor.refresh();
  } else {
    ws.setStatus({ view: `3D: ${sceneApi.getCameraMode() === 'orthographic' ? 'ortogonalny' : 'perspektywa'}` });
  }
}

// ---------------------------------------------------------------------------------------------
// Zmiany parametrów / widoku / projektu
// ---------------------------------------------------------------------------------------------
function handleLiveChange() {
  rebuild();
}
function handleCommitChange() {
  rebuild();
  commitHistory();
}

function handleViewChange(key, value) {
  viewState[key] = value;
  if (key === 'showCeiling') viewportHudApi.syncCeiling(value);
  if (key === 'showWalls') viewportHudApi.syncWalls(value);
  if (key === 'showHeadroom') viewportHudApi.syncHeadroom(value);
  if (['showCeiling', 'showWalls', 'showHeadroom', 'showDimensions', 'showStringerLengths', 'showWinderBlanks', 'showDebug', 'showJoints'].includes(key)) applyOverlayVisibility();
  if (['plan2dShowWinderBlanks', 'plan2dEditMode', 'plan2dLayers'].includes(key)) regeneratePlan2D();
  if (key === 'plan2dEditMode') syncPlanEditButton();
}

// The plan HUD's "✎ Edytuj" button shows whether edge editing is on.
function syncPlanEditButton() {
  const button = document.querySelector('#plan2d-hud [data-action="edit"]');
  if (!button) return;
  button.classList.toggle('active', !!viewState.plan2dEditMode);
  button.setAttribute('aria-pressed', viewState.plan2dEditMode ? 'true' : 'false');
}

// Edycja POJEDYNCZEGO słupa z Inspektora: zmienia wyłącznie config.manualPostOverrides (dane modelu),
// potem zwykły rebuild() — tak samo jak każda inna ręczna korekta. Nic nie dotyka siatki.
function applyPostEdit(postId, change) {
  const overrides = { ...(config.manualPostOverrides || {}) };
  const entry = { ...(overrides[postId] || {}) };
  if (change.field === 'topDeltaMm' || change.field === 'bottomDeltaMm') entry[change.field] = Number.isFinite(change.value) ? change.value : 0;
  else if (change.field === 'sizeMm') {
    if (Number.isFinite(change.value) && change.value > 0) entry.sizeMm = change.value;
    else delete entry.sizeMm;
  }
  else if (change.action === 'remove') entry.removed = true;
  else if (change.action === 'restore') delete entry.removed;
  else if (change.action === 'reset') {
    delete entry.topDeltaMm;
    delete entry.bottomDeltaMm;
    delete entry.sizeMm;
  }
  overrides[postId] = entry;
  config.manualPostOverrides = sanitizePostOverrides(overrides);
  rebuild();
  commitHistory();
}

// Height of a handrail end at its post (Inspektor → słup → "Poręcz przy słupie"): changes ONLY
// config.railingEndOffsets, then the normal rebuild() + a history entry.
function applyRailingEndOffset(key, valueMm) {
  config.railingEndOffsets = sanitizeRailingEndOffsets({ ...(config.railingEndOffsets || {}), [key]: Number.isFinite(valueMm) ? valueMm : 0 });
  rebuild();
  commitHistory();
}

// Krańce odcinka balustrady ustawiane ze stopnia zaznaczonego w planie: zmienia WYŁĄCZNIE config.railingSections
// (dane modelu), potem zwykły rebuild() + wpis do historii, jak każda inna edycja.
function applyRailingEdit(action, sectionId, stepIndex, side) {
  config.railingSections = editRailingSections(config.railingSections, { action, sectionId, stepIndex, side });
  refreshUI(gui);
  rebuild();
  commitHistory();
}

// The balustrade sections from the stairwell's walls (stairwell.js treadsOpenOnOuterSide): on every side with a wall
// along it, one section per run of treads with no wall beside them; a side with no wall keeps its sections. Without
// the stairwell's walls: a hint.
function railingOuterFromWalls() {
  const pieces = lastModels?.stairwellWalls?.pieces;
  const lines = ['outer', 'inner'].filter((line) => lineHasWall(config, line));
  if (!pieces || !lines.length) {
    ws.setStatus({ selection: 'Najpierw włącz wymiary klatki (folder „3. Klatka schodowa”) i dodaj ściany (tryb „▭ Ściany” na planie).' });
    return;
  }
  const stamp = Date.now().toString(36);
  let sections = config.railingSections || [];
  const notes = [];
  for (const line of lines) {
    const ranges = openOuterRailingRanges(treadsOpenOnOuterSide(lastModels.planLayout, pieces, config, line));
    sections = [...sections.filter((s) => s.side !== line), ...ranges.map((r, k) => ({ id: `railing-${stamp}-${line}-${k}`, side: line, ...r }))];
    notes.push(ranges.length ? `${sideShort(line, config)}: ${ranges.map((r) => (r.fromStep === r.toStep ? `stopień ${r.fromStep + 1}` : `stopnie ${r.fromStep + 1}–${r.toStep + 1}`)).join(', ')}` : `${sideShort(line, config)}: wszędzie ściana — bez balustrady`);
  }
  config.railingSections = sections;
  if (sections.length) config.railingEnabled = true;
  ws.setStatus({ selection: `Balustrada ${notes.join('; ')}` });
  refreshUI(gui);
  rebuild();
  commitHistory();
}

// Writes one edge edit, stamped with the tread layout it is made on (edgeOverrides.js edgeLayoutKey). Edits made on
// another layout are out of date (not applied, reported): the first edit on the new layout replaces them.
function setEdgeOverride(boundaryIndex, override) {
  Object.assign(config, withEdgeOverride(config, boundaryIndex, override));
}

function handleResetEdgeOverrides() {
  config.manualEdgeOverrides = {};
  delete config.manualEdgeOverridesLayout;
  config.manualTreadOverhangs = {};
  config.manualPostOverrides = {};
  rebuild();
  commitHistory();
}

// Zbiera wszystkie punkty graniczne (front/back, wewnętrzny+zewnętrzny) obecnego planu, do
// przyciągania "do wyrównania" podczas przeciągania uchwytu — patrz planInteractions.js.
function getSnapPoints() {
  if (!currentPlanLayout) return [];
  const points = [];
  for (const tread of currentPlanLayout.treads) {
    for (const edge of [tread.frontEdge, tread.backEdge]) {
      if (!edge) continue;
      for (const p of edge) points.push(p);
    }
  }
  return points;
}

function resetTakeoffSettings() {
  const fresh = DEFAULT_PRICE_LIST;
  for (const price of takeoffSettings.priceList) {
    const def = fresh.find((p) => p.materialId === price.materialId);
    if (def) Object.assign(price, def);
  }
  Object.assign(takeoffSettings.wasteFactors, DEFAULT_WASTE_FACTORS);
  takeoffSettings.boardPricing = createDefaultBoardPricing();
  takeoffSettings.manualItems = createDefaultManualItems();
}

function handleNewProject() {
  if (!window.confirm('Rozpocząć nowy projekt? Bieżące parametry i ręczne edycje zostaną zastąpione domyślnymi (można to cofnąć przyciskiem Cofnij).')) return;
  Object.assign(config, createDefaultConfig(), NEW_PROJECT_START);
  resetTakeoffSettings();
  Object.assign(appearance, defaultAppearance());
  setAppearance(appearance);
  waivers = [];
  offer.load(undefined);
  pricingEditor.render();
  manualItemsEditor.render();
  projectMeta.name = '';
  projectMeta.notes = '';
  projectMeta.lastFileNote = 'Nowy projekt';
  ws.setProjectMeta({ name: '', notes: '', lastFileNote: projectMeta.lastFileNote });
  document.title = 'Kalkulator schodów 3D';
  refreshUI(gui);
  clearSelectionState();
  planViewport = null;
  rebuild();
  commitHistory();
}

function fileBaseName() {
  return projectFileBaseName(projectMeta.name);
}

function handleSaveProject() {
  const filename = `${fileBaseName()}_projekt.json`;
  exportProjectJSON(config, filename, {
    projectName: projectMeta.name,
    notes: projectMeta.notes,
    takeoffSettings: { priceList: takeoffSettings.priceList, wasteFactors: takeoffSettings.wasteFactors, boardPricing: takeoffSettings.boardPricing, manualItems: takeoffSettings.manualItems },
    waivers,
    appearance: { ...appearance },
    offer: offer.settings(),
  });
  projectMeta.lastFileNote = `Zapisano ${filename} · ${new Date().toLocaleTimeString('pl-PL')} · schemat v${CURRENT_PROJECT_VERSION}`;
  ws.setProjectMeta({ lastFileNote: projectMeta.lastFileNote });
}

function handleFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ''; // pozwala wczytać ten sam plik ponownie z rzędu
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const { config: loadedConfig, meta } = parseProjectFile(reader.result);
      Object.assign(config, createDefaultConfig(), loadedConfig);
      projectMeta.name = meta.projectName;
      projectMeta.notes = meta.notes;
      waivers = meta.waivers;
      Object.assign(appearance, sanitizeAppearance(meta.appearance));
      setAppearance(appearance);
      resetTakeoffSettings();
      if (meta.takeoffSettings) {
        for (const incoming of meta.takeoffSettings.priceList || []) {
          const price = takeoffSettings.priceList.find((p) => p.materialId === incoming.materialId);
          if (price) Object.assign(price, incoming);
        }
        Object.assign(takeoffSettings.wasteFactors, meta.takeoffSettings.wasteFactors || {});
        if (meta.takeoffSettings.boardPricing) takeoffSettings.boardPricing = sanitizeBoardPricing(meta.takeoffSettings.boardPricing);
        if (meta.takeoffSettings.manualItems) takeoffSettings.manualItems = sanitizeManualItems(meta.takeoffSettings.manualItems);
      }
      offer.load(meta.offer);
      pricingEditor.render();
      manualItemsEditor.render();
      projectMeta.lastFileNote = `Wczytano ${file.name} · schemat v${meta.schemaVersion}`;
      ws.setProjectMeta({ name: projectMeta.name, notes: projectMeta.notes, lastFileNote: projectMeta.lastFileNote });
      document.title = projectMeta.name ? `${projectMeta.name} — Kalkulator schodów 3D` : 'Kalkulator schodów 3D';
      refreshUI(gui);
      clearSelectionState();
      planViewport = null;
      rebuild();
      commitHistory();
    } catch (e) {
      alert(`Nie udało się wczytać projektu: ${e.message}`);
    }
  };
  reader.readAsText(file);
}

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'application/json,.json';
fileInput.style.display = 'none';
fileInput.addEventListener('change', handleFileSelected);
document.body.appendChild(fileInput);

// Exports (DXF, takeoff CSV/TXT, OBJ/DAE) — app/exports.js; OBJ/DAE always from clean materials.
const exporter = createExports({
  getModels: () => lastModels,
  getTakeoff: () => lastTakeoff,
  getWaivedCount: () => lastWaived.length,
  getProjectName: () => projectMeta.name,
  getRoot: () => currentRoot,
  // (the client's model: the stairwell's walls and the slab as its 'room' layer)
  getRoom: () => [currentCeiling, currentWalls].filter(Boolean),
  getLogoDataUrl: () => logo.dataUrl(),
  exportSelection,
  withCleanMaterials: (fn) => {
    applySelectionHighlight(currentRoot, null);
    try {
      fn();
    } finally {
      applySelectionHighlight(currentRoot, viewState.clientMode ? null : selection);
    }
  },
});

// ---------------------------------------------------------------------------------------------
// Panele
// ---------------------------------------------------------------------------------------------
const infoPanel = createInfoPanel(ws.leftEl);
// "Szukaj wariantów" (designer/stairwellVariants.js): a short list of stairs fitting the stairwell room; applying one
// writes its patch into config. The list is view state (not undo, not the project file); it is marked out of date
// when an input it was computed from changes.
const STAIRWELL_VARIANT_INPUTS = ['stairwellRoomEnabled', 'stairType', 'turnDirection', 'stairwellSideAMm', 'stairwellSideBMm', 'stairwellSideCMm', 'stairwellSideAFixed', 'stairwellSideBFixed', 'stairwellSideCFixed', 'stairwellWallGapMm', 'openingMode', 'openingShape', 'openingPolygon', 'openingWidth', 'openingLength', 'openingOffsetX', 'openingOffsetY', 'totalRise', 'minRiser', 'maxRiser', 'walklineOffset', 'stringerThickness', 'ceilingThickness', 'minHeadroom'];
const stairwellVariantsKey = () => JSON.stringify(STAIRWELL_VARIANT_INPUTS.map((k) => config[k]));
const variantsState = { result: null, appliedId: null, key: null, ms: null, userWidth: null };
function showStairwellVariants() {
  renderStairwellVariants(variantsPanel, variantsState.result, { appliedId: variantsState.appliedId, userWidth: variantsState.userWidth, ms: variantsState.ms, stale: variantsState.result && variantsState.key !== stairwellVariantsKey() });
}
function searchStairwellVariants() {
  const t0 = performance.now();
  variantsState.userWidth = config.stairWidth;
  variantsState.result = generateStairwellVariants(JSON.parse(JSON.stringify({ ...config, stairWidth: variantsState.userWidth })));
  variantsState.ms = Math.round(performance.now() - t0);
  variantsState.key = stairwellVariantsKey();
  variantsState.appliedId = null;
  showStairwellVariants();
}
function applyStairwellVariant(id) {
  const v = variantsState.result?.variants.find((x) => x.id === id);
  if (!v?.patch) return;
  const { turnSplitOffsetsMm: _shifts, ...patch } = v.patch; // (re-derived live, never stored)
  Object.assign(config, patch);
  variantsState.appliedId = id;
  rebuild();
  uiRefresh?.();
  commitHistory();
  if (viewState.view === '2d') fitPlanView();
}
variantsPanel = createStairwellVariantsPanel(ws.leftEl, { onSearch: searchStairwellVariants, onApply: applyStairwellVariant });
const inspectorPanel = createInspectorPanel(ws.tabBody('inspector'));
inspectorPanel.addEventListener('change', (e) => {
  const key = e.target?.dataset?.postEdit;
  if (key && selection?.elementType === 'post' && selection.postId) applyPostEdit(selection.postId, { field: key, value: Number(e.target.value) });
  const railingEnd = e.target?.dataset?.railingEnd;
  if (railingEnd) applyRailingEndOffset(railingEnd, Number(e.target.value));
  const railingPostS = e.target?.dataset?.railingPostS;
  if (railingPostS) {
    const [sectionId, manualId] = railingPostS.split('|');
    applyRailingPosts({ action: 'move', sectionId, id: manualId, s: Number(e.target.value) });
  }
  // an automatic post's place / a run without infill / the wall handrail past an end (railingPostEdits.js)
  const autoS = e.target?.dataset?.railingAutoS;
  if (autoS) {
    const [sectionId, key] = autoS.split('|');
    applyRailingPosts({ action: 'move-auto', sectionId, key, s: Number(e.target.value) });
  }
  const bareRun = e.target?.dataset?.railingBareRun;
  if (bareRun) {
    const [sectionId, runKey] = bareRun.split('|');
    applyRailingPosts({ action: 'bare', sectionId, runKey, on: e.target.checked });
  }
  const wallRail = e.target?.dataset?.railingWallRail;
  if (wallRail) {
    const [sectionId, end] = wallRail.split('|');
    // a post not moved yet goes to where the stairwell wall along the balustrade ends (railingWallEnd)
    const section = lastModels?.railingModel?.sections?.find((s) => s.id === sectionId);
    const spot = section?.postSpots?.find((x) => x.kind === end);
    if (e.target.checked && spot && !spot.moved) {
      const s = railingWallEnd(section, end);
      if (s !== null) config.railingPostEdits = applyRailingPostEdit(config.railingPostEdits, { action: 'move-auto', sectionId, key: end, s });
      else ws.setStatus({ selection: 'Przy tym końcu balustrady nie ma ściany klatki — przesuń słupek tam, gdzie zaczyna się ściana (tryb „▮ Słupki” albo pole „Od początku odcinka”).' });
    }
    applyRailingPosts({ action: 'wall-rail', sectionId, end, on: e.target.checked });
  }
  // a starter step (geometry/starterSteps.js): marked / unmarked, its parameters
  const starterToggle = e.target?.dataset?.starterToggle;
  if (starterToggle !== undefined) {
    const next = { ...(config.manualStarterTreads || {}) };
    if (e.target.checked) next[starterToggle] = defaultStarterSpec(config);
    else delete next[starterToggle];
    config.manualStarterTreads = next;
    rebuild();
    commitHistory();
  }
  const starterField = e.target?.dataset?.starterField;
  if (starterField) {
    const [index, key] = starterField.split('|');
    const current = config.manualStarterTreads?.[index];
    if (current) {
      const value = key === 'riser' ? e.target.checked : Math.max(0, Number(e.target.value) || 0);
      config.manualStarterTreads = { ...config.manualStarterTreads, [index]: { ...current, [key]: value } };
      rebuild();
      commitHistory();
    }
  }
});
inspectorPanel.addEventListener('click', (e) => {
  // a balustrade post by hand (geometry/railingPostEdits.js): remove a hand-placed one / switch an automatic corner off
  const railPost = e.target?.closest?.('[data-railing-post-action]');
  if (railPost) {
    const { railingPostAction, sectionId, manualId, s } = railPost.dataset;
    if (railingPostAction === 'remove') {
      applyRailingPosts({ action: 'remove', sectionId, id: manualId });
      clearSelectionState?.();
    } else if (railingPostAction === 'suppress') applyRailingPosts({ action: 'suppress', sectionId, s: Number(s) });
    else if (railingPostAction === 'reset-auto') applyRailingPosts({ action: 'reset-auto', sectionId, key: railPost.dataset.key });
    else if (railingPostAction === 'remove-all-manual') {
      applyRailingPosts({ action: 'remove-all-manual', sectionId });
      clearSelectionState?.();
    }
    return;
  }
  const action = e.target?.closest?.('[data-post-action]')?.dataset.postAction;
  if (action && selection?.elementType === 'post' && selection.postId) applyPostEdit(selection.postId, { action });
  const dxfPostId = e.target?.closest?.('[data-post-dxf]')?.dataset.postDxf;
  if (dxfPostId) exporter.postDXF(dxfPostId);
  const dxfStepId = e.target?.closest?.('[data-tread-dxf]')?.dataset.treadDxf;
  if (dxfStepId) exporter.treadDXF(dxfStepId);
  const railingBtn = e.target?.closest?.('[data-railing-action]');
  if (railingBtn && selection?.elementType === 'tread') applyRailingEdit(railingBtn.dataset.railingAction, railingBtn.dataset.sectionId, selection.stepIndex, railingBtn.dataset.side);
});
const validatorPanel = createValidatorPanel(ws.tabBody('validation'), {
  onSelect: handleSelectDiagnostic,
  onWaive: handleWaive,
  onUnwaive: handleUnwaive,
  onClearStale: handleClearStaleWaivers,
});
const structuralPanel = createStructuralPanel(ws.tabBody('structural'), {
  onSelectStep: (stepId) => {
    const stepIndex = stepIndexFromElementId(stepId);
    if (stepIndex !== null) setSelection({ elementType: 'tread', stepIndex });
  },
  onSelectStringer: (side) => setSelection({ elementType: 'stringer', stringerId: side }),
  onSelectPost: (postId) => setSelection({ elementType: 'post', postId }),
});
offer = createOfferController({
  container: ws.tabBody('offer'),
  getTakeoff: () => lastTakeoff,
  getModels: () => lastModels,
  getTakeoffSettings: () => takeoffSettings,
  getWinderStepIds: winderStepIds,
  getLogoDataUrl: () => logo.dataUrl(),
  getProjectName: () => projectMeta.name,
  renderImage3D: offerImage3D,
  renderPlanSVG: offerPlanSVG,
  onClientModel: (kind) =>
    exporter.clientModel(kind).catch((e) => {
      console.error(e);
      window.alert(`Nie udało się zapisać modelu 3D: ${e?.message || e}`);
    }),
});

const takeoffPanel = createTakeoffPanel(ws.tabBody('takeoff'), {
  onSelectItem: handleSelectTakeoffItem,
  onGroupChange: (groupBy) => {
    takeoffGroupBy = groupBy;
    refreshTakeoff();
  },
  onExportCSV: () => exporter.takeoff('csv'),
  onExportTXT: () => exporter.takeoff('txt'),
  onExportPostsDXF: () => exporter.allPostsDXF(),
  onExportRailingDXF: () => exporter.railingDXF(),
  onExportMetalDXF: () => exporter.metalDXF(),
  onExportTrimDXF: () => exporter.trimDXF(),
  onExportTreadsDXF: () => exporter.allTreadsDXF(),
});
// Edytor cennika (gatunek, cennik desek, mnożniki, ceny pozostałych materiałów, odpady): zmienia
// tylko takeoffSettings i przelicza kosztorys — geometria i historia modelu zostają nietknięte.
const manualItemsEditor = createManualItemsEditor(takeoffPanel.querySelector('#takeoff-manual'), { settings: takeoffSettings, onChange: refreshTakeoff });
const pricingEditor = createPricingEditor(takeoffPanel.querySelector('#takeoff-pricing'), { settings: takeoffSettings, onChange: refreshTakeoff });

// Raycaster nie zna `visible` — ukryta warstwa (checkbox w HUD) nie może być zaznaczalna.
function isEffectivelyVisible(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

// Klik w 3D: raycast tylko w to, co buildStaircase() faktycznie wyrenderował (currentRoot —
// nigdy debug/strop/siatka/etykiety), a tożsamość elementu pochodzi z userData.geometrySourceId
// (jawne ID modelu), nie z odgadywania geometrii. Przeciągnięcie (orbit) nie jest kliknięciem.
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pointerDownAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('click', (event) => {
  if (pointerDownAt && Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) > 4) return;
  // the tape measure takes the click while it is on (also in the presentation mode)
  if (measureTool.click(event)) return;
  if (!currentRoot || viewState.clientMode) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, sceneApi.getCamera());
  const hits = raycaster.intersectObject(currentRoot, true).filter((h) => isEffectivelyVisible(h.object));
  const traceabilityData = hits.length > 0 ? resolveTraceability(hits[0].object) : null;
  setSelection(traceabilityData ? selectionFromTakeoffSourceId(traceabilityData.geometrySourceId) : null);
});

const plan2dPanel = document.createElement('div');
plan2dPanel.id = 'plan2d-panel';
ws.mainEl.appendChild(plan2dPanel);

// Edytor profilu wangi (widok z boku): gesty -> zdarzenia PROFILE_EDITS -> config.manualStringerProfileOverrides
// -> zwykłe rebuild(). Panel niczego nie liczy — patrz ui/profileEditorPanel.js.
const profilePanel = document.createElement('div');
profilePanel.id = 'profile-panel';
ws.mainEl.appendChild(profilePanel);
const profileEditor = createProfileEditor(profilePanel, {
  getContext: () => (lastModels ? { config, models: lastModels } : null),
  applyEdit: (edit) => {
    config.manualStringerProfileOverrides = applyProfileEdit(config.manualStringerProfileOverrides, edit);
    rebuild();
  },
  commit: () => commitHistory(),
});

// Edytor linii poręczy (widok z boku jednego biegu): gesty -> RAILING_PROFILE_EDITS -> config.railingProfileOverrides /
// config.railingEndOffsets -> zwykłe rebuild(). Panel niczego nie liczy — patrz ui/railingEditorPanel.js.
const railingPanel = document.createElement('div');
railingPanel.id = 'railing-panel';
ws.mainEl.appendChild(railingPanel);
const railingEditor = createRailingEditor(railingPanel, {
  getContext: () => (lastModels ? { models: lastModels } : null),
  applyEdit: (edit) => {
    Object.assign(config, applyRailingProfileEdit({ railingProfileOverrides: config.railingProfileOverrides, railingEndOffsets: config.railingEndOffsets }, edit));
    rebuild();
  },
  commit: () => commitHistory(),
});

// Architektura DOM planu 2D: plan2dPanel ma DWA stałe, rozłączne dzieci — kontener SVG (jedyne
// miejsce, które regeneratePlan2D() nadpisuje przez innerHTML=) i HUD (przyciski/skala/legenda,
// tworzony RAZ i nigdy nieusuwany). Warstwy: viewport panelu -> rysunek SVG -> nakładka HUD.
const plan2dSvgContainer = document.createElement('div');
plan2dSvgContainer.id = 'plan2d-svg-container';
plan2dPanel.appendChild(plan2dSvgContainer);

const plan2dHud = document.createElement('div');
plan2dHud.id = 'plan2d-hud';
plan2dHud.innerHTML = `
  <div id="plan2d-zoom-controls">
    <button type="button" data-action="edit" aria-pressed="false" title="Edycja krawędzi stopni: przeciągaj kółka na granicach stopni (narożniki), a po kliknięciu stopnia — romby przy jego bokach. To samo co „Edytuj krawędzie” w folderze Plan 2D.">✎ Edytuj</button>
    <button type="button" data-action="opening-draw" title="Narysuj otwór w stropie jako wielokąt: klikaj narożniki na planie">✏ Rysuj otwór</button>
    <button type="button" data-action="opening-edit" title="Edytuj otwór w stropie: przeciągaj narożniki, boki i cały otwór">▭ Otwór</button>
    <button type="button" data-action="railing-posts" title="Słupki balustrady: dodawaj, przesuwaj, usuwaj; wyłączaj słupki narożne">▮ Słupki</button>
    <button type="button" data-action="measure" title="Miarka: kliknij dwa punkty na planie — odległość i Δx / Δy (przyciąga do punktów schodów)">📏 Miarka</button>
    <button type="button" data-action="trim" title="Obróbka otworu w stropie (fajka): włączaj / wyłączaj na krawędziach otworu">▬ Fajka</button>
    <button type="button" data-action="walls" title="Ściany klatki: dodawaj przy każdym boku (po obu stronach biegu), skracaj / wydłużaj, usuwaj">▥ Ściany</button>
    <button type="button" data-action="zoom-out" title="Oddal">−</button>
    <button type="button" data-action="zoom-in" title="Przybliż">+</button>
    <button type="button" data-action="fit" title="Dopasuj do widoku">⤢</button>
  </div>
  <div id="plan2d-opening-hint" hidden></div>
  <div id="plan2d-scale-readout"></div>
  <div id="plan2d-legend">
    <div><span class="swatch" style="border-color:#9aa0a6;border-top-style:dashed"></span>krawędź automatyczna</div>
    <div><span class="swatch" style="border-color:#e08214"></span>krawędź ręcznie zmieniona</div>
    <div><span class="swatch" style="border-color:#c0392b;border-top-style:dashed"></span>linia biegu (walkline)</div>
    <div><span class="swatch" style="border-color:#0f7a3d"></span>granica biegu</div>
    <div><span class="swatch" style="border-color:#1a5fb4"></span>zaznaczony element</div>
  </div>
`;
plan2dPanel.appendChild(plan2dHud);
const scaleReadout = plan2dHud.querySelector('#plan2d-scale-readout');

plan2dHud.querySelector('[data-action="fit"]').addEventListener('click', fitPlanView);
// "✎ Edytuj" — the same view-state switch as "Edytuj krawędzie (przeciąganie)" in the parameter panel's Plan 2D
// folder (both stay in sync: the panel via refreshUI, this button via syncPlanEditButton).
plan2dHud.querySelector('[data-action="edit"]').addEventListener('click', () => {
  handleViewChange('plan2dEditMode', !viewState.plan2dEditMode);
  uiRefresh?.();
});
syncPlanEditButton();
plan2dHud.querySelector('[data-action="opening-draw"]').addEventListener('click', () => setOpeningMode(openingMode === 'draw' ? 'off' : 'draw'));
plan2dHud.querySelector('[data-action="opening-edit"]').addEventListener('click', () => setOpeningMode(openingMode === 'edit' ? 'off' : 'edit'));
plan2dHud.querySelector('[data-action="railing-posts"]').addEventListener('click', () => setRailingPostMode(!railingPostMode));
plan2dHud.querySelector('[data-action="walls"]').addEventListener('click', () => setWallMode(!wallMode));
plan2dHud.querySelector('[data-action="trim"]').addEventListener('click', () => setTrimMode(!trimMode));
plan2dHud.querySelector('[data-action="measure"]').addEventListener('click', () => setPlanMeasureMode(!planMeasureMode));
plan2dHud.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
  const rect = plan2dPanel.getBoundingClientRect();
  planViewport = zoomAt(planViewport, rect.width / 2, rect.height / 2, rect.width, rect.height, 1.3);
  regeneratePlan2D();
});
plan2dHud.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
  const rect = plan2dPanel.getBoundingClientRect();
  planViewport = zoomAt(planViewport, rect.width / 2, rect.height / 2, rect.width, rect.height, 1 / 1.3);
  regeneratePlan2D();
});

// Cała interakcja wskaźnikiem/kołem/klawiaturą na planie 2D. Przeciąganie uchwytów modyfikuje
// WYŁĄCZNIE config (manualEdgeOverrides / manualTreadOverhangs) — nigdy siatki Three.js;
// main.js dowiaduje się o tym tylko przez te callbacki i za każdym razem woła pełne rebuild().
planApi = attachPlanInteractions({
  panelEl: plan2dPanel,
  getViewport: () => planViewport,
  setViewport: (vp) => {
    planViewport = vp;
    regeneratePlan2D();
  },
  getPanelSize: () => {
    const rect = plan2dPanel.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  },
  // the edge being dragged: its pivot on the walkline and its two ends (edgeEdit.js), plus the stringer lines its ends
  // slide along — the stair's inner/outer chain lines, the same lines the nominal edge ends lie on
  getEdgeEditContext: (boundaryIndex) => {
    if (!currentPlanLayout) return null;
    // only the edits in effect: an out-of-date or rejected edit must neither be dragged from nor block its neighbours
    const live = effectiveEdgeOverrides(currentPlanLayout, config.manualEdgeOverrides);
    const at = (i) => boundaryEditPoints(currentPlanLayout, i, live);
    const e = at(boundaryIndex);
    if (!e) return null;
    return { ...e, innerPath: currentPlanLayout.innerFullPath, outerPath: currentPlanLayout.outerFullPath, neighbours: { before: at(boundaryIndex - 1), after: at(boundaryIndex + 1) } };
  },
  onEdgeDragMove: (boundaryIndex, override) => {
    activeEdgeBoundary = boundaryIndex; // keeps the edge red with its pivot shown while it is dragged
    setEdgeOverride(boundaryIndex, override);
    rebuild(); // podgląd na żywo — BEZ wpisu do historii, patrz modelHistory.js
  },
  onEdgeDragEnd: (boundaryIndex, override) => {
    activeEdgeBoundary = null;
    if (!override) {
      regeneratePlan2D(); // a press without a move: nothing changed
      return;
    }
    setEdgeOverride(boundaryIndex, override);
    rebuild();
    commitHistory(); // dopiero puszczenie przeciągnięcia to jedna, zatwierdzona zmiana modelu
  },
  onEdgeContextMenu: (boundaryIndex) => {
    if (config.manualEdgeOverrides[boundaryIndex]) {
      delete config.manualEdgeOverrides[boundaryIndex];
      rebuild();
      commitHistory();
    }
  },
  getSnapPoints,
  onOverhangDragMove: (treadIndex, overhang) => {
    config.manualTreadOverhangs[treadIndex] = overhang;
    rebuild(); // podgląd na żywo — BEZ wpisu do historii
  },
  onOverhangDragEnd: (treadIndex, overhang) => {
    config.manualTreadOverhangs[treadIndex] = overhang;
    rebuild();
    commitHistory();
  },
  onOverhangContextMenu: (treadIndex, side) => {
    if (config.manualTreadOverhangs[treadIndex]?.side === side) {
      delete config.manualTreadOverhangs[treadIndex];
      rebuild();
      commitHistory();
    }
  },
  // Otwór w stropie (tryby „Rysuj otwór" / „▭ Otwór"): punkty przychodzą w układzie planu, config dostaje względne.
  getOpeningMode: () => openingMode,
  getOpeningSnapPoints,
  onOpeningDragStart: () => {
    openingBase = currentOpeningRelative();
  },
  onOpeningVertexMove: (index, point, final) => {
    if (!openingBase) return;
    setOpeningPolygon(moveOpeningVertex(openingBase, index, toOpeningRelative(point)), final);
    if (final) openingBase = null;
  },
  onOpeningInsert: (afterIndex, point) => {
    if (!openingBase) return;
    openingBase = insertOpeningVertex(openingBase, afterIndex, toOpeningRelative(point));
    setOpeningPolygon(openingBase, false);
  },
  onOpeningVertexRemove: (index) => {
    const pts = currentOpeningRelative();
    if (pts.length <= 3) {
      const hint = document.querySelector('#plan2d-opening-hint');
      if (hint) hint.textContent = 'Otwór musi mieć co najmniej 3 narożniki — tego nie można usunąć.';
      return;
    }
    setOpeningPolygon(removeOpeningVertex(pts, index), true);
  },
  onOpeningTranslate: (dx, dy, final) => {
    if (!openingBase) return;
    // (a plan-frame move, turned into the opening's own frame — the room may be rotated against the plan)
    const f = openingFrame(config, currentPlanLayout);
    const o = f.toRelative({ x: 0, y: 0 });
    const d = f.toRelative({ x: dx, y: dy });
    setOpeningPolygon(translateOpening(openingBase, d.x - o.x, d.y - o.y), final);
    if (final) openingBase = null;
  },
  onOpeningDrawFinish: (points) => {
    setOpeningPolygon(points.map(toOpeningRelative), true);
    setOpeningMode('edit'); // od razu można poprawiać narysowany otwór
  },
  onOpeningDrawCancel: () => setOpeningMode('off'),
  // one edge of the opening moved along its normal (plan-frame shift → the opening's own frame)
  onOpeningEdgeMove: (index, shift, final) => {
    if (!openingBase) return;
    const f = openingFrame(config, currentPlanLayout);
    const o = f.toRelative({ x: 0, y: 0 });
    const d = f.toRelative(shift);
    const n = openingBase.length;
    const moved = openingBase.map((p, i) => (i === index || i === (index + 1) % n ? { x: Math.round((p.x + d.x - o.x) * 10) / 10, y: Math.round((p.y + d.y - o.y) * 10) / 10 } : p));
    setOpeningPolygon(moved, final);
    if (final) openingBase = null;
  },
  // Kliknięcia ustawiają WYŁĄCZNIE zaznaczenie (nie model, nie historia).
  onStepClick: (stepIndex) => setSelection(stepIndex === null ? null : { elementType: 'tread', stepIndex }),
  onStringerClick: (side) => setSelection({ elementType: 'stringer', stringerId: side, segmentId: null }),
  onPostClick: (postId) => setSelection({ elementType: 'post', postId }),
  getRailingPostMode: () => railingPostMode,
  getWallMode: () => wallMode,
  getTrimMode: () => trimMode,
  getMeasureMode: () => planMeasureMode,
  onMeasureClick: (raw, mmPerPx) => {
    const p = planMeasurePoint(raw, mmPerPx);
    if (!planMeasureDraft) planMeasureDraft = { a: p, cursor: null };
    else {
      planMeasures = [...planMeasures, { a: planMeasureDraft.a, b: p }];
      planMeasureDraft = null;
    }
    regeneratePlan2D();
  },
  onMeasureMove: (raw, mmPerPx) => {
    if (!planMeasureDraft) return;
    planMeasureDraft = { ...planMeasureDraft, cursor: planMeasurePoint(raw, mmPerPx) };
    regeneratePlan2D();
  },
  onMeasureClear: () => {
    planMeasures = [];
    planMeasureDraft = null;
    regeneratePlan2D();
  },
  onTrimEdgeToggle: (index) => toggleTrimEdge(index),
  onTrimExitToggle: () => {
    config.openingTrimExit = !(lastModels?.openingTrim?.exit?.enabled ?? config.openingTrimExit !== false);
    rebuild();
    commitHistory();
  },
  onWallAdd: (side, line) => applyWallChange({ action: 'add', side, line }),
  onWallDrag: (wallId, end, raw, final, mmPerPx) => wallDrag(wallId, end, raw, final, mmPerPx),
  onWallRemove: (wallId) => applyWallChange({ action: 'remove', id: wallId }),
  onRailingPostAdd: (sectionId, raw, mmPerPx) => {
    const s = railingSAlong(sectionId, raw, mmPerPx);
    if (s === null) return;
    const before = new Set((config.railingPostEdits?.[sectionId]?.added || []).map((p) => p.id));
    applyRailingPosts({ action: 'add', sectionId, s });
    const added = (config.railingPostEdits?.[sectionId]?.added || []).find((p) => !before.has(p.id));
    if (added) setSelection({ elementType: 'post', postId: manualRailingPostId(sectionId, added.id) });
  },
  onRailingPostDrag: (sectionId, manualId, raw, final, mmPerPx, spotKey) => {
    const s = railingSAlong(sectionId, raw, mmPerPx);
    if (s === null) return;
    if (manualId) applyRailingPosts({ action: 'move', sectionId, id: manualId, s }, { final });
    else if (spotKey) applyRailingPosts({ action: 'move-auto', sectionId, key: spotKey, s }, { final });
  },
  onRailingPostReset: (sectionId, key) => applyRailingPosts({ action: 'reset-auto', sectionId, key }),
  // a starter step's handle dragged on the plan (geometry/starterSteps.js starterDragValue): one undo step per drag
  onStarterHandleDrag: (index, kind, point, final) => {
    const tread = lastModels?.planLayout?.treads?.[index];
    const current = config.manualStarterTreads?.[index];
    const patch = tread && current ? starterDragValue(tread, kind, point) : null;
    if (!patch) return;
    config.manualStarterTreads = { ...config.manualStarterTreads, [index]: { ...current, ...patch } };
    rebuild();
    if (final) commitHistory();
  },
  onRailingPostRemove: (sectionId, manualId) => applyRailingPosts({ action: 'remove', sectionId, id: manualId }),
  onRailingPostSuppress: (sectionId, s) => applyRailingPosts({ action: 'suppress', sectionId, s }),
  onRailingPostRestore: (sectionId, s) => applyRailingPosts({ action: 'restore', sectionId, s }),
  // an edge of the ceiling opening: its balustrade on / off (back to AUTO when it equals the automatic choice)
  onRailingOpeningEdgeToggle: (index) => {
    const edge = lastModels?.railingModel?.openingEdges?.find((e) => e.index === index);
    if (!edge) return;
    const next = { ...(config.railingOpeningEdges || {}) };
    if (!edge.enabled === edge.auto) delete next[index];
    else next[index] = !edge.enabled;
    config.railingOpeningEdges = next;
    rebuild();
    commitHistory();
  },
});

const gui = createUI({
  config,
  container: ws.leftEl,
  onChange: handleLiveChange,
  onCommit: handleCommitChange,
  viewState,
  onViewChange: handleViewChange,
  onFitPlanView: fitPlanView,
  // the frame the opening is aligned in: the stair and its walls in the wall frame (x from wall A, y from the end
  // wall), else the stair's plan
  getPlanBounds: () => {
    const frame = lastModels?.stairwell?.frame;
    const L = lastModels?.planLayout;
    if (!frame || !L) return L?.bounds ?? null;
    const pts = [...(L.outerFullPath || []), ...(L.innerFullPath || [])].map(frame.toRelative);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { minX: 0, maxX: Math.max(...xs) - Math.min(0, Math.min(...xs)), minY: 0, maxY: Math.max(...ys) - Math.min(0, Math.min(...ys)) };
  },
  onStartOpeningDraw: () => startOpeningDraw(),
  onFindStairwellVariants: () => searchStairwellVariants(),
  onGenerateStair: () => generateStair(),
  onRailingOuterFromWalls: () => railingOuterFromWalls(),
  // the panel's wall list (folder 3): the walls as they are (with their lengths), and its edits
  getWalls: () => {
    const drawn = stairwellPlanDrawing(lastModels?.stairwell, config, currentPlanLayout)?.walls || [];
    return stairwellWallList(config, currentPlanLayout).map((w) => ({ ...w, lengthMm: drawn.find((d) => d.id === w.id)?.lengthMm ?? null }));
  },
  onWallEdit: (change) => applyWallChange(change),
  onWallMode: () => {
    if (viewState.view !== '2d') setView('2d');
    setWallMode(true);
  },
  onFreezeDerivedOpening: () => {
    const rel = lastModels?.ceilingFit?.openingMode === 'derived' ? lastModels.ceilingFit.openingRelativeOutline : null;
    if (!rel) return;
    setOpeningPolygon(rel.map((p) => ({ x: p.x, y: p.y })), true);
  },
  appearance,
  onAppearanceChange: () => {
    setAppearance(appearance);
    rebuild();
  },
  onResetEdgeOverrides: handleResetEdgeOverrides,
  exportSelection,
  exportHandlers: {
    onExportOBJ: () => exporter.obj(),
    onExportDAE: () => exporter.dae(),
  },
  onExportPlan2D: () => exportPlan2DSVG(currentPlan2DSVG),
});
// the panel's wangi names follow the stair type (an S: lewa / prawa)
afterRebuild.push(() => gui.syncSideNames?.());

uiRefresh = () => refreshUI(gui);
setAppearance(appearance); // domyślne wykończenie = dąb (tekstura) — musi być na materiałach od startu
setView(viewState.view);
rebuild();
updateHistoryButtons();
ws.setProjectMeta({ name: '', notes: '', lastFileNote: '' });

window.addEventListener('resize', () => {
  if (plan2dPanel.classList.contains('visible')) updateScaleReadout();
});
