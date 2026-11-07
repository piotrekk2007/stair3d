// „🖼 Kadry do oferty” (DOM; user request 2026-11-07): frames chosen in the presentation mode of either module, as the
// AI frame is — a frame drawn over the 3D view in the chosen format, the user's own camera rendered in it
// (sceneSetup.js renderFrameImage):
//  - „do galerii” (3:2): the offer's last page shows them under „Wizualizacje” (several, ordered, removable);
//  - „obraz po lewej” (the hero strip over the whole height, or the 9:16 box): the modern offer's hero instead of the
//    automatic render (as the AI picture — the module's `onHero`).
// Kept for the session (not in the project — pictures are big), as the AI picture.

import { HERO_FULL_MM, HERO_BOX_MM } from '../offer/offerDocumentModern.js';
import { frameInViewport } from '../scene/sceneSetup.js';

export const FRAME_FORMATS = Object.freeze({
  gallery: { label: 'do galerii na ostatniej stronie (poziomy 3:2)', width: 1500, height: 1000 },
  heroFull: { label: 'obraz po lewej — cała wysokość strony', width: 960, height: Math.round((960 * HERO_FULL_MM.height) / HERO_FULL_MM.width) },
  heroBox: { label: `obraz po lewej — środek ${HERO_BOX_MM.width} × ${HERO_BOX_MM.height} mm`, width: 900, height: Math.round((900 * HERO_BOX_MM.height) / HERO_BOX_MM.width) },
});

/**
 * @param {Object} o
 * @param {HTMLElement} o.hostEl  @param {HTMLElement} o.viewportEl  @param {() => Object} o.getSceneApi
 * @param {() => string[]} o.getGallery  the gallery as it is (data URLs)
 * @param {(list: string[]) => void} o.onGallery  the gallery changed
 * @param {(img: string, opts: {full: boolean}) => void} o.onHero  a frame chosen as the hero picture
 * @param {() => void} [o.onOpen]  (the AI panel closes — one frame on the view at a time)
 */
export function createOfferFramesPanel({ hostEl, viewportEl, getSceneApi, getGallery, onGallery, onHero, onOpen = () => {} }) {
  let format = 'gallery';
  const frame = document.createElement('div');
  frame.className = 'ai-frame';
  frame.hidden = true;
  frame.innerHTML = '<div class="ai-frame-box"><span class="ai-frame-label"></span></div>';
  hostEl.appendChild(frame);
  const panel = document.createElement('div');
  panel.className = 'ai-panel offer-frames-panel';
  panel.hidden = true;
  hostEl.appendChild(panel);

  function placeFrame() {
    if (frame.hidden) return;
    const v = viewportEl.getBoundingClientRect();
    const h = hostEl.getBoundingClientRect();
    Object.assign(frame.style, { left: `${v.left - h.left}px`, top: `${v.top - h.top}px`, width: `${v.width}px`, height: `${v.height}px` });
    const fmt = FRAME_FORMATS[format];
    const f = frameInViewport(v.width, v.height, fmt.width / fmt.height);
    const box = frame.firstChild;
    Object.assign(box.style, { left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` });
    box.querySelector('.ai-frame-label').textContent = format === 'gallery' ? 'Kadr do galerii oferty (3:2)' : 'Kadr — obraz po lewej w ofercie';
  }
  window.addEventListener('resize', placeFrame);
  new ResizeObserver(placeFrame).observe(viewportEl);

  function render(status = '') {
    const list = getGallery() || [];
    panel.innerHTML = `
      <div class="ai-head"><b>🖼 Kadry do oferty</b><button type="button" data-of="close" title="Zamknij">✕</button></div>
      <div class="ai-hint">Ustaw widok w 3D (obracaj, przybliżaj) — ramka pokazuje kadr. Kadry z galerii trafiają na ostatnią stronę oferty („Wizualizacje”); kadr „obraz po lewej” zastępuje automatyczną wizualizację w ofercie nowoczesnej.</div>
      <label class="ai-row">Kadr <select data-of="format">${Object.entries(FRAME_FORMATS).map(([k, f]) => `<option value="${k}"${k === format ? ' selected' : ''}>${f.label}</option>`).join('')}</select></label>
      <div class="ai-actions"><button type="button" class="ai-primary" data-of="add">＋ Dodaj ten kadr</button></div>
      <div class="ai-status" data-of="status">${status}</div>
      <div class="ai-hint">W galerii: ${list.length} ${list.length === 1 ? 'kadr' : list.length > 1 && list.length < 5 ? 'kadry' : 'kadrów'}${list.length ? ' — kolejność jak w ofercie' : ''}.</div>
      <div class="offer-frames-list">${list
        .map(
          (src, i) => `<figure><img src="${src}" alt="kadr ${i + 1}"><figcaption>${i + 1}
            <button type="button" data-of="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Wcześniej">↑</button>
            <button type="button" data-of="down" data-i="${i}" ${i === list.length - 1 ? 'disabled' : ''} title="Później">↓</button>
            <button type="button" data-of="del" data-i="${i}" title="Usuń">✕</button></figcaption></figure>`,
        )
        .join('')}</div>
      ${list.length ? '<div class="ai-actions"><button type="button" data-of="clear">Usuń wszystkie z galerii</button></div>' : ''}`;
    placeFrame();
  }

  panel.addEventListener('change', (e) => {
    if (e.target.dataset.of !== 'format') return;
    format = e.target.value;
    placeFrame();
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-of]');
    if (!b) return;
    const list = [...(getGallery() || [])];
    const i = Number(b.dataset.i);
    const act = b.dataset.of;
    if (act === 'close') return close();
    if (act === 'add') {
      const api = getSceneApi();
      if (!api?.renderFrameImage) return render('Widok 3D nie jest gotowy.');
      const fmt = FRAME_FORMATS[format];
      const img = api.renderFrameImage({ width: fmt.width, height: fmt.height }).toDataURL('image/jpeg', 0.9);
      if (format === 'gallery') {
        onGallery([...list, img]);
        return render(`Dodano kadr ${list.length + 1} do galerii.`);
      }
      onHero(img, { full: format === 'heroFull' });
      return render('Ustawiono jako obraz po lewej w ofercie nowoczesnej.');
    }
    if (act === 'del') list.splice(i, 1);
    else if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    else if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    else if (act === 'clear') list.length = 0;
    else return;
    onGallery(list);
    render();
  });

  function open() {
    onOpen();
    panel.hidden = false;
    frame.hidden = false;
    render();
  }
  function close() {
    panel.hidden = true;
    frame.hidden = true;
  }
  return { open, close, toggle: () => (panel.hidden ? open() : close()), isOpen: () => !panel.hidden };
}
