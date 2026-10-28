// The model 3D FOR THE CLIENT (user request 2026-10-28): only the geometry and its look — never the designer's code,
// parameters or prices.
//  - HTML: one self-contained file — the client's own small viewer (viewer/clientViewer.js, bundled on its own,
//    vite.config.js `clientViewerRuntime`) + the model (GLB, base64) + the logo, the title and a few facts; opens in any
//    browser, on a phone too, offline; with a tape measure;
//  - GLB: the model alone (Windows 3D Viewer, Android 3D / AR apps, any 3D program);
//  - USDZ: the model alone for iPhone / iPad (Quick Look: 3D and AR — the stair "in the room").
// The scene is a clone of what the designer shows (the stair root, optionally the stairwell's walls and slab tagged
// `viewerLayer: 'room'`) with no traceability data, every stair layer shown, scaled to METRES (glTF / USDZ / AR units).

import * as THREE from 'three';

const MM_TO_M = 0.001;

/**
 * The scene the client gets: the stair (every layer, whatever the designer has hidden), plus the stairwell's walls and
 * the slab as the 'room' layer; in metres; userData reduced to the layer tag.
 * @param {{root: THREE.Object3D, room?: (THREE.Object3D|null)[]}} parts
 */
export function buildClientScene({ root, room = [] }) {
  const scene = new THREE.Group();
  scene.name = 'Schody';
  // (materials cloned too: the clone keeps the look it has NOW — the designer's selection highlight is put back on the
  // originals right after)
  const own = (o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  };
  const stair = root.clone(true);
  stair.traverse((o) => {
    o.visible = true;
    o.userData = {};
    own(o);
  });
  scene.add(stair);
  for (const r of room) {
    if (!r) continue;
    const c = r.clone(true);
    c.traverse((o) => {
      o.visible = true;
      o.userData = { viewerLayer: 'room' };
      own(o);
    });
    scene.add(c);
  }
  scene.scale.setScalar(MM_TO_M);
  scene.updateMatrixWorld(true);
  return scene;
}

/** The scene as GLB (binary glTF, textures inside). */
export async function sceneToGLB(scene) {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  return new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
}

/** The scene as USDZ (iPhone / iPad Quick Look, AR on a horizontal plane). */
export async function sceneToUSDZ(scene) {
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
  return new USDZExporter().parseAsync(scene, { quickLookCompatible: true, maxTextureSize: 2048 });
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The client's HTML file: the data (`#stair-data`, JSON — the `</` inside it escaped so it cannot close the script) and
 * the viewer's runtime. Pure: strings in, a string out.
 * @param {{glbBase64:string, title:string, logo?:string|null, facts?:[string,string][], runtime:string}} p
 */
export function clientViewerHTML({ glbBase64, title, logo = null, facts = [], runtime }) {
  const data = JSON.stringify({ glb: glbBase64, title, logo, facts }).replace(/<\//g, '<\\/');
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<script type="application/json" id="stair-data">${data}</script>
<script>${String(runtime).replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

/** The facts shown in the client's viewer: the stair's main sizes (no prices). */
export function clientFacts(models) {
  const c = models?.fullConfig || {};
  const d = models?.derived || {};
  const typeName = { straight: 'proste', L: 'L (zabiegowe / z podestem)', U: 'U', S: 'S' }[c.stairType] || c.stairType;
  const facts = [
    ['Typ schodów', typeName],
    ['Wysokość kondygnacji', `${Math.round(c.totalRise)} mm`],
    ['Liczba stopni', String(d.numTreads ?? models?.treadModels?.length ?? '')],
    ['Wysokość stopnia', `${Number(d.riserHeight || 0).toFixed(1).replace('.', ',')} mm`],
    ['Głębokość stopnia', `${Math.round(c.treadGoing)} mm`],
    ['Szerokość biegu', `${Math.round(c.stairWidth)} mm`],
  ];
  return facts.filter(([, v]) => v && !/NaN|undefined/.test(v));
}
