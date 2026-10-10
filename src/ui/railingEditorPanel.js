// "Profil poręczy" — the side-view editor of a handrail run (DOM + interactions only). It computes no geometry: it
// shows the view model of the solved run (geometry/railingProfileView.js) and turns gestures into edits
// (geometry/railingProfileModel.js RAILING_PROFILE_EDITS) that the host applies to the config, followed by the normal
// rebuild(); undo/redo and the project file cover them like any other config field.
//
// Gestures: drag a handle up/down (5 mm steps, 1 mm with Shift) — a square is the end of the handrail on a post's
// face, a circle a point of the line; double-click the handrail adds a point; right-click / Delete removes a point
// (an end goes back to 0); arrow keys nudge the selected handle (1 mm, 10 mm with Shift). Exact numbers are in the form
// under the drawing.

import { buildRailingProfileView, listRailingRuns, valueAt } from '../geometry/railingProfileView.js';
import { renderRailingProfileSVG, railingViewBox } from '../railingEditor/railingEditorRenderer.js';
import { RAILING_PROFILE_EDITS, MAX_RAILING_POINT_OFFSET_MM, MIN_POINT_FROM_END_MM } from '../geometry/railingProfileModel.js';
import { escapeHtml } from '../util/format.js';

const DRAG_STEP_MM = 5;
const FINE_STEP_MM = 1;
const NUDGE_MM = 1;
const NUDGE_BIG_MM = 10;

/**
 * @param {HTMLElement} container
 * @param {Object} host
 * @param {() => {models: Object}|null} host.getContext
 * @param {(edit: Object) => void} host.applyEdit  applies a RAILING_PROFILE_EDITS edit to the config and rebuilds
 * @param {() => void} host.commit                 one undo entry (called when a gesture ends)
 */
export function createRailingEditor(container, host) {
  container.innerHTML = `
    <div class="re-toolbar">
      <label>Bieg poręczy <select data-re="run"></select></label>
      <button type="button" data-re="reset" title="Ten bieg poręczy z powrotem jak wyliczony: bez ręcznych punktów i bez korekty końców przy słupach">Resetuj bieg</button>
      <span class="re-status" data-re="status"></span>
    </div>
    <div class="re-canvas" tabindex="0" data-re="canvas"></div>
    <div class="re-info" data-re="info"></div>
    <div class="re-hint">Przeciągnij uchwyt w górę/w dół (co 5 mm, z Shift co 1 mm): kwadrat = koniec poręczy na licu słupa, kółko = punkt linii. Dwuklik na poręczy dodaje punkt, prawy klik lub Delete usuwa. Strzałki ↑↓ przesuwają zaznaczony uchwyt o 1 mm (z Shift o 10 mm). Niebieska przerywana linia = poręcz wyliczona (AUTO).</div>`;
  const $ = (name) => container.querySelector(`[data-re="${name}"]`);
  const runSelect = $('run');
  const canvas = $('canvas');
  const info = $('info');
  const status = $('status');

  let selectedRun = null; // "sectionId|runKey"
  let selectedPointId = null;
  let view = null;
  let drag = null;
  let runListKey = '';

  const runId = (r) => `${r.sectionId}|${r.runKey}`;
  const liveSvg = () => canvas.querySelector('svg');

  function pointerV(e) {
    const svg = liveSvg();
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { u: p.x, v: -p.y };
  }

  function editFor(control, dz) {
    const clamped = Math.max(-MAX_RAILING_POINT_OFFSET_MM, Math.min(MAX_RAILING_POINT_OFFSET_MM, dz));
    if (control.kind === 'end') {
      const atStart = control.id === 'end:start';
      return { type: RAILING_PROFILE_EDITS.SET_END, sectionId: view.sectionId, postId: atStart ? view.startPostId : view.endPostId, end: atStart ? 'start' : 'end', dz: clamped };
    }
    return { type: RAILING_PROFILE_EDITS.SET_POINT, sectionId: view.sectionId, runKey: view.runKey, s: control.s, dz: clamped };
  }

  function removeEdit(control) {
    if (control.kind === 'end') return editFor(control, 0);
    // a vertex of the line itself cannot be removed — it goes back onto the line; an added point disappears
    return { type: RAILING_PROFILE_EDITS.REMOVE_POINT, sectionId: view.sectionId, runKey: view.runKey, s: control.s };
  }

  const selectedControl = () => view?.controls.find((c) => c.id === selectedPointId) ?? null;

  function renderInfo() {
    if (!view) {
      info.innerHTML = '';
      return;
    }
    const c = selectedControl();
    const length = `Długość biegu w rzucie: <b>${Math.round(view.lengthMm)} mm</b>${view.bent ? ' · poręcz gięta (łuki liczone przez punkty)' : ''}`;
    if (!c) {
      info.innerHTML = `<div class="re-point muted">${length}. Kliknij uchwyt, żeby wpisać wartość liczbowo.</div>`;
      return;
    }
    const what = c.kind === 'end' ? (c.id === 'end:start' ? `Początek poręczy na licu słupa ${escapeHtml(view.startPostId)}` : `Koniec poręczy na licu słupa ${escapeHtml(view.endPostId)}`) : c.kind === 'added' ? 'Punkt dodany ręcznie' : 'Załamanie linii poręczy';
    const removeLabel = c.kind === 'added' ? 'Usuń punkt' : 'Zeruj';
    info.innerHTML = `
      <div class="re-point">
        <b>${what}</b>
        <span>położenie wzdłuż biegu: ${Math.round(c.s)} mm</span>
        <label>wyżej (+) / niżej (−) <input type="number" step="5" min="${-MAX_RAILING_POINT_OFFSET_MM}" max="${MAX_RAILING_POINT_OFFSET_MM}" value="${Math.round(c.dz * 10) / 10}" data-re-field="dz"> mm</label>
        <button type="button" data-re-action="remove">${removeLabel}</button>
      </div>
      <div class="re-point muted">${length}</div>`;
  }

  function draw() {
    if (!view) return;
    // while a handle is dragged the frame stays as it was at the press: the drawing's extent changes with the handrail,
    // and a moving frame would change what one pixel of mouse travel means
    const vb = drag?.viewBox ?? railingViewBox(view);
    const rect = canvas.getBoundingClientRect();
    const mmPerPx = Math.max(vb.width / (rect.width || 900), vb.height / (rect.height || 500));
    canvas.innerHTML = renderRailingProfileSVG(view, { selectedId: selectedPointId, mmPerPx, viewBox: vb });
  }

  function refresh() {
    const ctx = host.getContext();
    const runs = listRailingRuns(ctx?.models?.railingModel);
    const key = runs.map(runId).join(';');
    if (key !== runListKey) {
      runListKey = key;
      runSelect.innerHTML = runs.map((r) => `<option value="${escapeHtml(runId(r))}">${escapeHtml(r.label)}</option>`).join('');
    }
    if (runs.length === 0) {
      view = null;
      selectedRun = null;
      canvas.innerHTML = '<div class="re-empty">Brak poręczy do edycji — włącz balustradę (panel parametrów → Balustrada) i dodaj odcinek.</div>';
      status.textContent = '';
      renderInfo();
      return;
    }
    if (!runs.some((r) => runId(r) === selectedRun)) {
      selectedRun = runId(runs[0]);
      selectedPointId = null;
    }
    runSelect.value = selectedRun;
    const which = runs.find((r) => runId(r) === selectedRun);
    view = buildRailingProfileView(ctx.models, which);
    if (!view) {
      canvas.innerHTML = '';
      return;
    }
    if (!view.controls.some((c) => c.id === selectedPointId)) selectedPointId = null;
    status.textContent = view.edited ? 'RĘCZNIE zmieniony' : 'AUTO';
    status.className = `re-status${view.edited ? ' manual' : ''}`;
    draw();
    if (!info.contains(document.activeElement)) renderInfo();
  }

  runSelect.addEventListener('change', () => {
    selectedRun = runSelect.value;
    selectedPointId = null;
    refresh();
  });

  $('reset').addEventListener('click', () => {
    if (!view) return;
    host.applyEdit({ type: RAILING_PROFILE_EDITS.RESET_RUN, sectionId: view.sectionId, runKey: view.runKey, startPostId: view.startPostId, endPostId: view.endPostId });
    host.commit();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !view) return;
    const id = e.target.closest?.('[data-point-id]')?.dataset.pointId;
    canvas.focus();
    if (!id) {
      if (selectedPointId !== null) {
        selectedPointId = null;
        draw();
        renderInfo();
      }
      return;
    }
    selectedPointId = id;
    const control = selectedControl();
    if (!control) return;
    // the drag is measured as SCREEN travel of the pointer at the drawing's current scale — the layout around the
    // drawing changes at the press (the point's form appears under it), so a position remembered in drawing
    // coordinates would be off
    drag = { control, startDz: control.dz, startY: e.clientY, moved: false, viewBox: railingViewBox(view) };
    canvas.setPointerCapture(e.pointerId);
    draw();
    renderInfo();
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pxPerMm = liveSvg()?.getScreenCTM()?.d;
    if (!(pxPerMm > 0)) return;
    const step = e.shiftKey ? FINE_STEP_MM : DRAG_STEP_MM;
    const dz = Math.round((drag.startDz - (e.clientY - drag.startY) / pxPerMm) / step) * step;
    if (dz === drag.lastDz) return;
    drag.lastDz = dz;
    drag.moved = true;
    host.applyEdit(editFor(drag.control, dz)); // live preview: the host rebuilds and calls refresh()
  });

  function endDrag() {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) host.commit();
    draw(); // back to the run's own frame
    renderInfo();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('dblclick', (e) => {
    if (!view || e.target.closest?.('[data-point-id]')) return;
    const at = pointerV(e);
    if (!at || !(at.u > MIN_POINT_FROM_END_MM && at.u < view.lengthMm - MIN_POINT_FROM_END_MM)) return;
    // the new point lies ON the handrail as it is now: its dz is the current line's distance from the run's base line
    const s = Math.round(at.u);
    const dz = Math.round(valueAt(view.railTop, s) - valueAt(view.baseTop, s));
    host.applyEdit({ type: RAILING_PROFILE_EDITS.SET_POINT, sectionId: view.sectionId, runKey: view.runKey, s, dz });
    host.commit();
    selectedPointId = `pt:${s.toFixed(3)}`;
    refresh();
    renderInfo();
  });

  function removeSelected(control) {
    if (!control) return;
    host.applyEdit(removeEdit(control));
    host.commit();
    renderInfo();
  }

  canvas.addEventListener('contextmenu', (e) => {
    const id = e.target.closest?.('[data-point-id]')?.dataset.pointId;
    if (!id || !view) return;
    e.preventDefault();
    selectedPointId = id;
    removeSelected(selectedControl());
  });

  canvas.addEventListener('keydown', (e) => {
    const control = selectedControl();
    if (!control) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected(control);
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const by = (e.shiftKey ? NUDGE_BIG_MM : NUDGE_MM) * (e.key === 'ArrowUp' ? 1 : -1);
    host.applyEdit(editFor(control, control.dz + by));
    host.commit();
    renderInfo();
  });

  info.addEventListener('change', (e) => {
    const control = selectedControl();
    if (!control || e.target?.dataset?.reField !== 'dz') return;
    host.applyEdit(editFor(control, Number(e.target.value) || 0));
    host.commit();
    renderInfo();
  });
  info.addEventListener('click', (e) => {
    if (e.target?.dataset?.reAction === 'remove') removeSelected(selectedControl());
  });

  new ResizeObserver(() => draw()).observe(canvas);

  return { refresh };
}
