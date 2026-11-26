// „✨ Tekst oferty i mail (AI)” (DOM; user request 2026-11-26, both modules' „Oferta”): a floating panel that sends the
// offer's facts, lines and terms to Google's text model (offer/aiOfferText.js) and shows what comes back — the offer's
// „Wstęp” (put into the offer with one click), a title / subtitle for the modern style and the e-mail to the client
// (greeting + body + closing + signature; copied, or opened in the user's own mail program). Nothing personal is sent:
// the greeting's name is typed here and kept in this session only, the signature comes from the company data.
//
// The API key is the one of the AI render (localStorage 'stair3d.ai', read / written field by field so the two panels
// never overwrite each other's settings); this panel's own settings are 'stair3d.aiText'.

import {
  buildOfferTextPrompt,
  requestOfferText,
  offerTextErrorMessage,
  composeEmail,
  mailtoHref,
  AI_TEXT_MODEL_DEFAULT,
  AI_TEXT_LANGUAGES,
  AI_TEXT_TONES,
  AI_TEXT_LENGTHS,
  AI_SALUTATIONS,
} from '../offer/aiOfferText.js';
import { hasInstallation } from '../offer/offerDocumentModern.js';
import { escapeHtml as esc } from '../util/format.js';

const KEY_STORE = 'stair3d.ai';
const PREFS_STORE = 'stair3d.aiText';
const DEFAULTS = { model: '', tone: 'formal', length: 'short', language: 'pl', salutation: 'plural', extra: '' };

const readJson = (k) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const writeJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // (kept until the tab is closed)
  }
};
const readKey = () => String(readJson(KEY_STORE).key || '');
const writeKey = (key) => writeJson(KEY_STORE, { ...readJson(KEY_STORE), key });

/**
 * @param {Object} o
 * @param {() => ({kind: 'stair'|'cladding', facts: Object, offer: Object, settings: Object, company: Object}|null)} o.getContext
 *   the module's current offer: its facts ({rows}), its built offer ({lines, totals}), its offer settings (number,
 *   validity, lead time, delivery, style, client's e-mail) and the company data (the signature)
 * @param {(patch: {intro?: string, offerTitle?: string, offerSubtitle?: string}) => void} o.onApply  into the offer
 */
export function createAiOfferTextPanel({ getContext, onApply }) {
  const panel = document.createElement('div');
  panel.className = 'ai-panel ai-text-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  const prefs = { ...DEFAULTS, ...readJson(PREFS_STORE) };
  let name = ''; // the greeting's name — this session only, never stored, never sent
  let busy = null;
  let result = null; // {intro, title, subtitle, emailSubject, emailBody}
  let resultLanguage = 'pl';
  let mailEdited = false;
  let promptEdited = false;

  const savePrefs = () => writeJson(PREFS_STORE, Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, prefs[k]])));
  const prompt = () => {
    const ctx = getContext();
    if (!ctx) return '';
    const s = ctx.settings || {};
    return buildOfferTextPrompt({
      kind: ctx.kind,
      facts: ctx.facts || {},
      offer: ctx.offer || {},
      terms: { offerNumber: s.offerNumber, validityDays: s.validityDays, leadTime: s.leadTime, leadTimeNote: s.leadTimeNote, deliveryIncluded: s.deliveryIncluded, installation: ctx.offer ? hasInstallation(ctx.offer, ctx.facts || {}) : undefined },
      tone: prefs.tone,
      length: prefs.length,
      language: prefs.language,
      extra: prefs.extra,
    });
  };
  const mailText = () => (result ? composeEmail({ body: result.emailBody, salutation: prefs.salutation, name, language: resultLanguage, tone: prefs.tone, company: getContext()?.company || {} }) : '');
  const options = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(typeof l === 'string' ? l : l.label)}</option>`).join('');

  function render() {
    const ctx = getContext();
    const modern = ctx?.settings?.offerStyle === 'modern';
    const clientEmail = String(ctx?.settings?.client?.email || '').trim();
    panel.innerHTML = `
      <div class="ai-head"><b>✨ Tekst oferty i mail (AI)</b><button type="button" data-t="close" title="Zamknij">✕</button></div>
      <div class="ai-hint">Do Google idą tylko dane schodów, pozycje oferty, ceny i warunki — bez danych klienta i firmy. Powitanie i podpis dokłada program.</div>
      <label class="ai-row">Klucz Gemini API <input type="password" data-t-key value="${esc(readKey())}" placeholder="z Google AI Studio" autocomplete="off"></label>
      <label class="ai-row">Model <input type="text" data-t-pref="model" value="${esc(prefs.model)}" placeholder="${esc(AI_TEXT_MODEL_DEFAULT)}"></label>
      <label class="ai-row">Ton <select data-t-pref="tone">${options(AI_TEXT_TONES, prefs.tone)}</select></label>
      <label class="ai-row">Długość <select data-t-pref="length">${options(AI_TEXT_LENGTHS, prefs.length)}</select></label>
      <label class="ai-row">Język maila <select data-t-pref="language">${options(AI_TEXT_LANGUAGES, prefs.language)}</select></label>
      <label class="ai-row">Powitanie <select data-t-pref="salutation">${options(AI_SALUTATIONS, prefs.salutation)}</select></label>
      <label class="ai-row" ${prefs.salutation === 'mr' || prefs.salutation === 'mrs' ? '' : 'hidden'}>Nazwisko / imię <input type="text" data-t-name value="${esc(name)}" placeholder="${prefs.language === 'pl' ? 'np. Kowalski albo Janie' : 'np. Kowalski'}" title="Tylko do powitania — nie jest wysyłane do Google ani zapisywane"></label>
      <label class="ai-row ai-col">Dopiski (opcjonalnie) <textarea rows="2" data-t-pref="extra" placeholder="np. podkreśl krótki termin, wspomnij o bezpłatnym pomiarze">${esc(prefs.extra)}</textarea></label>
      <details class="ai-prompt"><summary>Prompt (z oferty — można poprawić)</summary><textarea rows="10" data-t-prompt>${esc(prompt())}</textarea><button type="button" data-t="reprompt">↺ Odtwórz z oferty</button></details>
      <div class="ai-actions">${busy ? '<button type="button" data-t="abort">Przerwij</button><span class="ai-spin">Piszę…</span>' : `<button type="button" class="ai-primary" data-t="send">✨ ${result ? 'Napisz jeszcze raz' : 'Napisz tekst i mail'}</button>`}</div>
      <div class="ai-status" data-t-status></div>
      ${
        result
          ? `<div class="ai-text-block"><b>Wstęp oferty</b> <small>(drukowany na początku oferty)</small>
              <textarea rows="5" data-t-out="intro">${esc(result.intro)}</textarea>
              <div class="ai-actions"><button type="button" class="ai-primary" data-t="use-intro">Wstaw do oferty</button></div></div>
            <div class="ai-text-block"><b>Tytuł i podtytuł</b> <small>(styl nowoczesny${modern ? '' : ' — teraz wybrany klasyczny'})</small>
              <input type="text" data-t-out="title" value="${esc(result.title)}"><input type="text" data-t-out="subtitle" value="${esc(result.subtitle)}">
              <div class="ai-actions"><button type="button" data-t="use-title">Wstaw tytuł i podtytuł</button></div></div>
            <div class="ai-text-block"><b>Mail do klienta</b> <small>(${esc(AI_TEXT_LANGUAGES[resultLanguage])})</small>
              <label class="ai-row">Temat <input type="text" data-t-out="emailSubject" value="${esc(result.emailSubject)}"></label>
              <textarea rows="12" data-t-mail>${esc(mailText())}</textarea>
              <div class="ai-actions"><button type="button" data-t="copy-mail">📋 Kopiuj treść</button><button type="button" data-t="copy-subject">Kopiuj temat</button><button type="button" data-t="mailto" title="${clientEmail ? `Do: ${esc(clientEmail)}` : 'Bez adresata — e-mail klienta wpisz w ofercie'}">✉ Otwórz w poczcie</button></div>
              <div class="ai-hint">PDF oferty dołącz w programie pocztowym. Program niczego nie wysyła sam.</div></div>`
          : ''
      }`;
  }
  const status = (text, bad = false) => {
    const el = panel.querySelector('[data-t-status]');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('bad', bad);
  };
  const outValue = (k) => panel.querySelector(`[data-t-out="${k}"]`)?.value ?? result?.[k] ?? '';
  // what the user corrected in the results stays when the panel is drawn again
  const keepEdits = () => {
    if (!result) return;
    for (const k of ['intro', 'title', 'subtitle', 'emailSubject']) result[k] = outValue(k);
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      status('Skopiowano do schowka.');
    } catch {
      status('Nie udało się skopiować — zaznacz tekst i użyj Ctrl+C.', true);
    }
  };

  async function send() {
    const promptText = promptEdited ? panel.querySelector('[data-t-prompt]').value : prompt();
    keepEdits();
    busy = new AbortController();
    render();
    if (promptEdited) panel.querySelector('[data-t-prompt]').value = promptText;
    try {
      result = await requestOfferText({ apiKey: readKey(), model: prefs.model || AI_TEXT_MODEL_DEFAULT, prompt: promptText, signal: busy.signal });
      resultLanguage = prefs.language;
      mailEdited = false;
      busy = null;
      render();
      status('Gotowe — przeczytaj i popraw, zanim wstawisz lub wyślesz.');
    } catch (e) {
      busy = null;
      render();
      status(offerTextErrorMessage(e), true);
    }
  }

  panel.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-t-key]')) writeKey(t.value.trim());
    else if (t.matches('[data-t-prompt]')) promptEdited = true;
    else if (t.matches('[data-t-mail]')) mailEdited = true;
    else if (t.matches('[data-t-name]')) {
      name = t.value;
      const mail = panel.querySelector('[data-t-mail]');
      if (mail && !mailEdited) mail.value = mailText();
    } else if (t.dataset.tPref && t.tagName !== 'SELECT') {
      prefs[t.dataset.tPref] = t.value;
      savePrefs();
      const ta = panel.querySelector('[data-t-prompt]');
      if (ta && !promptEdited) ta.value = prompt();
    }
  });
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.tPref || t.tagName !== 'SELECT') return;
    prefs[t.dataset.tPref] = t.value;
    savePrefs();
    keepEdits();
    const mail = panel.querySelector('[data-t-mail]')?.value;
    render();
    if (mailEdited && mail != null && panel.querySelector('[data-t-mail]')) panel.querySelector('[data-t-mail]').value = mail;
    if (t.dataset.tPref === 'language' && result && prefs.language !== resultLanguage) status('Język zmieniony — kliknij „Napisz jeszcze raz”, żeby dostać mail w tym języku.');
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const act = b.dataset.t;
    if (act === 'close') close();
    else if (act === 'send') send();
    else if (act === 'abort') busy?.abort();
    else if (act === 'reprompt') {
      promptEdited = false;
      panel.querySelector('[data-t-prompt]').value = prompt();
    } else if (act === 'use-intro') {
      onApply({ intro: outValue('intro').trim() });
      status('Wstęp wstawiony do oferty (pole „Wstęp”).');
    } else if (act === 'use-title') {
      onApply({ offerTitle: outValue('title').trim(), offerSubtitle: outValue('subtitle').trim() });
      status('Tytuł i podtytuł wstawione (styl nowoczesny).');
    } else if (act === 'copy-mail') copy(panel.querySelector('[data-t-mail]').value);
    else if (act === 'copy-subject') copy(outValue('emailSubject'));
    else if (act === 'mailto') {
      const href = mailtoHref({ to: getContext()?.settings?.client?.email || '', subject: outValue('emailSubject'), body: panel.querySelector('[data-t-mail]').value });
      const a = document.createElement('a');
      a.href = href;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });

  function open() {
    panel.hidden = false;
    promptEdited = false;
    render();
  }
  function close() {
    busy?.abort();
    keepEdits();
    panel.hidden = true;
  }
  return { open, close, toggle: () => (panel.hidden ? open() : close()), isOpen: () => !panel.hidden };
}
