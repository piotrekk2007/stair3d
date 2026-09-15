// Pure viewport math for the 2D plan editor — no DOM, no SVG, no rendering. A "viewport" is
// simply the visible rectangle in SVG user-space (the SVG `viewBox`): { x, y, width, height }.
// Panning/zooming/fitting all reduce to computing a new such rectangle; plan2dRenderer.js
// applies it as the SVG's viewBox attribute, so zero re-layout of the drawing itself is ever
// needed — only the viewBox changes. Kept separate from planInteractions.js (which turns raw
// pointer/wheel/keyboard events into calls into this module) so the geometry of "what a zoom/
// pan/fit operation means" is independently testable.

// Prevents the viewBox from collapsing to zero (divide-by-zero on next zoom) or expanding to
// a degenerate, unusably large area — named constants per .claude/RULES.md rule 11/12, not
// magic numbers inline at each call site.
export const MIN_VIEWPORT_SIZE_MM = 20;
export const MAX_VIEWPORT_SIZE_MM = 200000;

export function createViewport(x, y, width, height) {
  return { x, y, width, height };
}

function clampSize(size) {
  return Math.min(MAX_VIEWPORT_SIZE_MM, Math.max(MIN_VIEWPORT_SIZE_MM, size));
}

// Fits `bounds` ({minX,maxX,minY,maxY}, SVG user-space) into a panel of the given pixel size,
// preserving aspect ratio (letterboxing the shorter dimension) and adding `marginMm` on every
// side. This is the "requirement 3 / 4: auto-fit + ability to zoom into detail" primitive —
// the caller decides WHEN to call it (initial load, explicit "fit" action), this function
// only computes WHERE the viewport should end up.
export function fitToBounds(bounds, panelWidthPx, panelHeightPx, marginMm) {
  const contentWidth = Math.max(1e-6, bounds.maxX - bounds.minX) + 2 * marginMm;
  const contentHeight = Math.max(1e-6, bounds.maxY - bounds.minY) + 2 * marginMm;
  const panelAspect = panelWidthPx / panelHeightPx;
  const contentAspect = contentWidth / contentHeight;

  let width, height;
  if (contentAspect > panelAspect) {
    width = contentWidth;
    height = width / panelAspect;
  } else {
    height = contentHeight;
    width = height * panelAspect;
  }

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return createViewport(cx - width / 2, cy - height / 2, clampSize(width), clampSize(height));
}

// Zooms so that the plan-space point currently under (screenX, screenY) — pixel coordinates
// within a panel of size (panelWidthPx, panelHeightPx) — stays under the cursor after the
// zoom. zoomFactor > 1 zooms IN (smaller viewBox, more magnification); < 1 zooms out.
export function zoomAt(viewport, screenX, screenY, panelWidthPx, panelHeightPx, zoomFactor) {
  const fracX = screenX / panelWidthPx;
  const fracY = screenY / panelHeightPx;
  const anchorX = viewport.x + fracX * viewport.width;
  const anchorY = viewport.y + fracY * viewport.height;

  const newWidth = clampSize(viewport.width / zoomFactor);
  const newHeight = clampSize(viewport.height / zoomFactor);

  return createViewport(anchorX - fracX * newWidth, anchorY - fracY * newHeight, newWidth, newHeight);
}

// Pans by a screen-pixel delta — dragging the pointer by (dxScreen, dyScreen) moves the
// content WITH the pointer (standard "grab and drag" panning: the viewport origin moves
// opposite to the drag direction so the point originally under the cursor ends up under it
// again at the new cursor position).
export function panBy(viewport, dxScreenPx, dyScreenPx, panelWidthPx, panelHeightPx) {
  const dx = (dxScreenPx / panelWidthPx) * viewport.width;
  const dy = (dyScreenPx / panelHeightPx) * viewport.height;
  return createViewport(viewport.x - dx, viewport.y - dy, viewport.width, viewport.height);
}

// Converts a screen pixel coordinate to the corresponding SVG user-space (plan) coordinate —
// used for placing a "current mouse position" readout, and by planInteractions.js to decide
// where a pinch/wheel zoom should anchor.
export function screenToViewportPoint(viewport, screenX, screenY, panelWidthPx, panelHeightPx) {
  return {
    x: viewport.x + (screenX / panelWidthPx) * viewport.width,
    y: viewport.y + (screenY / panelHeightPx) * viewport.height,
  };
}

// "Screen pixels per SVG user unit (mm)" — the basis for the on-screen technical-scale
// readout (requirement 6). This is NOT a physically-calibrated print scale (that would
// require knowing the real display's DPI, which a web page cannot reliably obtain) — it is
// an honest, nominal ratio between one CSS pixel and one plan millimetre at the current zoom.
export function pixelsPerMm(viewport, panelWidthPx) {
  return panelWidthPx / viewport.width;
}

// Rounds a computed scale ratio (mm of real plan per on-screen mm, i.e. the "N" in "1:N") to
// the nearest value from a short list of scales conventionally used on technical drawings —
// purely a display nicety so the readout says "1:20" instead of "1:19.87".
const STANDARD_SCALE_DENOMINATORS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
export function nearestStandardScale(rawDenominator) {
  let best = STANDARD_SCALE_DENOMINATORS[0];
  let bestDiff = Infinity;
  for (const d of STANDARD_SCALE_DENOMINATORS) {
    const diff = Math.abs(Math.log(d) - Math.log(rawDenominator));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}
