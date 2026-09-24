import GUI from 'lil-gui';
import { CONSTRUCTION_TYPE_LABELS_PL } from '../geometry/stringerModel.js';
import { stateBadgeElement, setStateBadge, stateBadgeHTML } from './valueState.js';
import { stepIndexFromElementId } from './selection.js';
import { APPEARANCE_ELEMENTS, COLOR_PRESETS } from '../scene/appearance.js';

const AUTO_BADGE = stateBadgeHTML('auto');

// Dopina przycisk kłódki do wiersza kontrolki lil-gui — realizuje wymaganie 13 (blokowanie
// wybranych parametrów). Blokada to WYŁĄCZNIE wyłączenie kontrolki w UI (config.lockedFields,
// patrz config/schema.js) — nie jest to ograniczenie solvera ani reguła walidacji.
function makeLockable(controller, config, fieldName) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lock-toggle';
  btn.title = 'Zablokuj/odblokuj to pole przed przypadkową zmianą';
  // Znacznik stanu wartości (etap 10, sekcja 3): AUTO = pole nie jest zablokowane, wartość może
  // być swobodnie zmieniana; USER = użytkownik świadomie zablokował (ustalił) tę wartość.
  const badge = stateBadgeElement('auto');
  const sync = () => {
    const locked = config.lockedFields.includes(fieldName);
    btn.textContent = locked ? '🔒' : '🔓';
    btn.classList.toggle('locked', locked);
    setStateBadge(badge, locked ? 'user' : 'auto');
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
  controller.domElement.appendChild(badge);
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
  appearance,
  onAppearanceChange,
  container,
}) {
  // `container` — lewy panel workspace'u (patrz workspace.js); bez niego lil-gui przykleiłby się
  // do rogu body (stary układ). Grupy poniżej odpowiadają sekcjom specyfikacji etapu 10:
  // OGÓLNE / GEOMETRIA BIEGU / KONSTRUKCJA / MATERIAŁY.
  const gui = new GUI({ title: 'Parametry schodów', container });

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

  if (onReset) gui.add({ reset: onReset }, 'reset').name('↺ Resetuj ustawienia');

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
  live(build.add(config, 'stringerConstructionTypeOuter', stringerConstructionOptions)).name('Typ wangi zewn.');
  live(build.add(config, 'stringerConstructionTypeInner', stringerConstructionOptions)).name('Typ wangi wewn.');
  lockable(build.add(config, 'treadThickness', 20, 60, 1).name('Grubość stopnia [mm]'), 'treadThickness');
  lockable(build.add(config, 'nosing', 0, 40, 1).name('Nosek [mm]'), 'nosing');
  lockable(build.add(config, 'minimumStringerDepthMm', 150, 600, 10).name('Min. głębokość wangi [mm]'), 'minimumStringerDepthMm');
  lockable(build.add(config, 'stringerProfileOffsetMm', 0, 200, 5).name('Pogłębienie profilu [mm]'), 'stringerProfileOffsetMm');
  lockable(build.add(config, 'stringerCornerRadiusMm', 0, 300, 10).name('Promień narożników profilu [mm]'), 'stringerCornerRadiusMm');
  live(build.add(config, 'stringerRadiusScope', { 'Dół': 'BOTTOM', 'Góra': 'TOP', 'Góra i dół': 'BOTH' })).name('Zaokrąglaj/wygładzaj kontur');
  live(build.add(config, 'stringerTransitionStyle', { 'Łuk styczny': 'TANGENT_ARC', 'Ostry narożnik': 'SHARP', 'Spline (gładka, do CNC)': 'SPLINE' })).name('Kształt profilu wangi');
  lockable(build.add(config, 'stringerNotchRadiusMm', 0, 30, 1).name('Promień wewn. wcięcia (nakładana) [mm]'), 'stringerNotchRadiusMm');
  lockable(build.add(config, 'stringerThickness', 20, 60, 1).name('Grubość policzka [mm]'), 'stringerThickness');
  lockable(build.add(config, 'stringerTopMarginMm', 0, 120, 5).name('Zapas nad stopniem (wpuszczana) [mm]'), 'stringerTopMarginMm');
  lockable(build.add(config, 'stringerMinRemainingSectionMm', 10, 60, 5).name('Min. grubość drewna (próg) [mm]'), 'stringerMinRemainingSectionMm');
  live(build.add(config, 'hasCornerPost')).name('Słup konstrukcyjny na zakręcie');
  lockable(build.add(config, 'postSize', 60, 160, 5).name('Przekrój słupa [mm]'), 'postSize');
  live(build.add(config, 'hasRiserBoards')).name('Podstopnie (zamknięty stopień)');
  lockable(build.add(config, 'riserBoardThickness', 10, 50, 1).name('Grubość podstopnia [mm]'), 'riserBoardThickness');
  lockable(build.add(config, 'riserTopOverlapMm', 0, 30, 1).name('Zakładka podstopnia w stopień [mm]'), 'riserTopOverlapMm');

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

  // Kolory prezentacji: gotowa próbka albo własny kolor, osobno dla każdego elementu. Zapisywane w pliku
  // projektu, poza historią modelu (zmiana koloru nie zmienia geometrii).
  if (appearance) {
    const look = gui.addFolder('Kolory (prezentacja)');
    const presetOptions = { '— własny —': '', ...Object.fromEntries(COLOR_PRESETS.map((p) => [p.label, p.hex])) };
    for (const { key, label } of APPEARANCE_ELEMENTS) {
      const picker = look.addColor(appearance, key).name(label).onChange(() => onAppearanceChange && onAppearanceChange());
      const proxy = { preset: COLOR_PRESETS.find((p) => p.hex === appearance[key])?.hex ?? '' };
      look
        .add(proxy, 'preset', presetOptions)
        .name(`${label}: gotowe`)
        .onChange((hex) => {
          if (!hex) return;
          appearance[key] = hex;
          picker.updateDisplay();
          onAppearanceChange && onAppearanceChange();
        });
    }
  }

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
    ['winderWidth', 'Szer. zabiegu na linii pomiaru'],
    ['stringerSpacing', 'Rozstaw wang / min. głębokość'],
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

export function createInfoPanel(container = document.body) {
  const panel = document.createElement('div');
  panel.id = 'info-panel';
  container.appendChild(panel);
  return panel;
}

export function updateInfoPanel(panel, derived, planLayout, config, ceilingFit) {
  const rows = [];
  rows.push(`<div class="row"><span>Liczba stopni</span><b>${derived.numTreads}</b></div>`);
  rows.push(`<div class="row"><span>Głębokość stopnia (prosty)</span><b>${config.treadGoing.toFixed(0)} mm</b></div>`);
  rows.push(`<div class="row resultant"><span>Wysokość podstopnia ${AUTO_BADGE}</span><b>${derived.riserHeight.toFixed(1)} mm</b></div>`);
  rows.push(`<div class="row"><span>Wysokość kondygnacji</span><b>${config.totalRise.toFixed(0)} mm</b></div>`);

  if (planLayout) {
    const footprintX = planLayout.bounds.maxX - planLayout.bounds.minX;
    const footprintY = planLayout.bounds.maxY - planLayout.bounds.minY;
    rows.push(`<div class="row resultant"><span>Rzut klatki (dł. × szer.) ${AUTO_BADGE}</span><b>${footprintY.toFixed(0)} × ${footprintX.toFixed(0)} mm</b></div>`);
  }

  const blondelClass = derived.blondelOk ? 'ok' : 'warn';
  rows.push(`<div class="row resultant ${blondelClass}"><span>Wzór Blondela (2h+e) ${AUTO_BADGE}</span><b>${derived.blondel.toFixed(0)} mm</b></div>`);
  if (!derived.blondelOk) rows.push(`<div class="note warn">Poza zalecanym zakresem 600-650mm</div>`);

  const riserClass = derived.riserRangeOk ? 'ok' : 'warn';
  rows.push(`<div class="row ${riserClass}"><span>Zakres podstopnia</span><b>${derived.riserRangeOk ? 'OK' : 'UWAGA'}</b></div>`);

  if (derived.minInnerSegment !== null) {
    const innerClass = derived.minInnerWidthOk ? 'ok' : 'warn';
    rows.push(`<div class="row resultant ${innerClass}"><span>Szer. przy duszy ${AUTO_BADGE}</span><b>${derived.minInnerSegment.toFixed(0)} mm</b></div>`);
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


// --- Panel WALIDACJI (zakładka prawego panelu; Staircase Validator — src/validator/StaircaseValidator.js) ---
// Czysto prezentacyjne: ten plik nigdy nie liczy diagnostyki sam, tylko renderuje to, co
// przyszło z zewnątrz (main.js woła validateModels() i przekazuje wynik). Diagnostyki są
// grupowane wg poziomu (ERROR/WARNING/INFO); każda pokazuje element, ID reguły, wartość
// zmierzoną vs oczekiwaną i komunikat. Kliknięcie diagnostyki woła onSelect(diagnostic) —
// main.js decyduje, co podświetlić (UI nie zgaduje geometrii).
const SEVERITY_LABEL_PL = { ERROR: 'BŁĘDY', WARNING: 'OSTRZEŻENIA', INFO: 'INFORMACJE' };
const SEVERITY_BADGE_PL = { ERROR: 'BŁĄD', WARNING: 'UWAGA', INFO: 'INFO' };
const SEVERITY_ORDER = ['ERROR', 'WARNING', 'INFO'];
const ELEMENT_TYPE_LABEL_PL = { tread: 'Stopień', riser: 'Podstopień', stringer: 'Wanga', post: 'Słup', stair: 'Schody', config: 'Parametry' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Czytelna nazwa elementu: 'step-6' -> 'Stopień 7' (numer jak na planie 2D, 1-based).
export function describeDiagnosticElement(d) {
  const stepIndex = stepIndexFromElementId(d.elementId);
  if (stepIndex !== null) return `Stopień ${stepIndex + 1}`;
  const typeLabel = ELEMENT_TYPE_LABEL_PL[d.elementType] || d.elementType;
  return d.elementId ? `${typeLabel} ${d.elementId}` : typeLabel;
}

export function createValidatorPanel(container, { onSelect, onWaive, onUnwaive, onClearStale } = {}) {
  const panel = document.createElement('div');
  panel.id = 'validator-panel';
  panel.innerHTML = `<div id="validator-panel-summary"></div><div id="validator-panel-body"></div>`;
  container.appendChild(panel);
  panel._diagnostics = [];
  panel.querySelector('#validator-panel-body').addEventListener('click', (e) => {
    // Przyciski wyjątków obsługujemy PRZED zaznaczeniem — klik w przycisk nie ma zmieniać zaznaczenia.
    const action = e.target.closest('[data-action]');
    if (action) {
      e.stopPropagation();
      if (action.dataset.action === 'clear-stale') {
        onClearStale?.();
        return;
      }
      const d = panel._diagnostics[Number(action.closest('[data-diag-index]').dataset.diagIndex)];
      if (!d) return;
      if (action.dataset.action === 'waive') onWaive?.(d);
      else if (action.dataset.action === 'unwaive') onUnwaive?.(d);
      return;
    }
    const el = e.target.closest('[data-diag-index]');
    if (!el) return;
    const d = panel._diagnostics[Number(el.dataset.diagIndex)];
    if (d && onSelect) onSelect(d);
  });
  return panel;
}

function formatValueExpected(d) {
  if (d.value === null && d.expected === null) return '';
  const unit = d.unit ? ` ${d.unit}` : '';
  const fmt = (v) => (typeof v === 'object' ? JSON.stringify(v) : typeof v === 'number' ? `${Number(v.toFixed(2))}${unit}` : `${v}${unit}`);
  const parts = [];
  if (d.value !== null) parts.push(`zmierzono: <b>${escapeHtml(fmt(d.value))}</b>`);
  if (d.expected !== null) parts.push(`oczekiwano: <b>${escapeHtml(fmt(d.expected))}</b>`);
  return `<div class="validator-finding-detail">${parts.join(' · ')}</div>`;
}

function findingHTML(d, index, { selected, waived }) {
  const severity = d.severity;
  // Wyjątek ma sens dla błędów i ostrzeżeń; INFO niczego nie blokuje.
  const button = waived
    ? `<button type="button" class="validator-waive" data-action="unwaive" title="Przywróć ten problem do aktywnych">Cofnij wyjątek</button>`
    : severity === 'INFO'
      ? ''
      : `<button type="button" class="validator-waive" data-action="waive" title="Nie traktuj tego konkretnego problemu jako blokującego (nie naprawia geometrii)">Dodaj wyjątek</button>`;
  return `
        <div class="validator-finding ${severity.toLowerCase()}${selected ? ' selected' : ''}${waived ? ' waived' : ''}" data-diag-index="${index}" title="Kliknij, aby podświetlić element">
          <div class="validator-finding-head">
            <span class="validator-badge ${severity.toLowerCase()}">${SEVERITY_BADGE_PL[severity]}</span>
            <span class="validator-finding-location">${escapeHtml(describeDiagnosticElement(d))}</span>
            <code class="validator-rule">${escapeHtml(d.ruleId)}</code>
          </div>
          <div class="validator-finding-message">${escapeHtml(d.message)}</div>
          ${formatValueExpected(d)}
          ${button ? `<div class="validator-actions">${button}</div>` : ''}
        </div>`;
}

/**
 * @param {HTMLElement} panel
 * @param {import('../diagnostics/diagnostic.js').Diagnostic[]} diagnostics  AKTYWNE diagnostyki
 *   (bez tych objętych wyjątkiem).
 * @param {{selectedDiagnostic?: object|null, waivedDiagnostics?: object[], staleWaivers?: object[]}} [options]
 * @returns {{ERROR:number, WARNING:number, INFO:number}} liczby AKTYWNYCH wg poziomu (dla znaczników/statusu)
 */
export function updateValidatorPanel(panel, diagnostics, { selectedDiagnostic = null, waivedDiagnostics = [], staleWaivers = [] } = {}) {
  const summary = panel.querySelector('#validator-panel-summary');
  const body = panel.querySelector('#validator-panel-body');

  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const d of diagnostics) counts[d.severity] = (counts[d.severity] || 0) + 1;
  summary.innerHTML = `
    <span class="validator-count error">${counts.ERROR} błędów</span>
    <span class="validator-count warning">${counts.WARNING} ostrzeżeń</span>
    <span class="validator-count info">${counts.INFO} informacji</span>
    ${waivedDiagnostics.length ? `<span class="validator-count waived">${waivedDiagnostics.length} wyjątków</span>` : ''}
  `;

  // Indeks w panel._diagnostics = kolejność wyświetlania (po posortowaniu wg poziomu, potem
  // wyjątki), żeby data-diag-index z kliknięcia zawsze wskazywał dokładnie tę diagnostykę, którą widać.
  const ordered = [];
  for (const severity of SEVERITY_ORDER) ordered.push(...diagnostics.filter((d) => d.severity === severity));
  ordered.push(...waivedDiagnostics);
  panel._diagnostics = ordered;

  let html = '';
  if (diagnostics.length === 0 && waivedDiagnostics.length === 0) {
    html += `<div class="validator-empty">✔ Brak zastrzeżeń — model spełnia wszystkie sprawdzone reguły.</div>`;
  } else if (diagnostics.length === 0) {
    html += `<div class="validator-empty">✔ Brak aktywnych problemów — pozostały tylko zaakceptowane wyjątki.</div>`;
  }

  let index = 0;
  for (const severity of SEVERITY_ORDER) {
    const group = diagnostics.filter((d) => d.severity === severity);
    if (group.length === 0) continue;
    const items = group.map((d) => findingHTML(d, index++, { selected: d === selectedDiagnostic, waived: false })).join('');
    html += `<div class="validator-group ${severity.toLowerCase()}"><div class="validator-group-title">${SEVERITY_LABEL_PL[severity]} <span>${group.length}</span></div>${items}</div>`;
  }

  if (waivedDiagnostics.length > 0) {
    const items = waivedDiagnostics.map((d) => findingHTML(d, index++, { selected: d === selectedDiagnostic, waived: true })).join('');
    html += `
      <div class="validator-group waived">
        <div class="validator-group-title">ZAAKCEPTOWANE WYJĄTKI <span>${waivedDiagnostics.length}</span></div>
        <div class="validator-waived-note">Wyjątek tylko przestaje blokować kosztorys — nie naprawia geometrii i nie zmienia żadnej ilości. Kosztorys jest liczony mimo tych problemów, więc traktuj go ostrożnie.</div>
        ${items}
      </div>`;
  }

  if (staleWaivers.length > 0) {
    html += `<div class="validator-stale">${staleWaivers.length} wyjątków nie odpowiada już żadnemu problemowi (zniknął po zmianie parametrów). <button type="button" class="validator-waive" data-action="clear-stale">Usuń nieaktywne</button></div>`;
  }

  body.innerHTML = html;
  return counts;
}

// Przełącza tylko klasę .selected na już wyrenderowanych diagnostykach — bez przebudowy listy,
// więc scroll i stan panelu zostają, gdy zmienia się samo zaznaczenie.
export function markValidatorSelection(panel, selectedDiagnostic) {
  for (const el of panel.querySelectorAll('[data-diag-index]')) {
    el.classList.toggle('selected', selectedDiagnostic !== null && panel._diagnostics[Number(el.dataset.diagIndex)] === selectedDiagnostic);
  }
}
