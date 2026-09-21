// STRINGER PROFILE VIEW MODEL — everything a side-view (elevation) editor needs to DRAW, as plain
// data derived from already-solved geometry. It solves nothing and edits nothing: the editor draws
// this, and turns a drag into a PROFILE_EDITS event (stringerProfileModel.js), which changes the
// override layer, which goes through the normal rebuild() -> solve -> render pipeline. No Three.js,
// no DOM. See docs/architecture/STRINGER_PROFILE_MODEL.md §10.
//
// One view per StringerSegmentConstructionGeometry, in that segment's own (u,v) frame — u along the
// board, v = world elevation.

import { offsetPolylineByNormal } from './polylineProfile.js';
import { curveToPolyline, polylineToCurve, pointToCurveDistance } from './profileCurve.js';
import { profileParamsFromConfig } from './stringerProfileModel.js';
import { CONSTRUCTION_TYPES } from './stringerModel.js';

// Chord length a depth readout is sampled at along the lower contour — enough to find a local
// minimum on a board a few metres long, not a precision measure (the exact minimum is
// StringerSegmentConstructionGeometry.localDepthMm).
const DEPTH_SAMPLE_CHORD_MM = 25;

/**
 * @param {import('./stringerModel.js').StringerSegmentConstructionGeometry[]} geometries
 * @param {import('./stringerModel.js').StringerModel} model
 * @param {Object} config
 */
export function buildProfileViewModel(geometries, model, config) {
  const params = profileParamsFromConfig(config);
  return geometries.map((g) => {
    const segment = model.segments.find((s) => s.id === g.segmentId);
    const closed = g.constructionType === CONSTRUCTION_TYPES.CLOSED;
    const bearings = segment ? segment.treadBearings : [];

    const treads = bearings.map((b) => ({
      treadIndex: b.treadIndex,
      uStart: b.finalUStart,
      uEnd: b.finalUEnd,
      zBottom: b.bearingElevation,
      zTop: b.bearingElevation + config.treadThickness,
    }));
    const risers = config.hasRiserBoards
      ? bearings.filter((b) => b.ownsStart).map((b) => ({ treadIndex: b.treadIndex, u: b.finalUStart, zBottom: b.bearingElevation - (config.riserHeight ?? 0), zTop: b.bearingElevation }))
      : [];

    // The line the lower contour must stay on the far side of: the depth reference pushed down by
    // the minimum depth. The editor draws it dashed; a control point above it is a violation.
    const referencePolyline = (closed ? g.topProfile : g.pitchProfile) || [];
    const minimumDepthEnvelope = referencePolyline.length >= 2 ? offsetPolylineByNormal(referencePolyline, params.minimumDepthMm, 'down') : [];

    const referenceCurve = polylineToCurve(referencePolyline);
    const lowerPolyline = curveToPolyline(g.lowerCurve, DEPTH_SAMPLE_CHORD_MM);
    const depthSamples = lowerPolyline.map((p) => ({ u: p.u, v: p.v, depthMm: referenceCurve.length ? pointToCurveDistance(p, referenceCurve) : null }));

    const controlPoints = (list, contour) =>
      (list || []).map((c) => ({
        id: c.id,
        contour,
        u: c.u,
        v: c.v,
        nominal: c.nominal,
        tangent: c.tangent,
        normal: c.normal,
        radiusMm: c.radius,
        // an inserted point: how far along its edge it sits (0..1) and that edge's length
        t: c.t,
        edgeLength: c.edgeLength,
        // anchored to a tread / the end, manually moved or given a radius, or inserted by hand
        kind: c.inserted ? 'inserted' : c.overridden ? 'overridden' : 'anchored',
        withinSegment: c.withinSegment,
      }));

    return {
      segmentId: g.segmentId,
      constructionType: g.constructionType,
      // the board's silhouette (filled in the editor) and where its two end faces are
      outline: g.outerContour,
      span: { uStart: g.ends.start.u, uEnd: g.ends.end.u },
      treads,
      risers,
      upperCurve: g.upperCurve,
      lowerCurve: g.lowerCurve,
      referenceCurve: referencePolyline,
      minimumDepthEnvelope,
      depthSamples,
      localDepthMm: g.localDepthMm,
      requiredDepthMm: g.requiredDepthMm,
      controlPoints: [...controlPoints(g.lowerControl, 'lower'), ...controlPoints(g.upperControl, 'upper')],
      arcs: [...g.lowerCurve, ...(g.upperCurve || [])].filter((p) => p.type === 'arc').map((a) => ({ center: a.center, radiusMm: a.radius, startAngle: a.startAngle, sweep: a.sweep })),
      diagnostics: g.diagnostics,
    };
  });
}

/**
 * The override a drag to `target` (a position in the same (u,v) frame) means for a control point:
 * how far along the reference (ds) and along the contour's outward normal (dn) that is from the
 * point's NOMINAL position. The editor feeds this into a PROFILE_EDITS.MOVE_VERTEX event.
 */
export function offsetFromDrag(controlPoint, target) {
  const origin = controlPoint.nominal || controlPoint;
  const du = target.u - origin.u;
  const dv = target.v - origin.v;
  return { ds: du * controlPoint.tangent.u + dv * controlPoint.tangent.v, dn: du * controlPoint.normal.u + dv * controlPoint.normal.v };
}
