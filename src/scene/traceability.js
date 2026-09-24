// Canonical shape for the traceability metadata every rendered 3D element carries in its
// `userData` — so a click on any tread/riser/stringer-panel/post mesh can always be traced
// back to the exact 2D/model source that produced it, independent of Three.js scene-graph
// position or mesh naming (mesh.name is for exporters — see objExporter.js/daeExporter.js —
// this is purely for in-app inspection, see elementInspector.js).
//
//   elementType       'tread' | 'riser' | 'stringer' | 'post' | 'railing'
//   stepId            e.g. 'step-7' — which tread this element belongs to/supports; null when
//                     the element isn't tied to one tread (e.g. a start/end/corner post).
//   stringerId        'outer' | 'inner' — which stringer side; null for non-stringer elements.
//   geometrySourceId  A stable, namespaced id of the exact model object this mesh came from —
//                     e.g. 'tread:step-7', 'stringer:outer:outer-seg-2:bearing-7',
//                     'riser:step-7:panel-1', 'post:post-corner-0'.

/**
 * @param {Object} fields
 * @param {'tread'|'riser'|'stringer'|'post'|'railing'} fields.elementType
 * @param {string|null} [fields.stepId]
 * @param {'outer'|'inner'|null} [fields.stringerId]
 * @param {string} fields.geometrySourceId
 */
export function traceability({ elementType, stepId = null, stringerId = null, geometrySourceId }) {
  if (!elementType) throw new Error('traceability: elementType is required');
  if (!geometrySourceId) throw new Error('traceability: geometrySourceId is required');
  return { elementType, stepId, stringerId, geometrySourceId };
}
