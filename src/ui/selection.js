// Czyste funkcje parsujące istniejące konwencje identyfikatorów (Diagnostic.elementId,
// MaterialTakeoffItem.sourceElementId) na wspólny kształt "selekcji" używany przez UI do
// podświetlania elementu w Planie 2D / Widoku 3D. Zero DOM, zero Three.js, zero geometrii —
// tylko string parsing nad już istniejącymi konwencjami nazw (patrz
// src/scene/traceability.js `geometrySourceId`, src/takeoff/takeoffTypes.js `sourceElementId`,
// src/diagnostics/diagnostic.js `elementId`).

// 'step-7' -> 7 (0-based, ten sam format co tread.index i SVG data-step-index). Zwraca null
// dla wszystkiego innego (np. elementId ogólny typu 'stair', albo brak elementId).
export function stepIndexFromElementId(elementId) {
  if (typeof elementId !== 'string') return null;
  const m = /^step-(\d+)$/.exec(elementId);
  return m ? Number(m[1]) : null;
}

// 'tread:step-3' -> {elementType:'tread', stepIndex:3}
// 'riser:step-3:panel-1' -> {elementType:'riser', stepIndex:3, panelId:'panel-1'}
// 'stringer:outer:outer-seg-0' -> {elementType:'stringer', stringerId:'outer', segmentId:'outer-seg-0'}
// 'post:post-start' -> {elementType:'post', postId:'post-start'}
// Zwraca null, jeśli sourceElementId nie pasuje do żadnej znanej konwencji (nowy typ elementu
// dodany później bez aktualizacji tego parsera — świadomie nie zgadujemy kształtu).
export function selectionFromTakeoffSourceId(sourceElementId) {
  if (typeof sourceElementId !== 'string') return null;
  const parts = sourceElementId.split(':');
  const [kind] = parts;
  if (kind === 'tread' || kind === 'landing') {
    const stepIndex = stepIndexFromElementId(parts[1]);
    return stepIndex === null ? null : { elementType: 'tread', stepIndex };
  }
  if (kind === 'riser') {
    const stepIndex = stepIndexFromElementId(parts[1]);
    if (stepIndex === null) return null;
    return { elementType: 'riser', stepIndex, panelId: parts[2] ?? null };
  }
  if (kind === 'stringer') {
    const [, stringerId, segmentId] = parts;
    return { elementType: 'stringer', stringerId: stringerId ?? null, segmentId: segmentId ?? null };
  }
  if (kind === 'post') {
    return { elementType: 'post', postId: parts[1] ?? null };
  }
  return null;
}
