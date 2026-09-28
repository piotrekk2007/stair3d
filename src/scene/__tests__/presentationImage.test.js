import test from 'node:test';
import assert from 'node:assert/strict';

import { logoRect, presentationFileName, sanitizeLogoSettings, defaultLogoSettings, LOGO_SIZE_PCT, LOGO_CORNERS } from '../presentationImage.js';

test('logo: width = size % of the image, aspect kept, in the chosen corner with a margin', () => {
  const r = logoRect({ imageWidth: 2000, imageHeight: 1000, logoWidth: 400, logoHeight: 100, corner: 'bottom-right', sizePct: 20 });
  assert.equal(r.width, 400);
  assert.equal(r.height, 100);
  assert.equal(r.x, 2000 - 30 - 400); // margin = 3 % of the shorter side
  assert.equal(r.y, 1000 - 30 - 100);
  const tl = logoRect({ imageWidth: 2000, imageHeight: 1000, logoWidth: 400, logoHeight: 100, corner: 'top-left', sizePct: 20 });
  assert.deepEqual([tl.x, tl.y], [30, 30]);
  // the same settings on the screen (half the size) give exactly half the rectangle — what you see is what you save
  const screen = logoRect({ imageWidth: 1000, imageHeight: 500, logoWidth: 400, logoHeight: 100, corner: 'bottom-right', sizePct: 20 });
  assert.deepEqual([screen.x * 2, screen.y * 2, screen.width * 2, screen.height * 2], [r.x, r.y, r.width, r.height]);
});

test('logo: a very tall logo is capped at 40 % of the image height', () => {
  const r = logoRect({ imageWidth: 2000, imageHeight: 1000, logoWidth: 100, logoHeight: 400, corner: 'top-right', sizePct: 30 });
  assert.equal(r.height, 400);
  assert.equal(r.width, 100);
  assert.ok(r.x + r.width <= 2000 && r.y >= 0);
});

test('logo settings: only valid values survive (data URL of an image, known corner, size clamped)', () => {
  assert.deepEqual(sanitizeLogoSettings(null), defaultLogoSettings());
  const s = sanitizeLogoSettings({ dataUrl: 'data:image/png;base64,AAAA', corner: 'top-left', sizePct: 999 });
  assert.equal(s.dataUrl, 'data:image/png;base64,AAAA');
  assert.equal(s.corner, 'top-left');
  assert.equal(s.sizePct, LOGO_SIZE_PCT.max);
  const bad = sanitizeLogoSettings({ dataUrl: 'javascript:alert(1)', corner: 'middle', sizePct: 'x' });
  assert.equal(bad.dataUrl, null);
  assert.equal(bad.corner, 'bottom-right');
  assert.equal(bad.sizePct, LOGO_SIZE_PCT.default);
  assert.equal(LOGO_CORNERS.length, 4);
});

test('file name: project name without characters files cannot have, plus date and time', () => {
  const d = new Date(2026, 8, 28, 9, 5);
  assert.equal(presentationFileName('Dom Kowalskich: schody/L', d), 'Dom_Kowalskich_schodyL_prezentacja_2026-09-28_0905.png');
  assert.equal(presentationFileName('', d), 'schody_prezentacja_2026-09-28_0905.png');
});
