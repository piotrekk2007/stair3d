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

function titleLines(geometry, config) {
  const typeLabel = CONSTRUCTION_TYPE_LABELS_PL[geometry.constructionType] || geometry.constructionType;
  return [
    `Deska: ${geometry.segmentId}`,
    `Typ: ${typeLabel}`,
    geometry.localDepthMm != null ? `Glebokosc lokalna min.: ${Math.round(geometry.localDepthMm)} mm` : null,
    config?.stringerThickness ? `Grubosc materialu: ${config.stringerThickness} mm` : null,
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
  const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '5', ...layer('OUTLINE', 7), ...layer('HOUSINGS', 1), ...layer('NOTCH', 6), ...layer('BEARINGS', 5), ...layer('TEXT', 3), '0', 'ENDTAB', '0', 'ENDSEC'];
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
  const entities = [...polygonEntities(local, 'OUTLINE'), ...treadNotchEntities(tread, 0), ...titleEntities(treadTitleLines(tread), boundsOfPoints(local))];
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
    entities.push(...polygonEntities(shifted, 'OUTLINE'), ...treadNotchEntities(tread, offsetU), ...titleEntities(treadTitleLines(tread), boundsOfPoints(shifted)));
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
