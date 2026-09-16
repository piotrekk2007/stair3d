import GUI from 'lil-gui';
import { CONSTRUCTION_TYPE_LABELS_PL } from '../geometry/stringerModel.js';

// Dopina przycisk kłódki do wiersza kontrolki lil-gui — realizuje wymaganie 13 (blokowanie
// wybranych parametrów). Blokada to WYŁĄCZNIE wyłączenie kontrolki w UI (config.lockedFields,
// patrz config/schema.js) — nie jest to ograniczenie solvera ani reguła walidacji.
function makeLockable(controller, config, fieldName) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lock-toggle';
  btn.title = 'Zablokuj/odblokuj to pole przed przypadkową zmianą';
  const sync = () => {
    const locked = config.lockedFields.includes(fieldName);
    btn.textContent = locked ? '🔒' : '🔓';
    btn.classList.toggle('locked', locked);
    controller.disable(locked);
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const idx = config.lockedFields.indexOf(fieldName);
    if (idx >= 0) config.lockedFields.splice(idx, 1);
    else config.lockedFields.push(fieldName);
    sync();
  });
  controller.domElement.appendChild(btn);
  sync();
  return controller;
}

export function createUI({
  config,
  onChange,
  onCommit,
  onReset,
  viewState,
  onViewChange,
  exportHandlers = {},
  onExportPlan2D,
  onTogglePlan2D,
  onResetEdgeOverrides,
  onSaveProject,
  onLoadProject,
  exportSelection,
  onUndo,
  onRedo,
  onFitPlanView,
}) {
  const gui = new GUI({ title: 'Parametry schodów' });

  // Pole jest "na żywo" podczas przeciągania suwaka (onChange -> tylko przebudowa, bez
  // wpisu do historii) i "zatwierdzane" dopiero po puszczeniu (onFinishChange -> wpis do
  // historii cofania — wymaganie 12: historia na poziomie modelu, nie każdego drgnięcia
  // suwaka). Dla pól nie-suwakowych (przyciski, dropdown) oba zdarzenia i tak trafiają razem.
  function live(controller) {
    return controller.onChange(onChange).onFinishChange(onCommit || onChange);
  }
  function lockable(controller, fieldName) {
    return makeLockable(live(controller), config, fieldName);
  }

  if (onUndo || onRedo) {
    const history = gui.addFolder('Historia (Ctrl+Z / Ctrl+Y)');
    if (onUndo) history.add({ undo: onUndo }, 'undo').name('↶ Cofnij');
    if (onRedo) history.add({ redo: onRedo }, 'redo').name('↷ Ponów');
  }

  if (onSaveProject) {
    gui.add({ save: onSaveProject }, 'save').name('💾 Zapisz projekt (JSON)');
  }
  if (onLoadProject) {
    gui.add({ load: onLoadProject }, 'load').name('📂 Wczytaj projekt (JSON)');
  }

  gui.add({ reset: onReset }, 'reset').name('↺ Resetuj ustawienia');

  live(gui.add(config, 'stairType', ['straight', 'L', 'U'])).name('Typ schodów');
  live(gui.add(config, 'turnDirection', ['right', 'left'])).name('Kierunek skrętu');

  const dims = gui.addFolder('Wymiary ogólne');
  lockable(dims.add(config, 'totalRise', 2000, 3600, 10).name('Wys. kondygnacji [mm]'), 'totalRise');
  lockable(dims.add(config, 'stairWidth', 700, 1400, 10).name('Szerokość biegu [mm]'), 'stairWidth');
  lockable(dims.add(config, 'treadGoing', 180, 320, 5).name('Głębokość stopnia [mm]'), 'treadGoing');

  const steps = gui.addFolder('Liczba stopni');
  lockable(steps.add(config, 'treadsLegA', 1, 15, 1).name('Proste (odc. A)'), 'treadsLegA');
  live(steps.add(config, 'turn1Type', ['winder', 'landing'])).name('Zakręt 1: typ');
  lockable(steps.add(config, 'windersPerTurn', 2, 6, 1).name('Zabiegowe (każdy skręt)'), 'windersPerTurn');
  lockable(steps.add(config, 'treadsLegB', 0, 15, 1).name('Proste (odc. B)'), 'treadsLegB');
  live(steps.add(config, 'turn2Type', ['winder', 'landing'])).name('Zakręt 2: typ (tylko U)');
  live(steps.add(config, 'mergeLandings')).name('1 duży podest (oba zakręty = landing)');
  lockable(steps.add(config, 'treadsLegC', 0, 15, 1).name('Proste (odc. C, tylko U)'), 'treadsLegC');

  const winder = gui.addFolder('Geometria zabiegu');
  lockable(winder.add(config, 'walklineOffset', 250, 500, 10).name('Odsunięcie linii biegu [mm]'), 'walklineOffset');
  lockable(winder.add(config, 'walklineSplitOffset', 250, 500, 10).name('Przesunięcie punktu podziału [mm]'), 'walklineSplitOffset');
  lockable(winder.add(config, 'minInnerWidth', 80, 200, 5).name('Min. szer. przy duszy [mm]'), 'minInnerWidth');

  const build = gui.addFolder('Konstrukcja');
  const stringerConstructionOptions = Object.fromEntries(Object.entries(CONSTRUCTION_TYPE_LABELS_PL).map(([value, label]) => [label, value]));
  live(build.add(config, 'stringerConstructionType', stringerConstructionOptions)).name('Typ wangi');
  lockable(build.add(config, 'treadThickness', 20, 60, 1).name('Grubość stopnia [mm]'), 'treadThickness');
  lockable(build.add(config, 'nosing', 0, 40, 1).name('Nosek [mm]'), 'nosing');
  lockable(build.add(config, 'stringerHeight', 150, 450, 10).name('Wysokość policzka [mm]'), 'stringerHeight');
  lockable(build.add(config, 'stringerThickness', 20, 60, 1).name('Grubość policzka [mm]'), 'stringerThickness');
  lockable(build.add(config, 'stringerTopMarginMm', 0, 120, 5).name('Zapas nad linią (wpuszczana) [mm]'), 'stringerTopMarginMm');
  lockable(build.add(config, 'stringerMinRemainingSectionMm', 10, 60, 5).name('Min. grubość drewna (próg) [mm]'), 'stringerMinRemainingSectionMm');
  lockable(build.add(config, 'stringerCleatThicknessMm', 10, 40, 5).name('Grubość klocka (nakładana) [mm]'), 'stringerCleatThicknessMm');
  lockable(build.add(config, 'stringerCleatHeightMm', 20, 80, 5).name('Wysokość klocka (nakładana) [mm]'), 'stringerCleatHeightMm');
  live(build.add(config, 'hasCornerPost')).name('Słup konstrukcyjny na zakręcie');
  lockable(build.add(config, 'postSize', 60, 160, 5).name('Przekrój słupa [mm]'), 'postSize');
  live(build.add(config, 'hasRiserBoards')).name('Podstopnie (zamknięty stopień)');
  lockable(build.add(config, 'riserBoardThickness', 10, 50, 1).name('Grubość podstopnia [mm]'), 'riserBoardThickness');

  const ceiling = gui.addFolder('Strop i otwór (ręczny)');
  lockable(ceiling.add(config, 'ceilingThickness', 150, 400, 10).name('Grubość stropu [mm]'), 'ceilingThickness');
  lockable(ceiling.add(config, 'minHeadroom', 1900, 2200, 10).name('Min. skrajnia [mm]'), 'minHeadroom');
  lockable(ceiling.add(config, 'openingLength', 800, 5000, 50).name('Otwór: długość (Y) [mm]'), 'openingLength');
  lockable(ceiling.add(config, 'openingWidth', 700, 2500, 50).name('Otwór: szerokość (X) [mm]'), 'openingWidth');
  lockable(ceiling.add(config, 'openingOffsetX', -2000, 2000, 10).name('Otwór: offset X [mm]'), 'openingOffsetX');
  lockable(ceiling.add(config, 'openingOffsetY', -2000, 2000, 10).name('Otwór: offset Y [mm]'), 'openingOffsetY');

  const view = gui.addFolder('Widok 3D');
  view.add(viewState, 'showCeiling').name('Pokaż strop').onChange((v) => onViewChange('showCeiling', v));
  view.add(viewState, 'showDimensions').name('Pokaż wymiary').onChange((v) => onViewChange('showDimensions', v));
  view.add(viewState, 'showStringerLengths').name('Długości wang').onChange((v) => onViewChange('showStringerLengths', v));
  view.add(viewState, 'showWinderBlanks').name('Formatki zabiegowe').onChange((v) => onViewChange('showWinderBlanks', v));
  view.add(viewState, 'showDebug').name('Debug mode (linie/punkty/łoża)').onChange((v) => onViewChange('showDebug', v));

  const plan2d = gui.addFolder('Plan 2D');
  if (onTogglePlan2D) {
    plan2d.add({ plan2d: () => onTogglePlan2D() }, 'plan2d').name('Plan 2D (pokaż/ukryj)');
  }
  if (onFitPlanView) {
    plan2d.add({ fit: onFitPlanView }, 'fit').name('🔍 Dopasuj widok');
  }
  plan2d.add(viewState, 'plan2dShowWinderBlanks').name('Formatki zabiegowe').onChange((v) => onViewChange('plan2dShowWinderBlanks', v));
  plan2d.add(viewState, 'plan2dEditMode').name('Edytuj krawędzie (przeciąganie)').onChange((v) => onViewChange('plan2dEditMode', v));
  if (onResetEdgeOverrides) {
    plan2d.add({ reset: onResetEdgeOverrides }, 'reset').name('Resetuj ręczne edycje krawędzi');
  }

  const layers = plan2d.addFolder('Linie konstrukcyjne');
  const layerDefs = [
    ['grid', 'Siatka'],
    ['axes', 'Osie biegu'],
    ['widths', 'Wymiary/szerokości'],
    ['walkline', 'Linia biegu (walkline)'],
    ['runBoundaries', 'Granice biegów'],
    ['stepBoundaries', 'Granice stopni'],
    ['stringers', 'Wangi'],
  ];
  for (const [key, label] of layerDefs) {
    layers.add(viewState.plan2dLayers, key).name(label).onChange(() => onViewChange('plan2dLayers', viewState.plan2dLayers));
  }

  const exportFolder = gui.addFolder('Eksport');
  if (exportSelection) {
    exportFolder.add(exportSelection, 'Stopnie').name('☑ Stopnie');
    exportFolder.add(exportSelection, 'Wangi').name('☑ Wangi');
    exportFolder.add(exportSelection, 'Slupy').name('☑ Słupy');
    exportFolder.add(exportSelection, 'Podstopnie').name('☑ Podstopnie');
  }

  const { onExportOBJ, onExportDAE } = exportHandlers;
  if (onExportDAE) {
    exportFolder.add({ export: onExportDAE }, 'export').name('Eksportuj do DAE (Collada)');
  }
  if (onExportOBJ) {
    exportFolder.add({ export: onExportOBJ }, 'export').name('Eksportuj do OBJ (wtyczka)');
  }
  if (onExportPlan2D) {
    exportFolder.add({ export: onExportPlan2D }, 'export').name('Eksportuj plan 2D (SVG)');
  }

  return gui;
}

export function refreshUI(gui) {
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

export function createInfoPanel() {
  const panel = document.createElement('div');
  panel.id = 'info-panel';
  document.body.appendChild(panel);
  return panel;
}

export function updateInfoPanel(panel, derived, planLayout, config, ceilingFit) {
  const rows = [];
  rows.push(`<div class="row"><span>Liczba stopni</span><b>${derived.numTreads}</b></div>`);
  rows.push(`<div class="row"><span>Głębokość stopnia (prosty)</span><b>${config.treadGoing.toFixed(0)} mm</b></div>`);
  rows.push(`<div class="row resultant"><span>Wysokość podstopnia <i>(wyliczone)</i></span><b>${derived.riserHeight.toFixed(1)} mm</b></div>`);
  rows.push(`<div class="row"><span>Wysokość kondygnacji</span><b>${config.totalRise.toFixed(0)} mm</b></div>`);

  if (planLayout) {
    const footprintX = planLayout.bounds.maxX - planLayout.bounds.minX;
    const footprintY = planLayout.bounds.maxY - planLayout.bounds.minY;
    rows.push(`<div class="row resultant"><span>Rzut klatki (dł. × szer.) <i>(wyliczone)</i></span><b>${footprintY.toFixed(0)} × ${footprintX.toFixed(0)} mm</b></div>`);
  }

  const blondelClass = derived.blondelOk ? 'ok' : 'warn';
  rows.push(`<div class="row resultant ${blondelClass}"><span>Wzór Blondela (2h+e) <i>(wyliczone)</i></span><b>${derived.blondel.toFixed(0)} mm</b></div>`);
  if (!derived.blondelOk) rows.push(`<div class="note warn">Poza zalecanym zakresem 600-650mm</div>`);

  const riserClass = derived.riserRangeOk ? 'ok' : 'warn';
  rows.push(`<div class="row ${riserClass}"><span>Zakres podstopnia</span><b>${derived.riserRangeOk ? 'OK' : 'UWAGA'}</b></div>`);

  if (derived.minInnerSegment !== null) {
    const innerClass = derived.minInnerWidthOk ? 'ok' : 'warn';
    rows.push(`<div class="row resultant ${innerClass}"><span>Szer. przy duszy <i>(wyliczone)</i></span><b>${derived.minInnerSegment.toFixed(0)} mm</b></div>`);
  }

  if (!derived.turnFeasible) {
    rows.push(`<div class="note error">${derived.turnFeasibleMessage}</div>`);
  }

  if (ceilingFit) {
    const ceilingClass = ceilingFit.fits ? 'ok' : 'warn';
    rows.push(`<div class="row ${ceilingClass}"><span>Otwór w stropie / skrajnia</span><b>${ceilingFit.fits ? 'OK' : 'KOLIZJA'}</b></div>`);
    if (!ceilingFit.fits) {
      rows.push(
        `<div class="note error">Stopnie nr ${ceilingFit.violatingTreads.join(', ')} nie mieszczą się w otworze i nie mają ${config.minHeadroom}mm skrajni pod stropem. Powiększ otwór, przesuń go (offset) lub zwiększ grubość podestu.</div>`
      );
    }
  }

  if (config.lockedFields && config.lockedFields.length > 0) {
    rows.push(`<div class="note locked">🔒 Zablokowane pola: ${config.lockedFields.length}</div>`);
  }

  panel.innerHTML = rows.join('');
}

// Panel szczegółów zaznaczonego stopnia (wymaganie 9). `tread` to obiekt z
// planLayout.treads (patrz geometry/planLayout.js) — pokazujemy go bezpośrednio jako
// niezależny obiekt logiczny (wymaganie 8), nie odczytujemy niczego z siatki Three.js.
export function createStepInfoPanel() {
  const panel = document.createElement('div');
  panel.id = 'step-info-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  return panel;
}

// --- Panel wyników walidatora (Staircase Validator — src/validator/StaircaseValidator.js) ---
// Czysto prezentacyjne: ten plik nigdy nie liczy diagnostyki sam, tylko renderuje to, co
// przyszło z zewnątrz (main.js woła validateModels() i przekazuje wynik). Panel pokazuje się
// OBOK widoku 2D/3D — jest overlayem niezależnym od tego, który z nich jest aktualnie
// wyświetlony (patrz style.css, z-index wyższy niż #plan2d-panel), nie zastępuje żadnego z nich.
const SEVERITY_LABEL_PL = { ERROR: 'BŁĄD', WARNING: 'UWAGA', INFO: 'INFO' };
const SEVERITY_ORDER = { ERROR: 0, WARNING: 1, INFO: 2 };

export function createValidatorPanel() {
  const panel = document.createElement('div');
  panel.id = 'validator-panel';
  panel.innerHTML = `
    <div id="validator-panel-header">
      <span id="validator-panel-title">Walidacja</span>
      <span id="validator-panel-summary"></span>
      <button type="button" id="validator-panel-toggle" title="Zwiń/rozwiń panel">▾</button>
    </div>
    <div id="validator-panel-body"></div>
  `;
  document.body.appendChild(panel);

  const body = panel.querySelector('#validator-panel-body');
  const toggle = panel.querySelector('#validator-panel-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▸' : '▾';
    body.hidden = collapsed;
  });

  return panel;
}

function formatValueExpected(d) {
  if (d.value === null && d.expected === null) return '';
  const unit = d.unit ? d.unit : '';
  const value = d.value === null ? null : typeof d.value === 'object' ? JSON.stringify(d.value) : `${d.value}${unit}`;
  const expected = d.expected === null ? null : typeof d.expected === 'object' ? JSON.stringify(d.expected) : `${d.expected}${unit}`;
  const parts = [];
  if (value !== null) parts.push(`wartość: ${value}`);
  if (expected !== null) parts.push(`oczekiwano: ${expected}`);
  return parts.length ? `<div class="validator-finding-detail">${parts.join(' · ')}</div>` : '';
}

// `diagnostics` — Diagnostic[] z src/diagnostics/diagnostic.js (ERROR/WARNING/INFO), dokładnie
// jak zwraca StaircaseValidator.validateModels()/validateStaircase(). Element/step/parametr są
// tu tylko WYŚWIETLANE — żadna logika oceny nie żyje w tym pliku.
export function updateValidatorPanel(panel, diagnostics) {
  const summary = panel.querySelector('#validator-panel-summary');
  const body = panel.querySelector('#validator-panel-body');

  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const d of diagnostics) counts[d.severity] = (counts[d.severity] || 0) + 1;
  summary.innerHTML = `
    <span class="validator-count error">${counts.ERROR} 🛑</span>
    <span class="validator-count warning">${counts.WARNING} ⚠️</span>
    <span class="validator-count info">${counts.INFO} ℹ️</span>
  `;

  if (diagnostics.length === 0) {
    body.innerHTML = `<div class="validator-empty">Brak zastrzeżeń — model spełnia wszystkie sprawdzone reguły.</div>`;
    return;
  }

  const sorted = [...diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  body.innerHTML = sorted
    .map((d) => {
      const location = d.elementId || d.elementType;
      return `
        <div class="validator-finding ${d.severity.toLowerCase()}">
          <div class="validator-finding-head">
            <span class="validator-badge ${d.severity.toLowerCase()}">${SEVERITY_LABEL_PL[d.severity]}</span>
            <span class="validator-finding-location">${location}</span>
          </div>
          <div class="validator-finding-message">${d.message}</div>
          ${formatValueExpected(d)}
        </div>
      `;
    })
    .join('');
}

// --- Panel inspektora elementu 3D (traceability — src/scene/traceability.js/elementInspector.js) ---
// Kliknięcie dowolnego traceable elementu w 3D (stopień/podstopień/panel wangi/słup) pokazuje
// tu jego surowe dane źródłowe: typ elementu, ID stopnia, ID wangi, geometrySourceId — czysto
// prezentacyjne, żadna logika rozpoznawania kliknięcia nie żyje w tym pliku (patrz main.js).
const ELEMENT_TYPE_LABEL_PL = { tread: 'Stopień', riser: 'Podstopień', stringer: 'Panel wangi', post: 'Słup' };

export function createElementInspectorPanel() {
  const panel = document.createElement('div');
  panel.id = 'element-inspector-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  return panel;
}

/**
 * @param {HTMLElement} panel
 * @param {import('../diagnostics/diagnostic.js').Diagnostic|import('../scene/traceability.js').traceability|null} traceabilityData
 *   null hides the panel (e.g. the user clicked empty space or a non-traceable object like the grid).
 */
export function updateElementInspectorPanel(panel, traceabilityData) {
  if (!traceabilityData) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  panel.hidden = false;
  const { elementType, stepId, stringerId, geometrySourceId } = traceabilityData;
  const rows = [];
  rows.push(`<div class="title">${ELEMENT_TYPE_LABEL_PL[elementType] || elementType}</div>`);
  rows.push(`<div class="row"><span>Element type</span><b>${elementType}</b></div>`);
  if (stepId) rows.push(`<div class="row"><span>Step ID</span><b>${stepId}</b></div>`);
  if (stringerId) rows.push(`<div class="row"><span>Stringer ID</span><b>${stringerId}</b></div>`);
  rows.push(`<div class="row"><span>Geometry source ID</span><b>${geometrySourceId}</b></div>`);
  panel.innerHTML = rows.join('');
}

export function updateStepInfoPanel(panel, tread, config, overrides) {
  if (!tread) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  panel.hidden = false;

  const boundaryBefore = tread.index;
  const boundaryAfter = tread.index + 1;
  const beforeManual = !!(overrides && overrides[boundaryBefore]);
  const afterManual = !!(overrides && overrides[boundaryAfter]);

  const typeLabelMap = { straight: 'prosty', winder: 'zabiegowy', landing: 'podest' };
  const rows = [];
  rows.push(`<div class="title">Stopień nr ${tread.index + 1}</div>`);
  rows.push(`<div class="row"><span>Typ</span><b>${typeLabelMap[tread.type] || tread.type}</b></div>`);
  rows.push(`<div class="row resultant"><span>Wysokość góry stopnia <i>(wyliczone)</i></span><b>${((tread.index + 1) * config.riserHeight).toFixed(1)} mm</b></div>`);

  if (tread.winderInfo) {
    rows.push(`<div class="row resultant"><span>Szerokość czoło <i>(wyliczone)</i></span><b>${tread.winderInfo.widths.atFront.toFixed(0)} mm</b></div>`);
    rows.push(`<div class="row resultant"><span>Szerokość tył <i>(wyliczone)</i></span><b>${tread.winderInfo.widths.atBack.toFixed(0)} mm</b></div>`);
    rows.push(`<div class="row"><span>Pozycja na walkline</span><b>${tread.winderInfo.stationStart.toFixed(0)}–${tread.winderInfo.stationEnd.toFixed(0)} mm</b></div>`);
  } else {
    rows.push(`<div class="row"><span>Głębokość (czoło→tył)</span><b>${config.treadGoing.toFixed(0)} mm</b></div>`);
  }

  rows.push(`<div class="row ${beforeManual ? 'manual' : 'auto'}"><span>Krawędź czoła</span><b>${beforeManual ? '🖊 ręczna' : '⚙ automatyczna'}</b></div>`);
  rows.push(`<div class="row ${afterManual ? 'manual' : 'auto'}"><span>Krawędź tyłu</span><b>${afterManual ? '🖊 ręczna' : '⚙ automatyczna'}</b></div>`);

  panel.innerHTML = rows.join('');
}
