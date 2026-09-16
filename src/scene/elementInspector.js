// Reverse lookup: given a THREE.Object3D that a raycaster just hit (main.js's click handler),
// find its traceability userData (src/scene/traceability.js) — this is what makes "click a 3D
// element, see its 2D source" possible. Pure tree-walk, no Three.js import needed (works on any
// {userData, parent} chain), so it's testable with plain object stand-ins for Object3D.

/**
 * @param {{userData?: Object, parent?: Object}|null} object3D
 * @returns {import('./traceability.js').traceability|null}  null if nothing in the ancestor
 *   chain (including `object3D` itself) carries a geometrySourceId — e.g. the grid helper, the
 *   ceiling mesh, or a dimension label were clicked, none of which are traceable elements.
 */
export function resolveTraceability(object3D) {
  let node = object3D;
  while (node) {
    if (node.userData && node.userData.geometrySourceId) return node.userData;
    node = node.parent;
  }
  return null;
}
