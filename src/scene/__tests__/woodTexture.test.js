import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { generateOakPixels, oakLuminance, periodicNoise, OAK_TEXTURE_SIZE } from '../woodTexture.js';
import { principalAxis, withWoodGrainUVs, applyWoodGrainToTree, textureOffsetFor } from '../woodGrain.js';
import { defaultAppearance, sanitizeAppearance, applyAppearanceToMaterials, FINISHES, finishKey, APPEARANCE_ELEMENTS } from '../appearance.js';
import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';

test('oak texture: deterministic, the right size, in range, with visible contrast', () => {
  const a = generateOakPixels({ width: 128, height: 32 });
  const b = generateOakPixels({ width: 128, height: 32 });
  assert.equal(a.data.length, 128 * 32 * 4);
  assert.deepEqual(a.data, b.data);
  const lum = [];
  for (let i = 0; i < a.data.length; i += 4) {
    assert.equal(a.data[i + 3], 255);
    lum.push(a.data[i]);
  }
  const min = Math.min(...lum);
  const max = Math.max(...lum);
  assert.ok(min >= 0.42 * 255 - 1 && max <= 255);
  assert.ok(max - min > 40, `grain must be visible (${min}..${max})`);
  assert.ok(a.meanLinearLuminance > 0.5 && a.meanLinearLuminance < 0.95);
  assert.deepEqual(OAK_TEXTURE_SIZE, { width: 1024, height: 256 });
});

test('oak texture tiles without a seam (periodic in both directions)', () => {
  for (const t of [0.03, 0.31, 0.77]) assert.ok(Math.abs(oakLuminance(0, t) - oakLuminance(1, t)) < 1e-9, `along, t=${t}`);
  for (const s of [0.1, 0.45, 0.9]) assert.ok(Math.abs(oakLuminance(s, 0) - oakLuminance(s, 1)) < 1e-9, `across, s=${s}`);
  assert.ok(Math.abs(periodicNoise(0.3, 2.7, 4, 3, 1) - periodicNoise(4.3, 5.7, 4, 3, 1)) < 1e-12);
});

test('grain runs along the longest axis: a tread along its width, a post vertically', () => {
  const tread = new THREE.BoxGeometry(900, 40, 270);
  const ax = principalAxis(tread.toNonIndexed().getAttribute('position').array);
  assert.ok(Math.abs(ax.x) > 0.99);
  const post = new THREE.BoxGeometry(100, 2800, 100);
  assert.ok(Math.abs(principalAxis(post.toNonIndexed().getAttribute('position').array).y) > 0.99);
  // on the tread's top face, u changes along x (the grain), v across
  const g = withWoodGrainUVs(tread);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const nrm = g.getAttribute('normal');
  let checked = 0;
  for (let i = 0; i < pos.count; i += 3) {
    if (nrm.getY(i) < 0.99) continue; // top face
    const du = uv.getX(i + 1) - uv.getX(i);
    const dx = pos.getX(i + 1) - pos.getX(i);
    const dz = pos.getZ(i + 1) - pos.getZ(i);
    if (Math.abs(dz) < 1e-6 && Math.abs(dx) > 1) {
      assert.ok(Math.abs(Math.abs(du) - Math.abs(dx) / 1000) < 1e-6, "u in metres of wood along the grain");
      checked++;
    }
  }
  assert.ok(checked > 0);
  assert.equal(uv.count, pos.count);
  assert.equal(g.userData.woodGrainUV, true);
});

test('UVs never move a vertex, keep smooth cylinder normals, and the tree pass skips pre-mapped meshes', () => {
  const cyl = new THREE.CylinderGeometry(20, 20, 900, 16);
  const flat = cyl.toNonIndexed();
  const g = withWoodGrainUVs(cyl);
  assert.deepEqual(Array.from(g.getAttribute('position').array), Array.from(flat.getAttribute('position').array));
  assert.deepEqual(Array.from(g.getAttribute('normal').array), Array.from(flat.getAttribute('normal').array));
  const group = new THREE.Group();
  const plain = new THREE.Mesh(new THREE.BoxGeometry(1000, 40, 300));
  const pre = new THREE.Mesh(g);
  group.add(plain, pre);
  applyWoodGrainToTree(group);
  assert.ok(plain.geometry.getAttribute('uv'));
  assert.equal(pre.geometry, g, 'already mapped (e.g. merged balustrade): left alone');
  assert.ok(plain.castShadow && plain.receiveShadow);
  assert.notDeepEqual(textureOffsetFor('step-1'), textureOffsetFor('step-2'));
});

test('every element of a built staircase gets texture coordinates (and casts shadows)', () => {
  const built = buildStaircase({ ...createDefaultConfig(), hasRiserBoards: true, railingEnabled: true });
  let meshes = 0;
  built.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    assert.ok(o.geometry.getAttribute('uv'), `${o.name} has no uv`);
    assert.ok(o.castShadow, o.name);
  });
  assert.ok(meshes > 20);
});

test('finish per element: the oak photo by default, sanitized, and oak/solid set or clear the texture', () => {
  const def = defaultAppearance();
  for (const { key } of APPEARANCE_ELEMENTS) assert.equal(def[finishKey(key)], FINISHES.OAK_PHOTO);
  const s = sanitizeAppearance({ riserFinish: 'solid', treadFinish: 'plastic', stringerFinish: 'oak' });
  assert.equal(s.riserFinish, 'solid');
  assert.equal(s.treadFinish, 'oakPhoto');
  assert.equal(s.stringerFinish, 'oak');
  const texture = { id: 'oak' };
  const mat = () => ({ color: new THREE.Color(), map: null, bumpMap: null, bumpScale: 1, needsUpdate: false });
  const materials = Object.fromEntries(APPEARANCE_ELEMENTS.map(({ key }) => [key, mat()]));
  applyAppearanceToMaterials(materials, { ...def, riserFinish: 'solid', treadFinish: 'oak', tread: '#d8c39a', riser: '#e8ddc4' }, { texture, meanLuminance: 0.75, bumpScale: 0.6 });
  assert.equal(materials.tread.map, texture);
  assert.equal(materials.tread.bumpMap, texture);
  assert.equal(materials.riser.map, null);
  assert.equal(materials.riser.bumpScale, 0);
  // the oak texture averages 0.75, so the colour is lifted to keep the chosen colour on average — never past 1
  const plain = new THREE.Color('#d8c39a');
  assert.ok(materials.tread.color.r > plain.r);
  assert.ok(Math.max(materials.tread.color.r, materials.tread.color.g, materials.tread.color.b) <= 1 + 1e-9);
  assert.ok(Math.abs(materials.riser.color.r - new THREE.Color('#e8ddc4').r) < 1e-9, 'solid: exactly the chosen colour');
});

test('oak photo finish: the photo in its own colour shows unchanged, another colour stains it', () => {
  const photo = { texture: { id: 'photo' }, meanHex: '#c19f71' };
  const wood = { texture: { id: 'gen' }, meanLuminance: 0.75, bumpScale: 0.6, photo };
  const mat = () => ({ color: new THREE.Color(), map: null, bumpMap: null, bumpScale: 1, needsUpdate: false });
  const materials = Object.fromEntries(APPEARANCE_ELEMENTS.map(({ key }) => [key, mat()]));
  applyAppearanceToMaterials(materials, { ...defaultAppearance(), tread: '#c19f71', post: '#5a3d24' }, wood);
  assert.equal(materials.tread.map, photo.texture);
  for (const c of ['r', 'g', 'b']) assert.ok(Math.abs(materials.tread.color[c] - 1) < 1e-6, 'photo colour -> white tint = the photo as it is');
  assert.equal(materials.post.map, photo.texture);
  assert.ok(materials.post.color.r < 1 && materials.post.color.b < materials.post.color.r, 'a darker colour stains the photo darker');
  // without the photo available (e.g. node), the photo finish falls back to the generated oak, never to nothing
  const m2 = Object.fromEntries(APPEARANCE_ELEMENTS.map(({ key }) => [key, mat()]));
  applyAppearanceToMaterials(m2, defaultAppearance(), { ...wood, photo: null });
  assert.equal(m2.tread.map, wood.texture);
});
