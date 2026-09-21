// PROFILE EDITOR RENDERER — pure functions that turn StringerProfileViewModel data
// (src/geometry/stringerProfileView.js) into an SVG string of the stringer's SIDE VIEW, plus the layout
// math that maps between screen/SVG space and each board's own (u,v) frame. No DOM, no Three.js, and —
// like plan2dRenderer.js — no geometry decisions: everything drawn here was already solved, this only
// positions it. Editing never happens here: the interaction module turns a drag into a PROFILE_EDITS
// event, which changes the override layer and goes through the normal rebuild() -> solve -> render path.
//
// SVG space: x = u + segment.offsetX, y = -v (SVG's y axis points down, elevation points up).

import { curveToPolyline } from '../geometry/profileCurve.js';

// Chord tolerance used when the contours are drawn (mm in profile space) — drawing only.
export const EDITOR_CHORD_TOLERANCE_MM = 0.5;
// Blank space between two boards laid out side by side.
export const SEGMENT_GAP_MM = 350;
// Margin around the content when fitting the view.
export const EDITOR_FIT_MARGIN_MM = 250;

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/**
 * Lays the boards of one stringer out left to right, each in its own local frame shifted by `offsetX`.
 * @param {ReturnType<import('../geometry/stringerProfileView.js').buildProfileViewModel>} views
 */
export function layoutSegments(views) {
  const layout = [];
  let cursor = 0;
  for (const view of views) {
    const uMin = view.span.uStart;
    const uMax = view.span.uEnd;
    const offsetX = cursor - uMin;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of view.outline) {
      vMin = Math.min(vMin, p.v);
      vMax = Math.max(vMax, p.v);
    }
    for (const t of view.treads) vMax = Math.max(vMax, t.zTop);
    if (!Number.isFinite(vMin)) {
      vMin = 0;
      vMax = 1;
    }
    layout.push({ segmentId: view.segmentId, offsetX, uMin, uMax, vMin, vMax });
    cursor = offsetX + uMax + SEGMENT_GAP_MM;
  }
  return layout;
}

/** Bounding box of everything drawn, in SVG space, with the floor line included. */
export function contentBounds(layout) {
  if (layout.length === 0) return { minX: 0, maxX: 1000, minY: -1000, maxY: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const seg of layout) {
    minX = Math.min(minX, seg.offsetX + seg.uMin);
    maxX = Math.max(maxX, seg.offsetX + seg.uMax);
    minV = Math.min(minV, seg.vMin);
    maxV = Math.max(maxV, seg.vMax);
  }
  minV = Math.min(minV, 0);
  return { minX, maxX, minY: -maxV, maxY: -minV };
}

export function toSvg(seg, u, v) {
  return { x: u + seg.offsetX, y: -v };
}

/**
 * The board a point of the SVG plane belongs to and its (u,v) in that board's own frame. A point in the
 * gap between two boards belongs to the nearer one.
 */
export function fromSvg(layout, x, y) {
  let best = 0;
  let bestDist = Infinity;
  layout.forEach((seg, i) => {
    const left = seg.offsetX + seg.uMin;
    const right = seg.offsetX + seg.uMax;
    const d = x < left ? left - x : x > right ? x - right : 0;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  const seg = layout[best];
  return { index: best, segmentId: seg.segmentId, u: x - seg.offsetX, v: -y };
}

function polylinePoints(seg, points) {
  return points.map((p) => {
    const s = toSvg(seg, p.u, p.v);
    return `${fmt(s.x)},${fmt(s.y)}`;
  }).join(' ');
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {Object[]} views  buildProfileViewModel() output for ONE stringer
 * @param {Object} options
 * @param {{x:number,y:number,width:number,height:number}} options.viewport  visible rectangle (SVG viewBox)
 * @param {number} options.pxToMm  how many mm of SVG space one screen pixel covers — keeps handles and text a
 *   constant on-screen size whatever the zoom
 * @param {{id:string, contour:string}|null} [options.selected]  the selected control point
 * @param {{reference?:boolean, envelope?:boolean, treads?:boolean}} [options.layers]
 * @returns {{svg:string, layout:Object[]}}
 */
export function renderProfileEditorSVG(views, options) {
  const { viewport, pxToMm, selected = null, layers = {} } = options;
  const layout = layoutSegments(views);
  const px = (n) => fmt(n * pxToMm);
  const bounds = contentBounds(layout);
  const parts = [];

  // floor line
  parts.push(`<line class="pe-floor" x1="${fmt(bounds.minX - 2000)}" y1="0" x2="${fmt(bounds.maxX + 2000)}" y2="0"/>`);

  views.forEach((view, i) => {
    const seg = layout[i];
    const draw = (curve) => curveToPolyline(curve || [], EDITOR_CHORD_TOLERANCE_MM);
    const g = [];
    g.push(`<g class="pe-segment" data-seg-index="${i}" data-seg-id="${escapeHtml(view.segmentId)}">`);

    // silhouette
    g.push(`<polygon class="pe-outline" points="${polylinePoints(seg, view.outline)}"/>`);

    // treads and risers
    if (layers.treads !== false) {
      for (const t of view.treads) {
        const a = toSvg(seg, t.uStart, t.zTop);
        g.push(`<rect class="pe-tread" x="${fmt(a.x)}" y="${fmt(a.y)}" width="${fmt(Math.max(0, t.uEnd - t.uStart))}" height="${fmt(t.zTop - t.zBottom)}"/>`);
      }
      for (const r of view.risers) {
        const a = toSvg(seg, r.u, r.zTop);
        const b = toSvg(seg, r.u, r.zBottom);
        g.push(`<line class="pe-riser" x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`);
      }
    }

    // reference curve and the minimum-depth envelope
    if (layers.reference !== false && view.referenceCurve.length >= 2) g.push(`<polyline class="pe-reference" points="${polylinePoints(seg, view.referenceCurve)}"/>`);
    if (layers.envelope !== false && view.minimumDepthEnvelope.length >= 2) g.push(`<polyline class="pe-envelope" points="${polylinePoints(seg, view.minimumDepthEnvelope)}"/>`);

    // contours (a wide transparent copy underneath is the hit area for "double-click to add a point")
    const lower = draw(view.lowerCurve);
    const violates = view.requiredDepthMm > 0 && view.localDepthMm !== null && view.localDepthMm < view.requiredDepthMm - 1e-3;
    if (lower.length >= 2) {
      g.push(`<polyline class="pe-hit" data-contour="lower" data-seg-index="${i}" points="${polylinePoints(seg, lower)}"/>`);
      g.push(`<polyline class="pe-contour pe-lower${violates ? ' violation' : ''}" points="${polylinePoints(seg, lower)}"/>`);
    }
    const upper = view.upperCurve ? draw(view.upperCurve) : [];
    if (upper.length >= 2) {
      if (view.controlPoints.some((c) => c.contour === 'upper')) g.push(`<polyline class="pe-hit" data-contour="upper" data-seg-index="${i}" points="${polylinePoints(seg, upper)}"/>`);
      g.push(`<polyline class="pe-contour pe-upper" points="${polylinePoints(seg, upper)}"/>`);
    }

    // control points (only those on this board)
    for (const c of view.controlPoints) {
      if (!c.withinSegment) continue;
      const p = toSvg(seg, c.u, c.v);
      const isSel = selected && selected.id === c.id && selected.contour === c.contour;
      const r = (isSel ? 8 : 6) * pxToMm;
      g.push(
        `<circle class="pe-cp pe-cp-${c.kind}${isSel ? ' selected' : ''}" data-cp-id="${escapeHtml(c.id)}" data-contour="${c.contour}" data-seg-index="${i}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(r)}"/>`
      );
      if (c.radiusMm > 0) g.push(`<text class="pe-radius-label" x="${fmt(p.x + 10 * pxToMm)}" y="${fmt(p.y - 8 * pxToMm)}" font-size="${px(11)}">R${Math.round(c.radiusMm)}</text>`);
    }

    // label
    const labelAt = toSvg(seg, seg.uMin, seg.vMin);
    const depth = view.localDepthMm === null ? '' : ` · głębokość min. ${Math.round(view.localDepthMm)} mm (wymagane ${Math.round(view.requiredDepthMm)})`;
    g.push(`<text class="pe-label${violates ? ' violation' : ''}" x="${fmt(labelAt.x)}" y="${fmt(labelAt.y + 26 * pxToMm)}" font-size="${px(12)}">${escapeHtml(view.segmentId)}${depth}</text>`);

    g.push('</g>');
    parts.push(g.join(''));
  });

  const svg = `<svg class="pe-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewport.x)} ${fmt(viewport.y)} ${fmt(viewport.width)} ${fmt(viewport.height)}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
  return { svg, layout };
}
