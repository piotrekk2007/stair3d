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
