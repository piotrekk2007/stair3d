import { pointsEqual, signedPolygonArea, normalizeVector } from './pathUtils.js';
import { CONSTRUCTION_TYPES, constructionTypeForSide, housingDepthMm } from './stringerModel.js';

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

// Przesuwa JEDEN róg stopnia (na krawędzi `edgeKey`, po stronie `sideIdx`) wzdłuż WŁASNEGO
// lokalnego kierunku tej krawędzi (od zawiasu — drugiego końca tej samej krawędzi — w stronę
// przesuwanego rogu) o `offsetMm`. To NIE jest projekcja na globalną oś biegu — dla stopnia
// zabiegowego front/back mają własne, niekoniecznie równoległe kierunki (patrz winderInfo), a
// ten kierunek zawsze poprawnie odzwierciedla "na zewnątrz od duszy" dla TEJ konkretnej
// krawędzi. Używa retargetPoint scoped do JEDNEGO stopnia — bez dotykania sąsiada, mimo że ten
// sam punkt (przed przesunięciem) mógł być z nim współdzielony.
function shiftEdgeCorner(tread, edgeKey, sideIdx, offsetMm) {
  const edge = tread[edgeKey];
  const hinge = edge[1 - sideIdx];
  const point = edge[sideIdx];
  const dir = normalizeVector({ x: point.x - hinge.x, y: point.y - hinge.y });
  const newPoint = { x: point.x + dir.x * offsetMm, y: point.y + dir.y * offsetMm };
  retargetPoint(tread, point, newPoint);
  return { oldPoint: point, newPoint };
}

// O ile (mm, per strona) koniec stopnia jest cofnięty od linii łańcucha przy wandze WPUSZCZANEJ — jako czysta
// funkcja config -> { inner, outer } (bez treads), żeby treadSolver.js mogło policzyć DOKŁADNIE to samo
// cofnięcie przy budowaniu "nominal" (patrz recessedEdge niżej), bez duplikowania warunku w dwóch miejscach.
//
// Wanga zajmuje pas [0, t] od łańcucha W GŁĄB schodów (lico zewnętrzne leży na łańcuchu — stringerRenderer.js),
// a gniazdo jest frezowane w jej licu WEWNĘTRZNYM na głębokość d = housingDepthMm(config) (parametr, domyślnie 20 mm). Stopień kończy się na dnie
// gniazda, czyli t − d od łańcucha (40 − 16 = 24 mm domyślnie). Wcześniej było tu samo d (16 mm) — stopień wchodził
// wtedy 24 mm w deskę przy gnieździe 16 mm, czyli 8 mm w lite drewno wangi.
// Wanga NAKŁADANA: stopień leży na wandze aż do jej lica zewnętrznego — cofnięcie 0.
export function housingRecessMm(config) {
  const recessFor = (side) =>
    constructionTypeForSide(config, side) === CONSTRUCTION_TYPES.CLOSED ? Math.max(0, config.stringerThickness - housingDepthMm(config)) : 0;
  return { inner: recessFor('inner'), outer: recessFor('outer') };
}

// --- Cofnięcie końców stopnia przy wandze WPUSZCZANEJ ---------------------------------------------------------
//
// Koniec stopnia ma leżeć na linii RÓWNOLEGŁEJ do wangi, `depth` od jej łańcucha (dno gniazda) — nie `depth`
// wzdłuż krawędzi stopnia. Przy stopniach zabiegowych krawędzie biegną ukośnie do wangi; przesunięcie wzdłuż
// krawędzi dawało wtedy za każdym razem inne cofnięcie prostopadle do wangi (brzeg biegu falował), a wierzchołek
// stopnia leżący w narożniku wangi nie cofał się wcale. Teraz: róg przesuwa się wzdłuż SWOJEJ krawędzi do
// przecięcia z linią łańcucha odsuniętą o `depth` w stronę stopnia; wierzchołek łańcucha wewnątrz stopnia (narożnik
// wangi) — do przecięcia obu odsuniętych linii (ucios). Wszystko liczone z ORYGINALNYCH punktów, więc kolejność
// przesuwania rogów niczego nie zmienia. Wspólne dla applyHousingRecess (final) i treadSolver.js nominalEdgesOf
// (nominal) — nieedytowany stopień ma nominal == final bit w bit.

// Below this |sin| the tread edge runs (nearly) along the wanga — no sensible intersection; shift along the edge.
const RECESS_MIN_EDGE_SIN = 0.05;

function distinctChain(chain) {
  const out = [];
  for (const p of chain || []) if (out.length === 0 || !pointsEqual(out[out.length - 1], p)) out.push(p);
  return out;
}

// Unit normal of segment a->b pointing toward `toward` (the tread's side).
function normalToward(a, b, toward) {
  const d = normalizeVector({ x: b.x - a.x, y: b.y - a.y });
  let n = { x: -d.y, y: d.x };
  if ((toward.x - a.x) * n.x + (toward.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  return n;
}

function midpoint(points) {
  const pts = points.length ? points : [{ x: 0, y: 0 }];
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

// Where `corner` lands when moved along its edge (corner -> hinge) onto the line parallel to chain segment a->b,
// `depth` toward the tread. Falls back to `depth` along the edge when the edge runs along the wanga.
function recessCorner(corner, hinge, a, b, depth, toward) {
  const n = normalToward(a, b, toward);
  const e = { x: hinge.x - corner.x, y: hinge.y - corner.y };
  const eLen = Math.hypot(e.x, e.y);
  const along = e.x * n.x + e.y * n.y;
  if (eLen < 1e-9) return corner;
  if (Math.abs(along) / eLen < RECESS_MIN_EDGE_SIN) return { x: corner.x + (e.x / eLen) * depth, y: corner.y + (e.y / eLen) * depth };
  const t = (depth - ((corner.x - a.x) * n.x + (corner.y - a.y) * n.y)) / along;
  return { x: corner.x + e.x * t, y: corner.y + e.y * t };
}

/**
 * The tread's recessed geometry for the given per-side depths — pure, from the ORIGINAL points only.
 * @param {{frontEdge, backEdge, innerChain, outerChain}} tread  (frontEdge/backEdge = [inner, outer])
 * @param {{inner:number, outer:number}} depthMm
 * @returns {{front:[{x,y},{x,y}], back:[{x,y},{x,y}], interior: {from:{x,y}, to:{x,y}}[]}}
 */
export function recessTreadToWangi(tread, depthMm) {
  const front = [...tread.frontEdge];
  const back = [...tread.backEdge];
  const interior = [];
  const chains = { inner: distinctChain(tread.innerChain), outer: distinctChain(tread.outerChain) };
  for (const [side, idx] of [['inner', 0], ['outer', 1]]) {
    const depth = depthMm[side];
    if (!(depth > 0)) continue;
    const chain = chains[side];
    const other = side === 'inner' ? chains.outer : chains.inner;
    const toward = other.length ? midpoint(other) : midpoint([tread.frontEdge[1 - idx], tread.backEdge[1 - idx]]);
    if (chain.length < 2) {
      // no chain to measure from (a collapsed dusza point): the old rule, `depth` along the edge
      front[idx] = shiftAlong(tread.frontEdge[idx], tread.frontEdge[1 - idx], depth);
      back[idx] = shiftAlong(tread.backEdge[idx], tread.backEdge[1 - idx], depth);
      continue;
    }
    front[idx] = recessCorner(tread.frontEdge[idx], tread.frontEdge[1 - idx], chain[0], chain[1], depth, toward);
    back[idx] = recessCorner(tread.backEdge[idx], tread.backEdge[1 - idx], chain[chain.length - 2], chain[chain.length - 1], depth, toward);
    for (let i = 1; i < chain.length - 1; i++) {
      const n1 = normalToward(chain[i - 1], chain[i], toward);
      const n2 = normalToward(chain[i], chain[i + 1], toward);
      const denom = 1 + n1.x * n2.x + n1.y * n2.y;
      const n = denom < 1e-6 ? n2 : { x: (n1.x + n2.x) / denom, y: (n1.y + n2.y) / denom };
      interior.push({ from: chain[i], to: { x: chain[i].x + n.x * depth, y: chain[i].y + n.y * depth } });
    }
  }
  return { front, back, interior };
}

function shiftAlong(point, hinge, depth) {
  const dir = normalizeVector({ x: hinge.x - point.x, y: hinge.y - point.y });
  return { x: point.x + dir.x * depth, y: point.y + dir.y * depth };
}

// Nominal edges for treadSolver.js: the same recess, computed on the RAW edges (see nominalEdgesOf).
export function recessedEdges(tread, depthMm) {
  const { front, back } = recessTreadToWangi(tread, depthMm);
  return { front, back };
}

// Automatyczne wgłębienie krawędzi stopnia po stronie WPUSZCZANEJ (housed) wangi — konsekwencja
// wybranego typu konstrukcji, NIE ręczna edycja użytkownika (patrz stringerModel.js
// constructionTypeForSide). Na wandze wpuszczanej stopień jest wsuwany w gniazdo wyfrezowane w
// jej licu wewnętrznym na głębokość housingDepthMm(config) — jego koniec leży więc na dnie
// gniazda, housingRecessMm() od łańcucha (grubość wangi − głębokość gniazda), na linii równoległej do wangi
// (recessTreadToWangi). Na wandze nakładanej stopień LEŻY na wandze — ta strona zostaje nietknięta.
//
// Ręczne wysunięcie (applyTreadOverhangs), jeśli jest, liczy się od już-wgłębionej krawędzi. Nigdy nie dotyka
// innerChain/outerChain — wanga nie przesuwa się ani o milimetr tylko dlatego, że wyfrezowano w niej gniazdo.
export function applyHousingRecess(treads, config) {
  const recessMm = housingRecessMm(config);
  if (recessMm.inner === 0 && recessMm.outer === 0) return treads;

  const result = treads.map(cloneTread);
  for (const tread of result) {
    if (!tread.frontEdge?.length || !tread.backEdge?.length) continue; // np. podest bez jednej strony

    // Oba cofnięcia razem muszą się zmieścić w krawędzi stopnia.
    const edgeLen = (e) => Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
    if (Math.min(edgeLen(tread.frontEdge), edgeLen(tread.backEdge)) <= recessMm.inner + recessMm.outer) {
      console.warn(`Pominięto automatyczne wgłębienie stopnia ${tread.index}: przy tej szerokości biegu i głębokości wręgi stopień stałby się niepoprawny.`);
      continue;
    }

    const original = { outline: [...tread.outline], frontEdge: [...tread.frontEdge], backEdge: [...tread.backEdge] };
    const before = signedArea(tread);
    const { front, back, interior } = recessTreadToWangi(tread, recessMm);
    const map = [
      [original.frontEdge[0], front[0]],
      [original.frontEdge[1], front[1]],
      [original.backEdge[0], back[0]],
      [original.backEdge[1], back[1]],
      ...interior.map((m) => [m.from, m.to]),
    ];
    const moveTo = (p) => {
      const hit = map.find(([from]) => pointsEqual(from, p));
      return hit ? hit[1] : p;
    };
    tread.outline = original.outline.map(moveTo);
    tread.frontEdge = front;
    tread.backEdge = back;
    const after = signedArea(tread);

    if (Math.abs(after) < 1 || Math.sign(after) !== Math.sign(before)) {
      Object.assign(tread, original);
      console.warn(`Pominięto automatyczne wgłębienie stopnia ${tread.index}: przy tej szerokości biegu i głębokości wręgi stopień stałby się niepoprawny.`);
    }
  }
  return result;
}

// Ręczne "wysunięcie" bocznej krawędzi POJEDYNCZEGO stopnia — patrz schema.js/
// config.manualTreadOverhangs. W przeciwieństwie do applyManualEdgeOverrides powyżej, NIGDY
// nie dotyka sąsiedniego stopnia: przesuwa WŁASNY front-róg i back-róg danego stopnia po
// stronie `side`, niezależnie od tego, że przed edycją mogły być identyczne z rogiem sąsiada
// (współdzielona granica). Wanga (innerChain/outerChain) i tak nigdy nie widzi tej edycji —
// dokładnie ta sama zasada co przy manualEdgeOverrides (patrz retargetPoint powyżej) — więc
// stopień może faktycznie wystawać poza wangę bez żadnej dodatkowej logiki po tamtej stronie.
// Zwraca nową tablicę stopni; nie mutuje `treads` przekazanego na wejściu.
export function applyTreadOverhangs(treads, overhangs) {
  const keys = overhangs ? Object.keys(overhangs) : [];
  if (keys.length === 0) return treads;

  const result = treads.map(cloneTread);

  for (const key of keys) {
    const treadIndex = Number(key);
    const overhang = overhangs[key];
    if (!overhang || !Number.isInteger(treadIndex) || treadIndex < 0 || treadIndex >= result.length) continue;

    const tread = result[treadIndex];
    if (!tread.frontEdge?.length || !tread.backEdge?.length) continue; // np. podest bez jednej strony
    const sideIdx = overhang.side === 'inner' ? 0 : 1;

    const before = signedArea(tread);
    const front = shiftEdgeCorner(tread, 'frontEdge', sideIdx, overhang.offsetMm);
    const back = shiftEdgeCorner(tread, 'backEdge', sideIdx, overhang.offsetMm);
    const after = signedArea(tread);

    if (Math.abs(after) < 1 || Math.sign(after) !== Math.sign(before)) {
      retargetPoint(tread, front.newPoint, front.oldPoint);
      retargetPoint(tread, back.newPoint, back.oldPoint);
      console.warn(`Pominięto wysunięcie krawędzi stopnia ${treadIndex}: wynikowy kształt byłby niepoprawny.`);
    } else {
      // Znacznik dla dalszych warstw (TreadModel -> walidator): ta krawędź została WYSUNIĘTA
      // celowo, więc brak ciągłości z sąsiadem po tej stronie nie jest defektem geometrii.
      tread.overhang = { side: overhang.side === 'inner' ? 'inner' : 'outer', offsetMm: overhang.offsetMm };
    }
  }

  return result;
}
