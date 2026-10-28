import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { buildClientScene, clientViewerHTML, clientFacts, arrayBufferToBase64 } from '../clientModelExport.js';

const built = () => buildStaircase({ ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 3, stairwellRoomEnabled: true });

test("the client's scene (user request 2026-10-28): the stair in METRES with every layer shown and no designer data; the walls / slab as the 'room' layer", () => {
  const b = built();
  // a layer the designer has hidden still goes to the client
  b.root.children[0].visible = false;
  const scene = buildClientScene({ root: b.root, room: [b.ceilingMesh, b.wallsMesh] });
  assert.equal(scene.scale.x, 0.001);
  let meshes = 0;
  let room = 0;
  scene.traverse((o) => {
    assert.equal(o.visible, true);
    if (o.isMesh) {
      meshes++;
      if (o.userData.viewerLayer === 'room') room++;
      else assert.deepEqual(o.userData, {}, `${o.name}: no traceability data`);
    }
  });
  assert.ok(meshes > 10 && room >= 1);
  // the stair's size in metres (the L: a couple of metres)
  const size = new THREE.Box3().setFromObject(scene.children[0]).getSize(new THREE.Vector3());
  assert.ok(size.y > 2 && size.y < 3.5, `height ${size.y} m`);
  // the clone's materials are its own (the designer's selection highlight cannot reach them)
  const mesh = (root) => { let m = null; root.traverse((o) => { if (!m && o.isMesh) m = o; }); return m; };
  assert.notEqual(mesh(scene.children[0]).material, mesh(b.root).material);
});

test("the client's HTML: the data and the viewer in one file — the data cannot close its script tag, no prices or parameters in it", () => {
  const b = built();
  const html = clientViewerHTML({ glbBase64: arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer), title: 'Dom </script> Kowalskich', logo: null, facts: clientFacts(b), runtime: 'console.log("viewer")' });
  const data = html.match(/<script type="application\/json" id="stair-data">([\s\S]*?)<\/script>/)[1];
  const parsed = JSON.parse(data);
  assert.equal(parsed.glb, 'AQID');
  assert.equal(parsed.title, 'Dom </script> Kowalskich');
  assert.ok(parsed.facts.some(([k]) => k === 'Liczba stopni'));
  assert.ok(!/zł|PLN|cena/i.test(html), 'no prices');
  assert.ok(html.includes('console.log("viewer")'));
});

test("the client's viewer is a program of its own: it imports three.js and its own folder only — never the designer's modules", () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(new URL(`../../viewer/${file}`, import.meta.url), 'utf8');
    for (const [, i] of src.matchAll(/^import .* from '([^']+)';/gm)) {
      if (i === 'three' || i.startsWith('three/examples/')) continue;
      assert.ok(/^\.\/[\w-]+\.js$/.test(i), `${file}: ${i}`);
      visit(i.slice(2));
    }
  };
  visit('clientViewer.js');
  assert.ok(seen.has('measure3d.js'));
});
