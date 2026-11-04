// The tab "Schody na beton" (docs/architecture/CONCRETE_CLADDING_MODULE.md): its own toolbar, panel, plan, 3D view,
// finished-heights table and step editor — all on the module's own state (`config` of src/cladding/schema.js). The
// self-supporting app knows nothing of it beyond mounting it (main.js hook).

import * as THREE from 'three';
import GUI from 'lil-gui';
import './cladding.css';
import { createDefaultCladdingConfig, sanitizeCladdingConfig, LANDING_TURNS, LANDING_TURN_LABELS, WINDER_TURN_LABELS } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { expandSequence, signedOnZoneLine } from '../concreteModel.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { renderCladdingPlanSVG, claddingPlanBounds } from '../claddingPlanRenderer.js';
import { claddingProjectToFile, parseCladdingProjectFile } from '../projectFile.js';
import { createScene } from '../../scene/sceneSetup.js';
import { fitToBounds, zoomAt, panBy } from '../../plan2d/viewport.js';
import { createHistory, commit, undo, redo, canUndo, canRedo } from '../../history/modelHistory.js';
import { escapeHtml } from '../../util/format.js';

const r0 = (n) => (Number.isFinite(n) ? Math.round(n) : '');

export function mountCladdingApp(rootEl) {
  const state = { config: createDefaultCladdingConfig(), projectName: '', notes: '', selected: null, view: 'plan', built: null };
  let history = createHistory(state.config);
  let active = false;

  rootEl.innerHTML = `
    <div class="clad-app">
      <div class="clad-bar">
        <strong class="clad-title">Schody na beton</strong>
        <input class="clad-name" type="text" placeholder="Nazwa projektu" maxlength="80" />
        <button type="button" data-act="new">Nowy</button>
        <button type="button" data-act="save">Zapisz</button>
        <button type="button" data-act="load">Wczytaj</button>
        <span class="clad-meta"></span>
        <span class="clad-sep"></span>
        <button type="button" data-act="undo" title="Cofnij (Ctrl+Z)">↶ Cofnij</button>
        <button type="button" data-act="redo" title="Ponów (Ctrl+Y)">↷ Ponów</button>
        <span class="clad-spacer"></span>
        <div class="clad-views">
          <button type="button" data-view="plan" class="active">Plan 2D</button>
          <button type="button" data-view="3d">Widok 3D</button>
        </div>
      </div>
      <aside class="clad-left">
        <section class="clad-box">
          <h3>Stopnie — pomiar betonu</h3>
          <div class="clad-hint">W kolejności wchodzenia. Wymiary surowego betonu: wysokość (od stopnia niżej), głębokość, szerokość [mm].</div>
          <div class="clad-seq"></div>
          <div class="clad-actions">
            <button type="button" data-add="steps">+ Stopnie proste</button>
            <button type="button" data-add="landing">+ Podest</button>
            <button type="button" data-add="winders">+ Zabiegi</button>
          </div>
          <label class="clad-field">Ostatnia wysokość do stropu [mm] <input type="number" class="clad-exit" placeholder="jak ostatni stopień" /></label>
        </section>
        <section class="clad-box"><h3>Ściany przy biegach</h3><div class="clad-walls"></div></section>
        <section class="clad-box clad-gui"><h3>Wykończenie</h3></section>
      </aside>
      <main class="clad-main">
        <div class="clad-plan"></div>
        <div class="clad-3d" hidden></div>
      </main>
      <aside class="clad-right">
        <section class="clad-box clad-step"></section>
        <section class="clad-box"><h3>Wysokości po wykończeniu</h3><div class="clad-heights"></div></section>
        <section class="clad-box"><h3>Uwagi</h3><div class="clad-findings"></div></section>
      </aside>
    </div>
    <input type="file" accept=".json,application/json" class="clad-file" hidden />
  `;
  const $ = (sel) => rootEl.querySelector(sel);
  const seqEl = $('.clad-seq');
  const planEl = $('.clad-plan');
  const view3dEl = $('.clad-3d');
  const fileInput = $('.clad-file');
  const nameInput = $('.clad-name');

  // --- history -------------------------------------------------------------------------------------------------
  function commitHistory() {
    commit(history, state.config);
    syncHistoryButtons();
  }
  function restore(snapshot) {
    if (!snapshot) return;
    state.config = sanitizeCladdingConfig(snapshot);
    refreshAll();
    syncHistoryButtons();
  }
  function syncHistoryButtons() {
    $('[data-act="undo"]').disabled = !canUndo(history);
    $('[data-act="redo"]').disabled = !canRedo(history);
  }

  // --- edits ---------------------------------------------------------------------------------------------------
  function change(mutator, { record = true } = {}) {
    mutator(state.config);
    state.config = sanitizeCladdingConfig(state.config);
    rebuild();
    if (record) commitHistory();
  }

  // --- the sequence editor -------------------------------------------------------------------------------------
  const numIn = (i, field, value, title, placeholder = '') => `<input type="number" data-i="${i}" data-f="${field}" value="${value ?? ''}" title="${title}" placeholder="${placeholder}" />`;
  // a winder zone: its count, rise, turn, the sizes along the walls (A — from the zone start to the wall corner, B — from
  // the wall corner to the zone end; empty = automatic) and, folded, the edges measured from the corners
  const openEdges = new Set();
  function windersRow(g, i, tools) {
    const zone = state.built?.concrete.zones.find((z) => z.groupIndex === i);
    const turn = `<select data-i="${i}" data-f="turn">${Object.entries(WINDER_TURN_LABELS).map(([v, l]) => `<option value="${v}" ${v === g.turn ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const head = `<div class="clad-row clad-winders"><span class="clad-kind">Zabiegi</span>${numIn(i, 'count', g.count, 'Ilość zabiegów')}<span>×</span>${numIn(i, 'riseMm', g.riseMm, 'Wysokość [mm]')}${turn}${tools}</div>`;
    const sizes = `<div class="clad-row clad-winders-sizes"><label title="Od początku zabiegu do narożnika ściany, wzdłuż ściany wejściowej">A ${numIn(i, 'spaceAMm', g.spaceAMm, 'A [mm]', r0(zone?.A))}</label><label title="Od narożnika ściany do końca zabiegu, wzdłuż ściany wyjściowej">B ${numIn(i, 'spaceBMm', g.spaceBMm, 'B [mm]', r0(zone?.B))}</label><label title="Linia biegu — odległość od duszy (równe stopnie na niej przy krawędziach wyliczanych)">linia biegu ${numIn(i, 'walklineOffsetMm', g.walklineOffsetMm, 'od duszy [mm]', r0(zone?.walklineOffsetMm))}</label></div>`;
    const sideSel = (k, end, v) =>
      `<select data-i="${i}" data-edge="${k}" data-end="${end}" data-part="side" title="Po której stronie narożnika"><option value="in" ${v !== undefined && v < 0 ? 'selected' : ''}>przed narożnikiem</option><option value="out" ${v !== undefined && v >= 0 ? 'selected' : ''}>za narożnikiem</option></select>`;
    const rows = Array.from({ length: g.count - 1 }, (_, k) => {
      const own = g.edges?.[k] || {};
      const auto = zone?.edges[k + 1];
      const cell = (end, label) => {
        const v = own[`${end}Mm`];
        const shown = v ?? auto?.[`${end}Mm`];
        return `<span class="clad-edge-cell">${label} ${sideSel(k, end, shown)}<input type="number" data-i="${i}" data-edge="${k}" data-end="${end}" data-part="mm" value="${v === undefined ? '' : r0(Math.abs(v))}" placeholder="${shown === undefined ? '' : r0(Math.abs(shown))}" title="mm od narożnika (puste = wyliczone)" /></span>`;
      };
      return `<div class="clad-edge-row"><b>${k + 1}.</b>${cell('outer', 'ściana')}${cell('inner', 'dusza')}<button type="button" data-clear-edge="${i}:${k}" title="Wyczyść pomiar tej krawędzi">✕</button></div>`;
    }).join('');
    const edges = `<details class="clad-edges" data-group="${i}" ${openEdges.has(i) ? 'open' : ''}><summary>Krawędzie zabiegów z pomiaru (od narożnika ściany / duszy)</summary>${rows}<div class="clad-hint">Puste = wyliczone (równe stopnie na linii biegu, równe odcinki przy duszy). Uchwyty krawędzi można też przeciągać na planie.</div></details>`;
    return `<div class="clad-group-winders">${head}${sizes}${edges}</div>`;
  }
  function renderSequence() {
    seqEl.innerHTML = state.config.sequence
      .map((g, i) => {
        const tools = `<span class="clad-row-tools"><button type="button" data-move="${i}:-1" title="Wyżej">↑</button><button type="button" data-move="${i}:1" title="Niżej">↓</button><button type="button" data-del="${i}" title="Usuń">✕</button></span>`;
        if (g.kind === 'steps') {
          return `<div class="clad-row"><span class="clad-kind">Stopnie</span>${numIn(i, 'count', g.count, 'Ilość')}<span>×</span>${numIn(i, 'riseMm', g.riseMm, 'Wysokość [mm]')}${numIn(i, 'goingMm', g.goingMm, 'Głębokość [mm]')}${numIn(i, 'widthMm', g.widthMm, 'Szerokość [mm]')}${tools}</div>`;
        }
        if (g.kind === 'winders') return windersRow(g, i, tools);
        const turn = `<select data-i="${i}" data-f="turn">${LANDING_TURNS.map((t) => `<option value="${t}" ${t === g.turn ? 'selected' : ''}>${LANDING_TURN_LABELS[t]}</option>`).join('')}</select>`;
        const gap = g.turn === 'u-left' || g.turn === 'u-right' ? `<label>rozsunięcie ${numIn(i, 'gapMm', g.gapMm, 'Odstęp między biegami [mm]')}</label>` : '';
        const finish = `<select data-i="${i}" data-f="finish" title="Wykończenie podestu"><option value="wood" ${g.finish !== 'floorboard' ? 'selected' : ''}>drewno (jak stopnie)</option><option value="floorboard" ${g.finish === 'floorboard' ? 'selected' : ''}>deska podłogowa na OSB + nosek</option></select>`;
        return `<div class="clad-row clad-landing"><span class="clad-kind">Podest</span>${numIn(i, 'riseMm', g.riseMm, 'Wysokość [mm]')}${numIn(i, 'depthMm', g.depthMm, 'Głębokość [mm] (puste = jak szerokość biegu)', 'auto')}${turn}${gap}${finish}${tools}</div>`;
      })
      .join('');
    const head = `<div class="clad-row clad-head"><span class="clad-kind"></span><span>ile</span><span></span><span>wys.</span><span>głęb.</span><span>szer.</span></div>`;
    seqEl.insertAdjacentHTML('afterbegin', head);
    const exit = $('.clad-exit');
    exit.value = state.config.exitRiseMm ?? '';
  }
  seqEl.addEventListener('change', (ev) => {
    const el = ev.target;
    const i = Number(el.dataset.i);
    if (el.dataset.edge !== undefined && Number.isInteger(i)) {
      // an edge measured from its corner: the side (before / past the corner) gives the sign
      const k = Number(el.dataset.edge);
      const end = el.dataset.end;
      const row = el.closest('.clad-edge-row');
      const side = row.querySelector(`select[data-end="${end}"]`).value;
      const input = row.querySelector(`input[data-end="${end}"]`);
      const raw = input.value === '' ? (el.dataset.part === 'side' && input.placeholder !== '' ? input.placeholder : '') : input.value;
      change((c) => {
        const g = c.sequence[i];
        g.edges = Array.from({ length: g.count - 1 }, (_, j) => g.edges?.[j] ?? null);
        const own = { ...(g.edges[k] || {}) };
        if (raw === '') delete own[`${end}Mm`];
        else own[`${end}Mm`] = (side === 'in' ? -1 : 1) * Math.abs(Number(raw));
        g.edges[k] = Object.keys(own).length ? own : null;
      });
      renderSequence();
      return;
    }
    const f = el.dataset.f;
    if (!f || !Number.isInteger(i)) return;
    change((c) => {
      const g = c.sequence[i];
      if (f === 'turn' || f === 'finish') g[f] = el.value;
      else if ((f === 'depthMm' || f === 'spaceAMm' || f === 'spaceBMm' || f === 'walklineOffsetMm') && el.value === '') g[f] = null;
      else g[f] = Number(el.value);
    });
    renderSequence();
  });
  seqEl.addEventListener(
    'toggle',
    (ev) => {
      const d = ev.target.closest?.('details[data-group]');
      if (!d) return;
      const g = Number(d.dataset.group);
      if (d.open) openEdges.add(g);
      else openEdges.delete(g);
    },
    true
  );
  seqEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.clearEdge) {
      const [i, k] = b.dataset.clearEdge.split(':').map(Number);
      change((c) => {
        if (c.sequence[i].edges) c.sequence[i].edges[k] = null;
      });
    } else if (b.dataset.del !== undefined) {
      const i = Number(b.dataset.del);
      if (state.config.sequence.length <= 1) return;
      change((c) => c.sequence.splice(i, 1));
      state.selected = null;
    } else if (b.dataset.move) {
      const [i, d] = b.dataset.move.split(':').map(Number);
      const j = i + d;
      if (j < 0 || j >= state.config.sequence.length) return;
      change((c) => ([c.sequence[i], c.sequence[j]] = [c.sequence[j], c.sequence[i]]));
    }
    renderSequence();
  });
  rootEl.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const last = [...state.config.sequence].reverse().find((g) => g.kind === 'steps');
      const rise = last?.riseMm ?? 180;
      change((c) =>
        c.sequence.push(
          b.dataset.add === 'steps'
            ? { kind: 'steps', count: 3, riseMm: rise, goingMm: last?.goingMm ?? 270, widthMm: last?.widthMm ?? 1000 }
            : b.dataset.add === 'winders'
              ? { kind: 'winders', count: 3, riseMm: rise, turn: 'right', spaceAMm: null, spaceBMm: null, walklineOffsetMm: null, edges: [] }
              : { kind: 'landing', riseMm: rise, depthMm: null, turn: 'right', gapMm: 0 }
        )
      );
      renderSequence();
    })
  );
  $('.clad-exit').addEventListener('change', (ev) => change((c) => (c.exitRiseMm = ev.target.value === '' ? null : Number(ev.target.value))));

  // --- the finish (lil-gui) ------------------------------------------------------------------------------------
  const gui = new GUI({ container: $('.clad-gui'), title: 'Okładzina', autoPlace: false });
  const live = (ctrl) => ctrl.onChange(() => change(() => {}, { record: false })).onFinishChange(() => commitHistory());
  const proxy = new Proxy({}, { get: (_, k) => state.config[k], set: (_, k, v) => ((state.config[k] = v), true) });
  live(gui.add(proxy, 'treadThicknessMm', 10, 100, 1).name('Grubość stopnia [mm]'));
  live(gui.add(proxy, 'nosingFrontMm', 0, 100, 1).name('Nosek z przodu [mm]'));
  live(gui.add(proxy, 'sideNosingMm', 0, 100, 1).name('Nosek boczny poza beton [mm]'));
  live(gui.add(proxy, 'sideNosingLeft').name('Nosek boczny z lewej'));
  live(gui.add(proxy, 'sideNosingRight').name('Nosek boczny z prawej'));
  live(gui.add(proxy, 'riserBoards').name('Podstopnice'));
  live(gui.add(proxy, 'riserThicknessMm', 5, 60, 1).name('Grubość podstopnicy [mm]'));
  live(gui.add(proxy, 'floorFinishBottomMm', 0, 200, 1).name('Posadzka na dole [mm]'));
  live(gui.add(proxy, 'floorFinishTopMm', 0, 200, 1).name('Posadzka na górze [mm]'));
  live(gui.add(proxy, 'concreteSlabThicknessMm', 50, 500, 5).name('Płyta betonu (rysunek) [mm]'));
  live(gui.add(proxy, 'riseToleranceMm', 0, 50, 1).name('Ostrzegaj przy różnicy wysokości [mm]'));
  // stage 3: landing on floor boards, the antresola nosing, the slab, the walls; the winder checks
  const land = gui.addFolder('Podest z deski podłogowej');
  live(land.add(proxy, 'osbThicknessMm', 0, 60, 1).name('Płyta OSB [mm]'));
  live(land.add(proxy, 'floorboardThicknessMm', 5, 40, 1).name('Deska podłogowa [mm]'));
  live(land.add(proxy, 'landingNosingDepthMm', 30, 500, 5).name('Nosek podestu na beton [mm]'));
  land.close();
  const top = gui.addFolder('Antresola i strop');
  live(top.add(proxy, 'exitNosing').name('Nosek antresoli na wyjściu'));
  live(top.add(proxy, 'exitNosingDepthMm', 20, 500, 5).name('Nosek antresoli: na strop [mm]'));
  live(top.add(proxy, 'showSlab').name('Pokaż strop z otworem'));
  live(top.add(proxy, 'slabThicknessMm', 80, 600, 5).name('Grubość stropu [mm]'));
  live(top.add(proxy, 'minHeadroomMm', 1500, 3000, 10).name('Skrajnia nad stopniami [mm]'));
  live(top.add(proxy, 'wallThicknessMm', 50, 600, 5).name('Grubość ścian (rysunek) [mm]'));
  top.close();
  const wind = gui.addFolder('Kontrola zabiegów');
  live(wind.add(proxy, 'winderLegalOffsetMm', 100, 1000, 10).name('Pomiar od duszy [mm]'));
  live(wind.add(proxy, 'winderLegalMinGoingMm', 0, 500, 5).name('Min. głębokość tam [mm]'));
  live(wind.add(proxy, 'winderMinDuszaMm', 0, 500, 5).name('Min. szerokość przy duszy [mm]'));
  live(wind.add(proxy, 'winderGoingToleranceMm', 0, 200, 1).name('Różnica kroku na linii biegu [mm]'));
  wind.close();

  // the walls: per flight, left / right walking up (a walled side gets no side nosing)
  const wallsEl = $('.clad-walls');
  function renderWalls() {
    const n = state.built?.concrete.flights ?? 1;
    const w = state.config.walls || {};
    wallsEl.innerHTML =
      Array.from({ length: n }, (_, f) => `<div class="clad-row"><span class="clad-kind">Bieg ${f + 1}</span><label><input type="checkbox" data-wall="${f}:left" ${w[f]?.left ? 'checked' : ''}/> z lewej</label><label><input type="checkbox" data-wall="${f}:right" ${w[f]?.right ? 'checked' : ''}/> z prawej</label></div>`).join('') +
      '<div class="clad-hint">Strony patrząc w górę biegu. Przy ścianie stopnie nie mają noska bocznego (chyba że stopień ma go ustawionego ręcznie).</div>';
  }
  wallsEl.addEventListener('change', (ev) => {
    const key = ev.target.dataset.wall;
    if (!key) return;
    const [f, side] = key.split(':');
    change((c) => {
      c.walls = { ...(c.walls || {}) };
      c.walls[f] = { ...(c.walls[f] || {}), [side]: ev.target.checked };
    });
  });

  // --- the selected step ---------------------------------------------------------------------------------------
  function renderStepEditor() {
    const box = $('.clad-step');
    const i = state.selected;
    const el = i === null ? null : state.built?.concrete.elements[i];
    if (!el) {
      box.innerHTML = `<h3>Stopień</h3><div class="clad-hint">Kliknij stopień na planie albo w tabeli, żeby zmienić jego własne wymiary i noski.</div>`;
      return;
    }
    const own = state.config.stepOverrides[i] || {};
    const base = expandSequence({ ...state.config, stepOverrides: {} })[i];
    const tri = (f, label) => {
      const v = own[f];
      return `<label class="clad-field">${label} <select data-o="${f}"><option value="" ${v === undefined ? 'selected' : ''}>jak wszystkie</option><option value="1" ${v === true ? 'selected' : ''}>tak</option><option value="0" ${v === false ? 'selected' : ''}>nie</option></select></label>`;
    };
    const numO = (f, label) => `<label class="clad-field">${label} <input type="number" data-o="${f}" value="${own[f] ?? ''}" placeholder="${r0(base[f])}" /></label>`;
    box.innerHTML = `
      <h3>${el.kind === 'landing' ? 'Podest' : 'Stopień'} nr ${i + 1}${el.overridden ? ' <em class="clad-badge">własne wymiary</em>' : ''}</h3>
      <div class="clad-hint">Puste pole = wymiar z grupy (${r0(base.riseMm)} / ${r0(base.goingMm)} / ${r0(base.widthMm)}).</div>
      ${numO('riseMm', 'Wysokość betonu [mm]')}
      ${el.kind === 'step' ? numO('goingMm', 'Głębokość betonu [mm]') : ''}
      ${el.kind === 'step' ? numO('widthMm', 'Szerokość betonu [mm]') : ''}
      ${tri('nosingLeft', 'Nosek boczny z lewej')}
      ${tri('nosingRight', 'Nosek boczny z prawej')}
      ${tri('riser', 'Podstopnica')}
      <div class="clad-actions"><button type="button" data-reset>Przywróć wymiary z grupy</button></div>`;
  }
  $('.clad-step').addEventListener('change', (ev) => {
    const f = ev.target.dataset.o;
    const i = state.selected;
    if (!f || i === null) return;
    change((c) => {
      const o = { ...(c.stepOverrides[i] || {}) };
      const v = ev.target.value;
      if (v === '') delete o[f];
      else if (f === 'nosingLeft' || f === 'nosingRight' || f === 'riser') o[f] = v === '1';
      else o[f] = Number(v);
      if (Object.keys(o).length) c.stepOverrides[i] = o;
      else delete c.stepOverrides[i];
    });
  });
  $('.clad-step').addEventListener('click', (ev) => {
    if (ev.target.dataset.reset === undefined || state.selected === null) return;
    change((c) => delete c.stepOverrides[state.selected]);
  });

  // --- heights and findings ------------------------------------------------------------------------------------
  function renderReport() {
    const { heights } = state.built.cladding;
    const warned = new Set(state.built.diagnostics.map((d) => d.elementId));
    const rows = heights
      .map((h) => {
        const id = h.kind === 'exit' ? 'exit' : `${h.kind}-${h.index}`;
        const blondel = h.goingMm ? r0(2 * h.finishedRiseMm + h.goingMm) : '';
        return `<tr class="${warned.has(id) ? 'warn' : ''}${h.index === state.selected ? ' sel' : ''}" data-row="${h.kind === 'exit' ? '' : h.index}"><td>${escapeHtml(h.kind === 'exit' ? 'wyjście' : h.kind === 'landing' ? `P${h.index + 1}` : String(h.index + 1))}</td><td>${r0(h.concreteRiseMm)}</td><td><b>${r0(h.finishedRiseMm)}</b></td><td>${h.goingMm ? r0(h.goingMm) : ''}</td><td>${blondel}</td></tr>`;
      })
      .join('');
    $('.clad-heights').innerHTML = `<table class="clad-table"><thead><tr><th>nr</th><th>beton</th><th>gotowa</th><th>głęb.</th><th>2h+s</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="clad-hint">Wysokość gotowa = od posadzki / stopnia niżej do wierzchu okładziny [mm]. Wysokość całkowita: ${r0(state.built.totalRise)} mm.</div>`;
    const diags = state.built.diagnostics;
    $('.clad-findings').innerHTML = diags.length ? diags.map((d) => `<div class="clad-finding ${d.severity.toLowerCase()}">${escapeHtml(d.message)}</div>`).join('') : '<div class="clad-hint">Brak uwag.</div>';
  }
  $('.clad-heights').addEventListener('click', (ev) => {
    const row = ev.target.closest('tr[data-row]');
    if (!row || row.dataset.row === '') return;
    select(Number(row.dataset.row));
  });

  function select(i) {
    state.selected = state.selected === i ? null : i;
    renderPlan();
    renderStepEditor();
    renderReport();
  }

  // --- plan (pan / zoom / click) -------------------------------------------------------------------------------
  let viewport = null;
  const panelSize = () => ({ w: planEl.clientWidth || 800, h: planEl.clientHeight || 600 });
  function fitPlan() {
    const { w, h } = panelSize();
    viewport = fitToBounds(claddingPlanBounds(state.built), w, h, 400);
  }
  function renderPlan() {
    if (!viewport) fitPlan();
    planEl.innerHTML = renderCladdingPlanSVG(state.built, { viewport, selectedIndex: state.selected }) + '<div class="clad-plan-hint">kółko = zoom, przeciągnij = przesuń, dwuklik = dopasuj</div>';
  }
  planEl.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = planEl.getBoundingClientRect();
    const { w, h } = panelSize();
    viewport = zoomAt(viewport, ev.clientX - rect.left, ev.clientY - rect.top, w, h, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    renderPlan();
  }, { passive: false });
  let drag = null;
  // a screen point → the plan (mm, y up)
  const planAt = (ev) => {
    const rect = planEl.getBoundingClientRect();
    const { w, h } = panelSize();
    return { x: viewport.x + ((ev.clientX - rect.left) / w) * viewport.width, y: -(viewport.y + ((ev.clientY - rect.top) / h) * viewport.height) };
  };
  planEl.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest?.('.clad-edge-handle');
    drag = { x: ev.clientX, y: ev.clientY, moved: false, target: ev.target, handle: handle ? { zone: Number(handle.dataset.zone), edge: Number(handle.dataset.edge), end: handle.dataset.end } : null };
    planEl.setPointerCapture(ev.pointerId);
  });
  planEl.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (drag.handle) {
      // an edge end slides along its wall / dusza line; the number = mm from that line's corner (whole mm)
      const zone = state.built.concrete.zones[drag.handle.zone];
      if (!zone) return;
      const s = Math.round(signedOnZoneLine(zone, drag.handle.end, planAt(ev)));
      const k = drag.handle.edge - 1;
      const end = drag.handle.end;
      drag.moved = true;
      change(
        (c) => {
          const g = c.sequence[zone.groupIndex];
          g.edges = Array.from({ length: g.count - 1 }, (_, j) => g.edges?.[j] ?? null);
          g.edges[k] = { ...(g.edges[k] || {}), [`${end}Mm`]: s };
        },
        { record: false }
      );
      return;
    }
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const { w, h } = panelSize();
    viewport = panBy(viewport, dx, dy, w, h);
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    renderPlan();
  });
  planEl.addEventListener('pointerup', () => {
    if (drag?.handle && drag.moved) {
      commitHistory();
      renderSequence();
    } else if (drag && !drag.moved) {
      const idx = drag.target?.closest?.('[data-index]')?.dataset.index;
      if (idx !== undefined) select(Number(idx));
    }
    drag = null;
  });
  planEl.addEventListener('dblclick', () => {
    fitPlan();
    renderPlan();
  });
  new ResizeObserver(() => {
    if (active && state.view === 'plan' && state.built) {
      fitPlan();
      renderPlan();
    }
  }).observe(planEl);

  // --- 3D ------------------------------------------------------------------------------------------------------
  let sceneApi = null;
  let root = null;
  let framed = false;
  function render3D() {
    if (state.view !== '3d') return;
    if (!sceneApi) sceneApi = createScene(view3dEl);
    if (root) {
      sceneApi.scene.remove(root);
      root.traverse((o) => o.geometry?.dispose?.());
    }
    root = renderCladdingStair(state.built);
    sceneApi.scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    sceneApi.fitShadowToBox(box);
    if (!framed) {
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(1000, box.getSize(new THREE.Vector3()).length() / 2);
      sceneApi.frameView('iso', centre, radius);
      framed = true;
    }
  }
  function setView(view) {
    state.view = view;
    rootEl.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    planEl.hidden = view !== 'plan';
    view3dEl.hidden = view !== '3d';
    if (view === 'plan') renderPlan();
    else render3D();
  }
  rootEl.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  // --- rebuild -------------------------------------------------------------------------------------------------
  function rebuild() {
    state.built = buildCladdingStair(state.config);
    if (state.selected !== null && state.selected >= state.built.concrete.elements.length) state.selected = null;
    if (state.view === 'plan') renderPlan();
    else render3D();
    renderStepEditor();
    renderReport();
    renderWalls();
  }
  function refreshAll() {
    renderSequence();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    rebuild();
  }

  // --- project file --------------------------------------------------------------------------------------------
  const meta = (text) => ($('.clad-meta').textContent = text);
  $('[data-act="new"]').addEventListener('click', () => {
    if (!window.confirm('Nowy projekt schodów na beton? Niezapisane zmiany przepadną.')) return;
    state.config = createDefaultCladdingConfig();
    state.projectName = '';
    state.notes = '';
    nameInput.value = '';
    state.selected = null;
    viewport = null;
    framed = false;
    history = createHistory(state.config);
    syncHistoryButtons();
    refreshAll();
    meta('');
  });
  $('[data-act="save"]').addEventListener('click', () => {
    const file = claddingProjectToFile({ config: state.config, projectName: state.projectName, notes: state.notes });
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.projectName || 'schody-na-beton').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim() || 'schody-na-beton'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    meta(`Zapisano ${new Date().toLocaleTimeString('pl-PL')}`);
  });
  $('[data-act="load"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = parseCladdingProjectFile(reader.result);
        state.config = loaded.config;
        state.projectName = loaded.projectName;
        state.notes = loaded.notes;
        nameInput.value = loaded.projectName;
        state.selected = null;
        viewport = null;
        framed = false;
        history = createHistory(state.config);
        syncHistoryButtons();
        refreshAll();
        meta(`Wczytano ${file.name}`);
      } catch (e) {
        window.alert(`Nie można wczytać pliku: ${e.message}`);
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });
  nameInput.addEventListener('input', () => (state.projectName = nameInput.value));
  $('[data-act="undo"]').addEventListener('click', () => restore(undo(history)));
  $('[data-act="redo"]').addEventListener('click', () => restore(redo(history)));
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
      e.preventDefault();
      restore(undo(history));
    } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
      e.preventDefault();
      restore(redo(history));
    }
  });

  renderSequence();
  syncHistoryButtons();
  rebuild();

  return {
    setActive(on) {
      active = on;
      if (on) {
        viewport = null;
        setView(state.view);
      }
    },
    // for tests / debugging in the browser
    getState: () => state,
  };
}
