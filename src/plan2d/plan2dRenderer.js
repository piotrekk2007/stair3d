// Rzut 2D z góry (SVG), budowany bezpośrednio z planLayout — niezależny od widoku 3D.
// Współrzędne SVG = współrzędne planu (mm) wprost, z odwróconym Y (SVG rośnie w dół, co dla
// rzutu "od wejścia w górę ekranu" jest wygodniejsze niż matematyczny układ).
//
// Widoczny obszar (pan/zoom) jest CAŁKOWICIE zewnętrzny wobec tego modułu — renderer tylko
// rysuje treść przy podanym `viewport` (patrz viewport.js), nigdy sam nie decyduje, co jest
// aktualnie widoczne. HUD (przyciski, legenda, odczyt skali) też żyje poza tym modułem
// (main.js) — SVG zwracany stąd to WYŁĄCZNIE treść rysunku, żeby powiększanie/przesuwanie
// widoku nigdy nie przesuwało elementów interfejsu razem z planem.

import { computeWinderBlank } from '../geometry/winderBlank.js';
import { getBoundaryPoints, getNominalBoundaryPoints } from '../geometry/edgeOverrides.js';
import { buildWalklineModel, WINDER_WIDTH_MEASURE_OFFSET_MM } from '../geometry/walklineModel.js';
import { smoothPath } from './smoothPath.js';

function fmt(n) {
  return Math.round(n * 100) / 100;
}

function polygonPoints(outline) {
  return outline.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Siatka pomocnicza (wymaganie 5: opcjonalna) — odstęp dobierany tak, żeby w bieżącym oknie
// widoku mieściło się rozsądnie mało linii niezależnie od poziomu przybliżenia (od 1mm przy
// bardzo dużym zoomie po 5m przy pełnym rzucie), zamiast jednego stałego rozstawu.
const GRID_STEPS_MM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
export function pickGridSpacing(viewportWidthMm, targetLines = 14) {
  const raw = viewportWidthMm / targetLines;
  let best = GRID_STEPS_MM[0];
  let bestDiff = Infinity;
  for (const step of GRID_STEPS_MM) {
    const diff = Math.abs(Math.log(step) - Math.log(raw));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = step;
    }
  }
  return best;
}

function gridXML(viewport) {
  const spacing = pickGridSpacing(viewport.width);
  const x0 = Math.floor(viewport.x / spacing) * spacing;
  const x1 = viewport.x + viewport.width;
  const y0 = Math.floor(viewport.y / spacing) * spacing;
  const y1 = viewport.y + viewport.height;
  const strokeWidth = Math.max(0.5, viewport.width / 2000);

  const lines = [];
  for (let x = x0; x <= x1; x += spacing) {
    lines.push(`<line x1="${fmt(x)}" y1="${fmt(viewport.y)}" x2="${fmt(x)}" y2="${fmt(y1)}"/>`);
  }
  for (let y = y0; y <= y1; y += spacing) {
    lines.push(`<line x1="${fmt(viewport.x)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}"/>`);
  }
  return `<g id="grid-layer" stroke="#dfe3e8" stroke-width="${strokeWidth}">${lines.join('')}</g>`;
}

function dimensionLine(x1, y1, x2, y2, label, strokeWidth) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return `
    <g class="dim">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1a5fb4" stroke-width="${strokeWidth}"/>
      <line x1="${x1}" y1="${y1 - 40}" x2="${x1}" y2="${y1 + 40}" stroke="#1a5fb4" stroke-width="${strokeWidth}"/>
      <line x1="${x2}" y1="${y2 - 40}" x2="${x2}" y2="${y2 + 40}" stroke="#1a5fb4" stroke-width="${strokeWidth}"/>
      <text x="${midX}" y="${midY}" font-size="130" fill="#1a5fb4" text-anchor="middle"
            transform="rotate(${angle} ${midX} ${midY})" dy="-20">${label}</text>
    </g>`;
}

// Oś biegu — linia środkowa (wymaganie 7: "osie") liczona jako połowa odległości między
// policzkiem zewnętrznym i wewnętrznym w każdym wierzchołku pełnej ścieżki — działa
// jednakowo na prostych odcinkach i w zabiegu, bo outerFullPath/innerFullPath mają zawsze
// tę samą liczbę wierzchołków (budowane łańcuchowo w lockstep w planLayout.js).
function axisXML(planLayout) {
  const pts = planLayout.outerFullPath.map((o, i) => lerpPoint(o, planLayout.innerFullPath[i], 0.5));
  return `<polyline points="${polygonPoints(pts)}" fill="none" stroke="#8f3fd1" stroke-width="6" stroke-dasharray="30,20,4,20"/>`;
}

// Linia biegu (walkline) — wymaganie 7. Liczona ZAWSZE z NOMINALNEJ (nieedytowanej) geometrii
// granic (getNominalBoundaryPoints — patrz edgeOverrides.js), nigdy z finalnej/edytowanej,
// bo to konstrukcyjna linia odniesienia (patrz docs/model/STAIRCASE_DATA_MODEL.md §3.2:
// "Walkline.path czyta zawsze Nominal").
const WALKLINE_SMOOTH_STEP_MM = 40;
function walklineXML(planLayout, config) {
  const n = planLayout.treads.length;
  const t = Math.min(1, Math.max(0, (config.stairWidth - config.walklineOffset) / config.stairWidth));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const boundary = getNominalBoundaryPoints(planLayout.treads, i);
    if (!boundary) continue; // np. granica przez pusty innerChain podestu — brak linii biegu tutaj
    pts.push(lerpPoint(boundary[1], boundary[0], t)); // boundary = [inner, outer]; lerp od outer(t=0) do inner(t=1)
  }
  if (pts.length < 2) return '';
  // Only the DRAWING is smoothed (a Catmull-Rom curve through the very same points, so a winder turn reads as an
  // arc and a straight flight stays straight) — the model's exact points are untouched.
  return `<polyline points="${polygonPoints(smoothPath(pts, WALKLINE_SMOOTH_STEP_MM))}" fill="none" stroke="#c0392b" stroke-width="8" stroke-dasharray="4,18" stroke-linecap="round"/>`;
}

// Granice biegu (wymaganie 7) — miejsca, gdzie zmienia się TYP odcinka (prosty -> zabiegowy
// -> podest -> prosty...), pokazane wyraźną, ciągłą poprzeczką w miejscu tej granicy.
function runBoundariesXML(planLayout) {
  const treads = planLayout.treads;
  const lines = [];
  for (let i = 1; i < treads.length; i++) {
    if (treads[i].type === treads[i - 1].type) continue;
    const { current } = getBoundaryPoints(treads, i);
    if (!current) continue;
    const [inner, outer] = current;
    lines.push(`<line x1="${fmt(inner.x)}" y1="${fmt(-inner.y)}" x2="${fmt(outer.x)}" y2="${fmt(-outer.y)}" stroke="#0f7a3d" stroke-width="14"/>`);
  }
  return `<g id="run-boundaries-layer">${lines.join('')}</g>`;
}

// Granice stopni (wymaganie 7 + 8/9: każdy stopień to osobny obiekt) — linie zawsze widoczne
// gdy warstwa włączona; kolorystyka koduje wymaganie 14 (auto/manual): szara przerywana =
// nominalna (automatyczna) pozycja z algorytmu, pomarańczowa ciągła = ręcznie skorygowana.
// Uchwyty do przeciągania (kółka) są dodawane OSOBNO, tylko w trybie edycji (editHandlesXML).
function stepBoundariesXML(planLayout, overrides) {
  const treads = planLayout.treads;
  const n = treads.length;
  let xml = '';
  for (let i = 0; i <= n; i++) {
    const { current } = getBoundaryPoints(treads, i);
    if (!current) continue;
    const [inner, outer] = current;
    const isManual = !!(overrides && overrides[i]);
    const color = isManual ? '#e08214' : '#9aa0a6';
    const dash = isManual ? 'none' : '20,20';
    xml += `<line class="step-boundary-line" data-boundary="${i}" x1="${fmt(inner.x)}" y1="${fmt(-inner.y)}" x2="${fmt(outer.x)}" y2="${fmt(-outer.y)}" stroke="${color}" stroke-width="6" stroke-dasharray="${dash}"/>`;
  }
  return `<g id="step-boundaries-layer">${xml}</g>`;
}

// One diamond handle per side (inner/outer) of the SELECTED tread only — dragging it shifts
// THAT tread's own edge on that side, independent of its neighbors (see
// src/geometry/edgeOverrides.js's applyTreadOverhangs). Positioned at the midpoint between the
// tread's own front/back corner on that side; `data-anchor-*`/`data-dir-*` encode the NOMINAL
// (pre-overhang) midpoint and the edge's own unit direction, so planInteractions.js can turn a
// 2D drag into the single scalar offsetMm this feature actually has (see its own header).
function overhangHandlesXML(planLayout, overhangs, selectedStepIndex) {
  if (selectedStepIndex === null || selectedStepIndex === undefined) return '';
  const tread = planLayout.treads.find((t) => t.index === selectedStepIndex);
  if (!tread || !tread.frontEdge?.length || !tread.backEdge?.length) return '';

  let xml = '';
  for (const [side, sideIdx] of [
    ['inner', 0],
    ['outer', 1],
  ]) {
    const front = tread.frontEdge[sideIdx];
    const back = tread.backEdge[sideIdx];
    const frontHinge = tread.frontEdge[1 - sideIdx];
    const dx = front.x - frontHinge.x;
    const dy = front.y - frontHinge.y;
    const len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };

    const current = overhangs?.[tread.index]?.side === side ? overhangs[tread.index].offsetMm : 0;
    const mid = { x: (front.x + back.x) / 2, y: (front.y + back.y) / 2 };
    // Recover the NOMINAL anchor by undoing the currently-applied offset — see
    // planInteractions.js's pointerdown handler for why this must be the pre-offset point.
    const anchor = { x: mid.x - dir.x * current, y: mid.y - dir.y * current };

    const isManual = !!(overhangs && overhangs[tread.index]?.side === side);
    const color = isManual ? '#e08214' : '#2a9d8f';
    xml += `
      <rect class="overhang-handle" data-tread="${tread.index}" data-side="${side}"
            data-anchor-x="${fmt(anchor.x)}" data-anchor-y="${fmt(anchor.y)}"
            data-dir-x="${dir.x}" data-dir-y="${dir.y}"
            x="${fmt(mid.x - 45)}" y="${fmt(-mid.y - 45)}" width="90" height="90"
            fill="#fff" stroke="${color}" stroke-width="10"
            transform="rotate(45 ${fmt(mid.x)} ${fmt(-mid.y)})" />`;
  }
  return `<g id="overhang-edit-layer">${xml}</g>`;
}

function editHandlesXML(planLayout, overrides) {
  const treads = planLayout.treads;
  const n = treads.length;
  let xml = '';
  for (let i = 0; i <= n; i++) {
    const { current } = getBoundaryPoints(treads, i);
    if (!current) continue;
    const [inner, outer] = current;
    const isManual = !!(overrides && overrides[i]);
    const color = isManual ? '#e08214' : '#9aa0a6';
    xml += `
      <circle class="edge-handle" data-boundary="${i}" data-endpoint="inner"
              cx="${fmt(inner.x)}" cy="${fmt(-inner.y)}" r="40" fill="#fff" stroke="${color}" stroke-width="10" />
      <circle class="edge-handle" data-boundary="${i}" data-endpoint="outer"
              cx="${fmt(outer.x)}" cy="${fmt(-outer.y)}" r="40" fill="#fff" stroke="${color}" stroke-width="10" />`;
  }
  return `<g id="edge-edit-layer">${xml}</g>`;
}

// Każdy stopień jako osobny obiekt logiczny (wymaganie 8) — <g data-step-index> pozwala
// zaznaczyć DOKŁADNIE jeden stopień (wymaganie 9); podświetlenie zaznaczenia to jedyny wyraz
// selekcji w SVG, panel z parametrami stopnia renderowany jest poza SVG (main.js/ui.js).
function stepsXML(planLayout, selectedStepIndex) {
  return planLayout.treads
    .map((t) => {
      const isSelected = t.index === selectedStepIndex;
      const isLanding = t.type === 'landing';
      const fill = isLanding ? '#e8d9b5' : t.type === 'winder' ? '#f0e6c8' : '#f5efdc';
      const stroke = isSelected ? '#1a5fb4' : '#333';
      const strokeWidth = isSelected ? 26 : 12;
      const cx = t.outline.reduce((s, p) => s + p.x, 0) / t.outline.length;
      const cy = t.outline.reduce((s, p) => s - p.y, 0) / t.outline.length;
      return `
      <g class="step-object${isSelected ? ' selected' : ''}" data-step-index="${t.index}">
        <polygon points="${polygonPoints(t.outline)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <text x="${fmt(cx)}" y="${fmt(cy)}" font-size="110" fill="#333" text-anchor="middle" dy="35">${t.index + 1}</text>
      </g>`;
    })
    .join('');
}

// Odcinek pomiarowy z etykietą — do wymiarów, które nie leżą w poziomie/pionie (szerokość
// stopnia zabiegowego, rozstaw wang). Punkty z modelu, współrzędne planu (odwrócone Y jak reszta).
function measureLineXML(a, b, label, color) {
  const mx = (a.x + b.x) / 2;
  const my = -(a.y + b.y) / 2;
  return `
    <g class="dim">
      <line x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="${color}" stroke-width="10"/>
      <circle cx="${fmt(a.x)}" cy="${fmt(-a.y)}" r="24" fill="${color}"/>
      <circle cx="${fmt(b.x)}" cy="${fmt(-b.y)}" r="24" fill="${color}"/>
      <text x="${fmt(mx)}" y="${fmt(my)}" font-size="85" fill="${color}" text-anchor="middle" dy="-30" stroke="#fff" stroke-width="14" paint-order="stroke">${label}</text>
    </g>`;
}

// Szerokość każdego stopnia ZABIEGOWEGO na stałej linii pomiarowej (WINDER_WIDTH_MEASURE_OFFSET_MM
// od duszy — ten sam punkt, w którym waliduje ją PL-LEGAL-C-01). Punkty czyta z walklineModel.js.
function winderWidthXML(planLayout, config) {
  const model = buildWalklineModel(planLayout, { ...config, walklineOffset: WINDER_WIDTH_MEASURE_OFFSET_MM });
  return model.points
    .filter((p) => planLayout.treads[Number(p.stepId.replace('step-', ''))]?.type === 'winder')
    .map((p) => measureLineXML(p.front, p.back, `${fmt(Math.hypot(p.back.x - p.front.x, p.back.y - p.front.y))} mm`, '#b8860b'))
    .join('');
}

// Rozstaw wang (odległość zewn.↔wewn. na pierwszej granicy, z nominalnej geometrii) oraz
// minimalny przekrój drewna wangi z parametrów — wymiary z modelu, nie ze współrzędnych ekranu.
function stringerSpacingXML(planLayout, config) {
  const boundary = getNominalBoundaryPoints(planLayout.treads, 0);
  if (!boundary) return '';
  const [inner, outer] = boundary;
  const spacing = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  return measureLineXML(inner, outer, `rozstaw wang ${fmt(spacing)} mm · min. drewno ${config.stringerMinRemainingSectionMm} mm`, '#6a3fb5');
}

/**
 * @param {import('../geometry/planLayout.js').PlanLayout} planLayout
 * @param {object} config
 * @param {object} derived
 * @param {object} options
 * @param {{x:number,y:number,width:number,height:number}} options.viewport  Widoczny obszar
 *   (SVG viewBox) — patrz plan2d/viewport.js. WYMAGANE; renderer nigdy nie liczy go sam,
 *   żeby stan pan/zoom żył wyłącznie w jednym miejscu (main.js).
 * @param {boolean} [options.showWinderBlanks]
 * @param {boolean} [options.editMode]
 * @param {number|null} [options.selectedStepIndex]
 * @param {{elementType:string, stringerId?:string, postId?:string}|null} [options.selection]  Zaznaczenie
 *   wangi/słupa (kształt z ui/selection.js) — tylko podświetlenie, renderer niczego nie wybiera sam.
 * @param {{grid?:boolean, axes?:boolean, widths?:boolean, walkline?:boolean,
 *   runBoundaries?:boolean, stepBoundaries?:boolean, stringers?:boolean,
 *   winderWidth?:boolean, stringerSpacing?:boolean}} [options.layers]
 * @param {Object<string,{removed?:boolean, overridden?:boolean}>} [options.postStates]  Stan słupów po
 *   ręcznych edycjach (z PostModel) — usunięty słup jest rysowany jako przerywany "duch" (nadal
 *   klikalny, żeby dało się go przywrócić), słup ze zmienioną długością ma pomarańczowy obrys.
 * @param {Object[]|null} [options.posts]  Wszystkie słupy (buildStaircase allPostModels, także usunięte) —
 *   rysowane dokładnie tam, gdzie stoją w modelu.
 */
export function renderPlan2DSVG(planLayout, config, derived, options) {
  const { viewport, showWinderBlanks = true, editMode = false, selectedStepIndex = null, selection = null, layers = {}, postStates = {}, posts = null, extraPosts = [], railingModel = null } = options;
  const b = planLayout.bounds;

  const treadsXML = stepsXML(planLayout, selectedStepIndex);

  const winderBlanksXML = !showWinderBlanks
    ? ''
    : planLayout.treads
        .filter((t) => t.type === 'winder')
        .map((t) => {
          const blank = computeWinderBlank(t, config.nosing);
          const cx = blank.corners.reduce((s, p) => s + p.x, 0) / 4;
          const cy = blank.corners.reduce((s, p) => s - p.y, 0) / 4;
          return `
      <polygon points="${polygonPoints(blank.corners)}" fill="none" stroke="#8f3fd1" stroke-width="14" stroke-dasharray="40,25"/>
      <text x="${fmt(cx)}" y="${fmt(cy)}" font-size="90" fill="#8f3fd1" text-anchor="middle" dy="-70">${fmt(blank.length)} × ${fmt(blank.depth)} mm</text>`;
        })
        .join('');

  // Wangi są zaznaczalne (etap 10): niewidoczna, szeroka nakładka ułatwia trafienie kliknięciem,
  // a data-side (outer|inner) to jawny identyfikator modelu — main.js nie zgaduje go z geometrii.
  const stringerPath = (side, pts) => {
    const selected = selection?.elementType === 'stringer' && selection.stringerId === side;
    return `
    <g class="stringer-path${selected ? ' selected' : ''}" data-side="${side}">
      <polyline points="${polygonPoints(pts)}" fill="none" stroke="${selected ? '#1a5fb4' : '#8a5a34'}" stroke-width="${selected ? 46 : 30}"/>
      <polyline points="${polygonPoints(pts)}" fill="none" stroke="transparent" stroke-width="110" pointer-events="stroke"/>
    </g>`;
  };
  const stringersXML = layers.stringers === false ? '' : stringerPath('outer', planLayout.outerFullPath) + stringerPath('inner', planLayout.innerFullPath);

  // ID słupa = ten sam co w postSolver.js (post-start / post-end / post-corner-<indeks zakrętu>;
  // przy "1 dużym podeście" drugi zakręt ma ten sam róg, więc dostaje ID pierwszego).
  const postRect = (postId, x, y, size) => {
    const selected = selection?.elementType === 'post' && selection.postId === postId;
    const state = postStates[postId] || {};
    if (state.removed) {
      // usunięty słup: przerywany kontur bez wypełnienia, ale klikalny (pointer-events na całym prostokącie)
      return `<rect class="post-marker removed${selected ? ' selected' : ''}" data-post-id="${postId}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(size)}" height="${fmt(size)}" fill="transparent" pointer-events="all" stroke="${selected ? '#1a5fb4' : '#a0855f'}" stroke-width="24" stroke-dasharray="60 40"/>`;
    }
    const stroke = selected ? '#1a5fb4' : state.overridden ? '#e07b00' : 'none';
    return `<rect class="post-marker${selected ? ' selected' : ''}${state.overridden ? ' overridden' : ''}" data-post-id="${postId}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(size)}" height="${fmt(size)}" fill="${selected ? '#1a5fb4' : '#5a3d24'}" stroke="${stroke}" stroke-width="30"/>`;
  };
  // Every post is drawn where its PostModel says it stands (postSolver.js — on the wanga's axis), never from a
  // position re-derived here. `posts` = allPostModels (removed ones included, drawn as ghosts); `extraPosts` is the
  // older name for the same list, kept for callers that only pass the balustrade posts.
  const postsXML = (posts ?? extraPosts).map((p) => postRect(p.postId, p.position.x - p.size / 2, -p.position.y - p.size / 2, p.size)).join('');

  // Balustrade (geometry/railingSolver.js): the whole side path thin and dashed, the handrail runs on top of
  // it thick, balusters as dots; where the dashed line has no thick line on top, no handrail follows the path
  // (the dusza side of a winder). Section ends are marked with a ring. Plan y is flipped for SVG.
  const railingLayerXML = (() => {
    if (layers.railing === false || !railingModel?.enabled) return '';
    const size = config.railingBalusterSizeMm || 30;
    const line = (pts, attrs) => `<polyline points="${pts.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ')}" fill="none" ${attrs}/>`;
    return railingModel.sections
      .filter((s) => s.valid)
      .map((s) => {
        const dashed = s.path?.length >= 2 ? line(s.path, 'stroke="#b07a3a" stroke-width="14" stroke-dasharray="60 50" opacity="0.7"') : '';
        const runs = s.runs.map((run) => line([run.pieces[0].start, ...run.pieces.map((p) => p.end)], 'stroke="#b07a3a" stroke-width="42" stroke-linecap="round"')).join('');
        const dots = s.balusters.map((b) => `<circle cx="${fmt(b.position.x)}" cy="${fmt(-b.position.y)}" r="${fmt(size / 2)}" fill="#5a3d24"/>`).join('');
        const first = s.runs[0]?.pieces[0]?.start;
        const lastRun = s.runs[s.runs.length - 1];
        const last = lastRun?.pieces[lastRun.pieces.length - 1]?.end;
        const ring = (p) => (p ? `<circle cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="70" fill="none" stroke="#1a5fb4" stroke-width="18"/>` : '');
        return `<g class="railing-section" data-section-id="${s.id}" pointer-events="none">${dashed}${runs}${dots}${ring(first)}${ring(last)}</g>`;
      })
      .join('');
  })();


  const footprintX = b.maxX - b.minX;
  const footprintY = b.maxY - b.minY;
  const widthsXML = layers.widths === false ? '' : `
    ${dimensionLine(fmt(b.minX), fmt(-b.maxY) - 350, fmt(b.maxX), fmt(-b.maxY) - 350, `${fmt(footprintX)} mm`, 12)}
    ${dimensionLine(fmt(b.minX) - 350, fmt(-b.maxY), fmt(b.minX) - 350, fmt(-b.minY), `${fmt(footprintY)} mm`, 12)}`;

  const arrowStart = planLayout.innerFullPath[0];
  const arrowXML = `
    <g stroke="#c0392b" stroke-width="20" fill="#c0392b">
      <line x1="${fmt(arrowStart.x + config.stairWidth / 2)}" y1="${fmt(-arrowStart.y + 200)}"
            x2="${fmt(arrowStart.x + config.stairWidth / 2)}" y2="${fmt(-arrowStart.y - 400)}"/>
      <polygon points="${fmt(arrowStart.x + config.stairWidth / 2 - 60)},${fmt(-arrowStart.y - 300)}
                        ${fmt(arrowStart.x + config.stairWidth / 2 + 60)},${fmt(-arrowStart.y - 300)}
                        ${fmt(arrowStart.x + config.stairWidth / 2)},${fmt(-arrowStart.y - 460)}"/>
    </g>`;

  const legendXML = `
    <g font-size="110" fill="#222">
      <text x="${fmt(b.minX)}" y="${fmt(-b.maxY - 550)}">Stopni: ${derived.numTreads} | głębokość ${config.treadGoing}mm | podstopień ${derived.riserHeight.toFixed(0)}mm | szer. biegu ${config.stairWidth}mm</text>
    </g>`;

  const gridXMLStr = layers.grid ? gridXML(viewport) : '';
  const axisXMLStr = layers.axes ? axisXML(planLayout) : '';
  const walklineXMLStr = layers.walkline ? walklineXML(planLayout, config) : '';
  const runBoundariesXMLStr = layers.runBoundaries ? runBoundariesXML(planLayout) : '';
  const stepBoundariesXMLStr = layers.stepBoundaries || editMode ? stepBoundariesXML(planLayout, config.manualEdgeOverrides) : '';
  const winderWidthXMLStr = layers.winderWidth ? winderWidthXML(planLayout, config) : '';
  const stringerSpacingXMLStr = layers.stringerSpacing ? stringerSpacingXML(planLayout, config) : '';
  const editXML = editMode ? editHandlesXML(planLayout, config.manualEdgeOverrides) : '';
  const overhangXML = editMode ? overhangHandlesXML(planLayout, config.manualTreadOverhangs, selectedStepIndex) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewport.x)} ${fmt(viewport.y)} ${fmt(viewport.width)} ${fmt(viewport.height)}" width="100%" height="100%">
    <rect x="${fmt(viewport.x)}" y="${fmt(viewport.y)}" width="${fmt(viewport.width)}" height="${fmt(viewport.height)}" fill="#ffffff"/>
    ${gridXMLStr}
    ${treadsXML}
    ${winderBlanksXML}
    ${stringersXML}
    ${axisXMLStr}
    ${walklineXMLStr}
    ${runBoundariesXMLStr}
    ${postsXML}
    ${railingLayerXML}
    ${arrowXML}
    ${widthsXML}
    ${winderWidthXMLStr}
    ${stringerSpacingXMLStr}
    ${legendXML}
    ${stepBoundariesXMLStr}
    ${editXML}
    ${overhangXML}
  </svg>`;
}

// Zwraca prostokąt otaczający CAŁY rzut (w konwencji Y-odwróconej SVG, jak reszta tego
// modułu) — używane przez main.js do "Dopasuj widok" (wymaganie 3), zawsze niezależnie od
// tego, co jest akurat narysowane/włączone jako warstwa.
export function planSvgBounds(planLayout) {
  const b = planLayout.bounds;
  return { minX: b.minX, maxX: b.maxX, minY: -b.maxY, maxY: -b.minY };
}
