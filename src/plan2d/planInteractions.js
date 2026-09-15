// All pointer/wheel/keyboard interaction for the 2D plan editor — wheel zoom (anchored at
// the cursor), two-finger pinch zoom, middle-button pan, space+drag pan, edge-handle
// dragging (requirement 10: this ONLY ever produces a 2D model edit — a
// `config.manualEdgeOverrides` entry — it never touches a Three.js mesh, because this module
// has no reference to the 3D scene at all), and step-object click-to-select.
//
// This module owns no state that outlives one interaction (the current viewport is owned by
// the caller — see main.js — and is only ever read via `getViewport`/written via
// `setViewport`, so undo/redo and "fit to view" can change it from outside without this
// module's knowledge going stale).

import { zoomAt, panBy } from './viewport.js';

const SNAP_MM = 5;
function snapMm(v) {
  return Math.round(v / SNAP_MM) * SNAP_MM;
}

function screenToPlanPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: svgP.x, y: -svgP.y };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.panelEl        The container the SVG is rendered into.
 * @param {() => {x,y,width,height}} opts.getViewport
 * @param {(vp) => void} opts.setViewport   Called with a NEW viewport — caller re-renders.
 * @param {() => {width:number, height:number}} opts.getPanelSize  Panel's current CSS pixel size.
 * @param {(boundaryIndex: number, override: {movedEndpoint, point}) => void} opts.onEdgeDragMove
 *   Called continuously while dragging an edge handle — live preview only (see main.js:
 *   this should update the model AND re-render, but should NOT push undo history on every
 *   pointermove — only onEdgeDragEnd commits to history).
 * @param {(boundaryIndex: number, override) => void} opts.onEdgeDragEnd  Drag finished — this
 *   is the point at which the caller should push undo history.
 * @param {(boundaryIndex: number) => void} opts.onEdgeContextMenu  Right-click on a handle —
 *   caller resets that boundary's override.
 * @param {(stepIndex: number|null) => void} opts.onStepClick  null = clicked empty background.
 */
export function attachPlanInteractions(opts) {
  const { panelEl, getViewport, setViewport, getPanelSize, onEdgeDragMove, onEdgeDragEnd, onEdgeContextMenu, onStepClick } = opts;

  let spacePressed = false;
  let panState = null; // { pointerId, lastX, lastY }
  let dragState = null; // edge-handle drag
  let clickCandidate = null; // { pointerId, downX, downY, stepIndex|null }
  const activePointers = new Map(); // pointerId -> {x, y} in CLIENT (screen) coords
  let pinchState = null; // { initialDistance, initialViewport }

  function getSvg() {
    return panelEl.querySelector('svg');
  }

  function updatePanCursor() {
    panelEl.classList.toggle('space-pan-ready', spacePressed && !dragState);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      spacePressed = true;
      updatePanCursor();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spacePressed = false;
      updatePanCursor();
    }
  });
  // If focus leaves the window mid-hold (alt-tab etc.), don't leave pan-mode stuck on.
  window.addEventListener('blur', () => {
    spacePressed = false;
    updatePanCursor();
  });

  panelEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const svg = getSvg();
      if (!svg) return;
      const rect = panelEl.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { width, height } = getPanelSize();
      // Smooth, continuous zoom rather than fixed steps — a small wheel tick zooms a small
      // amount, a fast trackpad swipe zooms a lot, matching how every real drawing tool feels.
      const zoomFactor = Math.pow(1.0016, -e.deltaY);
      const vp = getViewport();
      setViewport(zoomAt(vp, screenX, screenY, width, height, zoomFactor));
    },
    { passive: false }
  );

  panelEl.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      // A second finger just landed — start (or restart) a pinch gesture instead of
      // whatever single-pointer gesture (pan/select) might already be starting.
      panState = null;
      const [p1, p2] = [...activePointers.values()];
      pinchState = { initialDistance: distance(p1, p2), initialViewport: getViewport() };
      return;
    }

    const handle = e.target.closest('.edge-handle');
    if (handle) {
      const svg = getSvg();
      if (!svg) return;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      dragState = { pointerId: e.pointerId, boundaryIndex: Number(handle.dataset.boundary), endpoint: handle.dataset.endpoint, svg, handle, currentPoint: null };
      e.preventDefault();
      return;
    }

    const isMiddleButton = e.button === 1;
    if (isMiddleButton || spacePressed) {
      panState = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      panelEl.classList.add('panning');
      panelEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      const stepEl = e.target.closest('.step-object');
      const stepIndex = stepEl ? Number(stepEl.dataset.stepIndex) : null;
      clickCandidate = { pointerId: e.pointerId, downX: e.clientX, downY: e.clientY, stepIndex };
    }
  });

  panelEl.addEventListener('pointermove', (e) => {
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchState && activePointers.size === 2) {
      const [p1, p2] = [...activePointers.values()];
      const newDistance = distance(p1, p2);
      if (newDistance > 1 && pinchState.initialDistance > 1) {
        const rect = panelEl.getBoundingClientRect();
        const mid = midpoint(p1, p2);
        const { width, height } = getPanelSize();
        const zoomFactor = newDistance / pinchState.initialDistance;
        setViewport(zoomAt(pinchState.initialViewport, mid.x - rect.left, mid.y - rect.top, width, height, zoomFactor));
      }
      return;
    }

    if (panState && e.pointerId === panState.pointerId) {
      const dx = e.clientX - panState.lastX;
      const dy = e.clientY - panState.lastY;
      panState.lastX = e.clientX;
      panState.lastY = e.clientY;
      const { width, height } = getPanelSize();
      setViewport(panBy(getViewport(), dx, dy, width, height));
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId) {
      const raw = screenToPlanPoint(dragState.svg, e.clientX, e.clientY);
      const p = { x: snapMm(raw.x), y: snapMm(raw.y) };
      dragState.currentPoint = p;
      dragState.handle.setAttribute('cx', p.x);
      dragState.handle.setAttribute('cy', -p.y);
      onEdgeDragMove(dragState.boundaryIndex, { movedEndpoint: dragState.endpoint, point: p });
    }
  });

  function endPointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchState = null;

    if (panState && e.pointerId === panState.pointerId) {
      panState = null;
      panelEl.classList.remove('panning');
    }

    if (dragState && e.pointerId === dragState.pointerId) {
      dragState.handle.classList.remove('dragging');
      const { boundaryIndex, endpoint, currentPoint } = dragState;
      dragState = null;
      if (currentPoint) onEdgeDragEnd(boundaryIndex, { movedEndpoint: endpoint, point: currentPoint });
      return;
    }

    if (clickCandidate && e.pointerId === clickCandidate.pointerId) {
      const moved = Math.hypot(e.clientX - clickCandidate.downX, e.clientY - clickCandidate.downY);
      if (moved < 4) onStepClick(clickCandidate.stepIndex); // treat as a click, not a drag
      clickCandidate = null;
    }
  }

  panelEl.addEventListener('pointerup', endPointer);
  panelEl.addEventListener('pointercancel', endPointer);

  panelEl.addEventListener('contextmenu', (e) => {
    const handle = e.target.closest('.edge-handle');
    if (!handle) return;
    e.preventDefault();
    onEdgeContextMenu(Number(handle.dataset.boundary));
  });
}
