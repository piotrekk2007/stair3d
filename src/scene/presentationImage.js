// Zdjęcie widoku dla Klienta (tryb prezentacji) — czyste obliczenia bez DOM i bez Three.js: gdzie i jak duże
// ma być logo firmy na zdjęciu (i na ekranie — to samo położenie, żeby było widać, co trafi na zdjęcie), nazwa
// pliku i ustawienia logo. Samo robienie zdjęcia (render do canvasa) jest w sceneSetup.js captureImage(),
// a obsługa przycisków w ui/viewportHud.js / main.js.

export const LOGO_CORNERS = Object.freeze([
  { id: 'bottom-right', label: 'prawy dolny' },
  { id: 'bottom-left', label: 'lewy dolny' },
  { id: 'top-right', label: 'prawy górny' },
  { id: 'top-left', label: 'lewy górny' },
]);

// Szerokość logo jako % szerokości zdjęcia; margines od krawędzi jako % krótszego boku (wartości z oka, do zmiany suwakiem).
export const LOGO_SIZE_PCT = Object.freeze({ min: 8, max: 40, default: 18 });
const LOGO_MARGIN_PCT = 3;

export function defaultLogoSettings() {
  return { dataUrl: null, corner: 'bottom-right', sizePct: LOGO_SIZE_PCT.default };
}

/** Ustawienia logo z pamięci przeglądarki — tylko poprawne pola, reszta domyślna. */
export function sanitizeLogoSettings(raw) {
  const out = defaultLogoSettings();
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.dataUrl === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);/.test(raw.dataUrl)) out.dataUrl = raw.dataUrl;
  if (LOGO_CORNERS.some((c) => c.id === raw.corner)) out.corner = raw.corner;
  if (Number.isFinite(raw.sizePct)) out.sizePct = Math.min(LOGO_SIZE_PCT.max, Math.max(LOGO_SIZE_PCT.min, raw.sizePct));
  return out;
}

/**
 * Prostokąt logo na obrazie W × H (px): szerokość = sizePct % szerokości obrazu, proporcje logo zachowane, ale nie
 * wyższe niż 40 % wysokości obrazu (bardzo wysokie logo zmniejszane), margines od krawędzi w wybranym rogu.
 * @returns {{x:number, y:number, width:number, height:number}}
 */
export function logoRect({ imageWidth, imageHeight, logoWidth, logoHeight, corner = 'bottom-right', sizePct = LOGO_SIZE_PCT.default }) {
  const aspect = logoWidth > 0 && logoHeight > 0 ? logoHeight / logoWidth : 1;
  let width = (imageWidth * sizePct) / 100;
  let height = width * aspect;
  const maxHeight = imageHeight * 0.4;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  const margin = (Math.min(imageWidth, imageHeight) * LOGO_MARGIN_PCT) / 100;
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  return {
    x: right ? imageWidth - margin - width : margin,
    y: bottom ? imageHeight - margin - height : margin,
    width,
    height,
  };
}

/** Nazwa pliku zdjęcia: nazwa projektu (bez znaków niedozwolonych w plikach) + data i godzina. */
export function presentationFileName(projectName, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  const base = String(projectName || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `${base || 'schody'}_prezentacja_${stamp}.png`;
}
