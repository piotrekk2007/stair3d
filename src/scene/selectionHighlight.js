import * as THREE from 'three';

// Podświetlenie zaznaczonego elementu w 3D. CZYSTO PREZENTACYJNE: czyta wyłącznie
// mesh.userData (traceability.js) już wystawione przez renderery i podmienia materiał danego
// meshu na jego klon z emisją — nie liczy żadnej geometrii i nie modyfikuje modelu. Każdy
// mesh dostaje własny klon materiału, bo renderery współdzielą jeden materiał na całą grupę
// (zmiana emisji współdzielonego materiału podświetliłaby wszystkie stopnie naraz).
//
// `selection` — kształt z src/ui/selection.js:
//   {elementType:'tread'|'riser', stepIndex}            -> stopień + podstopnie tego stopnia
//   {elementType:'stringer', stringerId, segmentId?}   -> wanga (cały bok albo jeden segment)
//   {elementType:'post', postId?}                       -> słup(y)
const HIGHLIGHT_EMISSIVE = new THREE.Color(0xff9800);
const HIGHLIGHT_INTENSITY = 0.55;

export function matchesSelection(userData, selection) {
  if (!userData || !selection) return false;
  const { elementType, stepId, stringerId, geometrySourceId } = userData;
  switch (selection.elementType) {
    case 'tread':
    case 'riser':
      return (elementType === 'tread' || elementType === 'riser') && stepId === `step-${selection.stepIndex}`;
    case 'stringer': {
      if (elementType !== 'stringer') return false;
      if (selection.stringerId && stringerId !== selection.stringerId) return false;
      if (!selection.segmentId) return true;
      const base = `stringer:${selection.stringerId}:${selection.segmentId}`;
      return geometrySourceId === base || geometrySourceId.startsWith(`${base}:`);
    }
    case 'post':
      if (elementType !== 'post') return false;
      return !selection.postId || geometrySourceId === `post:${selection.postId}`;
    default:
      return false;
  }
}

function restore(mesh) {
  const original = mesh.userData._origMaterial;
  if (!original) return;
  if (mesh.material !== original) mesh.material.dispose?.();
  mesh.material = original;
  delete mesh.userData._origMaterial;
}

function highlight(mesh) {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!material || !('emissive' in material)) return;
  mesh.userData._origMaterial = mesh.material;
  const clone = material.clone();
  clone.emissive = HIGHLIGHT_EMISSIVE.clone();
  clone.emissiveIntensity = HIGHLIGHT_INTENSITY;
  mesh.material = clone;
}

/**
 * Clears any previous highlight under `root`, then highlights every mesh matching `selection`.
 * Safe to call after every rebuild() (which recreates all meshes) and with selection === null.
 * @returns {number} how many meshes were highlighted
 */
export function applySelectionHighlight(root, selection) {
  if (!root) return 0;
  let count = 0;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    restore(obj);
    if (selection && matchesSelection(obj.userData, selection)) {
      highlight(obj);
      count++;
    }
  });
  return count;
}
