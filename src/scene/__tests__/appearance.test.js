import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultAppearance, sanitizeAppearance, applyAppearanceToMaterials, DEFAULT_APPEARANCE, COLOR_PRESETS } from '../appearance.js';
import { createDefaultConfig } from '../../config/schema.js';
import { buildProjectPayload, parseProjectFile } from '../../project/projectIO.js';

test('sanitizeAppearance keeps valid #rrggbb colours (lower-cased) and falls back to defaults for anything else', () => {
  const out = sanitizeAppearance({ riser: '#FFFFFF', tread: 'red', stringer: 42, post: '#12345', extra: '#000000' });
  assert.equal(out.riser, '#ffffff');
  assert.equal(out.tread, DEFAULT_APPEARANCE.tread);
  assert.equal(out.stringer, DEFAULT_APPEARANCE.stringer);
  assert.equal(out.post, DEFAULT_APPEARANCE.post);
  assert.equal('extra' in out, false);
  assert.deepEqual(sanitizeAppearance(null), defaultAppearance());
  assert.deepEqual(sanitizeAppearance('x'), defaultAppearance());
});

test('every preset is a valid colour', () => {
  for (const p of COLOR_PRESETS) assert.match(p.hex, /^#[0-9a-f]{6}$/i, p.id);
});

test('the balusters have their own colour, separate from the handrail', () => {
  const mk = () => ({ color: { value: null, set(v) { this.value = v; } } });
  const materials = { railing: mk(), baluster: mk() };
  applyAppearanceToMaterials(materials, { railing: '#f4f4f2', baluster: '#1a1a1a' });
  assert.equal(materials.railing.color.value, '#f4f4f2');
  assert.equal(materials.baluster.color.value, '#1a1a1a');
  // an older project file without the key gets the default
  assert.equal(sanitizeAppearance({ railing: '#ffffff' }).baluster, DEFAULT_APPEARANCE.baluster);
});

test('applyAppearanceToMaterials sets each element\'s colour on its own material only', () => {
  const mk = () => ({ color: { value: null, set(v) { this.value = v; } } });
  const materials = { tread: mk(), riser: mk(), stringer: mk(), post: mk() };
  applyAppearanceToMaterials(materials, { riser: '#111111' });
  assert.equal(materials.riser.color.value, '#111111');
  assert.equal(materials.tread.color.value, DEFAULT_APPEARANCE.tread);
  assert.equal(materials.post.color.value, DEFAULT_APPEARANCE.post);
});

test('project file: appearance round-trips at the top level; an older file without it loads with the defaults', () => {
  const config = createDefaultConfig();
  const payload = buildProjectPayload(config, { appearance: { ...defaultAppearance(), riser: '#f4f4f2' } });
  assert.equal(payload.appearance.riser, '#f4f4f2');
  assert.equal('appearance' in payload.config, false, 'appearance must stay outside config');
  const loaded = parseProjectFile(JSON.stringify(payload));
  assert.equal(loaded.meta.appearance.riser, '#f4f4f2');

  const old = { ...payload };
  delete old.appearance;
  assert.deepEqual(parseProjectFile(JSON.stringify(old)).meta.appearance, defaultAppearance());
});

test('the default natural oak is warmer than the oak photo itself (more red, less blue) and is the "Dąb naturalny" preset', async () => {
  const { OAK_NATURAL_COLOR, OAK_PHOTO_COLOR } = await import('../appearance.js');
  const rgb = (hex) => hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  const [nr, , nb] = rgb(OAK_NATURAL_COLOR);
  const [pr, , pb] = rgb(OAK_PHOTO_COLOR);
  assert.ok(nr - nb > pr - pb, 'warmer: a bigger red-blue gap');
  assert.equal(DEFAULT_APPEARANCE.tread, OAK_NATURAL_COLOR);
  assert.equal(COLOR_PRESETS.find((p) => p.id === 'oak-natural').hex, OAK_NATURAL_COLOR);
  assert.equal(COLOR_PRESETS.find((p) => p.id === 'oak-photo').hex, OAK_PHOTO_COLOR, 'the exact photo colour stays available');
});
