import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f5);

  const initialW = container.clientWidth || window.innerWidth;
  const initialH = container.clientHeight || window.innerHeight;

  const camera = new THREE.PerspectiveCamera(50, initialW / initialH, 10, 50000);
  camera.position.set(4000, 3000, 4500);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(initialW, initialH);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(initialW, initialH);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(1500, 1200, -1500);
  controls.enableDamping = true;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3000, 5000, 2000);
  dir.castShadow = true;
  scene.add(dir);

  const grid = new THREE.GridHelper(10000, 20, 0xaaaaaa, 0xcccccc);
  scene.add(grid);

  const axes = new THREE.AxesHelper(1000);
  scene.add(axes);

  function onResize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(container);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();

  return { scene, camera, renderer, controls, labelRenderer };
}
