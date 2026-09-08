export function createDefaultConfig() {
  return {
    stairType: 'L', // 'straight' | 'L' | 'U'
    turnDirection: 'right', // 'right' | 'left' — kierunek skrętu patrząc od dołu w gorę

    totalRise: 2800, // mm, wysokość kondygnacji (podłoga-podłoga)
    stairWidth: 900, // mm, szerokość biegu (od policzka do policzka)

    treadGoing: 270, // mm, głębokość stopnia (na linii biegu) — stała dla odcinków prostych i celu w zabiegu
    treadsLegA: 5, // liczba stopni prostych przed zabiegiem (lub wszystkich, gdy stairType==='straight')
    windersPerTurn: 5, // liczba stopni zabiegowych w skręcie 90° (gdy dany zakręt jest typu 'winder')
    treadsLegB: 5, // liczba stopni prostych po zabiegu (dla U: odcinek środkowy między zakrętami)
    treadsLegC: 5, // liczba stopni prostych na trzecim odcinku (tylko dla stairType==='U')

    turn1Type: 'winder', // 'winder' | 'landing' — typ pierwszego zakrętu (L i U). Podest = kwadrat o boku stairWidth.
    turn2Type: 'winder', // 'winder' | 'landing' — typ drugiego zakrętu (tylko U); podest tutaj = półpodest
    // Dotyczy tylko U z OBOMA zakrętami typu 'landing': true = 1 duży podest na jednej wysokości
    // (dwie sąsiadujące połówki scalone w jedną płytę); false = powrót do 2 osobnych półpodestów
    // na kolejnych wysokościach (dawne, wcześniejsze zachowanie).
    mergeLandings: true,

    walklineOffset: 400, // mm, odsunięcie linii biegu od policzka wewnętrznego (duszy) — zgodnie z wymogiem 40-50cm
    // mm, gdzie na DŁUGOŚCI zabiegu (wzdłuż kierunku biegu) leży punkt załamania linii biegu —
    // czyli ile z całkowitej długości zabiegu (windersPerTurn * treadGoing) przypada PRZED
    // załamaniem. Niezależne od walklineOffset (ten steruje tylko odsunięciem w poprzek, od
    // duszy) — pozwala na niesymetryczny zabieg (więcej stopni przed narożnikiem niż po nim).
    walklineSplitOffset: 400,
    minInnerWidth: 110, // mm, minimalna dopuszczalna szerokość stopnia przy duszy

    // Ręczne przesunięcia krawędzi między stopniami, ustawiane przeciąganiem na planie 2D —
    // patrz src/geometry/edgeOverrides.js. Klucz to "indeks granicy" (0..numTreads: 0 = pierwsza
    // krawędź, przed stopniem 0; N = ostatnia, za stopniem N-1). Wartość: { point: {x,y},
    // movedEndpoint: 'inner'|'outer' } — zapamiętujemy TYLKO przesunięty koniec, drugi (zawias)
    // zawsze bierzemy z aktualnej geometrii wzorcowej, więc przetrwa zmianę innych parametrów.
    manualEdgeOverrides: {},

    treadThickness: 40, // mm
    nosing: 25, // mm, wysunięcie noska stopnia

    stringerHeight: 300, // mm, wysokość policzka (poniżej linii schodkowej)
    stringerThickness: 40, // mm

    hasRiserBoards: false, // czy dodawać podstopnie (zamknięty stopień) zamiast otwartego stopnia
    riserBoardThickness: 20, // mm, grubość podstopnia

    postSize: 110, // mm, przekrój słupa narożnego (kwadrat)
    hasCornerPost: true, // czy stawiać słup konstrukcyjny na zakrętach; gdy false, wangi łączą się bezpośrednio (zakładka na styk)

    minRiser: 150, // mm, dolna granica sensownej wysokości podstopnia
    maxRiser: 200, // mm, górna granica sensownej wysokości podstopnia

    minHeadroom: 2000, // mm, minimalna skrajnia (wolna wysokość) nad noskiem stopnia
    ceilingThickness: 250, // mm, grubość stropu
    // Otwór w stropie zadawany ręcznie (prostokąt), pozycjonowany względem lewego-dolnego
    // rogu rzutu schodów (bounds.minX/minY z planLayout) + offset:
    openingLength: 2400, // mm, wymiar otworu wzdłuż kierunku biegu (Y)
    openingWidth: 1000, // mm, wymiar otworu w poprzek biegu (X)
    openingOffsetX: 0, // mm
    openingOffsetY: 0, // mm
  };
}

function checkTurnFeasibility(turnType, windersPerTurn, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth) {
  if (turnType === 'landing') {
    // Podest to płaski kwadrat — brak zwężenia przy duszy, warunek zabiegu nie dotyczy.
    return { type: 'landing', feasible: true, message: '', minInnerSegment: null, minInnerWidthOk: true };
  }
  const totalTurnPathLength = windersPerTurn * treadGoing;
  // Policzek wewnętrzny "traci" walklineOffset przed narożnikiem i walklineSplitOffset po nim
  // (patrz planLayout.js/buildTurnLocal: innerTurnLen = distanceFromCorner_B - walklineOffset,
  // gdzie distanceFromCorner_B = totalTurnPathLength - walklineSplitOffset) — przy równych
  // wartościach obu przesunięć sprowadza się to do dawnego wzoru (totalTurnPathLength - 2×offset).
  const innerTurnPathLength = totalTurnPathLength - walklineOffset - walklineSplitOffset;
  if (innerTurnPathLength <= 0) {
    return {
      type: 'winder',
      feasible: false,
      message: `Skręt niewykonalny geometrycznie: ${windersPerTurn} stopni × ${treadGoing}mm musi przekraczać sumę odsunięcia linii biegu i przesunięcia punktu podziału (${walklineOffset + walklineSplitOffset}mm). Zwiększ liczbę stopni zabiegowych, głębokość stopnia, lub zmniejsz te odsunięcia.`,
      minInnerSegment: null,
      minInnerWidthOk: false,
    };
  }
  const minInnerSegment = innerTurnPathLength / windersPerTurn;
  return { type: 'winder', feasible: true, message: '', minInnerSegment, minInnerWidthOk: minInnerSegment >= minInnerWidth };
}

export function deriveStairData(config) {
  const { stairType, totalRise, treadGoing, treadsLegA, windersPerTurn, treadsLegB, treadsLegC, walklineOffset, walklineSplitOffset, minInnerWidth, minRiser, maxRiser, turn1Type, turn2Type, stairWidth, mergeLandings } = config;

  const numTurns = stairType === 'U' ? 2 : stairType === 'L' ? 1 : 0;

  // "1 duży podest": oba zakręty typu 'landing' w U (i włączone mergeLandings) scalają się w
  // JEDNĄ platformę (patrz planLayout.js/mergeLandingPair) — 1 stopień zamiast 2, a odcinek B
  // jest ignorowany. Przy mergeLandings=false wracamy do 2 osobnych półpodestów na kolejnych
  // wysokościach. numTreads musi się z tym dokładnie zgadzać, inaczej wysokość podstopnia
  // (totalRise/numRisers) zostałaby policzona dla złej liczby stopni i ostatni stopień nie
  // trafiłby w wysokość kondygnacji.
  const isBigLanding = numTurns === 2 && turn1Type === 'landing' && turn2Type === 'landing' && mergeLandings;

  const turn1Contribution = numTurns >= 1 ? (turn1Type === 'landing' ? 1 : windersPerTurn) : 0;
  const turn2Contribution = numTurns >= 2 ? (turn2Type === 'landing' ? 1 : windersPerTurn) : 0;

  const numTreads =
    stairType === 'straight'
      ? treadsLegA
      : stairType === 'U'
      ? isBigLanding
        ? treadsLegA + 1 + treadsLegC
        : treadsLegA + turn1Contribution + treadsLegB + turn2Contribution + treadsLegC
      : treadsLegA + turn1Contribution + treadsLegB;
  const numRisers = numTreads + 1;
  const riserHeight = totalRise / numRisers;

  const blondel = 2 * riserHeight + treadGoing;
  const blondelOk = blondel >= 600 && blondel <= 650;

  const riserRangeOk = riserHeight >= minRiser && riserHeight <= maxRiser;

  const turnChecks = [];
  if (numTurns >= 1) turnChecks.push(checkTurnFeasibility(turn1Type, windersPerTurn, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth));
  if (numTurns >= 2) turnChecks.push(checkTurnFeasibility(turn2Type, windersPerTurn, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth));

  const turnFeasible = turnChecks.every((t) => t.feasible);
  const turnFeasibleMessage = turnChecks
    .map((t, i) => (t.feasible ? null : `Zakręt ${i + 1}: ${t.message}`))
    .filter(Boolean)
    .join(' ');
  const minInnerWidthOk = turnChecks.every((t) => t.minInnerWidthOk);
  // Zachowane dla wstecznej zgodności z UI pokazującym pojedynczą wartość — pierwszy zakręt typu winder.
  const firstWinderCheck = turnChecks.find((t) => t.type === 'winder');
  const minInnerSegment = firstWinderCheck ? firstWinderCheck.minInnerSegment : null;

  return {
    numTreads,
    numRisers,
    riserHeight,
    blondel,
    blondelOk,
    riserRangeOk,
    turnFeasible,
    turnFeasibleMessage,
    minInnerSegment,
    minInnerWidthOk,
    turnChecks,
    landingSize: stairWidth,
  };
}

// Sprawdza, czy ręcznie zadany otwór w stropie (prostokąt) zapewnia min. skrajnię (minHeadroom)
// nad każdym stopniem. Strop jest cienką płytą TYLKO na poziomie górnej kondygnacji — stopnie
// nisko nad podłogą nie mają z nim żadnej kolizji niezależnie od pozycji otworu; sprawdzane są
// tylko te, których szczyt wchodzi w strefę min. skrajni pod spodem stropu.
export function deriveCeilingFit(config, planLayout, riserHeight) {
  const { totalRise, ceilingThickness, minHeadroom, openingWidth, openingLength, openingOffsetX, openingOffsetY } = config;
  const bounds = planLayout.bounds;
  const openMinX = bounds.minX + openingOffsetX;
  const openMaxX = openMinX + openingWidth;
  const openMinY = bounds.minY + openingOffsetY;
  const openMaxY = openMinY + openingLength;

  const soffitZ = totalRise - ceilingThickness;
  const dangerThresholdZ = soffitZ - minHeadroom;

  const violatingTreads = [];
  for (const tread of planLayout.treads) {
    const topZ = (tread.index + 1) * riserHeight;
    if (topZ <= dangerThresholdZ) continue;
    const outside = tread.outline.some((p) => p.x < openMinX || p.x > openMaxX || p.y < openMinY || p.y > openMaxY);
    if (outside) violatingTreads.push(tread.index);
  }

  return {
    openMinX,
    openMaxX,
    openMinY,
    openMaxY,
    soffitZ,
    fits: violatingTreads.length === 0,
    violatingTreads,
  };
}
