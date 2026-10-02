import * as THREE from 'three';
import './style.css';
import { createDefaultConfig } from './config/schema.js';
import { buildStaircase, setAppearance } from './geometry/buildStaircase.js';
import { defaultAppearance, sanitizeAppearance } from './scene/appearance.js';
import { defaultLogoSettings, sanitizeLogoSettings, logoRect, presentationFileName } from './scene/presentationImage.js';
import { treadJointsByStep } from './geometry/jointSolver.js';
import { editRailingSections } from './geometry/railingSolver.js';
import { sanitizePostOverrides } from './geometry/postSolver.js';
import { applyProfileEdit } from './geometry/stringerProfileModel.js';
import { createProfileEditor } from './ui/profileEditorPanel.js';
import { planToWorld } from './geometry/geometryUtils.js';
import { createScene } from './scene/sceneSetup.js';
import { buildDimensionLabels, buildStringerLengthLabels, buildWinderBlankLabels } from './scene/dimensionLabels.js';
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
import { GROUP_BY, summarizeByCategory } from './ui/takeoffView.js';
import { stepIndexFromElementId, selectionFromTakeoffSourceId } from './ui/selection.js';
import { buildPricedMaterialTakeoff, DEFAULT_PRICE_LIST, takeoffToCSV, takeoffToTextReport } from './takeoff/index.js';
import { DEFAULT_WASTE_FACTORS } from './takeoff/wasteFactors.js';
import { createDefaultBoardPricing, sanitizeBoardPricing } from './takeoff/boardPricing.js';
import { createPricingEditor } from './ui/pricingEditor.js';
import { createManualItemsEditor } from './ui/manualItemsEditor.js';
import { createDefaultManualItems, sanitizeManualItems, applyManualItems } from './takeoff/manualItems.js';
import { addWaiver, removeWaiver } from './diagnostics/waivers.js';
import { exportStaircaseToOBJ } from './export/objExporter.js';
import { exportStaircaseToDAE } from './export/daeExporter.js';
import { downloadTextFile } from './export/downloadTextFile.js';
import { buildPostDXF, buildAllPostsDXF, buildTreadDXF, buildAllTreadsDXF, buildRailingDXF } from './export/dxfExport.js';
import { renderPlan2DSVG, planSvgBounds } from './plan2d/plan2dRenderer.js';
import { resolveOpening, sanitizeOpeningPolygon, moveOpeningVertex, insertOpeningVertex, removeOpeningVertex, translateOpening, OPENING_SHAPES } from './geometry/ceilingOpening.js';
import { exportPlan2DSVG } from './plan2d/exportPlan2D.js';
import { fitToBounds, zoomAt, nearestStandardScale, pixelsPerMm } from './plan2d/viewport.js';
import { boundaryEditPoints } from './plan2d/edgeEdit.js';
import { attachPlanInteractions } from './plan2d/planInteractions.js';
import { exportProjectJSON, parseProjectFile, CURRENT_PROJECT_VERSION } from './project/projectIO.js';
import { buildOffer, stairFacts, separableCategories, createDefaultOfferSettings, sanitizeOfferSettings, sanitizeCompany, suggestOfferNumber } from './offer/offerModel.js';
import { buildOfferHTML } from './offer/offerDocument.js';
import { createOfferPanel, fillOfferForm, updateOfferPanel } from './ui/offerPanel.js';
import { createHistory, commit, undo as historyUndo, redo as historyRedo, canUndo, canRedo } from './history/modelHistory.js';

// ARCHITEKTURA (etap 10): main.js tylko ŁĄCZY moduły — UI zmienia model (config), woła rebuild(),
// a wszystkie panele/widoki są renderowane z już-rozwiązanych modeli. Żaden panel ani interakcja
// nie liczy geometrii: model -> rebuild() -> modele -> (2D SVG | 3D renderer | walidacja | kosztorys).
const app = document.getElementById('app');

const config = createDefaultConfig();
const viewState = {
  showCeiling: true,
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
// Oferta dla Klienta (offer/): ustawienia to dane PROJEKTU (zapisywane w pliku, poza `config` i historią modelu),
// dane firmy to ustawienie FIRMY — w tej przeglądarce, jak logo prezentacji.
let offerSettings = createDefaultOfferSettings();
const COMPANY_STORAGE_KEY = 'stair3d.company';
let company = (() => {
  try {
    return sanitizeCompany(JSON.parse(localStorage.getItem(COMPANY_STORAGE_KEY) || 'null'));
  } catch {
    return sanitizeCompany(null);
  }
})();
let offerPanel = null;
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
let currentDimLabels = null;
let currentStringerLengthLabels = null;
let currentWinderBlankLabels = null;
let currentDebugOverlay = null;
let currentJointMarkers = null;
let currentPlanLayout = null;
let currentDerived = null;
let currentPlan2DSVG = '';
let lastModels = null;
let lastDiagnostics = []; // AKTYWNE (bez objętych wyjątkiem)
let lastWaived = [];
let lastStaleWaivers = [];
let lastTakeoff = null;
let planViewport = null; // {x,y,width,height} — patrz plan2d/viewport.js; null = jeszcze nie dopasowany
// Otwór w stropie na planie 2D: 'off' | 'edit' (uchwyty wierzchołków) | 'draw' (klikanie nowego wielokąta).
// Stan WIDOKU — nie trafia do historii ani do pliku; zmienia się tylko config.openingShape/openingPolygon.
let openingMode = 'off';
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
let fitWasEnabled = false;

function rebuild() {
  for (const group of [currentRoot, currentCeiling, currentDimLabels, currentStringerLengthLabels, currentWinderBlankLabels, currentDebugOverlay, currentJointMarkers]) {
    if (!group) continue;
    scene.remove(group);
    disposeGroup(group);
  }

  // Kolejność zgodna z architekturą: solver 2D (planLayout) -> wangi -> podstopnie -> słupy ->
  // 3D. buildStaircase.js jest jedynym miejscem, które składa modele w drzewo Three.js.
  const built = buildStaircase(config);
  const { root, ceilingMesh, derived, planLayout, ceilingFit, fullConfig, treadModels, riserModels, stringerModels } = built;
  lastModels = built;
  // "Dopasuj do klatki": the stair was built from the fitted going/counts (buildStaircase applies the fit itself);
  // they are copied into config so the sliders, the project file and undo show what the stair really is — like an
  // AUTO value. The fit depends only on the targets and the other parameters, never on these fields, so copying
  // them back changes nothing on the next rebuild.
  const fitValues = built.stairwellFit?.values;
  if (fitValues) Object.assign(config, fitValues);
  if (config.stairwellFitEnabled || fitWasEnabled) uiRefresh?.();
  fitWasEnabled = !!config.stairwellFitEnabled;

  scene.add(root);
  scene.add(ceilingMesh);
  currentRoot = root;
  // cień słońca obejmuje dokładnie te schody (sceneSetup.js fitShadowToBox)
  sceneApi.fitShadowToBox(new THREE.Box3().setFromObject(root));
  currentCeiling = ceilingMesh;

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
  const counts = updateValidatorPanel(validatorPanel, lastDiagnostics, { selectedDiagnostic, waivedDiagnostics: lastWaived, staleWaivers: lastStaleWaivers });
  renderTakeoffPanel();
  updateStructuralPanel(structuralPanel, built.structural);

  applyOverlayVisibility();
  applyLayerVisibility();
  refreshSelectionViews();
  updateStatus(counts);
  // Edytor profilu rysuje się z TYCH SAMYCH modeli — po każdym przeliczeniu (także w trakcie przeciągania
  // punktu) odświeżamy go, jeśli jest widoczny.
  if (viewState.view === 'profile' && typeof profileEditor !== 'undefined') profileEditor.refresh();
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
  updateStructuralPanel(structuralPanel, lastModels.structural);
}

function renderTakeoffPanel() {
  updateTakeoffPanel(takeoffPanel, lastTakeoff, {
    groupBy: takeoffGroupBy,
    selectedItemId: selectedTakeoffItemId,
    priceList: takeoffSettings.priceList,
    wasteFactors: takeoffSettings.wasteFactors,
    boardPricing: takeoffSettings.boardPricing,
    winderStepIds: winderStepIds(),
  });
  refreshOffer();
  if (lastTakeoff.status === 'BLOCKED') ws.setTabBadge('takeoff', '!', 'error');
  else ws.setTabBadge('takeoff', `≈${Math.round(lastTakeoff.totalCost).toLocaleString('pl-PL')} zł`, lastTakeoff.status === 'WARNING' ? 'warning' : 'info');
}

function manualEditCount() {
  return Object.keys(config.manualEdgeOverrides || {}).length + Object.keys(config.manualTreadOverhangs || {}).length + Object.keys(config.manualPostOverrides || {}).length;
}

function updateStatus(counts) {
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
  if (currentDimLabels) currentDimLabels.visible = viewState.showDimensions && technical;
  if (currentStringerLengthLabels) currentStringerLengthLabels.visible = viewState.showStringerLengths && technical;
  if (currentWinderBlankLabels) currentWinderBlankLabels.visible = viewState.showWinderBlanks && technical;
  if (currentDebugOverlay) currentDebugOverlay.visible = viewState.showDebug && technical;
  if (currentJointMarkers) currentJointMarkers.visible = viewState.showJoints && technical;
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
  onJointsChange: (visible) => handleViewChange('showJoints', visible),
  onBackgroundChange: (hex) => sceneApi.setBackground(hex),
  onSnapshot: () => savePresentationSnapshot(),
  onLogoFile: (file) => loadLogoFile(file),
  onLogoRemove: () => {
    logoSettings = { ...logoSettings, dataUrl: null };
    storeLogoSettings();
    applyLogo('Logo usunięte.');
  },
  onLogoSettings: (patch) => {
    logoSettings = sanitizeLogoSettings({ ...logoSettings, ...patch });
    storeLogoSettings();
    placeLogoOverlay();
  },
});

// ---------------------------------------------------------------------------------------------
// Tryb prezentacji: logo firmy (na ekranie i na zdjęciach) + „Zapisz zdjęcie". Logo to ustawienie FIRMY, nie
// projektu: pamiętane w tej przeglądarce (localStorage), nie w pliku projektu i nie w historii modelu.
// ---------------------------------------------------------------------------------------------
const LOGO_STORAGE_KEY = 'stair3d.presentationLogo';
const LOGO_MAX_PX = 1200; // większe logo jest zmniejszane przed zapamiętaniem (ostre na zdjęciu 2×, mieści się w pamięci)
let logoSettings = (() => {
  try {
    return sanitizeLogoSettings(JSON.parse(localStorage.getItem(LOGO_STORAGE_KEY) || 'null'));
  } catch {
    return defaultLogoSettings();
  }
})();
let logoStoreFailed = false;
function storeLogoSettings() {
  try {
    localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify(logoSettings));
    logoStoreFailed = false;
  } catch {
    logoStoreFailed = true; // np. tryb prywatny / brak miejsca — logo działa do zamknięcia karty
  }
}

const logoOverlay = document.createElement('img');
logoOverlay.id = 'presentation-logo';
logoOverlay.className = 'client-only';
logoOverlay.alt = 'Logo';
logoOverlay.hidden = true;
ws.mainEl.appendChild(logoOverlay);

// Logo na ekranie w tym samym miejscu i tej samej wielkości (względnie) co na zdjęciu — logoRect, jedna formuła.
function placeLogoOverlay() {
  const has = !!logoSettings.dataUrl && logoOverlay.complete && logoOverlay.naturalWidth >= 0;
  logoOverlay.hidden = !logoSettings.dataUrl;
  if (!has) return;
  const box = viewport.getBoundingClientRect();
  const hostBox = ws.mainEl.getBoundingClientRect();
  const r = logoRect({ imageWidth: box.width, imageHeight: box.height, logoWidth: logoOverlay.naturalWidth || 1, logoHeight: logoOverlay.naturalHeight || 1, corner: logoSettings.corner, sizePct: logoSettings.sizePct });
  Object.assign(logoOverlay.style, { left: `${box.left - hostBox.left + r.x}px`, top: `${box.top - hostBox.top + r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
}
function applyLogo(message = '') {
  if (logoSettings.dataUrl) {
    logoOverlay.onload = () => placeLogoOverlay();
    logoOverlay.src = logoSettings.dataUrl;
  } else {
    logoOverlay.removeAttribute('src');
  }
  placeLogoOverlay();
  viewportHudApi.syncLogo(logoSettings, logoStoreFailed ? `${message} Uwaga: przeglądarka nie pozwoliła zapamiętać logo — będzie dostępne do zamknięcia karty.`.trim() : message);
}
window.addEventListener('resize', placeLogoOverlay);
new ResizeObserver(placeLogoOverlay).observe(viewport);

// Wczytanie pliku logo: SVG bez zmian, obraz rastrowy zmniejszony do LOGO_MAX_PX (PNG — przezroczystość zostaje).
function loadLogoFile(file) {
  if (!/^image\//.test(file.type)) {
    viewportHudApi.syncLogo(logoSettings, 'To nie jest plik obrazu.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    const done = (url) => {
      logoSettings = sanitizeLogoSettings({ ...logoSettings, dataUrl: url });
      storeLogoSettings();
      applyLogo(`Wczytano: ${file.name}`);
    };
    if (file.type === 'image/svg+xml') return done(dataUrl);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale >= 1) return done(dataUrl);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      done(c.toDataURL('image/png'));
    };
    img.onerror = () => viewportHudApi.syncLogo(logoSettings, 'Nie udało się odczytać obrazu.');
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

// „Zapisz zdjęcie": render 2× + logo w wybranym rogu -> PNG do pobrania.
// --- Oferta dla Klienta -------------------------------------------------------------------------------------
// Pozycje i sumy liczy offer/offerModel.js z tego, co kosztorys już wycenił; tu tylko zbieramy dane i obrazy.
function currentOffer() {
  if (!lastTakeoff) return null;
  const summary = summarizeByCategory(lastTakeoff.items, { winderStepIds: winderStepIds() });
  return {
    summary,
    offer: buildOffer({ summary, manualItems: takeoffSettings.manualItems, settings: offerSettings, blocked: lastTakeoff.status === 'BLOCKED' }),
  };
}

function refreshOffer() {
  if (!offerPanel) return;
  const current = currentOffer();
  if (!current) return;
  updateOfferPanel(offerPanel, { offer: current.offer, categories: separableCategories(current.summary), settings: offerSettings });
}

// Obraz 3D do oferty: wygląd jak w trybie prezentacji (bez siatki, osi, stropu i nakładek technicznych), osobna kamera
// w widoku izometrycznym; potem przywrócenie tego, co było widać.
function offerImage3D() {
  if (!lastModels) return null;
  const b = lastModels.planLayout.bounds;
  const rise = lastModels.fullConfig.totalRise;
  const center = planToWorld((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, rise / 2);
  // a little more room than the on-screen "Dopasuj" — the whole stair with its posts must fit the picture
  const radius = 0.6 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, rise);
  const hidden = [sceneApi.helpers.grid, sceneApi.helpers.axes, sceneApi.helpers.shadowCatcher, currentCeiling, currentDebugOverlay, currentJointMarkers, currentDimLabels, currentStringerLengthLabels, currentWinderBlankLabels].filter(Boolean);
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
    posts: lastModels.postModels || [],
    stringerModels: lastModels.stringerModels,
    stringerConstruction: lastModels.stringerConstruction,
    railingModel: lastModels.railingModel ?? null,
  });
}

function generateOfferPDF() {
  const current = currentOffer();
  if (!current || !lastModels) return;
  if (current.offer.lines.length === 0) {
    window.alert(current.offer.warnings[0] || 'Brak pozycji do wyceny.');
    return;
  }
  const bp = takeoffSettings.boardPricing || {};
  const html = buildOfferHTML({
    offer: current.offer,
    facts: stairFacts(lastModels.fullConfig, lastModels.derived, { material: [bp.species, bp.cls].filter(Boolean).join(', ') }),
    settings: offerSettings,
    company,
    logoDataUrl: logoSettings.dataUrl,
    image3d: offerImage3D(),
    planSvg: offerPlanSVG(),
    projectName: projectMeta.name,
  });
  // Druk przez ukrytą ramkę: okno drukowania przeglądarki → „Zapisz jako PDF” (bez biblioteki PDF, polskie znaki
  // i obrazy działają od razu). Tytuł dokumentu = domyślna nazwa pliku.
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

function savePresentationSnapshot() {
  const canvas = sceneApi.captureImage(2);
  const ctx = canvas.getContext('2d');
  if (logoSettings.dataUrl && logoOverlay.complete && logoOverlay.naturalWidth > 0) {
    const r = logoRect({ imageWidth: canvas.width, imageHeight: canvas.height, logoWidth: logoOverlay.naturalWidth, logoHeight: logoOverlay.naturalHeight, corner: logoSettings.corner, sizePct: logoSettings.sizePct });
    ctx.drawImage(logoOverlay, r.x, r.y, r.width, r.height);
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = presentationFileName(projectMeta.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
applyLogo();

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
      postModels: lastModels.allPostModels, // także usunięte (oznaczone) — Inspektor pokazuje "Przywróć"
      manualCount: manualEditCount(),
    });
  }
  markValidatorSelection(validatorPanel, selectedDiagnostic);
  markTakeoffSelection(takeoffPanel, selectedTakeoffItemId);
  ws.setStatus({ selection: selectionLabel(selection) });
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
  const bounds = planSvgBounds(currentPlanLayout, lastModels?.ceilingFit?.openingOutline || []);
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
    railingModel: lastModels?.railingModel ?? null,
    opening: lastModels?.ceilingFit
      ? { outline: lastModels.ceilingFit.openingOutline, shape: lastModels.ceilingFit.openingShape, invalidReason: lastModels.ceilingFit.openingInvalidReason }
      : null,
    openingEdit: openingMode === 'edit',
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
function planOrigin() {
  const b = currentPlanLayout?.bounds;
  return { x: b?.minX ?? 0, y: b?.minY ?? 0 };
}
function toOpeningRelative(p) {
  const o = planOrigin();
  return { x: Math.round((p.x - o.x) * 10) / 10, y: Math.round((p.y - o.y) * 10) / 10 };
}
// Otwór, jaki jest teraz (prostokąt albo wielokąt), jako wielokąt względny — z niego startuje każda edycja,
// więc pierwsze przeciągnięcie prostokąta zamienia go w wielokąt o tych samych 4 narożnikach.
function currentOpeningRelative() {
  if (!currentPlanLayout) return [];
  const o = resolveOpening(config, currentPlanLayout.bounds);
  const origin = planOrigin();
  return o.outline.map((p) => ({ x: Math.round((p.x - origin.x) * 10) / 10, y: Math.round((p.y - origin.y) * 10) / 10 }));
}
function setOpeningPolygon(points, final) {
  config.openingShape = OPENING_SHAPES.POLYGON;
  config.openingPolygon = final ? sanitizeOpeningPolygon(points) : points;
  rebuild();
  if (final) {
    uiRefresh?.();
    commitHistory();
  }
}
function setOpeningMode(mode) {
  openingMode = mode;
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
  return pts;
}

function setView(view) {
  viewState.view = view;
  app.dataset.view = view;
  ws.setView(view);
  const show2d = view === '2d';
  plan2dPanel.classList.toggle('visible', show2d);
  profilePanel.classList.toggle('visible', view === 'profile');
  if (show2d) {
    if (!planViewport) fitPlanView();
    plan2dSvgContainer.innerHTML = currentPlan2DSVG;
    planApi?.redrawDraft();
    updateScaleReadout();
  } else if (view === 'profile') {
    ws.setStatus({ view: 'Profil wangi (widok z boku)' });
    profileEditor.refresh();
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
  if (['showCeiling', 'showDimensions', 'showStringerLengths', 'showWinderBlanks', 'showDebug', 'showJoints'].includes(key)) applyOverlayVisibility();
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

// Krańce odcinka balustrady ustawiane ze stopnia zaznaczonego w planie: zmienia WYŁĄCZNIE config.railingSections
// (dane modelu), potem zwykły rebuild() + wpis do historii, jak każda inna edycja.
function applyRailingEdit(action, sectionId, stepIndex, side) {
  config.railingSections = editRailingSections(config.railingSections, { action, sectionId, stepIndex, side });
  refreshUI(gui);
  rebuild();
  commitHistory();
}

function handleResetEdgeOverrides() {
  config.manualEdgeOverrides = {};
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
  Object.assign(config, createDefaultConfig());
  resetTakeoffSettings();
  Object.assign(appearance, defaultAppearance());
  setAppearance(appearance);
  waivers = [];
  offerSettings = createDefaultOfferSettings();
  if (offerPanel) fillOfferForm(offerPanel, offerSettings, company);
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
  const slug = projectMeta.name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'schody';
}

function handleSaveProject() {
  const filename = `${fileBaseName()}_projekt.json`;
  exportProjectJSON(config, filename, {
    projectName: projectMeta.name,
    notes: projectMeta.notes,
    takeoffSettings: { priceList: takeoffSettings.priceList, wasteFactors: takeoffSettings.wasteFactors, boardPricing: takeoffSettings.boardPricing, manualItems: takeoffSettings.manualItems },
    waivers,
    appearance: { ...appearance },
    offer: offerSettings,
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
      offerSettings = sanitizeOfferSettings(meta.offer);
      if (offerPanel) fillOfferForm(offerPanel, offerSettings, company);
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

// Eksport OBJ/DAE zawsze z czystych materiałów (bez podświetlenia zaznaczenia) — widok i eksport
// nie mogą na siebie wpływać.
function withoutHighlight(fn) {
  applySelectionHighlight(currentRoot, null);
  try {
    fn();
  } finally {
    applySelectionHighlight(currentRoot, viewState.clientMode ? null : selection);
  }
}

function exportPostDXF(postId) {
  const post = lastModels?.allPostModels?.find((p) => p.postId === postId);
  const j = lastModels?.joints;
  const dxf = post ? buildPostDXF(post, j?.pocketsByPost?.[post.postId] || [], { holes: j?.holesByPost?.[post.postId] || [], weakening: j?.postWeakening?.[post.postId] || null }) : null;
  if (dxf) downloadTextFile(dxf, `${fileBaseName()}_slup_${postId}.dxf`, 'application/dxf');
}

function exportAllPostsDXF() {
  const j = lastModels?.joints;
  const dxf = lastModels?.postModels ? buildAllPostsDXF(lastModels.postModels, j?.pocketsByPost || {}, { holesByPost: j?.holesByPost || {}, postWeakening: j?.postWeakening || {} }) : null;
  if (dxf) downloadTextFile(dxf, `${fileBaseName()}_slupy.dxf`, 'application/dxf');
}

function exportTreadDXF(stepId) {
  const tread = lastModels?.treadModels?.find((t) => t.stepId === stepId);
  const dxf = tread ? buildTreadDXF(tread, treadJointsByStep(lastModels?.joints, lastModels?.postModels)[tread.stepId] || null) : null;
  if (dxf) downloadTextFile(dxf, `${fileBaseName()}_${stepId}.dxf`, 'application/dxf');
}

function exportAllTreadsDXF() {
  const dxf = lastModels?.treadModels ? buildAllTreadsDXF(lastModels.treadModels, treadJointsByStep(lastModels?.joints, lastModels?.postModels)) : null;
  if (dxf) downloadTextFile(dxf, `${fileBaseName()}_stopnie.dxf`, 'application/dxf');
}

// The whole balustrade (handrail pieces with their cuts + the baluster cut list) on one 1:1 sheet. Nothing to draw
// (no balustrade / no valid section) -> a message instead of an empty file.
function exportRailingDXF() {
  const dxf = lastModels?.railingModel ? buildRailingDXF(lastModels.railingModel, { balusterSizeMm: lastModels.fullConfig.railingBalusterSizeMm }) : null;
  if (dxf) downloadTextFile(dxf, `${fileBaseName()}_balustrada.dxf`, 'application/dxf');
  else window.alert('Brak balustrady do narysowania — włącz balustradę i dodaj odcinek.');
}

function exportTakeoff(kind) {
  if (!lastTakeoff || lastTakeoff.status === 'BLOCKED') return;
  const base = fileBaseName();
  if (kind === 'csv') downloadTextFile(takeoffToCSV(lastTakeoff.items), `${base}_zestawienie.csv`, 'text/csv');
  else {
    // Raport wychodzący poza aplikację musi nieść zastrzeżenie, że powstał mimo zaakceptowanych wyjątków.
    const caveat = lastWaived.length > 0 ? ` (UWAGA: policzono mimo ${lastWaived.length} zaakceptowanych wyjątków walidacji)` : '';
    downloadTextFile(takeoffToTextReport(lastTakeoff.items, { title: `Zestawienie materiałowe — ${projectMeta.name || 'schody'}${caveat}` }), `${base}_zestawienie.txt`, 'text/plain');
  }
}

// ---------------------------------------------------------------------------------------------
// Panele
// ---------------------------------------------------------------------------------------------
const infoPanel = createInfoPanel(ws.leftEl);
const inspectorPanel = createInspectorPanel(ws.tabBody('inspector'));
inspectorPanel.addEventListener('change', (e) => {
  const key = e.target?.dataset?.postEdit;
  if (key && selection?.elementType === 'post' && selection.postId) applyPostEdit(selection.postId, { field: key, value: Number(e.target.value) });
});
inspectorPanel.addEventListener('click', (e) => {
  const action = e.target?.closest?.('[data-post-action]')?.dataset.postAction;
  if (action && selection?.elementType === 'post' && selection.postId) applyPostEdit(selection.postId, { action });
  const dxfPostId = e.target?.closest?.('[data-post-dxf]')?.dataset.postDxf;
  if (dxfPostId) exportPostDXF(dxfPostId);
  const dxfStepId = e.target?.closest?.('[data-tread-dxf]')?.dataset.treadDxf;
  if (dxfStepId) exportTreadDXF(dxfStepId);
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
offerPanel = createOfferPanel(ws.tabBody('offer'), {
  onSettings: (patch) => {
    offerSettings = sanitizeOfferSettings({ ...offerSettings, ...patch, client: { ...offerSettings.client, ...(patch.client || {}) } });
    refreshOffer();
  },
  onCompany: (patch) => {
    company = sanitizeCompany({ ...company, ...patch });
    try {
      localStorage.setItem(COMPANY_STORAGE_KEY, JSON.stringify(company));
    } catch {
      // brak pamięci przeglądarki — dane firmy działają do zamknięcia karty
    }
  },
  onSuggestNumber: () => {
    offerSettings = { ...offerSettings, offerNumber: suggestOfferNumber() };
    fillOfferForm(offerPanel, offerSettings, company);
    refreshOffer();
  },
  onGenerate: () => generateOfferPDF(),
});
fillOfferForm(offerPanel, offerSettings, company);

const takeoffPanel = createTakeoffPanel(ws.tabBody('takeoff'), {
  onSelectItem: handleSelectTakeoffItem,
  onGroupChange: (groupBy) => {
    takeoffGroupBy = groupBy;
    refreshTakeoff();
  },
  onExportCSV: () => exportTakeoff('csv'),
  onExportTXT: () => exportTakeoff('txt'),
  onExportPostsDXF: () => exportAllPostsDXF(),
  onExportRailingDXF: () => exportRailingDXF(),
  onExportTreadsDXF: () => exportAllTreadsDXF(),
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
  if (!currentRoot || viewState.clientMode) return;
  if (pointerDownAt && Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) > 4) return;
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
    const at = (i) => boundaryEditPoints(currentPlanLayout.treads, i, config.manualEdgeOverrides, config);
    const e = at(boundaryIndex);
    if (!e) return null;
    return { ...e, innerPath: currentPlanLayout.innerFullPath, outerPath: currentPlanLayout.outerFullPath, neighbours: { before: at(boundaryIndex - 1), after: at(boundaryIndex + 1) } };
  },
  onEdgeDragMove: (boundaryIndex, override) => {
    activeEdgeBoundary = boundaryIndex; // keeps the edge red with its pivot shown while it is dragged
    config.manualEdgeOverrides[boundaryIndex] = override;
    rebuild(); // podgląd na żywo — BEZ wpisu do historii, patrz modelHistory.js
  },
  onEdgeDragEnd: (boundaryIndex, override) => {
    activeEdgeBoundary = null;
    if (!override) {
      regeneratePlan2D(); // a press without a move: nothing changed
      return;
    }
    config.manualEdgeOverrides[boundaryIndex] = override;
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
    setOpeningPolygon(translateOpening(openingBase, dx, dy), final);
    if (final) openingBase = null;
  },
  onOpeningDrawFinish: (points) => {
    setOpeningPolygon(points.map(toOpeningRelative), true);
    setOpeningMode('edit'); // od razu można poprawiać narysowany otwór
  },
  onOpeningDrawCancel: () => setOpeningMode('off'),
  // Kliknięcia ustawiają WYŁĄCZNIE zaznaczenie (nie model, nie historia).
  onStepClick: (stepIndex) => setSelection(stepIndex === null ? null : { elementType: 'tread', stepIndex }),
  onStringerClick: (side) => setSelection({ elementType: 'stringer', stringerId: side, segmentId: null }),
  onPostClick: (postId) => setSelection({ elementType: 'post', postId }),
});

const gui = createUI({
  config,
  container: ws.leftEl,
  onChange: handleLiveChange,
  onCommit: handleCommitChange,
  viewState,
  onViewChange: handleViewChange,
  onFitPlanView: fitPlanView,
  getPlanBounds: () => lastModels?.planLayout?.bounds ?? null,
  onStartOpeningDraw: () => startOpeningDraw(),
  appearance,
  onAppearanceChange: () => {
    setAppearance(appearance);
    rebuild();
  },
  onResetEdgeOverrides: handleResetEdgeOverrides,
  exportSelection,
  exportHandlers: {
    onExportOBJ: () => withoutHighlight(() => exportStaircaseToOBJ(currentRoot, 'schody.obj', exportSelection)),
    onExportDAE: () => withoutHighlight(() => exportStaircaseToDAE(currentRoot, 'schody.dae', exportSelection)),
  },
  onExportPlan2D: () => exportPlan2DSVG(currentPlan2DSVG),
});

uiRefresh = () => refreshUI(gui);
setAppearance(appearance); // domyślne wykończenie = dąb (tekstura) — musi być na materiałach od startu
setView(viewState.view);
rebuild();
updateHistoryButtons();
ws.setProjectMeta({ name: '', notes: '', lastFileNote: '' });

window.addEventListener('resize', () => {
  if (plan2dPanel.classList.contains('visible')) updateScaleReadout();
});
