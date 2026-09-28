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
import { openingDraftXML } from './plan2dRenderer.js';

// Rysowanie otworu: kliknięcie bliżej pierwszego punktu niż tyle PIKSELI ekranu zamyka wielokąt.
const CLOSE_PICK_PX = 16;

// Stan rysowania otworu (tryb „Rysuj otwór") jako czyste funkcje — testowalne bez DOM.
// `points` = punkty już kliknięte (plan, mm); `closeTolMm` = CLOSE_PICK_PX przeliczone na mm przy bieżącym zoomie.
export function openingDrawClick(points, point, closeTolMm) {
  if (points.length >= 3 && Math.hypot(point.x - points[0].x, point.y - points[0].y) <= closeTolMm) return { points, closed: true };
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1) return { points, closed: false };
  return { points: [...points, point], closed: false };
}

const SNAP_MM = 5;
function snapMm(v) {
  return Math.round(v / SNAP_MM) * SNAP_MM;
}

// ALIGNMENT SNAP ("smart guides") — while dragging a corner, if it comes within
// `ALIGN_TOLERANCE_MM` of sharing an X or Y coordinate with any OTHER existing point on the
// plan, snap to that exact coordinate — so a second corner can be lined up EXACTLY with a
// first one instead of "by eye". Independent per axis: a point can snap on X, on Y, on both,
// or on neither. Grid snap (above) still applies afterward on whichever axis didn't align, so
// the two behaviors compose rather than fight each other.
const ALIGN_TOLERANCE_MM = 60;

function snapToAlignment(point, referencePoints) {
  let x = point.x;
  let y = point.y;
  let guideX = null;
  let guideY = null;
  let bestDx = ALIGN_TOLERANCE_MM;
  let bestDy = ALIGN_TOLERANCE_MM;
  for (const ref of referencePoints || []) {
    const dx = Math.abs(ref.x - point.x);
    if (dx < bestDx) {
      bestDx = dx;
      x = ref.x;
      guideX = ref.x;
    }
    const dy = Math.abs(ref.y - point.y);
    if (dy < bestDy) {
      bestDy = dy;
      y = ref.y;
      guideY = ref.y;
    }
  }
  return { point: { x, y }, guideX, guideY };
}

// Combines alignment snap (exact match against another real point, wins when close enough)
// with grid snap (a coarse fallback on whichever axis alignment didn't already claim) — so a
// drag that's near another point locks onto it precisely, and one that isn't still lands on a
// predictable 5mm grid instead of an arbitrary pixel-derived coordinate.
export function snapPoint(raw, referencePoints) {
  const { point: aligned, guideX, guideY } = snapToAlignment(raw, referencePoints);
  return {
    point: {
      x: guideX !== null ? aligned.x : snapMm(aligned.x),
      y: guideY !== null ? aligned.y : snapMm(aligned.y),
    },
    guideX,
    guideY,
  };
}

// The visible "smart guide": a dashed line through the point a drag just snapped to, along each
// axis it aligned on, spanning the whole visible plan (`viewBox` in svg units: plan x, and plan y
// flipped). Pure string builder so it can be tested without a DOM.
export function snapGuidesXML(guideX, guideY, viewBox) {
  if ((guideX === null || guideX === undefined) && (guideY === null || guideY === undefined)) return '';
  const parts = [];
  if (guideX !== null && guideX !== undefined) parts.push(`<line class="snap-guide" x1="${guideX}" y1="${viewBox.y}" x2="${guideX}" y2="${viewBox.y + viewBox.height}"/>`);
  if (guideY !== null && guideY !== undefined) parts.push(`<line class="snap-guide" x1="${viewBox.x}" y1="${-guideY}" x2="${viewBox.x + viewBox.width}" y2="${-guideY}"/>`);
  return `<g class="snap-guides" pointer-events="none">${parts.join('')}</g>`;
}

// Every live drag preview redraws the whole plan, so the guides are re-added to the CURRENT <svg>
// after each redraw (and vanish with the next full redraw once the drag ends).
function showSnapGuides(svg, guideX, guideY) {
  if (!svg) return;
  svg.querySelectorAll('.snap-guides').forEach((el) => el.remove());
  const vb = svg.viewBox?.baseVal;
  if (!vb) return;
  const xml = snapGuidesXML(guideX, guideY, { x: vb.x, y: vb.y, width: vb.width, height: vb.height });
  if (xml) svg.insertAdjacentHTML('beforeend', xml);
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
 * @param {(side: 'outer'|'inner') => void} [opts.onStringerClick]  Click on a stringer path
 *   (`.stringer-path[data-side]`). Omit and a stringer click falls through as a background click.
 * @param {(postId: string) => void} [opts.onPostClick]  Click on a post (`.post-marker[data-post-id]`).
 * @param {() => {x:number,y:number}[]} [opts.getSnapPoints]  Optional — every OTHER point on
 *   the current plan a dragged corner may snap into exact alignment with (see snapPoint above).
 *   Omit to fall back to grid-only snapping.
 * @param {(treadIndex: number, overhang: {side, offsetMm}) => void} [opts.onOverhangDragMove]
 *   Live preview while dragging the new per-tread overhang handle (`.overhang-handle`, see
 *   plan2dRenderer.js's overhangHandlesXML) — same "preview now, commit on release" contract
 *   as onEdgeDragMove/onEdgeDragEnd.
 * @param {(treadIndex: number, overhang) => void} [opts.onOverhangDragEnd]
 * @param {(treadIndex: number, side: 'inner'|'outer') => void} [opts.onOverhangContextMenu]
 *   Right-click on an overhang handle — caller resets that tread's overhang on that side.
 * @param {() => 'off'|'edit'|'draw'} [opts.getOpeningMode]  Ceiling-opening editing mode (main.js owns it).
 * @param {() => {x:number,y:number}[]} [opts.getOpeningSnapPoints]  Points an opening vertex snaps to.
 * @param {() => void} [opts.onOpeningDragStart]  A vertex/mid/body drag begins (caller snapshots the polygon).
 * @param {(index:number, point, final:boolean) => void} [opts.onOpeningVertexMove]  Plan coords (mm).
 * @param {(afterIndex:number, point) => void} [opts.onOpeningInsert]  A mid-edge dot was grabbed: new vertex.
 * @param {(index:number) => void} [opts.onOpeningVertexRemove]  Right-click on a vertex.
 * @param {(dx:number, dy:number, final:boolean) => void} [opts.onOpeningTranslate]  Whole-opening drag, total delta.
 * @param {(points:{x,y}[]) => void} [opts.onOpeningDrawFinish]  Drawing closed (>= 3 points, plan coords).
 * @param {() => void} [opts.onOpeningDrawCancel]  Esc while drawing.
 */
export function attachPlanInteractions(opts) {
  const {
    panelEl,
    getViewport,
    setViewport,
    getPanelSize,
    onEdgeDragMove,
    onEdgeDragEnd,
    onEdgeContextMenu,
    onStepClick,
    onStringerClick,
    onPostClick,
    getSnapPoints,
    onOverhangDragMove,
    onOverhangDragEnd,
    onOverhangContextMenu,
    getOpeningMode = () => 'off',
    getOpeningSnapPoints,
    onOpeningDragStart,
    onOpeningVertexMove,
    onOpeningInsert,
    onOpeningVertexRemove,
    onOpeningTranslate,
    onOpeningDrawFinish,
    onOpeningDrawCancel,
  } = opts;

  // Rysowanie otworu: kliknięte punkty + ostatnia pozycja kursora (po przyciąganiu). Żyje tylko w trakcie rysowania.
  let draft = { points: [], cursor: null };

  function mmPerPx() {
    const vp = getViewport();
    const { width } = getPanelSize();
    return vp && width ? vp.width / width : 1;
  }

  function openingSnap(raw, exclude = null) {
    const refs = (getOpeningSnapPoints ? getOpeningSnapPoints() : []).filter((r) => !exclude || Math.hypot(r.x - exclude.x, r.y - exclude.y) > 1e-6);
    return snapPoint(raw, refs);
  }

  function showDraft(guideX = null, guideY = null) {
    const svg = getSvg();
    if (!svg) return;
    svg.querySelectorAll('.opening-draft').forEach((el) => el.remove());
    const xml = openingDraftXML(draft.points, draft.cursor);
    if (xml) svg.insertAdjacentHTML('beforeend', xml);
    showSnapGuides(svg, guideX, guideY);
  }

  function finishDraw() {
    const pts = draft.points;
    draft = { points: [], cursor: null };
    if (pts.length >= 3 && onOpeningDrawFinish) onOpeningDrawFinish(pts);
  }

  // Wywoływane z main.js po każdym przerysowaniu planu, żeby szkic nie znikał (innerHTML nadpisuje <svg>).
  function redrawDraft() {
    if (getOpeningMode() === 'draw') showDraft();
  }

  function resetDraft() {
    draft = { points: [], cursor: null };
  }

  let spacePressed = false;
  let panState = null; // { pointerId, lastX, lastY }
  let dragState = null; // edge-handle drag
  let clickCandidate = null; // { pointerId, downX, downY, hit:{kind:'step'|'stringer'|'post', ...} }
  const activePointers = new Map(); // pointerId -> {x, y} in CLIENT (screen) coords
  let pinchState = null; // { initialDistance, initialViewport }

  function getSvg() {
    return panelEl.querySelector('svg');
  }

  function updatePanCursor() {
    panelEl.classList.toggle('space-pan-ready', spacePressed && !dragState);
  }

  window.addEventListener('keydown', (e) => {
    if (getOpeningMode() === 'draw') {
      const tag = e.target?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        if (e.key === 'Escape') {
          e.preventDefault();
          draft = { points: [], cursor: null };
          if (onOpeningDrawCancel) onOpeningDrawCancel();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          finishDraw();
          return;
        }
        if (e.key === 'Backspace') {
          e.preventDefault();
          draft.points = draft.points.slice(0, -1);
          showDraft();
          return;
        }
      }
    }
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

    // --- otwór w stropie: rysowanie (klik = punkt) ---
    const openingMode = getOpeningMode();
    if (openingMode === 'draw' && e.button === 0 && !spacePressed) {
      const svg = getSvg();
      if (!svg) return;
      const { point } = openingSnap(screenToPlanPoint(svg, e.clientX, e.clientY));
      const res = openingDrawClick(draft.points, point, CLOSE_PICK_PX * mmPerPx());
      draft.points = res.points;
      if (res.closed) finishDraw();
      else showDraft();
      e.preventDefault();
      return;
    }
    // --- otwór w stropie: edycja (wierzchołek / nowy wierzchołek na boku / całość) ---
    if (openingMode === 'edit' && e.button === 0 && !spacePressed) {
      const svg = getSvg();
      const vertexEl = e.target.closest('.opening-vertex');
      const midEl = vertexEl ? null : e.target.closest('.opening-mid');
      const bodyEl = vertexEl || midEl ? null : e.target.closest('.opening-body');
      if (svg && (vertexEl || midEl || bodyEl)) {
        const raw = screenToPlanPoint(svg, e.clientX, e.clientY);
        if (onOpeningDragStart) onOpeningDragStart();
        panelEl.setPointerCapture(e.pointerId);
        if (bodyEl) {
          dragState = { pointerId: e.pointerId, kind: 'opening-move', start: raw, delta: { x: 0, y: 0 }, svg };
        } else {
          let index = vertexEl ? Number(vertexEl.dataset.index) : Number(midEl.dataset.after) + 1;
          const start = vertexEl ? { x: Number(vertexEl.getAttribute('cx')), y: -Number(vertexEl.getAttribute('cy')) } : openingSnap(raw).point;
          if (midEl && onOpeningInsert) onOpeningInsert(index - 1, start);
          dragState = { pointerId: e.pointerId, kind: 'opening-vertex', index, start, currentPoint: start, svg };
        }
        e.preventDefault();
        return;
      }
    }

    const handle = e.target.closest('.edge-handle');
    if (handle) {
      const svg = getSvg();
      if (!svg) return;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      dragState = { pointerId: e.pointerId, kind: 'edge', boundaryIndex: Number(handle.dataset.boundary), endpoint: handle.dataset.endpoint, svg, handle, currentPoint: null };
      e.preventDefault();
      return;
    }

    const overhangHandle = e.target.closest('.overhang-handle');
    if (overhangHandle) {
      const svg = getSvg();
      if (!svg) return;
      overhangHandle.setPointerCapture(e.pointerId);
      overhangHandle.classList.add('dragging');
      // anchor/dir describe the ONE-DIMENSIONAL axis this handle can move along (the edge's
      // own inner<->outer direction) — see plan2dRenderer.js's overhangHandlesXML for how
      // they're derived (the NOMINAL, pre-overhang midpoint and direction, so the offset this
      // computes is always an absolute mm value, not relative to wherever the handle currently
      // happens to be rendered).
      dragState = {
        pointerId: e.pointerId,
        kind: 'overhang',
        treadIndex: Number(overhangHandle.dataset.tread),
        side: overhangHandle.dataset.side,
        anchor: { x: Number(overhangHandle.dataset.anchorX), y: Number(overhangHandle.dataset.anchorY) },
        dir: { x: Number(overhangHandle.dataset.dirX), y: Number(overhangHandle.dataset.dirY) },
        svg,
        handle: overhangHandle,
        currentOffsetMm: null,
      };
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
      // Kolejność = kolejność rysowania w SVG (słupy nad wangami nad stopniami): to, co
      // użytkownik widzi na wierzchu, jest tym, co zaznacza. Identyfikatory pochodzą z
      // data-* wystawionych przez renderer (model), nie z geometrii.
      const postEl = e.target.closest('.post-marker');
      const stringerEl = postEl ? null : e.target.closest('.stringer-path');
      const stepEl = postEl || stringerEl ? null : e.target.closest('.step-object');
      const stepIndex = stepEl ? Number(stepEl.dataset.stepIndex) : null;
      const hit = postEl
        ? { kind: 'post', postId: postEl.dataset.postId }
        : stringerEl
          ? { kind: 'stringer', side: stringerEl.dataset.side }
          : { kind: 'step', stepIndex };
      clickCandidate = { pointerId: e.pointerId, downX: e.clientX, downY: e.clientY, hit };
    }
  });

  // Każdy live-podgląd przeciągania kończy się przerysowaniem planu (rebuild -> innerHTML), więc
  // <svg> zapamiętany w pointerdown jest po pierwszym ruchu ODPIĘTY od dokumentu, a jego
  // getScreenCTM() nie opisuje już ekranu — współrzędne myszy byłyby przeliczane na śmieci
  // (uchwyt "uciekał" w przeciwną stronę). Zawsze przeliczamy względem aktualnego <svg>.
  function liveSvg() {
    return getSvg() || dragState.svg;
  }

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

    if (getOpeningMode() === 'draw' && !panState) {
      const svg = getSvg();
      if (svg) {
        const { point, guideX, guideY } = openingSnap(screenToPlanPoint(svg, e.clientX, e.clientY));
        draft.cursor = point;
        showDraft(guideX, guideY);
      }
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'opening-vertex') {
      const raw = screenToPlanPoint(liveSvg(), e.clientX, e.clientY);
      const { point, guideX, guideY } = openingSnap(raw, dragState.start);
      dragState.currentPoint = point;
      if (onOpeningVertexMove) onOpeningVertexMove(dragState.index, point, false);
      showSnapGuides(liveSvg(), guideX, guideY);
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'opening-move') {
      const raw = screenToPlanPoint(liveSvg(), e.clientX, e.clientY);
      dragState.delta = { x: snapMm(raw.x - dragState.start.x), y: snapMm(raw.y - dragState.start.y) };
      if (onOpeningTranslate) onOpeningTranslate(dragState.delta.x, dragState.delta.y, false);
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'edge') {
      const raw = screenToPlanPoint(liveSvg(), e.clientX, e.clientY);
      const references = (getSnapPoints ? getSnapPoints() : []).filter((ref) => distance(ref, raw) > 1e-6);
      const { point: p, guideX, guideY } = snapPoint(raw, references);
      dragState.currentPoint = p;
      dragState.handle.setAttribute('cx', p.x);
      dragState.handle.setAttribute('cy', -p.y);
      onEdgeDragMove(dragState.boundaryIndex, { movedEndpoint: dragState.endpoint, point: p });
      showSnapGuides(liveSvg(), guideX, guideY);
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'overhang') {
      const raw = screenToPlanPoint(liveSvg(), e.clientX, e.clientY);
      // Project the raw drag point onto the handle's own 1D axis (dot product with its unit
      // direction) — this is the ONLY thing that can change here, since an overhang has no
      // meaningful second degree of freedom. Grid-snapped to the same 5mm step as a corner
      // drag; alignment snap doesn't apply to a 1D scalar the same way, so it's skipped here.
      const rawOffsetMm = (raw.x - dragState.anchor.x) * dragState.dir.x + (raw.y - dragState.anchor.y) * dragState.dir.y;
      const offsetMm = snapMm(rawOffsetMm);
      dragState.currentOffsetMm = offsetMm;
      // Preserve the handle's own 45° rotation (set once at render time, pivoting on its own
      // NOMINAL anchor position) and prepend a translate for the live offset — overwriting
      // `transform` outright would silently drop the rotation and leave the diamond mis-shapen.
      const dx = dragState.dir.x * offsetMm;
      const dy = dragState.dir.y * offsetMm;
      const anchorSvgX = dragState.anchor.x;
      const anchorSvgY = -dragState.anchor.y;
      dragState.handle.setAttribute('transform', `translate(${dx}, ${-dy}) rotate(45 ${anchorSvgX} ${anchorSvgY})`);
      if (onOverhangDragMove) onOverhangDragMove(dragState.treadIndex, { side: dragState.side, offsetMm });
    }
  });

  function endPointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchState = null;

    if (panState && e.pointerId === panState.pointerId) {
      panState = null;
      panelEl.classList.remove('panning');
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'opening-vertex') {
      const { index, currentPoint } = dragState;
      dragState = null;
      if (onOpeningVertexMove) onOpeningVertexMove(index, currentPoint, true);
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'opening-move') {
      const { delta } = dragState;
      dragState = null;
      if (onOpeningTranslate) onOpeningTranslate(delta.x, delta.y, true);
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'edge') {
      dragState.handle.classList.remove('dragging');
      const { boundaryIndex, endpoint, currentPoint } = dragState;
      dragState = null;
      if (currentPoint) onEdgeDragEnd(boundaryIndex, { movedEndpoint: endpoint, point: currentPoint });
      return;
    }

    if (dragState && e.pointerId === dragState.pointerId && dragState.kind === 'overhang') {
      dragState.handle.classList.remove('dragging');
      const { treadIndex, side, currentOffsetMm } = dragState;
      dragState = null;
      if (currentOffsetMm !== null && onOverhangDragEnd) onOverhangDragEnd(treadIndex, { side, offsetMm: currentOffsetMm });
      return;
    }

    if (clickCandidate && e.pointerId === clickCandidate.pointerId) {
      const moved = Math.hypot(e.clientX - clickCandidate.downX, e.clientY - clickCandidate.downY);
      if (moved < 4) {
        // treat as a click, not a drag
        const { hit } = clickCandidate;
        if (hit.kind === 'post' && onPostClick) onPostClick(hit.postId);
        else if (hit.kind === 'stringer' && onStringerClick) onStringerClick(hit.side);
        else onStepClick(hit.kind === 'step' ? hit.stepIndex : null);
      }
      clickCandidate = null;
    }
  }

  panelEl.addEventListener('pointerup', endPointer);
  panelEl.addEventListener('pointercancel', endPointer);

  // Dwuklik w trybie rysowania zamyka wielokąt (dwa kliknięcia w to samo miejsce dodały jeden punkt — duplikaty są pomijane).
  panelEl.addEventListener('dblclick', (e) => {
    if (getOpeningMode() !== 'draw') return;
    e.preventDefault();
    finishDraw();
  });

  panelEl.addEventListener('contextmenu', (e) => {
    const openingMode = getOpeningMode();
    if (openingMode === 'draw') {
      // prawy klik w trakcie rysowania: cofnij ostatni punkt
      e.preventDefault();
      draft.points = draft.points.slice(0, -1);
      showDraft();
      return;
    }
    const vertexEl = openingMode === 'edit' ? e.target.closest('.opening-vertex') : null;
    if (vertexEl) {
      e.preventDefault();
      if (onOpeningVertexRemove) onOpeningVertexRemove(Number(vertexEl.dataset.index));
      return;
    }
    const handle = e.target.closest('.edge-handle');
    if (handle) {
      e.preventDefault();
      onEdgeContextMenu(Number(handle.dataset.boundary));
      return;
    }
    const overhangHandle = e.target.closest('.overhang-handle');
    if (overhangHandle && onOverhangContextMenu) {
      e.preventDefault();
      onOverhangContextMenu(Number(overhangHandle.dataset.tread), overhangHandle.dataset.side);
    }
  });

  return { redrawDraft, resetDraft };
}
