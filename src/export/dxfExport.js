// DXF EXPORT — a real-size (1:1, mm), production-ready cutting/marking drawing of one stringer
// board (or every board of one stringer side laid out on one sheet), of one post/every post
// (PostModel, postSolver.js), or of one tread/every tread (TreadModel, treadSolver.js). Pure
// serialization: every number comes straight from already-solved geometry
// (StringerSegmentConstructionGeometry for boards, PostModel for posts, TreadModel for treads) —
// nothing here decides any geometry, exactly like the other export/ adapters (objExporter.js,
// daeExporter.js, takeoff/export/). No DOM.
//
// This is deliberately a DIFFERENT, richer consumer than the profile editor's view model
// (geometry/stringerProfileView.js), which no longer exposes housings at all (a flat 2D
// rectangle was confusing on an interactive screen — see CLAUDE.md). A production drawing is not
// an interactive screen: marking exactly where a housing/tread sits is the whole point of sending
// this to a workshop, so this file reads the raw StringerSegmentConstructionGeometry directly
// (lowerCurve/upperCurve/housings) rather than going through that trimmed view model.

import { lineSegment, curveStart, curveEnd, reverseCurve, curveToPolyline, polylineToCurve } from '../geometry/profileCurve.js';
import { GEOMETRY_EPS } from '../geometry/tolerances.js';
import { CONSTRUCTION_TYPE_LABELS_PL } from '../geometry/stringerModel.js';
import { POST_FACES, POST_FACE_ORDER, vRangeWithin } from '../geometry/jointSolver.js';
import { ROTULE_DIAMETER_MM } from '../geometry/railingGlass.js';

// Real gap (mm) left between boards when several are laid out on one sheet — same figure as the
// on-screen editor's own SEGMENT_GAP_MM (profileEditor/profileEditorRenderer.js): a comfortable
// amount of breathing room, not a geometric requirement either place, so the two are free to
// diverge without one owning the other's constant.
const BOARD_GAP_MM = 350;
const TITLE_LINE_HEIGHT_MM = 30;
const TITLE_TEXT_HEIGHT_MM = 20;
const TITLE_MARGIN_MM = 40;

function dist(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

// Older DXF readers assume a single-byte codepage for TEXT content; plain ASCII sidesteps any
// encoding ambiguity in what is meant to be a portable production file.
function stripDiacritics(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function escapeDxfText(s) {
  return stripDiacritics(s).replace(/[\r\n]+/g, ' ');
}

function fmt(n) {
  return (Math.round(n * 1000) / 1000).toString();
}

function deg(rad) {
  let d = (rad * 180) / Math.PI;
  d = d % 360;
  if (d < 0) d += 360;
  return d;
}

// --- entity primitives -------------------------------------------------------------------------

function lineEntity(a, b, layer) {
  return ['0', 'LINE', '8', layer, '10', fmt(a.u), '20', fmt(a.v), '30', '0', '11', fmt(b.u), '21', fmt(b.v), '31', '0'].join('\n');
}

function arcEntity(prim, layer) {
  let a1 = deg(prim.startAngle);
  let a2 = deg(prim.startAngle + prim.sweep);
  if (prim.sweep < 0) [a1, a2] = [a2, a1]; // DXF ARC is always CCW start->end; swapping keeps the same points
  return ['0', 'ARC', '8', layer, '10', fmt(prim.center.u), '20', fmt(prim.center.v), '30', '0', '40', fmt(prim.radius), '50', fmt(a1), '51', fmt(a2)].join('\n');
}

function circleEntity(center, radius, layer) {
  return ['0', 'CIRCLE', '8', layer, '10', fmt(center.u), '20', fmt(center.v), '30', '0', '40', fmt(radius)].join('\n');
}

function textEntity(text, pos, heightMm, layer) {
  return ['0', 'TEXT', '8', layer, '10', fmt(pos.u), '20', fmt(pos.v), '30', '0', '40', fmt(heightMm), '1', escapeDxfText(text)].join('\n');
}

function curveToEntities(curve, layer) {
  return curve.map((prim) => (prim.type === 'line' ? lineEntity(prim.a, prim.b, layer) : arcEntity(prim, layer))).join('\n');
}

function boundsOfPoints(pts) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    minU = Math.min(minU, p.u);
    maxU = Math.max(maxU, p.u);
    minV = Math.min(minV, p.v);
    maxV = Math.max(maxV, p.v);
  }
  return { minU, maxU, minV, maxV };
}

function boundsOf(curve) {
  return boundsOfPoints(curveToPolyline(curve));
}

function polygonEntities(points, layer) {
  const out = [];
  for (let i = 0; i < points.length; i++) out.push(lineEntity(points[i], points[(i + 1) % points.length], layer));
  return out;
}

// --- the closed board outline --------------------------------------------------------------------

// Stitches the top edge (u increasing) and the bottom edge (u increasing) of one board into a
// SINGLE closed loop — top, down the end face, bottom reversed, up the other end face — keeping
// every real arc intact. `outerContour` (the same shape as chords, used for the mesh/self-
// intersection check) is only a fallback when a raw curve is unexpectedly missing.
export function buildBoardOutlineCurve(geometry) {
  const bottom = geometry.lowerCurve;
  if (!bottom || bottom.length === 0) return null;
  const top = geometry.upperCurve && geometry.upperCurve.length > 0 ? geometry.upperCurve : geometry.topProfile ? polylineToCurve(geometry.topProfile) : null;
  if (!top || top.length === 0) {
    if (!geometry.outerContour || geometry.outerContour.length < 3) return null;
    return polylineToCurve([...geometry.outerContour, geometry.outerContour[0]]);
  }
  const parts = [...top];
  const topEnd = curveEnd(top);
  const bottomEnd = curveEnd(bottom);
  if (dist(topEnd, bottomEnd) > GEOMETRY_EPS) parts.push(lineSegment(topEnd, bottomEnd));
  parts.push(...reverseCurve(bottom));
  const bottomStart = curveStart(bottom);
  const topStart = curveStart(top);
  // The very first board of a run has its bottom-front corner trimmed flush with the floor
  // (stringerConstructionGeometry.js clampFirstSegmentToFloor): the lower curve's own drawn start
  // no longer reaches the board's real start face at ends.start.u — the board's foot instead sits
  // flat on the floor (v=0) from there back to the start face. A direct line from bottomStart to
  // topStart would cut that corner off as a false diagonal instead of the real floor+vertical-face
  // right angle, which is exactly the shape the profile editor (built from the same solved
  // outerContour) shows. Route through the floor/face corner point in that case.
  const startU = geometry.ends?.start?.u;
  const startsAtFloor = geometry.ends?.start?.cut === 'FLOOR_HORIZONTAL' && Number.isFinite(startU) && Math.abs(bottomStart.v) < GEOMETRY_EPS && Math.abs(bottomStart.u - startU) > GEOMETRY_EPS;
  if (startsAtFloor) {
    const corner = { u: startU, v: 0 };
    if (dist(bottomStart, corner) > GEOMETRY_EPS) parts.push(lineSegment(bottomStart, corner));
    if (dist(corner, topStart) > GEOMETRY_EPS) parts.push(lineSegment(corner, topStart));
  } else if (dist(bottomStart, topStart) > GEOMETRY_EPS) {
    parts.push(lineSegment(bottomStart, topStart));
  }
  return parts;
}

// --- markings ------------------------------------------------------------------------------------

function housingEntities(geometry, offsetU) {
  const out = [];
  for (const h of geometry.housings || []) {
    const corners = [
      { u: h.uStart + offsetU, v: h.bottomV },
      { u: h.uEnd + offsetU, v: h.bottomV },
      { u: h.uEnd + offsetU, v: h.topV },
      { u: h.uStart + offsetU, v: h.topV },
    ];
    for (let i = 0; i < 4; i++) out.push(lineEntity(corners[i], corners[(i + 1) % 4], 'HOUSINGS'));
    const label = h.kind === 'riser' ? 'wpust podstopnia' : h.kind === 'butt' ? `wreg pod wange ${h.segmentId}` : 'wpust';
    out.push(textEntity(`${label} gl. ${Math.round(h.depth)} mm`, { u: corners[0].u, v: corners[0].v - 15 }, 12, 'HOUSINGS'));
  }
  return out;
}

// Where the board enters a structural post's housing (ends.*.intoPost — jointSolver.js / stringerConstructionGeometry.js):
// a line across the board at the post FACE (the part beyond it goes into the post) and its depth.
function postJointEntities(geometry, offsetU) {
  const out = [];
  for (const end of ['start', 'end']) {
    const into = geometry.ends?.[end]?.intoPost;
    if (!into || !(into.depthMm > 0) || !geometry.outerContour?.length) continue;
    const vr = vRangeWithin(geometry.outerContour, into.faceU, into.faceU);
    if (!vr) continue;
    const u = into.faceU + offsetU;
    out.push(lineEntity({ u, v: vr.min }, { u, v: vr.max }, 'JOINTS'));
    const labelU = end === 'end' ? u - 150 : u + 5;
    out.push(textEntity(`lico slupa ${into.postId} - wreg gl. ${Math.round(into.depthMm)} mm`, { u: labelU, v: vr.max + 10 }, 12, 'JOINTS'));
  }
  // joints stage 3: this board butts into the previous one at a postless corner — mark that board's face
  const butt = geometry.ends?.start?.butt;
  if (butt && geometry.outerContour?.length) {
    const vr = vRangeWithin(geometry.outerContour, butt.faceU, butt.faceU);
    if (vr) {
      const u = butt.faceU + offsetU;
      out.push(lineEntity({ u, v: vr.min }, { u, v: vr.max }, 'JOINTS'));
      out.push(textEntity(butt.housed ? `lico wangi ${butt.intoSegmentId} - wreg gl. ${Math.round(butt.depthMm)} mm` : `doczolowo do wangi ${butt.intoSegmentId}`, { u: u + 5, v: vr.max + 10 }, 12, 'JOINTS'));
    }
  }
  return out;
}

// Connector holes in a board (joints stage 4 — jointSolver.js holesBySegment): an AXIAL hole from the board's end
// face to the nut-access bore (drawn as a centre line + the bore's circle on the inner face), or a CROSS hole through
// the board (a circle). One label per distinct text, at its first hole.
function connectorHoleEntities(holes, offsetU) {
  const out = [];
  const labelled = new Set();
  for (const h of holes || []) {
    if (h.kind === 'axial') {
      out.push(lineEntity({ u: h.u0 + offsetU, v: h.v }, { u: h.u1 + offsetU, v: h.v }, 'JOINTS'));
      if (h.nutBoreMm > 0) out.push(circleEntity({ u: h.u1 + offsetU, v: h.v }, h.nutBoreMm / 2, 'JOINTS'));
    } else {
      out.push(circleEntity({ u: h.u + offsetU, v: h.v }, h.diameterMm / 2, 'JOINTS'));
    }
    if (!labelled.has(h.label)) {
      labelled.add(h.label);
      const u = (h.kind === 'axial' ? Math.min(h.u0, h.u1) : h.u) + offsetU;
      out.push(textEntity(h.label, { u, v: h.v - 30 }, 10, 'JOINTS'));
    }
  }
  return out;
}

function bearingEntities(segment, offsetU) {
  const out = [];
  for (const b of segment?.treadBearings || []) {
    const a = { u: b.finalUStart + offsetU, v: b.bearingElevation };
    const c = { u: b.finalUEnd + offsetU, v: b.bearingElevation };
    out.push(lineEntity(a, c, 'BEARINGS'));
    out.push(textEntity(`st. ${b.treadIndex + 1}`, { u: (a.u + c.u) / 2, v: b.bearingElevation + 8 }, 10, 'BEARINGS'));
  }
  return out;
}

// A board's own ERROR/WARNING findings (StringerSegmentConstructionGeometry.diagnostics) are stated in
// its title block — one line per rule with a count — so a flagged board is never sent to the
// workshop looking clean. Nothing is hidden or waived here; INFO is left out as noise.
function diagnosticLines(geometry) {
  const byRule = new Map();
  for (const d of geometry.diagnostics || []) {
    if (d.severity !== 'ERROR' && d.severity !== 'WARNING') continue;
    const key = `${d.severity} ${d.ruleId}`;
    byRule.set(key, (byRule.get(key) || 0) + 1);
  }
  if (byRule.size === 0) return [];
  return ['UWAGA: deska ma nierozwiazane uwagi walidacji - sprawdz zakladke Walidacja', ...[...byRule].map(([key, n]) => `  ${key.replace('ERROR', 'BLAD').replace('WARNING', 'OSTRZEZENIE')}${n > 1 ? ` (x${n})` : ''}`)];
}

function titleLines(geometry, config, holes = []) {
  const typeLabel = CONSTRUCTION_TYPE_LABELS_PL[geometry.constructionType] || geometry.constructionType;
  return [
    `Deska: ${geometry.segmentId}`,
    `Typ: ${typeLabel}`,
    geometry.localDepthMm != null ? `Glebokosc lokalna min.: ${Math.round(geometry.localDepthMm)} mm` : null,
    config?.stringerThickness ? `Grubosc materialu: ${config.stringerThickness} mm` : null,
    holes?.length ? `Otwory na laczniki: ${holes.length} (warstwa JOINTS)` : null,
    ...diagnosticLines(geometry),
    'Skala 1:1 - wszystkie wymiary w mm',
  ].filter(Boolean);
}

function titleEntities(lines, bounds) {
  return lines.map((line, i) => textEntity(line, { u: bounds.minU, v: bounds.maxV + TITLE_MARGIN_MM + i * TITLE_LINE_HEIGHT_MM }, TITLE_TEXT_HEIGHT_MM, 'TEXT'));
}

// --- DXF file wrapper (minimal, valid ASCII DXF R12 — AC1009) ------------------------------------

function wrapDxf(entityLines) {
  const header = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'];
  const layer = (name, color) => ['0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS'];
  const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '6', ...layer('OUTLINE', 7), ...layer('HOUSINGS', 1), ...layer('NOTCH', 6), ...layer('BEARINGS', 5), ...layer('JOINTS', 4), ...layer('TEXT', 3), '0', 'ENDTAB', '0', 'ENDSEC'];
  const entities = ['0', 'SECTION', '2', 'ENTITIES', ...entityLines, '0', 'ENDSEC'];
  return [...header, ...tables, ...entities, '0', 'EOF'].join('\n');
}

// --- public API ------------------------------------------------------------------------------------

/**
 * One board, full size, as a standalone DXF: outline (real arcs, not chords), housing markers
 * (closed string) with their depth, tread-bearing position markers, and a small title block.
 * `segment` (the matching StringerModel segment, for treadBearings) and `config` are optional —
 * without them the drawing is still correct, just without those extras.
 */
export function buildStringerBoardDXF(geometry, { segment, config, holes } = {}) {
  const outline = buildBoardOutlineCurve(geometry);
  if (!outline) return null;
  const bounds = boundsOf(outline);
  const entities = [curveToEntities(outline, 'OUTLINE'), ...housingEntities(geometry, 0), ...postJointEntities(geometry, 0), ...connectorHoleEntities(holes, 0), ...bearingEntities(segment, 0), ...titleEntities(titleLines(geometry, config, holes), bounds)];
  return wrapDxf(entities);
}

/**
 * Every board of one stringer side, laid out left to right with a real gap between them, in ONE
 * DXF — an overview sheet rather than a per-board file. `model` (the StringerModel for this side,
 * for treadBearings) and `config` are optional, same as above.
 */
export function buildStringerAllBoardsDXF(geometries, { model, config, holesBySegment = {} } = {}) {
  const entities = [];
  let cursor = 0;
  let any = false;
  for (const geometry of geometries) {
    const outline = buildBoardOutlineCurve(geometry);
    if (!outline) continue;
    any = true;
    const bounds = boundsOf(outline);
    const offsetU = cursor - bounds.minU;
    cursor = offsetU + bounds.maxU + BOARD_GAP_MM;
    const shifted = outline.map((prim) => {
      const moved = { ...prim, a: { u: prim.a.u + offsetU, v: prim.a.v }, b: { u: prim.b.u + offsetU, v: prim.b.v } };
      if (prim.type === 'arc') moved.center = { u: prim.center.u + offsetU, v: prim.center.v };
      return moved;
    });
    const segment = model?.segments?.find((s) => s.id === geometry.segmentId);
    const holes = holesBySegment?.[geometry.segmentId] || [];
    entities.push(curveToEntities(shifted, 'OUTLINE'), ...housingEntities(geometry, offsetU), ...postJointEntities(geometry, offsetU), ...connectorHoleEntities(holes, offsetU), ...bearingEntities(segment, offsetU));
    entities.push(...titleEntities(titleLines(geometry, config, holes), boundsOf(shifted)));
  }
  if (!any) return null;
  return wrapDxf(entities);
}

// --- posts (slupy) ---------------------------------------------------------------------------------
//
// A post (PostModel, postSolver.js) is a square prism; what is machined into it comes from the joint model
// (jointSolver.js pocketsByPost — stage 1: the housings the stringers enter). The drawing UNFOLDS the post: its four
// faces side by side in the order you walk round it (S, E, N, W — each face's right edge is the next one's left),
// each post-size wide and post-length tall, every pocket drawn on its face with its depth, and a small plan section
// naming the faces. Face coordinates: horizontal = to the right of someone looking at the face, vertical = from the
// post's bottom.

const POST_KIND_LABELS_PL = Object.freeze({ start: 'poczatkowy', end: 'koncowy', corner: 'narozny' });
// Real gap (mm) between posts laid out on one sheet — same spirit as BOARD_GAP_MM above, its own
// constant because a post's own footprint (its section width) is much smaller than a board's.
const POST_GAP_MM = 150;

const POST_SECTION_GAP_MM = 80; // between the unfolded faces and the plan section beside them

function rectLines(u0, v0, u1, v1, layer) {
  const c = [{ u: u0, v: v0 }, { u: u1, v: v0 }, { u: u1, v: v1 }, { u: u0, v: v1 }];
  return c.map((p, i) => lineEntity(p, c[(i + 1) % 4], layer));
}

// Width of one post's block on a sheet: 4 unfolded faces + the plan section.
function postBlockWidth(post) {
  return 4 * post.size + POST_SECTION_GAP_MM + post.size;
}

function postEntities(post, pockets, offsetU, holes = []) {
  const height = post.elevation.top - post.elevation.bottom;
  const size = post.size;
  const out = [];
  POST_FACE_ORDER.forEach((faceId, k) => {
    const u0 = offsetU + k * size;
    out.push(...rectLines(u0, 0, u0 + size, height, 'OUTLINE'));
    out.push(textEntity(`lico ${faceId} (${POST_FACES[faceId].label})`, { u: u0 + 5, v: -30 }, 14, 'TEXT'));
    for (const p of pockets.filter((x) => x.faceId === faceId)) {
      const a = u0 + size / 2 + p.sMin;
      const b = u0 + size / 2 + p.sMax;
      const z0 = p.zMin - post.elevation.bottom;
      const z1 = p.zMax - post.elevation.bottom;
      out.push(...rectLines(a, z0, b, z1, 'HOUSINGS'));
      const open = [p.openTop ? 'otwarte u gory' : null, p.openBottom ? 'otwarte u dolu' : null].filter(Boolean).join(', ');
      out.push(textEntity(`${p.label} gl. ${Math.round(p.depthMm)} mm`, { u: a, v: z0 - 16 }, 10, 'HOUSINGS'));
      out.push(textEntity(`od dolu slupa ${Math.round(z0)}-${Math.round(z1)} mm${open ? ` (${open})` : ''}`, { u: a, v: z0 - 30 }, 10, 'HOUSINGS'));
    }
    // connector holes on this face (joints stage 4): a circle each, height from the post's bottom
    for (const h of holes.filter((x) => x.faceId === faceId)) {
      const c = { u: u0 + size / 2 + h.s, v: h.z - post.elevation.bottom };
      out.push(circleEntity(c, h.diameterMm / 2, 'JOINTS'));
      out.push(textEntity(`${h.label}, od dolu ${Math.round(c.v)} mm`, { u: c.u + h.diameterMm, v: c.v + 4 }, 8, 'JOINTS'));
    }
  });
  // plan section: which face is which, with the pockets' depth marked on their faces
  const su = offsetU + 4 * size + POST_SECTION_GAP_MM;
  const sv = height - size;
  out.push(...rectLines(su, sv, su + size, sv + size, 'OUTLINE'));
  const mid = { u: su + size / 2, v: sv + size / 2 };
  for (const faceId of POST_FACE_ORDER) {
    const n = POST_FACES[faceId].normal;
    out.push(textEntity(faceId, { u: mid.u + n.x * (size / 2 + 12) - 5, v: mid.v + n.y * (size / 2 + 12) - 5 }, 12, 'TEXT'));
  }
  for (const p of pockets) {
    const n = POST_FACES[p.faceId].normal;
    const ax = { x: -n.y, y: n.x };
    const pt = (k, s) => ({ u: mid.u + n.x * k + ax.x * s, v: mid.v + n.y * k + ax.y * s });
    const c = [pt(size / 2, p.sMin), pt(size / 2, p.sMax), pt(size / 2 - p.depthMm, p.sMax), pt(size / 2 - p.depthMm, p.sMin)];
    c.forEach((q, i) => out.push(lineEntity(q, c[(i + 1) % 4], 'HOUSINGS')));
  }
  // connector axes in the section (the drilled length from the face)
  for (const h of holes.filter((x) => !x.exit)) {
    const n = POST_FACES[h.faceId].normal;
    const ax = { x: -n.y, y: n.x };
    const pt = (k) => ({ u: mid.u + n.x * k + ax.x * h.s, v: mid.v + n.y * k + ax.y * h.s });
    out.push(lineEntity(pt(size / 2), pt(size / 2 - Math.min(h.depthMm, size)), 'JOINTS'));
  }
  out.push(textEntity('przekroj (rzut)', { u: su, v: sv - 45 }, 10, 'TEXT'));
  return out;
}

function postTitleLines(post, pockets = [], holes = [], weakening = null) {
  const height = post.elevation.top - post.elevation.bottom;
  const drilled = holes.filter((h) => !h.exit);
  return [
    `Slup: ${post.postId}`,
    `Rodzaj: ${POST_KIND_LABELS_PL[post.kind] || post.kind}`,
    `Przekroj: ${post.size} x ${post.size} mm`,
    `Dlugosc: ${Math.round(height)} mm`,
    pockets.length ? `Gniazda (wregi): ${pockets.length} - rozwiniecie 4 licow ${POST_FACE_ORDER.join(', ')}` : 'Bez gniazd - rozwiniecie 4 licow',
    drilled.length ? `Otwory na laczniki: ${drilled.length}${drilled.some((h) => h.through) ? ' (przelotowe - wyjscie na licu przeciwnym)' : ''}` : null,
    weakening ? `Najslabszy przekroj netto: ${Math.round(weakening.netFraction * 100)} % na wys. ${Math.round(weakening.zMm - post.elevation.bottom)} mm od dolu` : null,
    'Skala 1:1 - wszystkie wymiary w mm',
  ].filter(Boolean);
}

function isValidPost(post) {
  return !!post && !post.removed && post.elevation?.top > post.elevation?.bottom && post.size > 0;
}

/**
 * One post, full size, as a standalone DXF: its four faces unfolded with the pockets machined into them (from the
 * joint model — jointSolver.js pocketsByPost[postId]), a plan section and a title block.
 */
export function buildPostDXF(post, pockets = [], { holes = [], weakening = null } = {}) {
  if (!isValidPost(post)) return null;
  const height = post.elevation.top - post.elevation.bottom;
  const entities = [...postEntities(post, pockets || [], 0, holes || []), ...titleEntities(postTitleLines(post, pockets || [], holes || [], weakening), { minU: 0, maxV: height })];
  return wrapDxf(entities);
}

/** Every post the stair actually has (removed ones excluded), laid out side by side on one sheet. */
export function buildAllPostsDXF(posts, pocketsByPost = {}, { holesByPost = {}, postWeakening = {} } = {}) {
  const valid = (posts || []).filter(isValidPost);
  if (valid.length === 0) return null;
  const entities = [];
  let cursor = 0;
  for (const post of valid) {
    const height = post.elevation.top - post.elevation.bottom;
    const pockets = pocketsByPost?.[post.postId] || [];
    const holes = holesByPost?.[post.postId] || [];
    entities.push(...postEntities(post, pockets, cursor, holes), ...titleEntities(postTitleLines(post, pockets, holes, postWeakening?.[post.postId]), { minU: cursor, maxV: height }));
    cursor += postBlockWidth(post) + POST_GAP_MM;
  }
  return wrapDxf(entities);
}

// --- treads (stopnie) ------------------------------------------------------------------------------
//
// TreadModel.outline (treadSolver.js) is the FINAL, nosed footprint — the real as-built shape,
// already reflecting any manual edge override/overhang, exactly what the 2D plan and 3D view
// show — so, unlike a post's plain section or a stringer's solved profile, there is no separate
// "construction geometry" layer to read here: the outline itself IS the cutting contour.

const TREAD_TYPE_LABELS_PL = Object.freeze({ straight: 'prosty', winder: 'zabiegowy', landing: 'podest' });
// Real gap (mm) between treads laid out on one sheet — its own constant for the same reason
// BOARD_GAP_MM/POST_GAP_MM are: each element's own footprint sets its own comfortable spacing.
const TREAD_GAP_MM = 200;

// A tread's outline lives in the STAIR's plan (global x,y), at whatever orientation its own walk
// direction happens to have (a winder tread can face any angle) — rotated here into the tread's
// OWN local frame (u along its own walking direction, matching stockGeometry.js's
// `boundingRectAlong`) and shifted so its own bounding box starts at (0,0), the same convention
// every other DXF entry point in this file already uses for its own local frame.
function treadLocalFrame(tread) {
  const forward = tread.direction;
  const across = { u: -forward.y, v: forward.x };
  const rotate = (p) => ({ u: p.x * forward.x + p.y * forward.y, v: p.x * across.u + p.y * across.v });
  const bounds = boundsOfPoints(tread.outline.map(rotate));
  return (p) => {
    const r = rotate(p);
    return { u: r.u - bounds.minU, v: r.v - bounds.minV };
  };
}

// A cantilever tread's box (cantileverModel.js): in plan, the boards under the top (front / back / side / bottom,
// NOTCH layer) and the steel profiles it slides onto (JOINTS layer) — the top outline itself is the OUTLINE.
const CANTILEVER_PART_LABELS_DXF = { top: 'gora', front: 'front', back: 'tyl', bottom: 'spod', side: 'bok' };
function cantileverEntities(tread, offsetU) {
  if (!tread.cantilever) return [];
  const toLocal = treadLocalFrame(tread);
  const at = (p) => {
    const q = toLocal(p);
    return { u: q.u + offsetU, v: q.v };
  };
  const out = [];
  for (const part of tread.cantilever.parts.filter((x) => x.kind !== 'top')) out.push(...polygonEntities(part.outline.map(at), 'NOTCH'));
  for (const pr of tread.cantilever.profiles) {
    const n = { x: -pr.dir.y, y: pr.dir.x };
    const h = pr.widthMm / 2;
    const corner = (along, side) => at({ x: pr.start.x + pr.dir.x * along + n.x * side, y: pr.start.y + pr.dir.y * along + n.y * side });
    out.push(...polygonEntities([corner(0, -h), corner(pr.lengthMm, -h), corner(pr.lengthMm, h), corner(0, h)], 'JOINTS'));
  }
  return out;
}

function cantileverTitleLines(tread) {
  if (!tread.cantilever) return [];
  const c = tread.cantilever;
  const pr = c.profiles[0];
  return [
    `Stopien wspornikowy - okladzina (skrzynka) wys. ${Math.round(c.heightMm)} mm:`,
    ...c.parts.map((p) => `  ${CANTILEVER_PART_LABELS_DXF[p.kind] || p.kind} ${p.thicknessMm} mm: formatka ${Math.round(p.blank.lengthMm)} x ${Math.round(p.blank.widthMm)} mm`),
    pr ? `Profile: ${c.profiles.length} x ${pr.widthMm}x${pr.heightMm} mm, wysieg ${Math.round(pr.lengthMm)} mm (warstwa JOINTS)` : 'Profile: brak miejsca - sprawdz Walidacje',
  ];
}

function localTreadOutline(tread) {
  const toLocal = treadLocalFrame(tread);
  return tread.outline.map(toLocal);
}

// The groove routed into the tread's UNDERSIDE for the riser's top overlap (TreadModel.notch,
// treadSolver.js buildNotch): in plan, the strip between the structural front edge and that edge
// receded by the riser thickness. Drawn on its own layer with its depth, so the workshop sees
// where and how deep to mill it (from below) — the outline itself never changes.
function treadNotchEntities(tread, offsetU) {
  const notch = tread.notch;
  if (!notch || !Array.isArray(notch.outline) || notch.outline.length !== tread.outline.length) return [];
  const toLocal = treadLocalFrame(tread);
  const receded = [];
  notch.outline.forEach((p, i) => {
    const o = tread.outline[i];
    if (Math.hypot(p.x - o.x, p.y - o.y) > 1e-6) receded.push(p);
  });
  const front = tread.frontEdge?.final;
  if (receded.length !== 2 || !front) return [];
  const nearest = (r) => (Math.hypot(front[0].x - r.x, front[0].y - r.y) <= Math.hypot(front[1].x - r.x, front[1].y - r.y) ? front[0] : front[1]);
  const [ra, rb] = receded;
  const strip = [nearest(ra), nearest(rb), rb, ra].map(toLocal).map((p) => ({ u: p.u + offsetU, v: p.v }));
  const out = polygonEntities(strip, 'NOTCH');
  out.push(textEntity(`rowek od spodu gl. ${Math.round(notch.depthMm)} mm`, { u: strip[3].u, v: strip[3].v - 15 }, 12, 'NOTCH'));
  return out;
}

function isValidTread(tread) {
  return !!tread && Array.isArray(tread.outline) && tread.outline.length >= 3;
}

// Stage 2 of the joints (jointSolver.js): a tread passing through a structural post is cut around it (`cut.outline`,
// `cut.holes`) and enters the post's pockets. The drawing shows the CUT outline, the post's outline over the tread
// (layer JOINTS — the strip between it and the cut is the tongue that goes into the post) and a title line per post.
// `joint` = { cut, posts: [{postId, position, size, depthMm}] } or null.
function treadJointEntities(tread, joint, offsetU) {
  if (!joint?.posts?.length) return [];
  const toLocal = treadLocalFrame(tread);
  const out = [];
  for (const p of joint.posts) {
    const h = p.size / 2;
    const sq = [
      { x: p.position.x - h, y: p.position.y - h },
      { x: p.position.x + h, y: p.position.y - h },
      { x: p.position.x + h, y: p.position.y + h },
      { x: p.position.x - h, y: p.position.y + h },
    ].map((q) => {
      const l = toLocal(q);
      return { u: l.u + offsetU, v: l.v };
    });
    out.push(...polygonEntities(sq, 'JOINTS'));
    out.push(textEntity(`slup ${p.postId}`, { u: Math.min(...sq.map((q) => q.u)), v: Math.min(...sq.map((q) => q.v)) - 14 }, 10, 'JOINTS'));
  }
  return out;
}

function treadCutOutline(tread, joint, offsetU) {
  const toLocal = treadLocalFrame(tread);
  const shift = (poly) => poly.map((q) => {
    const l = toLocal(q);
    return { u: l.u + offsetU, v: l.v };
  });
  const outer = joint?.cut ? shift(joint.cut.outline) : shift(tread.outline);
  const holes = joint?.cut ? (joint.cut.holes || []).map(shift) : [];
  return [...polygonEntities(outer, 'OUTLINE'), ...holes.flatMap((h) => polygonEntities(h, 'OUTLINE'))];
}

function treadTitleLines(tread, joint = null) {
  const typeLabel = TREAD_TYPE_LABELS_PL[tread.type] || tread.type;
  const lines = [
    `Stopien: ${tread.stepId}`,
    `Typ: ${typeLabel}`,
    `Szerokosc (czolo/tyl): ${Math.round(tread.widths.atFront)} / ${Math.round(tread.widths.atBack)} mm`,
    `Grubosc: ${tread.thickness} mm`,
  ];
  // The winder blank (winderBlank.js computeWinderBlank) is the same PRODUCTION rectangle the
  // takeoff/2D-plan/3D labels already use as the raw board to cut this tread from — worth stating
  // alongside the finished outline above, not instead of it.
  if (tread.winderBlank) lines.push(`Formatka surowa: ${Math.round(tread.winderBlank.length)} x ${Math.round(tread.winderBlank.depth)} mm`);
  lines.push(...cantileverTitleLines(tread));
  for (const p of joint?.posts || []) {
    lines.push(p.depthMm > 0 ? `Wyciecie wokol slupa ${p.postId}, wpust w slup gl. ${Math.round(p.depthMm)} mm` : `Wyciecie wokol slupa ${p.postId} (do lica)`);
  }
  lines.push('Skala 1:1 - wszystkie wymiary w mm');
  return lines;
}

/**
 * One tread, full size, as a standalone DXF: its real (nosed) outline — cut around a structural post it passes through
 * (`joint`, stage 2 of the joints) — + a title block.
 */
export function buildTreadDXF(tread, joint = null) {
  if (!isValidTread(tread)) return null;
  const local = localTreadOutline(tread);
  const entities = [...treadCutOutline(tread, joint, 0), ...treadNotchEntities(tread, 0), ...treadJointEntities(tread, joint, 0), ...cantileverEntities(tread, 0), ...titleEntities(treadTitleLines(tread, joint), boundsOfPoints(local))];
  return wrapDxf(entities);
}

/** Every tread the stair has, laid out side by side on one sheet, each in its own local frame. */
export function buildAllTreadsDXF(treads, jointsByStep = {}) {
  const valid = (treads || []).filter(isValidTread);
  if (valid.length === 0) return null;
  const entities = [];
  let cursor = 0;
  for (const tread of valid) {
    const local = localTreadOutline(tread);
    const bounds = boundsOfPoints(local);
    const offsetU = cursor - bounds.minU;
    cursor = offsetU + bounds.maxU + TREAD_GAP_MM;
    const shifted = local.map((p) => ({ u: p.u + offsetU, v: p.v }));
    const joint = jointsByStep[tread.stepId] || null;
    entities.push(...treadCutOutline(tread, joint, offsetU), ...treadNotchEntities(tread, offsetU), ...treadJointEntities(tread, joint, offsetU), ...cantileverEntities(tread, offsetU), ...titleEntities(treadTitleLines(tread, joint), boundsOfPoints(shifted)));
  }
  return wrapDxf(entities);
}

// --- balustrade (poręcz + tralki) — ONE sheet ------------------------------------------------------
//
// Everything a workshop needs to cut the balustrade, full size: every handrail piece in its own side view (true
// axis length, its two cuts drawn and labelled — the cut angles come from the RailingModel, railingSolver.js
// annotateCuts; nothing is computed here), then the baluster cut list grouped by length and end cuts, each group
// drawn once. Plan (mitre) angles cannot be shown in a side view, so they are stated in the labels.

const RAIL_TEXT_LINES = 3;
const RAIL_ROW_GAP_MM = 120;
const RAIL_SIDE_LABELS = Object.freeze({ outer: 'zewn.', inner: 'wewn.' });
const ANGLE_DIGITS = 1;

const tanDeg = (d) => Math.tan((d * Math.PI) / 180);
// ASCII only in a DXF (see stripDiacritics): 'st.' instead of the degree sign, Polish decimal comma.
const angleText = (d) => `${Math.abs(d).toFixed(ANGLE_DIGITS).replace('.', ',')} st.`;

// A bar of length L and depth h in its own side view (u along the axis, v across, axis at v = 0), its start cut
// through u = 0 and end cut through u = L at the given angles from the square cut (railingSolver.js convention: the
// cut reaches the top edge at u = +(h/2)·tan(start) and at u = L − (h/2)·tan(end)).
function cutBarOutline(L, h, startDeg, endDeg, offsetU, offsetV) {
  const h2 = h / 2;
  const s = h2 * tanDeg(startDeg);
  const e = h2 * tanDeg(endDeg);
  return [
    { u: offsetU - s, v: offsetV - h2 },
    { u: offsetU + L + e, v: offsetV - h2 },
    { u: offsetU + L - e, v: offsetV + h2 },
    { u: offsetU + s, v: offsetV + h2 },
  ];
}

// The development of a bent handrail run: its axis (u = distance along the plan path, v = height) and the top and
// bottom edges h/2 either side of it, square to the axis (railingSolver.js already sampled it densely).
function developRun(run, depthMm) {
  const axis = [];
  let u = 0;
  run.pieces.forEach((piece, i) => {
    if (i === 0) axis.push({ u: 0, v: piece.start.z });
    u += Math.hypot(piece.end.x - piece.start.x, piece.end.y - piece.start.y);
    axis.push({ u, v: piece.end.z });
  });
  const half = depthMm / 2;
  const normalAt = (i) => {
    const a = axis[Math.max(0, i - 1)];
    const b = axis[Math.min(axis.length - 1, i + 1)];
    const len = Math.hypot(b.u - a.u, b.v - a.v) || 1;
    return { u: -(b.v - a.v) / len, v: (b.u - a.u) / len }; // left of the direction of travel = up
  };
  const top = axis.map((p, i) => ({ u: p.u + normalAt(i).u * half, v: p.v + normalAt(i).v * half }));
  const bottom = axis.map((p, i) => ({ u: p.u - normalAt(i).u * half, v: p.v - normalAt(i).v * half }));
  return { axis, top, bottom, planLengthMm: u, riseMm: axis[axis.length - 1].v - axis[0].v, baseV: axis[0].v };
}

function railCutText(cut) {
  if (!cut) return 'prosto';
  return cut.kind === 'post' ? `pion ${angleText(cut.verticalDeg)} (przy slupku)` : `pion ${angleText(cut.verticalDeg)}, rzut ${angleText(cut.planDeg)} (laczenie)`;
}

/**
 * The whole balustrade on one 1:1 sheet: handrail pieces (side view, cuts drawn and labelled) and the baluster cut
 * list. `null` when there is nothing to draw (no balustrade, no valid section).
 * @param {import('../geometry/railingSolver.js').RailingModel} railingModel
 * @param {{balusterSizeMm?:number}} [options]
 */
export function buildRailingDXF(railingModel, { balusterSizeMm } = {}) {
  const sections = (railingModel?.sections || []).filter((s) => s.valid && s.handrail?.pieces?.length > 0);
  if (!railingModel?.enabled || sections.length === 0) return null;
  const entities = [];
  let cursor = 0; // v of the next row's top; rows go downward
  const row = (height, lines, drawAt) => {
    const textTop = cursor;
    lines.forEach((line, i) => entities.push(textEntity(line, { u: 0, v: textTop - (i + 1) * TITLE_LINE_HEIGHT_MM }, TITLE_TEXT_HEIGHT_MM, 'TEXT')));
    const centreV = textTop - RAIL_TEXT_LINES * TITLE_LINE_HEIGHT_MM - TITLE_MARGIN_MM - height / 2;
    drawAt(centreV);
    cursor = centreV - height / 2 - RAIL_ROW_GAP_MM;
  };

  const header = [
    'Balustrada - skala 1:1, wszystkie wymiary w mm',
    'Katy ciecia: pion - od ciecia prostopadlego do osi (widok z boku), rzut - polowa kata skretu na laczeniu',
    'Tralki: dol przy wandze wpuszczanej przyjety rownolegle do poreczy (przyblizenie)',
  ];
  row(0, header, () => {});

  for (const section of sections) {
    const { heightMm: h, widthMm: w, shape } = section.handrail;
    const profile = shape === 'round' ? `okragla d${w}` : `${w}x${h}`;
    section.runs.forEach((run, r) => {
      if (run.bent) {
        // A bent run is one piece: drawn as its DEVELOPMENT — the axis unrolled along the plan path (u) against its
        // height (v), with the rail's depth either side (a workshop template for bending/laminating it).
        const dev = developRun(run, h);
        const length = run.pieces.reduce((sum, piece) => sum + piece.lengthMm, 0);
        const lines = [
          `Porecz GIETA ${section.id} (${RAIL_SIDE_LABELS[section.side] || section.side}) - bieg ${r + 1}, przekroj ${profile}`,
          `Os 3D: ${Math.round(length)} mm; rozwiniecie: dl. w rzucie ${Math.round(dev.planLengthMm)} mm, wzniesienie ${Math.round(dev.riseMm)} mm`,
          `Konce: ${railCutText(run.pieces[0].startCut)}; ${railCutText(run.pieces[run.pieces.length - 1].endCut)}`,
        ];
        const heightSpan = dev.riseMm + h;
        row(heightSpan, lines, (v) => {
          const shift = (p) => ({ u: p.u, v: p.v - dev.riseMm / 2 + v - dev.baseV });
          for (const edge of [dev.top, dev.bottom]) {
            for (let i = 1; i < edge.length; i++) entities.push(lineEntity(shift(edge[i - 1]), shift(edge[i]), 'OUTLINE'));
          }
          entities.push(lineEntity(shift(dev.top[0]), shift(dev.bottom[0]), 'OUTLINE'));
          entities.push(lineEntity(shift(dev.top[dev.top.length - 1]), shift(dev.bottom[dev.bottom.length - 1]), 'OUTLINE'));
        });
        return;
      }
      run.pieces.forEach((piece, p) => {
        const lines = [
          `Porecz ${section.id} (${RAIL_SIDE_LABELS[section.side] || section.side}) - bieg ${r + 1}, element ${p + 1}, przekroj ${profile}`,
          `Os: ${Math.round(piece.lengthMm)} mm, do ciecia: ${Math.round(piece.cutLengthMm ?? piece.lengthMm)} mm, nachylenie ${angleText(piece.pitchDeg ?? 0)}`,
          `Poczatek: ${railCutText(piece.startCut)}; koniec: ${railCutText(piece.endCut)}`,
        ];
        row(h, lines, (v) => entities.push(...polygonEntities(cutBarOutline(piece.lengthMm, h, piece.startCut?.verticalDeg ?? 0, piece.endCut?.verticalDeg ?? 0, 0, v), 'OUTLINE')));
      });
    });
  }

  // base rail (podporęcz, housed wanga only): its straight pieces, drawn and labelled like the handrail pieces
  for (const section of sections.filter((sec) => sec.baseRail?.pieces?.length)) {
    const { heightMm: h, widthMm: w } = section.baseRail;
    section.baseRail.pieces.forEach((piece, p) => {
      const lines = [
        `Podporecz ${section.id} (${RAIL_SIDE_LABELS[section.side] || section.side}) - element ${p + 1}, przekroj ${w}x${h}`,
        `Os: ${Math.round(piece.lengthMm)} mm, do ciecia: ${Math.round(piece.cutLengthMm ?? piece.lengthMm)} mm, nachylenie ${angleText(piece.pitchDeg ?? 0)}`,
        `Poczatek: ${railCutText(piece.startCut)}; koniec: ${railCutText(piece.endCut)}`,
      ];
      row(h, lines, (v) => entities.push(...polygonEntities(cutBarOutline(piece.lengthMm, h, piece.startCut?.verticalDeg ?? 0, piece.endCut?.verticalDeg ?? 0, 0, v), 'OUTLINE')));
    });
  }

  // glass panes (railingGlass.js): each pane 1:1 in its own frame — its real outline, the rectangle it is cut from,
  // and its fixings measured from the rectangle's lower-left corner (rotule = a hole, clamp = where the clamp grips)
  for (const section of (railingModel.sections || []).filter((sec) => sec.valid && sec.glassPanes?.length)) {
    section.glassPanes.forEach((pane, k) => {
      const W = pane.blank.widthMm;
      const H = pane.blank.heightMm;
      const rel = (f) => `(${Math.round(f.t)}, ${Math.round(f.z - pane.zMin)})`;
      const kindLabel = pane.fixings[0]?.kind === 'rotule' ? `rotule O${ROTULE_DIAMETER_MM} (otwor w szkle wg producenta rotuli)` : 'uchwyty na slupkach (bez otworow)';
      const lines = [
        `Tafla ${k + 1} ${section.id} (${RAIL_SIDE_LABELS[section.side] || section.side}): ${stripDiacritics(section.glass?.label || 'VSG')}, prostokat ${Math.round(W)} x ${Math.round(H)} mm, pow. ${(pane.areaMm2 / 1e6).toFixed(3)} m2`,
        `Mocowania: ${pane.fixings.length} - ${kindLabel}`,
        `Od lewego dolnego rogu prostokata [mm]: ${pane.fixings.map(rel).join(' ')}`,
      ];
      row(H, lines, (v) => {
        const base = v - H / 2;
        const at = (t, z) => ({ u: t, v: base + (z - pane.zMin) });
        entities.push(...polygonEntities(pane.outline.map((q) => at(q.t, q.z)), 'OUTLINE'));
        entities.push(...rectLines(0, base, W, base + H, 'BEARINGS'));
        for (const f of pane.fixings) {
          const c = at(f.t, f.z);
          if (f.kind === 'rotule') entities.push(circleEntity(c, ROTULE_DIAMETER_MM / 2, 'JOINTS'));
          else entities.push(...rectLines(Math.max(0, c.u - 22), c.v - 30, Math.min(W, c.u + 22), c.v + 30, 'JOINTS'));
        }
      });
    });
  }

  // baluster cut list: one row per (section, length, top cut, bottom cut), drawn lying down (bottom end at u = 0)
  const size = balusterSizeMm || 30;
  for (const section of sections) {
    const groups = new Map();
    for (const b of section.balusters) {
      const key = [Math.round(b.heightMm), (b.topCutDeg ?? 0).toFixed(ANGLE_DIGITS), (b.bottomCutDeg ?? 0).toFixed(ANGLE_DIGITS)].join('|');
      const g = groups.get(key) || { heightMm: Math.round(b.heightMm), topCutDeg: b.topCutDeg ?? 0, bottomCutDeg: b.bottomCutDeg ?? 0, longPointMm: b.longPointMm ?? b.heightMm, count: 0 };
      g.count += 1;
      groups.set(key, g);
    }
    [...groups.values()]
      .sort((a, b) => a.heightMm - b.heightMm)
      .forEach((g) => {
        const lines = [
          `Tralka ${section.id} (${RAIL_SIDE_LABELS[section.side] || section.side}): ${g.count} szt, przekroj ${size}`,
          `Os: ${g.heightMm} mm, dl. max: ${Math.round(g.longPointMm)} mm`,
          `Gora: ${angleText(g.topCutDeg)} od poziomu; dol: ${angleText(g.bottomCutDeg)} od poziomu`,
        ];
        // lying down: u = along the baluster (bottom at 0), v = across; the cuts are the pitch from the square cut
        row(size, lines, (v) => entities.push(...polygonEntities(cutBarOutline(g.heightMm, size, g.bottomCutDeg, g.topCutDeg, 0, v), 'OUTLINE')));
      });
  }
  return wrapDxf(entities);
}
