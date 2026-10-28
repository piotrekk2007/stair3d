// The CLIENT'S 3D viewer (user request 2026-10-28): the runtime of the self-contained HTML file the client gets
// ("📦 Model 3D dla klienta"). It is built on its own (vite.config.js `clientViewerRuntime`, an IIFE with three.js
// inside) and pasted into that file — it knows nothing of the designer: no parameters, solvers, prices. It reads the
// data the file carries (`<script type="application/json" id="stair-data">`: the model as GLB in base64, metres,
// Y up; the title, the logo, a few facts) and shows the model: orbit / zoom / pan, standard views, the stairwell's
// walls and slab on / off (meshes with `userData.viewerLayer === 'room'`), and a TAPE MEASURE (two clicks on the
// model — snapped to a corner or an edge of the face hit — the distance, the height difference and the horizontal
// distance, in mm).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { snapHitPoint, measureValues, measureText } from './measure3d.js';

const M_TO_MM = 1000; // the file is in metres

const css = `
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #eef1f4; color: #1f2d3a; }
  #view { position: fixed; inset: 0; }
  #bar { position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgba(255,255,255,0.92); box-shadow: 0 1px 6px rgba(0,0,0,0.12); z-index: 2; flex-wrap: wrap; }
  #bar img { max-height: 40px; max-width: 160px; }
  #bar h1 { font-size: 16px; margin: 0; font-weight: 600; flex: 1 1 auto; }
  #bar button { font: inherit; font-size: 13px; padding: 6px 10px; border: 1px solid #c9d1da; border-radius: 6px; background: #fff; cursor: pointer; }
  #bar button.on { background: #1a5fb4; color: #fff; border-color: #1a5fb4; }
  #facts { position: fixed; left: 12px; bottom: 12px; background: rgba(255,255,255,0.92); border-radius: 8px; padding: 8px 12px; font-size: 13px; box-shadow: 0 1px 6px rgba(0,0,0,0.12); z-index: 2; }
  #facts div { display: flex; justify-content: space-between; gap: 16px; }
  #facts b { font-weight: 600; }
  #hint { position: fixed; right: 12px; bottom: 12px; max-width: 320px; background: rgba(26,95,180,0.92); color: #fff; border-radius: 8px; padding: 8px 12px; font-size: 13px; z-index: 2; display: none; }
  .label { position: fixed; transform: translate(-50%, -50%); background: #fff; border: 1px solid #c0392b; color: #c0392b; border-radius: 6px; padding: 3px 7px; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; z-index: 1; }
  @media (max-width: 640px) { #bar h1 { font-size: 14px; } #facts { font-size: 12px; } }
`;

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function el(tag, attrs = {}, text = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

function start() {
  const data = JSON.parse(document.getElementById('stair-data').textContent);
  document.title = data.title || 'Schody — model 3D';
  const style = el('style');
  style.textContent = css;
  document.head.appendChild(style);

  // --- the page ---
  const bar = el('div', { id: 'bar' });
  if (data.logo) bar.appendChild(el('img', { src: data.logo, alt: '' }));
  bar.appendChild(el('h1', {}, data.title || 'Schody'));
  const buttons = {};
  for (const [id, label] of [['iso', 'Widok'], ['front', 'Przód'], ['side', 'Bok'], ['top', 'Góra'], ['room', 'Ściany i strop'], ['measure', '📏 Miarka'], ['clear', 'Wyczyść pomiary']]) {
    buttons[id] = el('button', { type: 'button' }, label);
    bar.appendChild(buttons[id]);
  }
  document.body.appendChild(bar);
  const host = el('div', { id: 'view' });
  document.body.appendChild(host);
  if (Array.isArray(data.facts) && data.facts.length) {
    const facts = el('div', { id: 'facts' });
    for (const [k, v] of data.facts) {
      const row = el('div');
      row.appendChild(el('span', {}, k));
      row.appendChild(el('b', {}, v));
      facts.appendChild(row);
    }
    document.body.appendChild(facts);
  }
  const hint = el('div', { id: 'hint' }, 'Miarka: kliknij pierwszy punkt na modelu, potem drugi. Punkty przyciągają się do narożników i krawędzi.');
  document.body.appendChild(hint);

  // --- the scene ---
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-5, 3, -4);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const model = new THREE.Group();
  scene.add(model);
  const roomMeshes = [];
  let box = new THREE.Box3();
  let roomOn = true;

  new GLTFLoader().parse(base64ToArrayBuffer(data.glb), '', (gltf) => {
    model.add(gltf.scene);
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.userData?.viewerLayer === 'room') roomMeshes.push(o);
    });
    // the grid on the floor, the size of the stair
    const stairBox = new THREE.Box3();
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.userData?.viewerLayer !== 'room') stairBox.expandByObject(o);
    });
    box = stairBox.isEmpty() ? new THREE.Box3().setFromObject(gltf.scene) : stairBox;
    const size = box.getSize(new THREE.Vector3());
    const grid = new THREE.GridHelper(Math.ceil(Math.max(size.x, size.z) * 2), Math.ceil(Math.max(size.x, size.z) * 2) * 4, 0xb7c0ca, 0xd5dbe1);
    grid.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.001, (box.min.z + box.max.z) / 2);
    scene.add(grid);
    setView('iso');
    setRoom(roomMeshes.length > 0);
    if (!roomMeshes.length) buttons.room.style.display = 'none';
  }, (err) => {
    host.textContent = `Nie udało się wczytać modelu: ${err?.message || err}`;
  });

  function setView(kind) {
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.5, box.getSize(new THREE.Vector3()).length() * 0.85);
    const dir = { iso: new THREE.Vector3(1, 0.8, 1.2), front: new THREE.Vector3(0, 0.15, 1), side: new THREE.Vector3(1, 0.15, 0), top: new THREE.Vector3(0.0001, 1, 0.0001) }[kind].normalize();
    camera.position.copy(c).addScaledVector(dir, r * 1.6);
    controls.target.copy(c);
    controls.update();
  }
  function setRoom(on) {
    roomOn = on;
    for (const m of roomMeshes) m.visible = on;
    buttons.room.classList.toggle('on', on);
  }

  // --- the tape measure ---
  let measuring = false;
  let first = null;
  const measures = []; // {a, b, line, dots, label}
  const dotGeo = new THREE.SphereGeometry(1, 16, 12);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xc0392b, depthTest: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xc0392b, depthTest: false });
  const raycaster = new THREE.Raycaster();
  const dotSize = () => Math.max(0.004, camera.position.distanceTo(controls.target) * 0.006);
  const toScreen = (p) => {
    const v = p.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
  };
  function addDot(p) {
    const d = new THREE.Mesh(dotGeo, dotMat);
    d.position.copy(p);
    d.renderOrder = 10;
    d.scale.setScalar(dotSize());
    scene.add(d);
    return d;
  }
  // the point clicked, snapped onto a corner of the face hit, else onto its nearest edge, when close on screen
  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = [];
    model.traverse((o) => {
      if (o.isMesh && o.visible && (roomOn || o.userData?.viewerLayer !== 'room')) targets.push(o);
    });
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return snapHitPoint(hit, { x: ev.clientX, y: ev.clientY }, toScreen);
  }
  const describe = (a, b) => measureText(measureValues(a, b, M_TO_MM));
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    down = { x: ev.clientX, y: ev.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!measuring || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    const p = pick(ev);
    if (!p) return;
    if (!first) {
      first = { p, dot: addDot(p) };
      return;
    }
    const geo = new THREE.BufferGeometry().setFromPoints([first.p, p]);
    const line = new THREE.Line(geo, lineMat);
    line.renderOrder = 9;
    scene.add(line);
    const label = el('div', { class: 'label' }, describe(first.p, p));
    document.body.appendChild(label);
    measures.push({ a: first.p, b: p, line, dots: [first.dot, addDot(p)], label });
    first = null;
  });
  buttons.measure.addEventListener('click', () => {
    measuring = !measuring;
    buttons.measure.classList.toggle('on', measuring);
    hint.style.display = measuring ? 'block' : 'none';
    if (!measuring && first) {
      scene.remove(first.dot);
      first = null;
    }
  });
  buttons.clear.addEventListener('click', () => {
    for (const m of measures) {
      scene.remove(m.line, ...m.dots);
      m.label.remove();
    }
    measures.length = 0;
    if (first) scene.remove(first.dot);
    first = null;
  });
  for (const v of ['iso', 'front', 'side', 'top']) buttons[v].addEventListener('click', () => setView(v));
  buttons.room.addEventListener('click', () => setRoom(!roomOn));

  function resize() {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    const s = dotSize();
    for (const m of measures) {
      m.dots.forEach((d) => d.scale.setScalar(s));
      const mid = m.a.clone().add(m.b).multiplyScalar(0.5);
      const at = toScreen(mid);
      m.label.style.display = at.behind ? 'none' : 'block';
      m.label.style.left = `${at.x}px`;
      m.label.style.top = `${at.y}px`;
    }
    if (first) first.dot.scale.setScalar(s);
    renderer.render(scene, camera);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
