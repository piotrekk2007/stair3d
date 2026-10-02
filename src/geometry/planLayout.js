import { cumulativeDistances, pointAtDistance, subPathPoints, pointsEqual, isCollinear, normalizeVector } from './pathUtils.js';
import { applyManualEdgeOverrides, applyHousingRecess, applyTreadOverhangs } from './edgeOverrides.js';
import { arcWinderGeometry, landingArcPoints } from './winderArc.js';

// Buduje płaski (2D, mm) układ schodów: granicę zewnętrzną, wewnętrzną i zarysy stopni.
// Metoda zabiegu: OD LINII BIEGU (winderArc.js) — linia biegu to prosta, ćwiartka łuku wokół narożnika duszy i
// prosta; zabieg dzieli ją na równe odcinki, a każda krawędź przechodzi przez swój punkt na niej i swój punkt na
// duszy (rozwinięcie). Gdy łuk nie mieści się w zabiegu, zostaje dawna metoda PROPORCJONALNA
// (buildTurnLocalProportional). Układ zwraca też linię biegu jako dane: `walkline = { path, points }` — droga do
// rysowania (łuk jako cięciwy) i punkt linii biegu na każdej granicy stopni (null, gdzie go nie ma).
//
// Zakręty (L, U) są budowane w LOKALNYM układzie współrzędnych (buildTurnLocal) w
// konwencji "skręt w prawo", a następnie łączone łańcuchowo poprzez transformację
// (obrót o -90° + przesunięcie) dla kolejnego odcinka. Całość jest na końcu lustrzana
// względem osi X, jeśli turnDirection === 'left' — dzięki temu oba zakręty schodów U
// zawsze skręcają w tę samą stronę (spirala), a nie zygzakiem.
export function buildPlanLayout(config) {
  const layout =
    config.stairType === 'straight'
      ? buildStraightLayout(config)
      : config.stairType === 'U'
      ? buildMultiTurnLayout(config)
      : buildMultiTurnLayout(config, 1);
  layout.handedness = layoutHandedness(config);

  // Ręczne przesunięcia krawędzi (przeciąganie na planie 2D) — jedno miejsce, więc każdy
  // konsument planLayout (widok 3D, plan 2D, wymiary, formatki zabiegowe) dostaje już
  // poprawioną geometrię bez własnej wiedzy o istnieniu edycji. Patrz edgeOverrides.js.
  if (config.manualEdgeOverrides && Object.keys(config.manualEdgeOverrides).length > 0) {
    layout.treads = applyManualEdgeOverrides(layout.treads, config.manualEdgeOverrides);
  }
  // Automatyczne wgłębienie po stronie wpuszczanej — konsekwencja typu konstrukcji wangi, nie
  // ręczna edycja, więc stosowane zawsze, PO ręcznym przesunięciu wspólnego rogu (edytowany róg to
  // "prawdziwa" krawędź, którą dopiero wgłębiamy) i PRZED ewentualnym ręcznym wysunięciem stopnia
  // (patrz edgeOverrides.js applyHousingRecess — oba mechanizmy się swobodnie składają).
  layout.treads = applyHousingRecess(layout.treads, config);
  // Stosowane PO manualEdgeOverrides (a nie zamiast) — kolejność nie ma tu znaczenia
  // geometrycznego (obie edycje operują na rozłącznych aspektach: wspólny róg vs własny,
  // niedzielony róg jednego stopnia), ale trzyma obie ręczne edycje razem, w jednym miejscu.
  if (config.manualTreadOverhangs && Object.keys(config.manualTreadOverhangs).length > 0) {
    layout.treads = applyTreadOverhangs(layout.treads, config.manualTreadOverhangs);
  }

  return layout;
}

function mirrorX(pt) {
  return { x: -pt.x, y: pt.y };
}

// mirrorX() jest liniowe (bez przesunięcia), więc ten sam wzór poprawnie odbija zarówno
// punkty, jak i wektory kierunkowe — używane, żeby winderInfo (patrz buildTurnLocal)
// przetrwało lustrzane odbicie całego układu przy turnDirection === 'left'.
function mirrorWinderEdge(edge) {
  return {
    inner: mirrorX(edge.inner),
    outer: mirrorX(edge.outer),
    innerDirection: mirrorX(edge.innerDirection),
    outerDirection: mirrorX(edge.outerDirection),
  };
}

function mirrorWinderInfo(winderInfo) {
  return {
    ...winderInfo,
    frontEdge: mirrorWinderEdge(winderInfo.frontEdge),
    backEdge: mirrorWinderEdge(winderInfo.backEdge),
    direction: mirrorX(winderInfo.direction),
  };
}

// Usuwa punkty pośrednie leżące na prostej między sąsiadami (np. sztuczny szew po scaleniu
// dwóch łańcuchów) — zostają tylko prawdziwe narożniki (rzeczywiste załamania kierunku).
// Ten sam kanoniczny test współliniowości co stringerSolver.js (patrz pathUtils.js/isCollinear
// + tolerances.js/COLLINEAR_EPS) — wcześniej ta funkcja miała własny, niezależny próg.
function removeCollinearPoints(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = result[result.length - 1];
    const b = points[i];
    const c = points[i + 1];
    if (!isCollinear(a, b, c)) result.push(b);
  }
  result.push(points[points.length - 1]);
  return result;
}

// Łączy dwie sąsiadujące, prostopadłe połówki podestu (każda to osobny zakręt typu 'landing',
// czyli to co UI nazywa "półpodestem") w JEDEN płaski, prostokątny podest na JEDNEJ wysokości —
// zamiast dwóch stopniowanych półpodestów (landingA i landingB inaczej lądowałyby na dwóch
// kolejnych, różnych wysokościach, bo każdy dostawałby własny indeks/stopień). Krawędź wejściowa
// całości to krawędź wejściowa landingA (bez zmian), krawędź wyjściowa to krawędź wyjściowa
// landingB (bez zmian) — łączy się tylko ich wspólna, zewnętrzna granica, usuwając sztuczny szew
// (kolinearny punkt) tam, gdzie się stykały.
function mergeLandingPair(landingA, landingB) {
  const merged = [...landingA.outerChain];
  for (const p of landingB.outerChain) {
    if (!pointsEqual(merged[merged.length - 1], p)) merged.push(p);
  }
  const outerChain = removeCollinearPoints(merged);

  return {
    index: landingA.index,
    type: 'landing',
    outline: [...outerChain].reverse(),
    frontEdge: landingA.frontEdge,
    backEdge: landingB.backEdge,
    innerChain: [],
    outerChain,
  };
}

// Lokalny kierunek "w prawo" względem v (skręt w prawo o -90°) — KANONICZNA definicja
// "kierunku poprzecznego" w całym module (item 3 konsolidacji): przy każdym łańcuchowaniu
// odcinków biegu (makeFrame) i przy każdej transformacji punktu/wektora (toWorld,
// transformDirection) "right" jest DOKŁADNIE tym, co ta funkcja zwraca dla "forward" danej
// lokalnej ramki — nigdzie indziej w tym pliku nie ma alternatywnego sposobu wyznaczania
// strony poprzecznej. Eksportowana, żeby renderer wangi (stringerRenderer.js) używał TEJ
// SAMEJ definicji przy ustalaniu, w którą stronę biegnie grubość policzka (na zewnątrz vs.
// do wnętrza schodów), zamiast liczyć to na nowo własnym wzorem.
export function rotate90CW(v) {
  return { x: v.y, y: -v.x };
}

// +1 when the layout is in its native "turn right" handedness, -1 when the whole plan was mirrored (mirrorX,
// turnDirection === 'left' on an L/U stair). A straight stair is never mirrored.
export function layoutHandedness(config) {
  return config.stairType !== 'straight' && config.turnDirection === 'left' ? -1 : 1;
}

/**
 * THE one answer to "which way is INTO the stair from a wanga's line" (the side the board's thickness, a
 * balustrade's lateral offset, a post's centre go to). rotate90CW(forward) points from the outer toward the inner
 * side only in the native right-turn frame; a mirrored (left-turn) plan flips it — which is what used to extrude
 * every wanga of a left-turn stair OUTWARD, leaving a gap next to the treads.
 * @param {{x:number,y:number}} direction  the line's own walking direction (unit)
 * @param {'outer'|'inner'} side
 * @param {1|-1} handedness  planLayout.handedness
 */
export function inwardNormal(direction, side, handedness) {
  const cw = rotate90CW(direction);
  const s = (side === 'outer' ? 1 : -1) * handedness;
  return { x: cw.x * s, y: cw.y * s };
}

function makeFrame(origin, fwd) {
  return { origin, fwd, right: rotate90CW(fwd) };
}

const IDENTITY_FRAME = makeFrame({ x: 0, y: 0 }, { x: 0, y: 1 });

function toWorld(local, frame) {
  return {
    x: frame.origin.x + local.x * frame.right.x + local.y * frame.fwd.x,
    y: frame.origin.y + local.x * frame.right.y + local.y * frame.fwd.y,
  };
}

function transformPoints(points, frame) {
  if (frame === IDENTITY_FRAME) return points;
  return points.map((p) => toWorld(p, frame));
}

// Obraca (BEZ przesunięcia) wektor kierunkowy — używane dla pól typu "direction"
// (innerDirection/outerDirection/direction w winderInfo), które muszą podążać za obrotem
// ramki przy łańcuchowaniu kolejnych odcinków biegu (buildMultiTurnLayout), ale nie mają
// własnej pozycji do przesunięcia — w przeciwieństwie do punktów (toWorld/transformPoints).
function transformDirection(v, frame) {
  return {
    x: v.x * frame.right.x + v.y * frame.fwd.x,
    y: v.x * frame.right.y + v.y * frame.fwd.y,
  };
}

function transformWinderEdge(edge, frame) {
  return {
    inner: toWorld(edge.inner, frame),
    outer: toWorld(edge.outer, frame),
    innerDirection: transformDirection(edge.innerDirection, frame),
    outerDirection: transformDirection(edge.outerDirection, frame),
  };
}

function transformWinderInfo(winderInfo, frame) {
  return {
    ...winderInfo,
    frontEdge: transformWinderEdge(winderInfo.frontEdge, frame),
    backEdge: transformWinderEdge(winderInfo.backEdge, frame),
    direction: transformDirection(winderInfo.direction, frame),
  };
}

function transformWalkline(walkline, frame) {
  if (frame === IDENTITY_FRAME) return walkline;
  return { path: transformPoints(walkline.path, frame), points: walkline.points.map((p) => (p ? toWorld(p, frame) : null)) };
}

// The walkline point at a fraction of an edge measured from its OUTER end — the old (proportional) definition, kept
// for the fallback layout and the straight stair, where it is exact.
function walkPointOnEdge(inner, outer, stairWidth, walklineOffset) {
  const t = Math.min(1, Math.max(0, (stairWidth - walklineOffset) / stairWidth));
  return { x: outer.x + (inner.x - outer.x) * t, y: outer.y + (inner.y - outer.y) * t };
}

// Arc length of `p` along a polyline (p is on it or close to it).
function alongOnPath(path, cum, p) {
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const ab = { x: path[i].x - a.x, y: path[i].y - a.y };
    const len2 = ab.x * ab.x + ab.y * ab.y;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2)) : 0;
    const d = Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y);
    if (!best || d < best.d - 1e-9) best = { d, along: cum[i - 1] + Math.sqrt(len2) * t };
  }
  return best ? best.along : 0;
}

function transformTread(tread, frame) {
  if (frame === IDENTITY_FRAME) return tread;
  return {
    ...tread,
    outline: transformPoints(tread.outline, frame),
    frontEdge: transformPoints(tread.frontEdge, frame),
    backEdge: transformPoints(tread.backEdge, frame),
    innerChain: transformPoints(tread.innerChain, frame),
    outerChain: transformPoints(tread.outerChain, frame),
    ...(tread.winderInfo ? { winderInfo: transformWinderInfo(tread.winderInfo, frame) } : {}),
  };
}

function buildStraightLayout(config) {
  const { stairWidth, treadGoing, treadsLegA } = config;
  const numTreads = treadsLegA;
  const outerFullPath = [{ x: 0, y: 0 }, { x: 0, y: numTreads * treadGoing }];
  const innerFullPath = [{ x: stairWidth, y: 0 }, { x: stairWidth, y: numTreads * treadGoing }];

  const treads = [];
  for (let i = 0; i < numTreads; i++) {
    const y0 = i * treadGoing;
    const y1 = (i + 1) * treadGoing;
    const inner0 = { x: stairWidth, y: y0 };
    const inner1 = { x: stairWidth, y: y1 };
    const outer0 = { x: 0, y: y0 };
    const outer1 = { x: 0, y: y1 };
    treads.push({
      index: i,
      type: 'straight',
      outline: [inner0, inner1, outer1, outer0],
      frontEdge: [inner0, outer0],
      backEdge: [inner1, outer1],
      innerChain: [inner0, inner1],
      outerChain: [outer0, outer1],
    });
  }

  const walkX = walkPointOnEdge({ x: stairWidth, y: 0 }, { x: 0, y: 0 }, stairWidth, config.walklineOffset).x;
  const points = [];
  for (let k = 0; k <= numTreads; k++) points.push({ x: walkX, y: k * treadGoing });

  return {
    outerFullPath,
    innerFullPath,
    treads,
    turns: [],
    walkline: { path: [points[0], points[points.length - 1]], points },
    // Outer AND inner line: a straight stair's outer line alone is one segment with zero width.
    bounds: computeBounds([...outerFullPath, ...innerFullPath]),
  };
}

// One straight -> winders -> straight piece laid out from the walkline (winderArc.js); the proportional layout when
// the arc does not fit in the winder zone. Same local frame, same output shape as buildTurnLocalProportional.
function buildTurnLocal(params, treadsIn, windersCount, treadsOut, startIndex, pins = {}) {
  const geo = arcWinderGeometry(params, treadsIn, windersCount, pins);
  if (!geo) return buildTurnLocalProportional(params, treadsIn, windersCount, treadsOut, startIndex);
  const { stairWidth: W, treadGoing: g, walklineOffset: off } = params;
  const { s0, Yc, Ic, Oc, xTurnEnd } = geo;
  const zoneEnd = treadsIn + windersCount;
  const xEnd = xTurnEnd + treadsOut * g;
  const outerPath = [{ x: 0, y: 0 }, Oc, { x: xEnd, y: Yc + W }];
  const innerPath = [{ x: W, y: 0 }, Ic, { x: xEnd, y: Yc }];
  const outerTurnPath = [{ x: 0, y: s0 }, Oc, { x: xTurnEnd, y: Yc + W }];
  const innerTurnPath = [{ x: W, y: s0 }, Ic, { x: xTurnEnd, y: Yc }];
  const outerTurnCum = cumulativeDistances(outerTurnPath);
  const innerTurnCum = cumulativeDistances(innerTurnPath);
  const numTreads = treadsIn + windersCount + treadsOut;
  const ENTRANCE = { x: 0, y: 1 };
  const EXIT = { x: 1, y: 0 };

  const innerPts = [];
  const outerPts = [];
  const walkPts = [];
  const innerAlong = [];
  const outerAlong = [];
  const innerDirAt = [];
  const outerDirAt = [];
  for (let k = 0; k <= numTreads; k++) {
    if (k < treadsIn) {
      innerPts.push({ x: W, y: k * g });
      outerPts.push({ x: 0, y: k * g });
      walkPts.push({ x: W - off, y: k * g });
      innerDirAt.push(ENTRANCE);
      outerDirAt.push(ENTRANCE);
    } else if (k > zoneEnd) {
      const x = xTurnEnd + (k - zoneEnd) * g;
      innerPts.push({ x, y: Yc });
      outerPts.push({ x, y: Yc + W });
      walkPts.push({ x, y: Yc + off });
      innerDirAt.push(EXIT);
      outerDirAt.push(EXIT);
    } else {
      const b = geo.boundaries[k - treadsIn];
      innerPts.push(b.inner);
      outerPts.push(b.outer);
      walkPts.push(b.walk);
      const ia = alongOnPath(innerTurnPath, innerTurnCum, b.inner);
      const oa = alongOnPath(outerTurnPath, outerTurnCum, b.outer);
      innerAlong[k] = ia;
      outerAlong[k] = oa;
      // the side's own direction where the edge meets it: before or after that side's corner
      innerDirAt.push(k === treadsIn ? ENTRANCE : k === zoneEnd ? EXIT : ia <= innerTurnCum[1] + 1e-9 ? ENTRANCE : EXIT);
      outerDirAt.push(k === treadsIn ? ENTRANCE : k === zoneEnd ? EXIT : oa <= outerTurnCum[1] + 1e-9 ? ENTRANCE : EXIT);
    }
  }

  const treads = [];
  for (let i = 0; i < numTreads; i++) {
    const k0 = i;
    const k1 = i + 1;
    const isWinder = k0 >= treadsIn && k0 < zoneEnd;
    const innerChain = isWinder ? subPathPoints(innerTurnPath, innerTurnCum, innerAlong[k0], innerAlong[k1]) : [innerPts[k0], innerPts[k1]];
    const outerChain = isWinder ? subPathPoints(outerTurnPath, outerTurnCum, outerAlong[k0], outerAlong[k1]) : [outerPts[k0], outerPts[k1]];
    const tread = {
      index: startIndex + i,
      type: isWinder ? 'winder' : 'straight',
      outline: [...innerChain, ...[...outerChain].reverse()],
      frontEdge: [innerPts[k0], outerPts[k0]],
      backEdge: [innerPts[k1], outerPts[k1]],
      innerChain,
      outerChain,
    };
    if (isWinder) {
      const m = i - treadsIn;
      const inner0 = innerPts[k0];
      const inner1 = innerPts[k1];
      const outer0 = outerPts[k0];
      const outer1 = outerPts[k1];
      tread.winderInfo = {
        frontEdge: { inner: inner0, outer: outer0, innerDirection: innerDirAt[k0], outerDirection: outerDirAt[k0] },
        backEdge: { inner: inner1, outer: outer1, innerDirection: innerDirAt[k1], outerDirection: outerDirAt[k1] },
        // the walking direction of the tread = the walkline's own direction in its middle
        direction: normalizeVector(geo.tangentAt(s0 + (m + 0.5) * g)),
        stationStart: m * g,
        stationEnd: (m + 1) * g,
        widths: {
          atFront: Math.hypot(outer0.x - inner0.x, outer0.y - inner0.y),
          atBack: Math.hypot(outer1.x - inner1.x, outer1.y - inner1.y),
        },
        walklinePosition: { index: m, count: windersCount, fractionStart: m / windersCount, fractionEnd: (m + 1) / windersCount },
      };
    }
    treads.push(tread);
  }

  const walkPath = [{ x: W - off, y: 0 }, ...geo.arcPoints, { x: xEnd, y: Yc + off }].filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6);
  return {
    outerPath,
    innerPath,
    treads,
    turnInfo: {
      type: 'winder',
      innerCorner: Ic,
      outerCorner: Oc,
      innerTurnSegmentLength: geo.duszaWidth,
      outerBendPoint: Oc,
      innerBendPoint: Ic,
      method: 'walkline-arc',
    },
    walkline: { path: walkPath, points: walkPts },
    numTreadsUsed: numTreads,
    exitOuterPoint: outerPath[outerPath.length - 1],
  };
}

// FALLBACK (the arc does not fit — see buildTurnLocal): the old PROPORTIONAL layout. Buduje pojedynczy odcinek
// prosty->zabieg->prosty w lokalnym układzie (local +Y = kierunek wejścia, local +X = kierunek wyjścia po skręcie w
// prawo o 90°, local x=0 = policzek zewnętrzny, local x=stairWidth = policzek wewnętrzny/dusza).
function buildTurnLocalProportional({ stairWidth, treadGoing, walklineOffset, walklineSplitOffset }, treadsIn, windersCount, treadsOut, startIndex) {
  const Yc = treadsIn * treadGoing;
  const Ic = { x: stairWidth, y: Yc };
  const Oc = { x: 0, y: Yc + stairWidth };

  // Wx: odsunięcie linii biegu od duszy (poprzek biegu, oś X lokalna) — walklineOffset.
  // distanceToCorner_A: ile z długości zabiegu (wzdłuż biegu) przypada PRZED narożnikiem —
  // niezależny parametr walklineSplitOffset, pozwala na niesymetryczny zabieg.
  const Wx = stairWidth - walklineOffset;
  const Wc = { x: Wx, y: Yc + walklineSplitOffset };

  const totalTurnPathLength = windersCount * treadGoing;
  const distanceToCorner_A = walklineSplitOffset;
  const distanceFromCorner_B = totalTurnPathLength - distanceToCorner_A;

  const turnZoneEndWalk = { x: Wx + distanceFromCorner_B, y: Wc.y };

  const outerTurnStart = { x: 0, y: Yc };
  const outerTurnEnd = { x: turnZoneEndWalk.x, y: Yc + stairWidth };
  const outerTurnPath = [outerTurnStart, Oc, outerTurnEnd];
  const outerTurnCum = cumulativeDistances(outerTurnPath);
  const outerTurnLen = outerTurnCum[outerTurnCum.length - 1];

  const innerTurnStart = Ic;
  const innerTurnEnd = { x: turnZoneEndWalk.x, y: Yc };
  const innerTurnPath = [innerTurnStart, innerTurnEnd];
  const innerTurnCum = cumulativeDistances(innerTurnPath);
  const innerTurnLen = innerTurnCum[innerTurnCum.length - 1];

  const xEnd = turnZoneEndWalk.x + treadsOut * treadGoing;
  const outerPath = [{ x: 0, y: 0 }, Oc, { x: xEnd, y: Yc + stairWidth }];
  const innerPath = [{ x: stairWidth, y: 0 }, Ic, { x: xEnd, y: Yc }];

  const numTreads = treadsIn + windersCount + treadsOut;

  // Kierunek "wzdłuż" policzka zewnętrznego/wewnętrznego w punkcie odległości d od początku
  // danej ścieżki — czyli lokalny odpowiednik kierunku wchodzenia (Step.localWalkingDirection
  // z docs/model/STAIRCASE_DATA_MODEL.md §2.8) DLA TEJ KONKRETNEJ strony biegu w tym miejscu.
  // Dusza (policzek wewnętrzny) w metodzie proporcjonalnej ma swój narożnik DOKŁADNIE na
  // starcie strefy zabiegu (Ic), więc jej kierunek jest w całym zabiegu stały. Policzek
  // zewnętrzny łamie się dopiero przy Oc — stąd jego kierunek zależy od tego, czy dana
  // odległość d wypadła przed, czy po tym załamaniu. To właśnie ta różnica faz — gdy
  // kierunek zewnętrzny i wewnętrzny w tym samym punktcie NIE są zgodne — jest źródłem
  // "nienaturalnie szerokiego/obróconego" podstopnia opisanego w audycie: prosty odcinek
  // między punktem wewnętrznym i zewnętrznym łączy dwa punkty, które fizycznie "patrzą" w
  // innych kierunkach. Zamiast łatać to jednym warunkiem przy budowie podstopnia,
  // eksponujemy tu wprost oba kierunki dla każdej granicy — geometria podstopnia
  // (riserGeometry.js) korzysta z nich, żeby zbudować wachlarz paneli zamiast jednego,
  // błędnie zorientowanego płaskiego panelu (patrz buildWinderRiserPanels).
  function unit(dx, dy) {
    return normalizeVector({ x: dx, y: dy });
  }
  const innerDirConst = unit(innerTurnEnd.x - innerTurnStart.x, innerTurnEnd.y - innerTurnStart.y);
  const outerSeg1Len = Math.hypot(Oc.x - outerTurnStart.x, Oc.y - outerTurnStart.y);
  const outerDirBeforeBend = unit(Oc.x - outerTurnStart.x, Oc.y - outerTurnStart.y);
  const outerDirAfterBend = unit(outerTurnEnd.x - Oc.x, outerTurnEnd.y - Oc.y);
  function outerDirectionAtDistance(d) {
    return d <= outerSeg1Len ? outerDirBeforeBend : outerDirAfterBend;
  }

  const outerPts = [];
  const innerPts = [];
  const outerDirAt = [];
  const innerDirAt = [];
  for (let k = 0; k <= numTreads; k++) {
    if (k <= treadsIn) {
      const y = k * treadGoing;
      outerPts.push({ x: 0, y });
      innerPts.push({ x: stairWidth, y });
      outerDirAt.push({ x: 0, y: 1 });
      innerDirAt.push({ x: 0, y: 1 });
    } else if (k >= treadsIn + windersCount) {
      const m = k - (treadsIn + windersCount);
      const x = turnZoneEndWalk.x + m * treadGoing;
      outerPts.push({ x, y: Yc + stairWidth });
      innerPts.push({ x, y: Yc });
      outerDirAt.push({ x: 1, y: 0 });
      innerDirAt.push({ x: 1, y: 0 });
    } else {
      const f = (k - treadsIn) / windersCount;
      outerPts.push(pointAtDistance(outerTurnPath, outerTurnCum, f * outerTurnLen));
      innerPts.push(pointAtDistance(innerTurnPath, innerTurnCum, f * innerTurnLen));
      outerDirAt.push(outerDirectionAtDistance(f * outerTurnLen));
      innerDirAt.push(innerDirConst);
    }
  }

  const treads = [];
  for (let i = 0; i < numTreads; i++) {
    const k0 = i;
    const k1 = i + 1;
    const isWinder = k0 >= treadsIn && k0 < treadsIn + windersCount;

    let outerChain, innerChain;
    if (k0 >= treadsIn && k1 <= treadsIn + windersCount) {
      const f0 = (k0 - treadsIn) / windersCount;
      const f1 = (k1 - treadsIn) / windersCount;
      outerChain = subPathPoints(outerTurnPath, outerTurnCum, f0 * outerTurnLen, f1 * outerTurnLen);
      innerChain = subPathPoints(innerTurnPath, innerTurnCum, f0 * innerTurnLen, f1 * innerTurnLen);
    } else {
      outerChain = [outerPts[k0], outerPts[k1]];
      innerChain = [innerPts[k0], innerPts[k1]];
    }

    const inner0 = innerPts[k0];
    const inner1 = innerPts[k1];
    const outer0 = outerPts[k0];
    const outer1 = outerPts[k1];

    const outline = [...innerChain, ...[...outerChain].reverse()];

    const tread = {
      index: startIndex + i,
      type: isWinder ? 'winder' : 'straight',
      outline,
      frontEdge: [inner0, outer0],
      backEdge: [inner1, outer1],
      innerChain,
      outerChain,
    };

    // Dane zabiegowe stopnia (czoło/tył/kierunek/pozycja na walkline/szerokości) — patrz
    // docs/model/STAIRCASE_DATA_MODEL.md §4.3/§4.6 i §4 audytu naprawy zabiegu. Wyłącznie
    // dla stopni zabiegowych — proste i podestowe mają stałe, zgodne kierunki wewn./zewn.,
    // więc to rozróżnienie nic by im nie dodało.
    if (isWinder) {
      const m = i - treadsIn;
      tread.winderInfo = {
        frontEdge: { inner: inner0, outer: outer0, innerDirection: innerDirAt[k0], outerDirection: outerDirAt[k0] },
        backEdge: { inner: inner1, outer: outer1, innerDirection: innerDirAt[k1], outerDirection: outerDirAt[k1] },
        direction: unit(
          innerDirConst.x + outerDirectionAtDistance(((m + 0.5) / windersCount) * outerTurnLen).x,
          innerDirConst.y + outerDirectionAtDistance(((m + 0.5) / windersCount) * outerTurnLen).y
        ),
        stationStart: m * treadGoing,
        stationEnd: (m + 1) * treadGoing,
        widths: {
          atFront: Math.hypot(outer0.x - inner0.x, outer0.y - inner0.y),
          atBack: Math.hypot(outer1.x - inner1.x, outer1.y - inner1.y),
        },
        walklinePosition: { index: m, count: windersCount, fractionStart: m / windersCount, fractionEnd: (m + 1) / windersCount },
      };
    }

    treads.push(tread);
  }

  return {
    outerPath,
    innerPath,
    treads,
    turnInfo: {
      type: 'winder',
      innerCorner: Ic,
      outerCorner: Oc,
      innerTurnSegmentLength: innerTurnLen / windersCount,
      // Policzek zewnętrzny ma tu jedno ostre załamanie (przy Oc) — policzek wewnętrzny
      // "obraca się" stopniowo przez cały zabieg (metoda proporcjonalna), więc nie ma
      // pojedynczego ostrego punktu do domykania przy braku słupa.
      outerBendPoint: Oc,
      innerBendPoint: null,
      method: 'proportional',
    },
    walkline: (() => {
      const points = innerPts.map((inner, k) => walkPointOnEdge(inner, outerPts[k], stairWidth, walklineOffset));
      return { path: points, points };
    })(),
    numTreadsUsed: numTreads,
    exitOuterPoint: outerPath[outerPath.length - 1],
  };
}

// Podest: płaski kwadrat o boku stairWidth wypełniający zakręt zamiast stopni zabiegowych.
// Buduje też, tak jak buildTurnLocal, proste stopnie WEJŚCIOWE (treadsIn) i WYJŚCIOWE
// (treadsOut) w tym samym lokalnym układzie — inaczej ginęłyby (nie są budowane nigdzie indziej).
function buildLandingLocal({ stairWidth, treadGoing, walklineOffset }, treadsIn, treadsOut, startIndex) {
  const Yc = treadsIn * treadGoing;
  const Ic = { x: stairWidth, y: Yc };
  const Oc = { x: 0, y: Yc + stairWidth };
  const IcFront = { x: stairWidth, y: Yc + stairWidth };
  const rearOuterLanding = { x: 0, y: Yc };

  const treads = [];
  let idx = startIndex;

  const pushStraight = (inner0, inner1, outer0, outer1) => {
    treads.push({
      index: idx++,
      type: 'straight',
      outline: [inner0, inner1, outer1, outer0],
      frontEdge: [inner0, outer0],
      backEdge: [inner1, outer1],
      innerChain: [inner0, inner1],
      outerChain: [outer0, outer1],
    });
  };

  for (let k = 0; k < treadsIn; k++) {
    const y0 = k * treadGoing;
    const y1 = (k + 1) * treadGoing;
    pushStraight({ x: stairWidth, y: y0 }, { x: stairWidth, y: y1 }, { x: 0, y: y0 }, { x: 0, y: y1 });
  }

  // Podest ma DWA różne kierunki wejścia/wyjścia (wchodzi się od Yc, wychodzi się przy
  // x=stairWidth) — w przeciwieństwie do zwykłego stopnia to NIE jest ten sam kierunek.
  // backEdge (krawędź wyjściowa) musi więc leżeć na x=stairWidth (tam gdzie zaczyna się
  // pierwszy stopień odcinka wyjściowego), a nie na y=Yc+stairWidth jak wcześniej błędnie
  // przyjęto — to właśnie ta pomyłka obracała ząb wcięcia policzka o 90° i dawała naprzemienne
  // kolizje/szczeliny. outerChain łamie się w Oc (analogicznie do zabiegu, opasuje zewnętrzny
  // narożnik, bo ani ostatni stopień odc. wejściowego ani pierwszy stopień odc. wyjściowego
  // nie sięgają tam same). innerChain jest PUSTY — punkt wejścia-wewnątrz i wyjścia-wewnątrz
  // to ten sam punkt Ic (róg słupa, zerowa długość), a ostatni stopień wejściowy i pierwszy
  // wyjściowy i tak się tam bezpośrednio stykają, więc podest nie musi nic tu dokładać.
  treads.push({
    index: idx++,
    type: 'landing',
    outline: [Ic, IcFront, Oc, rearOuterLanding],
    frontEdge: [Ic, rearOuterLanding],
    backEdge: [Ic, IcFront],
    innerChain: [],
    outerChain: [rearOuterLanding, Oc, IcFront],
  });

  for (let m = 0; m < treadsOut; m++) {
    const x0 = stairWidth + m * treadGoing;
    const x1 = stairWidth + (m + 1) * treadGoing;
    pushStraight({ x: x0, y: Yc }, { x: x1, y: Yc }, { x: x0, y: Yc + stairWidth }, { x: x1, y: Yc + stairWidth });
  }

  const xEnd = stairWidth + treadsOut * treadGoing;
  const outerPath = [{ x: 0, y: 0 }, Oc, { x: xEnd, y: Yc + stairWidth }];
  const innerPath = [{ x: stairWidth, y: 0 }, Ic, { x: xEnd, y: Yc }];

  return {
    outerPath,
    innerPath,
    treads,
    turnInfo: {
      type: 'landing',
      innerCorner: Ic,
      outerCorner: Oc,
      innerTurnSegmentLength: null,
      // Zewnętrzny policzek łamie się ostro w Oc. Wewnętrzny nie ma własnego panelu (patrz
      // wyżej) — ale ostatni stopień wejściowy i pierwszy wyjściowy stykają się bezpośrednio
      // w Ic, więc TO jest właściwy punkt do domknięcia zakładką przy braku słupa.
      outerBendPoint: Oc,
      innerBendPoint: Ic,
    },
    // across the landing the walkline is the same quarter arc round the inner corner as in a winder turn
    walkline: (() => {
      const off = walklineOffset;
      const points = [];
      for (let k = 0; k <= treadsIn; k++) points.push({ x: stairWidth - off, y: k * treadGoing });
      for (let m = 0; m <= treadsOut; m++) points.push({ x: stairWidth + m * treadGoing, y: Yc + off });
      const path = [{ x: stairWidth - off, y: 0 }, ...landingArcPoints(stairWidth, off, Yc), { x: xEnd, y: Yc + off }].filter(
        (p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6
      );
      return { path, points };
    })(),
    numTreadsUsed: treadsIn + 1 + treadsOut,
    exitOuterPoint: outerPath[outerPath.length - 1],
  };
}

function buildTurnOrLanding(turnType, params, treadsIn, windersCount, treadsOut, startIndex, pins) {
  if (turnType === 'landing') return buildLandingLocal(params, treadsIn, treadsOut, startIndex);
  return buildTurnLocal(params, treadsIn, windersCount, treadsOut, startIndex, pins);
}

// numTurns: 1 dla L, 2 dla U. turn1Type/turn2Type: 'winder' | 'landing' niezależnie na każdym zakręcie.
function buildMultiTurnLayout(config, numTurnsOverride) {
  const { stairWidth, treadGoing, treadsLegA, windersPerTurn, treadsLegB, treadsLegC, walklineOffset, walklineSplitOffset, turnDirection, turn1Type, turn2Type, mergeLandings } = config;
  const numTurns = numTurnsOverride || 2;
  const params = { stairWidth, treadGoing, walklineOffset, walklineSplitOffset };
  // (buildTurnLocal lays winders out from the walkline; landings draw it as the same quarter arc)

  // "1 duży podest" zamiast 2 półpodestów: gdy OBA zakręty w U są typu 'landing' i mergeLandings
  // jest włączone, traktujemy je jako jedną, ciągłą platformę na jednej wysokości — patrz
  // mergeLandingPair(). Odcinek B (proste między zakrętami) nie ma tu fizycznego sensu (nie ma
  // czego wstawiać między dwie połówki jednego podestu), więc jest ignorowany. Przy
  // mergeLandings=false zachowanie wraca do 2 osobnych półpodestów na kolejnych wysokościach.
  const isBigLanding = numTurns === 2 && turn1Type === 'landing' && turn2Type === 'landing' && mergeLandings;

  // a flight that starts (ends) with winders starts (ends) at the inner corner — see winderArc.js pins
  const call1 = buildTurnOrLanding(turn1Type, params, treadsLegA, windersPerTurn, isBigLanding ? 0 : treadsLegB, 0, {
    startsFlight: treadsLegA === 0,
    endsFlight: numTurns === 1 && treadsLegB === 0,
  });

  let outerFullPath = [...call1.outerPath];
  let innerFullPath = [...call1.innerPath];
  let treads = [...call1.treads];
  const turns = [call1.turnInfo];
  let walkPath = [...call1.walkline.path];
  let walkPoints = [...call1.walkline.points];

  if (numTurns === 2) {
    const frame2 = makeFrame(call1.exitOuterPoint, IDENTITY_FRAME.right);
    const call2 = buildTurnOrLanding(turn2Type, params, 0, windersPerTurn, treadsLegC, call1.numTreadsUsed, { endsFlight: treadsLegC === 0 });

    outerFullPath = outerFullPath.concat(transformPoints(call2.outerPath, frame2).slice(1));
    innerFullPath = innerFullPath.concat(transformPoints(call2.innerPath, frame2).slice(1));
    let call2Treads = call2.treads.map((t) => transformTread(t, frame2));
    const walk2 = transformWalkline(call2.walkline, frame2);
    walkPath = walkPath.concat(walk2.path.slice(1));
    walkPoints = walkPoints.concat(walk2.points.slice(1));

    if (isBigLanding) {
      const landingA = treads[treads.length - 1];
      const landingB = call2Treads[0];
      treads[treads.length - 1] = mergeLandingPair(landingA, landingB);
      call2Treads = call2Treads.slice(1).map((t) => ({ ...t, index: t.index - 1 }));
      walkPoints.splice(call1.numTreadsUsed, 1); // the boundary between the two halves is gone
    }

    treads = treads.concat(call2Treads);
    turns.push({
      type: call2.turnInfo.type,
      innerCorner: toWorld(call2.turnInfo.innerCorner, frame2),
      outerCorner: toWorld(call2.turnInfo.outerCorner, frame2),
      innerTurnSegmentLength: call2.turnInfo.innerTurnSegmentLength,
      outerBendPoint: call2.turnInfo.outerBendPoint ? toWorld(call2.turnInfo.outerBendPoint, frame2) : null,
      innerBendPoint: call2.turnInfo.innerBendPoint ? toWorld(call2.turnInfo.innerBendPoint, frame2) : null,
      ...(call2.turnInfo.method ? { method: call2.turnInfo.method } : {}),
    });
  }

  if (turnDirection === 'left') {
    outerFullPath = outerFullPath.map(mirrorX);
    innerFullPath = innerFullPath.map(mirrorX);
    treads = treads.map((t) => ({
      ...t,
      outline: t.outline.map(mirrorX),
      frontEdge: t.frontEdge.map(mirrorX),
      backEdge: t.backEdge.map(mirrorX),
      innerChain: t.innerChain.map(mirrorX),
      outerChain: t.outerChain.map(mirrorX),
      ...(t.winderInfo ? { winderInfo: mirrorWinderInfo(t.winderInfo) } : {}),
    }));
    walkPath = walkPath.map(mirrorX);
    walkPoints = walkPoints.map((p) => (p ? mirrorX(p) : null));
    for (const t of turns) {
      t.innerCorner = mirrorX(t.innerCorner);
      t.outerCorner = mirrorX(t.outerCorner);
      if (t.outerBendPoint) t.outerBendPoint = mirrorX(t.outerBendPoint);
      if (t.innerBendPoint) t.innerBendPoint = mirrorX(t.innerBendPoint);
    }
  }

  return {
    outerFullPath,
    innerFullPath,
    treads,
    turns,
    walkline: { path: walkPath, points: walkPoints },
    // Outer AND inner line: a straight stair's outer line alone is one segment with zero width.
    bounds: computeBounds([...outerFullPath, ...innerFullPath]),
  };
}

function computeBounds(path) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}
