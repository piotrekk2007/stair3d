// The designer's 3D TAPE MEASURE (user request 2026-10-28, the viewport HUD's "📏 Miarka"): two clicks on the model —
// each snapped onto a corner / an edge of the face hit (viewer/measure3d.js, the same rule as the client's viewer) —
// draw a measure: a red line, two dots and a label with the distance, the height difference and the horizontal
// distance (mm). Several measures stay until "Wyczyść". A view tool only: nothing of it is in the config, the project
// or any export.

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { snapHitPoint, measureValues, measureText } from '../viewer/measure3d.js';

/**
 * @param {{scene: THREE.Scene, getCamera: () => THREE.Camera, domElement: HTMLElement, getTargets: () => THREE.Object3D[]}} opts
 */
export function createMeasureTool({ scene, getCamera, domElement, getTargets }) {
  const group = new THREE.Group();
  group.name = 'MeasureTool';
  scene.add(group);
  const dotGeo = new THREE.SphereGeometry(1, 16, 12);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xc0392b, depthTest: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xc0392b, depthTest: false });
  const raycaster = new THREE.Raycaster();
  let active = false;
  let first = null; // {p, dot}
  const dots = [];

  const toScreen = (p) => {
    const v = p.clone().project(getCamera());
    const rect = domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  };
  // a dot a few px on screen, whatever the zoom
  const dotSize = (p) => {
    const cam = getCamera();
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / Math.max(1, domElement.clientHeight) * 4;
    return Math.max(1, cam.position.distanceTo(p) * 0.004);
  };
  function addDot(p) {
    const d = new THREE.Mesh(dotGeo, dotMat);
    d.position.copy(p);
    d.renderOrder = 20;
    d.scale.setScalar(dotSize(p));
    group.add(d);
    dots.push(d);
    return d;
  }
  const isShown = (o) => {
    for (let x = o; x; x = x.parent) if (!x.visible) return false;
    return true;
  };

  /** A click while the tool is on: the first / the second point. @returns {boolean} the click was taken */
  function click(event) {
    if (!active) return false;
    const rect = domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, getCamera());
    const hit = raycaster.intersectObjects(getTargets().filter(Boolean), true).find((h) => h.object.isMesh && isShown(h.object));
    if (!hit) return true;
    const p = snapHitPoint(hit, { x: event.clientX, y: event.clientY }, toScreen);
    if (!first) {
      first = { p, dot: addDot(p) };
      return true;
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([first.p, p]), lineMat);
    line.renderOrder = 19;
    group.add(line);
    addDot(p);
    const div = document.createElement('div');
    div.className = 'measure-label';
    div.textContent = measureText(measureValues(first.p, p, 1));
    const label = new CSS2DObject(div);
    label.position.copy(first.p).add(p).multiplyScalar(0.5);
    group.add(label);
    first = null;
    return true;
  }

  function clear() {
    for (const o of [...group.children]) {
      group.remove(o);
      if (o.isLine) o.geometry.dispose();
      if (o.isCSS2DObject) o.element.remove();
    }
    dots.length = 0;
    first = null;
  }

  return {
    group,
    click,
    clear,
    get active() {
      return active;
    },
    setActive(on) {
      active = !!on;
      if (!active && first) {
        group.remove(first.dot);
        first = null;
      }
      domElement.style.cursor = active ? 'crosshair' : '';
    },
    // keeps the dots a few px big while zooming (called every frame)
    update() {
      for (const d of dots) d.scale.setScalar(dotSize(d.position));
    },
  };
}
