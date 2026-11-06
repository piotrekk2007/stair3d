import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPrompt, aiRequestBody, aiResponseImage, requestAiImage, aiErrorMessage, AI_IMAGE_MODEL_DEFAULT } from '../aiRender.js';

// the AI render of the offer's picture (user request 2026-11-06, test): the frame is binding, our wood goes along
const facts = { rows: [['Rodzaj schodów', 'Zabiegowe / kątowe L'], ['Balustrada', 'tak (tralki metalowe)'], ['Drewno', 'Dąb, Klasa Natura'], ['Montaż', 'tak']] };
const IMG = 'data:image/jpeg;base64,AAAA';
const TEX = 'data:image/jpeg;base64,BBBB';

test('the prompt: the frame binding (camera, geometry, counts, materials), our wood as IMAGE 2, the offer\'s facts', () => {
  const p = buildAiPrompt({ facts, interior: 'modern', extra: 'okno po lewej' });
  for (const must of [/camera position/, /same number of steps/, /number and positions of posts, balusters/, /Do not add, remove/, /IMAGE 2 is the exact wood/, /No people, no text/])
    assert.match(p, must);
  assert.match(p, /- Balustrada: tak \(tralki metalowe\)/);
  assert.match(p, /- Drewno: Dąb, Klasa Natura/);
  assert.doesNotMatch(p, /Montaż/, 'not a thing to draw');
  assert.match(p, /Additional wishes: okno po lewej/);
  assert.doesNotMatch(buildAiPrompt({ facts, withTexture: false }), /IMAGE 2/);
  assert.match(buildAiPrompt({ interior: 'studio' }), /photo studio/);
});

test('the request: the prompt, the frame, the texture as inline images, the 9:16 ratio, the key in a header only', async () => {
  const body = aiRequestBody({ prompt: 'P', image: IMG, texture: TEX });
  assert.deepEqual(body.contents[0].parts, [{ text: 'P' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }]);
  assert.deepEqual(body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } });
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: 'CCCC' } }] } }] }) };
  };
  const out = await requestAiImage({ apiKey: ' secret ', prompt: 'P', image: IMG, fetchImpl });
  assert.equal(out, 'data:image/png;base64,CCCC');
  assert.equal(seen.url, `https://generativelanguage.googleapis.com/v1beta/models/${AI_IMAGE_MODEL_DEFAULT}:generateContent`);
  assert.doesNotMatch(seen.url, /secret/, 'never the key in the URL');
  assert.equal(seen.init.headers['x-goog-api-key'], 'secret');
});

test('errors: no key, HTTP statuses, a blocked or empty answer → a Polish message', async () => {
  await assert.rejects(requestAiImage({ apiKey: '', prompt: 'P', image: IMG }), /no-key/);
  await assert.rejects(requestAiImage({ apiKey: 'k', prompt: 'P', image: 'not a data url', fetchImpl: async () => ({}) }), /no-frame/);
  const answer = (status, json = {}) => async () => ({ ok: status === 200, status, json: async () => json });
  await assert.rejects(requestAiImage({ apiKey: 'k', prompt: 'P', image: IMG, fetchImpl: answer(403) }), /http-403/);
  await assert.rejects(requestAiImage({ apiKey: 'k', prompt: 'P', image: IMG, fetchImpl: answer(200, { promptFeedback: { blockReason: 'SAFETY' } }) }), /blocked/);
  await assert.rejects(requestAiImage({ apiKey: 'k', prompt: 'P', image: IMG, fetchImpl: answer(200, { candidates: [{ content: { parts: [{ text: 'no' }] } }] }) }), /no-image/);
  await assert.rejects(requestAiImage({ apiKey: 'k', prompt: 'P', image: IMG, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /network/);
  assert.match(aiErrorMessage(new Error('http-429')), /Limit/);
  assert.match(aiErrorMessage(new Error('no-key')), /klucz/);
  assert.equal(aiResponseImage({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'D' } }] } }] }), 'data:image/jpeg;base64,D');
});
