import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, round2 } from '../format.js';

test('escapeHtml: every markup character, null/undefined as empty text', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(12.5), '12.5');
});

test('round2: to grosze', () => {
  assert.equal(round2(10.123), 10.12);
  assert.equal(round2(-3.456), -3.46);
});
