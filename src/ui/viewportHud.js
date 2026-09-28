// HUD widoku 3D (etap 10, sekcja 8): widoczność warstw, widoki standardowe, perspektywa/ortho,
// dopasowanie kamery; w trybie prezentacji dodatkowo strop i kolor tła. Żyje w #main-view jako
// rodzeństwo #viewport (tak jak #plan2d-hud dla planu) — nigdy wewnątrz canvasa. Czysto
// interakcyjny: woła callbacki, nie dotyka geometrii ani modelu.

import { LOGO_CORNERS, LOGO_SIZE_PCT } from '../scene/presentationImage.js';

export const LAYERS_3D = [
  ['Treads', 'Stopnie'],
  ['RiserBoards', 'Podstopnie'],
  ['StringerOuter', 'Wanga zewn.'],
  ['StringerInner', 'Wanga wewn.'],
  ['Posts', 'Słupy'],
  ['Railing', 'Balustrada'],
];

const VIEWS = [
  ['front', 'Przód'],
  ['back', 'Tył'],
  ['left', 'Lewy'],
  ['right', 'Prawy'],
  ['top', 'Góra'],
  ['iso', 'Izo'],
];

/**
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {Record<string, boolean>} opts.layers        stan widoczności warstw (mutowany przez HUD)
 * @param {{showCeiling:boolean}} opts.viewState
 * @param {(key: string, visible: boolean) => void} opts.onLayerChange
 * @param {(view: string) => void} opts.onStandardView
 * @param {(mode: 'perspective'|'orthographic') => void} opts.onCameraMode
 * @param {(visible: boolean) => void} opts.onCeilingChange
 * @param {(hex: string) => void} opts.onBackgroundChange
 * @param {() => void} [opts.onSnapshot]                 „Zapisz zdjęcie" (tryb prezentacji)
 * @param {(file: File) => void} [opts.onLogoFile]       wybrany plik logo
 * @param {() => void} [opts.onLogoRemove]
 * @param {(patch: {corner?: string, sizePct?: number}) => void} [opts.onLogoSettings]
 */
export function createViewportHud(container, { layers, viewState, onLayerChange, onStandardView, onCameraMode, onCeilingChange, onJointsChange, onBackgroundChange, onSnapshot, onLogoFile, onLogoRemove, onLogoSettings }) {
  const hud = document.createElement('div');
  hud.id = 'viewport-hud';
  hud.innerHTML = `
    <div class="vh-group">
      <div class="vh-title">Warstwy</div>
      ${LAYERS_3D.map(([key, label]) => `<label><input type="checkbox" data-layer="${key}" ${layers[key] ? 'checked' : ''}/> ${label}</label>`).join('')}
      <label><input type="checkbox" data-ceiling ${viewState.showCeiling ? 'checked' : ''}/> Strop</label>
      <label title="Gniazda w słupach i wangach oraz otwory na śruby — to, co zaznaczają DXF-y; rysowane przez drewno"><input type="checkbox" data-joints ${viewState.showJoints ? 'checked' : ''}/> Złącza (gniazda, śruby)</label>
      <div class="vh-joint-legend" data-joint-legend ${viewState.showJoints ? '' : 'hidden'}>
        <span><i style="background:#ff8c00"></i>gniazdo w słupie</span>
        <span><i style="background:#ffc107"></i>gniazdo w wandze</span>
        <span><i style="background:#e53935"></i>śruba</span>
        <span><i style="background:#8e24aa"></i>gniazdo nakrętki</span>
      </div>
    </div>
    <div class="vh-group">
      <div class="vh-title">Widok</div>
      <div class="vh-buttons">
        ${VIEWS.map(([key, label]) => `<button type="button" data-view="${key}">${label}</button>`).join('')}
      </div>
      <div class="vh-buttons">
        <button type="button" data-fit title="Dopasuj kamerę do całych schodów">⤢ Dopasuj</button>
        <select data-camera-mode title="Rzutowanie kamery">
          <option value="perspective">Perspektywa</option>
          <option value="orthographic">Ortogonalny</option>
        </select>
      </div>
    </div>
    <div class="vh-group client-only">
      <div class="vh-title">Tło</div>
      <input type="color" data-bg value="#f4f2ee" title="Kolor tła prezentacji" />
    </div>
    <div class="vh-group client-only">
      <div class="vh-title">Zdjęcie dla Klienta</div>
      <button type="button" data-snapshot class="vh-primary" title="Zapisuje bieżący widok jako obraz PNG (2× rozdzielczość ekranu), z logo, jeśli jest wczytane">📷 Zapisz zdjęcie (PNG)</button>
      <div class="vh-buttons">
        <button type="button" data-logo-load title="Logo firmy na zdjęciach i w prezentacji (PNG/JPG/SVG; zapamiętane w tej przeglądarce)">Wczytaj logo…</button>
        <button type="button" data-logo-remove hidden>Usuń logo</button>
      </div>
      <input type="file" data-logo-file accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden />
      <div class="vh-logo-opts" hidden>
        <label>Róg <select data-logo-corner>${LOGO_CORNERS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select></label>
        <label>Wielkość <input type="range" data-logo-size min="${LOGO_SIZE_PCT.min}" max="${LOGO_SIZE_PCT.max}" step="1" value="${LOGO_SIZE_PCT.default}" /></label>
      </div>
      <div class="vh-note" data-logo-status></div>
    </div>
  `;
  container.appendChild(hud);

  for (const input of hud.querySelectorAll('[data-layer]')) {
    input.addEventListener('change', () => {
      layers[input.dataset.layer] = input.checked;
      onLayerChange(input.dataset.layer, input.checked);
    });
  }
  hud.querySelector('[data-ceiling]').addEventListener('change', (e) => onCeilingChange(e.target.checked));
  hud.querySelector('[data-joints]').addEventListener('change', (e) => {
    hud.querySelector('[data-joint-legend]').hidden = !e.target.checked;
    if (onJointsChange) onJointsChange(e.target.checked);
  });
  for (const btn of hud.querySelectorAll('[data-view]')) btn.addEventListener('click', () => onStandardView(btn.dataset.view));
  hud.querySelector('[data-fit]').addEventListener('click', () => onStandardView('iso'));
  hud.querySelector('[data-camera-mode]').addEventListener('change', (e) => onCameraMode(e.target.value));
  hud.querySelector('[data-bg]').addEventListener('input', (e) => onBackgroundChange(e.target.value));

  const fileInput = hud.querySelector('[data-logo-file]');
  hud.querySelector('[data-snapshot]').addEventListener('click', () => onSnapshot && onSnapshot());
  hud.querySelector('[data-logo-load]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // ten sam plik można wybrać ponownie
    if (file && onLogoFile) onLogoFile(file);
  });
  hud.querySelector('[data-logo-remove]').addEventListener('click', () => onLogoRemove && onLogoRemove());
  hud.querySelector('[data-logo-corner]').addEventListener('change', (e) => onLogoSettings && onLogoSettings({ corner: e.target.value }));
  hud.querySelector('[data-logo-size]').addEventListener('input', (e) => onLogoSettings && onLogoSettings({ sizePct: Number(e.target.value) }));

  return {
    hud,
    // Stan kontrolek logo z ustawień (po wczytaniu z pamięci / zmianie) + krótki komunikat.
    syncLogo(settings, message = '') {
      const has = !!settings.dataUrl;
      hud.querySelector('[data-logo-remove]').hidden = !has;
      hud.querySelector('.vh-logo-opts').hidden = !has;
      hud.querySelector('[data-logo-load]').textContent = has ? 'Zmień logo…' : 'Wczytaj logo…';
      hud.querySelector('[data-logo-corner]').value = settings.corner;
      hud.querySelector('[data-logo-size]').value = String(settings.sizePct);
      hud.querySelector('[data-logo-status]').textContent = message;
    },
    syncCeiling(visible) {
      hud.querySelector('[data-ceiling]').checked = visible;
    },
  };
}
