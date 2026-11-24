// The "Socha" balustrade (user request 2026-11-24, the user's photos): posts with a plinth 250 mm high and 8 mm wider,
// a shallow flute on each face, a stepped cap; the handrail 70 mm high, its top 60 × 25, the lower part 50 wide; behaves
// as any balustrade; the whole balustrade Socha and a post's own type; the post and the handrail priced on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { sochaPostParts, sochaHandrailOutline, sochaHandrailArea, SOCHA_CAP_HEIGHT_MM } from '../sochaStyle.js';
import { handrailPieceSolid } from '../railingRenderer.js';
import { renderPosts } from '../postRenderer.js';
import { buildPricedMaterialTakeoff, DEFAULT_PRICE_LIST } from '../../takeoff/index.js';

const build = (patch = {}) =>
  buildStaircase({ ...createDefaultConfig(), stairPending: false, openingMode: 'derived', railingEnabled: true, railingSections: [{ id: 'r', side: 'inner', fromStep: 0, toStep: null }], ...patch });
const socha = { railingStyle: 'socha', railingHandrailWidthMm: 60, railingHandrailHeightMm: 70 };

test('the shapes: the plinth 8 mm wider and 250 high, the flutes, the stepped cap; the handrail profile 60/50 × 70', () => {
  const p = sochaPostParts({ sizeMm: 90, bottomZ: 0, topZ: 1200 });
  const widest = p.boxes.reduce((m, b) => Math.max(m, b.x1 - b.x0), 0);
  const base = p.boxes[0];
  assert.deepEqual([base.x1 - base.x0, base.z1 - base.z0], [98, 250], 'the plinth');
  assert.ok(widest > 98, 'the cap wider still');
  assert.equal(p.shaftTopZ, 1200 - SOCHA_CAP_HEIGHT_MM);
  assert.ok(p.frustum && p.frustum.z1 === 1200, 'the bevelled top');
  // the flutes: a strip beside the groove on each face — the shaft's section narrower at the groove's middle
  const atMid = p.boxes.filter((b) => b.z0 < 700 && b.z1 > 700 && b.x0 <= 0 && b.x1 >= 0);
  assert.ok(Math.max(...atMid.map((b) => b.y1)) < 45, 'a groove in the middle of each face');
  // no cap when the handrail runs into it on a mitre
  assert.equal(sochaPostParts({ sizeMm: 90, bottomZ: 0, topZ: 1200, capped: false }).frustum, null);
  const o = sochaHandrailOutline(60, 70);
  assert.equal(o.length, 8);
  assert.deepEqual([Math.min(...o.map((q) => q.w)), Math.max(...o.map((q) => q.w))], [-35, 35]);
  assert.deepEqual([...new Set(o.map((q) => Math.abs(q.u)))].sort((a, b) => a - b), [25, 30], 'the lower part 50, the top 60');
  assert.equal(sochaHandrailArea(60, 70), 60 * 25 + 50 * 45);
});

test('self-supporting: the Socha balustrade — every post Socha, a post\'s own type over it; the handrail\'s stepped profile in 3D', () => {
  assert.ok(build().allPostModels.every((p) => p.style === 'standard'));
  const b = build({ ...socha, manualPostOverrides: { 'post-corner-0': { style: 'standard' } } });
  const styles = Object.fromEntries(b.allPostModels.map((p) => [p.postId, p.style]));
  assert.equal(styles['post-start'], 'socha');
  assert.equal(styles['post-corner-0'], 'standard', 'its own type');
  const sec = b.railingModel.sections[0];
  assert.equal(sec.handrail.shape, 'socha');
  assert.deepEqual(sec.handrail.socha, { bottomWidthMm: 50, topHeightMm: 25 });
  // the handrail's 3D piece: the stepped outline at both ends, the end faces triangulated (6 triangles for 8 corners)
  const solid = handrailPieceSolid(sec.runs[0].pieces[0], sec.handrail);
  assert.equal(solid.start.length, 8);
  // a Socha post's mesh: wider than its section at the plinth / the cap, the plain one not
  const post = b.allPostModels.find((p) => p.postId === 'post-start');
  const plain = b.allPostModels.find((p) => p.postId === 'post-corner-0');
  const width = (m) => {
    const box = new THREE.Box3().setFromObject(m);
    return Math.round(box.max.x - box.min.x);
  };
  const g = renderPosts([post, plain], new THREE.MeshBasicMaterial());
  assert.ok(width(g.children[0]) > post.size, 'the plinth and the cap wider');
  assert.equal(width(g.children[1]), plain.size);
});

test('self-supporting takeoff: the Socha post and handrail priced on their own (per piece / per mb)', () => {
  const b = build(socha);
  const priceList = DEFAULT_PRICE_LIST.map((p) => ({ ...p, price: p.materialId === 'railing-post-socha' ? 900 : p.materialId === 'railing-handrail-socha' ? 300 : p.price }));
  const t = buildPricedMaterialTakeoff(b, { priceList });
  const items = t.items || t;
  const posts = items.filter((i) => i.materialId === 'railing-post-socha');
  assert.equal(posts.length, b.postModels.length, 'every post a Socha one');
  assert.ok(posts.every((i) => i.calculatedCost === 900), JSON.stringify(posts.map((i) => [i.calculatedCost, i.notes])));
  const rails = items.filter((i) => i.materialId === 'railing-handrail-socha');
  assert.ok(rails.length > 0);
  for (const r of rails) assert.ok(Math.abs(r.calculatedCost - (300 * r.calculatedDimensions.lengthMm) / 1000) < 0.05);
  assert.ok(!items.some((i) => i.materialId === 'railing-handrail'), 'no plain handrail');
});
