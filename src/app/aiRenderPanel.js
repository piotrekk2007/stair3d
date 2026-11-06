// The AI render panel (DOM; user request 2026-11-06 — TEST): opened from the presentation mode of either module. A
// floating panel beside the 3D view + a frame drawn over the viewport: the 9:16 picture that is sent (the dashed
// strip inside = what the modern offer's full-height hero keeps of it). „✨ Wyślij kadr do AI” renders the user's own
// camera in that frame (sceneSetup.js renderFrameImage), sends it with the prompt built from the offer's facts and our
// oak texture (offer/aiRender.js), shows the result next to the frame; „Użyj w ofercie nowoczesnej” hands it to the
// module (onUse). The camera can be moved while the panel is open — the frame follows.

import { buildAiPrompt, requestAiImage, aiErrorMessage, AI_ASPECT, AI_IMAGE_MODEL_DEFAULT, AI_SETTINGS } from '../offer/aiRender.js';
import { HERO_FULL_MM, HERO_BOX_MM } from '../offer/offerDocumentModern.js';
import { frameInViewport } from '../scene/sceneSetup.js';
import { escapeHtml as esc } from '../util/format.js';

const OAK_URL = new URL('../assets/textures/oak-natural.jpg', import.meta.url).href;
const KEY = 'stair3d.ai';
const FRAME_PX = { width: 864, height: 1536 }; // 9:16
const INTERIORS = { modern: 'nowoczesne, jasne', classic: 'klasyczne, ciepłe', studio: 'studio (jednolite tło)' };

const loadPrefs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const savePrefs = (p) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // (remembered until the tab is closed)
  }
};

/** A picture (URL / data URL) → JPEG data URL, at most `maxSide` px. */
function toJpeg(src, maxSide, quality = 0.9) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = rej;
    img.src = src;
  });
}

/**
 * @param {Object} o
 * @param {HTMLElement} o.hostEl        where the panel and the frame are placed (position: relative or similar)
 * @param {HTMLElement} o.viewportEl    the 3D viewport (the frame is drawn over it)
 * @param {() => Object} o.getSceneApi  the module's scene (renderFrameImage)
 * @param {() => Object} o.getFacts     the offer's facts ({rows}) — the prompt's description
 * @param {(img: string, opts: {full: boolean}) => void} o.onUse  the picture for the modern offer
 * @param {() => {full: boolean}|null} [o.getUsed]  what the offer uses now (shown in the panel)
 */
export function createAiRenderPanel({ hostEl, viewportEl, getSceneApi, getFacts, onUse, getUsed = () => null }) {
  let prefs = { model: '', interior: 'modern', texture: true, extra: '', full: true, ...loadPrefs() };
  let frameImg = null;
  let resultImg = null;
  let busy = null; // AbortController
  let promptEdited = false;

  const frame = document.createElement('div');
  frame.className = 'ai-frame';
  frame.hidden = true;
  frame.innerHTML = '<div class="ai-frame-box"><div class="ai-frame-strip"></div><span class="ai-frame-label">Kadr do AI 9:16 · przerywane = pas oferty</span></div>';
  hostEl.appendChild(frame);

  const panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.hidden = true;
  hostEl.appendChild(panel);

  function placeFrame() {
    if (frame.hidden) return;
    const v = viewportEl.getBoundingClientRect();
    const h = hostEl.getBoundingClientRect();
    Object.assign(frame.style, { left: `${v.left - h.left}px`, top: `${v.top - h.top}px`, width: `${v.width}px`, height: `${v.height}px` });
    const f = frameInViewport(v.width, v.height, AI_ASPECT.width / AI_ASPECT.height);
    const box = frame.firstChild;
    Object.assign(box.style, { left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` });
    // the full-height hero keeps the middle (its width / 276) ÷ (9 / 16) of the picture's width
    const keep = HERO_FULL_MM.width / HERO_FULL_MM.height / (AI_ASPECT.width / AI_ASPECT.height);
    const strip = box.querySelector('.ai-frame-strip');
    strip.hidden = !prefs.full;
    Object.assign(strip.style, { left: `${((1 - keep) / 2) * 100}%`, width: `${keep * 100}%` });
  }
  window.addEventListener('resize', placeFrame);
  new ResizeObserver(placeFrame).observe(viewportEl);

  const prompt = () => buildAiPrompt({ facts: getFacts() || {}, interior: prefs.interior, withTexture: prefs.texture, extra: prefs.extra });

  function render() {
    const used = getUsed();
    panel.innerHTML = `
      <div class="ai-head"><b>✨ Obraz AI do oferty</b> <span class="ai-test">test</span><button type="button" data-ai="close" title="Zamknij">✕</button></div>
      <div class="ai-hint">Ustaw kadr w widoku 3D (obracaj, przybliżaj) — ramka pokazuje, co pójdzie do AI. Schody, ich geometria, liczba stopni i tralek oraz nasze drewno mają zostać bez zmian; AI dodaje światło, wnętrze i realizm.</div>
      <label class="ai-row">Klucz Gemini API <input type="password" data-ai-key value="${esc(prefs.key || '')}" placeholder="z Google AI Studio" autocomplete="off"></label>
      <div class="ai-hint">Klucz zostaje w tej przeglądarce; kadr idzie prosto do Google (generativelanguage.googleapis.com).</div>
      <label class="ai-row">Model <input type="text" data-ai-pref="model" value="${esc(prefs.model)}" placeholder="${esc(AI_IMAGE_MODEL_DEFAULT)}"></label>
      <label class="ai-row">Wnętrze <select data-ai-pref="interior">${Object.entries(INTERIORS).map(([k, l]) => `<option value="${k}"${prefs.interior === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="ai-check"><input type="checkbox" data-ai-pref="texture"${prefs.texture ? ' checked' : ''}> Wyślij nasze zdjęcie dębu jako wzór drewna</label>
      <label class="ai-row ai-col">Dopiski (opcjonalnie) <textarea rows="2" data-ai-pref="extra" placeholder="np. okno po prawej, wieczorne światło">${esc(prefs.extra)}</textarea></label>
      <details class="ai-prompt"><summary>Prompt (z parametrów oferty — można poprawić)</summary><textarea rows="10" data-ai-prompt>${esc(prompt())}</textarea><button type="button" data-ai="reprompt">↺ Odtwórz z parametrów</button></details>
      <div class="ai-actions">${busy ? '<button type="button" data-ai="abort">Przerwij</button><span class="ai-spin">Generuję… (do minuty)</span>' : '<button type="button" class="ai-primary" data-ai="send">✨ Wyślij kadr do AI</button>'}</div>
      <div class="ai-status" data-ai-status></div>
      ${
        frameImg || resultImg
          ? `<div class="ai-result">${frameImg ? `<figure><img src="${frameImg}" alt="kadr"><figcaption>kadr</figcaption></figure>` : ''}${resultImg ? `<figure><img src="${resultImg}" alt="AI"><figcaption>AI</figcaption></figure>` : ''}</div>`
          : ''
      }
      ${
        resultImg
          ? `<label class="ai-row">W ofercie <select data-ai-pref="full"><option value="1"${prefs.full ? ' selected' : ''}>cała wysokość (boki przycięte)</option><option value="0"${prefs.full ? '' : ' selected'}>środek ${HERO_BOX_MM.width} × ${HERO_BOX_MM.height} mm (cały obraz)</option></select></label>
        <div class="ai-actions"><button type="button" class="ai-primary" data-ai="use">Użyj w ofercie nowoczesnej</button><button type="button" data-ai="download">⬇ Pobierz</button></div>`
          : ''
      }
      ${used ? `<div class="ai-hint ai-used">Oferta nowoczesna używa teraz obrazu AI (${used.full ? 'cała wysokość' : 'środek'}). Usunąć go można w zakładce „Oferta”.</div>` : ''}`;
    placeFrame();
  }
  const status = (text, bad = false) => {
    const el = panel.querySelector('[data-ai-status]');
    if (el) {
      el.textContent = text || '';
      el.classList.toggle('bad', bad);
    }
  };

  async function send() {
    const api = getSceneApi();
    if (!api?.renderFrameImage) return status('Widok 3D nie jest gotowy.', true);
    const promptText = promptEdited ? panel.querySelector('[data-ai-prompt]').value : prompt();
    frameImg = api.renderFrameImage(FRAME_PX).toDataURL('image/jpeg', 0.9);
    resultImg = null;
    busy = new AbortController();
    render();
    if (promptEdited) panel.querySelector('[data-ai-prompt]').value = promptText;
    try {
      const texture = prefs.texture ? await toJpeg(OAK_URL, 1024, 0.88) : null;
      const out = await requestAiImage({ apiKey: prefs.key, model: prefs.model || AI_IMAGE_MODEL_DEFAULT, prompt: promptText, image: frameImg, texture, signal: busy.signal });
      resultImg = await toJpeg(out, 1600, 0.92);
      busy = null;
      render();
      status('Gotowe — porównaj z kadrem. Jeśli coś się zmieniło (liczba tralek, kształt), spróbuj jeszcze raz.');
    } catch (e) {
      busy = null;
      render();
      status(aiErrorMessage(e), true);
    }
  }

  panel.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-ai-key]')) {
      prefs.key = t.value.trim();
      savePrefs(prefs);
    } else if (t.matches('[data-ai-prompt]')) promptEdited = true;
    else if (t.dataset.aiPref && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
      prefs[t.dataset.aiPref] = t.value;
      savePrefs(prefs);
      if (!promptEdited) {
        const ta = panel.querySelector('[data-ai-prompt]');
        if (ta) ta.value = prompt();
      }
    }
  });
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.aiPref || (t.type !== 'checkbox' && t.tagName !== 'SELECT')) return;
    prefs[t.dataset.aiPref] = t.type === 'checkbox' ? t.checked : t.dataset.aiPref === 'full' ? t.value === '1' : t.value;
    savePrefs(prefs);
    if (!promptEdited) {
      const ta = panel.querySelector('[data-ai-prompt]');
      if (ta) ta.value = prompt();
    }
    placeFrame();
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ai]');
    if (!b) return;
    const act = b.dataset.ai;
    if (act === 'close') close();
    else if (act === 'send') send();
    else if (act === 'abort') busy?.abort();
    else if (act === 'reprompt') {
      promptEdited = false;
      panel.querySelector('[data-ai-prompt]').value = prompt();
    } else if (act === 'use' && resultImg) {
      onUse(resultImg, { full: prefs.full });
      render();
      status('Obraz ustawiony w ofercie nowoczesnej (zakładka „Oferta” → drukuj).');
    } else if (act === 'download' && resultImg) {
      const a = document.createElement('a');
      a.href = resultImg;
      a.download = 'schody-ai.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });

  function open() {
    panel.hidden = false;
    frame.hidden = false;
    render();
  }
  function close() {
    busy?.abort();
    panel.hidden = true;
    frame.hidden = true;
  }
  return { open, close, toggle: () => (panel.hidden ? open() : close()), isOpen: () => !panel.hidden };
}
