// PANEL EDYTORA PROFILU WANGI (widok boczny). Rysuje bok wangi (renderer: profileEditor/
// profileEditorRenderer.js) i zamienia gesty użytkownika na ZDARZENIA EDYCJI (PROFILE_EDITS z
// geometry/stringerProfileModel.js) — nigdy nie zmienia siatki ani geometrii. Zdarzenie trafia do main.js
// (handlers.applyEdit), który zmienia wyłącznie config.manualStringerProfileOverrides i woła zwykłe
// rebuild(): solver -> 3D/plan/walidacja/kosztorys. Panel niczego nie liczy poza przeliczeniem pozycji
// wskaźnika na współrzędne profilu (offsetFromDrag) — decyzje geometryczne zostają w solverze.
//
// Obsługa:
//   przeciągnięcie punktu        — przesuwa punkt kontrolny (ds/dn względem pozycji nominalnej)
//   dwuklik na konturze          — wstawia nowy punkt kontrolny
//   prawy klik / Delete          — usuwa wstawiony punkt (albo cofa edycję punktu kotwiczonego)
//   kółko / przeciągnięcie tła   — powiększenie / przesunięcie widoku
//   formularz pod widokiem       — dokładne wartości (przesunięcie, promień zaokrąglenia)

import { buildProfileViewModel, offsetFromDrag } from '../geometry/stringerProfileView.js';
import { PROFILE_EDITS, PROFILE_MODES, sanitizeStringerProfileOverrides } from '../geometry/stringerProfileModel.js';
import { renderProfileEditorSVG, layoutSegments, contentBounds, fromSvg, EDITOR_FIT_MARGIN_MM } from '../profileEditor/profileEditorRenderer.js';
import { fitToBounds, zoomAt, panBy, screenToViewportPoint } from '../plan2d/viewport.js';

const SIDE_LABELS = { outer: 'Wanga zewnętrzna', inner: 'Wanga wewnętrzna (dusza)' };
const WHEEL_ZOOM_STEP = 1.15;
// A point closer than this (in u, mm) to the end of an edge is not a place to insert a new control point.
const MIN_INSERT_DISTANCE_MM = 5;
const MIN_INSERTED_T = 0.02;

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
      <button type="button" data-pe="fit">⤢ Dopasuj</button>
      <span class="pe-layers">
        <label><input type="checkbox" data-pe-layer="reference" checked> oś odniesienia</label>
        <label><input type="checkbox" data-pe-layer="envelope" checked> min. głębokość</label>
        <label><input type="checkbox" data-pe-layer="treads" checked> stopnie</label>
      </span>
    </div>
    <div class="pe-canvas" tabindex="0"></div>
    <div class="pe-info"></div>
    <div class="pe-hint">Przeciągnij punkt, żeby zmienić kształt · dwuklik na konturze dodaje punkt · prawy klik usuwa dodany punkt · kółko: powiększenie · przeciągnięcie tła: przesunięcie</div>
  `;
  const $ = (sel) => container.querySelector(sel);
  const canvas = $('.pe-canvas');
  const info = $('.pe-info');
  const sideSelect = $('[data-pe="side"]');
  const modeButton = $('[data-pe="mode"]');
  const segmentSelect = $('[data-pe="segment"]');

  const state = {
    side: 'outer',
    selected: null, // { id, contour }
    viewport: null,
    layers: { reference: true, envelope: true, treads: true },
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

  function overridesFor(ctx) {
    return sanitizeStringerProfileOverrides(ctx.config.manualStringerProfileOverrides)[state.side] || null;
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
    const { svg, layout } = renderProfileEditorSVG(state.views, { viewport: state.viewport, pxToMm: state.viewport.width / size.w, selected: state.selected, layers: state.layers });
    state.layout = layout;
    canvas.innerHTML = svg;
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
    state.pan = { x: e.clientX, y: e.clientY };
    canvas.classList.add('panning');
    capture(e);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (state.drag) {
      const seg = state.layout[state.drag.segIndex];
      const found = findControlPoint(state.drag.id, state.drag.contour);
      if (!seg || !found || !found.cp.tangent) return;
      const target = dragTargetFor(seg, e);
      const { ds, dn } = offsetFromDrag(found.cp, target);
      const edit = { type: PROFILE_EDITS.MOVE_VERTEX, side: state.side, contour: state.drag.contour, anchorId: state.drag.id, ds: Math.round(ds), dn: Math.round(dn) };
      if (found.cp.kind === 'inserted') edit.t = Math.min(1 - MIN_INSERTED_T, Math.max(MIN_INSERTED_T, found.cp.t + ds / found.cp.edgeLength));
      state.drag.moved = true;
      handlers.applyEdit(edit);
      return;
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
      release(e);
      if (moved) handlers.commit();
      refresh();
    }
    if (state.pan) {
      state.pan = null;
      canvas.classList.remove('panning');
      release(e);
    }
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

  // dwuklik na konturze -> nowy punkt kontrolny na tym odcinku
  canvas.addEventListener('dblclick', (e) => {
    const hit = e.target.closest?.('.pe-hit');
    if (!hit) return;
    const segIndex = Number(hit.dataset.segIndex);
    const contour = hit.dataset.contour;
    const seg = state.layout[segIndex];
    const view = state.views[segIndex];
    if (!seg || !view) return;
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
      return;
    }
  });

  function resetSelectedPoint() {
    if (!state.selected) return;
    handlers.applyEdit({ type: PROFILE_EDITS.RESET_VERTEX, side: state.side, contour: state.selected.contour, anchorId: state.selected.id });
    handlers.commit();
    state.selected = null;
    refresh();
  }

  canvas.addEventListener('contextmenu', (e) => {
    const cpEl = e.target.closest?.('.pe-cp');
    if (!cpEl) return;
    e.preventDefault();
    state.selected = { id: cpEl.dataset.cpId, contour: cpEl.dataset.contour };
    resetSelectedPoint();
  });
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
      e.preventDefault();
      resetSelectedPoint();
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
