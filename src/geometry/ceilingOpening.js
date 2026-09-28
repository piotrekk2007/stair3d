// Otwór w stropie jako WIELOKĄT — czysty model (bez Three.js, bez DOM).
//
// Dwa sposoby zadania otworu (`config.openingShape`):
//   - 'rect'    — prostokąt z suwaków (openingWidth/openingLength/openingOffsetX/Y), jak dotąd;
//   - 'polygon' — dowolny wielokąt narysowany na planie 2D (`config.openingPolygon`).
// Oba są w TYM SAMYM układzie: punkty względem lewego-dolnego rogu rzutu schodów
// (planLayout.bounds.minX/minY) — dokładnie jak offsety prostokąta — więc otwór przesuwa się razem z
// rzutem tak samo w obu trybach. `resolveOpening()` zamienia jedno albo drugie na JEDEN obrys w
// układzie planu, z którego korzysta wszystko dalej (sprawdzenie skrajni, strop 3D, plan 2D, walidacja).
//
// Wielokąt niepoprawny (mniej niż 3 punkty, zerowe pole, samoprzecięcie) NIE jest po cichu
// „naprawiany": otwór wraca wtedy do prostokąta z suwaków, a powód trafia do `invalidReason`
// (walidator zgłasza go jako CEILING-OPENING-INVALID).

import { signedPolygonArea, segmentsProperlyIntersect } from './pathUtils.js';

export const OPENING_SHAPES = Object.freeze({ RECT: 'rect', POLYGON: 'polygon' });

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
 * Obrys otworu w układzie planu (mm), zawsze CCW.
 * @returns {{shape:'rect'|'polygon', outline:{x,y}[], relative:{x,y}[], invalidReason:string|null,
 *           minX:number, maxX:number, minY:number, maxY:number}}
 */
export function resolveOpening(config, bounds) {
  const origin = { x: bounds?.minX ?? 0, y: bounds?.minY ?? 0 };
  let shape = OPENING_SHAPES.RECT;
  let relative = rectangleOpeningPolygon(config);
  let invalidReason = null;
  if (config.openingShape === OPENING_SHAPES.POLYGON) {
    const poly = sanitizeOpeningPolygon(config.openingPolygon);
    const issue = openingPolygonIssue(poly);
    if (issue) invalidReason = issue;
    else {
      shape = OPENING_SHAPES.POLYGON;
      relative = poly;
    }
  }
  const outline = toCCW(relative.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y })));
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return { shape, outline, relative, invalidReason, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
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
