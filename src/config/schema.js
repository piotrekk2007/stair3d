// PL-LEGAL-A-01 (src/rules/sets/plWarunkiTechniczne.js): 0,6 m <= 2h + s <= 0,65 m for fixed indoor stairs.
export const BLONDEL_RANGE_MM = Object.freeze({ min: 600, max: 650 });

export function createDefaultConfig() {
  return {
    // Id into src/rules/profiles/definitions.js DESIGN_PROFILES — which bundle of legal /
    // industry-best-practice / company-manufacturing / user-preference rules this project is
    // currently being checked against. Purely informational at the model level: nothing in
    // buildStaircase.js or planLayout.js reads this field, geometry generation does not
    // depend on it. It exists so a project can always answer "which rules is this being
    // validated against right now?" — see src/rules/validator.js and docs/rules/PROFILES.md.
    designProfileId: 'POLAND_RESIDENTIAL_TIMBER_DEFAULT',

    // Nazwy pól configu, które użytkownik świadomie ZABLOKOWAŁ przed przypadkową zmianą w UI
    // (patrz src/ui/ui.js — kontrolka zablokowanego pola jest wyłączona, z ikoną kłódki).
    // To WYŁĄCZNIE blokada interfejsu — nie jest to twarde ograniczenie solvera ani reguła
    // walidacji (te żyją w src/rules/, patrz docs/rules/). Blokada przetrwa zapis/wczytanie
    // projektu, bo jest częścią configu, tak jak manualEdgeOverrides.
    lockedFields: [],

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

    // Dopasowanie do klatki (src/geometry/stairwellFit.js): gdy włączone, głębokość stopnia i liczby stopni
    // prostych (treadsLegA/B/C) są WYLICZANE z długości boków klatki, tak jak wysokość podstopnia z totalRise.
    // Bok = odcinek zewnętrznej linii schodów (lico wangi zewnętrznej, czyli ściana) od czoła pierwszego
    // stopnia (bez noska) do narożnika / do tyłu ostatniego stopnia. 0 = bok bez wymiaru. Bok kluczowy
    // wychodzi dokładnie, pozostałe najbliżej jak się da (głębokość stopnia jest jedna na całe schody).
    stairwellFitEnabled: false,
    stairwellSideAMm: 0, // mm, bok wzdłuż biegu A
    stairwellSideBMm: 0, // mm, bok wzdłuż biegu B (L, U)
    stairwellSideCMm: 0, // mm, bok wzdłuż biegu C (tylko U)
    stairwellKeySide: 'A', // 'A' | 'B' | 'C' — bok, który musi wyjść dokładnie

    // Ręczne przesunięcia krawędzi między stopniami, ustawiane przeciąganiem na planie 2D —
    // patrz src/geometry/edgeOverrides.js. Klucz to "indeks granicy" (0..numTreads: 0 = pierwsza
    // krawędź, przed stopniem 0; N = ostatnia, za stopniem N-1). Wartość: { point: {x,y},
    // movedEndpoint: 'inner'|'outer' } — zapamiętujemy TYLKO przesunięty koniec, drugi (zawias)
    // zawsze bierzemy z aktualnej geometrii wzorcowej, więc przetrwa zmianę innych parametrów.
    manualEdgeOverrides: {},

    // Ręczne "wysunięcie" bocznej krawędzi POJEDYNCZEGO stopnia (np. stopień ma wystawać poza
    // wangę) — CELOWO OSOBNE od manualEdgeOverrides powyżej: tamto porusza punkt WSPÓLNY dla
    // dwóch sąsiednich stopni (zachowując ciągłość biegu), to porusza WYŁĄCZNIE własny front/
    // back-róg JEDNEGO stopnia po stronie 'inner'/'outer', nigdy nie dotykając sąsiada — patrz
    // src/geometry/edgeOverrides.js `applyTreadOverhangs`. Klucz to indeks stopnia. Wartość:
    // { side: 'inner'|'outer', offsetMm: number } — offsetMm > 0 = dalej od duszy (wystaje),
    // < 0 = bliżej duszy (cofnięte). Wanga NIGDY tego nie widzi (buduje się z innerChain/
    // outerChain, tak samo nietkniętych jak przy manualEdgeOverrides) — stopień może więc
    // faktycznie wystawać poza wangę.
    manualTreadOverhangs: {},

    // Ręczne edycje POJEDYNCZYCH słupów: { [postId]: { removed?: true, topDeltaMm?, bottomDeltaMm? } } —
    // wydłużenie (+) / skrócenie (-) od góry i od dołu albo usunięcie słupa. Patrz postSolver.js.
    manualPostOverrides: {},

    treadThickness: 40, // mm
    nosing: 25, // mm, wysunięcie noska stopnia

    // --- PROFIL wangi (widok z boku) — patrz docs/architecture/STRINGER_PROFILE_MODEL.md -------
    // Minimalna GŁĘBOKOŚĆ wangi: minimalna odległość geometryczna między krzywą odniesienia R
    // (linia przez przednie narożniki stopni) a dolnym konturem L, mierzona w profilu — NIE różnica
    // Z i NIE wymiar ramki otaczającej. Lokalnie głębokość może być większa (360/390/450 mm),
    // nigdy mniejsza. To NIE jest grubość deski (patrz stringerThickness niżej).
    minimumStringerDepthMm: 350,
    stringerProfileOffsetMm: 0, // mm, dodatkowe pogłębienie dolnego konturu ponad minimum (>= 0)
    stringerCornerRadiusMm: 0, // mm, promień zaokrąglenia narożników konturu; 0 = ostre (jak dotychczas)
    stringerRadiusScope: 'BOTTOM', // 'BOTTOM' | 'TOP' | 'BOTH' — który kontur zaokrąglać
    stringerTransitionStyle: 'TANGENT_ARC', // 'SHARP' | 'TANGENT_ARC' — 'SHARP' wyłącza zaokrąglenia
    stringerNotchRadiusMm: 0, // mm, promień narzędzia w wewnętrznym narożniku wcięcia (tylko 'cut'); 0 = ostry
    // Ręczne korekty profilu (przesunięte punkty kontrolne, promienie, dodane punkty) — warstwa
    // Nominal -> Override -> Final, klucz = 'outer' | 'inner'. Patrz stringerProfileModel.js.
    manualStringerProfileOverrides: {},
    stringerThickness: 40, // mm — GRUBOŚĆ deski ("thickness" w StringerModel), osobna wielkość od głębokości
    // Typ konstrukcji NIEZALEŻNIE dla każdej wangi — np. zewnętrzna wpuszczana, wewnętrzna nakładana.
    // 'closed' (wpuszczana/wcinana, schowana) | 'cut' (nakładana/wycinana, otwarta) — patrz
    // stringerModel.js CONSTRUCTION_TYPES i stringerConstructionGeometry.js. Formerly one shared
    // `stringerConstructionType` (migracja pliku projektu v3 -> v4, patrz projectIO.js).
    stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed',
    // Poniższe 2 pola sterują KONSTRUKCYJNYM konturem wangi (stringerConstructionGeometry.js) —
    // wartości domyślne to jawnie oznaczone założenia produkcyjne (MANUFACTURING_ASSUMPTION),
    // NIE liczby z normy — patrz docs/architecture/STRINGER_CONSTRUCTION_MODEL.md.
    // mm, jak głęboko stopień wchodzi w wangę WPUSZCZANĄ (głębokość gniazda w licu wewnętrznym) — decyzja użytkownika:
    // ok. 20 mm, zmienialne. Starszy projekt bez tego pola: wzór BWF max(12, 0.4·grubość) (stringerModel.js housingDepthMm).
    stringerHousingDepthMm: 20,
    stringerTopMarginMm: 50, // mm, TYLKO 'closed' — o ile górna krawędź deski wystaje NAD GÓRNĄ PŁASZCZYZNĘ STOPNIA
    // (powierzchnię, po której się chodzi — czyli ponad ewentualny nosek), nie nad jego spodem;
    // patrz stringerProfileSolver.js solveStringerProfile (treadThicknessMm doliczane wewnętrznie).
    stringerMinRemainingSectionMm: 30, // mm, próg diagnostyczny — minimalna dopuszczalna grubość drewna w najcieńszym miejscu (nad wcięciem/pod wręgą)
    // Klasa drewna TYLKO do orientacyjnej kontroli konstrukcji (src/structural/, docs/architecture/STRUCTURAL_CHECKS.md):
    // 'C24' | 'D30' | 'D40' (EN 338). Osobna od timberGrade, którego używa kosztorys/cennik. D30 = dąb (założenie, EN 1912).
    structuralMaterialClass: 'D30',
    // Obciążenia i limity ugięć kontroli konstrukcji — domyślnie wartości BRYTYJSKIE (UK-GUID-I-01, decyzja
    // użytkownika; polska wartość PL-LEGAL-I-01 niezweryfikowana) i łagodny koniec zakresów EC5 Tab. 7.2.
    structuralStairUdlKnM2: 1.5, // kN/m², użytkowe schodów, równomierne
    structuralStairPointKn: 2.0, // kN, użytkowe schodów, skupione (w najniekorzystniejszym miejscu)
    structuralTreadDeflectionRatio: 300, // ugięcie chwilowe stopnia <= L / tyle
    structuralTreadFinalDeflectionRatio: 250, // ugięcie końcowe (z pełzaniem) <= L / tyle
    structuralStringerDeflectionRatio: 300, // wanga: ugięcie chwilowe <= L (pochyła) / tyle
    structuralStringerFinalDeflectionRatio: 250, // wanga: ugięcie końcowe <= L / tyle
    structuralHandrailLineKnM: 0.36, // kN/m, poziome obciążenie poręczy (UK-GUID-I-02, wartość UK)
    structuralHandrailMaxDeflectionMm: 25, // mm, maks. ugięcie poręczy/wychylenie słupka (UK-GUID-I-02)
    timberGrade: 'C24', // klasa wytrzymałości drewna konstrukcyjnego (PN-EN 1912) — patrz docs/rules/TECHNICAL_RULES_CATALOGUE.md, BWF-GUID-E-02/EC5-STRUCT-I-02

    hasRiserBoards: false, // czy dodawać podstopnie (zamknięty stopień) zamiast otwartego stopnia
    riserBoardThickness: 20, // mm, grubość podstopnia
    // O ile górna krawędź podstopnia wchodzi w spód stopnia NAD nim (zakładka, nie styk na styk) —
    // bez tego mogłyby powstać prześwity między podstopniem a stopniem przy pracy drewna. Wymaga
    // odpowiedniego podfrezowania (rowka) w spodzie tego stopnia — patrz treadSolver.js
    // buildNotch()/TreadModel.notch i riserSolver.js (podnosi RiserModel.elevation.top o tyle samo,
    // żeby obie strony złącza się zgadzały). Tylko przy hasRiserBoards=true; 0 = styk na styk.
    riserTopOverlapMm: 10, // mm, zakładka podstopnia w stopień nad nim

    // Balustrada (geometry/railingSolver.js, docs/architecture/RAILING_MODEL.md): poręcz + tralki na odcinkach
    // wybranych przez użytkownika. railingSections = [{ id, side: 'outer'|'inner', fromStep, toStep|null }]
    // (indeksy stopni od 0, toStep null = do ostatniego) — balustrada może zaczynać się od dowolnego stopnia,
    // być tylko na jednym biegu albo tylko po jednej stronie.
    railingEnabled: false,
    railingSections: [],
    railingHeightMm: 900, // mm, GÓRA poręczy nad linią nosków (linia przez czoła stopni)
    railingHandrailShape: 'rect', // 'rect' | 'round'
    railingHandrailWidthMm: 70, // mm, poprzecznie do biegu
    railingHandrailHeightMm: 40, // mm, w pionie
    railingBalusterShape: 'square', // 'square' | 'round'
    railingBalusterSizeMm: 30, // mm, bok kwadratu albo średnica (BWF: min. 27 kwadratowa / 35 toczona)
    railingMaxClearMm: 120, // mm, maksymalny prześwit między tralkami (PL WT § 298: 12 cm wielorodzinne / 20 cm ogólnie)
    railingPostSizeMm: 90, // mm, przekrój (kwadrat) nowych słupków balustrady na końcach odcinków; per słupek edytowalny w Inspektorze
    railingPostTopAboveHandrailMm: 0, // mm, o ile słupek balustrady wystaje ponad górę poręczy
    railingLateralOffsetMm: null, // mm od osi odniesienia wangi w głąb schodów; null = środek grubości wangi
    // Poręcz gięta (etap 4, railingSolver.js smoothRun): załamania pochylenia w biegu zastąpione łukami w pionie,
    // a narożnik w rzucie, przy którym NIE stoi słup, łukiem w rzucie zamiast słupka. Promienie to parametry
    // (wybór programu, do ustalenia z warsztatem — nie wartości z normy).
    railingBent: false,
    railingBendRadiusMm: 300, // mm, promień łuku w pionie (zmiana pochylenia poręczy)
    railingPlanBendRadiusMm: 150, // mm, promień łuku w rzucie (narożnik bez słupa)
    // Podporęcz (etap 4): listwa na górnej krawędzi wangi WPUSZCZANEJ, w którą wchodzą tralki (przy wandze nakładanej
    // tralki stoją na stopniach — tam podporęczy nie ma). Wymiary to parametry (wybór programu, nie norma).
    railingBaseRail: false,
    railingBaseRailWidthMm: 50, // mm, poprzecznie do biegu
    railingBaseRailHeightMm: 30, // mm, w pionie

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
  const blondelOk = blondel >= BLONDEL_RANGE_MM.min && blondel <= BLONDEL_RANGE_MM.max;

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

// Dosunięcie otworu w stropie do narożnika albo boku rzutu schodów (planLayout.bounds — obrys obu linii wang, ten sam
// prostokąt, od którego liczone są offsety otworu). Narożnik: otwór kładzie swój odpowiadający róg na rogu rzutu (oba
// offsety); bok: tylko offset w poprzek tego boku, drugi zostaje. Zwraca nowe offsety (zaokrąglone do 1 mm).
export const OPENING_ALIGN_TARGETS = [
  { id: 'corner-xmin-ymin', label: 'róg X min / Y min', x: 'min', y: 'min' },
  { id: 'corner-xmax-ymin', label: 'róg X max / Y min', x: 'max', y: 'min' },
  { id: 'corner-xmin-ymax', label: 'róg X min / Y max', x: 'min', y: 'max' },
  { id: 'corner-xmax-ymax', label: 'róg X max / Y max', x: 'max', y: 'max' },
  { id: 'side-xmin', label: 'bok X min', x: 'min' },
  { id: 'side-xmax', label: 'bok X max', x: 'max' },
  { id: 'side-ymin', label: 'bok Y min (początek biegu)', y: 'min' },
  { id: 'side-ymax', label: 'bok Y max', y: 'max' },
];

export function alignedOpeningOffsets(config, bounds, targetId) {
  const target = OPENING_ALIGN_TARGETS.find((t) => t.id === targetId);
  const out = { openingOffsetX: config.openingOffsetX, openingOffsetY: config.openingOffsetY };
  if (!target || !bounds) return out;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (target.x) out.openingOffsetX = Math.round(target.x === 'min' ? 0 : spanX - config.openingWidth);
  if (target.y) out.openingOffsetY = Math.round(target.y === 'min' ? 0 : spanY - config.openingLength);
  return out;
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
