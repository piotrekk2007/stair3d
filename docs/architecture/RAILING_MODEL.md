# Balustrada (poręcz + tralki) — plan wdrożenia

Status: **etapy 1, 2 i 3a (kosztorys + walidacja) zaimplementowane** (bieg prosty, odcinki od–do, oba typy wangi, parametry, solver, render 3D,
panel z tabelą odcinków, ostrzeżenie o błędnym odcinku w Walidacji; zakręty i podesty). Etap 3b: plan 2D zrobiony (warstwa balustrady + krańce odcinków z Inspektora) i DXF zrobiony (jeden arkusz); etap 4 (poręcz gięta, podporęcz) zrobiony. Decyzje z użytkownikiem są na końcu.

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

## Identyfikatory słupków w biegach

`runs[].startPostId/endPostId` wskazują słup, który faktycznie stoi na końcu biegu — ponownie użyty słup konstrukcyjny
pod swoim własnym id (wcześniej: id miejsca `railing-post-…`, które nie istniało jako model). Korzysta z tego kontrola
konstrukcji (A4) i walidacja prześwitu.

## Zweryfikowane w etapie 1

- Wanga jest wyciskana od linii odniesienia (łańcuch stopnia) w głąb schodów (`stringerRenderer.js` `inwardDirection`), więc jej oś
  leży o pół grubości od łańcucha w tę stronę.

## Do zweryfikowania w kolejnych etapach

- na którym stopniu leży pierwsza/ostatnia tralka, gdy odcinek kończy się w środku biegu (słupek końcowy)
