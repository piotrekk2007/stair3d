// THE OFFER'S TEXT AND THE E-MAIL TO THE CLIENT, written by Google's text model (user request 2026-11-26, both
// modules): from the offer's own facts (the parameter rows it prints), its lines and totals, the lead time, the
// validity, delivery / installation — the model writes the offer's „Wstęp” (a short paragraph printed at the start of
// the offer, Polish), a title and a subtitle for the modern style and the e-mail's subject and body (Polish, German or
// English; formal or friendly; short or longer).
//
// User decisions 2026-11-26: NO personal data goes to Google — not the client's name, address, phone or e-mail, not
// the company's people: the model writes the body only, the greeting (chosen from a list, the name typed locally) and
// the signature (the company data and the offer's handler) are put round it HERE, in the browser. The facts and the
// prices are the company's business data (the user's own key, as the AI render).
//
// Pure (fetch injected); the DOM side is app/aiOfferTextPanel.js. The key travels in a header, never in the URL.

import { aiErrorMessage } from './aiRender.js';

export const AI_TEXT_MODEL_DEFAULT = 'gemini-2.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const AI_TEXT_LANGUAGES = Object.freeze({ pl: 'polski', de: 'niemiecki', en: 'angielski' });
export const AI_TEXT_TONES = Object.freeze({ formal: 'oficjalny', friendly: 'przyjazny' });
export const AI_TEXT_LENGTHS = Object.freeze({ short: 'krótko', long: 'szerzej' });
const LANGUAGE_NAMES = { pl: 'Polish', de: 'German', en: 'English' };

// The greeting — chosen by the user, the name typed by the user, both local (never sent). `{name}` = the typed name.
export const AI_SALUTATIONS = Object.freeze({
  plural: { label: 'Szanowni Państwo', pl: 'Szanowni Państwo,', de: 'Sehr geehrte Damen und Herren,', en: 'Dear Sir or Madam,' },
  mr: { label: 'Szanowny Panie …', pl: 'Szanowny Panie {name},', de: 'Sehr geehrter Herr {name},', en: 'Dear Mr {name},', enBare: 'Dear Sir,' },
  mrs: { label: 'Szanowna Pani …', pl: 'Szanowna Pani {name},', de: 'Sehr geehrte Frau {name},', en: 'Dear Ms {name},', enBare: 'Dear Madam,' },
  hello: { label: 'Dzień dobry', pl: 'Dzień dobry,', de: 'Guten Tag,', en: 'Hello,' },
});
const CLOSINGS = {
  formal: { pl: 'Z poważaniem', de: 'Mit freundlichen Grüßen', en: 'Kind regards' },
  friendly: { pl: 'Pozdrawiam serdecznie', de: 'Viele Grüße', en: 'Best wishes' },
};
const PHONE = { pl: 'tel.', de: 'Tel.', en: 'Phone' };

// how long each text is (sentences) — the intro must fit sheet 1 of the modern offer, so it stays short either way
const SIZES = {
  short: { intro: '2–3 sentences, at most 350 characters', email: '3–5 sentences' },
  long: { intro: '3–5 sentences, at most 550 characters', email: '2–3 short paragraphs' },
};
export const AI_TITLE_MAX_CHARS = 60;

// (a plain space between the thousands — the model copies the amount exactly as written)
const money = (n) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0).replace(/[  ]/g, ' ')} zł`;

/**
 * The prompt. Only the stair, the offer's lines and sums, the terms — no names, addresses, phones or e-mails.
 * @param {Object} o
 * @param {'stair'|'cladding'} [o.kind]           a self-supporting stair / the wooden cladding of a concrete stair
 * @param {{rows?: Array<[string, string]>}} [o.facts]  the offer's parameter rows (as printed)
 * @param {{lines?: Array<{label, detail?, qty?, unit?, net}>, totals?: {net, vat, gross, vatRatePct}}} [o.offer]
 * @param {{offerNumber?, validityDays?, leadTime?, leadTimeNote?, deliveryIncluded?, installation?}} [o.terms]
 * @param {'formal'|'friendly'} [o.tone]  @param {'short'|'long'} [o.length]  @param {'pl'|'de'|'en'} [o.language]
 * @param {string} [o.extra]  the user's own wishes
 */
export function buildOfferTextPrompt({ kind = 'stair', facts = {}, offer = {}, terms = {}, tone = 'formal', length = 'short', language = 'pl', extra = '' } = {}) {
  const lang = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.pl;
  const size = SIZES[length] || SIZES.short;
  const rows = (facts.rows || []).filter(([k, v]) => k && v && v !== '—');
  const lines = offer.lines || [];
  const t = offer.totals || {};
  const what = kind === 'cladding' ? 'timber stairs laid on an existing concrete staircase (wooden treads, risers and finishing on the concrete)' : 'a made-to-measure self-supporting timber staircase';
  const out = [
    `You write for a Polish joinery workshop that makes timber staircases. The offer is for ${what}.`,
    'Write the texts below from the FACTS only. Return JSON with the fields intro, title, subtitle, emailSubject, emailBody.',
    '',
    'RULES:',
    '- Use only the facts given. Never invent features, materials, colours, warranties, discounts, dates, deadlines, certificates or anything else that is not in the facts.',
    '- Never write any price, amount or number of money except the gross total given below, copied exactly as written there.',
    '- No names of people, no placeholders, no brackets like [Name], no signatures, no contact data.',
    `- Tone: ${tone === 'friendly' ? 'warm and personal, but professional' : 'formal and polite, business style'}. Address the client politely in the plural form (Polish: „Państwo”).`,
    '- Plain text only: no markdown, no bullet characters, no emojis.',
    // the trade's own words (user decision 2026-11-26): a tread is never „okładzina”
    '- Polish trade terms: say „schody drewniane”, „stopnie drewniane” or „trepy schodowe”. NEVER call the treads or the stairs „okładzina” / „okładziny” (nor „wooden cladding” in German or English) — „okładzina” only for wood covering something that is not a step (a wall, a stringer, a beam).',
    '',
    'THE TEXTS:',
    `- intro (in Polish): the opening paragraph of the printed offer — what we offer and its main features in plain words, why it is a good choice. ${size.intro}. No greeting.`,
    `- title (in Polish): a short title of the offer, at most ${AI_TITLE_MAX_CHARS} characters, e.g. „Schody dębowe zabiegowe z balustradą”.`,
    `- subtitle (in Polish): its second part, at most ${AI_TITLE_MAX_CHARS} characters, e.g. „podstopnie białe, montaż w cenie”.`,
    `- emailSubject (in ${lang}): the subject of the e-mail sending the offer${terms.offerNumber ? `, with the offer number ${terms.offerNumber}` : ''}.`,
    `- emailBody (in ${lang}): the e-mail sending the offer (attached as a PDF): thanks for the enquiry, what the offer covers, the gross total, how long it is valid, the next step (questions, a site measurement, the order). ${size.email}. WITHOUT the greeting line and WITHOUT the closing / signature — they are added by the program.`,
    '',
    'FACTS — the staircase:',
    ...(rows.length ? rows.map(([k, v]) => `- ${k}: ${v}`) : ['- (no details)']),
  ];
  if (lines.length) out.push('', 'FACTS — the offer\'s items (net):', ...lines.map((l) => `- ${l.label}${l.detail ? ` (${l.detail})` : ''}${l.qty != null ? `, ${l.qty} ${l.unit || ''}`.trimEnd() : ''}`));
  const termsOut = [
    t.gross != null ? `- Gross total (VAT ${t.vatRatePct ?? ''}% included): ${money(t.gross)}` : '',
    terms.validityDays ? `- The offer is valid for ${terms.validityDays} days.` : '',
    terms.leadTime ? `- Lead time: ${terms.leadTime}${terms.leadTimeNote ? ` (${terms.leadTimeNote})` : ''}.` : '',
    terms.deliveryIncluded === true ? '- Delivery is included in the price.' : terms.deliveryIncluded === false ? '- Delivery is NOT included in the price.' : '',
    terms.installation === true ? '- Installation is included in the offer.' : terms.installation === false ? '- Installation is NOT included in the offer.' : '',
  ].filter(Boolean);
  if (termsOut.length) out.push('', 'FACTS — the terms:', ...termsOut);
  const more = String(extra || '').trim();
  if (more) out.push('', `The seller's own wishes for these texts: ${more}`);
  return out.join('\n');
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { intro: { type: 'STRING' }, title: { type: 'STRING' }, subtitle: { type: 'STRING' }, emailSubject: { type: 'STRING' }, emailBody: { type: 'STRING' } },
  required: ['intro', 'title', 'subtitle', 'emailSubject', 'emailBody'],
};

/** The request body (exported for the tests): JSON out, by the schema. */
export function offerTextRequestBody(prompt) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.7 },
  };
}

// a text cleaned of what the rules forbid but a model still does now and then: markdown emphasis, a greeting / closing
// line it was told not to write, trailing spaces
const clean = (s) =>
  String(s || '')
    .replace(/\*\*|__/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The texts out of a generateContent response, or null. */
export function offerTextFromResponse(json) {
  const text = (json?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || '').join('');
  if (!text) return null;
  let data;
  try {
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const body = clean(data.emailBody)
    .replace(/^(szanown\w+|dzień dobry|sehr geehrte\w*|guten tag|dear|hello)[^\n]*\n+/i, '')
    .replace(/\n+(z poważaniem|pozdrawiam|mit freundlichen|viele grüße|kind regards|best (wishes|regards))[\s\S]*$/i, '')
    .trim();
  const out = { intro: clean(data.intro), title: clip(clean(data.title), AI_TITLE_MAX_CHARS), subtitle: clip(clean(data.subtitle), AI_TITLE_MAX_CHARS), emailSubject: clean(data.emailSubject).replace(/\n/g, ' '), emailBody: body };
  return out.intro || out.emailBody ? out : null;
}

/**
 * Sends the prompt, gets the texts back.
 * @returns {Promise<{intro, title, subtitle, emailSubject, emailBody}>}
 * @throws Error with a code message: no-key | http-<status> | blocked | no-text | network
 */
export async function requestOfferText({ apiKey, model = AI_TEXT_MODEL_DEFAULT, prompt, fetchImpl = globalThis.fetch, signal } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('no-key');
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(String(model || AI_TEXT_MODEL_DEFAULT).trim())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(offerTextRequestBody(prompt)),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('network');
  }
  if (!res.ok) throw new Error(`http-${res.status}`);
  const json = await res.json();
  const out = offerTextFromResponse(json);
  if (out) return out;
  if (json?.promptFeedback?.blockReason || (json?.candidates || []).some((c) => /SAFETY|PROHIBITED|BLOCK/i.test(c?.finishReason || ''))) throw new Error('blocked');
  throw new Error('no-text');
}

/** What to tell the user (Polish). */
export function offerTextErrorMessage(e) {
  const m = String(e?.message || e);
  if (m === 'no-text') return 'Model nie zwrócił tekstu — spróbuj jeszcze raz.';
  if (m === 'blocked') return 'Model odmówił odpowiedzi (filtr bezpieczeństwa) — zmień dopiski.';
  if (m === 'http-401' || m === 'http-403') return 'Klucz nie ma dostępu do tego modelu — sprawdź klucz i nazwę modelu w Google AI Studio.';
  return aiErrorMessage(e);
}

/** The greeting line — local, never sent. */
export function salutationLine(kind = 'plural', name = '', language = 'pl') {
  const s = AI_SALUTATIONS[kind] || AI_SALUTATIONS.plural;
  const n = String(name || '').trim();
  if (language === 'en' && !n && s.enBare) return s.enBare;
  const line = s[language] || s.pl;
  return line.replace(/ ?\{name\}/, n ? ` ${n}` : '');
}

/** The signature: the offer's handler, the company, its phone / e-mail / www (the handler's own first) — local. */
export function signatureLines(company = {}, language = 'pl') {
  const c = company || {};
  const phone = c.contactPhone || c.phone;
  return [c.contactName, c.name, phone ? `${PHONE[language] || PHONE.pl} ${phone}` : '', c.contactEmail || c.email, c.www].map((s) => String(s || '').trim()).filter(Boolean);
}

/** The whole e-mail: greeting, the model's body, the closing and the signature. */
export function composeEmail({ body = '', salutation = 'plural', name = '', language = 'pl', tone = 'formal', company = {} } = {}) {
  const closing = (CLOSINGS[tone] || CLOSINGS.formal)[language] || CLOSINGS.formal.pl;
  const sign = signatureLines(company, language);
  return [salutationLine(salutation, name, language), '', String(body || '').trim(), '', closing, ...sign].join('\n');
}

/** A mailto: link for the client's own mail program (the user sends it there). */
export function mailtoHref({ to = '', subject = '', body = '' } = {}) {
  const q = [subject ? `subject=${encodeURIComponent(subject)}` : '', body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&');
  return `mailto:${encodeURIComponent(String(to || '').trim()).replace(/%40/g, '@')}${q ? `?${q}` : ''}`;
}
