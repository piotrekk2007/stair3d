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
import { getBoundaryPoints, getNominalBoundaryPoints, effectiveEdgeOverrides } from '../geometry/edgeOverrides.js';
import { buildWalklineModel, WINDER_WIDTH_MEASURE_OFFSET_MM } from '../geometry/walklineModel.js';
import { boardPlanFootprint } from '../geometry/stringerModel.js';
import { boundaryEditPoints } from './edgeEdit.js';
import { starterHandles } from '../geometry/starterSteps.js';
import { sideShort } from '../util/sideNames.js';

function fmt(n) {
  return Math.round(n * 100) / 100;
}

// Screen-constant sizes. A technical plan keeps its lines, handles and labels the same size on screen whatever
// the zoom (like StairDesigner): strokes use non-scaling-stroke (width in px), and handle/label sizes are given in
// px and converted to plan mm with the current mm-per-pixel ratio. MM_PER_PX is set at the start of every
// renderPlan2DSVG call (rendering is synchronous); px() converts.
let MM_PER_PX = 1;
const px = (n) => fmt(n * MM_PER_PX);
const HAIR = 'vector-effect="non-scaling-stroke"';
const EDGE_HANDLE_PX = 8; // the square on each end of an edge
const OVERHANG_HANDLE_PX = 9; // the diamond for a tread's own side overhang
const OVERHANG_INSET_PX = 16; // the diamond sits this far inside the tread, never on top of an edge square

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

function dimensionLine(x1, y1, x2, y2, label) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  // ticks perpendicular to the dimension line, a fixed size on screen
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const tx = (-(y2 - y1) / len) * px(5);
  const ty = ((x2 - x1) / len) * px(5);
  return `
    <g class="dim">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1a5fb4" stroke-width="1" ${HAIR}/>
      <line x1="${fmt(x1 - tx)}" y1="${fmt(y1 - ty)}" x2="${fmt(x1 + tx)}" y2="${fmt(y1 + ty)}" stroke="#1a5fb4" stroke-width="1" ${HAIR}/>
      <line x1="${fmt(x2 - tx)}" y1="${fmt(y2 - ty)}" x2="${fmt(x2 + tx)}" y2="${fmt(y2 + ty)}" stroke="#1a5fb4" stroke-width="1" ${HAIR}/>
      <text x="${midX}" y="${midY}" font-size="${px(12)}" fill="#1a5fb4" text-anchor="middle"
            transform="rotate(${angle} ${midX} ${midY})" dy="${px(-4)}">${label}</text>
    </g>`;
}

// Oś biegu — linia środkowa (wymaganie 7: "osie") liczona jako połowa odległości między
// policzkiem zewnętrznym i wewnętrznym w każdym wierzchołku pełnej ścieżki — działa
// jednakowo na prostych odcinkach i w zabiegu, bo outerFullPath/innerFullPath mają zawsze
// tę samą liczbę wierzchołków (budowane łańcuchowo w lockstep w planLayout.js).
function axisXML(planLayout) {
  const pts = planLayout.outerFullPath.map((o, i) => lerpPoint(o, planLayout.innerFullPath[i], 0.5));
  return `<polyline points="${polygonPoints(pts)}" fill="none" stroke="#8f3fd1" stroke-width="1" stroke-dasharray="12,6,2,6" ${HAIR}/>`;
}

// Linia biegu (walkline) — wymaganie 7. The layout's own walkline (planLayout.walkline.path: straights and the
// quarter arc round the inner corner, geometry/winderArc.js), the NOMINAL construction line every winder edge was laid
// out through — never re-derived from the (possibly edited) edges. A small dot on each edge's walkline point.
function walklineXML(planLayout) {
  const path = planLayout.walkline?.path || [];
  if (path.length < 2) return '';
  const dots = (planLayout.walkline.points || [])
    .filter(Boolean)
    .map((p) => `<circle cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="${px(1.8)}" fill="#c0392b"/>`)
    .join('');
  return `<g class="walkline" pointer-events="none"><polyline points="${polygonPoints(path)}" fill="none" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="5,4" ${HAIR}/>${dots}</g>`;
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
    lines.push(`<line x1="${fmt(inner.x)}" y1="${fmt(-inner.y)}" x2="${fmt(outer.x)}" y2="${fmt(-outer.y)}" stroke="#0f7a3d" stroke-width="2" ${HAIR}/>`);
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
    const color = isManual ? '#e08214' : '#7d8a96';
    const dash = isManual ? 'none' : '4,3';
    xml += `<line class="step-boundary-line" data-boundary="${i}" x1="${fmt(inner.x)}" y1="${fmt(-inner.y)}" x2="${fmt(outer.x)}" y2="${fmt(-outer.y)}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" ${HAIR}/>`;
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
    // Drawn a little INSIDE the tread (never on top of an edge square); the anchor written for planInteractions.js
    // is shifted by the same amount, so grabbing the diamond where it is drawn starts at the current offset.
    const inset = OVERHANG_INSET_PX * MM_PER_PX;
    const at = { x: mid.x - dir.x * inset, y: mid.y - dir.y * inset };
    const anchorAt = { x: anchor.x - dir.x * inset, y: anchor.y - dir.y * inset };
    const h = (OVERHANG_HANDLE_PX / 2) * MM_PER_PX;
    const diamond = [
      [at.x, -at.y - h],
      [at.x + h, -at.y],
      [at.x, -at.y + h],
      [at.x - h, -at.y],
    ].map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
    xml += `
      <polygon class="overhang-handle" data-tread="${tread.index}" data-side="${side}"
            data-anchor-x="${fmt(anchorAt.x)}" data-anchor-y="${fmt(anchorAt.y)}"
            data-dir-x="${dir.x}" data-dir-y="${dir.y}"
            points="${diamond}" fill="${isManual ? color : '#fff'}" stroke="${color}" stroke-width="1.2" ${HAIR}><title>Wysunięcie boku stopnia (prawy klik: usuń)</title></polygon>`;
  }
  return `<g id="overhang-edit-layer">${xml}</g>`;
}

// Edit mode: every edge as one group — a wide invisible hit line, the visible edge between its two edit points (on
// the stringer lines, see edgeEdit.js boundaryEditPoints) and a small square on each end, a fixed size on screen.
// Hovering a group turns the edge red and shows its pivot on the walkline (style.css); dragging an end turns the edge
// about that pivot (planInteractions.js + edgeEdit.js pivotEdgeDrag), Alt+drag moves that end alone.
function editHandlesXML(planLayout, overrides, config, activeBoundary) {
  const treads = planLayout.treads;
  const n = treads.length;
  const h = (EDGE_HANDLE_PX / 2) * MM_PER_PX;
  let xml = '';
  for (let i = 0; i <= n; i++) {
    const e = boundaryEditPoints(planLayout, i, overrides);
    if (!e) continue;
    const isManual = !!(e.manual.inner || e.manual.outer);
    const color = isManual ? '#e08214' : '#3d6d99';
    const square = (endpoint, p) =>
      `<rect class="edge-handle" data-boundary="${i}" data-endpoint="${endpoint}" x="${fmt(p.x - h)}" y="${fmt(-p.y - h)}" width="${fmt(2 * h)}" height="${fmt(2 * h)}" fill="${isManual ? color : '#fff'}" stroke="${color}" stroke-width="1.2" ${HAIR}/>`;
    const line = (cls, extra) => `<line class="${cls}" x1="${fmt(e.inner.x)}" y1="${fmt(-e.inner.y)}" x2="${fmt(e.outer.x)}" y2="${fmt(-e.outer.y)}" ${extra}/>`;
    const pivot = e.pivot ? `<circle class="edge-pivot" cx="${fmt(e.pivot.x)}" cy="${fmt(-e.pivot.y)}" r="${px(3.5)}" fill="#c0392b"/>` : '';
    xml += `
      <g class="edge-edit${i === activeBoundary ? ' active' : ''}${isManual ? ' manual' : ''}" data-boundary="${i}" data-step-index="${Math.min(i, n - 1)}">
        ${line('edge-hit', `stroke="transparent" stroke-width="10" ${HAIR}`)}
        ${line('edge-line', `stroke="${color}" stroke-width="1.2" ${HAIR}`)}
        ${pivot}
        ${square('inner', e.inner)}
        ${square('outer', e.outer)}
        <title>Krawędź ${i}: przeciągnij koniec — obrót wokół punktu na linii biegu; Alt — przesuń tylko ten koniec; prawy klik — przywróć</title>
      </g>`;
  }
  return `<g id="edge-edit-layer">${xml}</g>`;
}

// The stairwell (geometry/stairwell.js stairwellPlanDrawing, already in the plan frame): the walls along the sides marked
// so (thick grey, on the wall side of the outer line) and every side's length outside them — a FIXED side with its
// dimension (green when met, red when off), a free one as it comes out. Drawing only (pointer-events none).
// The wall editor (plan mode "▭ Ściany", user request 2026-10-23): every side of both lines where a wall can stand
// (dashed — a click adds a wall along the whole side), every wall (right-click removes it) with a handle at each end
// (drag along the side: snaps to the side's ends, the tread edges and 10 mm — main.js) and its length.
export function wallEditXML(drawing, config) {
  if (!drawing) return '';
  const color = '#b36b00';
  let xml = '';
  for (const c of drawing.candidates || []) {
    const o = { x: c.outward.x * px(3), y: c.outward.y * px(3) };
    xml += `<line class="wall-candidate" data-side="${c.side}" data-line="${c.line}" x1="${fmt(c.a.x + o.x)}" y1="${fmt(-(c.a.y + o.y))}" x2="${fmt(c.b.x + o.x)}" y2="${fmt(-(c.b.y + o.y))}" stroke="#9a9a9a" stroke-opacity="0.55" stroke-width="${px(6)}" stroke-dasharray="${px(10)} ${px(6)}" pointer-events="stroke"><title>Klik — dodaj ścianę: bok ${c.side}, strona ${sideShort(c.line, config)}</title></line>`;
  }
  for (const w of drawing.walls || []) {
    const o = { x: w.outward.x * px(3), y: w.outward.y * px(3) };
    xml += `<line class="wall-piece" data-wall-id="${w.id}" x1="${fmt(w.a.x + o.x)}" y1="${fmt(-(w.a.y + o.y))}" x2="${fmt(w.b.x + o.x)}" y2="${fmt(-(w.b.y + o.y))}" stroke="${color}" stroke-opacity="0.35" stroke-width="${px(12)}" pointer-events="stroke"><title>Ściana: bok ${w.side}, strona ${sideShort(w.line, config)}, ${Math.round(w.lengthMm)} mm — przeciągnij końce; prawy klik — usuń</title></line>`;
    // the handles at the wall's own stretch (no corner lengthening), on its face
    for (const [end, p] of [['a', w.spanA], ['b', w.spanB]]) {
      const off = (w.a.x - w.spanA.x) * w.outward.x + (w.a.y - w.spanA.y) * w.outward.y;
      const h = { x: p.x + w.outward.x * off, y: p.y + w.outward.y * off };
      xml += `<circle class="wall-handle" data-wall-id="${w.id}" data-end="${end}" cx="${fmt(h.x)}" cy="${fmt(-h.y)}" r="${px(6)}" fill="#fff" stroke="${color}" stroke-width="2" ${HAIR}><title>Przeciągnij koniec ściany wzdłuż boku</title></circle>`;
    }
    const dir = { x: w.b.x - w.a.x, y: w.b.y - w.a.y };
    const m = { x: (w.spanA.x + w.spanB.x) / 2 + w.outward.x * px(22), y: (w.spanA.y + w.spanB.y) / 2 + w.outward.y * px(22) };
    const angle = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
    xml += `<text x="${fmt(m.x)}" y="${fmt(-m.y)}" font-size="${px(11)}" fill="${color}" text-anchor="middle" dominant-baseline="middle" stroke="#fff" stroke-width="3" paint-order="stroke" ${HAIR} pointer-events="none" transform="rotate(${upright.toFixed(2)} ${fmt(m.x)} ${fmt(-m.y)})">ściana ${w.side} ${sideShort(w.line, config)}: ${Math.round(w.lengthMm)}</text>`;
  }
  return `<g id="wall-edit-layer">${xml}</g>`;
}

export function stairwellXML(drawing) {
  if (!drawing) return '';
  const wall = '#6b6b6b';
  let xml = '';
  for (const w of drawing.walls || []) {
    // the line is the wall's inner face; the stroke is drawn on the wall side
    const o = { x: w.outward.x * px(3), y: w.outward.y * px(3) };
    xml += `<line x1="${fmt(w.a.x + o.x)}" y1="${fmt(-(w.a.y + o.y))}" x2="${fmt(w.b.x + o.x)}" y2="${fmt(-(w.b.y + o.y))}" stroke="${wall}" stroke-width="6" stroke-linecap="butt" ${HAIR}/>`;
    // a wall along part of its side only: a cap at each free end and its length beside it (inside the stair's side)
    if (w.partial) {
      const cap = { x: w.outward.x * px(10), y: w.outward.y * px(10) };
      for (const [p, free] of [[w.a, !w.prevWall], [w.b, !w.nextWall]]) {
        if (free) xml += `<line x1="${fmt(p.x)}" y1="${fmt(-p.y)}" x2="${fmt(p.x + cap.x)}" y2="${fmt(-(p.y + cap.y))}" stroke="${wall}" stroke-width="2" ${HAIR}/>`;
      }
      const dir = { x: w.b.x - w.a.x, y: w.b.y - w.a.y };
      const m = { x: (w.a.x + w.b.x) / 2 - w.outward.x * px(10), y: (w.a.y + w.b.y) / 2 - w.outward.y * px(10) };
      const angle = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
      xml += `<text x="${fmt(m.x)}" y="${fmt(-m.y)}" font-size="${px(10)}" fill="${wall}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${upright.toFixed(2)} ${fmt(m.x)} ${fmt(-m.y)})">ściana ${w.side}: ${Math.round(w.lengthMm)}</text>`;
    }
  }
  for (const d of drawing.dims || []) {
    const w = (drawing.walls || []).find((x) => x.side === d.side);
    const dir = { x: d.b.x - d.a.x, y: d.b.y - d.a.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    // outside the stair: the wall's outward side, else the left of the side's direction
    const n = w ? w.outward : { x: -dir.y / len, y: dir.x / len };
    const off = px(w ? 22 : 16);
    const a = { x: d.a.x + n.x * off, y: d.a.y + n.y * off };
    const b = { x: d.b.x + n.x * off, y: d.b.y + n.y * off };
    const color = !d.fixed ? '#555' : d.ok ? '#2e7d32' : '#c0392b';
    const state = d.main ? 'główny' : 'sztywny';
    const text = d.fixed ? `${d.side}: ${Math.round(d.value)}${d.ok ? '' : ` (${state} ${d.target})`} 🔒${d.main ? ' ★' : ''}` : `${d.side}: ${Math.round(d.value)} (swobodny)`;
    xml += `<line x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="${color}" stroke-width="1" ${HAIR}/>`;
    for (const [p, q] of [[d.a, a], [d.b, b]]) xml += `<line x1="${fmt(p.x)}" y1="${fmt(-p.y)}" x2="${fmt(q.x)}" y2="${fmt(-q.y)}" stroke="${color}" stroke-width="0.8" stroke-dasharray="2 2" ${HAIR}/>`;
    const m = { x: (a.x + b.x) / 2 + n.x * px(8), y: (a.y + b.y) / 2 + n.y * px(8) };
    const angle = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
    xml += `<text x="${fmt(m.x)}" y="${fmt(-m.y)}" font-size="${px(11)}" fill="${color}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${upright.toFixed(2)} ${fmt(m.x)} ${fmt(-m.y)})">${text}</text>`;
  }
  return `<g id="stairwell-layer" pointer-events="none">${xml}</g>`;
}

// "▮ Słupki" mode (geometry/railingPostEdits.js, railingSolver.js section.postSpots): every balustrade section's path
// as a wide click target (a click adds a post), every post spot as a handle — a hand-placed one orange (drag = move,
// right-click = remove), an automatic one white (right-click on a corner = switch it off) — and every switched-off
// corner as a dashed ghost (click = back on). On top of everything; ids from the model only.
export function railingPostEditXML(railingModel, selection = null) {
  if (!railingModel?.enabled) return '';
  let xml = '';
  // the ceiling opening's edges: a click switches an edge's balustrade on / off (green = on, grey dashed = off)
  for (const e of railingModel.openingEdges || []) {
    const color = e.enabled ? '#2e7d32' : '#9e9e9e';
    const why = e.exit ? ' (wyjście schodów)' : e.wall ? ' (przy ścianie)' : e.wallPartial ? ' (częściowo przy ścianie — tam bez balustrady)' : '';
    xml += `<line class="railing-opening-edge${e.enabled ? ' on' : ''}" data-opening-edge="${e.index}" x1="${fmt(e.a.x)}" y1="${fmt(-e.a.y)}" x2="${fmt(e.b.x)}" y2="${fmt(-e.b.y)}" stroke="${color}" stroke-opacity="${e.enabled ? 0.45 : 0.35}" stroke-width="${px(12)}" ${e.enabled ? '' : 'stroke-dasharray="6 4"'} ${HAIR} pointer-events="stroke"><title>Krawędź otworu ${e.index + 1}${why}: balustrada ${e.enabled ? 'TAK' : 'NIE'}${e.overridden ? ' (ręcznie)' : ''} — kliknij, żeby przełączyć</title></line>`;
  }
  for (const s of railingModel.sections || []) {
    if (!s.valid || !(s.path?.length >= 2)) continue;
    xml += `<polyline class="railing-path-hit" data-section-id="${s.id}" points="${s.path.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ')}" fill="none" stroke="#1a5fb4" stroke-opacity="0.12" stroke-width="${px(18)}" stroke-linecap="round" pointer-events="stroke"><title>Kliknij, żeby dodać słupek</title></polyline>`;
    for (const g of s.suppressedCorners || []) {
      xml += `<circle class="railing-post-ghost" data-section-id="${s.id}" data-s="${g.s}" cx="${fmt(g.at.x)}" cy="${fmt(-g.at.y)}" r="${px(8)}" fill="#fff" fill-opacity="0.6" stroke="#888" stroke-width="1.5" stroke-dasharray="3 2" ${HAIR} pointer-events="all"><title>Słupek narożny wyłączony — kliknij, żeby go przywrócić</title></circle>`;
    }
    for (const spot of s.postSpots || []) {
      const manual = spot.kind === 'manual';
      const selected = selection?.elementType === 'post' && selection.postId === spot.postId;
      const tip = manual
        ? 'Słupek ręczny: przeciągnij wzdłuż balustrady, prawy klik — usuń'
        : spot.moved
          ? 'Słupek automatyczny PRZESUNIĘTY: przeciągnij dalej, prawy klik — przywróć AUTO'
          : spot.suppressible
            ? 'Słupek narożny (automatyczny): przeciągnij — przesuń, prawy klik — wyłącz (poręcz przejdzie przez narożnik)'
            : spot.movable
              ? 'Słupek końcowy odcinka (automatyczny): przeciągnij — przesuń (balustrada zaczyna / kończy się tam)'
              : 'Słupek automatyczny (uskok poręczy / podział szkła) — kliknij, żeby edytować w Inspektorze';
      // hand-placed: orange; an automatic one moved by hand: orange ring
      const fill = manual ? '#e07b00' : '#fff';
      const stroke = selected ? '#1a5fb4' : spot.moved ? '#e07b00' : '#5a3d24';
      xml += `<circle class="railing-post-handle${manual ? ' manual' : ''}${spot.movable ? ' movable' : ''}" data-section-id="${s.id}" data-post-id="${spot.postId}" data-kind="${spot.kind}" data-s="${spot.s ?? ''}" data-manual-id="${spot.manualId ?? ''}" data-spot-key="${spot.spotKey ?? ''}" data-movable="${spot.movable ? 1 : 0}" data-moved="${spot.moved ? 1 : 0}" data-suppressible="${spot.suppressible ? 1 : 0}" cx="${fmt(spot.at.x)}" cy="${fmt(-spot.at.y)}" r="${px(selected ? 9 : 7)}" fill="${fill}" stroke="${stroke}" stroke-width="${selected || spot.moved ? 3 : 2}" ${HAIR} pointer-events="all"><title>${tip}</title></circle>`;
    }
  }
  return `<g id="railing-post-edit-layer">${xml}</g>`;
}

// The length of one edge of the ceiling opening, written beside it (upright, on the side of the normal (dy, −dx) —
// outward for the CCW outline): while drawing and editing the opening (user request 2026-10-23).
export function edgeLengthLabelXML(a, b, color = '#1a5fb4') {
  const dir = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1) return '';
  const m = { x: (a.x + b.x) / 2 + (dir.y / len) * px(10), y: (a.y + b.y) / 2 - (dir.x / len) * px(10) };
  const angle = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
  return `<text class="opening-length" x="${fmt(m.x)}" y="${fmt(-m.y)}" font-size="${px(11)}" fill="${color}" text-anchor="middle" dominant-baseline="middle" stroke="#fff" stroke-width="3" paint-order="stroke" ${HAIR} pointer-events="none" transform="rotate(${upright.toFixed(2)} ${fmt(m.x)} ${fmt(-m.y)})">${Math.round(len)}</text>`;
}

// Otwór w stropie (prostokąt albo narysowany wielokąt — geometry/ceilingOpening.js, obrys z deriveCeilingFit).
// Poza trybem edycji to tylko rysunek (pointer-events none — nie zasłania kliknięć w stopnie). W trybie edycji:
// kółka na wierzchołkach (.opening-vertex, przeciągnij; prawy klik usuwa), kropki w połowie boków (.opening-mid,
// przeciągnij = nowy wierzchołek) i wnętrze (.opening-body, przeciągnij = przesuń cały otwór).
export function openingXML(opening, editMode = false) {
  if (!opening?.outline || opening.outline.length < 3) return '';
  const pts = opening.outline;
  const invalid = !!opening.invalidReason;
  const color = invalid ? '#c0392b' : '#1a5fb4';
  const minX = Math.min(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const label = opening.shape === 'derived' ? 'otwór w stropie (wyznaczony ze schodów)' : opening.shape === 'polygon' ? 'otwór w stropie (wielokąt)' : invalid ? 'otwór w stropie (prostokąt — wielokąt niepoprawny)' : 'otwór w stropie (prostokąt)';
  let xml = `<polygon class="opening-body${editMode ? ' editable' : ''}" points="${polygonPoints(pts)}" fill="${color}" fill-opacity="${editMode ? 0.1 : 0.05}" stroke="${color}" stroke-width="1.5" stroke-dasharray="10 5" ${HAIR} pointer-events="${editMode ? 'all' : 'none'}"/>`;
  xml += `<text x="${fmt(minX + px(6))}" y="${fmt(-maxY + px(14))}" font-size="${px(11)}" fill="${color}" pointer-events="none">${label}</text>`;
  if (editMode) {
    // a whole edge is dragged along its normal (the outline is CCW: outward = (dy, −dx))
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      xml += `<line class="opening-edge" data-index="${i}" data-ax="${fmt(a.x)}" data-ay="${fmt(a.y)}" data-nx="${((b.y - a.y) / len).toFixed(6)}" data-ny="${(-(b.x - a.x) / len).toFixed(6)}" x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="${color}" stroke-opacity="0.001" stroke-width="${px(10)}" pointer-events="stroke"><title>Przeciągnij, żeby przesunąć ten bok otworu</title></line>`;
    });
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      xml += `<circle class="opening-mid" data-after="${i}" cx="${fmt((a.x + b.x) / 2)}" cy="${fmt(-(a.y + b.y) / 2)}" r="${px(4)}" fill="${color}" fill-opacity="0.55" stroke="#fff" stroke-width="1" ${HAIR}/>`;
    });
    pts.forEach((a, i) => {
      xml += edgeLengthLabelXML(a, pts[(i + 1) % pts.length], color);
    });
    pts.forEach((p, i) => {
      xml += `<circle class="opening-vertex" data-index="${i}" cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="${px(5)}" fill="#fff" stroke="${color}" stroke-width="1.5" ${HAIR}/>`;
    });
  }
  return `<g id="ceiling-opening-layer">${xml}</g>`;
}

// Szkic rysowanego otworu (tryb „Rysuj otwór"): łamana przez kliknięte punkty + gumka do kursora; pierwszy punkt
// wyróżniony — kliknięcie w niego zamyka wielokąt. Czysty łańcuch SVG (planInteractions.js wstawia go do bieżącego <svg>).
export function openingDraftXML(points, cursor) {
  const all = cursor ? [...points, cursor] : points;
  if (all.length === 0) return '';
  const line = all.length >= 2 ? `<polyline points="${polygonPoints(all)}" fill="none" stroke="#1a5fb4" stroke-width="2" ${HAIR}/>` : '';
  const closing = points.length >= 3 && cursor ? `<line x1="${fmt(cursor.x)}" y1="${fmt(-cursor.y)}" x2="${fmt(points[0].x)}" y2="${fmt(-points[0].y)}" stroke="#1a5fb4" stroke-width="1" stroke-dasharray="6 4" ${HAIR}/>` : '';
  const dots = points.map((p, i) => `<circle cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="${px(i === 0 ? 6 : 4)}" fill="${i === 0 ? '#1a5fb4' : '#fff'}" stroke="#1a5fb4" stroke-width="1.5" ${HAIR}/>`).join('');
  // every drawn edge's length, the rubber band's included (and the closing edge's, once it can close)
  let lengths = all.slice(1).map((p, i) => edgeLengthLabelXML(all[i], p)).join('');
  if (points.length >= 3 && cursor) lengths += edgeLengthLabelXML(cursor, points[0], '#5b7fae');
  return `<g class="opening-draft" pointer-events="none">${closing}${line}${dots}${lengths}</g>`;
}

// Każdy stopień jako osobny obiekt logiczny (wymaganie 8) — <g data-step-index> pozwala
// zaznaczyć DOKŁADNIE jeden stopień (wymaganie 9); podświetlenie zaznaczenia to jedyny wyraz
// selekcji w SVG, panel z parametrami stopnia renderowany jest poza SVG (main.js/ui.js).
// Step numbers sit on the walkline, halfway between the tread's front and back walkline points (the edge pivots),
// like a technical stair plan; a tread without both points (a landing) gets its number at its centroid.
function stepsXML(planLayout, selectedStepIndex, pivots) {
  return planLayout.treads
    .map((t) => {
      const isSelected = t.index === selectedStepIndex;
      const isLanding = t.type === 'landing';
      const fill = isSelected ? '#cfe2f6' : isLanding ? '#e4edf5' : t.type === 'winder' ? '#e9f1f8' : '#f1f6fa';
      const stroke = isSelected ? '#1a5fb4' : '#3d5568';
      const a = pivots?.[t.index];
      const b = pivots?.[t.index + 1];
      const c = a && b
        ? { x: (a.x + b.x) / 2, y: -(a.y + b.y) / 2 }
        : { x: t.outline.reduce((s, p) => s + p.x, 0) / t.outline.length, y: t.outline.reduce((s, p) => s - p.y, 0) / t.outline.length };
      return `
      <g class="step-object${isSelected ? ' selected' : ''}" data-step-index="${t.index}">
        <polygon points="${polygonPoints(t.outline)}" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? 2 : 1}" ${HAIR}/>
        <text x="${fmt(c.x)}" y="${fmt(c.y)}" font-size="${px(12)}" font-weight="600" fill="#1f2d3a" text-anchor="middle" dy="${px(4)}" stroke="#fff" stroke-width="3" paint-order="stroke" ${HAIR}>${t.index + 1}</text>
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
      <line x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="${color}" stroke-width="1" ${HAIR}/>
      <circle cx="${fmt(a.x)}" cy="${fmt(-a.y)}" r="${px(2.5)}" fill="${color}"/>
      <circle cx="${fmt(b.x)}" cy="${fmt(-b.y)}" r="${px(2.5)}" fill="${color}"/>
      <text x="${fmt(mx)}" y="${fmt(my)}" font-size="${px(11)}" fill="${color}" text-anchor="middle" dy="${px(-4)}" stroke="#fff" stroke-width="3" paint-order="stroke" ${HAIR}>${label}</text>
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
 * @param {{outer, inner}|null} [options.stringerModels]  StringerModel po stronach + [options.stringerConstruction]
 *   ich geometria konstrukcyjna — wangi rysowane jako prawdziwe deski w rzucie (boardPlanFootprint).
 * @param {boolean} [options.clientView]  the plan for the client (the offer): no editing aids (balustrade end rings)
 * @param {Object[]|null} [options.posts]  Wszystkie słupy (buildStaircase allPostModels, także usunięte) —
 *   rysowane dokładnie tam, gdzie stoją w modelu.
 */
// The drag handles of the SELECTED starter step (geometry/starterSteps.js starterHandles): orange squares at its
// widened ends, its front's middle and where its roundings meet the front; a thin dashed line marks the stair's own
// lines it is widened from. Drawn above everything, pointer-events on.
export function starterHandlesXML(planLayout, selection) {
  if (selection?.elementType !== 'tread') return '';
  const tread = planLayout?.treads?.[selection.stepIndex];
  const handles = starterHandles(tread);
  if (!handles.length) return '';
  const L = tread.starter.layout;
  const at = (u, v) => ({ x: L.origin.x + L.uDir.x * u + L.vDir.x * v, y: L.origin.y + L.uDir.y * u + L.vDir.y * v });
  let xml = '';
  for (const u of [L.lineLeft, L.lineRight]) {
    const a = at(u, -L.nosingMm - 40);
    const b = at(u, L.D);
    xml += `<line x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="#e07b00" stroke-width="1" stroke-dasharray="4 3" ${HAIR} pointer-events="none"/>`;
  }
  const s = px(10);
  for (const h of handles) {
    xml += `<rect class="starter-handle" data-step-index="${tread.index}" data-kind="${h.kind}" x="${fmt(h.at.x - s / 2)}" y="${fmt(-h.at.y - s / 2)}" width="${fmt(s)}" height="${fmt(s)}" fill="#e07b00" stroke="#fff" stroke-width="1.5" ${HAIR} pointer-events="all" style="cursor:move"><title>${h.title}</title></rect>`;
  }
  return `<g id="starter-handles-layer">${xml}</g>`;
}

export function renderPlan2DSVG(planLayout, config, derived, options) {
  const { viewport, showWinderBlanks = true, editMode = false, selectedStepIndex = null, selection = null, layers = {}, postStates = {}, posts = null, extraPosts = [], railingModel = null, stringerModels = null, stringerConstruction = null, metalStructure = null, opening = null, stairwell = null, openingEdit = false, railingPostEdit = false, wallEdit = false, activeBoundary = null, clientView = false } = options;
  // mm of the plan per screen pixel (main.js passes it from the panel size); a caller without a panel (the offer's
  // plan image) gets a reasonable value from the viewport, as if it were drawn about 1000 px wide.
  MM_PER_PX = options.mmPerPx > 0 ? options.mmPerPx : Number(viewport?.width) > 0 ? viewport.width / 1000 : 1;
  const b = planLayout.bounds;

  // each boundary's walkline point (the edge pivot) — numbers sit on the walkline between them
  const pivots = planLayout.walkline?.points || [];
  const treadsXML = stepsXML(planLayout, selectedStepIndex, pivots);

  const winderBlanksXML = !showWinderBlanks
    ? ''
    : planLayout.treads
        .filter((t) => t.type === 'winder')
        .map((t) => {
          const blank = computeWinderBlank(t, config.nosing);
          const cx = blank.corners.reduce((s, p) => s + p.x, 0) / 4;
          const cy = blank.corners.reduce((s, p) => s - p.y, 0) / 4;
          return `
      <polygon points="${polygonPoints(blank.corners)}" fill="none" stroke="#8f3fd1" stroke-width="1" stroke-dasharray="6,4" ${HAIR}/>
      <text x="${fmt(cx)}" y="${fmt(cy)}" font-size="${px(10)}" fill="#8f3fd1" text-anchor="middle" dy="${px(-14)}">${fmt(blank.length)} × ${fmt(blank.depth)} mm</text>`;
        })
        .join('');

  // Wangi są zaznaczalne (etap 10): niewidoczna, szeroka nakładka ułatwia trafienie kliknięciem,
  // a data-side (outer|inner) to jawny identyfikator modelu — main.js nie zgaduje go z geometrii.
  // Each board is drawn as its REAL plan footprint (stringerModel.js boardPlanFootprint: thickness into the stair,
  // between its own end faces — stopping at a post), so the treads visibly enter it; the chain polyline underneath
  // is only a wide transparent hit area. Without the models (older callers) the chain line is drawn as before.
  const stringerPath = (side, pts) => {
    const selected = selection?.elementType === 'stringer' && selection.stringerId === side;
    const model = stringerModels?.[side];
    const geos = stringerConstruction?.[side] || [];
    const boards = model
      ? model.segments
          .map((seg, i) => `<polygon points="${polygonPoints(boardPlanFootprint(seg, geos[i]))}" fill="${selected ? '#1a5fb4' : '#c9a57f'}" stroke="${selected ? '#0d3b73' : '#5a3d24'}" stroke-width="1" ${HAIR}/>`)
          .join('')
      : `<polyline points="${polygonPoints(pts)}" fill="none" stroke="${selected ? '#1a5fb4' : '#8a5a34'}" stroke-width="${selected ? 46 : 30}"/>`;
    return `
    <g class="stringer-path${selected ? ' selected' : ''}" data-side="${side}">
      ${boards}
      <polyline points="${polygonPoints(pts)}" fill="none" stroke="transparent" stroke-width="110" pointer-events="stroke"/>
    </g>`;
  };
  // Metal stair (metalStructureModel.js): the plan footprint of every beam / flat bar, under the treads (dashed).
  const metalXML = (metalStructure?.members || [])
    .filter((m) => m.kind === 'beam' || m.kind === 'plate')
    .map((m) => {
      const at = (u, n) => ({ x: m.origin.x + m.dir.x * u + m.normal.x * n, y: m.origin.y + m.dir.y * u + m.normal.y * n });
      const corners = [at(m.bounds.uMin, m.nFrom), at(m.bounds.uMax, m.nFrom), at(m.bounds.uMax, m.nTo), at(m.bounds.uMin, m.nTo)];
      return `<polygon class="metal-footprint" data-metal-id="${m.id}" points="${polygonPoints(corners)}" fill="#5f6368" fill-opacity="0.35" stroke="#33373b" stroke-width="1" stroke-dasharray="6,3" pointer-events="none" ${HAIR}/>`;
    })
    .join('');
  const stringersXML = layers.stringers === false ? '' : stringerPath('outer', planLayout.outerFullPath) + stringerPath('inner', planLayout.innerFullPath) + metalXML;

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
        // wall handrail brackets (railingSolver.js buildWallRail): a short bar from the handrail to the wall
        const brackets = s.runs
          .filter((r) => r.wallRail)
          .flatMap((r) => r.brackets || [])
          .map((b) => `<line x1="${fmt(b.position.x)}" y1="${fmt(-b.position.y)}" x2="${fmt(b.wall.x)}" y2="${fmt(-b.wall.y)}" stroke="#37474f" stroke-width="16"/>`)
          .join('');
        // glass panes (railingGlass.js): each pane as a thick light-blue bar, its fixings as small dark squares
        const panes = (s.glassPanes || [])
          .map((pane) => {
            const bar = `<line class="glass-pane" x1="${fmt(pane.start.x)}" y1="${fmt(-pane.start.y)}" x2="${fmt(pane.end.x)}" y2="${fmt(-pane.end.y)}" stroke="#4aa3c7" stroke-width="${fmt(Math.max(24, pane.thicknessMm * 2.5))}" opacity="0.8"/>`;
            const marks = pane.fixings
              .filter((f, i, all) => all.findIndex((g) => Math.abs(g.t - f.t) < 1) === i)
              .map((f) => `<rect x="${fmt(pane.start.x + pane.dir.x * f.t - 18)}" y="${fmt(-(pane.start.y + pane.dir.y * f.t) - 18)}" width="36" height="36" fill="#37474f"/>`)
              .join('');
            return bar + marks;
          })
          .join('');
        // (the section's ends are its balustrade's — a wall handrail past them is not marked)
        const posted = s.runs.filter((r) => !r.wallRail);
        const first = posted[0]?.pieces[0]?.start;
        const lastRun = posted[posted.length - 1];
        const last = lastRun?.pieces[lastRun.pieces.length - 1]?.end;
        // the blue rings mark where a balustrade section starts / ends — an editing aid, left out of the client's plan
        const ring = (p) => (p && !clientView ? `<circle class="railing-end-ring" cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="70" fill="none" stroke="#1a5fb4" stroke-width="18"/>` : '');
        return `<g class="railing-section" data-section-id="${s.id}" pointer-events="none">${dashed}${runs}${panes}${dots}${brackets}${ring(first)}${ring(last)}</g>`;
      })
      .join('');
  })();


  const footprintX = b.maxX - b.minX;
  const footprintY = b.maxY - b.minY;
  const widthsXML = layers.widths === false ? '' : `
    ${dimensionLine(fmt(b.minX), fmt(-b.maxY) - 350, fmt(b.maxX), fmt(-b.maxY) - 350, `${fmt(footprintX)} mm`)}
    ${dimensionLine(fmt(b.minX) - 350, fmt(-b.maxY), fmt(b.minX) - 350, fmt(-b.minY), `${fmt(footprintY)} mm`)}`;

  // The walking-direction arrow: in the middle of the first front edge, along the first flight. (It used to stand at
  // the inner line's start + half the width in +x — beside the flight for a right turn.)
  const arrowXML = (() => {
    const inner0 = planLayout.innerFullPath[0];
    const outer0 = planLayout.outerFullPath[0];
    const outer1 = planLayout.outerFullPath[1] || outer0;
    const len = Math.hypot(outer1.x - outer0.x, outer1.y - outer0.y) || 1;
    const d = { x: (outer1.x - outer0.x) / len, y: (outer1.y - outer0.y) / len };
    const n = { x: -d.y, y: d.x };
    const mid = { x: (inner0.x + outer0.x) / 2, y: (inner0.y + outer0.y) / 2 };
    const at = (along, across = 0) => `${fmt(mid.x + d.x * along + n.x * across)},${fmt(-(mid.y + d.y * along + n.y * across))}`;
    const [x1, y1] = at(-200).split(',');
    const [x2, y2] = at(400).split(',');
    return `
    <g class="plan-arrow" stroke="#c0392b" stroke-width="20" fill="#c0392b">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
      <polygon points="${at(300, -60)} ${at(300, 60)} ${at(460)}"/>
    </g>`;
  })();

  const legendXML = `
    <g font-size="${px(12)}" fill="#222">
      <text x="${fmt(b.minX)}" y="${fmt(-b.maxY - 550)}">Stopni: ${derived.numTreads} | głębokość ${config.treadGoing}mm | podstopień ${derived.riserHeight.toFixed(0)}mm | szer. biegu ${config.stairWidth}mm</text>
    </g>`;

  const gridXMLStr = layers.grid ? gridXML(viewport) : '';
  const axisXMLStr = layers.axes ? axisXML(planLayout) : '';
  const walklineXMLStr = layers.walkline ? walklineXML(planLayout) : '';
  const runBoundariesXMLStr = layers.runBoundaries ? runBoundariesXML(planLayout) : '';
  // only the edge edits that really took effect are drawn as edited (an out-of-date or rejected one is not)
  const liveEdits = effectiveEdgeOverrides(planLayout, config.manualEdgeOverrides);
  const stepBoundariesXMLStr = layers.stepBoundaries && !editMode ? stepBoundariesXML(planLayout, liveEdits) : '';
  const winderWidthXMLStr = layers.winderWidth ? winderWidthXML(planLayout, config) : '';
  const stringerSpacingXMLStr = layers.stringerSpacing ? stringerSpacingXML(planLayout, config) : '';
  const openingXMLStr = layers.ceilingOpening === false && !openingEdit ? '' : openingXML(opening, openingEdit);
  const stairwellXMLStr = layers.stairwell === false ? '' : stairwellXML(stairwell);
  const editXML = editMode ? editHandlesXML(planLayout, liveEdits, config, activeBoundary) : '';
  const overhangXML = editMode ? overhangHandlesXML(planLayout, config.manualTreadOverhangs, selectedStepIndex) : '';

  const railingPostEditXMLStr = railingPostEdit ? railingPostEditXML(railingModel, selection) : '';
  const wallEditXMLStr = wallEdit ? wallEditXML(stairwell, config) : '';

  // a new project not generated yet (config.stairPending): only the stairwell's walls and the ceiling opening
  if (config.stairPending) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewport.x)} ${fmt(viewport.y)} ${fmt(viewport.width)} ${fmt(viewport.height)}" width="100%" height="100%">
    <rect x="${fmt(viewport.x)}" y="${fmt(viewport.y)}" width="${fmt(viewport.width)}" height="${fmt(viewport.height)}" fill="#ffffff"/>
    ${gridXMLStr}
    ${stairwellXMLStr}
    ${openingXMLStr}
    ${wallEditXMLStr}
  </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewport.x)} ${fmt(viewport.y)} ${fmt(viewport.width)} ${fmt(viewport.height)}" width="100%" height="100%">
    <rect x="${fmt(viewport.x)}" y="${fmt(viewport.y)}" width="${fmt(viewport.width)}" height="${fmt(viewport.height)}" fill="#ffffff"/>
    ${gridXMLStr}
    ${stairwellXMLStr}
    ${treadsXML}
    ${winderBlanksXML}
    ${stringersXML}
    ${axisXMLStr}
    ${walklineXMLStr}
    ${runBoundariesXMLStr}
    ${postsXML}
    ${railingLayerXML}
    ${openingEdit ? '' : openingXMLStr}
    ${arrowXML}
    ${widthsXML}
    ${winderWidthXMLStr}
    ${stringerSpacingXMLStr}
    ${legendXML}
    ${stepBoundariesXMLStr}
    ${editXML}
    ${overhangXML}
    ${openingEdit ? openingXMLStr : ''}
    ${railingPostEditXMLStr}
    ${wallEditXMLStr}
    ${openingEdit || railingPostEdit || wallEdit || clientView ? '' : starterHandlesXML(planLayout, selection)}
  </svg>`;
}

// Zwraca prostokąt otaczający CAŁY rzut (w konwencji Y-odwróconej SVG, jak reszta tego
// modułu) — używane przez main.js do "Dopasuj widok" (wymaganie 3), zawsze niezależnie od
// tego, co jest akurat narysowane/włączone jako warstwa.
export function planSvgBounds(planLayout, extraPoints = []) {
  const b = planLayout.bounds;
  // extraPoints: e.g. the ceiling opening's outline, which may reach past the stair — so "fit" shows it whole.
  const extra = Array.isArray(extraPoints) ? extraPoints.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  const xs = [b.minX, b.maxX, ...extra.map((p) => p.x)];
  const ys = [b.minY, b.maxY, ...extra.map((p) => p.y)];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: -Math.max(...ys), maxY: -Math.min(...ys) };
}
