import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { claddingClientScene, claddingClientFacts } from '../export/clientModel.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';

// the model 3D for the client (user request 2026-11-05)
const cfg = { ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], walls: { 0: { left: true } }, railingSides: { 0: { right: true } } };

test('client scene: metres, the stair (with its concrete and balustrade) untagged, the walls and the slab as the room layer', () => {
  const b = buildCladdingStair(cfg);
  const scene = claddingClientScene(b);
  assert.equal(scene.scale.x, 0.001);
  const room = [];
  const stair = [];
  scene.traverse((o) => o.isMesh && (o.userData.viewerLayer === 'room' ? room : stair).push(o.name));
  assert.ok(room.includes('Slab'), 'the slab in the room layer');
  assert.ok(room.some((n) => /^wall/i.test(n)), 'the wall in the room layer');
  assert.ok(stair.some((n) => n.startsWith('Tread-')) && stair.some((n) => n.startsWith('Concrete-')) && stair.some((n) => n.startsWith('Handrail-')));
  assert.ok(!stair.includes('Slab'), 'no room in the stair part');
  scene.traverse((o) => assert.ok(o.visible, `${o.name} shown`));
});

test('client facts: the offer\'s stair facts without the installation / VAT terms', () => {
  const b = buildCladdingStair(cfg);
  const facts = claddingClientFacts(b, createDefaultQuoteSettings());
  assert.ok(facts.length >= 5);
  assert.ok(facts.some(([l]) => l === 'Stopnie'));
  assert.ok(!facts.some(([l, v]) => l === 'Montaż' || /VAT|zł/.test(v)));
});
