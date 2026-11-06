// THE AI RENDER of the offer's picture (user request 2026-11-06 — TEST): the frame the user set in the presentation
// mode is sent to Google's image model („Nano Banana”, gemini-2.5-flash-image — as in the user's other project) with a
// prompt built from the offer's own parameters, to come back as a realistic photograph for the modern offer's hero.
// The frame is the source of truth: the prompt forbids changing the geometry, the counts (steps, posts, balusters),
// the camera and the materials; our wood texture photo goes along as the material reference (the model's own wood
// looks poor — user). Pure (fetch injected); the DOM side is app/aiRenderPanel.js.
//
// The API key is the user's own (Google AI Studio), kept in this browser only; the request goes straight from the
// browser to generativelanguage.googleapis.com, the key in a header (never in the URL).

export const AI_IMAGE_MODEL_DEFAULT = 'gemini-2.5-flash-image';
/** The model's tallest ratio — the hero's 84 × 150 mm box is the same (0.56); the full-height strip crops its sides. */
export const AI_ASPECT = Object.freeze({ label: '9:16', width: 9, height: 16 });
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const AI_SETTINGS = Object.freeze({
  interior: {
    modern: 'a bright modern single-family house interior: smooth white plastered walls, a light oak or concrete-look floor, soft natural daylight from a large window',
    classic: 'a warm classic house interior: light warm-white walls, oak floorboards, soft daylight and a little warm artificial light',
    studio: 'a plain light grey photo studio (seamless background), soft even studio light — no room, no furniture',
  },
});

/**
 * The prompt: what the picture shows (the offer's facts — the same rows the offer prints), what must stay as it is,
 * what may change (light, the surroundings), the reference images.
 * @param {{facts?: {rows?: Array<[string, string]>}, interior?: string, withTexture?: boolean, extra?: string}} o
 */
export function buildAiPrompt({ facts = {}, interior = 'modern', withTexture = true, extra = '' } = {}) {
  const rows = (facts.rows || []).filter(([k, v]) => k && v && v !== '—' && k !== 'Montaż');
  const lines = [
    'Turn IMAGE 1 (a 3D render of a timber staircase made to measure by a joinery workshop) into a photorealistic architectural interior photograph for the client\'s offer.',
    '',
    'STRICT RULES — the render is the exact design and must be kept:',
    '- Keep the camera position, the angle, the perspective and the framing of IMAGE 1 exactly. Do not zoom, crop, rotate or move the camera.',
    '- Keep the staircase geometry exactly: the same shape, the same number of steps, every tread, riser and stringer where it is and as big as it is.',
    '- Keep the balustrade exactly: the same number and positions of posts, balusters, glass panes and handrails, their shapes and sizes. Do not add, remove, merge or straighten anything.',
    '- Keep every material and colour of IMAGE 1 (wood, paint, metal, glass) — only make them look real (natural light, subtle reflections, real wood pores).',
    withTexture
      ? '- IMAGE 2 is the exact wood used for all the wooden parts: keep its colour, tone and grain; the grain runs along each board as in IMAGE 1. Do not invent another wood species or stain.'
      : '- Keep the wood colour and grain direction of IMAGE 1. Do not invent another wood species or stain.',
    '- Keep the ceiling slab and its opening where they are in IMAGE 1 (finish it as a white plastered ceiling).',
    '- No people, no text, no logos, no watermarks, no extra stairs or furniture in front of the staircase.',
    '',
    `Surroundings (may be added around the staircase, never in front of it): ${AI_SETTINGS.interior[interior] || AI_SETTINGS.interior.modern}.`,
    'Photographic style: a real estate / interior design photo, natural colours, sharp, realistic soft shadows on the floor.',
  ];
  if (rows.length) lines.push('', 'The staircase (from the offer, for reference — IMAGE 1 is binding):', ...rows.map(([k, v]) => `- ${k}: ${v}`));
  const more = String(extra || '').trim();
  if (more) lines.push('', `Additional wishes: ${more}`);
  return lines.join('\n');
}

const dataUrlParts = (url) => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''));
  return m ? { mimeType: m[1], data: m[2] } : null;
};

/** The request body (exported for the tests). */
export function aiRequestBody({ prompt, image, texture = null }) {
  const parts = [{ text: prompt }];
  const img = dataUrlParts(image);
  if (!img) throw new Error('no-frame');
  parts.push({ inlineData: img });
  const tex = dataUrlParts(texture);
  if (tex) parts.push({ inlineData: tex });
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: AI_ASPECT.label } },
  };
}

/** The first picture in a generateContent response → a data URL, or null. */
export function aiResponseImage(json) {
  for (const c of json?.candidates || [])
    for (const p of c?.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
    }
  return null;
}

/**
 * Sends the frame and gets the picture back.
 * @param {{apiKey: string, model?: string, prompt: string, image: string, texture?: string|null, fetchImpl?: Function, signal?: AbortSignal}} o
 * @returns {Promise<string>} the picture as a data URL
 * @throws Error with a code message: no-key | no-frame | http-<status> | blocked | no-image | network
 */
export async function requestAiImage({ apiKey, model = AI_IMAGE_MODEL_DEFAULT, prompt, image, texture = null, fetchImpl = globalThis.fetch, signal } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('no-key');
  const body = aiRequestBody({ prompt, image, texture });
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(String(model || AI_IMAGE_MODEL_DEFAULT).trim())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('network');
  }
  if (!res.ok) throw new Error(`http-${res.status}`);
  const json = await res.json();
  const img = aiResponseImage(json);
  if (img) return img;
  if (json?.promptFeedback?.blockReason || (json?.candidates || []).some((c) => /SAFETY|PROHIBITED|BLOCK/i.test(c?.finishReason || ''))) throw new Error('blocked');
  throw new Error('no-image');
}

/** What to tell the user (Polish). */
export function aiErrorMessage(e) {
  const m = String(e?.message || e);
  if (m === 'no-key') return 'Wpisz najpierw klucz Gemini API (Google AI Studio).';
  if (m === 'no-frame') return 'Nie udało się zrobić kadru z widoku 3D.';
  if (m === 'network') return 'Brak połączenia z Google (internet / blokada przeglądarki).';
  if (m === 'http-400') return 'Google odrzucił zapytanie (400) — sprawdź nazwę modelu i klucz.';
  if (m === 'http-401' || m === 'http-403') return 'Klucz nie ma dostępu do modelu obrazów (może wymagać płatnego planu w AI Studio).';
  if (m === 'http-404') return 'Nie ma takiego modelu — sprawdź jego nazwę.';
  if (m === 'http-429') return 'Limit zapytań — odczekaj chwilę i spróbuj ponownie.';
  if (/^http-5/.test(m)) return 'Serwer Google ma chwilowy problem — spróbuj za chwilę.';
  if (m === 'blocked') return 'Model odmówił wygenerowania obrazu (filtr bezpieczeństwa) — zmień dopiski w prompcie.';
  if (m === 'no-image') return 'Model nie zwrócił obrazu — spróbuj jeszcze raz.';
  if (e?.name === 'AbortError') return 'Przerwano.';
  return 'Coś poszło nie tak — spróbuj jeszcze raz.';
}
