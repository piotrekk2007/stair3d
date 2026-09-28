// Wspólna matematyka noska i kierunków normalnych — używana przez stopień
// (treadGeometry.js), podstopień (riserGeometry.js) i policzek (stringerRenderer.js), żeby
// wszystkie trzy elementy zawsze zgadzały się co do tego, GDZIE dokładnie leży noskowana
// krawędź czołowa stopnia i w którą stronę "na zewnątrz" wskazuje.
//
// Dwa kanoniczne sposoby liczenia kierunku "na zewnątrz" (item 6 konsolidacji — to SĄ
// matematycznie różne przypadki, więc celowo NIE są scalone w jedną funkcję):
//   - outwardNormalFromOutline() — gdy znamy TYLKO kontur stopnia i jego krawędź czołową
//     (brak niezależnie znanego kierunku wchodzenia) — jedyny sposób, jaki mamy dla
//     zwykłego/podestowego stopnia, gdzie kierunek liczymy z testu względem środka ciężkości.
//   - outwardNormalFromForward() — gdy kierunek wchodzenia JEST już znany wprost (np. z
//     tread.winderInfo, albo z segment.referenceLine.direction w stringerModel) — wtedy
//     normalna "na zewnątrz" to po prostu przeciwieństwo tego kierunku, bez testu środka
//     ciężkości (który dla wachlarzowatych konturów zabiegowych bywa niestabilny — patrz
//     historia problemu w riserGeometry.js/buildWinderRiserPanels).

import { INTERSECTION_EPS } from './tolerances.js';

// Przecięcie prostej (p1 + t*d1) z prostą (p2 + s*d2); zwraca punkt lub null gdy równoległe.
function lineIntersect(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < INTERSECTION_EPS) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

// Wyznacza kierunek "na zewnątrz/do tyłu" (prostopadły do frontEdge, odwrócony od środka
// konturu) — ten sam test wszędzie, żeby znak nigdy się nie rozjechał między plikami. Patrz
// nagłówek pliku: użyj TEJ funkcji tylko gdy nie masz niezależnie znanego kierunku wchodzenia.
export function outwardNormalFromOutline(tread) {
  const { outline, frontEdge } = tread;
  const [inner0, outer0] = frontEdge;
  const frontDir = { x: outer0.x - inner0.x, y: outer0.y - inner0.y };
  let normal = { x: -frontDir.y, y: frontDir.x };
  const len = Math.hypot(normal.x, normal.y) || 1;
  normal = { x: normal.x / len, y: normal.y / len };

  let cx = 0, cy = 0;
  for (const p of outline) { cx += p.x; cy += p.y; }
  cx /= outline.length; cy /= outline.length;
  const toFront = { x: (inner0.x + outer0.x) / 2 - cx, y: (inner0.y + outer0.y) / 2 - cy };
  if (normal.x * toFront.x + normal.y * toFront.y < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  return { normal, frontDir };
}

// Gdy kierunek wchodzenia (lub jego lokalny odpowiednik — np. kierunek policzka w danym
// miejscu) JEST już znany, normalna "na zewnątrz" to po prostu jego przeciwieństwo — nosek/
// podstopień leżą PRZED stopniem względem kierunku wchodzenia, więc ich widoczna, zewnętrzna
// ściana jest zwrócona dokładnie przeciwnie do tego kierunku. Brak testu środka ciężkości —
// nie jest potrzebny, bo kierunek już jednoznacznie wiadomo skąd wziąć.
export function outwardNormalFromForward(forwardDir) {
  return { x: -forwardDir.x, y: -forwardDir.y };
}

// Przesuwa krawędź czołową stopnia (frontEdge) o `distance` wzdłuż normalnej (dodatnie = na
// zewnątrz/do tyłu, jak przy nosku; ujemne = do wewnątrz/do przodu, jak przy cofaniu wangi
// pod podstopień), a boczne krawędzie (innerChain/outerChain) PRZEDŁUŻA wzdłuż ich własnego
// kierunku aż do przecięcia z tą przesuniętą prostą — dzięki temu boki zostają równoległe
// do wang nawet w zabiegu, gdzie krawędź czołowa nie jest prostopadła do boków.
//
// Kierunek boku bierzemy z KOŃCOWEGO konturu stopnia (sąsiad narożnika czoła, który nie jest drugim narożnikiem
// czoła), a nie z surowego łańcucha wangi (innerChain[0] -> innerChain[1]): narożnik czoła bywa już przesunięty
// (stopień cofnięty do dna wpustu wangi wpuszczanej, ręczna edycja), więc prosta "narożnik -> innerChain[1]" nie jest
// bokiem stopnia. Na zabiegowym z bardzo krótkim bokiem przy duszy (kilkanaście mm przy słupie narożnym) dawała
// dowolny kierunek i narożnik noska lądował daleko na przesuniętej prostej — kontur domykał się dodatkową, ukośną
// krawędzią, czyli czoło stopnia się "łamało" (zgłoszone 2026-09-28). Łańcuch zostaje tylko jako rezerwa.
function sideDirection(outline, corner, otherCorner, chain) {
  const i = (outline || []).findIndex((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-6);
  if (i >= 0) {
    const n = outline.length;
    for (const step of [1, -1]) {
      const first = outline[(i + step + n) % n];
      if (Math.hypot(first.x - otherCorner.x, first.y - otherCorner.y) < 1e-6) continue; // that way is the front edge
      // walk away from the corner past zero-length edges
      for (let k = 1; k < n; k++) {
        const q = outline[(i + step * k + n * k) % n];
        const d = { x: q.x - corner.x, y: q.y - corner.y };
        if (Math.hypot(d.x, d.y) > 1e-6) return d;
      }
    }
  }
  const next = chain?.[1];
  return next ? { x: next.x - corner.x, y: next.y - corner.y } : null;
}

export function shiftFrontEdge(tread, distance) {
  const { frontEdge, innerChain, outerChain, outline } = tread;
  const [inner0, outer0] = frontEdge;
  if (distance === 0) return { newInner0: inner0, newOuter0: outer0 };

  const { normal, frontDir } = outwardNormalFromOutline(tread);
  const shiftedFrontPoint = { x: inner0.x + normal.x * distance, y: inner0.y + normal.y * distance };

  const innerDir = sideDirection(outline, inner0, outer0, innerChain) || frontDir;
  const newInner0 = lineIntersect(inner0, innerDir, shiftedFrontPoint, frontDir) || {
    x: inner0.x + normal.x * distance,
    y: inner0.y + normal.y * distance,
  };

  const outerDir = sideDirection(outline, outer0, inner0, outerChain) || frontDir;
  const newOuter0 = lineIntersect(outer0, outerDir, shiftedFrontPoint, frontDir) || {
    x: outer0.x + normal.x * distance,
    y: outer0.y + normal.y * distance,
  };

  return { newInner0, newOuter0 };
}
