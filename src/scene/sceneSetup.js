import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Oświetlenie (tylko wizualizacja, wartości dobrane na oko): odbicia z proceduralnego „pokoju" (RoomEnvironment
// z pakietu three — bez nowych zależności i plików), słońce z miękkim cieniem dopasowanym do schodów, słabe
// światło wypełniające i neutralne mapowanie tonów (Khronos PBR Neutral), żeby jasne drewno nie przepalało się i nie szarzało.
const ENVIRONMENT_INTENSITY = 0.45;
const SUN_INTENSITY = 1.7;
const FILL_INTENSITY = 0.45;
const HEMI_INTENSITY = 0.35;
const SHADOW_MAP_SIZE = 2048;

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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; // zachowuje odcień i nasycenie (ACES szarzał jasny dąb)
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

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

  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x5a5048, HEMI_INTENSITY);
  scene.add(hemi);

  // Słońce: ciepłe, z góry-z boku, z cieniem. Kamera cienia jest dopasowywana do schodów (fitShadowToBox).
  const dir = new THREE.DirectionalLight(0xfff1dd, SUN_INTENSITY);
  dir.position.set(3000, 5000, 2000);
  dir.castShadow = true;
  dir.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  dir.shadow.bias = -0.0002;
  dir.shadow.normalBias = 3; // mm
  dir.shadow.radius = 3;
  scene.add(dir);
  scene.add(dir.target);

  // Światło wypełniające z przeciwnej strony (bez cienia), żeby strona schodów w cieniu nie była czarna.
  const fill = new THREE.DirectionalLight(0xdfe8ff, FILL_INTENSITY);
  fill.position.set(-3000, 2500, -4000);
  scene.add(fill);

  // Kamera cienia słońca obejmuje schody (środek + promień bryły), światło stoi zawsze w tym samym kierunku.
  const SUN_DIRECTION = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
  function fitShadowToBox(box) {
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(1000, box.getSize(new THREE.Vector3()).length() / 2);
    dir.target.position.copy(center);
    dir.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 3);
    const cam = dir.shadow.camera;
    cam.left = -radius * 1.2;
    cam.right = radius * 1.2;
    cam.top = radius * 1.2;
    cam.bottom = -radius * 1.2;
    cam.near = radius * 0.5;
    cam.far = radius * 6;
    cam.updateProjectionMatrix();
    shadowCatcher.position.set(center.x, 0.5, center.z);
  }

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

  // Łapacz cienia: niewidoczna podłoga, na której widać tylko cień schodów (w zwykłym widoku 3D, gdzie nie ma
  // podłogi z trybu prezentacji). Nie przeszkadza siatce ani klikaniu (nie jest w currentRoot).
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.ShadowMaterial({ opacity: 0.18 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.5;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

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
    helpers: { grid, axes, ground, shadowCatcher },
    fitShadowToBox,
    // Zdjęcie widoku (tryb prezentacji): jeden render w `scale` razy większej rozdzielczości niż ekran, skopiowany od
    // razu do zwykłego canvasa (bez preserveDrawingBuffer — kopia w tym samym zadaniu co render), potem powrót do
    // normalnej rozdzielczości. Tylko scena 3D — panele i przyciski HUD to HTML obok, więc na zdjęcie nie trafiają.
    captureImage(scale = 2) {
      const prevRatio = renderer.getPixelRatio();
      renderer.setPixelRatio(prevRatio * scale);
      renderer.render(scene, activeCamera);
      const out = document.createElement('canvas');
      out.width = renderer.domElement.width;
      out.height = renderer.domElement.height;
      out.getContext('2d').drawImage(renderer.domElement, 0, 0);
      renderer.setPixelRatio(prevRatio);
      renderer.render(scene, activeCamera);
      return out;
    },
    // Obraz do oferty (offer/): osobna kamera w standardowym widoku (computeStandardView — ta sama matematyka co
    // przyciski widoków), render w zadanym rozmiarze niezależnie od tego, czy panel 3D jest widoczny, potem powrót do
    // rozmiaru ekranu. Kamera użytkownika i jego widok zostają nietknięte.
    renderViewImage({ width, height, view = 'iso', center, radius }) {
      const cam = new THREE.PerspectiveCamera(perspectiveCamera.fov, width / height, perspectiveCamera.near, perspectiveCamera.far);
      const { position, target } = computeStandardView(view, center, radius);
      cam.position.copy(position);
      cam.lookAt(target);
      const prevRatio = renderer.getPixelRatio();
      const prevSize = renderer.getSize(new THREE.Vector2());
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.render(scene, cam);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      out.getContext('2d').drawImage(renderer.domElement, 0, 0, width, height);
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      renderer.render(scene, activeCamera);
      return out;
    },
    setBackground: (hex) => {
      scene.background = new THREE.Color(hex);
    },
  };
}
