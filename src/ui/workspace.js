// SZKIELET WORKSPACE'U (etap 10). Czysto layoutowy: buduje raz stałe kontenery DOM (toolbar,
// lewy panel parametrów, obszar roboczy 2D/3D, prawy panel z zakładkami, pasek statusu) i oddaje
// referencje. Nie zawiera żadnej logiki geometrycznej ani wyliczeń — panele wypełniają
// osobne moduły (ui.js, inspectorPanel.js, takeoffPanel.js), a main.js tylko je łączy.
//
//   #app (CSS grid)
//     #toolbar        — projekt, nowy/zapisz/wczytaj, cofnij/ponów, przełącznik 2D/3D, tryb prezentacji
//     #sidebar-left   — #info-panel (podsumowanie wyliczeń) + lil-gui (parametry)
//     #main-view      — #viewport (3D), #plan2d-panel (2D) i #profile-panel (edytor profilu wangi) — jeden widoczny naraz
//     #sidebar-right  — zakładki: Inspektor / Walidacja / Kosztorys
//     #statusbar      — stan poprawności, zaznaczenie, skala/kamera

const TABS = [
  { id: 'inspector', label: 'Inspektor' },
  { id: 'validation', label: 'Walidacja' },
  { id: 'takeoff', label: 'Kosztorys' },
];

/**
 * @param {HTMLElement} app
 * @param {Object} handlers
 * @param {() => void} handlers.onNew
 * @param {() => void} handlers.onSave
 * @param {() => void} handlers.onLoad
 * @param {() => void} handlers.onUndo
 * @param {() => void} handlers.onRedo
 * @param {(view: '2d'|'3d'|'profile') => void} handlers.onViewChange
 * @param {() => void} handlers.onToggleClientMode
 * @param {(name: string) => void} handlers.onProjectNameChange
 * @param {(notes: string) => void} handlers.onProjectNotesChange
 */
export function createWorkspace(app, handlers) {
  app.classList.add('workspace');
  app.innerHTML = `
    <header id="toolbar">
      <span id="toolbar-brand">Stair3D</span>
      <input id="project-name" type="text" placeholder="Nazwa projektu" maxlength="80" aria-label="Nazwa projektu" />
      <button type="button" id="project-notes-toggle" title="Notatki do projektu">📝 Notatki</button>
      <span class="toolbar-sep"></span>
      <button type="button" data-action="new" title="Nowy projekt (domyślne parametry)">Nowy</button>
      <button type="button" data-action="save" title="Zapisz projekt do pliku JSON">Zapisz</button>
      <button type="button" data-action="load" title="Wczytaj projekt z pliku JSON">Wczytaj</button>
      <span id="project-meta" title="Ostatnia operacja na pliku projektu"></span>
      <span class="toolbar-sep"></span>
      <button type="button" data-action="undo" title="Cofnij (Ctrl+Z)">↶ Cofnij</button>
      <button type="button" data-action="redo" title="Ponów (Ctrl+Y)">↷ Ponów</button>
      <span class="toolbar-spacer"></span>
      <div id="view-switch" role="tablist" aria-label="Widok">
        <button type="button" role="tab" data-view="2d">Plan 2D</button>
        <button type="button" role="tab" data-view="3d" class="active">Widok 3D</button>
        <button type="button" role="tab" data-view="profile" title="Edytor profilu wangi (widok z boku)">Profil wangi</button>
      </div>
      <button type="button" data-action="client-mode" title="Tryb prezentacji: czysty widok 3D dla klienta">🎬 Prezentacja</button>
    </header>
    <div id="project-notes-popover" hidden>
      <label for="project-notes">Notatki do projektu</label>
      <textarea id="project-notes" rows="5" placeholder="Uwagi, ustalenia z klientem…"></textarea>
    </div>
    <aside id="sidebar-left"></aside>
    <main id="main-view"></main>
    <aside id="sidebar-right">
      <nav id="right-tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}"><span>${t.label}</span><em class="tab-badge" data-badge="${t.id}" hidden></em></button>`).join('')}
      </nav>
      ${TABS.map((t) => `<section class="tab-body" id="tab-${t.id}" data-tab-body="${t.id}" hidden></section>`).join('')}
    </aside>
    <footer id="statusbar">
      <span id="status-validity"></span>
      <span id="status-selection"></span>
      <span class="toolbar-spacer"></span>
      <span id="status-view"></span>
    </footer>
    <button type="button" id="client-mode-exit" hidden>✕ Wyjdź z trybu prezentacji</button>
  `;

  const $ = (sel) => app.querySelector(sel);
  const toolbar = $('#toolbar');

  toolbar.querySelector('[data-action="new"]').addEventListener('click', () => handlers.onNew());
  toolbar.querySelector('[data-action="save"]').addEventListener('click', () => handlers.onSave());
  toolbar.querySelector('[data-action="load"]').addEventListener('click', () => handlers.onLoad());
  toolbar.querySelector('[data-action="undo"]').addEventListener('click', () => handlers.onUndo());
  toolbar.querySelector('[data-action="redo"]').addEventListener('click', () => handlers.onRedo());
  toolbar.querySelector('[data-action="client-mode"]').addEventListener('click', () => handlers.onToggleClientMode());
  $('#client-mode-exit').addEventListener('click', () => handlers.onToggleClientMode());

  const viewButtons = [...toolbar.querySelectorAll('#view-switch [data-view]')];
  for (const btn of viewButtons) btn.addEventListener('click', () => handlers.onViewChange(btn.dataset.view));

  const nameInput = $('#project-name');
  nameInput.addEventListener('input', () => handlers.onProjectNameChange(nameInput.value));

  const notesToggle = $('#project-notes-toggle');
  const notesPopover = $('#project-notes-popover');
  const notesInput = $('#project-notes');
  notesToggle.addEventListener('click', () => {
    notesPopover.hidden = !notesPopover.hidden;
  });
  notesInput.addEventListener('input', () => handlers.onProjectNotesChange(notesInput.value));

  const tabButtons = [...app.querySelectorAll('#right-tabs [data-tab]')];
  const tabBodies = [...app.querySelectorAll('[data-tab-body]')];
  function selectTab(id) {
    for (const b of tabButtons) {
      const active = b.dataset.tab === id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    }
    for (const body of tabBodies) body.hidden = body.dataset.tabBody !== id;
  }
  for (const b of tabButtons) b.addEventListener('click', () => selectTab(b.dataset.tab));
  selectTab('inspector');

  return {
    leftEl: $('#sidebar-left'),
    mainEl: $('#main-view'),
    tabBody: (id) => app.querySelector(`[data-tab-body="${id}"]`),
    selectTab,
    setTabBadge(id, text, level = 'info') {
      const badge = app.querySelector(`[data-badge="${id}"]`);
      badge.hidden = !text;
      badge.textContent = text || '';
      badge.dataset.level = level;
    },
    setView(view) {
      for (const b of viewButtons) b.classList.toggle('active', b.dataset.view === view);
    },
    setHistoryState({ canUndo, canRedo }) {
      toolbar.querySelector('[data-action="undo"]').disabled = !canUndo;
      toolbar.querySelector('[data-action="redo"]').disabled = !canRedo;
    },
    setProjectMeta({ name, notes, lastFileNote }) {
      if (name !== undefined && nameInput.value !== name) nameInput.value = name;
      if (notes !== undefined && notesInput.value !== notes) notesInput.value = notes;
      if (lastFileNote !== undefined) $('#project-meta').textContent = lastFileNote;
    },
    setStatus({ validity, selection, view }) {
      if (validity !== undefined) {
        const el = $('#status-validity');
        el.innerHTML = validity.html;
        el.dataset.level = validity.level;
      }
      if (selection !== undefined) $('#status-selection').textContent = selection;
      if (view !== undefined) $('#status-view').textContent = view;
    },
    setClientMode(on) {
      app.classList.toggle('client-mode', on);
      $('#client-mode-exit').hidden = !on;
    },
  };
}
