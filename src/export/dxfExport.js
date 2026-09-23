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
    const label = h.kind === 'riser' ? 'wpust podstopnia' : 'wpust';
    out.push(textEntity(`${label} gl. ${Math.round(h.depth)} mm`, { u: corners[0].u, v: corners[0].v - 15 }, 12, 'HOUSINGS'));
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

function titleLines(geometry, config) {
  const typeLabel = CONSTRUCTION_TYPE_LABELS_PL[geometry.constructionType] || geometry.constructionType;
  return [
    `Deska: ${geometry.segmentId}`,
    `Typ: ${typeLabel}`,
    geometry.localDepthMm != null ? `Glebokosc lokalna min.: ${Math.round(geometry.localDepthMm)} mm` : null,
    config?.stringerThickness ? `Grubosc materialu: ${config.stringerThickness} mm` : null,
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
  const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4', ...layer('OUTLINE', 7), ...layer('HOUSINGS', 1), ...layer('BEARINGS', 5), ...layer('TEXT', 3), '0', 'ENDTAB', '0', 'ENDSEC'];
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
export function buildStringerBoardDXF(geometry, { segment, config } = {}) {
  const outline = buildBoardOutlineCurve(geometry);
  if (!outline) return null;
  const bounds = boundsOf(outline);
  const entities = [curveToEntities(outline, 'OUTLINE'), ...housingEntities(geometry, 0), ...bearingEntities(segment, 0), ...titleEntities(titleLines(geometry, config), bounds)];
  return wrapDxf(entities);
}

/**
 * Every board of one stringer side, laid out left to right with a real gap between them, in ONE
 * DXF — an overview sheet rather than a per-board file. `model` (the StringerModel for this side,
 * for treadBearings) and `config` are optional, same as above.
 */
export function buildStringerAllBoardsDXF(geometries, { model, config } = {}) {
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
    entities.push(curveToEntities(shifted, 'OUTLINE'), ...housingEntities(geometry, offsetU), ...bearingEntities(segment, offsetU));
    entities.push(...titleEntities(titleLines(geometry, config), boundsOf(shifted)));
  }
  if (!any) return null;
  return wrapDxf(entities);
}

// --- posts (slupy) ---------------------------------------------------------------------------------
//
// A post (PostModel, postSolver.js) is deliberately a plain square prism — position, a square
// section (config.postSize) and a top/bottom elevation, no joinery geometry — so its production
// drawing is just that: a rectangle (section width x real length), no curves, no housings.

const POST_KIND_LABELS_PL = Object.freeze({ start: 'poczatkowy', end: 'koncowy', corner: 'narozny' });
// Real gap (mm) between posts laid out on one sheet — same spirit as BOARD_GAP_MM above, its own
// constant because a post's own footprint (its section width) is much smaller than a board's.
const POST_GAP_MM = 150;

function postRectEntities(post, offsetU) {
  const height = post.elevation.top - post.elevation.bottom;
  const corners = [
    { u: offsetU, v: 0 },
    { u: offsetU + post.size, v: 0 },
    { u: offsetU + post.size, v: height },
    { u: offsetU, v: height },
  ];
  const out = [];
  for (let i = 0; i < 4; i++) out.push(lineEntity(corners[i], corners[(i + 1) % 4], 'OUTLINE'));
  return out;
}

function postTitleLines(post) {
  const height = post.elevation.top - post.elevation.bottom;
  return [
    `Slup: ${post.postId}`,
    `Rodzaj: ${POST_KIND_LABELS_PL[post.kind] || post.kind}`,
    `Przekroj: ${post.size} x ${post.size} mm`,
    `Dlugosc: ${Math.round(height)} mm`,
    'Skala 1:1 - wszystkie wymiary w mm',
  ];
}

function isValidPost(post) {
  return !!post && !post.removed && post.elevation?.top > post.elevation?.bottom && post.size > 0;
}

/** One post, full size, as a standalone DXF: a plain section-width x length rectangle + title block. */
export function buildPostDXF(post) {
  if (!isValidPost(post)) return null;
  const height = post.elevation.top - post.elevation.bottom;
  const entities = [...postRectEntities(post, 0), ...titleEntities(postTitleLines(post), { minU: 0, maxV: height })];
  return wrapDxf(entities);
}

/** Every post the stair actually has (removed ones excluded), laid out side by side on one sheet. */
export function buildAllPostsDXF(posts) {
  const valid = (posts || []).filter(isValidPost);
  if (valid.length === 0) return null;
  const entities = [];
  let cursor = 0;
  for (const post of valid) {
    const height = post.elevation.top - post.elevation.bottom;
    entities.push(...postRectEntities(post, cursor), ...titleEntities(postTitleLines(post), { minU: cursor, maxV: height }));
    cursor += post.size + POST_GAP_MM;
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
function localTreadOutline(tread) {
  const forward = tread.direction;
  const across = { u: -forward.y, v: forward.x };
  const raw = tread.outline.map((p) => ({ u: p.x * forward.x + p.y * forward.y, v: p.x * across.u + p.y * across.v }));
  const bounds = boundsOfPoints(raw);
  return raw.map((p) => ({ u: p.u - bounds.minU, v: p.v - bounds.minV }));
}

function isValidTread(tread) {
  return !!tread && Array.isArray(tread.outline) && tread.outline.length >= 3;
}

function treadTitleLines(tread) {
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
  lines.push('Skala 1:1 - wszystkie wymiary w mm');
  return lines;
}

/** One tread, full size, as a standalone DXF: its real (nosed) outline + a title block. */
export function buildTreadDXF(tread) {
  if (!isValidTread(tread)) return null;
  const local = localTreadOutline(tread);
  const entities = [...polygonEntities(local, 'OUTLINE'), ...titleEntities(treadTitleLines(tread), boundsOfPoints(local))];
  return wrapDxf(entities);
}

/** Every tread the stair has, laid out side by side on one sheet, each in its own local frame. */
export function buildAllTreadsDXF(treads) {
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
    entities.push(...polygonEntities(shifted, 'OUTLINE'), ...titleEntities(treadTitleLines(tread), boundsOfPoints(shifted)));
  }
  return wrapDxf(entities);
}
