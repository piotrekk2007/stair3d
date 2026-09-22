// DXF EXPORT — a real-size (1:1, mm), production-ready cutting/marking drawing of one stringer
// board, or of every board of one stringer side laid out on one sheet. Pure serialization: every
// number comes straight from an already-solved StringerSegmentConstructionGeometry (see
// stringerConstructionGeometry.js) plus, for tread-position markers, the matching StringerModel
// segment — nothing here decides any geometry, exactly like the other export/ adapters
// (objExporter.js, daeExporter.js, takeoff/export/). No DOM.
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

function boundsOf(curve) {
  const pts = curveToPolyline(curve);
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
  if (dist(bottomStart, topStart) > GEOMETRY_EPS) parts.push(lineSegment(bottomStart, topStart));
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
    out.push(textEntity(`wpust gl. ${Math.round(h.depth)} mm`, { u: corners[0].u, v: corners[0].v - 15 }, 12, 'HOUSINGS'));
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
