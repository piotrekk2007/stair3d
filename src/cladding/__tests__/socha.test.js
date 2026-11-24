// The "Socha" balustrade in the concrete module (user request 2026-11-24, as the self-supporting one): every post Socha
// (a post's own type over it), the stepped handrail; priced on their own; in 3D, the cut list and the production order.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { buildCutList } from '../export/cutList.js';
import { buildProductionOrder } from '../export/productionOrder.js';
import { renderCladdingStair } from '../claddingRenderer.js';

const stair = (patch = {}) =>
  sanitizeCladdingConfig({
    ...createDefaultCladdingConfig(),
    sequence: [{ kind: 'steps', count: 9, riseMm: 180, goingMm: 280, widthMm: 1000 }],
    railingSides: { 0: { right: true } },
    railingStyle: 'socha',
    handrailWidthMm: 60,
    handrailHeightMm: 70,
    ...patch,
  });

test('Socha posts (a post\'s own type over it) and the stepped handrail; priced on their own', () => {
  const plain = buildCladdingStair(stair({ railingStyle: 'standard' })).balustrade.sections[0];
  assert.ok(plain.posts.every((p) => p.style === 'standard'));
  assert.equal(plain.handrailProfile.kind, 'rect');
  const c = stair({ railingPostOverrides: { 'railing-0-right:end': { style: 'standard' } } });
  const b = buildCladdingStair(c);
  const s = b.balustrade.sections[0];
  assert.deepEqual(s.posts.map((p) => p.style), ['socha', 'standard']);
  assert.deepEqual(s.posts[0].socha, { baseHeightMm: 250, baseExtraMm: 8 });
  assert.deepEqual(s.handrailProfile, { kind: 'socha', bottomWidthMm: 50, topHeightMm: 25 });
  const settings = createDefaultQuoteSettings();
  for (const p of settings.priceList) p.price = { 'railing-post-socha': 900, 'railing-handrail-socha': 300, 'railing-handrail': 100 }[p.materialId] ?? p.price;
  const q = buildCladdingQuote(b, settings);
  const sochaPosts = q.lines.find((l) => l.id.endsWith('-posts-socha'));
  assert.equal(sochaPosts.qty, 1);
  assert.equal(sochaPosts.material.value, 900);
  assert.ok(q.lines.some((l) => l.id.endsWith('-posts') && l.qty === 1), 'the plain one from the post table');
  const rail = q.lines.find((l) => l.id.endsWith('-handrail'));
  assert.match(rail.name, /Poręcz Socha/);
  assert.ok(Math.abs(rail.material.value - 300 * rail.qty) < 0.05);
  // the cut list / production order name them
  assert.ok(buildCutList(b).some((r) => /^Słupy Socha/.test(r.name)));
  const order = buildProductionOrder(b, settings);
  assert.ok(order.groups.find((g) => g.title.startsWith('Słupy')).lines.some((l) => /Socha/.test(l.note)));
  assert.ok(order.groups.find((g) => g.title.startsWith('Poręcze')).lines.some((l) => /profil Socha/.test(l.note)));
});

test('3D: the Socha post wider at its plinth and cap, the handrail\'s stepped profile', () => {
  const b = buildCladdingStair(stair());
  const root = renderCladdingStair(b);
  const s = b.balustrade.sections[0];
  let post = null;
  root.traverse((o) => o.name === `Post-${s.posts[0].id}` && (post = o));
  const box = new THREE.Box3().setFromObject(post);
  assert.ok(box.max.x - box.min.x > s.posts[0].size + 5, 'wider than the shaft');
  let rail = null;
  root.traverse((o) => o.name === `Handrail-${s.id}-1` && (rail = o));
  // the stepped profile: 8 corners a ring, two rings + caps → more vertices than a box's 36
  assert.ok(rail.geometry.attributes.position.count > 36);
});
