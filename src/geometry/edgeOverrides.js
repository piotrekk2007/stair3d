import { pointsEqual, signedPolygonArea } from './pathUtils.js';

// Każda z (numTreads + 1) granic między stopniami jest adresowana "indeksem granicy":
// 0 = krawędź czołowa pierwszego stopnia (jego frontEdge), N = krawędź tylna ostatniego
// stopnia (jego backEdge), a każda pośrednia i (0<i<N) to WSPÓLNA krawędź —
// treads[i-1].backEdge === treads[i].frontEdge (te same 2 punkty, [wewnętrzny, zewnętrzny]).
//
// Zwraca { before, after, current } — stopnie sąsiadujące z granicą (jeden z nich może być
// null na krańcach biegu) i aktualne (wzorcowe, z formuły) punkty tej granicy jako
// [wewnętrzny, zewnętrzny]. `current` to null, gdy boundaryIndex wypadł poza dzisiejszy zakres
// stopni (np. po zmianie liczby stopni granica przestała istnieć).
export function getBoundaryPoints(treads, boundaryIndex) {
  const n = treads.length;
  if (boundaryIndex < 0 || boundaryIndex > n || n === 0) return { before: null, after: null, current: null };
  if (boundaryIndex === 0) {
    const after = treads[0];
    return { before: null, after, current: after.frontEdge };
  }
  if (boundaryIndex === n) {
    const before = treads[n - 1];
    return { before, after: null, current: before.backEdge };
  }
  const before = treads[boundaryIndex - 1];
  const after = treads[boundaryIndex];
  return { before, after, current: after.frontEdge };
}

// Jak getBoundaryPoints, ale zwraca WYŁĄCZNIE punkty [wewnętrzny, zewnętrzny] z SUROWEGO,
// nieedytowanego łańcucha (innerChain/outerChain) — czyli NominalEdgeGeometry z
// docs/model/STAIRCASE_DATA_MODEL.md §3, nigdy FinalEdgeGeometry. Używane wszędzie tam, gdzie
// linia ma pozostać konstrukcyjnym odniesieniem niezależnym od ręcznej edycji (np. walkline
// na planie 2D — patrz plan2d/plan2dRenderer.js) — dokładnie ta sama zasada, z której korzysta
// już stringerSolver.js. Zwraca null, gdy granica nie istnieje albo sąsiadujący stopień ma
// pusty łańcuch po tej stronie (np. wewnętrzna strona podestu).
export function getNominalBoundaryPoints(treads, boundaryIndex) {
  const n = treads.length;
  if (boundaryIndex < 0 || boundaryIndex > n || n === 0) return null;
  const tread = boundaryIndex === n ? treads[n - 1] : treads[boundaryIndex];
  if (!tread.innerChain?.length || !tread.outerChain?.length) return null;
  const inner = boundaryIndex === n ? tread.innerChain[tread.innerChain.length - 1] : tread.innerChain[0];
  const outer = boundaryIndex === n ? tread.outerChain[tread.outerChain.length - 1] : tread.outerChain[0];
  return [inner, outer];
}

// Podmienia (przez porównanie wartości z epsilonem) każde wystąpienie `oldPoint` na `newPoint`
// w polach stopnia opisujących jego WŁASNY, widoczny kształt: `outline` (bryła stopnia),
// `frontEdge`/`backEdge` (krawędzie, z których korzysta też nosek i podstopień — patrz
// treadGeometry.js/riserGeometry.js — więc one słusznie mają podążać za edycją).
//
// CELOWO NIE dotyka `innerChain`/`outerChain` — to jedyne pola, z których korzysta
// stringerSolver.js do budowania wangi. Wanga ma zostać na surowej, wzorcowej linii,
// dokładnie tak jak przy nosku (patrz treadGeometry.js/nosingUtils.js: nosek też liczy się
// z osobnej, nieedytowanej linii konstrukcyjnej, a wanga nigdy go "nie goni"). Bez tego
// rozdzielenia przesunięcie jednego punktu przekręcało od razu 2 sąsiednie panele wangi w
// przeciwne strony (bo każdy panel wangi liczy swoją płaszczyznę z WŁASNYCH dwóch końców
// outerChain/innerChain, niezależnie od sąsiada).
function retargetPoint(tread, oldPoint, newPoint) {
  const replace = (pts) => pts.map((p) => (pointsEqual(p, oldPoint) ? newPoint : p));
  tread.outline = replace(tread.outline);
  tread.frontEdge = replace(tread.frontEdge);
  tread.backEdge = replace(tread.backEdge);
}

// Pole powierzchni konturu (wzór Gaussa, patrz pathUtils.js signedPolygonArea — THE canonical
// implementation) — dodatnie i sensownie duże = kształt nie jest zdegenerowany/samoprzecinający
// się w prosty sposób. Używane jako lekka walidacja po edycji.
function signedArea(tread) {
  const pts = tread.outline;
  if (pts.length < 3) return 0;
  return signedPolygonArea(pts);
}

function cloneTread(tread) {
  return {
    ...tread,
    outline: [...tread.outline],
    frontEdge: [...tread.frontEdge],
    backEdge: [...tread.backEdge],
    innerChain: [...tread.innerChain],
    outerChain: [...tread.outerChain],
  };
}

// Nakłada ręczne przesunięcia krawędzi (patrz schema.js/config.manualEdgeOverrides) na stopnie
// wyliczone wzorem. Każdy wpis porusza TYLKO jeden koniec (movedEndpoint) danej granicy — drugi
// koniec (zawias) zawsze zostaje na aktualnej, wzorcowej pozycji. Jeśli wynikowy kształt
// któregoś z dotkniętych stopni wyszedłby zdegenerowany (zerowe/ujemne pole albo odwrócony
// zwrot), edycja tej granicy jest pomijana (z ostrzeżeniem w konsoli) — reszta nadal się
// stosuje. Zwraca nową tablicę stopni; nie mutuje `treads` przekazanego na wejściu.
export function applyManualEdgeOverrides(treads, overrides) {
  const keys = overrides ? Object.keys(overrides) : [];
  if (keys.length === 0) return treads;

  const result = treads.map(cloneTread);

  for (const key of keys) {
    const boundaryIndex = Number(key);
    const override = overrides[key];
    if (!override || !Number.isInteger(boundaryIndex)) continue;

    const { before, after, current } = getBoundaryPoints(result, boundaryIndex);
    if (!current) continue; // granica już nie istnieje przy dzisiejszej liczbie stopni

    const oldPoint = override.movedEndpoint === 'inner' ? current[0] : current[1];
    const newPoint = override.point;
    const affected = [before, after].filter(Boolean);

    const areasBefore = affected.map(signedArea);
    for (const tread of affected) retargetPoint(tread, oldPoint, newPoint);
    const areasAfter = affected.map(signedArea);

    const broken = areasAfter.some(
      (a, i) => Math.abs(a) < 1 || Math.sign(a) !== Math.sign(areasBefore[i])
    );
    if (broken) {
      for (const tread of affected) retargetPoint(tread, newPoint, oldPoint);
      console.warn(`Pominięto ręczną edycję krawędzi ${boundaryIndex}: wynikowy kształt stopnia byłby niepoprawny.`);
    }
  }

  return result;
}
