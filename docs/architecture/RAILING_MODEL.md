# Balustrada (poręcz + tralki) — plan wdrożenia

Status: **etapy 1, 2 i 3a (kosztorys + walidacja) zaimplementowane** (bieg prosty, odcinki od–do, oba typy wangi, parametry, solver, render 3D,
panel z tabelą odcinków, ostrzeżenie o błędnym odcinku w Walidacji; zakręty i podesty). Etap 3b: plan 2D zrobiony (warstwa balustrady + krańce odcinków z Inspektora) i DXF zrobiony (jeden arkusz); etap 4 (poręcz gięta, podporęcz) zrobiony. Decyzje z użytkownikiem są na końcu.

## Słupki ręczne (decyzja użytkownika 2026-10-19) — `railingPostEdits.js`

`config.railingPostEdits = { [sectionId]: { added: [{ id, s }], suppressed: [s] } }`; `s` = mm w rzucie wzdłuż
`section.path` od początku odcinka (ta sama ścieżka, co rysuje plan).
- **Słupek ręczny** (`added`): id `railing-post-<odcinek>-m-<id>` — działają na niego `manualPostOverrides` (przekrój,
  wydłuż/skróć); bieg poręczy jest przecinany w jego miejscu (`splitPathAt`) jak przy każdym słupku, tralki / szkło
  układają się między słupkami. Bliżej niż 100 mm od innego słupka / narożnika albo poza poręczą → pominięty, INFO
  `RAILING-POST-MANUAL-SKIPPED`.
- **Wyłączony słupek narożny** (`suppressed`, dopasowanie ±50 mm): dwa biegi spotykające się w narożniku łączą się w
  jeden — poręcz przechodzi przez narożnik z cięciem pod kątem (`annotateCuts`, `planDeg`). Nie przy szkle między
  słupkami (tafla nie skręca) i nie na uskoku wysokości (poręcz musi się tam skończyć).
- Id słupków automatycznych na złączach: numer wśród automatycznych — dodanie ręcznego nie zmienia id (edycje
  słupków zostają przy swoich słupkach). Wyłączenie narożnika przesuwa numery dalszych złączy.
- Model dla edytora: `section.postSpots` (`postId`, `kind` start|end|corner|step|glass-post|manual, `s`, `at`,
  `suppressible`), `section.suppressedCorners`.
- UI: plan 2D, tryb „▮ Słupki” (`plan2dRenderer.js railingPostEditXML`, `planInteractions.js`): klik na linii = nowy
  słupek (przyciąga do krawędzi stopni w 8 px, inaczej co 10 mm), przeciąganie pomarańczowego = przesuń, prawy klik =
  usuń ręczny / wyłącz narożny, klik w przerywane kółko = przywróć; Inspektor: „Od początku odcinka [mm]”, „Usuń
  słupek”, „Wyłącz słupek (poręcz ciągła przez narożnik)”. Każdy gest = jeden krok cofania.
- Testy: `geometry/__tests__/railingPosts.test.js`.

## Balustrada przy otworze w stropie (etap B, decyzje użytkownika 2026-10-19) — `buildOpeningRailing`

- `railingOpeningEnabled` (niezależnie od balustrady schodów), na POSADZCE piętra (z = totalRise), oś słupków
  `railingOpeningSetbackMm` (60 mm, ZAŁOŻENIE) od krawędzi otworu w stronę stropu, góra poręczy
  `railingOpeningHeightMm` (1100 mm, § 298 — DO WERYFIKACJI) nad posadzką; poziomo, bez uskoków.
- Krawędzie: obrys otworu (`ceilingFit.openingOutline`, CCW). Domyślnie każda poza krawędziami przy ścianach klatki
  (równoległe do ściany w odległości ≤ wanga + odstęp + 30 mm). Krawędź WYJŚCIA (leży na niej tylna krawędź ostatniego
  stopnia, ±30 mm) tylko na wolnych kawałkach: odcinek zajęty przez ostatni stopień i obie wangi jest wycięty
  (`openingPieces`; wolny kawałek < 100 mm — bez balustrady) — poprawka po uwadze użytkownika 2026-10-19 (balustrada
  szła po całej krawędzi, także nad wejściem na piętro). `railingOpeningEdges[i] = true/false` nadpisuje (klik na planie
  w trybie „▮ Słupki”, zielona = z balustradą, szara przerywana = bez; powrót do AUTO, gdy klik da to samo, co automat).
- Połączenie ze schodami: na końcu / narożniku, gdzie stoi słup schodów (słup końcowy wangi, ostatni słupek balustrady
  schodów; ≤ 1,5 × jego przekrój), TEN słup jest słupem balustrady przy otworze — bez drugiego słupka, poręcz dochodzi do
  jego lica, słup dostaje wysokość do góry poręczy (`postTopNeeds` → `raisePostsToHandrail`).
- Ściany częściowe (decyzja użytkownika 2026-10-19, `stairwellWall{S}Extent/LengthMm`): krawędź otworu jest cięta
  na kawałki tam, gdzie stoją schody (krawędź wyjścia) ORAZ tam, gdzie wzdłuż niej biegnie ściana (`openingEdgeStates`
  → `cuts`, `wallPartial`); balustrada tylko na wolnych kawałkach (≥ 100 mm), nazwy odcinków wg liczby cięć przed
  kawałkiem (`''`, `-b`, `-c`, …). Przycisk „Balustrada zewn. tam, gdzie nie ma ściany” (folder 9, `main.js
  railingOuterFromWalls` ← `stairwell.js treadsOpenOnOuterSide / openOuterRailingRanges`) zastępuje odcinki po
  stronie zewnętrznej odcinkami na stopniach bez ściany obok.
- Słup końcowy NA STROPIE (decyzja użytkownika 2026-10-19 — wcześniej poręcz przy otworze dochodziła do niego z
  uskokiem w bok, bo stał na osi wangi przy krawędzi stropu, a balustrada 60 mm dalej): gdy wolny kawałek krawędzi
  wyjścia po stronie DUSZY ma balustradę, `endNewelOntoSlab` (liczone w `buildStaircase` zaraz po planie, przed
  słupami i wangami) podaje linię balustrady → `fullConfig.endNewelOntoSlab` → `postSolver.js` przesuwa `post-end`
  wzdłuż ostatniego kierunku wejścia, aż jego środek leży na tej linii (tylko do przodu, tylko gdy schody wychodzą
  na strop pod kątem ≥ 60° do krawędzi), słup stoi na posadzce (`onSlab`, dół = totalRise, nominalnie 1000 mm, potem
  podniesiony do poręczy). Wanga wewn. dochodzi do jego lica + wręg (`stringerSolver.js boardEndPosts` →
  `endPost.onSlab {floorZ, edgeU}`), jej kawałek za krawędzią stropu jest ścięty poniżej posadzki
  (`stringerConstructionGeometry.js cutBelowFloorPast`) — przy krawędzi stropu cięcie pionowe, na stropie leży na
  posadzce. Poręcz schodów i poręcz przy otworze kończą się na licach tego słupa. Nad posadzką zostaje tylko kilka cm
  wangi — śruby złącza zwykle dają WARNING `JOINT-CONNECTOR-EDGE` (do decyzji w warsztacie). Słup balustrady schodów
  po stronie zewnętrznej NIE jest przesuwany.
- Sąsiednie włączone kawałki = jeden odcinek `opening-e<krawędź>` / `opening-e<krawędź>-b` (gdy zaczyna się za schodami) (`kind: 'opening'`, `side: null`):
  krawędzie odsunięte, w narożnikach przecięte (ucios), wolne końce prostopadle; wszystkie krawędzie = pętla
  zamknięta (słupek startowy ją zamyka). Słupki na narożnikach i końcach, ręczne słupki i wyłączanie narożników jak
  przy schodach (`applyPostEditsToRuns`), tralki rozłożone równo na posadzce albo szkło między słupkami (przy
  `glass-side` też między słupkami — szkło z boku wangi nie dotyczy krawędzi stropu).
- Czytają go 3D, plan, kosztorys, DXF, kontrola konstrukcji i walidacja jak każdy odcinek; NIE edytor „Profil
  poręczy” i nie korekty wysokości końców (poręcz pozioma). WARNING PL-LEGAL-H-01 poniżej 1,1 m.
- Testy: `geometry/__tests__/railingOpening.test.js`.

## Etap 4: poręcz gięta i podporęcz

**Poręcz gięta** (`config.railingBent`, domyślnie wyłączona; `railingBendRadiusMm` 300, `railingPlanBendRadiusMm` 150 —
parametry, wybór programu, do ustalenia z warsztatem):
- narożnik w rzucie przerywa bieg słupkiem TYLKO tam, gdzie stoi już słup (np. słup narożny po stronie duszy); w pozostałych
  narożnikach poręcz jest wyginana w rzucie łukiem (`splitIntoRuns(…, isPostAt)`);
- `smoothRun`: w rzucie łuki tylko w prawdziwych narożnikach (`planCorners` — punkty na prostej pominięte), w pionie (z
  względem długości w rzucie) każde załamanie pochylenia zaokrąglone łukiem; węzły bliżej niż 20 mm scalane (granice stopni
  przy narożniku inaczej ściskały łuki do zera); oba promienie przycinane, gdy sąsiednie odcinki są za krótkie
  (`filletPolyline`). Wynik próbkowany gęsto (cięciwy) — renderer, walidacja, kontrola konstrukcji działają bez zmian;
- `run.bent`; kosztorys: bieg gięty = JEDNA pozycja poręczy o prawdziwej długości osi; DXF: bieg gięty jako rozwinięcie
  (oś rozwinięta wzdłuż rzutu × wysokość, krawędzie ±h/2) z długością osi 3D, długością w rzucie i wzniesieniem;
- tralki biorą wysokość z wygładzonej linii (`zOnPaths`) — dochodzą dokładnie do spodu poręczy giętej;
- **ograniczenie:** łuk w rzucie odsuwa poręcz (i tralki na wandze wpuszczanej) od osi wangi w narożniku o najwyżej
  R·(√2−1) (62 mm przy R = 150) — przy wandze 40 mm tralki w samym narożniku stoją częściowo obok niej. Mały promień albo
  słupek w narożniku to rozwiązują.

**Podporęcz** (`config.railingBaseRail`, domyślnie wyłączona; `railingBaseRailWidthMm` 50, `railingBaseRailHeightMm` 30 —
parametry, wybór programu): listwa na górnej krawędzi wangi WPUSZCZANEJ wzdłuż każdego biegu poręczy, tralki w nią wchodzą
(ich dół o wysokość podporęczy wyżej). Przy wandze nakładanej tralki stoją na stopniach — podporęczy nie ma
(`RAILING-BASERAIL-NOT-APPLICABLE`, INFO).
- `baseRailAlong`: ścieżka biegu próbkowana co 20 mm, punkty na krawędzi wangi (`wangaTopAt`), w wierzchołku ścieżki — na
  WYŻSZEJ z krawędzi desek tuż obok (uskok między deskami w narożniku; różnica ≤ 1 mm to tylko spadek jednej deski),
  punkty współliniowe scalane, krótkie odcinki na załamaniu w jednej płaszczyźnie zastępowane prawdziwym załamaniem
  (`collapseShortPieces`/`kinkBetween`); kąty cięcia jak w poręczy (`annotateCuts`);
- `section.baseRail = {shape, widthMm, heightMm, runs, pieces}`; render (ten sam materiał co poręcz), kosztorys
  (`ELEMENT_TYPES.BASERAIL`, materiał `railing-baserail`, cena za mb, domyślnie 0 = bez ceny, kategoria
  „Podporęcze (z modelu)"), DXF (wiersze „Podporecz …"), ciężar do wangi w kontroli konstrukcji (element po elemencie
  na deskę pod nim, `railingDetailKn.baseRail`) i do ciężaru własnego („Podporęcz").

Testy: `geometry/__tests__/railingSolver.test.js` (etap 4).

## DXF balustrady (etap 3b, część 2) — jeden plik (decyzja użytkownika)

- **Kąty cięcia są w modelu**, nie w eksporterze (`railingSolver.js` `annotateCuts`/`pitchUnder`): każdy element poręczy
  ma `pitchDeg`, `startCut`/`endCut` = `{kind: 'post'|'join', verticalDeg, planDeg}` i `cutLengthMm`; każda tralka ma
  `topCutDeg`, `bottomCutDeg`, `longPointMm`.
  - pion (widok z boku), od cięcia prostopadłego do osi: przy słupku cięcie pionowe (−/+ nachylenie elementu), na
    łączeniu dwóch elementów biegu — dwusieczna (połowa zmiany nachylenia), po obu stronach ten sam kąt;
  - rzut: połowa kąta skrętu na łączeniu (0 przy słupku). Przy jednoczesnej zmianie nachylenia i skrętu to dwie
    składowe podane osobno (cięcie złożone do dopracowania w warsztacie);
  - `cutLengthMm` = dłuższa z krawędzi (górna / dolna) — długość do cięcia;
  - tralka: góra pod nachyleniem poręczy nad nią; dół — na stopniu (wanga nakładana) poziomo, na wandze wpuszczanej
    równolegle do poręczy (przybliżenie: górna krawędź wangi biegnie równolegle do linii poręczy).
- **`dxfExport.js` `buildRailingDXF(railingModel, {balusterSizeMm})`** — jeden arkusz 1:1: nagłówek z objaśnieniem
  kątów, każdy element poręczy w widoku z boku (oś, oba cięcia narysowane) z opisem (bieg, element, przekrój, oś,
  długość do cięcia, nachylenie, oba cięcia), potem lista cięcia tralek zgrupowana po (odcinek, długość osi co 1 mm,
  kąt góry, kąt dołu) — ilość, oś, długość max, kąty — każda grupa narysowana raz, leżąco. Tylko ASCII (kąty jako
  „32,9 st."). Brak balustrady → `null` (komunikat w UI zamiast pustego pliku).
- UI: przycisk „Balustrada (DXF 1:1)" w pasku zakładki Kosztorys (`takeoffPanel.js` `onExportRailingDXF`,
  `main.js` `exportRailingDXF`).

## Plan 2D i krańce odcinków (etap 3b, część 1)

- Warstwa „Balustrada" w planie 2D (`plan2dRenderer.js`, opcja `railingModel`, przełącznik w „Linie konstrukcyjne"): cała ścieżka po
  stronie wangi cienką przerywaną linią, biegi poręczy grubą linią na wierzchu, tralki jako kropki, pierścień na obu krańcach odcinka.
  Miejsce, gdzie jest przerywana ścieżka bez grubej linii = tu poręcz nie ma jak iść (dusza zakrętu).
- Krańce odcinka z planu: po zaznaczeniu stopnia Inspektor ma sekcję „Balustrada" — dla każdego odcinka „Początek / Koniec: stopień N",
  „Do końca", „Usuń" oraz „Nowy odcinek zewn./wewn. od stopnia N" (`editRailingSections` w `railingSolver.js` — czysta funkcja, `main.js`
  `applyRailingEdit` zapisuje do `config.railingSections` + rebuild + historia). Tabela w panelu parametrów pozostaje.
- **Strona dusz zakrętu (poprawione po zgłoszeniu):** najpierw poręcz po stronie wewnętrznej była tam ucinana (próg 50°), co dawało przerwę
  i dwa słupy obok siebie. Teraz poręcz idzie przez zabiegi ciągle, choć stromo (~58° przy duszy 110 mm, ~85° przy 3–4 zabiegach na
  zakręt) jako proste odcinki — jak w etapie 1. Dzieli ją tylko prawdziwy pion (`RAILING_STEEP_ANGLE_DEG = 89`, np. podest). Słupek
  łączący wpadający w istniejący słup narożny jest używany ponownie (nie powstaje drugi). `RAILING-UNCOVERED-STEPS` /
  `uncoveredSteps` zostają jako zabezpieczenie (stopień bez poręczy jest zgłaszany, a tralki nie stoją pod nieistniejącą poręczą).

## Co zrobiono w etapie 3a (kosztorys i walidacja)

- **Kosztorys** (`takeoff/railingItems.js`, `computeMaterialTakeoff` przyjmuje `railingModel`): `HANDRAIL` = jedna pozycja na prosty
  odcinek poręczy (prawdziwa długość 3D, przekrój); `BALUSTER` = jedna pozycja na (odcinek balustrady, długość zaokrąglona do 1 mm)
  z `quantity` — to jest **lista cięcia tralek** (na wandze nakładanej wysokości różnią się co stopień). Słupki balustrady liczą się jako
  zwykłe słupy (etykieta „Słupek balustrady", wycena z cennika słupów). Odpady: `HANDRAIL` 10%, `BALUSTER` 3%.
- **Ceny:** `railing-baluster` (zł/szt.) i `railing-handrail` (zł/mb, nowa jednostka `PRICE_UNITS.LENGTH`) w ogólnym cenniku
  (`DEFAULT_PRICE_LIST`), edytowane w „Cennik i materiały". **Domyślnie 0 = bez ceny** (pozycja zostaje niewyceniona i oznaczona) —
  żadnych wymyślonych cen; `applyPricing` traktuje cenę <= 0 jako brak ceny. Kategorie podsumowania: „Poręcze (z modelu)" i „Tralki
  (z modelu)" (celowo inne niż ręczne wiersze „Tralki"/„Poręcze", żeby się nie sklejały). Pozycje ręczne zostały — nie wpisuj drugi raz.
- **Walidacja** (`validator/railingChecks.js`, wywoływana w `buildStaircase.js`, wynik dołącza do `railingModel.diagnostics`, więc
  trafia do Walidacji i bramki kosztorysu): `PL-LEGAL-H-01` jako **WARNING** (nigdy blokujący, mimo że katalog ma ERROR — poręcz od linii
  nosków to inna wielkość niż balustrada na wolnej krawędzi): wysokość < 1100 mm, skonfigurowany maks. prześwit > limit typu budynku
  (200 mm ogólnie, 120 mm wielorodzinny/publiczny/ZOZ/oświata), oraz **zmierzony** największy prześwit na gotowej balustradzie;
  `BWF-GUID-B-02` jako INFO (poręcz < 68×45, tralka < 27 kw./35 okr., słupek < 82).

## Co zrobiono w etapie 2 (zakręty i podesty)

- Ścieżka poręczy idzie po CAŁYM łańcuchu stopnia (z narożnikami — na podeście po dwóch bokach, nie po przekątnej), przesuniętym
  w bok jako jedna łamana z ostrymi narożnikami (miter). Linia nosków: +1 podstopień na stopniu prostym/zabiegowym, **poziomo na podeście**.
- Poręcz to **biegi (runs) zakończone słupkiem** wszędzie tam, gdzie nie może być jednym odcinkiem: narożnik w rzucie > 10°
  (`RAILING_CORNER_ANGLE_DEG`), skok wysokości (bieg po podeście zaczyna się o podstopień wyżej) albo odcinek stromszy niż 50°
  (`RAILING_STEEP_ANGLE_DEG` — dusza zakrętu, gdzie stopnie zabiegowe schodzą do punktu). W każdym takim miejscu JEDEN słupek
  (istniejący jest używany ponownie), a oba biegi dochodzą do niego na własnej wysokości. Biegi krótsze niż słupek są pomijane.
  `RailingModel.sections[].runs` = `[{startPostId, endPostId, pieces}]`; `handrail.pieces` to wszystkie odcinki po kolei.
- Wanga wpuszczana: tralki równo wzdłuż każdego biegu (szerokość słupka na obu końcach uwzględniona). Nakładana: ten sam rytm na
  każdym stopniu, po łańcuchu stopnia (na podeście po obu bokach); tralka, która wypadłaby w słupku, jest pomijana.
- Diagnostyka INFO `RAILING-RAIL-STEP`: poręcz kończy się przy słupku i zaczyna na innej wysokości (podest, dusza zakrętu).
- **Ograniczenia:** poręcz nie jest gięta (łamana z prostych odcinków, bez łączenia na ucios pod skosem), a po stronie dusz zakrętu z
  kilkoma stopniami zabiegowymi poręcz kończy się i zaczyna o kilka podstopni wyżej (potrzebny słup wysoki/łabędzia szyja — do
  dopracowania w warsztacie, etap 4). Tralki przy słupku na wandze nakładanej są tylko pomijane, bez przeliczania rytmu.

## Co zrobiono w etapie 1 (odchylenia od planu)

- `railingSolver.js`/`railingRenderer.js`/`buildStaircase.js` (`railingModel` w wyniku), `config.railing*` (schema.js).
- Rozmieszczenie: wanga wpuszczana = równo wzdłuż poręczy, tralka stoi na `upperCurve` wangi; nakładana = k tralek na stopień
  w tym samym rytmie na każdym stopniu (k z limitu prześwitu).
- Słupki końcowe: istniejące słupy (start/koniec, od strony wewnętrznej) są używane ponownie, inaczej powstaje nowy słupek.
- Poprzecznie: środek grubości wangi (`railingLateralOffsetMm`, null = auto; **bez suwaka w UI**).
- **Słupki balustrady są zwykłymi słupami (`PostModel`, `kind: 'railing'`)**: `buildStaircase.js` dokłada je do `allPostModels`/`postModels`,
  więc rysuje je `postRenderer.js`, wchodzą do kosztorysu/DXF słupów, są zaznaczalne (3D i znacznik w planie 2D) i edytowalne w Inspektorze
  jak każdy słup: grubość (`sizeMm`, tylko słupki balustrady), wydłużenie/skrócenie od góry i od dołu, usunięcie/przywrócenie
  (`config.manualPostOverrides`). Domyślnie: `railingPostSizeMm` (90) i `railingPostTopAboveHandrailMm` (0). Rozstaw tralek na wandze
  wpuszczanej uwzględnia faktyczną szerokość słupka na każdym końcu (usunięty = 0).
- Kolor balustrady dodany do kolorów prezentacji; warstwa "Balustrada" w HUD 3D; diagnostyki solvera przechodzą przez bramkę Walidacji.
- **Jeszcze nie:** klikanie krańców odcinka w planie 2D (etap 3), kosztorys/lista cięcia/DXF (etap 3),
  reguła 1100 mm i prześwit 12/20 cm jako diagnostyka (etap 3).

## Zasada

Bez wyjątku od RULES.md: `config` (parametry + odcinki) -> `railingSolver.js` (czyste dane, bez Three.js)
-> `railingRenderer.js` (tylko wyciska gotowe dane) -> 3D. Walidacja, kosztorys, plan 2D i DXF czytają
ten sam `RailingModel`; nic nie liczy geometrii samodzielnie. Balustrada NIE zmienia geometrii stopni ani wang
(zależy od nich, nie odwrotnie — reguła 6).

## Dane wejściowe (`config`, cofanie i plik projektu działają od razu; nowe klucze mają domyślne, więc bez zmiany wersji pliku)

- profil poręczy: kształt (prostokąt/okrągły) + wymiary; presety 70x40, 40x50, 60x60, 68x45 (min. BWF-STRUCT), okrągła, własny
- tralka: kwadratowa/okrągła + wymiar (min. BWF: 27 kwadratowa / 35 toczona)
- wysokość poręczy nad linią nosków (domyślnie 900 mm — decyzja użytkownika), maks. prześwit między tralkami (120 / 200 mm), liczba tralek na stopień w trybie "na stopniu" liczona z prześwitu
- odcinki: `railingSections = [{ id, side: 'outer'|'inner', fromStep, toStep }]` — balustrada może zaczynać się od dowolnego stopnia, być tylko na jednym biegu i tylko po jednej stronie

## Solver (`src/geometry/railingSolver.js`)

- Ścieżka odcinka: punkty czół stopni `fromStep..toStep` po danej stronie (finalne krawędzie, więc ręczne edycje są uwzględnione) + tył ostatniego; uproszczona do prostych odcinków. Pozycja poprzeczna: na wandze, od zewnątrz (jedna wartość przesunięcia od osi wangi).
- **Wanga wpuszczana:** poręcz równoległa do linii nachylenia; tralki równomiernie wzdłuż niej (prześwit <= limit), stoją na górnej krawędzi wangi (`upperCurve`).
- **Wanga nakładana:** stały rytm na stopniu (k tralek, od noska; k z długości krawędzi stopnia, więc na zabiegowym różne), tralka stoi na stopniu, wysokość różna co stopień. Ostatnia tralka jednego stopnia i pierwsza następnego też muszą spełniać limit prześwitu.
- Słupki na końcach odcinka: używa istniejących słupów (start/koniec/narożne) jeśli leżą w tym miejscu, inaczej nowy (`kind: 'railing'`).
- Zakręt (etap 2, zrobione): poręcz jako biegi z prostych odcinków, słupek w każdym narożniku/skoku. Poręcz gięta poza zakresem.
- Wynik: `RailingModel` = odcinki -> {ścieżka poręczy, tralki [{pozycja, dół, góra, profil}], słupki, diagnostyka}.

## Walidacja

`PL-LEGAL-H-01` (balustrada >= 1,1 m, prześwit 12/20 cm) jest w katalogu, ale nic go dziś nie liczy — podpiąć. Uwaga: poręcz 900 mm to inna wielkość niż wysokość balustrady na wolnej krawędzi (podest, antresola) — 1100 mm sprawdzać tylko tam. Do tego: minimalne przekroje (BWF), poprawność zakresu odcinka (od <= do, stopnie istnieją).

## Kosztorys i eksport (etap 3)

Ilości z modelu (tralki szt., poręcz mb, słupki), cena jednostkowa wpisywana przez użytkownika jak dziś w pozycjach ręcznych; lista cięcia tralek (na nakładanej wysokości są różne); DXF poręczy/tralek; linia balustrady w planie 2D; kolor balustrady w kolorach prezentacji.

## UI

Panel parametrów (folder "Balustrada") + tabela odcinków (strona, od, do, dodaj/usuń) + ustawianie krańców odcinka przez zaznaczenie stopnia w planie 2D (decyzja: tabela plus klikanie). Warstwa balustrady w HUD 3D.

## Etapy

1. Bieg prosty, obie strony, odcinki od-do, oba typy wangi: `config` + solver + testy + renderer 3D (tralki jako `InstancedMesh`) + panel i tabela odcinków.
2. Zakręty i podesty: łamana poręcz, słupki narożne, stopnie zabiegowe.
3. Kosztorys, lista cięcia, plan 2D + klikanie krańców, DXF, walidacja PL-LEGAL-H-01.
4. Dopracowania: podporęcz, poręcz gięta na zabiegach.

## Decyzje użytkownika

- pozycja poprzeczna: na wandze, od zewnątrz
- odcinki: tabela + klikanie w planie 2D
- wysokość poręczy: 900 mm nad linią nosków (domyślnie, konfigurowalna)
- zakręt v1: łamana z prostych odcinków; poręcz gięta później

## Poprawka: schody skręcające w lewo

Przesunięcie poprzeczne balustrady (i grubość wang) szło przy skręcie w lewo NA ZEWNĄTRZ schodów — kierunek
„do środka" był liczony tylko dla układu skrętu w prawo. Teraz jeden helper `planLayout.js` `inwardNormal`
(z `planLayout.handedness`) dla wang, balustrady i słupów. Słupy konstrukcyjne stoją w osi wangi, tak jak słupki
balustrady — ponowne użycie istniejącego słupa na końcu odcinka działa dzięki temu dokładniej.

## Szkło (etap S1, zrobiony)

Decyzje użytkownika (2026-09-29): parametr **„Wypełnienie”** (`config.railingInfill`) — `balusters` (tralki, jak
dotąd), `glass-side` (**szkło na rotulach do boku wangi**, poręcz osadzona na szkle) albo `glass-posts` (**szkło
podwieszone między słupkami** na prostokątnych uchwytach, poręcz tradycyjnie na słupkach); szkło **VSG 4.4.2 lub 5.5.2**
(`railingGlassType`; grubość = 2 tafle + 2 folie PVB × 0,38 mm = 8,76 / 10,76 mm); tafla **maks. 1800 mm**
(`railingGlassMaxWidthMm`). Pozostałe wymiary to parametry DO WERYFIKACJI (`CO-MFG-J-GLASS`): szczelina 20 mm,
odsunięcie rotuli od wangi 30 mm, pas tafli poniżej górnej krawędzi wangi 120 mm, 2 rotule na taflę, 2 uchwyty na
krawędź, wstawka rotuli 150 mm od końca tafli.

- `src/geometry/railingGlass.js` (czysty): `panesForRun` — szkło jest płaskie, więc każdy prosty odcinek ścieżki (w
  rzucie) dostaje własne tafle, najwyżej `maxWidth` szerokie, ze szczeliną między nimi; na końcu biegu przy słupku —
  odstęp pół słupka + szczelina. Tafla = wielokąt we własnym układzie (t wzdłuż tafli, z = wysokość): góra pod poręczą
  (przy poręczy giętej — pod jej wygładzoną linią), dół: rotule — górna krawędź wangi minus pas mocowania (na wandze
  nakładanej: linia nosków minus wysokość podstopnia = dno wcięć, przybliżenie); między słupkami — nad wangą
  wpuszczaną / nad linią nosków (nakładana) + szczelina, a góra szczelinę pod poręczą. Tafla niższa niż 150 mm jest
  pominięta z ostrzeżeniem `RAILING-GLASS-PANE-LOW`. `blank` = prostokąt do zamówienia, `areaMm2` = tafla.
- `railingSolver.js`: przy rotulach płaszczyzna szkła (i poręcz na niej) leży **na zewnątrz** wangi (odsunięcie +
  pół grubości szkła od linii łańcucha) i nie powstają nowe słupki (istniejące słupy konstrukcyjne zostają); między
  słupkami narożnik rzutu zawsze dostaje słupek (także przy poręczy giętej), a bieg dłuższy niż jedna tafla — słupki
  pośrednie (`intermediatePostSplits`, `splitPathAt`). Tralek nie ma.
- 3D: tafla = graniastosłup z obrysu (przezroczysty materiał, bez cienia), rotule/uchwyty jako znaczniki (metal).
  Rzut 2D: tafle jako niebieskie paski, mocowania jako kwadraciki. DXF balustrady: każda tafla 1:1 — obrys, prostokąt,
  mocowania od lewego dolnego rogu (rotula = otwór). Kosztorys: `GLASS_PANE` na taflę (cena za m² prostokąta,
  `railing-glass`, domyślnie 0 = bez ceny), `GLASS_FIXING` na odcinek (sztuki, `railing-glass-fixing`). Oferta: wiersz
  „Balustrada” opisuje szkło.
- Walidacja: przy szkle nie ma sprawdzania prześwitu między tralkami; szczelina szkła > dopuszczalny prześwit →
  `PL-LEGAL-H-01`. Kontrola konstrukcji: poręcz na szkle nie jest liczona jako belka między słupkami (pomijana z
  opisem); **szkło i mocowania nie są sprawdzane** (wytrzymałość tafli, nośność rotul), ciężar szkła nie obciąża wangi.

### Poprawki S1b (decyzje użytkownika 2026-09-29)

- **Między słupkami uchwyty są zawsze na słupku**: tafla wisi od słupka do słupka (jedna tafla na przęsło; słupek
  na każdym załamaniu rzutu, także poniżej 10°, i słupki pośrednie), jej krawędź `GLASS_TO_POST_MM` (10 mm, wynika z
  uchwytu — do weryfikacji) od lica słupka; każdy uchwyt ma `postFaceT` (lico słupka) i jest rysowany od lica słupka
  na krawędź szkła. **Ustawia się tylko odstęp tafli od poręczy** (`railingGlassTopGapMm`) **i od spodu**
  (`railingGlassBottomGapMm`); `railingGlassGapMm` dotyczy już tylko szczeliny między taflami na rotulach.
- **Kolor szkła** `railingGlassTint`: bezbarwne / optiwhite / ciemne (grafit) / brązowe — w etykiecie szkła
  (`glassType(config).label`, np. „VSG 4.4.2 optiwhite”) w kosztorysie, DXF i ofercie, oraz w kolorze tafli w 3D.
- **Rotula zawsze Ø30** (`ROTULE_DIAMETER_MM`) — w 3D i w DXF (okrąg Ø30, otwór w szkle wg producenta rotuli).
- **Kolor uchwytów i rotul** — ustawienie prezentacji (`scene/appearance.js` `METAL_ELEMENTS`: `glassFixing`, gotowe:
  stal nierdzewna / czarny mat / biały / antracyt), w folderze „Kolory i drewno (prezentacja)”, zapisywane w pliku
  projektu razem z pozostałymi kolorami.

## Identyfikatory słupków w biegach

`runs[].startPostId/endPostId` wskazują słup, który faktycznie stoi na końcu biegu — ponownie użyty słup konstrukcyjny
pod swoim własnym id (wcześniej: id miejsca `railing-post-…`, które nie istniało jako model). Korzysta z tego kontrola
konstrukcji (A4) i walidacja prześwitu.

## Zweryfikowane w etapie 1

- Wanga jest wyciskana od linii odniesienia (łańcuch stopnia) w głąb schodów (`stringerRenderer.js` `inwardDirection`), więc jej oś
  leży o pół grubości od łańcucha w tę stronę.

## Do zweryfikowania w kolejnych etapach

- na którym stopniu leży pierwsza/ostatnia tralka, gdy odcinek kończy się w środku biegu (słupek końcowy)

## Poprawka: podział przęsła szkła liczony z cieńszym słupkiem

`railingGlass.js intermediatePostSplits` odejmował od przęsła grubszy z dwóch możliwych słupków (balustradowy albo
konstrukcyjny). Między dwoma cieńszymi słupkami tafla wychodziła wtedy szersza od maksimum: 1916 mm przęsła dawało
taflę 1806 mm. Teraz liczy się z cieńszym, więc tafla nigdy nie przekracza `railingGlassMaxWidthMm`. Błąd istniał
wcześniej, a ujawnił go środkowy bieg U po zmianie zabiegów na łuk linii biegu.

## Końce poręczy przy słupach (2026-10-10)

Zgłoszone ze zrzutem: poręcz przechodziła przez słup startowy na wylot i kończyła się przed słupem końcowym. Przyczyna:
bieg poręczy szedł od węzła do węzła linii nosków, a słupy nie stoją w tych węzłach. Słup startowy jest odsunięty
od pierwszego noska, końcowy stoi za ostatnim stopniem, a słup konstrukcyjny użyty ponownie stoi tylko w pobliżu
złącza.

Teraz każdy bieg (`railingSolver.js`, jedna kolejność dla wszystkich):
1. **Uproszczona linia nosków** (`simplifyPath`).
2. **Bez krótkiego kawałka przy słupie** (`dropStartStub`, `RAIL_END_STUB_MM` = 250, wartość z praktyki, ZAŁOŻENIE):
   gdy linia nosków łamie się tuż przed słupem (pierwszy zabieg przy słupie narożnym, krawędź podestu) i ten kawałek
   leży w rzucie w linii z poprzednim, poręcz biegnie prosto do lica słupa zamiast robić krótki stromy odcinek.
3. **Docięcie do lic słupów** (`fitPathToPosts` / `fitPathStartToPost`): koniec jest cofany do lica, gdy bieg
   przechodzi przez słup, a przedłużany po własnej linii, gdy do słupa nie dochodzi (najwyżej o 3 grubości słupa).
   Gdy linia mija słup bokiem (słup narożny między podestem a zabiegami, bieg z 0 stopni, odcinek zaczęty w
   środku zabiegów), koniec biegu jest przesuwany do **najbliższego punktu słupa** z zachowaniem spadku pierwszego
   elementu (`fitStartAlongLine` → zapasowo najbliższy punkt; najwyżej o 3 grubości słupa) — poręcz zawsze dochodzi do
   swojego słupa. Koniec leżący już wewnątrz słupa zostaje. Gdy użytkownik **usunął własny słupek odcinka**, bieg
   idzie dalej do najbliższego stojącego słupa w zasięgu 3 grubości (`standingNear`, zwykle słup narożny tuż za
   końcem odcinka) i nosi jego id (`runs[].endPostId`); bez słupa w zasięgu koniec zostaje wolny. `runs[].startAtPostFace` / `endAtPostFace`.
4. **Ręczna korekta wysokości końca** (`config.railingEndOffsets`, klucz `railingEndKey(odcinek, słup, 'start'|'end')`,
   ±`MAX_RAILING_END_OFFSET_MM` = 400): przesuwa w pionie dokładnie ten punkt, w którym poręcz dotyka lica słupa.
   Prosty odcinek przy słupie zmienia pochylenie. Edycja: Inspektor → słup → „Poręcz przy słupie”, osobno poręcz
   dochodząca i odchodząca. To zwykłe pole config, więc działa cofanie i zapis w pliku projektu.
5. **Poręcz gięta**: wygładzenie (`smoothRun`) dopiero po krokach 1–4, potem ponowne docięcie do lic.

Tralki i tafle szkła biorą wysokość spod **własnej linii poręczy** (`zOnPaths`), a nie z surowej linii nosków, więc
nadążają za korektą i za poręczą doprowadzoną prosto do słupa. Tralki na wandze wpuszczanej rozkładają się od lica
do lica.

Naprawiony przy okazji błąd w `smoothRun`: stacje są zaokrąglane do 0,001 mm (`STATION_ROUND_MM`), a filtr końca
miał tolerancję 1e-6. Przy „nieokrągłej” długości biegu ostatnia stacja wypadała i poręcz gięta traciła ostatni
odcinek.

Edytor linii poręczy: zob. następna sekcja.

## Edytor „Profil poręczy” (2026-10-10)

Widok z boku jednego biegu poręczy, wzorem „Profilu wangi”. Zakładka widoku „Profil poręczy” obok „Profil wangi”.

- **Warstwa edycji** (`geometry/railingProfileModel.js`, czysta):
  - `config.railingProfileOverrides = { [odcinek]: { [bieg]: [{ s, dz }] } }`;
  - bieg = `railingRunKey(słupStart, słupKoniec)`, czyli `'słupA>słupB'`;
  - `s` to mm w rzucie wzdłuż biegu, liczone od lica słupa startowego;
  - `dz` to mm w górę (+) lub w dół (−) od linii biegu w tym miejscu, czyli od linii przez końce już skorygowane
    przy słupach;
  - punkt trafiający w istniejące załamanie linii (bliżej niż 1 mm) przesuwa to załamanie, a w innym miejscu dodaje
    nowe;
  - `applyRunPoints(path, points)` nakłada punkty; wysokość bazową czyta z oryginalnej linii, więc kolejność punktów
    nie ma znaczenia;
  - punkt bliżej niż 20 mm od końca albo poza biegiem jest pomijany i zliczany.

  Końce biegu zostają w `config.railingEndOffsets`. Gesty to zdarzenia `RAILING_PROFILE_EDITS` (`SET_POINT`,
  `REMOVE_POINT`, `SET_END`, `RESET_RUN`) → `applyRailingProfileEdit` → nowe wartości obu pól config → zwykłe
  `rebuild()`. Cofanie i plik projektu działają jak dla każdego pola config.
- **Solver** (`railingSolver.js`), kolejność w biegu:
  1. uproszczona linia nosków;
  2. bez krótkiego kawałka przy słupie;
  3. docięcie do lic słupów;
  4. korekta końców;
  5. **punkty użytkownika**;
  6. wygładzenie poręczy giętej i ponowne docięcie.

  Bieg dostaje `key` i `profile = { final, auto, base, nosing, control }` (dane dla edytora, na poziomie linii
  nosków). Odcinek dostaje `heightAboveNosing { minMm, maxMm }`.
- **Diagnostyki** (INFO):
  - `RAILING-PROFILE-EDITED`: linia zmieniona ręcznie, z rzeczywistym zakresem wysokości góry poręczy nad linią
    nosków;
  - `RAILING-PROFILE-POINT-SKIPPED`: punkty poza swoim biegiem.

  Zgodnie z zasadą projektu ręczna zmiana jest zachowana i zgłoszona, nigdy po cichu poprawiana.
- **Widok** (`geometry/railingProfileView.js`, czysty): bieg rozwinięty (u = droga w rzucie, v = wysokość): pas
  poręczy (góra/dół), linia AUTO do porównania, linia bazowa punktów, linia nosków, słupy na obu końcach (poręcz od
  lica do lica), tralki, uchwyty (`end:start`, `end:end`, `pt:<s>`).
- **Rysunek** (`railingEditor/railingEditorRenderer.js`, czysty SVG): uchwyty o stałym rozmiarze na ekranie (9 px):
  kwadrat = koniec na licu słupa, kółko = punkt. Linia AUTO jest przerywana i widoczna tylko po zmianie. Pod biegiem
  jest podziałka.
- **Panel** (`ui/railingEditorPanel.js`):
  - wybór biegu i „Resetuj bieg”;
  - przeciąganie uchwytu w pionie co 5 mm, z Shift co 1 mm;
  - dwuklik na poręczy dodaje punkt leżący na bieżącej linii;
  - prawy klik albo Delete usuwa punkt, a koniec lub załamanie wraca na 0;
  - strzałki ↑↓ przesuwają o 1 mm, z Shift o 10 mm;
  - pole liczbowe pod rysunkiem.

  Przeciąganie liczy się z ruchu myszy na ekranie przy bieżącej skali rysunku, a kadr jest zamrożony na czas
  przeciągania. Przy pierwszej wersji kadr i układ strony zmieniały się w trakcie, przez co 24 px dawało −400 mm.
- **Ograniczenia**:
  - punkt przesuwa się tylko w pionie, a zmiana położenia wzdłuż biegu wymaga usunięcia i dodania punktu;
  - promienie łuków poręczy giętej są nadal globalne (`railingBendRadiusMm`);
  - brak powiększania i przesuwania widoku, bo bieg zawsze mieści się w oknie;
  - klucz biegu zależy od słupów na jego końcach, więc po zmianie odcinka lub słupów punkty starego biegu są
    pomijane i zgłaszane.

Testy: `geometry/__tests__/railingProfile.test.js` (model edycji, solver, widok, rysunek, poręcz gięta w L).

## Poręcz zawsze dochodzi do słupa (2026-10-10)

Zgłoszone: po przesunięciu końca poręczy w edytorze poręcz w 3D nie dochodziła do słupa. Przyczyny były dwie i obie
istniały też bez edycji:

- **Słup niższy niż poręcz.** Słupek startowy miał stałe 1000 mm, a góra poręczy przy nim wypadała na ok. 1180 mm.
  Słup końcowy kończył się na poziomie stropu, a poręcz wyżej. Teraz słup, przy którym kończy się poręcz, sięga co
  najmniej do jej góry w tym miejscu (+ `railingPostTopAboveHandrailMm`):
  - `railingSolver.js` liczy `postTopNeeds` (id słupa → minimalny wierzch) i od razu nadaje tę wysokość własnym
    słupkom balustrady;
  - słupy konstrukcyjne podnosi `postSolver.js raisePostsToHandrail` (wołane w `buildStaircase.js`, flaga
    `raisedForHandrail`).

  Podnoszona jest wysokość **nominalna**. Ręczna korekta długości słupa (`topDeltaMm`) działa nadal od niej.
- **Koniec poręczy cięty prostopadle do jej osi** zostawiał przy pionowym licu słupa klin szczeliny.
  `railingRenderer.js handrailPieceGeometry` buduje teraz kawałek poręczy z końcami ciętymi **pionowo**: profil
  ułożony na długości w rzucie i pochylony ścinaniem (shear), o wysokości w pionie h/cos(pochylenia). Wysokość
  profilu prostopadle do osi zostaje ta sama. Kawałki stromsze niż tan = 5 (prawie pionowy odcinek duszy) zostają
  prostopadłościanem jak dawniej.

Testy: `railingRenderer.test.js` (słup sięga do poręczy dla obu stron i korekt ±150 mm; siatka poręczy kończy się
dokładnie na licach). Oba potwierdzone, że bez poprawki nie przechodzą.
