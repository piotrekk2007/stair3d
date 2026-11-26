// The offer's text and the e-mail to the client by AI (user request 2026-11-26, both modules): the prompt from the
// offer's facts with NO personal data, the request / response, the e-mail put together locally (greeting, closing,
// signature), the offer's „Wstęp” printed in both styles and saved in both modules' offers.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOfferTextPrompt,
  offerTextRequestBody,
  offerTextFromResponse,
  requestOfferText,
  offerTextErrorMessage,
  composeEmail,
  salutationLine,
  signatureLines,
  mailtoHref,
  AI_TITLE_MAX_CHARS,
} from '../aiOfferText.js';
import { buildOfferHTML } from '../offerDocument.js';
import { buildModernOfferHTML } from '../offerDocumentModern.js';
import { createDefaultOfferSettings, sanitizeOfferSettings } from '../offerModel.js';
import { sanitizeCladdingOffer } from '../../cladding/quote/claddingOffer.js';

const facts = { rows: [['Rodzaj schodów', 'Zabiegowe / kątowe L, skręt w prawo'], ['Drewno', 'Dąb, Klasa Natura'], ['Liczba stopni', '15 (wzniosów: 16)']], comfort: [] };
const offer = { lines: [{ kind: 'material', label: 'Schody — materiał wraz z przygotowaniem', detail: 'w tym: stopnie, wangi', net: 20000 }, { kind: 'installation', label: 'Montaż', net: 3000 }], totals: { net: 23000, vat: 5290, gross: 28290, vatRatePct: 23 } };
const client = { name: 'Jan Kowalski', address: 'ul. Lipowa 5, Kraków', phone: '600 100 200', email: 'jan.kowalski@example.pl' };
const company = { name: 'Drewex sp.j.', phone: '22 786 62 98', email: 'biuro@drewex.pl', www: 'www.drewex.pl', contactName: 'Anna Nowak', contactPhone: '501 000 000', contactEmail: 'anna@drewex.pl' };
const reply = (data) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] });

test('the prompt: the facts, the lines, the exact gross total and the terms — never the client\'s or the company\'s people', () => {
  const p = buildOfferTextPrompt({ kind: 'stair', facts, offer, terms: { offerNumber: 'OF/1', validityDays: 14, leadTime: '3–5 tygodni', deliveryIncluded: true, installation: true }, tone: 'friendly', length: 'long', language: 'de', extra: 'podkreśl krótki termin' });
  for (const s of ['Zabiegowe / kątowe L', 'Dąb, Klasa Natura', 'Schody — materiał wraz z przygotowaniem', '28 290,00 zł', 'valid for 14 days', '3–5 tygodni', 'Delivery is included', 'Installation is included', 'OF/1', 'German', 'warm and personal', 'podkreśl krótki termin']) assert.ok(p.includes(s), s);
  for (const s of [client.name, client.email, client.phone, company.contactName, company.email]) assert.ok(!p.includes(s), `never sent: ${s}`);
  assert.match(p, /intro \(in Polish\)/);
  assert.match(p, /Never invent/);
  // the concrete module's offer says what it is about
  assert.match(buildOfferTextPrompt({ kind: 'cladding', facts, offer }), /cladding .* concrete staircase/);
  // the request asks for JSON by the schema
  const body = offerTextRequestBody('x');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema.required, ['intro', 'title', 'subtitle', 'emailSubject', 'emailBody']);
});

test('the response: the texts cleaned — a greeting / closing the model still wrote dropped, markdown out, the title clipped', () => {
  const out = offerTextFromResponse(
    reply({
      intro: 'Przygotowaliśmy dla Państwa **dębowe** schody.',
      title: 'T'.repeat(80),
      subtitle: 'podstopnie białe',
      emailSubject: 'Oferta\nOF/1',
      emailBody: 'Szanowni Państwo,\n\nw załączeniu przesyłamy ofertę.\n\nZ poważaniem\nZespół',
    })
  );
  assert.equal(out.intro, 'Przygotowaliśmy dla Państwa dębowe schody.');
  assert.equal(out.title.length, AI_TITLE_MAX_CHARS);
  assert.equal(out.emailSubject, 'Oferta OF/1');
  assert.equal(out.emailBody, 'w załączeniu przesyłamy ofertę.');
  assert.equal(offerTextFromResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), null);
});

test('the request: the key in a header (never the URL), the errors as codes with Polish messages', async () => {
  let call = null;
  const fetchImpl = async (url, init) => {
    call = { url, init };
    return { ok: true, json: async () => reply({ intro: 'A', title: 'B', subtitle: 'C', emailSubject: 'D', emailBody: 'E' }) };
  };
  const out = await requestOfferText({ apiKey: ' K123 ', prompt: 'p', fetchImpl });
  assert.equal(out.emailBody, 'E');
  assert.match(call.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.ok(!call.url.includes('K123'));
  assert.equal(call.init.headers['x-goog-api-key'], 'K123');
  await assert.rejects(requestOfferText({ apiKey: '', prompt: 'p', fetchImpl }), /no-key/);
  await assert.rejects(requestOfferText({ apiKey: 'k', prompt: 'p', fetchImpl: async () => ({ ok: false, status: 429 }) }), /http-429/);
  await assert.rejects(requestOfferText({ apiKey: 'k', prompt: 'p', fetchImpl: async () => ({ ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }) }), /blocked/);
  assert.match(offerTextErrorMessage(new Error('no-text')), /nie zwrócił tekstu/);
  assert.match(offerTextErrorMessage(new Error('http-429')), /Limit/);
});

test('the e-mail put together locally: the greeting with the typed name, the closing by tone and language, the signature', () => {
  assert.equal(salutationLine('mr', 'Kowalski', 'pl'), 'Szanowny Panie Kowalski,');
  assert.equal(salutationLine('mr', '', 'pl'), 'Szanowny Panie,');
  assert.equal(salutationLine('mrs', '', 'en'), 'Dear Madam,');
  assert.equal(salutationLine('plural', 'x', 'de'), 'Sehr geehrte Damen und Herren,');
  assert.deepEqual(signatureLines(company, 'pl'), ['Anna Nowak', 'Drewex sp.j.', 'tel. 501 000 000', 'anna@drewex.pl', 'www.drewex.pl']);
  assert.deepEqual(signatureLines({ name: 'Firma', phone: '1', email: 'a@b' }, 'de'), ['Firma', 'Tel. 1', 'a@b']);
  const mail = composeEmail({ body: 'W załączeniu oferta.', salutation: 'mrs', name: 'Anno', language: 'pl', tone: 'friendly', company });
  assert.equal(mail, ['Szanowna Pani Anno,', '', 'W załączeniu oferta.', '', 'Pozdrawiam serdecznie', 'Anna Nowak', 'Drewex sp.j.', 'tel. 501 000 000', 'anna@drewex.pl', 'www.drewex.pl'].join('\n'));
  const href = mailtoHref({ to: 'jan@example.pl', subject: 'Oferta & cena', body: 'a\nb' });
  assert.equal(href, 'mailto:jan@example.pl?subject=Oferta%20%26%20cena&body=a%0Ab');
});

test('the „Wstęp” saved in both modules\' offers and printed in both styles: modern — under the title, a long one on sheet 2', () => {
  const intro = 'Przygotowaliśmy dla Państwa schody dębowe <b>na wymiar</b>.';
  assert.equal(sanitizeOfferSettings({ intro }).intro, intro);
  assert.equal(createDefaultOfferSettings().intro, '');
  assert.equal(sanitizeCladdingOffer({ intro }).intro, intro);
  const s = { ...createDefaultOfferSettings(), intro, client };
  const classic = buildOfferHTML({ offer, facts, settings: s, company });
  assert.match(classic, /<p class="intro">Przygotowaliśmy dla Państwa schody dębowe &lt;b&gt;na wymiar&lt;\/b&gt;\.<\/p>/);
  assert.ok(classic.indexOf('class="intro"') < classic.indexOf('<h2>Wycena</h2>'), 'before the prices');
  const modern = (text) => buildModernOfferHTML({ offer, facts, settings: { ...s, offerStyle: 'modern', intro: text }, company, date: new Date(2026, 10, 26) });
  const sheets = (h) => h.split('<section class="sheet');
  const short = sheets(modern(intro));
  assert.ok(short[1].includes('<p class="intro">') && short[1].indexOf('<p class="intro">') < short[1].indexOf('class="spec"'), 'sheet 1, under the title');
  const long = sheets(modern('Długi wstęp. '.repeat(60).trim()));
  assert.ok(!long[1].includes('<p class="intro">'), 'too long for sheet 1');
  assert.ok(long.slice(2).some((p) => p.includes('<p class="intro2">Długi wstęp.')), 'on sheet 2 or in the appendix');
  assert.ok(!sheets(modern('')).join('').includes('class="intro'), 'none when empty');
});
