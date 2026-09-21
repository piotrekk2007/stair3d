import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const ORTHO_VIEW_HEIGHT_MM = 6000; // wysokość widocznego obszaru kamery ortogonalnej przy zoom = 1

// Wyliczenie ustawienia kamery dla widoków standardowych. To czysta matematyka KAMERY (gdzie
// stanąć i na co patrzeć), nie geometria schodów — dostaje gotowy środek i rozmiar bryły.
// Układ świata: x = plan x, y = wysokość, z = -plan y (patrz geometry/geometryUtils.js planToWorld).
export function computeStandardView(view, center, radius) {
  const d = radius * 2.4;
  const dirs = {
    front: new THREE.Vector3(0, 0.05, 1), // patrzymy od strony +Z (dół planu) w stronę biegu
    back: new THREE.Vector3(0, 0.05, -1),
    right: new THREE.Vector3(1, 0.05, 0),
    left: new THREE.Vector3(-1, 0.05, 0),
    top: new THREE.Vector3(0.0001, 1, 0.0001), // niemal pionowo — dokładnie pionowo OrbitControls się degeneruje
    iso: new THREE.Vector3(0.75, 0.55, 0.85),
  };
  const dir = (dirs[view] ?? dirs.iso).clone().normalize();
  return { position: center.clone().add(dir.multiplyScalar(d)), target: center.clone() };
}

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f5);

  const initialW = container.clientWidth || window.innerWidth;
  const initialH = container.clientHeight || window.innerHeight;

  const perspectiveCamera = new THREE.PerspectiveCamera(50, initialW / initialH, 10, 50000);
  perspectiveCamera.position.set(4000, 3000, 4500);

  const aspect0 = initialW / initialH;
  const orthoCamera = new THREE.OrthographicCamera(
    (-ORTHO_VIEW_HEIGHT_MM * aspect0) / 2,
    (ORTHO_VIEW_HEIGHT_MM * aspect0) / 2,
    ORTHO_VIEW_HEIGHT_MM / 2,
    -ORTHO_VIEW_HEIGHT_MM / 2,
    -20000,
    50000
  );
  orthoCamera.position.copy(perspectiveCamera.position);

  let activeCamera = perspectiveCamera;

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

  const controls = new OrbitControls(perspectiveCamera, renderer.domElement);
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

  // Podłoga do trybu prezentacji (etap 10, sekcja 17) — widoczna tylko w client mode; czysto
  // wizualna, nie należy do modelu schodów.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ color: 0xdcd8d0, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  ground.receiveShadow = true;
  ground.visible = false;
  scene.add(ground);

  function onResize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();
    orthoCamera.left = (-ORTHO_VIEW_HEIGHT_MM * aspect) / 2;
    orthoCamera.right = (ORTHO_VIEW_HEIGHT_MM * aspect) / 2;
    orthoCamera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(container);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, activeCamera);
    labelRenderer.render(scene, activeCamera);
  }
  animate();

  function setCameraMode(mode) {
    const next = mode === 'orthographic' ? orthoCamera : perspectiveCamera;
    if (next === activeCamera) return;
    next.position.copy(activeCamera.position);
    next.quaternion.copy(activeCamera.quaternion);
    if (next === orthoCamera) {
      // dobierz zoom tak, żeby widok ortogonalny pokazywał mniej więcej to samo co perspektywa
      const dist = activeCamera.position.distanceTo(controls.target);
      const visibleHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov / 2));
      orthoCamera.zoom = ORTHO_VIEW_HEIGHT_MM / Math.max(visibleHeight, 1);
      orthoCamera.updateProjectionMatrix();
    }
    activeCamera = next;
    controls.object = next;
    controls.update();
  }

  // center/radius: środek i promień otaczający bryły schodów, policzone przez wywołującego z
  // już-rozwiązanego modelu (planLayout.bounds + totalRise) — tu tylko ustawiamy kamerę.
  function frameView(view, center, radius) {
    const { position, target } = computeStandardView(view, center, radius);
    activeCamera.position.copy(position);
    controls.target.copy(target);
    if (activeCamera === orthoCamera) {
      orthoCamera.zoom = ORTHO_VIEW_HEIGHT_MM / (radius * 2.6);
      orthoCamera.updateProjectionMatrix();
    }
    activeCamera.lookAt(target);
    controls.update();
  }

  return {
    scene,
    camera: perspectiveCamera,
    getCamera: () => activeCamera,
    getCameraMode: () => (activeCamera === orthoCamera ? 'orthographic' : 'perspective'),
    setCameraMode,
    frameView,
    renderer,
    controls,
    labelRenderer,
    helpers: { grid, axes, ground },
    setBackground: (hex) => {
      scene.background = new THREE.Color(hex);
    },
  };
}
