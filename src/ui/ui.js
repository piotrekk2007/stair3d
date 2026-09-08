import GUI from 'lil-gui';

export function createUI({ config, onChange, onReset, viewState, onViewChange, exportHandlers = {}, onExportPlan2D, onTogglePlan2D, onSaveProject, onLoadProject, exportSelection }) {
  const gui = new GUI({ title: 'Parametry schodów' });

  if (onSaveProject) {
    gui.add({ save: onSaveProject }, 'save').name('💾 Zapisz projekt (JSON)');
  }
  if (onLoadProject) {
    gui.add({ load: onLoadProject }, 'load').name('📂 Wczytaj projekt (JSON)');
  }

  gui.add({ reset: onReset }, 'reset').name('↺ Resetuj ustawienia');

  gui.add(config, 'stairType', ['straight', 'L', 'U']).name('Typ schodów').onChange(onChange);
  gui.add(config, 'turnDirection', ['right', 'left']).name('Kierunek skrętu').onChange(onChange);

  const dims = gui.addFolder('Wymiary ogólne');
  dims.add(config, 'totalRise', 2000, 3600, 10).name('Wys. kondygnacji [mm]').onChange(onChange);
  dims.add(config, 'stairWidth', 700, 1400, 10).name('Szerokość biegu [mm]').onChange(onChange);
  dims.add(config, 'treadGoing', 180, 320, 5).name('Głębokość stopnia [mm]').onChange(onChange);

  const steps = gui.addFolder('Liczba stopni');
  steps.add(config, 'treadsLegA', 1, 15, 1).name('Proste (odc. A)').onChange(onChange);
  steps.add(config, 'turn1Type', ['winder', 'landing']).name('Zakręt 1: typ').onChange(onChange);
  steps.add(config, 'windersPerTurn', 2, 6, 1).name('Zabiegowe (każdy skręt)').onChange(onChange);
  steps.add(config, 'treadsLegB', 0, 15, 1).name('Proste (odc. B)').onChange(onChange);
  steps.add(config, 'turn2Type', ['winder', 'landing']).name('Zakręt 2: typ (tylko U)').onChange(onChange);
  steps.add(config, 'mergeLandings').name('1 duży podest (oba zakręty = landing)').onChange(onChange);
  steps.add(config, 'treadsLegC', 0, 15, 1).name('Proste (odc. C, tylko U)').onChange(onChange);

  const winder = gui.addFolder('Geometria zabiegu');
  winder.add(config, 'walklineOffset', 250, 500, 10).name('Odsunięcie linii biegu [mm]').onChange(onChange);
  winder.add(config, 'walklineSplitOffset', 250, 500, 10).name('Przesunięcie punktu podziału [mm]').onChange(onChange);
  winder.add(config, 'minInnerWidth', 80, 200, 5).name('Min. szer. przy duszy [mm]').onChange(onChange);

  const build = gui.addFolder('Konstrukcja');
  build.add(config, 'treadThickness', 20, 60, 1).name('Grubość stopnia [mm]').onChange(onChange);
  build.add(config, 'nosing', 0, 40, 1).name('Nosek [mm]').onChange(onChange);
  build.add(config, 'stringerHeight', 150, 450, 10).name('Wysokość policzka [mm]').onChange(onChange);
  build.add(config, 'stringerThickness', 20, 60, 1).name('Grubość policzka [mm]').onChange(onChange);
  build.add(config, 'hasCornerPost').name('Słup konstrukcyjny na zakręcie').onChange(onChange);
  build.add(config, 'postSize', 60, 160, 5).name('Przekrój słupa [mm]').onChange(onChange);
  build.add(config, 'hasRiserBoards').name('Podstopnie (zamknięty stopień)').onChange(onChange);
  build.add(config, 'riserBoardThickness', 10, 50, 1).name('Grubość podstopnia [mm]').onChange(onChange);

  const ceiling = gui.addFolder('Strop i otwór (ręczny)');
  ceiling.add(config, 'ceilingThickness', 150, 400, 10).name('Grubość stropu [mm]').onChange(onChange);
  ceiling.add(config, 'minHeadroom', 1900, 2200, 10).name('Min. skrajnia [mm]').onChange(onChange);
  ceiling.add(config, 'openingLength', 800, 5000, 50).name('Otwór: długość (Y) [mm]').onChange(onChange);
  ceiling.add(config, 'openingWidth', 700, 2500, 50).name('Otwór: szerokość (X) [mm]').onChange(onChange);
  ceiling.add(config, 'openingOffsetX', -2000, 2000, 10).name('Otwór: offset X [mm]').onChange(onChange);
  ceiling.add(config, 'openingOffsetY', -2000, 2000, 10).name('Otwór: offset Y [mm]').onChange(onChange);

  const view = gui.addFolder('Widok');
  view.add(viewState, 'showCeiling').name('Pokaż strop').onChange((v) => onViewChange('showCeiling', v));
  view.add(viewState, 'showDimensions').name('Pokaż wymiary').onChange((v) => onViewChange('showDimensions', v));
  view.add(viewState, 'showStringerLengths').name('Długości wang').onChange((v) => onViewChange('showStringerLengths', v));
  view.add(viewState, 'showWinderBlanks').name('Formatki zabiegowe').onChange((v) => onViewChange('showWinderBlanks', v));
  if (onTogglePlan2D) {
    view.add({ plan2d: () => onTogglePlan2D() }, 'plan2d').name('Plan 2D (pokaż/ukryj)');
  }
  view.add(viewState, 'plan2dShowWinderBlanks').name('Formatki na planie 2D').onChange((v) => onViewChange('plan2dShowWinderBlanks', v));

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
  rows.push(`<div class="row"><span>Wysokość podstopnia</span><b>${derived.riserHeight.toFixed(1)} mm</b></div>`);
  rows.push(`<div class="row"><span>Wysokość kondygnacji</span><b>${config.totalRise.toFixed(0)} mm</b></div>`);

  if (planLayout) {
    const footprintX = planLayout.bounds.maxX - planLayout.bounds.minX;
    const footprintY = planLayout.bounds.maxY - planLayout.bounds.minY;
    rows.push(`<div class="row"><span>Rzut klatki (dł. × szer.)</span><b>${footprintY.toFixed(0)} × ${footprintX.toFixed(0)} mm</b></div>`);
  }

  const blondelClass = derived.blondelOk ? 'ok' : 'warn';
  rows.push(`<div class="row ${blondelClass}"><span>Wzór Blondela (2h+e)</span><b>${derived.blondel.toFixed(0)} mm</b></div>`);
  if (!derived.blondelOk) rows.push(`<div class="note warn">Poza zalecanym zakresem 600-650mm</div>`);

  const riserClass = derived.riserRangeOk ? 'ok' : 'warn';
  rows.push(`<div class="row ${riserClass}"><span>Zakres podstopnia</span><b>${derived.riserRangeOk ? 'OK' : 'UWAGA'}</b></div>`);

  if (derived.minInnerSegment !== null) {
    const innerClass = derived.minInnerWidthOk ? 'ok' : 'warn';
    rows.push(`<div class="row ${innerClass}"><span>Szer. przy duszy</span><b>${derived.minInnerSegment.toFixed(0)} mm</b></div>`);
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

  panel.innerHTML = rows.join('');
}
