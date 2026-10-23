import { resolveOpening, openingFrame, requiredOpeningRelative, polygonContainsPolygon } from '../geometry/ceilingOpening.js';
import { arcWinderGeometry, fittingWalklineOffset, isHalfTurnU, halfTurnWinderCount, halfTurnInnerGap, halfTurnWinderGeometry, fittingHalfTurnOffset } from '../geometry/winderArc.js';

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
    // Starter steps (stopnie zapraszające, geometry/starterSteps.js): { [treadIndex]: { leftMm, rightMm, radiusMm,
    // bowMm, riser } } — set in the Inspektor of a straight tread selected on the plan
    manualStarterTreads: {},
    windersPerTurn: 5, // liczba stopni zabiegowych w skręcie 90° (gdy dany zakręt jest typu 'winder')
    // U bez stopni prostych w biegu B (treadsLegB = 0), oba zakręty zabiegowe: JEDNA klatka zabiegowa 180° wokół
    // jednego słupa środkowego (geometry/winderArc.js halfTurnWinderGeometry; decyzja użytkownika 2026-10-14).
    uSingleWinderZone: false,
    uWindersTotal: 7, // łączna liczba stopni zabiegowych tej jednej klatki
    uAxisGapMm: 0, // mm, rozstaw OSI wewnętrznych wang biegów A i C; 0 = wanga C dokładnie nad wangą A
    treadsLegB: 5, // liczba stopni prostych po zabiegu (dla U: odcinek środkowy między zakrętami)
    treadsLegC: 5, // liczba stopni prostych na trzecim odcinku (tylko dla stairType==='U')

    turn1Type: 'winder', // 'winder' | 'landing' — typ pierwszego zakrętu (L i U). Podest = kwadrat o boku stairWidth.
    turn2Type: 'winder', // 'winder' | 'landing' — typ drugiego zakrętu (tylko U); podest tutaj = półpodest
    // Dotyczy tylko U z OBOMA zakrętami typu 'landing': true = 1 duży podest na jednej wysokości
    // (dwie sąsiadujące połówki scalone w jedną płytę); false = powrót do 2 osobnych półpodestów
    // na kolejnych wysokościach (dawne, wcześniejsze zachowanie).
    mergeLandings: true,

    walklineOffset: 400, // mm, odsunięcie linii biegu od policzka wewnętrznego (duszy) — zgodnie z wymogiem 40-50cm
    // mm: ile z długości zabiegu (windersPerTurn * treadGoing, mierzonej NA LINII BIEGU) przypada przed środkiem
    // łuku linii biegu (punktem na przekątnej narożnika — geometry/winderArc.js). Ograniczane tak, żeby cały łuk
    // mieścił się w zabiegu (od π·walklineOffset/4 do długości zabiegu minus tyle). Niezależne od walklineOffset —
    // pozwala na niesymetryczny zabieg (więcej stopni przed narożnikiem niż po nim); połowa długości zabiegu =
    // zabieg symetryczny.
    walklineSplitOffset: 400,
    minInnerWidth: 110, // mm, minimalna dopuszczalna szerokość stopnia przy duszy

    // Stairwell (geometry/stairwell.js, model v3): the side lengths of the stair's outer line (the outer face of the
    // outer wanga = the wall line) — A along flight A from the first front edge (no nosing) to the corner, B along
    // flight B (U: wall to wall), C along flight C to the last back edge — each FIXED (must come out exactly) or FREE
    // (follows from the tread counts); a side may run along a WALL. With it on, the ceiling opening is given from the
    // walls (x from wall A, y from the end wall). The variant designer (designer/stairwellVariants.js) solves it.
    stairwellRoomEnabled: false, // the stairwell dimensions are on
    stairwellSideAMm: 0, // mm
    stairwellSideBMm: 0, // mm (L, U)
    stairwellSideCMm: 0, // mm (U)
    stairwellSideAFixed: false,
    stairwellSideBFixed: false,
    stairwellSideCFixed: false,
    stairwellWallA: true, // the side runs along a wall
    stairwellWallB: true,
    stairwellWallC: true,
    stairwellWallGapMm: 0, // mm, from the wall to the outer face of the wanga along it
    // An S only: the walls on the 'left' / 'right' side (walking up flight A) — '' = along the outer line (stairwell.js
    // stairwellWallLine)
    stairwellWallHand: '',
    // A new project waits for its parameters (user decision 2026-10-23): the walls and the ceiling opening are shown,
    // the stair itself only after "Generuj schody" — from then on live, as always. Saved with the project.
    stairPending: false,
    // How far each wall reaches (stairwell.js wallInterval): 'full' | 'start' (from the side's start, this long) | 'end'
    // (back from the side's end — side A: from the corner — this long)
    stairwellWallAExtent: 'full',
    stairwellWallBExtent: 'full',
    stairwellWallCExtent: 'full',
    stairwellWallALengthMm: 1200, // mm
    stairwellWallBLengthMm: 1200,
    stairwellWallCLengthMm: 1200,
    // Internal to the per-variant solver (geometry/stairwellFit.js — no longer in the panel): when on, the going and
    // the straight counts are derived from stairwellSide*Mm, the key side exact.
    stairwellFitEnabled: false,
    stairwellKeySide: 'A',
    stairwellManualCounts: false,

    // Ręczne przesunięcia krawędzi między stopniami, ustawiane przeciąganiem na planie 2D —
    // patrz src/geometry/edgeOverrides.js. Klucz to "indeks granicy" (0..numTreads: 0 = pierwsza
    // krawędź, przed stopniem 0; N = ostatnia, za stopniem N-1). Wartość: { inner?: {x,y}, outer?: {x,y} } —
    // przesunięte końce (edytor 2D zapisuje oba naraz, obracając krawędź wokół jej punktu na linii biegu);
    // koniec bez wpisu bierzemy z aktualnej geometrii wzorcowej. Starszy kształt { point, movedEndpoint }
    // (jeden koniec) jest nadal czytany — edgeOverrides.js edgeOverrideEndpoints.
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
    // Konstrukcja schodów (geometry/cantileverModel.js): 'stringers' (na wangach) albo 'cantilever' (wspornikowe —
    // profile stalowe w ścianie po stronie zewnętrznej, okładzina drewniana nasuwana na profile, strona duszy wolna).
    // Decyzje użytkownika 2026-09-29: profil ok. 40 × 60, min. 2 na stopień, góra i front 40 mm, spód/tył/bok 20 mm,
    // skrzynka = profil + 40 + 20 + luz, szer. okładziny maks. ok. 1800 mm. Luz, szczelina przy ścianie i wysięg
    // profila — DO WERYFIKACJI (CO-MFG-J-CANTILEVER).
    stairConstruction: 'stringers',
    cantileverProfileWidthMm: 40,
    cantileverProfileHeightMm: 60,
    cantileverProfileCount: 2,
    cantileverProfileProjectionMm: 700, // mm, ile profil wystaje ze ściany
    cantileverClearanceMm: 2, // mm, luz na nasunięcie okładziny na profil
    cantileverTopThicknessMm: 40,
    cantileverFrontThicknessMm: 40,
    cantileverShellThicknessMm: 20, // spód, tył, bok
    cantileverWallGapMm: 5, // mm, szczelina między okładziną a ścianą
    cantileverMaxWidthMm: 1800,
    // Konstrukcja metalowa (geometry/metalStructureModel.js), decyzje użytkownika 2026-10-10:
    // stairConstruction 'metal-profile' = wanga na profilu (1 belka centralna albo 2 belki pod stopniami, prosta belka
    // + podpora pod każdym stopniem), 'metal-flat' = dwa płaskowniki po bokach wycinane w zęby. Wszystkie przekroje i
    // wymiary poniżej to wartości robocze — DO WERYFIKACJI (CO-MFG-J-METAL); stal nie jest przez program obliczana.
    metalBeamCount: 1, // 1 = belka centralna, 2 = dwie belki
    metalBeamSetbackMm: 150, // mm, oś belki od boku stopnia (tylko przy 2 belkach)
    metalBeamWidthMm: 100,
    metalBeamHeightMm: 200,
    metalBeamWallMm: 5, // mm, ścianka profilu zamkniętego (tylko do masy)
    metalSupportPlateThicknessMm: 8, // mm, blacha pod stopniem
    metalSupportPlateWidthMm: 300, // mm, w poprzek belki
    metalSupportClearanceMm: 0, // mm, min. odstęp belki od blachy podpory
    metalSupportMaxHeightMm: 400, // mm, wyższa podpora -> ostrzeżenie
    metalFlatThicknessMm: 12, // mm, grubość płaskownika
    metalFlatNeckMm: 120, // mm, najwęższe miejsce pasa między zębami góry i dołu
    metalFlatSetbackMm: 30, // mm, płaskownik cofnięty od boku stopnia
    stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed',
    // Poniższe 2 pola sterują KONSTRUKCYJNYM konturem wangi (stringerConstructionGeometry.js) —
    // wartości domyślne to jawnie oznaczone założenia produkcyjne (MANUFACTURING_ASSUMPTION),
    // NIE liczby z normy — patrz docs/architecture/STRINGER_CONSTRUCTION_MODEL.md.
    // mm, jak głęboko stopień wchodzi w wangę WPUSZCZANĄ (głębokość gniazda w licu wewnętrznym) — decyzja użytkownika:
    // ok. 20 mm, zmienialne. Starszy projekt bez tego pola: wzór BWF max(12, 0.4·grubość) (stringerModel.js housingDepthMm).
    stringerHousingDepthMm: 20,
    // mm, jak głęboko wanga wchodzi PEŁNYM PRZEKROJEM we wręg (gniazdo) w licu słupa konstrukcyjnego (decyzja
    // użytkownika 2026-09-28: złącze wanga–słup = wręg pełnym przekrojem). 20 = wartość wyjściowa DO WERYFIKACJI
    // (CO-MFG-J-POST-HOUSING; ta sama co wpust stopnia w wangę) — brak źródła. 0 = wanga dochodzi do lica słupa.
    postHousingDepthMm: 20,
    // mm, jak głęboko STOPIEŃ przechodzący przez słup konstrukcyjny wchodzi w gniazdo w jego licu (etap 2 złączy) — jednym
    // czopem na licu, o które opiera się najbardziej, na pełnej szerokości styku; reszta wycięta równo z licami słupa.
    // Podstopień (nienośny) nie ma gniazda — tylko wycięty równo ze słupem. 20 = wartość wyjściowa DO WERYFIKACJI
    // (CO-MFG-J-POST-TREAD-HOUSING, ta sama co wpust stopnia w wangę). 0 = stopień wycięty równo z licem słupa, bez gniazda.
    postTreadHousingDepthMm: 20,
    // Łączniki złączy wang (etap 4 złączy, decyzja użytkownika 2026-09-28: "jako parametry") — śruba schodowa przez
    // słup (albo na głębokość w słupie) i przez czoło wangi do gniazda nakrętki w jej licu wewnętrznym; tak samo
    // wanga dochodząca doczołowo do drugiej. WSZYSTKIE wartości DO WERYFIKACJI (CO-MFG-J-CONNECTORS), brak źródła.
    jointConnectorCount: 2, // szt. na złącze (0 = bez łączników — tylko klej/wręg)
    jointConnectorSpacingMm: 120, // mm, rozstaw w pionie, symetrycznie względem środka przekroju wangi na licu złącza
    jointConnectorDiameterMm: 10, // mm, średnica śruby = otworu (M10)
    jointConnectorBoardDepthMm: 100, // mm, od lica złącza w głąb wangi do środka gniazda nakrętki
    jointConnectorNutBoreMm: 30, // mm, średnica gniazda nakrętki wierconego w licu wewnętrznym wangi
    jointConnectorPostMode: 'through', // 'through' = przez cały słup (podkładka/zaślepka po drugiej stronie), 'blind' = na głębokość
    jointConnectorPostDepthMm: 60, // mm, tylko 'blind': głębokość otworu w słupie liczona od lica
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
    // Stopień „fajkowy" na stropie: na końcu schodów, na krawędzi stropu, kładzie się cieńszy stopień równający się
    // z podłogą piętra. Przy schodach z podstopniami (hasRiserBoards) OSTATNI podstopień stoi pod nim — od spodu
    // ostatniego stopnia do spodu tego stopnia (+ ta sama zakładka riserTopOverlapMm). Grubość zależy od podłogi —
    // 20 mm to wartość wyjściowa DO WERYFIKACJI (CO-MFG-J-TOP-NOSING), nie norma.
    topNosingThicknessMm: 20, // mm, grubość stopnia fajkowego na stropie

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
    // Ręczna korekta wysokości końca poręczy przy słupie (railingSolver.js railingEndKey/sanitizeRailingEndOffsets):
    // { 'odcinek|słup|start' albo '…|end': mm } — + w górę, − w dół. Edytowane w Inspektorze słupa.
    railingEndOffsets: {},
    // Ręczne punkty na linii poręczy (geometry/railingProfileModel.js, edytor „Profil poręczy”):
    // { [odcinek]: { [bieg 'słupA>słupB']: [{ s: mm wzdłuż biegu od lica słupa, dz: mm w górę (+) / w dół (−) }] } }
    railingProfileOverrides: {},
    // Hand-placed balustrade posts and automatic corner posts switched off (geometry/railingPostEdits.js):
    // { [sectionId]: { added: [{ id, s }], suppressed: [s] } }, s = mm along the section's path in plan
    railingPostEdits: {},
    // Wall handrail past a moved end post (railingPostEdits.js `wallRail`, railingSolver.js buildWallRail): free space
    // between the handrail and the wall, the largest spacing of its wall brackets — ASSUMPTION / DO WERYFIKACJI
    railingWallRailClearanceMm: 50,
    railingWallBracketSpacingMm: 1000,
    // Balustrade round the ceiling opening on the upper floor (railingSolver.js buildOpeningRailing): on the floor,
    // the posts' axis this far back from the edge; the handrail top this high above the floor (§ 298: 1.1 m — DO
    // WERYFIKACJI, a single-family house may differ); which edges: auto (all but the exit edge and the edges along
    // stairwell walls) or railingOpeningEdges[i] = true / false.
    railingOpeningEnabled: false,
    railingOpeningHeightMm: 1100,
    railingOpeningSetbackMm: 60, // mm — ASSUMPTION (a 90 mm post 15 mm off the edge)
    railingOpeningEdges: {},
    // Poręcz gięta (etap 4, railingSolver.js smoothRun): załamania pochylenia w biegu zastąpione łukami w pionie,
    // a narożnik w rzucie, przy którym NIE stoi słup, łukiem w rzucie zamiast słupka. Promienie to parametry
    // (wybór programu, do ustalenia z warsztatem — nie wartości z normy).
    railingBent: false,
    railingBendRadiusMm: 300, // mm, promień łuku w pionie (zmiana pochylenia poręczy)
    railingPlanBendRadiusMm: 150, // mm, promień łuku w rzucie (narożnik bez słupa)
    // Podporęcz (etap 4): listwa na górnej krawędzi wangi WPUSZCZANEJ, w którą wchodzą tralki (przy wandze nakładanej
    // tralki stoją na stopniach — tam podporęczy nie ma). Wymiary to parametry (wybór programu, nie norma).
    railingBaseRail: false,
    // Wypełnienie balustrady (geometry/railingGlass.js, decyzje użytkownika 2026-09-29): 'balusters' (tralki),
    // 'glass-side' (szkło na rotulach do boku wangi, poręcz na szkle), 'glass-posts' (szkło podwieszane między słupkami
    // na uchwytach, poręcz na słupkach). Szkło VSG 4.4.2 lub 5.5.2, tafla maks. 1800 mm (decyzje użytkownika). Pozostałe
    // wymiary — DO WERYFIKACJI (CO-MFG-J-GLASS), brak źródła.
    railingInfill: 'balusters',
    railingGlassType: '4.4.2',
    railingGlassMaxWidthMm: 1800,
    railingGlassTint: 'clear', // kolor szkła: 'clear' | 'optiwhite' | 'grey' (ciemne) | 'bronze' (brązowe) — decyzja użytkownika 2026-09-29
    railingGlassGapMm: 20, // mm, szczelina między sąsiednimi taflami na rotulach
    // Szkło między słupkami (decyzja użytkownika 2026-09-29): ustawia się tylko odstęp tafli od poręczy i od spodu; uchwyty
    // są zawsze przy słupku (odstęp szkła od lica słupka wynika z uchwytu — railingGlass.js GLASS_TO_POST_MM).
    railingGlassTopGapMm: 20, // mm, od spodu poręczy do góry tafli — DO WERYFIKACJI
    railingGlassBottomGapMm: 20, // mm, od góry wangi (albo linii nosków) do dołu tafli — DO WERYFIKACJI
    railingGlassStandoffMm: 30, // mm, odsunięcie szkła od boku wangi (rotula)
    railingGlassOverlapMm: 120, // mm, o ile tafla na rotulach schodzi poniżej górnej krawędzi wangi (pas mocowania)
    railingGlassFixingsPerPane: 2, // rotule na taflę
    railingGlassClampsPerSide: 2, // uchwyty na każdą krawędź tafli przy słupku
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
    // Kształt otworu: 'rect' = prostokąt z suwaków powyżej, 'polygon' = wielokąt narysowany na planie 2D
    // (openingPolygon, punkty w tym samym układzie co offsety — patrz geometry/ceilingOpening.js).
    openingShape: 'rect',
    openingMode: 'given', // 'given' | 'derived' — geometry/ceilingOpening.js OPENING_MODES
    openingPolygon: [],
  };
}

function checkTurnFeasibility(turnType, windersPerTurn, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth, stairWidth) {
  if (turnType === 'landing') {
    // Podest to płaski kwadrat — brak zwężenia przy duszy, warunek zabiegu nie dotyczy.
    return { type: 'landing', feasible: true, message: '', minInnerSegment: null, minInnerWidthOk: true };
  }
  // Winders laid out from the walkline arc (geometry/winderArc.js, the layout planLayout.js uses): every winder has the
  // same width at the dusza. When the arc does not fit at the configured walkline offset, the turn is laid out on a
  // walkline moved toward the dusza (fittingWalklineOffset) — buildable, but not the configured walkline: not feasible.
  const params = { stairWidth, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth };
  const fitted = fittingWalklineOffset(params, windersPerTurn);
  const arc = fitted === null ? null : arcWinderGeometry({ ...params, walklineOffset: fitted }, 0, windersPerTurn);
  if (arc) {
    const minInnerSegment = arc.duszaWidth;
    const reduced = fitted < walklineOffset - 1e-6;
    const message = reduced
      ? `Skręt nie mieści się na linii biegu ${walklineOffset} mm od duszy: ${windersPerTurn} stopni × ${treadGoing} mm to mniej niż ćwiartka łuku (${Math.round((Math.PI * walklineOffset) / 2)} mm). Zabieg rozłożono na linii biegu ${Math.round(fitted)} mm od duszy — zwiększ liczbę stopni zabiegowych lub głębokość stopnia, albo zmniejsz odsunięcie linii biegu.`
      : '';
    return { type: 'winder', method: 'walkline-arc', feasible: !reduced, message, minInnerSegment, minInnerWidthOk: minInnerSegment >= minInnerWidth, walklineOffsetMm: fitted };
  }
  // No layout at all (no winders / no going): the old check applies.
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
  return { type: 'winder', method: 'proportional', feasible: true, message: '', minInnerSegment, minInnerWidthOk: minInnerSegment >= minInnerWidth };
}

// The one 180° zone (winderArc.js): feasible when its half circle fits at the configured walkline offset.
function checkHalfTurnFeasibility(config) {
  const count = halfTurnWinderCount(config);
  const params = { stairWidth: config.stairWidth, treadGoing: config.treadGoing, walklineOffset: config.walklineOffset, minInnerWidth: config.minInnerWidth, innerGap: halfTurnInnerGap(config.uAxisGapMm, config.stringerThickness) };
  const fitted = fittingHalfTurnOffset(params, count);
  const geo = fitted === null ? null : halfTurnWinderGeometry({ ...params, walklineOffset: fitted }, 0, count);
  if (!geo) {
    return { type: 'winder', method: 'walkline-half-arc', feasible: false, message: `Zabieg 180° niewykonalny: ${count} stopni × ${config.treadGoing} mm nie obejdzie duszy — zwiększ liczbę stopni zabiegowych lub głębokość stopnia.`, minInnerSegment: null, minInnerWidthOk: false };
  }
  const reduced = fitted < config.walklineOffset - 1e-6;
  const message = reduced
    ? `Zabieg 180° nie mieści się na linii biegu ${config.walklineOffset} mm od duszy: ${count} stopni × ${config.treadGoing} mm to mniej niż półokrąg (${Math.round(Math.PI * (config.walklineOffset + params.innerGap / 2))} mm). Zabieg rozłożono na linii biegu ${Math.round(fitted)} mm od duszy — zwiększ liczbę stopni zabiegowych lub głębokość stopnia.`
    : '';
  return { type: 'winder', method: 'walkline-half-arc', feasible: !reduced, message, minInnerSegment: geo.duszaWidth, minInnerWidthOk: geo.duszaWidth >= config.minInnerWidth, walklineOffsetMm: fitted };
}

export function deriveStairData(config) {
  const { stairType, totalRise, treadGoing, treadsLegA, windersPerTurn, treadsLegB, treadsLegC, walklineOffset, walklineSplitOffset, minInnerWidth, minRiser, maxRiser, turn1Type, turn2Type, stairWidth, mergeLandings } = config;

  const numTurns = stairType === 'U' || stairType === 'S' ? 2 : stairType === 'L' ? 1 : 0;

  // "1 duży podest": oba zakręty typu 'landing' w U (i włączone mergeLandings) scalają się w
  // JEDNĄ platformę (patrz planLayout.js/mergeLandingPair) — 1 stopień zamiast 2, a odcinek B
  // jest ignorowany. Przy mergeLandings=false wracamy do 2 osobnych półpodestów na kolejnych
  // wysokościach. numTreads musi się z tym dokładnie zgadzać, inaczej wysokość podstopnia
  // (totalRise/numRisers) zostałaby policzona dla złej liczby stopni i ostatni stopień nie
  // trafiłby w wysokość kondygnacji.
  // (an S never merges its two landings — planLayout.js buildMultiTurnLayout)
  const isBigLanding = numTurns === 2 && stairType !== 'S' && turn1Type === 'landing' && turn2Type === 'landing' && mergeLandings;

  const turn1Contribution = numTurns >= 1 ? (turn1Type === 'landing' ? 1 : windersPerTurn) : 0;
  const turn2Contribution = numTurns >= 2 ? (turn2Type === 'landing' ? 1 : windersPerTurn) : 0;

  // one 180° winder zone instead of two turns (winderArc.js isHalfTurnU)
  const halfTurn = isHalfTurnU(config);
  const numTreads = halfTurn
    ? treadsLegA + halfTurnWinderCount(config) + treadsLegC
    : stairType === 'straight'
      ? treadsLegA
      : stairType === 'U' || stairType === 'S'
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
  if (halfTurn) turnChecks.push(checkHalfTurnFeasibility(config));
  else if (numTurns >= 1) turnChecks.push(checkTurnFeasibility(turn1Type, windersPerTurn, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth, stairWidth));
  if (numTurns >= 2 && !halfTurn) turnChecks.push(checkTurnFeasibility(turn2Type, windersPerTurn, treadGoing, walklineOffset, walklineSplitOffset, minInnerWidth, stairWidth));

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
  const { totalRise, ceilingThickness, minHeadroom } = config;
  // Prostokąt albo narysowany wielokąt — jeden obrys (geometry/ceilingOpening.js). open* = jego obwiednia.
  // in DERIVED mode the opening is the one the stair needs (requiredOpeningRelative)
  const frame = openingFrame(config, planLayout);
  const derivedRelative = config.openingMode === 'derived' ? requiredOpeningRelative(config, planLayout, riserHeight, frame) : null;
  const opening = resolveOpening(config, frame, derivedRelative);
  const { minX: openMinX, maxX: openMaxX, minY: openMinY, maxY: openMaxY } = opening;

  const soffitZ = totalRise - ceilingThickness;
  const dangerThresholdZ = soffitZ - minHeadroom;

  const violatingTreads = [];
  for (const tread of planLayout.treads) {
    const topZ = (tread.index + 1) * riserHeight;
    if (topZ <= dangerThresholdZ) continue;
    if (!polygonContainsPolygon(opening.outline, tread.outline)) violatingTreads.push(tread.index);
  }

  return {
    openMinX,
    openMaxX,
    openMinY,
    openMaxY,
    openingShape: opening.shape,
    openingOutline: opening.outline,
    openingInvalidReason: opening.invalidReason,
    openingRelativeOutline: opening.relativeOutline,
    openingMode: opening.shape === 'derived' ? 'derived' : 'given',
    soffitZ,
    fits: violatingTreads.length === 0,
    violatingTreads,
  };
}
