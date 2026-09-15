import { GEOMETRY_EPS, COLLINEAR_EPS } from './tolerances.js';

// THE canonical "are these two 2D points the same" test — used everywhere a chain, a
// boundary, or a manually-edited point needs to be compared against another point.
// Previously reimplemented independently (with three different names and three unexplained
// epsilon values) in nosingUtils.js (`sameAs`), planLayout.js (`sameAsPt`), and
// stringerSolver.js (`sameAsPt`) — now one function, one place.
export function pointsEqual(p, q, eps = GEOMETRY_EPS) {
  return Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;
}

// THE canonical "make this 2D vector unit length" primitive — previously reimplemented
// independently (identical formula, different local name) in planLayout.js (`unit`),
// riserGeometry.js (`normalize`), and inline in stringerSolver.js's direction handling.
export function normalizeVector(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function cumulativeDistances(vertices) {
  const cum = [0];
  for (let i = 1; i < vertices.length; i++) {
    const dx = vertices[i].x - vertices[i - 1].x;
    const dy = vertices[i].y - vertices[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return cum;
}

export function pathLength(vertices) {
  const cum = cumulativeDistances(vertices);
  return cum[cum.length - 1];
}

export function pointAtDistance(vertices, cum, d) {
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, d));
  for (let i = 1; i < cum.length; i++) {
    if (clamped <= cum[i] || i === cum.length - 1) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen === 0 ? 0 : (clamped - cum[i - 1]) / segLen;
      return {
        x: vertices[i - 1].x + (vertices[i].x - vertices[i - 1].x) * t,
        y: vertices[i - 1].y + (vertices[i].y - vertices[i - 1].y) * t,
      };
    }
  }
  return vertices[vertices.length - 1];
}

// Iloczyn wektorowy (składowa Z) wektorów (a-o) i (b-o) — dodatni/ujemny znak mówi o skręcie
// lewo/prawo, wartość bliska zeru oznacza współliniowość. Współdzielone przez każdy kod, który
// musi wykryć "prawdziwy narożnik" na łańcuchu punktów (np. stringerSolver.js przy dzieleniu
// surowej linii policzka na proste odcinki referencyjne).
export function crossZ(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Czy b leży (w granicach eps, mm² — patrz tolerances.js/COLLINEAR_EPS) na prostej wyznaczonej
// przez a i c. THE canonical "is this a real corner" test — patrz tolerances.js dla
// wyjaśnienia, dlaczego domyślny epsilon jest w mm², nie mm.
export function isCollinear(a, b, c, eps = COLLINEAR_EPS) {
  return Math.abs(crossZ(a, b, c)) < eps;
}

// Rzutuje punkt p na NIESKOŃCZONĄ prostą przechodzącą przez lineStart->lineEnd. Zwraca:
// - u: odległość rzutu od lineStart wzdłuż kierunku prostej (może być < 0 lub > długość
//   odcinka — rzut nie jest przycinany, bo punkt po ręcznej edycji może leżeć poza oryginalnym
//   zakresem odcinka referencyjnego),
// - offset: PODPISANY dystans prostopadły od p do prostej (dodatni = po stronie "lewej"
//   względem kierunku lineStart->lineEnd, ujemny = "prawej"; zero = p leży dokładnie na prostej).
export function projectPointOntoLine(p, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = p.x - lineStart.x;
  const py = p.y - lineStart.y;
  const u = px * ux + py * uy;
  const offset = px * uy - py * ux; // = crossZ(lineStart, lineEnd, p) / len, sign convention kept simple
  return { u, offset };
}

// Pole powierzchni wieloboku ze znakiem (wzór Gaussa/shoelace) — dodatnie dla CCW, ujemne dla
// CW. THE canonical polygon-area primitive: poprzednio niezależnie reimplementowane jako
// `signedArea()` w edgeOverrides.js (walidacja edycji) i w validator/checks.js
// (checkOutlineWindingConsistency) — teraz jedna funkcja, jeden wzór. Użyj `Math.abs(...)` gdy
// potrzebna jest tylko wielkość (np. do zestawienia materiałowego), zachowaj znak, gdy liczy
// się orientacja (np. spójność nawinięcia konturu).
export function signedPolygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// Czy odcinek a1-a2 przecina PRAWDZIWIE (nie tylko "styka się końcem") odcinek b1-b2 — użyte
// przez constraints/geometricConstraints.js do wykrywania samoprzecinających się konturów
// stopni (kontur typu "bowtie"). Dzielone końce (wspólny wierzchołek sąsiednich boków
// wieloboku) NIE liczą się jako przecięcie — stąd ścisłe nierówności 0 < t < 1 i 0 < u < 1,
// a nie <=/>=.
export function segmentsProperlyIntersect(a1, a2, b1, b2) {
  const d1 = crossZ(b1, b2, a1);
  const d2 = crossZ(b1, b2, a2);
  const d3 = crossZ(a1, a2, b1);
  const d4 = crossZ(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Zwraca punkty ścieżki od odległości d0 do d1 (włącznie), w tym wierzchołki pośrednie (np. narożnik).
export function subPathPoints(vertices, cum, d0, d1) {
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(total, d0));
  const b = Math.max(0, Math.min(total, d1));
  const pts = [pointAtDistance(vertices, cum, a)];
  for (let i = 0; i < vertices.length; i++) {
    if (cum[i] > a && cum[i] < b) pts.push(vertices[i]);
  }
  pts.push(pointAtDistance(vertices, cum, b));
  return pts;
}
