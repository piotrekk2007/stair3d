import './style.css';
import { createDefaultConfig } from './config/schema.js';
import { buildStaircase } from './geometry/buildStaircase.js';
import { createScene } from './scene/sceneSetup.js';
import { buildDimensionLabels, buildStringerLengthLabels, buildWinderBlankLabels } from './scene/dimensionLabels.js';
import { createUI, createInfoPanel, updateInfoPanel, refreshUI } from './ui/ui.js';
import { exportStaircaseToOBJ } from './export/objExporter.js';
import { exportStaircaseToDAE } from './export/daeExporter.js';
import { renderPlan2DSVG } from './plan2d/plan2dRenderer.js';
import { exportPlan2DSVG } from './plan2d/exportPlan2D.js';
import { exportProjectJSON, parseProjectJSON } from './project/projectIO.js';

const app = document.getElementById('app');
const viewport = document.createElement('div');
viewport.id = 'viewport';
app.appendChild(viewport);

const { scene } = createScene(viewport);

const config = createDefaultConfig();
const viewState = { showCeiling: true, showDimensions: true, showStringerLengths: false, showWinderBlanks: false, plan2dShowWinderBlanks: true };
const exportSelection = { Stopnie: true, Wangi: true, Slupy: true, Podstopnie: true };

let currentRoot = null;
let currentCeiling = null;
let currentDimLabels = null;
let currentStringerLengthLabels = null;
let currentWinderBlankLabels = null;
let currentPlanLayout = null;
let currentDerived = null;
let currentPlan2DSVG = '';

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

  const { root, ceilingMesh, derived, planLayout, ceilingFit } = buildStaircase(config);
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

  currentPlanLayout = planLayout;
  currentDerived = derived;
  currentPlan2DSVG = renderPlan2DSVG(planLayout, config, derived, viewState.plan2dShowWinderBlanks);
  if (plan2dPanel.classList.contains('visible')) {
    plan2dPanel.innerHTML = currentPlan2DSVG;
  }

  updateInfoPanel(infoPanel, derived, planLayout, config, ceilingFit);
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    // CSS2DObject: usuwa własny <div> tylko gdy .remove() jest wywołane bezpośrednio na nim,
    // a nie na nadrzędnej grupie — sprzątamy ręcznie, inaczej etykiety wymiarów zostają w DOM.
    if (obj.element && obj.element.parentNode) obj.element.remove();
  });
}

function handleViewChange(key, value) {
  viewState[key] = value;
  if (key === 'showCeiling' && currentCeiling) currentCeiling.visible = value;
  if (key === 'showDimensions' && currentDimLabels) currentDimLabels.visible = value;
  if (key === 'showStringerLengths' && currentStringerLengthLabels) currentStringerLengthLabels.visible = value;
  if (key === 'showWinderBlanks' && currentWinderBlankLabels) currentWinderBlankLabels.visible = value;
  if (key === 'plan2dShowWinderBlanks' && currentPlanLayout) {
    currentPlan2DSVG = renderPlan2DSVG(currentPlanLayout, config, currentDerived, value);
    if (plan2dPanel.classList.contains('visible')) {
      plan2dPanel.innerHTML = currentPlan2DSVG;
    }
  }
}

function handleReset() {
  Object.assign(config, createDefaultConfig());
  refreshUI(gui);
  rebuild();
}

function togglePlan2D() {
  const willShow = !plan2dPanel.classList.contains('visible');
  plan2dPanel.classList.toggle('visible', willShow);
  if (willShow) plan2dPanel.innerHTML = currentPlan2DSVG;
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
      rebuild();
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

const plan2dPanel = document.createElement('div');
plan2dPanel.id = 'plan2d-panel';
app.appendChild(plan2dPanel);

const gui = createUI({
  config,
  onChange: rebuild,
  onReset: handleReset,
  viewState,
  onViewChange: handleViewChange,
  onTogglePlan2D: togglePlan2D,
  onSaveProject: handleSaveProject,
  onLoadProject: handleLoadProject,
  exportSelection,
  exportHandlers: {
    onExportOBJ: () => exportStaircaseToOBJ(currentRoot, 'schody.obj', exportSelection),
    onExportDAE: () => exportStaircaseToDAE(currentRoot, 'schody.dae', exportSelection),
  },
  onExportPlan2D: () => exportPlan2DSVG(currentPlan2DSVG),
});

rebuild();
