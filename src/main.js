import './style.css';
import { createDefaultConfig } from './config/schema.js';
import { buildStaircase } from './geometry/buildStaircase.js';
import { createScene } from './scene/sceneSetup.js';
import { buildDimensionLabels, buildStringerLengthLabels, buildWinderBlankLabels } from './scene/dimensionLabels.js';
import { createUI, createInfoPanel, updateInfoPanel, createStepInfoPanel, updateStepInfoPanel, createValidatorPanel, updateValidatorPanel, refreshUI } from './ui/ui.js';
import { validateModels } from './validator/StaircaseValidator.js';
import { exportStaircaseToOBJ } from './export/objExporter.js';
import { exportStaircaseToDAE } from './export/daeExporter.js';
import { renderPlan2DSVG, planSvgBounds } from './plan2d/plan2dRenderer.js';
import { exportPlan2DSVG } from './plan2d/exportPlan2D.js';
import { fitToBounds, zoomAt, nearestStandardScale, pixelsPerMm } from './plan2d/viewport.js';
import { attachPlanInteractions } from './plan2d/planInteractions.js';
import { exportProjectJSON, parseProjectJSON } from './project/projectIO.js';
import { createHistory, commit, undo as historyUndo, redo as historyRedo, canUndo, canRedo } from './history/modelHistory.js';

const app = document.getElementById('app');
const viewport = document.createElement('div');
viewport.id = 'viewport';
app.appendChild(viewport);

const { scene } = createScene(viewport);

const config = createDefaultConfig();
const viewState = {
  showCeiling: true,
  showDimensions: true,
  showStringerLengths: false,
  showWinderBlanks: false,
  plan2dShowWinderBlanks: true,
  plan2dEditMode: false,
  // Warstwy linii konstrukcyjnych na planie 2D (wymaganie 5 i 7) — czysto wizualne, nie
  // zapisywane w projekcie (to nie jest część modelu geometrycznego, jak manualEdgeOverrides).
  plan2dLayers: {
    grid: false,
    axes: false,
    widths: true,
    walkline: true,
    runBoundaries: true,
    stepBoundaries: false,
    stringers: true,
  },
};
const exportSelection = { Stopnie: true, Wangi: true, Slupy: true, Podstopnie: true };

// Historia cofania (wymaganie 12) działa WYŁĄCZNIE na modelu (config) — nigdy na widoku
// (kamera 3D, pan/zoom planu, zaznaczenie) ani na wyrenderowanych meshach.
const history = createHistory(config);

function commitHistory() {
  commit(history, config);
}

function restoreFromHistory(snapshot) {
  if (!snapshot) return;
  Object.assign(config, snapshot);
  refreshUI(gui);
  selectedStepIndex = null;
  rebuild();
}

function handleUndo() {
  restoreFromHistory(historyUndo(history));
}
function handleRedo() {
  restoreFromHistory(historyRedo(history));
}

window.addEventListener('keydown', (e) => {
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

let currentRoot = null;
let currentCeiling = null;
let currentDimLabels = null;
let currentStringerLengthLabels = null;
let currentWinderBlankLabels = null;
let currentPlanLayout = null;
let currentDerived = null;
let currentPlan2DSVG = '';
let selectedStepIndex = null;
let planViewport = null; // {x,y,width,height} — patrz plan2d/viewport.js; null = jeszcze nie dopasowany

const PLAN_VIEW_MARGIN_MM = 600;

function rebuild() {
  if (currentRoot) {
    scene.remove(currentRoot);
    disposeGroup(currentRoot);
  }
  if (currentCeiling) {
    scene.remove(currentCeiling);
    disposeGroup(currentCeiling);
  }
  if (currentDimLabels) {
    scene.remove(currentDimLabels);
    disposeGroup(currentDimLabels);
  }
  if (currentStringerLengthLabels) {
    scene.remove(currentStringerLengthLabels);
    disposeGroup(currentStringerLengthLabels);
  }
  if (currentWinderBlankLabels) {
    scene.remove(currentWinderBlankLabels);
    disposeGroup(currentWinderBlankLabels);
  }

  // Kolejność zgodna z wymaganiem 11: solver 2D (planLayout) -> wangi -> podstopnie -> 3D.
  // buildStaircase.js woła buildPlanLayout() jako pierwszy krok, potem buildStringerGeometries,
  // potem buildRiserBoards, i dopiero na końcu składa wszystko w drzewo Three.js — patrz
  // src/geometry/buildStaircase.js.
  const { root, ceilingMesh, derived, planLayout, ceilingFit, fullConfig, treadModels, riserModels, stringerModels } = buildStaircase(config);
  scene.add(root);
  scene.add(ceilingMesh);
  ceilingMesh.visible = viewState.showCeiling;
  currentRoot = root;
  currentCeiling = ceilingMesh;

  currentDimLabels = buildDimensionLabels(planLayout, config, derived);
  currentDimLabels.visible = viewState.showDimensions;
  scene.add(currentDimLabels);

  currentStringerLengthLabels = buildStringerLengthLabels(planLayout, config, derived);
  currentStringerLengthLabels.visible = viewState.showStringerLengths;
  scene.add(currentStringerLengthLabels);

  currentWinderBlankLabels = buildWinderBlankLabels(planLayout, config, derived);
  currentWinderBlankLabels.visible = viewState.showWinderBlanks;
  scene.add(currentWinderBlankLabels);

  // Zaznaczenie wskazuje na konkretny stopień (obiekt logiczny) po jego indeksie — jeśli
  // liczba stopni się zmieniła i stary indeks już nie istnieje, zaznaczenie znika zamiast
  // wskazywać na przypadkowy inny stopień.
  if (selectedStepIndex !== null && !planLayout.treads.some((t) => t.index === selectedStepIndex)) {
    selectedStepIndex = null;
  }

  currentPlanLayout = planLayout;
  currentDerived = derived;
  if (!planViewport) fitPlanView();
  regeneratePlan2D();
  updateStepInfoPanel(stepInfoPanel, planLayout.treads.find((t) => t.index === selectedStepIndex), { ...config, riserHeight: derived.riserHeight }, config.manualEdgeOverrides);

  updateInfoPanel(infoPanel, derived, planLayout, config, ceilingFit);

  // Walidator (src/validator/StaircaseValidator.js) OCENIA wynik — nigdy go nie zmienia i
  // nigdy nie liczy geometrii sam: dostaje DOKŁADNIE te modele, które buildStaircase() już
  // policzył powyżej. Panel pokazuje się obok widoku 2D/3D (patrz style.css #validator-panel —
  // z-index ponad #plan2d-panel), niezależnie od tego, który z nich jest aktualnie widoczny.
  const validation = validateModels({ config: fullConfig, derived, planLayout, treadModels, riserModels, stringerModels });
  updateValidatorPanel(validatorPanel, validation.diagnostics);
}

function fitPlanView() {
  if (!currentPlanLayout) return;
  const bounds = planSvgBounds(currentPlanLayout);
  const rect = plan2dPanel.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 600;
  planViewport = fitToBounds(bounds, w, h, PLAN_VIEW_MARGIN_MM);
  regeneratePlan2D();
}

function updateScaleReadout() {
  if (!planViewport) return;
  const rect = plan2dPanel.getBoundingClientRect();
  const pxPerMm = pixelsPerMm(planViewport, rect.width || 800);
  // "1 mm na ekranie" jest umowne (zależy od fizycznego DPI wyświetlacza, którego strona
  // WWW nie może wiarygodnie odczytać) — patrz komentarz w viewport.js/pixelsPerMm. Pokazujemy
  // więc nominalną skalę zaokrągloną do konwencjonalnych podziałek rysunku technicznego, z
  // jawnym zastrzeżeniem, zamiast udawać skalibrowaną dokładność, której nie mamy.
  const rawDenominator = 1 / pxPerMm;
  const nice = nearestStandardScale(rawDenominator);
  scaleReadout.textContent = `Skala (orientacyjna): 1:${nice}`;
}

function regeneratePlan2D() {
  if (!currentPlanLayout || !planViewport) return;
  currentPlan2DSVG = renderPlan2DSVG(currentPlanLayout, config, currentDerived, {
    viewport: planViewport,
    showWinderBlanks: viewState.plan2dShowWinderBlanks,
    editMode: viewState.plan2dEditMode,
    selectedStepIndex,
    layers: viewState.plan2dLayers,
  });
  if (plan2dPanel.classList.contains('visible')) {
    plan2dSvgContainer.innerHTML = currentPlan2DSVG;
    updateScaleReadout();
  }
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    // CSS2DObject: usuwa własny <div> tylko gdy .remove() jest wywołane bezpośrednio na nim,
    // a nie na nadrzędnej grupie — sprzątamy ręcznie, inaczej etykiety wymiarów zostają w DOM.
    if (obj.element && obj.element.parentNode) obj.element.remove();
  });
}

function handleLiveChange() {
  rebuild();
}
function handleCommitChange() {
  rebuild();
  commitHistory();
}

function handleViewChange(key, value) {
  viewState[key] = value;
  if (key === 'showCeiling' && currentCeiling) currentCeiling.visible = value;
  if (key === 'showDimensions' && currentDimLabels) currentDimLabels.visible = value;
  if (key === 'showStringerLengths' && currentStringerLengthLabels) currentStringerLengthLabels.visible = value;
  if (key === 'showWinderBlanks' && currentWinderBlankLabels) currentWinderBlankLabels.visible = value;
  if (key === 'plan2dShowWinderBlanks') regeneratePlan2D();
  if (key === 'plan2dEditMode') regeneratePlan2D();
  if (key === 'plan2dLayers') regeneratePlan2D();
}

function handleResetEdgeOverrides() {
  config.manualEdgeOverrides = {};
  rebuild();
  commitHistory();
}

function handleReset() {
  Object.assign(config, createDefaultConfig());
  refreshUI(gui);
  selectedStepIndex = null;
  planViewport = null;
  rebuild();
  commitHistory();
}

function togglePlan2D() {
  const willShow = !plan2dPanel.classList.contains('visible');
  plan2dPanel.classList.toggle('visible', willShow);
  if (willShow) {
    if (!planViewport) fitPlanView();
    plan2dSvgContainer.innerHTML = currentPlan2DSVG;
    updateScaleReadout();
  }
}

function handleSaveProject() {
  exportProjectJSON(config);
}

function handleLoadProject() {
  fileInput.click();
}

function handleFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = ''; // pozwala wczytać ten sam plik ponownie z rzędu
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const loadedConfig = parseProjectJSON(reader.result);
      Object.assign(config, createDefaultConfig(), loadedConfig);
      refreshUI(gui);
      selectedStepIndex = null;
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

const infoPanel = createInfoPanel();
const stepInfoPanel = createStepInfoPanel();
const validatorPanel = createValidatorPanel();

const plan2dPanel = document.createElement('div');
plan2dPanel.id = 'plan2d-panel';
app.appendChild(plan2dPanel);

// Architektura DOM planu 2D (naprawa punktu 7 konsolidacji): plan2dPanel ma DWA stałe,
// rozłączne dzieci — kontener SVG (jedyne miejsce, które regeneratePlan2D() nadpisuje przez
// innerHTML=) i HUD (przyciski/skala/legenda, tworzony RAZ i nigdy nieusuwany). Wcześniej HUD
// był dzieckiem TEGO SAMEGO węzła, który dostawał innerHTML= przy każdym przerysowaniu planu —
// każde regenerowanie SVG kasowało cały HUD. Rozdzielenie na dwa stałe kontenery usuwa ten
// błąd strukturalnie, zamiast odtwarzać HUD po każdym renderze.
const plan2dSvgContainer = document.createElement('div');
plan2dSvgContainer.id = 'plan2d-svg-container';
plan2dPanel.appendChild(plan2dSvgContainer);

// HUD planu 2D — przyciski zoom/dopasuj, odczyt skali, legenda auto/ręczne (wymagania 1, 3,
// 6, 14). Żyje POZA generowanym SVG, więc nigdy nie przesuwa/skaluje się razem z planem.
const plan2dHud = document.createElement('div');
plan2dHud.id = 'plan2d-hud';
plan2dHud.innerHTML = `
  <div id="plan2d-zoom-controls">
    <button type="button" data-action="zoom-out" title="Oddal">−</button>
    <button type="button" data-action="zoom-in" title="Przybliż">+</button>
    <button type="button" data-action="fit" title="Dopasuj do widoku">⤢</button>
  </div>
  <div id="plan2d-scale-readout"></div>
  <div id="plan2d-legend">
    <div><span class="swatch" style="border-color:#9aa0a6;border-top-style:dashed"></span>krawędź automatyczna</div>
    <div><span class="swatch" style="border-color:#e08214"></span>krawędź ręcznie zmieniona</div>
    <div><span class="swatch" style="border-color:#c0392b;border-top-style:dashed"></span>linia biegu (walkline)</div>
    <div><span class="swatch" style="border-color:#0f7a3d"></span>granica biegu</div>
  </div>
`;
plan2dPanel.appendChild(plan2dHud);
const scaleReadout = plan2dHud.querySelector('#plan2d-scale-readout');

plan2dHud.querySelector('[data-action="fit"]').addEventListener('click', fitPlanView);
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

// Cała interakcja wskaźnikiem/kołem/klawiaturą na planie 2D — wymagania 1, 2, 8, 9, 10.
// Przeciąganie uchwytu krawędzi modyfikuje WYŁĄCZNIE config.manualEdgeOverrides (dane 2D),
// nigdy siatki Three.js — main.js dowiaduje się o tym tylko przez te callbacki i za każdym
// razem wywołuje pełne rebuild() (patrz wymaganie 11).
attachPlanInteractions({
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
  onEdgeDragMove: (boundaryIndex, override) => {
    config.manualEdgeOverrides[boundaryIndex] = override;
    rebuild(); // podgląd na żywo — BEZ wpisu do historii, patrz modelHistory.js
  },
  onEdgeDragEnd: (boundaryIndex, override) => {
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
  onStepClick: (stepIndex) => {
    selectedStepIndex = stepIndex;
    regeneratePlan2D();
    updateStepInfoPanel(
      stepInfoPanel,
      currentPlanLayout?.treads.find((t) => t.index === selectedStepIndex),
      { ...config, riserHeight: currentDerived?.riserHeight },
      config.manualEdgeOverrides
    );
  },
});

const gui = createUI({
  config,
  onChange: handleLiveChange,
  onCommit: handleCommitChange,
  onReset: handleReset,
  viewState,
  onViewChange: handleViewChange,
  onTogglePlan2D: togglePlan2D,
  onFitPlanView: fitPlanView,
  onResetEdgeOverrides: handleResetEdgeOverrides,
  onSaveProject: handleSaveProject,
  onLoadProject: handleLoadProject,
  onUndo: handleUndo,
  onRedo: handleRedo,
  exportSelection,
  exportHandlers: {
    onExportOBJ: () => exportStaircaseToOBJ(currentRoot, 'schody.obj', exportSelection),
    onExportDAE: () => exportStaircaseToDAE(currentRoot, 'schody.dae', exportSelection),
  },
  onExportPlan2D: () => exportPlan2DSVG(currentPlan2DSVG),
});

rebuild();

window.addEventListener('resize', () => {
  if (plan2dPanel.classList.contains('visible')) updateScaleReadout();
});
