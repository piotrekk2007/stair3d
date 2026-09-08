import { cumulativeDistances, pointAtDistance, subPathPoints } from './pathUtils.js';
import { applyManualEdgeOverrides } from './edgeOverrides.js';

// Buduje płaski (2D, mm) układ schodów: granicę zewnętrzną, wewnętrzną i zarysy stopni.
// Metoda zabiegu: PROPORCJONALNA (linia podziału) — punkty podziału na linii biegu są
// rozmieszczone równomiernie (stała głębokość), a odpowiadające im punkty na policzku
// zewn./wewn. wyznaczane są przez zachowanie tej samej proporcji odległości wzdłuż
// granicy zewnętrznej / wewnętrznej w strefie zabiegu.
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

  // Ręczne przesunięcia krawędzi (przeciąganie na planie 2D) — jedno miejsce, więc każdy
  // konsument planLayout (widok 3D, plan 2D, wymiary, formatki zabiegowe) dostaje już
  // poprawioną geometrię bez własnej wiedzy o istnieniu edycji. Patrz edgeOverrides.js.
  if (config.manualEdgeOverrides && Object.keys(config.manualEdgeOverrides).length > 0) {
    layout.treads = applyManualEdgeOverrides(layout.treads, config.manualEdgeOverrides);
  }

  return layout;
}

function mirrorX(pt) {
  return { x: -pt.x, y: pt.y };
}

const PT_EPS = 1e-6;
function sameAsPt(p, q) {
  return Math.abs(p.x - q.x) < PT_EPS && Math.abs(p.y - q.y) < PT_EPS;
}

// Usuwa punkty pośrednie leżące na prostej między sąsiadami (np. sztuczny szew po scaleniu
// dwóch łańcuchów) — zostają tylko prawdziwe narożniki (rzeczywiste załamania kierunku).
function removeCollinearPoints(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = result[result.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > PT_EPS) result.push(b);
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
    if (!sameAsPt(merged[merged.length - 1], p)) merged.push(p);
  }
  const outerChain = removeCollinearPoints(merged);

  return {
    index: landingA.index,
    type: 'landing',
    outline: [...outerChain].reverse(),
    rearRiser: landingA.rearRiser,
    frontRiser: landingB.frontRiser,
    innerChain: [],
    outerChain,
  };
}

function rotate90CW(v) {
  // lokalny kierunek "w prawo" względem v (skręt w prawo o -90°)
  return { x: v.y, y: -v.x };
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

function transformTread(tread, frame) {
  if (frame === IDENTITY_FRAME) return tread;
  return {
    ...tread,
    outline: transformPoints(tread.outline, frame),
    rearRiser: transformPoints(tread.rearRiser, frame),
    frontRiser: transformPoints(tread.frontRiser, frame),
    innerChain: transformPoints(tread.innerChain, frame),
    outerChain: transformPoints(tread.outerChain, frame),
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
      rearRiser: [inner0, outer0],
      frontRiser: [inner1, outer1],
      innerChain: [inner0, inner1],
      outerChain: [outer0, outer1],
    });
  }

  return {
    outerFullPath,
    innerFullPath,
    treads,
    turns: [],
    bounds: computeBounds(outerFullPath),
  };
}

// Buduje pojedynczy odcinek prosty->zabieg->prosty w lokalnym układzie (local +Y = kierunek
// wejścia, local +X = kierunek wyjścia po skręcie w prawo o 90°, local x=0 = policzek
// zewnętrzny, local x=stairWidth = policzek wewnętrzny/dusza).
function buildTurnLocal({ stairWidth, treadGoing, walklineOffset, walklineSplitOffset }, treadsIn, windersCount, treadsOut, startIndex) {
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

  const outerPts = [];
  const innerPts = [];
  for (let k = 0; k <= numTreads; k++) {
    if (k <= treadsIn) {
      const y = k * treadGoing;
      outerPts.push({ x: 0, y });
      innerPts.push({ x: stairWidth, y });
    } else if (k >= treadsIn + windersCount) {
      const m = k - (treadsIn + windersCount);
      const x = turnZoneEndWalk.x + m * treadGoing;
      outerPts.push({ x, y: Yc + stairWidth });
      innerPts.push({ x, y: Yc });
    } else {
      const f = (k - treadsIn) / windersCount;
      outerPts.push(pointAtDistance(outerTurnPath, outerTurnCum, f * outerTurnLen));
      innerPts.push(pointAtDistance(innerTurnPath, innerTurnCum, f * innerTurnLen));
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

    treads.push({
      index: startIndex + i,
      type: isWinder ? 'winder' : 'straight',
      outline,
      rearRiser: [inner0, outer0],
      frontRiser: [inner1, outer1],
      innerChain,
      outerChain,
    });
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
    },
    numTreadsUsed: numTreads,
    exitOuterPoint: outerPath[outerPath.length - 1],
  };
}

// Podest: płaski kwadrat o boku stairWidth wypełniający zakręt zamiast stopni zabiegowych.
// Buduje też, tak jak buildTurnLocal, proste stopnie WEJŚCIOWE (treadsIn) i WYJŚCIOWE
// (treadsOut) w tym samym lokalnym układzie — inaczej ginęłyby (nie są budowane nigdzie indziej).
function buildLandingLocal({ stairWidth, treadGoing }, treadsIn, treadsOut, startIndex) {
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
      rearRiser: [inner0, outer0],
      frontRiser: [inner1, outer1],
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
  // frontRiser (krawędź wyjściowa) musi więc leżeć na x=stairWidth (tam gdzie zaczyna się
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
    rearRiser: [Ic, rearOuterLanding],
    frontRiser: [Ic, IcFront],
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
    numTreadsUsed: treadsIn + 1 + treadsOut,
    exitOuterPoint: outerPath[outerPath.length - 1],
  };
}

function buildTurnOrLanding(turnType, params, treadsIn, windersCount, treadsOut, startIndex) {
  if (turnType === 'landing') return buildLandingLocal(params, treadsIn, treadsOut, startIndex);
  return buildTurnLocal(params, treadsIn, windersCount, treadsOut, startIndex);
}

// numTurns: 1 dla L, 2 dla U. turn1Type/turn2Type: 'winder' | 'landing' niezależnie na każdym zakręcie.
function buildMultiTurnLayout(config, numTurnsOverride) {
  const { stairWidth, treadGoing, treadsLegA, windersPerTurn, treadsLegB, treadsLegC, walklineOffset, walklineSplitOffset, turnDirection, turn1Type, turn2Type, mergeLandings } = config;
  const numTurns = numTurnsOverride || 2;
  const params = { stairWidth, treadGoing, walklineOffset, walklineSplitOffset };

  // "1 duży podest" zamiast 2 półpodestów: gdy OBA zakręty w U są typu 'landing' i mergeLandings
  // jest włączone, traktujemy je jako jedną, ciągłą platformę na jednej wysokości — patrz
  // mergeLandingPair(). Odcinek B (proste między zakrętami) nie ma tu fizycznego sensu (nie ma
  // czego wstawiać między dwie połówki jednego podestu), więc jest ignorowany. Przy
  // mergeLandings=false zachowanie wraca do 2 osobnych półpodestów na kolejnych wysokościach.
  const isBigLanding = numTurns === 2 && turn1Type === 'landing' && turn2Type === 'landing' && mergeLandings;

  const call1 = buildTurnOrLanding(turn1Type, params, treadsLegA, windersPerTurn, isBigLanding ? 0 : treadsLegB, 0);

  let outerFullPath = [...call1.outerPath];
  let innerFullPath = [...call1.innerPath];
  let treads = [...call1.treads];
  const turns = [call1.turnInfo];

  if (numTurns === 2) {
    const frame2 = makeFrame(call1.exitOuterPoint, IDENTITY_FRAME.right);
    const call2 = buildTurnOrLanding(turn2Type, params, 0, windersPerTurn, treadsLegC, call1.numTreadsUsed);

    outerFullPath = outerFullPath.concat(transformPoints(call2.outerPath, frame2).slice(1));
    innerFullPath = innerFullPath.concat(transformPoints(call2.innerPath, frame2).slice(1));
    let call2Treads = call2.treads.map((t) => transformTread(t, frame2));

    if (isBigLanding) {
      const landingA = treads[treads.length - 1];
      const landingB = call2Treads[0];
      treads[treads.length - 1] = mergeLandingPair(landingA, landingB);
      call2Treads = call2Treads.slice(1).map((t) => ({ ...t, index: t.index - 1 }));
    }

    treads = treads.concat(call2Treads);
    turns.push({
      type: call2.turnInfo.type,
      innerCorner: toWorld(call2.turnInfo.innerCorner, frame2),
      outerCorner: toWorld(call2.turnInfo.outerCorner, frame2),
      innerTurnSegmentLength: call2.turnInfo.innerTurnSegmentLength,
      outerBendPoint: call2.turnInfo.outerBendPoint ? toWorld(call2.turnInfo.outerBendPoint, frame2) : null,
      innerBendPoint: call2.turnInfo.innerBendPoint ? toWorld(call2.turnInfo.innerBendPoint, frame2) : null,
    });
  }

  if (turnDirection === 'left') {
    outerFullPath = outerFullPath.map(mirrorX);
    innerFullPath = innerFullPath.map(mirrorX);
    treads = treads.map((t) => ({
      ...t,
      outline: t.outline.map(mirrorX),
      rearRiser: t.rearRiser.map(mirrorX),
      frontRiser: t.frontRiser.map(mirrorX),
      innerChain: t.innerChain.map(mirrorX),
      outerChain: t.outerChain.map(mirrorX),
    }));
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
    bounds: computeBounds(outerFullPath),
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
