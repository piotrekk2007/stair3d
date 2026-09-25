// STRINGER PROFILE SOLVER — `solveStringerProfile()`: pure function turning a reference curve
// (the knots through the tread front corners, in the unfolded (u,v) elevation frame) plus the
// profile parameters and the manual-override layer into the stringer's lower (and, for a
// housed board, upper) contour as lines and true tangent ARCS. No Three.js, no side effects.
// See docs/architecture/STRINGER_PROFILE_MODEL.md.
//
// Algorithm (the design study's choice: B's representation, A's generator, C's editing):
//
//   1. NOMINAL control polygon = the reference curve offset along its own local normal by the
//      nominal depth (algorithm A — the minimum depth holds by construction).
//   2. OVERRIDES move / insert control points relative to that nominal polygon.
//   3. RADII: each control point gets a corner radius (the parameter, or an explicit override).
//      The radius is first made geometrically feasible (tangent lengths must fit on the edges),
//      then, in AUTO, reduced at any corner where rounding would remove material and push the
//      local depth below the minimum. Explicit radii are never reduced for depth — the design
//      decision stays, and a violation is reported by the caller as STRINGER-MIN-DEPTH.
//   4. Each contour becomes lines + tangent arcs (algorithm B's representation): a corner
//      with radius 0 stays a sharp corner, so a profile that needs no curvature has none.
//
// LOCAL STRINGER DEPTH  delta = min over q in L of  dist(q, R),  where R is the depth reference
// (cut: the reference curve; closed: the upper contour) and L the lower contour. It is the
// exact distance between two curves (profileCurve.js curveDistance), so it is well defined on
// straight, arc, S-shaped and winder-transition profiles alike and never a bounding-box size.
//
// Why a fillet can violate it, exactly: at a corner where the lower contour turns TOWARD the
// board (board region convex there), rounding with radius r removes material and the arc apex
// ends up at distance (d - r)/cos(phi) + r from the reference vertex — >= d only while r <= d.
// Corners turning the other way only ever add material, so they are always safe.

import { offsetPolylineByNormal, valueAtU } from './polylineProfile.js';
import {
  filletPolyline,
  feasibleRadii,
  filletArcAt,
  turnSignAt,
  polylineToCurve,
  curveDistance,
  pointToCurveDistance,
  splinePointsThrough,
  curveToPolyline,
} from './profileCurve.js';
import { CONSTRUCTION_TYPES } from './stringerModel.js';
import { PROFILE_CONTOURS, TRANSITION_STYLES, DEPTH_TOLERANCE_MM, MIN_VERTEX_SPACING_MM, scopeIncludes } from './stringerProfileModel.js';

const BISECTION_ITERATIONS = 50;
const MIN_PROBE_RADIUS_MM = 1e-6;
// A radius reduced by less than this is not worth reporting.
const CLAMP_REPORT_MM = 0.5;
// A spline's minimum-depth safety push (see solveContour's SPLINE branch) converges in very few
// steps for any realistically smooth curve; this is a generous cap, not a tuned/expected count.
const SPLINE_DEPTH_CORRECTION_ITERATIONS = 6;

// Left turns (+1) round off a convex corner of the board below the lower contour; right turns
// (-1) of the board above the upper contour. See the header.
const RESTRICTED_TURN = { [PROFILE_CONTOURS.LOWER]: 1, [PROFILE_CONTOURS.UPPER]: -1 };

// --- frames ---------------------------------------------------------------------------------------

// Unit tangent of the reference curve at each vertex: the mean of the adjacent edge directions
// (end vertices use their only edge).
function vertexTangents(points) {
  const dirs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const du = points[i + 1].u - points[i].u;
    const dv = points[i + 1].v - points[i].v;
    const len = Math.hypot(du, dv) || 1;
    dirs.push({ u: du / len, v: dv / len });
  }
  return points.map((_, i) => {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(dirs.length - 1, i)];
    const u = a.u + b.u;
    const v = a.v + b.v;
    const len = Math.hypot(u, v) || 1;
    return { u: u / len, v: v / len };
  });
}

// The contour's own OUTWARD normal (away from the reference): down for the lower contour, up for
// the upper one. Matches offsetPolylineByNormal's 'down'/'up'.
function outwardNormal(tangent, contour) {
  return contour === PROFILE_CONTOURS.LOWER ? { u: tangent.v, v: -tangent.u } : { u: -tangent.v, v: tangent.u };
}

function finding(fields) {
  return { severity: 'INFO', ...fields };
}

// --- control polygon (nominal + overrides) -------------------------------------------------------

// Post anchors (see stringerProfileModel.js postAnchorId): a point on the contour exactly at a post face. An anchor
// with no override is VIRTUAL — reported as a control point (a handle for the editor) at the contour's current height
// there, but not part of the polygon, so an unedited board keeps its shape exactly (spline included). A moved anchor
// becomes a real vertex at (face u, nominal height + dv) and the contour is built through it.
function withPostAnchors(vertices, postAnchors, overrides, contour, solvedCurve) {
  const virtual = [];
  let list = vertices;
  // the anchor's own height is read off the contour AS SOLVED without it (for a spline or a filleted corner that is
  // not the control polygon), so an unmoved anchor sits exactly on the drawn edge
  const drawn = solvedCurve && solvedCurve.length > 0 ? curveToPolyline(solvedCurve) : vertices.map((v) => ({ u: v.u, v: v.v }));
  for (const anchor of postAnchors || []) {
    const nominalV = drawn.length >= 2 ? valueAtU(drawn, anchor.u) : drawn.length === 1 ? drawn[0].v : 0;
    const dv = overrides?.anchors?.[anchor.id]?.[contour]?.dv;
    const point = {
      id: anchor.id,
      u: anchor.u,
      v: nominalV + (Number.isFinite(dv) ? dv : 0),
      nominal: { u: anchor.u, v: nominalV },
      override: Number.isFinite(dv) ? { ds: dv, dn: 0 } : null,
      explicitRadius: undefined,
      inserted: false,
      anchor: true,
      postId: anchor.postId,
      // moves only along the post face (vertical): an editor's drag along this "tangent" is the height change
      tangent: { u: 0, v: 1 },
      normal: { u: 1, v: 0 },
    };
    if (!Number.isFinite(dv)) {
      virtual.push(point);
      continue;
    }
    const at = list.findIndex((v) => v.u > anchor.u);
    list = at < 0 ? [...list, point] : [...list.slice(0, at), point, ...list.slice(at)];
  }
  return { vertices: list, virtual };
}

function buildControlPolygon({ reference, contour, nominalPoints, overrides, findings }) {
  const tangents = vertexTangents(reference);
  const referenceIds = new Set(reference.map((p) => p.id));
  const vertexOverrides = (overrides && overrides[contour]) || {};

  for (const anchorId of Object.keys(vertexOverrides)) {
    if (!referenceIds.has(anchorId)) {
      findings.push(
        finding({
          ruleId: 'STRINGER-OVERRIDE-ORPHANED',
          severity: 'WARNING',
          parameter: 'manualStringerProfileOverrides',
          anchorId,
          contour,
          message: `Ręczna edycja profilu wangi odwołuje się do punktu „${anchorId}”, którego już nie ma (zmieniła się liczba lub układ stopni) — pomijam ją.`,
        })
      );
    }
  }

  // Points inserted on a nominal edge, grouped by the vertex they follow.
  const insertedAfter = new Map();
  for (const ins of (overrides && overrides.inserted) || []) {
    if (ins.contour !== contour) continue;
    const idx = reference.findIndex((p) => p.id === ins.after);
    if (idx < 0 || idx >= reference.length - 1) {
      findings.push(
        finding({
          ruleId: 'STRINGER-OVERRIDE-ORPHANED',
          severity: 'WARNING',
          parameter: 'manualStringerProfileOverrides',
          anchorId: ins.id,
          contour,
          message: `Dodany punkt profilu wangi „${ins.id}” nie ma już punktu odniesienia „${ins.after}” — pomijam go.`,
        })
      );
      continue;
    }
    if (!insertedAfter.has(idx)) insertedAfter.set(idx, []);
    insertedAfter.get(idx).push(ins);
  }

  const vertices = [];
  nominalPoints.forEach((p, i) => {
    const o = vertexOverrides[reference[i].id];
    vertices.push({
      id: reference[i].id,
      u: p.u,
      v: p.v,
      nominal: { u: p.u, v: p.v },
      override: o ? { ds: o.ds || 0, dn: o.dn || 0 } : null,
      explicitRadius: o && o.radiusMm !== undefined ? o.radiusMm : undefined,
      inserted: false,
      // the local frame an editor needs to turn a dragged position back into (ds, dn)
      tangent: tangents[i],
      normal: outwardNormal(tangents[i], contour),
    });
    if (o) {
      const n = outwardNormal(tangents[i], contour);
      const last = vertices[vertices.length - 1];
      last.u = p.u + (o.ds || 0) * tangents[i].u + (o.dn || 0) * n.u;
      last.v = p.v + (o.ds || 0) * tangents[i].v + (o.dn || 0) * n.v;
    }
    const inserts = (insertedAfter.get(i) || []).slice().sort((a, b) => a.t - b.t);
    for (const ins of inserts) {
      const a = nominalPoints[i];
      const b = nominalPoints[i + 1];
      const du = reference[i + 1].u - reference[i].u;
      const dv = reference[i + 1].v - reference[i].v;
      const len = Math.hypot(du, dv) || 1;
      const n = outwardNormal({ u: du / len, v: dv / len }, contour);
      const dn = ins.dn || 0;
      const pos = { u: a.u + (b.u - a.u) * ins.t + n.u * dn, v: a.v + (b.v - a.v) * ins.t + n.v * dn };
      vertices.push({
        id: ins.id,
        u: pos.u,
        v: pos.v,
        nominal: { u: pos.u - n.u * dn, v: pos.v - n.v * dn },
        override: { ds: 0, dn },
        explicitRadius: ins.radiusMm,
        inserted: true,
        tangent: { u: du / len, v: dv / len },
        normal: n,
        t: ins.t,
        edgeLength: len,
      });
    }
  });

  return rejectFoldedOverrides(vertices, contour, findings);
}

// A moved or inserted control point must leave the polygon u-monotonic (a board's axis never
// doubles back). The offending override is dropped — the same "reject an edit that makes the
// shape degenerate" rule edgeOverrides.js applies to tread edges — and reported.
function rejectFoldedOverrides(vertices, contour, findings) {
  let list = vertices;
  for (let guard = 0; guard < vertices.length; guard++) {
    let bad = -1;
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i + 1].u < list[i].u + MIN_VERTEX_SPACING_MM) {
        bad = i;
        break;
      }
    }
    if (bad < 0) break;
    const culprit = list[bad + 1].override ? bad + 1 : list[bad].override ? bad : -1;
    if (culprit < 0) break; // the nominal polygon itself is folded — not something an override can fix
    const c = list[culprit];
    findings.push(
      finding({
        ruleId: 'STRINGER-OVERRIDE-REJECTED',
        severity: 'WARNING',
        parameter: 'manualStringerProfileOverrides',
        anchorId: c.id,
        contour,
        message: `Ręczne przesunięcie punktu profilu wangi „${c.id}” odrzucone — zawinęłoby kontur wangi na siebie.`,
      })
    );
    if (c.inserted) list = list.filter((_, i) => i !== culprit);
    else list = list.map((v, i) => (i === culprit ? { ...v, u: v.nominal.u, v: v.nominal.v, override: null } : v));
  }
  return list;
}

// --- radii ---------------------------------------------------------------------------------------

function requestedRadii(vertices, contour, params) {
  const auto = params.transitionStyle !== TRANSITION_STYLES.SHARP && scopeIncludes(params.radiusScope, contour) ? params.cornerRadiusMm : 0;
  return vertices.map((v, i) => (i === 0 || i === vertices.length - 1 ? 0 : v.explicitRadius !== undefined ? v.explicitRadius : auto));
}

// The largest radius <= `radius` at vertex i that keeps the arc at least `minDepth` away from
// the opposite curve. Monotone in the radius (a bigger arc removes more material), so bisection
// is exact enough and fully deterministic.
function largestRadiusKeepingDepth(points, i, radius, opposite, minDepth) {
  const ok = (r) => {
    const arc = filletArcAt(points[i - 1], points[i], points[i + 1], r);
    return !arc || curveDistance([arc], opposite) >= minDepth - DEPTH_TOLERANCE_MM;
  };
  if (ok(radius)) return radius;
  if (!ok(MIN_PROBE_RADIUS_MM)) return 0;
  let lo = MIN_PROBE_RADIUS_MM;
  let hi = radius;
  for (let k = 0; k < BISECTION_ITERATIONS; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Shared shape between the spline path and the fillet path below — an editor needs the SAME
// per-point metadata (nominal position, tangent/normal for its ds/dn drag math, whether it's an
// override) regardless of which path produced the curve; `applied` (per-vertex radius) is simply
// absent (every point reads radius 0) when there is no discrete corner-rounding concept at all.
function controlPointsFrom(vertices, applied) {
  return vertices.map((v, i) => ({
    id: v.id,
    u: v.u,
    v: v.v,
    radius: applied ? applied[i] || 0 : 0,
    overridden: !!v.override || v.explicitRadius !== undefined,
    inserted: v.inserted,
    anchor: !!v.anchor,
    postId: v.postId,
    t: v.t,
    edgeLength: v.edgeLength,
    nominal: v.nominal ? { u: v.nominal.u, v: v.nominal.v } : null,
    tangent: v.tangent,
    normal: v.normal,
  }));
}

function solveContour({ vertices, contour, params, opposite, findings }) {
  const points = vertices.map((v) => ({ u: v.u, v: v.v }));

  // SPLINE replaces per-corner rounding with ONE smooth curve through the whole contour — reuses
  // `stringerRadiusScope` (BOTTOM/TOP/BOTH) to decide which contour(s) it applies to, exactly like
  // TANGENT_ARC's own radius already does, so no new "which side" config field is needed. A locally
  // too-sharp turn (splinePointsThrough returning null — see its own doc) falls through to the
  // ordinary path below instead of ever producing a folded/self-crossing contour.
  //
  // Unlike a fillet arc (one tunable radius per corner, bisected down until it stops eating into
  // the minimum depth — see largestRadiusKeepingDepth below), an interpolating spline has no local
  // "shrink this corner" lever: it must pass through every knot exactly, so at a sharp turn it can
  // cut inside the nominal control polygon exactly the way a fillet does, but with no per-corner
  // radius to reduce. In pure AUTO (no manual point on this contour), the fix is the same one
  // profileOffsetMm already uses globally (a positive offset "makes the board deeper everywhere"):
  // measure the spline's actual local depth and, if it undershoots, push the WHOLE curve away from
  // `opposite` along its own local normal (the exact same primitive `lowerNominal`/`upperNominal`
  // were built with, `offsetPolylineByNormal`) by the shortfall, then re-measure — a couple of
  // iterations converge well inside DEPTH_TOLERANCE_MM for any realistically smooth curve.
  //
  // NEVER once the user has manually moved (or set a radius on) a point of THIS contour — a global
  // push moves EVERY point, not just the one being edited, which is exactly the opposite of what a
  // manual edit means and, reported by the user, visibly "wrecked" the rest of an intentionally
  // hand-shaped board just because one dragged point briefly undershot the minimum. This matches
  // the same rule an explicit fillet radius already follows: "KEPT and reported (STRINGER-MIN-DEPTH),
  // never silently corrected" — a manual edit is a design decision, not something AUTO gets to
  // override just because it also happens to run through this function.
  if (params.transitionStyle === TRANSITION_STYLES.SPLINE && scopeIncludes(params.radiusScope, contour)) {
    const hasManualPoint = vertices.some((v) => v.override || v.explicitRadius !== undefined);
    let dense = splinePointsThrough(points);
    if (dense) {
      if (!hasManualPoint) {
        const pushDirection = contour === PROFILE_CONTOURS.LOWER ? 'down' : 'up';
        let curve = polylineToCurve(dense);
        for (let iter = 0; iter < SPLINE_DEPTH_CORRECTION_ITERATIONS; iter++) {
          const deficit = params.minimumDepthMm - curveDistance(curve, opposite);
          if (deficit <= DEPTH_TOLERANCE_MM) break;
          dense = offsetPolylineByNormal(dense, deficit, pushDirection);
          curve = polylineToCurve(dense);
        }
        return { curve, control: controlPointsFrom(vertices, null) };
      }
      return { curve: polylineToCurve(dense), control: controlPointsFrom(vertices, null) };
    }
    findings.push(
      finding({
        ruleId: 'STRINGER-SPLINE-REJECTED',
        severity: 'WARNING',
        parameter: 'stringerTransitionStyle',
        contour,
        message: `Profil (kontur ${contour === PROFILE_CONTOURS.LOWER ? 'dolny' : 'górny'}) ma lokalnie zbyt ostry zwrot na gładką krzywą spline — ten fragment pozostał bez niej.`,
      })
    );
  }

  const requested = requestedRadii(vertices, contour, params);
  const feasible = feasibleRadii(points, requested);
  const applied = feasible.slice();
  const depthClamped = [];
  for (let i = 1; i < points.length - 1; i++) {
    if (!(applied[i] > 0) || vertices[i].explicitRadius !== undefined) continue;
    if (turnSignAt(points[i - 1], points[i], points[i + 1]) !== RESTRICTED_TURN[contour]) continue;
    applied[i] = largestRadiusKeepingDepth(points, i, applied[i], opposite, params.minimumDepthMm);
    if (feasible[i] - applied[i] > CLAMP_REPORT_MM) depthClamped.push(vertices[i].id);
  }
  const lengthClamped = [];
  for (let i = 1; i < points.length - 1; i++) {
    if (requested[i] - feasible[i] > CLAMP_REPORT_MM) lengthClamped.push(vertices[i].id);
  }
  if (depthClamped.length > 0) {
    findings.push(
      finding({
        ruleId: 'STRINGER-FILLET-CLAMPED',
        parameter: 'stringerCornerRadiusMm',
        contour,
        anchorId: depthClamped[0],
        value: depthClamped.length,
        message: `Promień zaokrąglenia zmniejszony w ${depthClamped.length} narożnikach, żeby utrzymać minimalną głębokość wangi (${params.minimumDepthMm} mm).`,
      })
    );
  }
  if (lengthClamped.length > 0) {
    findings.push(
      finding({
        ruleId: 'STRINGER-FILLET-CLAMPED',
        parameter: 'stringerCornerRadiusMm',
        contour,
        anchorId: lengthClamped[0],
        value: lengthClamped.length,
        message: `Promień zaokrąglenia zmniejszony w ${lengthClamped.length} narożnikach — krawędzie profilu są za krótkie na pełny łuk.`,
      })
    );
  }
  const { curve } = filletPolyline(points, applied);
  return { curve, control: controlPointsFrom(vertices, applied) };
}

// --- public API ----------------------------------------------------------------------------------

/**
 * @param {Object} input
 * @param {{u:number,v:number,id:string}[]} input.reference  Reference curve knots, u-increasing.
 * @param {string} input.constructionType  CONSTRUCTION_TYPES.CUT | CLOSED
 * @param {Object} input.params            profileParamsFromConfig(config)
 * @param {Object|null} input.overrides    activeOverridesFor(config.manualStringerProfileOverrides, side)
 * @param {{id:string, u:number, postId:string}[]} [input.postAnchors]  post faces the group's boards butt into (group u)
 * @returns {{
 *   referenceCurve: Object[], lowerCurve: Object[], upperCurve: Object[]|null,
 *   depthReferenceCurve: Object[], lowerControl: Object[], upperControl: Object[]|null,
 *   findings: Object[]
 * }}
 */
export function solveStringerProfile({ reference, constructionType, params, overrides = null, postAnchors = [] }) {
  const findings = [];
  const closed = constructionType === CONSTRUCTION_TYPES.CLOSED;
  const referenceCurve = polylineToCurve(reference);

  // `reference` runs through bearingElevation (the tread's own BOTTOM — see stringerModel.js) and
  // must stay there: it is also what the LOWER contour's minimum-depth guarantee is ultimately
  // anchored to via the total board width below. `params.topMarginMm` is specified relative to the
  // tread's own TOP (the walking surface) instead — the quantity that actually matters for "does
  // the board's visible top edge clear the tread's nosing" — so it is converted to a from-reference
  // distance here, once, by adding back the tread's own thickness (the gap between its top and
  // `reference`). The board's TOTAL width (upper to lower) still stays exactly `nominalDepthMm`
  // either way — only where that fixed-width band sits relative to the tread moves — so this never
  // weakens the minimum-depth guarantee (measured as upper-to-lower distance, not distance below
  // `reference`; see `depthReferenceCurve` below).
  // Clamped to the total board width: an extreme combination (shallow minimum depth, a thick
  // tread, a large top margin) could otherwise push this past nominalDepthMm and flip the lower
  // offset's direction (up instead of down), turning the board inside out.
  const topMarginFromReferenceMm = closed ? Math.min(params.topMarginMm + params.treadThicknessMm, params.nominalDepthMm) : 0;
  const lowerDistance = closed ? params.nominalDepthMm - topMarginFromReferenceMm : params.nominalDepthMm;
  const lowerNominal = offsetPolylineByNormal(reference, lowerDistance, 'down');
  const upperNominal = closed ? offsetPolylineByNormal(reference, topMarginFromReferenceMm, 'up') : null;

  const lowerBase = buildControlPolygon({ reference, contour: PROFILE_CONTOURS.LOWER, nominalPoints: lowerNominal, overrides, findings });
  const upperBase = closed ? buildControlPolygon({ reference, contour: PROFILE_CONTOURS.UPPER, nominalPoints: upperNominal, overrides, findings }) : null;
  // The curve each contour's rounding must stay away from. Sharp control polygons on purpose:
  // rounding one contour never gets to "use up" the other's margin.
  const solveBoth = (lowerVertices, upperVertices, into) => {
    const lowerOpposite = closed ? polylineToCurve(upperVertices) : referenceCurve;
    const lowerSolved = solveContour({ vertices: lowerVertices, contour: PROFILE_CONTOURS.LOWER, params, opposite: lowerOpposite, findings: into });
    const upperSolved = closed ? solveContour({ vertices: upperVertices, contour: PROFILE_CONTOURS.UPPER, params, opposite: polylineToCurve(lowerVertices), findings: into }) : null;
    return { lowerSolved, upperSolved };
  };
  // Pass 1 without post anchors; the anchors then read their height off these solved edges. Only if an anchor was
  // MOVED is the profile solved again through it (findings of the discarded pass are dropped).
  const firstFindings = [];
  const first = solveBoth(lowerBase, upperBase, firstFindings);
  const lowerAnchored = withPostAnchors(lowerBase, postAnchors, overrides, PROFILE_CONTOURS.LOWER, first.lowerSolved.curve);
  const upperAnchored = closed ? withPostAnchors(upperBase, postAnchors, overrides, PROFILE_CONTOURS.UPPER, first.upperSolved.curve) : null;
  const anchorsMoved = lowerAnchored.vertices.length !== lowerBase.length || (closed && upperAnchored.vertices.length !== upperBase.length);
  const { lowerSolved: lower, upperSolved: upper } = anchorsMoved ? solveBoth(lowerAnchored.vertices, closed ? upperAnchored.vertices : null, findings) : (findings.push(...firstFindings), first);

  const withVirtual = (control, virtual, contour) =>
    [...control, ...virtual.map((v) => ({ id: v.id, contour, u: v.u, v: v.v, radius: 0, overridden: false, inserted: false, anchor: true, postId: v.postId, nominal: v.nominal, tangent: v.tangent, normal: v.normal }))].sort((a, b) => a.u - b.u);
  return {
    referenceCurve,
    lowerCurve: lower.curve,
    upperCurve: upper ? upper.curve : null,
    depthReferenceCurve: closed ? upper.curve : referenceCurve,
    lowerControl: withVirtual(lower.control, lowerAnchored.virtual, PROFILE_CONTOURS.LOWER),
    upperControl: upper ? withVirtual(upper.control, upperAnchored.virtual, PROFILE_CONTOURS.UPPER) : null,
    findings,
  };
}

/**
 * Local stringer depth of a lower-contour piece: the exact minimum distance from it to the depth
 * reference. Kept as its own function so a segment can measure just its own slice of L against
 * the whole group's reference (a slice measured only against a slice of R would over-estimate
 * the depth near the slice boundaries).
 */
export function measureLocalDepth(lowerCurve, depthReferenceCurve) {
  return curveDistance(lowerCurve, depthReferenceCurve);
}

/** Distance from one point to the depth reference — for probing a single tread support. */
export function depthAtPoint(point, depthReferenceCurve) {
  return pointToCurveDistance(point, depthReferenceCurve);
}
