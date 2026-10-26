// Otwór w stropie jako WIELOKĄT — czysty model (bez Three.js, bez DOM).
//
// Dwa sposoby zadania otworu (`config.openingShape`):
//   - 'rect'    — prostokąt z suwaków (openingWidth/openingLength/openingOffsetX/Y), jak dotąd;
//   - 'polygon' — dowolny wielokąt narysowany na planie 2D (`config.openingPolygon`).
// Oba są w TYM SAMYM układzie: punkty względem lewego-dolnego rogu rzutu schodów
// (planLayout.bounds.minX/minY) — dokładnie jak offsety prostokąta — więc otwór przesuwa się razem z
// rzutem tak samo w obu trybach. With the stairwell dimensions on (geometry/stairwell.js) that frame is the WALL frame
// instead (`openingFrame`): x from wall A, y from the end wall — the opening stays put when a free side changes. `resolveOpening()` zamienia jedno albo drugie na JEDEN obrys w
// układzie planu, z którego korzysta wszystko dalej (sprawdzenie skrajni, strop 3D, plan 2D, walidacja).
//
// Wielokąt niepoprawny (mniej niż 3 punkty, zerowe pole, samoprzecięcie) NIE jest po cichu
// „naprawiany": otwór wraca wtedy do prostokąta z suwaków, a powód trafia do `invalidReason`
// (walidator zgłasza go jako CEILING-OPENING-INVALID).

import { signedPolygonArea, segmentsProperlyIntersect } from './pathUtils.js';
import { wellFrame } from './stairwell.js';
import { unionRectangles } from './rectUnion.js';

export const OPENING_SHAPES = Object.freeze({ RECT: 'rect', POLYGON: 'polygon' });
// How the opening is set (`config.openingMode`): GIVEN — the rectangle / polygon above, checked against the stair;
// DERIVED — the opening the stair needs (`requiredOpeningRelative`), recomputed on every change (stage 3 of the
// room-first designer, docs/architecture/STAIRWELL_ROOM.md).
export const OPENING_MODES = Object.freeze({ GIVEN: 'given', DERIVED: 'derived' });

// Dwa kolejne punkty bliżej niż to są jednym punktem (np. podwójne kliknięcie przy rysowaniu).
export const OPENING_POINT_MERGE_MM = 1;
const EPS = 1e-6;

const isPt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const round1 = (v) => Math.round(v * 10) / 10;

/** Czyści listę punktów z pliku/edycji: tylko skończone {x,y}, bez powtórzeń kolejnych (i ostatni≠pierwszy). */
export function sanitizeOpeningPolygon(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    if (!isPt(p)) continue;
    const q = { x: round1(p.x), y: round1(p.y) };
    const last = out[out.length - 1];
    if (last && Math.hypot(q.x - last.x, q.y - last.y) < OPENING_POINT_MERGE_MM) continue;
    out.push(q);
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < OPENING_POINT_MERGE_MM) out.pop();
  return out;
}

/** Powód, dla którego wielokąt nie nadaje się na otwór, albo null. */
export function openingPolygonIssue(points) {
  if (!Array.isArray(points) || points.length < 3) return 'too-few';
  // samoprzecięcie przed polem: symetryczna „ósemka" ma zerowe pole ze znakiem, a to jest jej prawdziwy problem
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; // sąsiednie boki mają wspólny wierzchołek
      if (segmentsProperlyIntersect(a1, a2, points[j], points[(j + 1) % n])) return 'self-intersecting';
    }
  }
  if (Math.abs(signedPolygonArea(points)) < 1) return 'zero-area';
  return null;
}

export const OPENING_ISSUE_LABELS_PL = Object.freeze({
  'too-few': 'wielokąt ma mniej niż 3 punkty',
  'zero-area': 'wielokąt ma zerowe pole',
  'self-intersecting': 'boki wielokąta się przecinają',
});

/** Prostokąt z suwaków jako wielokąt (względny, CCW). */
export function rectangleOpeningPolygon(config) {
  const x0 = config.openingOffsetX || 0;
  const y0 = config.openingOffsetY || 0;
  const w = config.openingWidth || 0;
  const l = config.openingLength || 0;
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + l },
    { x: x0, y: y0 + l },
  ];
}

const toCCW = (pts) => (signedPolygonArea(pts) < 0 ? [...pts].reverse() : pts);

/**
 * The frame the opening's points (rectangle offsets / polygon) are given in: relative to the stair plan's lower-left
 * corner (planLayout.bounds min) — or, with the stairwell dimensions on (geometry/stairwell.js), the WALL frame (x from
 * wall A, y from the end wall). `toPlan` / `toRelative` convert a point; `wall` says which; `wallLines` = the walls.
 */
export function openingFrame(config, planLayout) {
  const frame = wellFrame(config, planLayout);
  if (frame) return frame;
  return boundsFrame(planLayout?.bounds);
}

function boundsFrame(bounds) {
  const origin = { x: bounds?.minX ?? 0, y: bounds?.minY ?? 0 };
  return { wall: false, wallLines: [], toPlan: (p) => ({ x: origin.x + p.x, y: origin.y + p.y }), toRelative: (p) => ({ x: p.x - origin.x, y: p.y - origin.y }) };
}

/**
 * Obrys otworu w układzie planu (mm), zawsze CCW.
 * @param {Object} config
 * @param {Object} frameOrBounds  openingFrame(...) or (older callers) planLayout.bounds
 * @returns {{shape:'rect'|'polygon', outline:{x,y}[], relative:{x,y}[], relativeOutline:{x,y}[], invalidReason:string|null,
 *           minX:number, maxX:number, minY:number, maxY:number}}  `relativeOutline` = the outline in the opening's own
 *           frame, CCW (the wall frame with the stairwell dimensions on)
 */
export function resolveOpening(config, frameOrBounds, derivedRelative = null) {
  const frame = typeof frameOrBounds?.toPlan === 'function' ? frameOrBounds : boundsFrame(frameOrBounds);
  let shape = OPENING_SHAPES.RECT;
  let relative = rectangleOpeningPolygon(config);
  let invalidReason = null;
  // the derived opening (`derivedRelative`, from requiredOpeningRelative) wins in DERIVED mode; with no tread needing
  // one it falls back to the rectangle from the sliders
  if (config.openingMode === OPENING_MODES.DERIVED && derivedRelative?.length >= 3) {
    shape = 'derived';
    relative = derivedRelative;
  } else if (config.openingShape === OPENING_SHAPES.POLYGON) {
    const poly = sanitizeOpeningPolygon(config.openingPolygon);
    const issue = openingPolygonIssue(poly);
    if (issue) invalidReason = issue;
    else {
      shape = OPENING_SHAPES.POLYGON;
      relative = poly;
    }
  }
  const relativeOutline = toCCW(relative);
  const outline = toCCW(relativeOutline.map(frame.toPlan)); // (the wall frame may be a mirror image of the plan's)
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return { shape, outline, relative, relativeOutline, invalidReason, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * The opening the stair NEEDS, in the opening's own frame (`frame` — the wall frame with the stairwell on): the treads whose top
 * comes within `minHeadroom` of the slab's underside (the ones deriveCeilingFit checks) must lie in it, so it is the
 * union of their bounding rectangles taken along the frame's axes (an opening is cut square to the walls; a winder's
 * rectangle is a little more than the winder), an edge next to a wall taken to the wall. Several separate pieces
 * → one rectangle round all. null when no tread needs it.
 * @returns {{x,y}[]|null}  CCW
 */
const OPENING_MARGIN_MM = 0.01;

/**
 * The top riser's plan footprint (riserSolver.js buildTopRiserModel: its face on the last back edge, its thickness on
 * past it, under the floor's nosing tread, up to the floor) — so it must stand inside the opening like a tread (user
 * report 2026-10-26: it went into the slab). Square to the last back edge, away from the last tread; null without
 * riser boards.
 * @returns {{x,y}[]|null}
 */
export function topRiserFootprint(config, planLayout) {
  const t = Number(config.riserBoardThickness) || 0;
  const last = planLayout?.treads?.[planLayout.treads.length - 1];
  if (!config.hasRiserBoards || !(t > 0) || !last?.backEdge || !(last.outline?.length >= 3)) return null;
  const [p, q] = last.backEdge;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (!(len > 1e-9)) return null;
  let n = { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
  const c = last.outline.reduce((acc, v) => ({ x: acc.x + v.x / last.outline.length, y: acc.y + v.y / last.outline.length }), { x: 0, y: 0 });
  if (n.x * (c.x - p.x) + n.y * (c.y - p.y) > 0) n = { x: -n.x, y: -n.y };
  return [p, q, { x: q.x + n.x * t, y: q.y + n.y * t }, { x: p.x + n.x * t, y: p.y + n.y * t }];
}

export function requiredOpeningRelative(config, planLayout, riserHeight, frame) {
  const threshold = config.totalRise - config.ceilingThickness - config.minHeadroom;
  const rects = [];
  // every tread above the headroom line — and the top riser (it reaches the floor)
  const riser = topRiserFootprint(config, planLayout);
  const outlines = [...planLayout.treads.filter((tread) => (tread.index + 1) * riserHeight > threshold && tread.outline?.length >= 3).map((t) => t.outline), ...(riser ? [riser] : [])];
  for (const outline of outlines) {
    const pts = outline.map(frame.toRelative);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // rounded OUTWARD to 0.1 mm — the precision a stored polygon keeps (sanitizeOpeningPolygon), so the opening frozen
    // as a given one still holds every tread — with at least OPENING_MARGIN_MM to spare: a value already on the
    // 0.1 mm grid used to get none, and where two treads' rectangles meet the union left a tread's corner a few
    // microns outside (a ceiling "collision" in a U / S with a derived opening)
    const down = (v) => Math.floor((v - OPENING_MARGIN_MM) * 10) / 10;
    const up = (v) => Math.ceil((v + OPENING_MARGIN_MM) * 10) / 10;
    rects.push({ uStart: down(Math.min(...xs)), uEnd: up(Math.max(...xs)), vBottom: down(Math.min(...ys)), vTop: up(Math.max(...ys)) });
  }
  if (rects.length === 0) return null;
  // with the stairwell's walls an edge closer to a wall than the wanga along it (+ the wall gap) goes to the wall: the
  // slab is not left as a strip over the wanga (never pulled back: a tread a hair past keeps its outward-rounded edge)
  const snap = (Number(config.stringerThickness) || 0) + Math.max(0, Number(config.stairwellWallGapMm) || 0) + 1;
  for (const w of frame.wallLines || []) {
    for (const r of rects) {
      const [lo, hi] = w.axis === 'x' ? ['uStart', 'uEnd'] : ['vBottom', 'vTop'];
      if (Math.abs(r[lo] - w.value) <= snap) r[lo] = Math.min(r[lo], w.value);
      if (Math.abs(r[hi] - w.value) <= snap) r[hi] = Math.max(r[hi], w.value);
    }
  }
  const loops = unionRectangles(rects);
  if (loops.length === 1) return loops[0].map((p) => ({ x: p.u, y: p.v }));
  const x0 = Math.min(...rects.map((r) => r.uStart));
  const x1 = Math.max(...rects.map((r) => r.uEnd));
  const y0 = Math.min(...rects.map((r) => r.vBottom));
  const y1 = Math.max(...rects.map((r) => r.vTop));
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

function onSegment(p, a, b) {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  if (Math.abs(cross) / len > 1e-3) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= -EPS && dot <= len * len + EPS;
}

/** Punkt wewnątrz wielokąta lub na jego brzegu. */
export function pointInOrOnPolygon(p, polygon) {
  const n = polygon.length;
  for (let i = 0; i < n; i++) if (onSegment(p, polygon[i], polygon[(i + 1) % n])) return true;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Czy wielokąt `inner` (obrys stopnia) leży w całości w `outer` (otworze) — brzeg się liczy jako „w środku".
 * Same wierzchołki nie wystarczą dla otworu wklęsłego (np. w kształcie L): bok stopnia może przeciąć jego
 * wcięcie mimo że oba końce są w środku — dlatego dochodzi test przecięcia boków i środków boków.
 */
export function polygonContainsPolygon(outer, inner) {
  if (!inner.every((p) => pointInOrOnPolygon(p, outer))) return false;
  const n = inner.length;
  const m = outer.length;
  for (let i = 0; i < n; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % n];
    if (!pointInOrOnPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, outer)) return false;
    for (let j = 0; j < m; j++) if (segmentsProperlyIntersect(a, b, outer[j], outer[(j + 1) % m])) return false;
  }
  return true;
}

// --- edycje (wszystkie na punktach WZGLĘDNYCH, zwracają nową tablicę) ------------------------------

export function moveOpeningVertex(points, index, point) {
  return points.map((p, i) => (i === index ? { x: point.x, y: point.y } : p));
}

export function insertOpeningVertex(points, afterIndex, point) {
  const out = points.slice();
  out.splice(afterIndex + 1, 0, { x: point.x, y: point.y });
  return out;
}

/** Usuwa wierzchołek — nigdy poniżej 3 (wtedy zwraca wejście bez zmian). */
export function removeOpeningVertex(points, index) {
  if (points.length <= 3) return points;
  return points.filter((_, i) => i !== index);
}

export function translateOpening(points, dx, dy) {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Dosunięcie WIELOKĄTA do narożnika/boku rzutu (odpowiednik alignedOpeningOffsets dla prostokąta): przesuwa
 * wielokąt tak, żeby odpowiedni bok jego obwiedni leżał na boku rzutu. `target` = {x?:'min'|'max', y?:'min'|'max'}.
 */
export function alignedOpeningPolygon(points, bounds, target) {
  if (!target || !bounds || points.length === 0) return points;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const dx = target.x === 'min' ? -Math.min(...xs) : target.x === 'max' ? spanX - Math.max(...xs) : 0;
  const dy = target.y === 'min' ? -Math.min(...ys) : target.y === 'max' ? spanY - Math.max(...ys) : 0;
  return translateOpening(points, Math.round(dx), Math.round(dy));
}
