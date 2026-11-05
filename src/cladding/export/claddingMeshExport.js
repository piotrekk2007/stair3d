// The module's 3D for SketchUp (DAE) and other programs (OBJ) — user request 2026-11-04. The SHARED exporters
// (export/objExporter.js, export/daeExporter.js — read-only) group meshes by their parent's name; this builds a flat
// root they understand: every cladding mesh with its world transform baked into a copy of its geometry, under a group
// named for the shared category — the treads / landings / noses → "Stopnie", the riser boards → "Podstopnie", the
// skirting boards and cover stringers → "Wangi", the balustrade → "Slupy". The concrete, the room and the LED strips
// are not exported (the cladding only — what the workshop makes). Pure (three only).
import * as THREE from 'three';

const TARGET = { Treads: 'Treads', Risers: 'RiserBoards', Finish: 'StringerOuter', Railing: 'Posts' };

/** @param {THREE.Object3D} root  renderCladdingStair's result @returns {THREE.Group} */
export function claddingExportRoot(root) {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = 'CladdingExport';
  for (const [from, to] of Object.entries(TARGET)) {
    const src = root.children.find((c) => c.name === from);
    const group = new THREE.Group();
    group.name = to;
    src?.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      const geometry = obj.geometry.clone();
      geometry.applyMatrix4(obj.matrixWorld);
      const mesh = new THREE.Mesh(geometry, obj.material);
      mesh.name = obj.name || from;
      group.add(mesh);
    });
    if (group.children.length) out.add(group);
  }
  out.updateMatrixWorld(true);
  return out;
}
