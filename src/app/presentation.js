// Presentation mode wiring (DOM): the company logo — on screen and on the saved photos — and "Zapisz zdjęcie".
// The logo is a COMPANY setting, not a project one: remembered in this browser (localStorage), never in the project
// file or the model history. Pure parts (logoRect, sanitizeLogoSettings, presentationFileName) live in
// scene/presentationImage.js; this module only connects them to the page.

import { defaultLogoSettings, sanitizeLogoSettings, logoRect, presentationFileName } from '../scene/presentationImage.js';

const LOGO_STORAGE_KEY = 'stair3d.presentationLogo';
const LOGO_MAX_PX = 1200; // a larger logo is scaled down before it is stored (sharp on a 2× photo, fits in storage)

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.hostEl      the element the on-screen logo is placed in (the main view)
 * @param {HTMLElement} opts.viewportEl  the 3D viewport — the logo sits at the same relative place as on the photo
 * @param {(settings, message:string) => void} opts.onStatus  shows the logo settings / a message in the HUD
 */
export function createPresentationLogo({ hostEl, viewportEl, onStatus }) {
  let settings = (() => {
    try {
      return sanitizeLogoSettings(JSON.parse(localStorage.getItem(LOGO_STORAGE_KEY) || 'null'));
    } catch {
      return defaultLogoSettings();
    }
  })();
  let storeFailed = false;

  function store() {
    try {
      localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify(settings));
      storeFailed = false;
    } catch {
      storeFailed = true; // e.g. private mode / no space — the logo works until the tab is closed
    }
  }

  const overlay = document.createElement('img');
  overlay.id = 'presentation-logo';
  overlay.className = 'client-only';
  overlay.alt = 'Logo';
  overlay.hidden = true;
  hostEl.appendChild(overlay);

  // On screen at the same place and (relative) size as on the photo — logoRect, one formula.
  function place() {
    const has = !!settings.dataUrl && overlay.complete && overlay.naturalWidth >= 0;
    overlay.hidden = !settings.dataUrl;
    if (!has) return;
    const box = viewportEl.getBoundingClientRect();
    const hostBox = hostEl.getBoundingClientRect();
    const r = logoRect({ imageWidth: box.width, imageHeight: box.height, logoWidth: overlay.naturalWidth || 1, logoHeight: overlay.naturalHeight || 1, corner: settings.corner, sizePct: settings.sizePct });
    Object.assign(overlay.style, { left: `${box.left - hostBox.left + r.x}px`, top: `${box.top - hostBox.top + r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  function apply(message = '') {
    if (settings.dataUrl) {
      overlay.onload = () => place();
      overlay.src = settings.dataUrl;
    } else {
      overlay.removeAttribute('src');
    }
    place();
    onStatus(settings, storeFailed ? `${message} Uwaga: przeglądarka nie pozwoliła zapamiętać logo — będzie dostępne do zamknięcia karty.`.trim() : message);
  }

  window.addEventListener('resize', place);
  new ResizeObserver(place).observe(viewportEl);

  // An SVG logo is kept as it is; a raster one is scaled down to LOGO_MAX_PX (PNG — transparency kept).
  function loadFile(file) {
    if (!/^image\//.test(file.type)) {
      onStatus(settings, 'To nie jest plik obrazu.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const done = (url) => {
        settings = sanitizeLogoSettings({ ...settings, dataUrl: url });
        store();
        apply(`Wczytano: ${file.name}`);
      };
      if (file.type === 'image/svg+xml') return done(dataUrl);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale >= 1) return done(dataUrl);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL('image/png'));
      };
      img.onerror = () => onStatus(settings, 'Nie udało się odczytać obrazu.');
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function remove() {
    settings = { ...settings, dataUrl: null };
    store();
    apply('Logo usunięte.');
  }

  function update(patch) {
    settings = sanitizeLogoSettings({ ...settings, ...patch });
    store();
    place();
  }

  // Draws the logo onto a captured image, in the chosen corner at the chosen size.
  function drawOnto(canvas) {
    if (!(settings.dataUrl && overlay.complete && overlay.naturalWidth > 0)) return;
    const r = logoRect({ imageWidth: canvas.width, imageHeight: canvas.height, logoWidth: overlay.naturalWidth, logoHeight: overlay.naturalHeight, corner: settings.corner, sizePct: settings.sizePct });
    canvas.getContext('2d').drawImage(overlay, r.x, r.y, r.width, r.height);
  }

  return { apply, loadFile, remove, update, drawOnto, dataUrl: () => settings.dataUrl };
}

/** "Zapisz zdjęcie": the 3D scene rendered at 2× + the logo -> a PNG download named after the project. */
export function savePresentationSnapshot({ sceneApi, logo, projectName }) {
  const canvas = sceneApi.captureImage(2);
  logo.drawOnto(canvas);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = presentationFileName(projectName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
