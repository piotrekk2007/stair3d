import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { planToWorld } from '../geometry/geometryUtils.js';
import { sameAs } from '../geometry/nosingUtils.js';
import { computeWinderBlank } from '../geometry/winderBlank.js';

function variantStyle(variant) {
  if (variant === 'red' || variant === true) return { color: 0xc01c1c, className: 'dim-label dim-label-red' };
  if (variant === 'purple') return { color: 0x8f3fd1, className: 'dim-label dim-label-purple' };
  return { color: 0x1a5fb4, className: 'dim-label' };
}

function makeLabel(text, worldPos, variant) {
  const div = document.createElement('div');
  div.className = variantStyle(variant).className;
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.position.copy(worldPos);
  return obj;
}

function dimLine(pA, pB, variant) {
  const geo = new THREE.BufferGeometry().setFromPoints([pA, pB]);
  const mat = new THREE.LineBasicMaterial({ color: variantStyle(variant).color });
  return new THREE.Line(geo, mat);
}

// Statyczne adnotacje kluczowych wymiarów w widoku 3D (nie interaktywna miarka —
// prosty, zawsze-widoczny "podpis" najważniejszych liczb na modelu).
export function buildDimensionLabels(planLayout, config, derived) {
  const group = new THREE.Group();
  group.name = 'DimensionLabels';

  const b = planLayout.bounds;
  const footprintX = b.maxX - b.minX;
  const footprintY = b.maxY - b.minY;

  // Wysokość całkowita — przy pierwszym słupie (start), od podłogi do stropu.
  const startPost = planLayout.innerFullPath[0];
  const heightBottom = planToWorld(startPost.x, startPost.y, 0);
  const heightTop = planToWorld(startPost.x, startPost.y, config.totalRise);
  group.add(dimLine(heightBottom, heightTop));
  group.add(makeLabel(`H = ${config.totalRise} mm`, planToWorld(startPost.x, startPost.y, config.totalRise / 2)));

  // Głębokość stopnia i wysokość podstopnia — przy pierwszym stopniu.
  const firstTread = planLayout.treads[0];
  if (firstTread) {
    const rearMid = {
      x: (firstTread.rearRiser[0].x + firstTread.rearRiser[1].x) / 2,
      y: (firstTread.rearRiser[0].y + firstTread.rearRiser[1].y) / 2,
    };
    const frontMid = {
      x: (firstTread.frontRiser[0].x + firstTread.frontRiser[1].x) / 2,
      y: (firstTread.frontRiser[0].y + firstTread.frontRiser[1].y) / 2,
    };
    const goingLabelPos = planToWorld((rearMid.x + frontMid.x) / 2, (rearMid.y + frontMid.y) / 2, derived.riserHeight + 60);
    group.add(makeLabel(`e = ${config.treadGoing} mm`, goingLabelPos));
    group.add(makeLabel(`h = ${derived.riserHeight.toFixed(0)} mm`, planToWorld(rearMid.x, rearMid.y, derived.riserHeight / 2)));
  }

  // Szerokość biegu — na pierwszym stopniu, w poprzek.
  if (firstTread) {
    const widthLabelPos = planToWorld(firstTread.outerChain[0].x + (firstTread.innerChain[0].x - firstTread.outerChain[0].x) / 2, firstTread.outerChain[0].y - 200, derived.riserHeight + 60);
    group.add(makeLabel(`szer. = ${config.stairWidth} mm`, widthLabelPos));
  }

  // Rzut całości — na podłodze, w rogu.
  const cornerLabelPos = planToWorld(b.minX, b.minY - 200, 0);
  group.add(makeLabel(`rzut: ${footprintY.toFixed(0)} × ${footprintX.toFixed(0)} mm`, cornerLabelPos));

  return group;
}

// Grupuje stopnie w maksymalne ciągłe odcinki JEDNEGO typu — proste ('straight') i zabiegowe
// ('winder') osobno, każda zmiana typu (albo podest) zaczyna nowy odcinek. Odpowiada to
// "Prosta (odc. A/B/C)" / "Zabiegowy 1/2" z configu. Podesty są pomijane (nie mają wangi
// liczonej po przekątnej — to płaska płyta, nie deska).
function getMeasurableSegments(treads) {
  const segments = [];
  let current = null;
  let currentType = null;
  for (const t of treads) {
    const measurable = t.type === 'straight' || t.type === 'winder';
    if (measurable && t.type === currentType) {
      current.push(t);
    } else if (measurable) {
      current = [t];
      currentType = t.type;
      segments.push(current);
    } else {
      current = null;
      currentType = null;
    }
  }
  return segments;
}

// Grupuje stopnie w ciągłe "biegi" nieprzerwane podestem — w obrębie jednego biegu proste
// i zabiegi fizycznie zlewają się w jedną, długą wangę (tak się je w praktyce łączy), więc
// wymiar całkowity liczymy od pierwszego do ostatniego stopnia całego biegu, bez względu na
// to ile odcinków prostych/zabiegowych po drodze. Podest PRZERYWA bieg (nowe, osobne posadowienie).
function getContinuousRuns(treads) {
  const runs = [];
  let current = null;
  for (const t of treads) {
    if (t.type === 'landing') {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push(t);
  }
  return runs;
}

// Który kolejny numer zakrętu (indeks w planLayout.turns) odpowiada każdemu stopniowi typu
// 'winder'/'landing' — potrzebne, żeby dla danej strefy zabiegowej znaleźć jej punkt narożny
// (Oc dla zewn., Ic dla wewn.) w planLayout.turns.
function getTurnIndexByTreadIndex(treads) {
  const map = new Map();
  let turnCounter = -1;
  let inTurn = false;
  for (const t of treads) {
    const isTurn = t.type === 'winder' || t.type === 'landing';
    if (isTurn && !inTurn) {
      turnCounter++;
      inTurn = true;
    } else if (!isTurn) {
      inTurn = false;
    }
    if (isTurn) map.set(t.index, turnCounter);
  }
  return map;
}

// Znajduje punkt `target` (Oc/Ic) w łańcuchach stopni `treads` po stronie `side` — może trafić
// na granicę dwóch stopni (chain[0] kolejnego = chain[last] poprzedniego) ALBO leżeć WEWNĄTRZ
// łańcucha JEDNEGO stopnia (bo subPathPoints wstawia wierzchołek zakrętu, gdy ten wypada w
// środku zakresu danego stopnia — patrz pathUtils.subPathPoints). W obu przypadkach zwraca
// parę punktów końca poprzedniej i początku następnej płaszczyzny, każdy sparowany z właściwą
// wysokością (Z) — dla wewnętrznego trafienia to ten sam stopień z obu stron (jego panel ma
// jedną wysokość na całej szerokości, tylko w planie skręca w Oc/Ic w połowie).
function locateCutPoint(treads, side, target, zBottomFn, zGoingFn) {
  for (let i = 0; i < treads.length; i++) {
    const tread = treads[i];
    const chain = side === 'outer' ? tread.outerChain : tread.innerChain;
    for (let j = 0; j < chain.length; j++) {
      if (!sameAs(chain[j], target)) continue;
      if (j === chain.length - 1 && chain.length > 1) continue; // to samo co chain[0] następnego stopnia
      if (j === 0) {
        // Trafienie dokładnie na PIERWSZY punkt przekazanego zakresu — granica leży POZA nim
        // (z sąsiednim stopniem, którego tu nie ma), więc w obrębie TEGO zakresu to nie jest
        // wewnętrzny podział — traktujemy jak brak trafienia (cały zakres zostaje jedną płaszczyzną).
        if (i === 0) return null;
        return {
          end: { point: target, z: zGoingFn(treads[i - 1]) },
          start: { point: target, z: zBottomFn(tread) },
        };
      }
      return {
        end: { point: target, z: zGoingFn(tread) },
        start: { point: target, z: zBottomFn(tread) },
      };
    }
  }
  return null;
}

// Dzieli zakres stopni `treads` na płaszczyzny wangi, tnąc dokładnie w podanych punktach
// narożnych `cutPoints` (0, 1 lub więcej — np. Oc/Ic każdego zakrętu wewnątrz zakresu).
// Bez punktów cięcia zwraca cały zakres jako jedną płaszczyznę (od dołu-tyłu pierwszego
// stopnia do góry-przodu ostatniego).
function buildPieces(treads, side, cutPoints, zBottomFn, zGoingFn) {
  const first = treads[0];
  const last = treads[treads.length - 1];
  const firstChain = side === 'outer' ? first.outerChain : first.innerChain;
  const lastChain = side === 'outer' ? last.outerChain : last.innerChain;
  if (!firstChain || !lastChain || firstChain.length < 2 || lastChain.length < 2) return [];

  const points = [{ point: firstChain[0], z: zBottomFn(first) }];
  for (const target of cutPoints) {
    const located = locateCutPoint(treads, side, target, zBottomFn, zGoingFn);
    if (located) points.push(located.end, located.start);
  }
  points.push({ point: lastChain[lastChain.length - 1], z: zGoingFn(last) });

  const pieces = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pieces.push({
      worldBottom: planToWorld(points[i].point.x, points[i].point.y, points[i].z),
      worldTop: planToWorld(points[i + 1].point.x, points[i + 1].point.y, points[i + 1].z),
    });
  }
  return pieces;
}

function addPieceLabel(group, piece, text) {
  group.add(dimLine(piece.worldBottom, piece.worldTop, true));
  const mid = piece.worldBottom.clone().lerp(piece.worldTop, 0.5);
  group.add(makeLabel(text, mid, true));
  return piece.worldBottom.distanceTo(piece.worldTop);
}

// Długości wang: na niebiesko osobno dla każdego odcinka prostego i każdej PŁASZCZYZNY
// wewnątrz odcinka zabiegowego (zabieg sam bywa złamany w Oc/Ic — patrz buildPieces — więc
// jeśli w środku zabiegu jest załamanie, dostaje 2 numerowane etykiety zamiast jednej ukośnej).
// Na czerwono to samo, ale połączone przez CAŁY bieg (proste + zabiegi w jedną deskę) —
// podzielone dokładnie w tych samych punktach Oc/Ic, więc każda czerwona płaszczyzna też
// leży płasko, nigdy nie idzie na skos przez załamanie.
export function buildStringerLengthLabels(planLayout, config, derived) {
  const group = new THREE.Group();
  group.name = 'StringerLengthLabels';

  const { treadThickness, stringerHeight } = config;
  const { riserHeight } = derived;

  const zGoing = (tread) => (tread.index + 1) * riserHeight - treadThickness;
  const zBottom = (tread) => zGoing(tread) - stringerHeight;

  const turnIndexByTreadIndex = getTurnIndexByTreadIndex(planLayout.treads);
  const cornerFor = (side, tread) => {
    const turn = planLayout.turns[turnIndexByTreadIndex.get(tread.index)];
    if (!turn) return null;
    return side === 'outer' ? turn.outerCorner : turn.innerCorner;
  };

  const segments = getMeasurableSegments(planLayout.treads);
  let straightIdx = 0;
  let winderIdx = 0;

  segments.forEach((segment) => {
    const first = segment[0];
    let baseLabel;
    if (first.type === 'straight') {
      baseLabel = `odc. ${String.fromCharCode(65 + straightIdx)}`;
      straightIdx++;
    } else {
      winderIdx++;
      baseLabel = `zabieg ${winderIdx}`;
    }

    for (const side of ['outer', 'inner']) {
      const corner = first.type === 'winder' ? cornerFor(side, first) : null;
      const pieces = buildPieces(segment, side, corner ? [corner] : [], zBottom, zGoing);
      const sideLabel = side === 'outer' ? 'zewn.' : 'wewn.';

      pieces.forEach((piece, i) => {
        const suffix = pieces.length > 1 ? ` cz.${i + 1}` : '';
        const length = piece.worldBottom.distanceTo(piece.worldTop);
        group.add(dimLine(piece.worldBottom, piece.worldTop));
        const mid = piece.worldBottom.clone().lerp(piece.worldTop, 0.5);
        group.add(makeLabel(`Wanga ${sideLabel} (${baseLabel}${suffix}): ${length.toFixed(0)} mm`, mid));
      });
    }
  });

  const runs = getContinuousRuns(planLayout.treads);

  runs.forEach((run) => {
    for (const side of ['outer', 'inner']) {
      const winderTreads = run.filter((t) => t.type === 'winder');
      const corners = [];
      const seen = new Set();
      for (const t of winderTreads) {
        const turnIdx = turnIndexByTreadIndex.get(t.index);
        if (seen.has(turnIdx)) continue;
        seen.add(turnIdx);
        const corner = cornerFor(side, t);
        if (corner) corners.push(corner);
      }

      const pieces = buildPieces(run, side, corners, zBottom, zGoing);
      const sideLabel = side === 'outer' ? 'zewnętrzna' : 'wewnętrzna';
      pieces.forEach((piece, i) => {
        const numLabel = pieces.length > 1 ? ` ${i + 1}` : '';
        addPieceLabel(group, piece, `WANGA ${sideLabel.toUpperCase()}${numLabel}: ${piece.worldBottom.distanceTo(piece.worldTop).toFixed(0)} mm`);
      });
    }
  });

  return group;
}

// Formatki produkcyjne dla wszystkich stopni zabiegowych — rysowane jako fioletowy prostokąt
// tuż nad powierzchnią danego stopnia, z etykietą "długość × głębokość".
export function buildWinderBlankLabels(planLayout, config, derived) {
  const group = new THREE.Group();
  group.name = 'WinderBlankLabels';

  const { treadThickness } = config;
  const zGoing = (tread) => (tread.index + 1) * derived.riserHeight - treadThickness;

  for (const tread of planLayout.treads) {
    if (tread.type !== 'winder') continue;

    const blank = computeWinderBlank(tread);
    const elevation = zGoing(tread) + 15;

    const worldCorners = blank.corners.map((c) => planToWorld(c.x, c.y, elevation));
    for (let i = 0; i < 4; i++) {
      group.add(dimLine(worldCorners[i], worldCorners[(i + 1) % 4], 'purple'));
    }

    const cx = (blank.corners[0].x + blank.corners[2].x) / 2;
    const cy = (blank.corners[0].y + blank.corners[2].y) / 2;
    group.add(makeLabel(
      `Formatka (stopień ${tread.index + 1}): dł. ${blank.length.toFixed(0)} × gł. ${blank.depth.toFixed(0)} mm`,
      planToWorld(cx, cy, elevation),
      'purple'
    ));
  }

  return group;
}
