// HUD widoku 3D (etap 10, sekcja 8): widoczność warstw, widoki standardowe, perspektywa/ortho,
// dopasowanie kamery; w trybie prezentacji dodatkowo strop i kolor tła. Żyje w #main-view jako
// rodzeństwo #viewport (tak jak #plan2d-hud dla planu) — nigdy wewnątrz canvasa. Czysto
// interakcyjny: woła callbacki, nie dotyka geometrii ani modelu.

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
 */
export function createViewportHud(container, { layers, viewState, onLayerChange, onStandardView, onCameraMode, onCeilingChange, onBackgroundChange }) {
  const hud = document.createElement('div');
  hud.id = 'viewport-hud';
  hud.innerHTML = `
    <div class="vh-group">
      <div class="vh-title">Warstwy</div>
      ${LAYERS_3D.map(([key, label]) => `<label><input type="checkbox" data-layer="${key}" ${layers[key] ? 'checked' : ''}/> ${label}</label>`).join('')}
      <label><input type="checkbox" data-ceiling ${viewState.showCeiling ? 'checked' : ''}/> Strop</label>
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
  `;
  container.appendChild(hud);

  for (const input of hud.querySelectorAll('[data-layer]')) {
    input.addEventListener('change', () => {
      layers[input.dataset.layer] = input.checked;
      onLayerChange(input.dataset.layer, input.checked);
    });
  }
  hud.querySelector('[data-ceiling]').addEventListener('change', (e) => onCeilingChange(e.target.checked));
  for (const btn of hud.querySelectorAll('[data-view]')) btn.addEventListener('click', () => onStandardView(btn.dataset.view));
  hud.querySelector('[data-fit]').addEventListener('click', () => onStandardView('iso'));
  hud.querySelector('[data-camera-mode]').addEventListener('change', (e) => onCameraMode(e.target.value));
  hud.querySelector('[data-bg]').addEventListener('input', (e) => onBackgroundChange(e.target.value));

  return {
    hud,
    syncCeiling(visible) {
      hud.querySelector('[data-ceiling]').checked = visible;
    },
  };
}
