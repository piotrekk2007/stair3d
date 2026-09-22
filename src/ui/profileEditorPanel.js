// PANEL EDYTORA PROFILU WANGI (widok boczny). Rysuje bok wangi (renderer: profileEditor/
// profileEditorRenderer.js) i zamienia gesty użytkownika na ZDARZENIA EDYCJI (PROFILE_EDITS z
// geometry/stringerProfileModel.js) — nigdy nie zmienia siatki ani geometrii. Zdarzenie trafia do main.js
// (handlers.applyEdit), który zmienia wyłącznie config.manualStringerProfileOverrides i woła zwykłe
// rebuild(): solver -> 3D/plan/walidacja/kosztorys. Panel niczego nie liczy poza przeliczeniem pozycji
// wskaźnika na współrzędne profilu (offsetFromDrag, snapDragTarget) — decyzje geometryczne zostają
// w solverze; "podgląd AUTO" i "kopiuj na drugą wangę" wołają PRAWDZIWY solver drugi raz wyłącznie do
// PORÓWNANIA/odczytu, nigdy nie liczą nic same.
//
// Obsługa:
//   przeciągnięcie punktu        — przesuwa punkt kontrolny (ds/dn względem pozycji nominalnej);
//                                  przyciąga do elewacji innego punktu i do obwiedni min. głębokości,
//                                  inaczej zaokrągla do siatki 5 mm; dymek przy kursorze pokazuje liczby
//   strzałki (gdy zaznaczony)    — precyzyjne przesunięcie punktu: 1 mm, z Shift 10 mm
//   dwuklik na konturze          — wstawia nowy punkt kontrolny
//   prawy klik                   — menu: wstaw/usuń/resetuj/ustaw promień, zależnie od celu
//   Delete                       — usuwa wstawiony punkt (albo cofa edycję punktu kotwiczonego)
//   kółko / przeciągnięcie tła   — powiększenie / przesunięcie widoku
//   pasek pozycji pod widokiem   — które miejsce całej wangi ogląda się teraz; klik przełącza deskę
//   formularz pod widokiem       — dokładne wartości (przesunięcie, promień zaokrąglenia)

import { buildProfileViewModel, offsetFromDrag } from '../geometry/stringerProfileView.js';
import { buildStringerConstructionGeometry } from '../geometry/stringerConstructionGeometry.js';
import { PROFILE_EDITS, PROFILE_MODES, sanitizeStringerProfileOverrides } from '../geometry/stringerProfileModel.js';
import {
  renderProfileEditorSVG,
  renderPositionRibbonSVG,
  layoutSegments,
  contentBounds,
  fromSvg,
  EDITOR_FIT_MARGIN_MM,
} from '../profileEditor/profileEditorRenderer.js';
import { snapDragTarget, roundToGrid } from '../profileEditor/profileEditorSnapping.js';
import { fitToBounds, zoomAt, panBy, screenToViewportPoint } from '../plan2d/viewport.js';
import { buildStringerBoardDXF, buildStringerAllBoardsDXF } from '../export/dxfExport.js';
import { downloadTextFile } from '../export/downloadTextFile.js';

const SIDE_LABELS = { outer: 'Wanga zewnętrzna', inner: 'Wanga wewnętrzna (dusza)' };
const OTHER_SIDE = { outer: 'inner', inner: 'outer' };
const WHEEL_ZOOM_STEP = 1.15;
// A point closer than this (in u, mm) to the end of an edge is not a place to insert a new control point.
const MIN_INSERT_DISTANCE_MM = 5;
const MIN_INSERTED_T = 0.02;
// Ruch mniejszy niż to (px ekranu) po pointerdown poza punktem kontrolnym to jeszcze nie przesuwanie
// widoku — dopiero powyżej tego progu przechwytujemy wskaźnik (patrz komentarz przy pointerdown).
const PAN_START_THRESHOLD_PX = 3;
// Krok precyzyjnego przesuwania strzałkami; z Shift — dziesięciokrotność.
const NUDGE_STEP_MM = 1;
const NUDGE_STEP_FAST_MM = 10;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * @param {HTMLElement} container
 * @param {Object} handlers
 * @param {() => ({config:Object, models:Object}|null)} handlers.getContext  bieżący config + modele z buildStaircase()
 * @param {(edit:Object) => void} handlers.applyEdit   zmienia override'y i woła rebuild() (bez wpisu do historii)
 * @param {() => void} handlers.commit                 zatwierdza zmianę w historii cofania
 */
export function createProfileEditor(container, handlers) {
  container.innerHTML = `
    <div class="pe-toolbar">
      <label>Wanga: <select data-pe="side"><option value="outer">${SIDE_LABELS.outer}</option><option value="inner">${SIDE_LABELS.inner}</option></select></label>
      <label>Deska: <select data-pe="segment"></select></label>
      <button type="button" data-pe="mode" title="AUTO: profil w pełni wyliczony, ręczne punkty są nieaktywne. RĘCZNY: ręczne punkty i promienie działają."></button>
      <button type="button" data-pe="reset" title="Usuwa wszystkie ręczne zmiany profilu tej wangi">Resetuj profil wangi</button>
      <button type="button" data-pe="mirror" title="Kopiuje ustawienia profilu (te same przesunięcia i promienie, przypisane do tych samych stopni) na drugą wangę — to nie jest lustrzane odbicie geometrii, tylko powtórzenie tych samych wartości.">Kopiuj profil na drugą wangę</button>
      <button type="button" data-pe="export-board" title="Rzeczywisty (skala 1:1) rysunek DXF widocznej deski — kontur, wręgi (jeśli wpuszczana) i pozycje stopni — do wycięcia w warsztacie">Eksportuj deskę (DXF 1:1)</button>
      <button type="button" data-pe="export-all" title="Wszystkie deski tej wangi na jednym arkuszu DXF, w skali 1:1, ułożone obok siebie">Eksportuj całą wangę (DXF 1:1)</button>
      <button type="button" data-pe="fit">⤢ Dopasuj</button>
      <span class="pe-layers">
        <label><input type="checkbox" data-pe-layer="reference" checked> oś odniesienia</label>
        <label><input type="checkbox" data-pe-layer="envelope" checked> min. głębokość</label>
        <label><input type="checkbox" data-pe-layer="treads" checked> stopnie</label>
        <label><input type="checkbox" data-pe-layer="housings" checked title="Gdzie jest wycięte gniazdo stopnia, WŁĄCZNIE z noskiem — sprawdź, czy nosek mieści się w wandze">wręgi (z noskiem)</label>
        <label><input type="checkbox" data-pe-layer="nominal" checked> profil AUTO (porównanie)</label>
        <label><input type="checkbox" data-pe-layer="ruler" checked> linijka</label>
      </span>
    </div>
    <div class="pe-canvas" tabindex="0"></div>
    <div class="pe-ribbon" title="Które miejsce całej wangi jest teraz widoczne — kliknij deskę, żeby ją pokazać"></div>
    <div class="pe-info"></div>
    <div class="pe-hint">Przeciągnij punkt, żeby zmienić kształt (strzałki: precyzyjnie, Shift = 10 mm) · dwuklik na konturze dodaje punkt · prawy klik: menu · Delete usuwa zaznaczony punkt · kółko: powiększenie · przeciągnięcie tła: przesunięcie</div>
    <div class="pe-drag-tooltip" hidden></div>
    <div class="pe-ctx-menu" hidden></div>
  `;
  const $ = (sel) => container.querySelector(sel);
  const canvas = $('.pe-canvas');
  const info = $('.pe-info');
  const sideSelect = $('[data-pe="side"]');
  const modeButton = $('[data-pe="mode"]');
  const segmentSelect = $('[data-pe="segment"]');
  const ribbon = $('.pe-ribbon');
  const dragTooltip = $('.pe-drag-tooltip');
  const ctxMenu = $('.pe-ctx-menu');
  const hintEl = $('.pe-hint');
  const defaultHint = hintEl.textContent;

  // Krótki komunikat w miejscu podpowiedzi na dole — na razie tylko dla "Kopiuj na drugą wangę",
  // gdzie solver może po cichu odrzucić część skopiowanych punktów (patrz ten przycisk), a użytkownik
  // musi się o tym dowiedzieć, zamiast patrzeć na nic-się-nie-zmieniło.
  function showToast(message, ms = 6000) {
    hintEl.textContent = message;
    hintEl.classList.add('toast');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      hintEl.textContent = defaultHint;
      hintEl.classList.remove('toast');
    }, ms);
  }

  const state = {
    side: 'outer',
    selected: null, // { id, contour }
    viewport: null,
    layers: { reference: true, envelope: true, treads: true, housings: true, nominal: true, ruler: true },
    layout: [],
    views: [],
    drag: null,
    pan: null,
    focus: null, // id deski, na której skaluje się widok; 'all' = wszystkie deski w jednym rzędzie
    lastFitKey: '',
  };

  function panelSize() {
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), left: r.left, top: r.top };
  }

  function currentViews() {
    const ctx = handlers.getContext();
    if (!ctx || !ctx.models || !ctx.models.stringerConstruction) return null;
    const model = ctx.models.stringerModels[state.side];
    const geo = ctx.models.stringerConstruction[state.side];
    if (!model || !geo) return null;
    return { ctx, views: buildProfileViewModel(geo, model, ctx.models.fullConfig || ctx.config) };
  }

  // Domyślnie widok dopasowuje się do JEDNEJ deski — na całej wandze (kilka metrów) jeden piksel to kilkanaście mm,
  // za mało do precyzyjnej edycji kształtu.
  function fit() {
    const size = panelSize();
    const layout = layoutSegments(state.views);
    const seg = state.focus && state.focus !== 'all' ? layout.find((l) => l.segmentId === state.focus) : null;
    const bounds = seg
      ? { minX: seg.offsetX + seg.uMin, maxX: seg.offsetX + seg.uMax, minY: -seg.vMax, maxY: -Math.min(seg.vMin, 0) }
      : contentBounds(layout);
    state.viewport = fitToBounds(bounds, size.w, size.h, EDITOR_FIT_MARGIN_MM);
  }

  function syncSegmentSelect() {
    const ids = state.views.map((v) => v.segmentId);
    const key = ids.join(',');
    if (segmentSelect.dataset.ids !== key) {
      segmentSelect.dataset.ids = key;
      segmentSelect.innerHTML = ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('') + (ids.length > 1 ? '<option value="all">wszystkie</option>' : '');
    }
    if (state.focus !== 'all' && !ids.includes(state.focus)) state.focus = ids[0] || 'all';
    segmentSelect.value = state.focus;
  }

  function findControlPoint(id, contour) {
    for (const v of state.views) for (const c of v.controlPoints) if (c.id === id && c.contour === contour && c.withinSegment) return { view: v, cp: c };
    return null;
  }

  function overridesFor(ctx, side = state.side) {
    return sanitizeStringerProfileOverrides(ctx.config.manualStringerProfileOverrides)[side] || null;
  }

  // "Profil AUTO (porównanie)": rozwiązuje TEN SAM, prawdziwy solver drugi raz, na configu z usuniętymi
  // ręcznymi edycjami TYLKO tej wangi — wyłącznie do narysowania przerywanej linii porównawczej, nigdy
  // do niczego innego (nie zmienia configu, nie woła rebuild()). Bearing/tread/pozycje desek nie zależą
  // od tej warstwy nadpisań, więc układ (layoutSegments) jest identyczny jak dla wersji edytowanej.
  function nominalViewsFor(ctx) {
    const entry = overridesFor(ctx);
    if (!entry) return null; // nic nie zmienione — linia AUTO byłaby identyczna z edytowaną, nie ma sensu jej liczyć
    const full = ctx.models.fullConfig || ctx.config;
    const strippedOverrides = { ...sanitizeStringerProfileOverrides(full.manualStringerProfileOverrides) };
    delete strippedOverrides[state.side];
    const nominalConfig = { ...full, manualStringerProfileOverrides: strippedOverrides };
    const model = ctx.models.stringerModels[state.side];
    return buildProfileViewModel(buildStringerConstructionGeometry(model, nominalConfig), model, nominalConfig);
  }

  function renderInfo(ctx) {
    const entry = overridesFor(ctx);
    const mode = entry ? entry.mode : PROFILE_MODES.AUTO;
    modeButton.textContent = mode === PROFILE_MODES.MANUAL ? 'Tryb: RĘCZNY' : 'Tryb: AUTO';
    modeButton.classList.toggle('manual', mode === PROFILE_MODES.MANUAL);
    modeButton.disabled = !entry;
    $('[data-pe="reset"]').disabled = !entry;

    const parts = [];
    const found = state.selected ? findControlPoint(state.selected.id, state.selected.contour) : null;
    if (found) {
      const { cp } = found;
      const cur = cp.tangent ? offsetFromDrag(cp, { u: cp.u, v: cp.v }) : { ds: 0, dn: 0 };
      const contourLabel = cp.contour === 'lower' ? 'dolny' : 'górny';
      parts.push(`<div class="pe-point"><b>Punkt: ${escapeHtml(cp.id)}</b> <small>kontur ${contourLabel} · ${cp.kind === 'inserted' ? 'dodany ręcznie' : cp.kind === 'overridden' ? 'zmieniony ręcznie' : 'kotwiczony do stopnia'}</small>`);
      parts.push(`<label>Głębiej (+) / płycej (−) o <input type="number" step="5" data-pe-field="dn" value="${Math.round(cur.dn * 10) / 10}"> mm</label>`);
      if (cp.kind === 'inserted') parts.push(`<label>Położenie na odcinku (0–1) <input type="number" step="0.05" min="0.02" max="0.98" data-pe-field="t" value="${Math.round(cp.t * 100) / 100}"></label>`);
      else parts.push(`<label>Wzdłuż wangi <input type="number" step="5" data-pe-field="ds" value="${Math.round(cur.ds * 10) / 10}"> mm</label>`);
      parts.push(`<label>Promień zaokrąglenia <input type="number" step="10" min="0" data-pe-field="radius" value="${Math.round(cp.radiusMm)}" placeholder="auto"> mm</label>`);
      parts.push(`<span class="pe-point-actions"><button type="button" data-pe-action="reset-point">${cp.kind === 'inserted' ? 'Usuń punkt' : 'Resetuj punkt'}</button></span></div>`);
    } else {
      parts.push('<div class="pe-point muted">Zaznacz punkt (kółko na konturze), żeby ustawić dokładne wartości.</div>');
    }
    const findings = state.views.flatMap((v) => v.diagnostics.filter((d) => /^STRINGER-/.test(d.ruleId) && d.ruleId !== 'STRINGER-MIN-SECTION').map((d) => ({ d, seg: v.segmentId })));
    for (const { d, seg } of findings) parts.push(`<div class="pe-diag ${d.severity.toLowerCase()}"><b>${escapeHtml(d.ruleId)}</b> <small>${escapeHtml(seg)}</small> ${escapeHtml(d.message)}</div>`);
    info.innerHTML = parts.join('');
  }

  function refresh() {
    const got = currentViews();
    if (!got) return;
    state.views = got.views;
    sideSelect.value = state.side;
    syncSegmentSelect();
    const key = `${state.side}:${state.views.map((v) => v.segmentId).join(',')}`;
    if (!state.viewport || key !== state.lastFitKey) {
      state.lastFitKey = key;
      fit();
    }
    const size = panelSize();
    const nominalViews = state.layers.nominal ? nominalViewsFor(got.ctx) : null;
    const { svg, layout } = renderProfileEditorSVG(state.views, {
      viewport: state.viewport,
      pxToMm: state.viewport.width / size.w,
      selected: state.selected,
      layers: state.layers,
      nominalViews,
    });
    state.layout = layout;
    canvas.innerHTML = svg;
    ribbon.innerHTML = renderPositionRibbonSVG(state.views, state.focus, Math.max(1, ribbon.getBoundingClientRect().width || size.w));
    // Nie przepisujemy formularza w trakcie przeciągania (zgubiłby fokus/wartości pól).
    if (!state.drag) renderInfo(got.ctx);
  }

  // --- pozycja wskaźnika -> współrzędne profilu ------------------------------------------------
  function pointerToSvg(e) {
    const s = panelSize();
    return screenToViewportPoint(state.viewport, e.clientX - s.left, e.clientY - s.top, s.w, s.h);
  }

  function dragTargetFor(seg, e) {
    const p = pointerToSvg(e);
    return { u: p.x - seg.offsetX, v: -p.y };
  }

  // Przechwycenie wskaźnika utrzymuje przeciąganie poza obszarem SVG; przy niepełnym zdarzeniu (np. z testu)
  // przeglądarka rzuca wyjątek — przeciąganie i tak działa, tylko bez przechwycenia.
  function capture(e) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* brak aktywnego wskaźnika */
    }
  }
  function release(e) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* jw. */
    }
  }

  // --- zdarzenia ------------------------------------------------------------------------------
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const cpEl = e.target.closest?.('.pe-cp');
    if (cpEl && e.button === 0) {
      const id = cpEl.dataset.cpId;
      const contour = cpEl.dataset.contour;
      state.selected = { id, contour };
      state.drag = { id, contour, segIndex: Number(cpEl.dataset.segIndex), moved: false };
      capture(e);
      canvas.focus();
      refresh();
      e.preventDefault();
      return;
    }
    // Nie przechwytujemy wskaźnika tutaj: setPointerCapture natychmiast po pointerdown przenosi CEL
    // późniejszych zdarzeń 'click'/'dblclick' na element canvas (a nie na kontur pod kursorem), więc
    // dwuklik na wandze przestawał trafiać w `.pe-hit` i wstawianie punktu milczkiem nic nie robiło —
    // kursor 'copy' i tak się pokazywał, bo to sama stylistyka CSS, niezależna od przechwycenia.
    // Przesuwanie startuje dopiero po realnym ruchu (patrz pointermove), więc zwykły klik/dwuklik na
    // miejscu nadal trafia we właściwy element.
    state.panStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  });

  function showDragTooltip(e, cp, ds, dn, snap) {
    const label = cp.kind === 'inserted' ? `głębokość ${Math.round(dn)} mm` : `wzdłuż ${Math.round(ds)} mm · głębokość ${Math.round(dn)} mm`;
    dragTooltip.textContent = snap ? `${label} — przyciągnięto: ${snap.label}` : label;
    dragTooltip.classList.toggle('snap', !!snap);
    dragTooltip.style.left = `${e.clientX}px`;
    dragTooltip.style.top = `${e.clientY}px`;
    dragTooltip.hidden = false;
  }
  function hideDragTooltip() {
    dragTooltip.hidden = true;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (state.drag) {
      const seg = state.layout[state.drag.segIndex];
      const view = state.views[state.drag.segIndex];
      const found = findControlPoint(state.drag.id, state.drag.contour);
      if (!seg || !view || !found || !found.cp.tangent) return;
      const rawTarget = dragTargetFor(seg, e);
      const envelope = state.drag.contour === 'lower' ? view.minimumDepthEnvelope : null;
      const snapped = snapDragTarget(rawTarget, { id: state.drag.id, contour: state.drag.contour }, view.controlPoints, envelope);
      const { ds: rawDs, dn: rawDn } = offsetFromDrag(found.cp, snapped);
      // Punkt trafiony dokładnie (przyciągnięty) zostaje jak jest — zaokrąglanie do siatki dotyczy tylko
      // swobodnego przeciągania, żeby nie zepsuć celowo trafionej wartości ułamkiem milimetra.
      const ds = snapped.snap ? Math.round(rawDs) : roundToGrid(rawDs);
      const dn = snapped.snap ? Math.round(rawDn) : roundToGrid(rawDn);
      const edit = { type: PROFILE_EDITS.MOVE_VERTEX, side: state.side, contour: state.drag.contour, anchorId: state.drag.id, ds, dn };
      if (found.cp.kind === 'inserted') edit.t = Math.min(1 - MIN_INSERTED_T, Math.max(MIN_INSERTED_T, found.cp.t + ds / found.cp.edgeLength));
      state.drag.moved = true;
      showDragTooltip(e, found.cp, ds, dn, snapped.snap);
      handlers.applyEdit(edit);
      return;
    }
    if (state.panStart && !state.pan && e.pointerId === state.panStart.pointerId) {
      const dx = e.clientX - state.panStart.x;
      const dy = e.clientY - state.panStart.y;
      if (Math.hypot(dx, dy) < PAN_START_THRESHOLD_PX) return;
      state.pan = { x: e.clientX, y: e.clientY };
      canvas.classList.add('panning');
      capture(e);
    }
    if (state.pan) {
      const s = panelSize();
      state.viewport = panBy(state.viewport, e.clientX - state.pan.x, e.clientY - state.pan.y, s.w, s.h);
      state.pan = { x: e.clientX, y: e.clientY };
      refresh();
    }
  });

  function endPointer(e) {
    if (state.drag) {
      const moved = state.drag.moved;
      state.drag = null;
      hideDragTooltip();
      release(e);
      if (moved) handlers.commit();
      refresh();
    }
    if (state.pan) {
      state.pan = null;
      canvas.classList.remove('panning');
      release(e);
    }
    state.panStart = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!state.viewport) return;
      e.preventDefault();
      const s = panelSize();
      state.viewport = zoomAt(state.viewport, e.clientX - s.left, e.clientY - s.top, s.w, s.h, e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
      refresh();
    },
    { passive: false }
  );

  // Wstawia nowy punkt kontrolny na odcinku [segIndex, contour] w pozycji wskazanej przez event —
  // wywoływane zarówno z dwukliku, jak i z opcji "Wstaw punkt tutaj" w menu kontekstowym.
  function insertPointAt(segIndex, contour, e) {
    const seg = state.layout[segIndex];
    const view = state.views[segIndex];
    if (!seg || !view) return false;
    const target = dragTargetFor(seg, e);
    const anchors = view.controlPoints.filter((c) => c.contour === contour && c.kind !== 'inserted' && c.nominal).sort((a, b) => a.nominal.u - b.nominal.u);
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (target.u < a.nominal.u || target.u > b.nominal.u || b.nominal.u - a.nominal.u < MIN_INSERT_DISTANCE_MM) continue;
      const t = Math.min(1 - MIN_INSERTED_T, Math.max(MIN_INSERTED_T, (target.u - a.nominal.u) / (b.nominal.u - a.nominal.u)));
      const base = { u: a.nominal.u + (b.nominal.u - a.nominal.u) * t, v: a.nominal.v + (b.nominal.v - a.nominal.v) * t };
      const len = Math.hypot(b.nominal.u - a.nominal.u, b.nominal.v - a.nominal.v) || 1;
      const tu = (b.nominal.u - a.nominal.u) / len;
      const tv = (b.nominal.v - a.nominal.v) / len;
      const normal = contour === 'lower' ? { u: tv, v: -tu } : { u: -tv, v: tu };
      const dn = Math.round((target.u - base.u) * normal.u + (target.v - base.v) * normal.v);
      const ctx = handlers.getContext();
      const taken = new Set((overridesFor(ctx)?.inserted || []).map((x) => x.id));
      let n = 1;
      while (taken.has(`manual-${n}`)) n++;
      const id = `manual-${n}`;
      handlers.applyEdit({ type: PROFILE_EDITS.INSERT_VERTEX, side: state.side, contour, id, after: a.id, t, dn });
      handlers.commit();
      state.selected = { id, contour };
      refresh();
      return true;
    }
    return false;
  }

  // dwuklik na konturze -> nowy punkt kontrolny na tym odcinku
  canvas.addEventListener('dblclick', (e) => {
    const hit = e.target.closest?.('.pe-hit');
    if (!hit) return;
    insertPointAt(Number(hit.dataset.segIndex), hit.dataset.contour, e);
  });

  function resetSelectedPoint() {
    if (!state.selected) return;
    handlers.applyEdit({ type: PROFILE_EDITS.RESET_VERTEX, side: state.side, contour: state.selected.contour, anchorId: state.selected.id });
    handlers.commit();
    state.selected = null;
    refresh();
  }

  function nudgeSelectedPoint(dds, ddn) {
    if (!state.selected) return;
    const found = findControlPoint(state.selected.id, state.selected.contour);
    if (!found || !found.cp.tangent) return;
    const cur = offsetFromDrag(found.cp, { u: found.cp.u, v: found.cp.v });
    const edit = { type: PROFILE_EDITS.MOVE_VERTEX, side: state.side, contour: state.selected.contour, anchorId: state.selected.id, ds: cur.ds + dds, dn: cur.dn + ddn };
    if (found.cp.kind === 'inserted' && dds !== 0) edit.t = Math.min(1 - MIN_INSERTED_T, Math.max(MIN_INSERTED_T, found.cp.t + dds / found.cp.edgeLength));
    handlers.applyEdit(edit);
    handlers.commit();
    refresh();
  }

  // --- menu kontekstowe: prawy klik daje różne opcje zależnie od tego, co jest pod kursorem -------------
  function hideCtxMenu() {
    ctxMenu.hidden = true;
    ctxMenu.innerHTML = '';
    ctxMenu._items = null;
  }
  function showCtxMenu(x, y, items) {
    ctxMenu.innerHTML = items.map((it, i) => `<button type="button" data-ctx-index="${i}">${escapeHtml(it.label)}</button>`).join('');
    ctxMenu._items = items;
    ctxMenu.hidden = false;
    // Trzymamy menu w widocznym obszarze panelu, żeby nie wyjechało poza jego prawą/dolną krawędź.
    const bounds = container.getBoundingClientRect();
    ctxMenu.style.left = `${Math.min(x, bounds.right - 200)}px`;
    ctxMenu.style.top = `${Math.min(y, bounds.bottom - items.length * 30 - 10)}px`;
  }
  ctxMenu.addEventListener('click', (e) => {
    const idx = e.target?.dataset?.ctxIndex;
    const item = idx !== undefined ? ctxMenu._items?.[Number(idx)] : null;
    hideCtxMenu();
    item?.action();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) hideCtxMenu();
  });

  function focusRadiusField() {
    info.querySelector('[data-pe-field="radius"]')?.focus();
    info.querySelector('[data-pe-field="radius"]')?.select();
  }

  canvas.addEventListener('contextmenu', (e) => {
    const cpEl = e.target.closest?.('.pe-cp');
    if (cpEl) {
      e.preventDefault();
      const id = cpEl.dataset.cpId;
      const contour = cpEl.dataset.contour;
      state.selected = { id, contour };
      refresh();
      const found = findControlPoint(id, contour);
      const items = [{ label: found?.cp.kind === 'inserted' ? 'Usuń punkt' : 'Resetuj punkt do AUTO', action: resetSelectedPoint }];
      items.push({ label: 'Ustaw promień zaokrąglenia…', action: focusRadiusField });
      showCtxMenu(e.clientX, e.clientY, items);
      return;
    }
    const hit = e.target.closest?.('.pe-hit');
    if (hit) {
      e.preventDefault();
      const segIndex = Number(hit.dataset.segIndex);
      const contour = hit.dataset.contour;
      showCtxMenu(e.clientX, e.clientY, [{ label: 'Wstaw punkt tutaj', action: () => insertPointAt(segIndex, contour, e) }]);
    }
  });

  canvas.addEventListener('keydown', (e) => {
    if (!state.selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      resetSelectedPoint();
      return;
    }
    const step = e.shiftKey ? NUDGE_STEP_FAST_MM : NUDGE_STEP_MM;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      nudgeSelectedPoint(0, step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nudgeSelectedPoint(0, -step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nudgeSelectedPoint(step, 0);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeSelectedPoint(-step, 0);
    }
  });

  // --- pasek narzędzi i formularz -----------------------------------------------------------------
  sideSelect.addEventListener('change', () => {
    state.side = sideSelect.value;
    state.selected = null;
    state.viewport = null;
    refresh();
  });
  segmentSelect.addEventListener('change', () => {
    state.focus = segmentSelect.value;
    fit();
    refresh();
  });
  modeButton.addEventListener('click', () => {
    const ctx = handlers.getContext();
    const entry = overridesFor(ctx);
    if (!entry) return;
    handlers.applyEdit({ type: PROFILE_EDITS.SET_MODE, side: state.side, mode: entry.mode === PROFILE_MODES.MANUAL ? PROFILE_MODES.AUTO : PROFILE_MODES.MANUAL });
    handlers.commit();
    refresh();
  });
  $('[data-pe="reset"]').addEventListener('click', () => {
    handlers.applyEdit({ type: PROFILE_EDITS.RESET_SIDE, side: state.side });
    handlers.commit();
    state.selected = null;
    refresh();
  });
  $('[data-pe="fit"]').addEventListener('click', () => {
    fit();
    refresh();
  });
  // Kopiuje CAŁĄ warstwę nadpisań tej wangi na drugą, dopasowując wpisy po tym samym anchorId
  // (te same nazwy stopni po obu stronach) — a nie geometrycznym lustrem: druga wanga ma zwykle inną
  // długość desek/rozstaw stopni w zabiegu, więc dosłowne odbicie współrzędnych nie miałoby sensu; te
  // same (ds, dn, promień) przy tym samym stopniu za to tak, i to właśnie robi ta funkcja.
  $('[data-pe="mirror"]').addEventListener('click', () => {
    const ctx = handlers.getContext();
    const entry = overridesFor(ctx);
    if (!entry) return;
    const otherSide = OTHER_SIDE[state.side];
    handlers.applyEdit({ type: PROFILE_EDITS.SET_MODE, side: otherSide, mode: PROFILE_MODES.MANUAL });
    for (const contour of ['lower', 'upper']) {
      for (const [anchorId, o] of Object.entries(entry[contour] || {})) {
        handlers.applyEdit({ type: PROFILE_EDITS.MOVE_VERTEX, side: otherSide, contour, anchorId, ds: o.ds || 0, dn: o.dn || 0 });
        if (o.radiusMm !== undefined) handlers.applyEdit({ type: PROFILE_EDITS.SET_RADIUS, side: otherSide, contour, anchorId, radiusMm: o.radiusMm });
      }
      for (const ins of entry.inserted.filter((i) => i.contour === contour)) {
        handlers.applyEdit({ type: PROFILE_EDITS.INSERT_VERTEX, side: otherSide, contour, id: ins.id, after: ins.after, t: ins.t, dn: ins.dn, radiusMm: ins.radiusMm });
      }
    }
    handlers.commit();
    refresh();
    // Ta sama wartość (ds, dn) bywa geometrycznie bez sensu na innej desce (inny rozstaw/kąt w tym
    // miejscu) — solver taki punkt bezpiecznie pomija (ORPHANED/REJECTED), ale w ciszy wyglądałoby to
    // jak "nic się nie stało", więc sprawdzamy to po fakcie i mówimy wprost, ile punktów nie przeszło.
    const after = handlers.getContext();
    if (after) {
      const otherGeo = buildStringerConstructionGeometry(after.models.stringerModels[otherSide], after.models.fullConfig || after.config);
      const skipped = otherGeo.flatMap((g) => g.diagnostics.filter((d) => d.ruleId === 'STRINGER-OVERRIDE-REJECTED' || d.ruleId === 'STRINGER-OVERRIDE-ORPHANED')).length;
      showToast(
        skipped > 0
          ? `Skopiowano profil na ${SIDE_LABELS[otherSide].toLowerCase()}. ${skipped} ${skipped === 1 ? 'punkt nie pasował' : 'punkty(-ów) nie pasowało'} do jej geometrii w tym miejscu i został(y) pominięte — sprawdź walidację po przełączeniu na tę wangę.`
          : `Skopiowano profil na ${SIDE_LABELS[otherSide].toLowerCase()}.`
      );
    }
  });
  // Rzeczywiste (1:1) DXF-y do warsztatu — czysta serializacja tego, co solver już policzył
  // (export/dxfExport.js), nigdy nie liczy geometrii samo; patrz jego nagłówek, dlaczego to inny
  // (bogatszy — wręgi, pozycje stopni) konsument niż view model tego edytora.
  $('[data-pe="export-board"]').addEventListener('click', () => {
    const ctx = handlers.getContext();
    if (!ctx) return;
    const geo = ctx.models.stringerConstruction[state.side];
    const model = ctx.models.stringerModels[state.side];
    const config = ctx.models.fullConfig || ctx.config;
    const segmentId = state.focus !== 'all' ? state.focus : state.views[0]?.segmentId;
    const geometry = geo?.find((g) => g.segmentId === segmentId);
    if (!geometry) {
      showToast('Brak wybranej deski do wyeksportowania — wybierz konkretną deskę.');
      return;
    }
    const segment = model?.segments.find((s) => s.id === segmentId);
    const dxf = buildStringerBoardDXF(geometry, { segment, config });
    if (!dxf) {
      showToast('Tej deski nie da się wyeksportować — brak policzonej geometrii (sprawdź Walidację).');
      return;
    }
    downloadTextFile(dxf, `wanga-${state.side}-${segmentId}.dxf`, 'application/dxf');
  });
  $('[data-pe="export-all"]').addEventListener('click', () => {
    const ctx = handlers.getContext();
    if (!ctx) return;
    const geo = ctx.models.stringerConstruction[state.side];
    const model = ctx.models.stringerModels[state.side];
    const config = ctx.models.fullConfig || ctx.config;
    const dxf = geo ? buildStringerAllBoardsDXF(geo, { model, config }) : null;
    if (!dxf) {
      showToast('Brak policzonej geometrii tej wangi do wyeksportowania (sprawdź Walidację).');
      return;
    }
    downloadTextFile(dxf, `wanga-${state.side}-wszystkie-deski.dxf`, 'application/dxf');
  });
  ribbon.addEventListener('click', (e) => {
    const id = e.target?.closest?.('[data-seg-id]')?.dataset.segId;
    if (!id) return;
    state.focus = id;
    fit();
    refresh();
  });
  for (const cb of container.querySelectorAll('[data-pe-layer]')) {
    cb.addEventListener('change', () => {
      state.layers[cb.dataset.peLayer] = cb.checked;
      refresh();
    });
  }

  info.addEventListener('change', (e) => {
    const field = e.target?.dataset?.peField;
    if (!field || !state.selected) return;
    const found = findControlPoint(state.selected.id, state.selected.contour);
    if (!found) return;
    const { cp } = found;
    const cur = offsetFromDrag(cp, { u: cp.u, v: cp.v });
    const value = e.target.value === '' ? null : Number(e.target.value);
    const base = { side: state.side, contour: cp.contour, anchorId: cp.id };
    if (field === 'radius') handlers.applyEdit({ type: PROFILE_EDITS.SET_RADIUS, ...base, radiusMm: value });
    else if (field === 'dn') handlers.applyEdit({ type: PROFILE_EDITS.MOVE_VERTEX, ...base, ds: cp.kind === 'inserted' ? 0 : cur.ds, dn: value ?? 0 });
    else if (field === 'ds') handlers.applyEdit({ type: PROFILE_EDITS.MOVE_VERTEX, ...base, ds: value ?? 0, dn: cur.dn });
    else if (field === 't') handlers.applyEdit({ type: PROFILE_EDITS.MOVE_VERTEX, ...base, dn: cur.dn, t: value ?? cp.t });
    handlers.commit();
    refresh();
  });
  info.addEventListener('click', (e) => {
    if (e.target?.dataset?.peAction === 'reset-point') resetSelectedPoint();
  });

  window.addEventListener('resize', () => {
    if (container.classList.contains('visible')) refresh();
  });

  return { refresh, fit: () => { fit(); refresh(); }, setSide(side) { state.side = side; state.selected = null; state.viewport = null; refresh(); } };
}
