# Model złączy (JOINTS) — łączenie elementów schodów

Cel: plik DXF wysyłany do produkcji ma zawierać wszystkie obróbki potrzebne do złożenia schodów — nie tylko wpusty
stopni/podstopni w wandze, ale też połączenia wanga–słup, wanga–wanga i stopień–słup, z łącznikami.

## Decyzje użytkownika (2026-09-28)

| Złącze | Wybrany typ | Uwagi |
|---|---|---|
| wanga ↔ słup konstrukcyjny | **wręg pełnym przekrojem** — koniec wangi wchodzi całym przekrojem w gniazdo wyfrezowane w licu słupa | głębokość `postHousingDepthMm`, domyślnie 20 mm — DO WERYFIKACJI (brak źródła; BWF-GUID-F-02 opisuje dla porównania czop ≥12 × ≥45 mm) |
| wanga ↔ wanga (narożnik bez słupa) | **doczołowo we wręg** — jedna deska przechodzi, druga dochodzi do jej lica i wchodzi w płytki wręg | etap 3 |
| łączniki (śruby schodowe / kołki) | **tak, jako parametry** — liczba i rozstaw na złącze, otwory na DXF obu elementów, pozycja w kosztorysie „bez ceny" | etap 4 |

## Architektura

`src/geometry/jointSolver.js` (czysty, bez Three.js i bez DXF) — `buildJointModel({stringerModels,
stringerConstruction, postModels})` → `{ joints, pocketsByPost, diagnostics }`. Każdy konsument rysuje te SAME dane:

- **3D**: `postRenderer.js` — słup z gniazdami = prostopadłościan minus prostopadłościany gniazd
  (`geometryUtils.js buildBoxWithBoxPockets`: siatka komórek, emitowane tylko ściany zewnętrzne — bez CSG).
- **DXF słupa**: `dxfExport.js buildPostDXF(post, pockets)` / `buildAllPostsDXF(posts, pocketsByPost)` — rozwinięcie
  4 lic (S, E, N, W — idąc dookoła słupa; prawa krawędź lica = lewa następnego), każde szerokości przekroju i długości
  słupa, gniazda na swoich licach z głębokością i wysokością od dołu słupa (`otwarte u góry/dołu`, gdy wanga wystaje
  poza słup), obok rzut przekroju z literami lic i gniazdami.
- **DXF wangi**: linia lica słupa w poprzek deski + „wręg gł. N mm" (warstwa `JOINTS`).
- **Walidacja**: diagnostyki złączy trafiają do bramki kosztorysu (`validationGate.js`).

Kierunek zależności: długość deski przy słupie ustala `stringerConstructionGeometry.js` (`ends.*.intoPost`), a
jointSolver tylko wyprowadza z niej, co trzeba wyfrezować w DRUGIM elemencie — bez cyklu.

Lica słupa nazwane kierunkiem normalnej w rzucie: E (+x), N (+y), W (−x), S (−y). Współrzędna `s` na licu rośnie w
prawo dla patrzącego na lico z zewnątrz (0 = oś słupa), `z` = wysokość w świecie.

## Etap 1 (zrobiony): wanga ↔ słup — wręg pełnym przekrojem

- `config.postHousingDepthMm` (UI „Wręg wangi w słupie [mm] (0 = do lica)"; katalog `CO-MFG-J-POST-HOUSING`).
  `stringerModel.js postHousingDepthMm(config)` — jedno źródło; brak pola w starszym projekcie = 0 (jak dawniej).
- Wanga przy słupie (start/zakręt/koniec) kończy się `depth` ZA licem słupa (`ends.start/end.intoPost =
  {postId, faceU, depthMm}`); wpusty stopni dalej obcięte do lica; kotwy profilu dalej na licu.
- Gniazdo: prostokąt w licu — szerokość = grubość wangi (pas od linii łańcucha do +grubość, rzutowany na oś lica),
  wysokość = zakres przekroju wangi na całej głębokości wejścia (`vRangeWithin` konturu), przycięty do wysokości słupa.
- Diagnostyki (WARNING): `JOINT-POST-POCKETS-OVERLAP` (gniazda spotykają się wewnątrz słupa — np. wręg ≥ połowy
  przekroju na sąsiednich licach słupa narożnego), `JOINT-POST-FACE-SKEW` (wanga pod kątem > 5° do lica),
  `JOINT-POST-POCKET-OUTSIDE` (wanga nie trafia w słup / jest szersza niż lico).
- Kosztorys: deska wangi jest dłuższa o głębokość wręgu na każdym końcu przy słupie (kontur).

## Etap 2 (zrobiony): stopnie i podstopnie ↔ słup

**Zasada obowiązująca (decyzja użytkownika 2026-09-28, zastępuje opis niżej):** końcówkę stopnia frezujemy jak
najmniej, stopień ma mieć jak największe podparcie i wchodzić w słup (lub wangę) możliwie szeroko. Na KAŻDYM słupie
konstrukcyjnym (początkowym, końcowym, narożnym) stopień dostaje jedno proste wycięcie wokół słupa i jeden czop: na licu,
o które opiera się najbardziej (największy styk z pasem lica na całej jego szerokości), na pełnej szerokości stopnia w
tym miejscu, na głębokość `postTreadHousingDepthMm`; na pozostałych licach cięty równo. Gniazdo w słupie = szerokość
czopa × grubość stopnia × głębokość. Nie ma już czopów na kilku licach (dawna zasada słupków początkowego/końcowego)
ani czopa tylko w środkowej części lica (dawna zasada słupa narożnego — zostawiała drobne „schodki”). **Podstopień**
nie jest nośny: tylko wycięty równo z licami słupa, bez gniazda (złącze `RISER_POST_CUT`). Poniżej — opis wcześniejszej
wersji.

- `config.postTreadHousingDepthMm` (UI „Wpust stopnia/podstopnia w słup [mm]"; katalog `CO-MFG-J-POST-TREAD-HOUSING`;
  20 mm DO WERYFIKACJI; 0 = element wycięty równo z licem słupa, bez gniazda). `jointSolver.js postTreadHousingDepthMm`
  (nigdy przez słup: najwyżej połowa przekroju − 1 mm).
- Każdy stopień i każdy panel podstopnia, który w rzucie i na wysokości przechodzi przez słup konstrukcyjny (nie
  słupek balustrady), jest **wycinany wokół słupa**: obrys minus „rdzeń" słupa (kwadrat słupa zmniejszony o głębokość
  wpustu) — `polygonClip.js subtractConvex` (Weiler–Atherton dla wypukłej dziury, bez zależności). To, co zostaje
  w pasie między licem a rdzeniem, to czop wchodzący w gniazdo.
- **Słup narożny — bez „widelca"** (decyzja użytkownika 2026-09-28): element jest cięty RÓWNO z licami słupa i dostaje
  JEDEN czop — na licu, o które opiera się najbardziej, tylko w środkowej części lica (bez pasów przy narożnikach
  słupa), więc nigdy nie obejmuje narożnika cienkimi zębami. Brak styku ze środkową częścią lica = cięcie równo, bez
  czopa. (`jointSolver.js removalAtPost`; słupki początkowy/końcowy bez zmian — tam stopień obejmuje słup z trzech
  stron bez cienkich zębów.) `polygonClip.js cleanPolygon` usuwa zdublowane i współliniowe wierzchołki po kolejnych
  odejmowaniach.
- **Gniazdo** na każdym licu, przez które przechodzi element (`clipToConvex` z pasem lica): szerokość = zakres
  przejścia na osi lica, wysokość = grubość stopnia / wysokość podstopnia, głębokość = parametr (`kind: 'tread'|'riser'`,
  opis „stopien N" / „podstopien N").
- Słup może rozciąć stopień na części — zostaje większa. Mały odcięty kawałek (np. wąski koniuszek stopnia zabiegowego
  za słupem narożnym, ok. 0,5 % stopnia) jest po prostu odcinany (`treadCuts[*].droppedMm2`); ostrzeżenie
  `JOINT-TREAD-SPLIT` dopiero od 5 % stopnia (próg z oceny, nie ze źródła). Stopień prawie cały w słupie:
  `JOINT-TREAD-INSIDE-POST`. Słup stojący wewnątrz stopnia (np. podestu) daje otwór (`holes`).
- Konsumenci: `treadRenderer.js` (wycięty obrys, otwory, wycięty wpust pod podstopień), `riserRenderer.js` (wycięty
  panel jako pionowy graniastosłup), `postRenderer.js` (gniazda), DXF stopnia (`buildTreadDXF(tread, joint)` — wycięty
  obrys, obrys słupa na warstwie JOINTS, wiersz „Wyciecie wokol slupa …, wpust w slup gl. N mm"; `treadJointsByStep`),
  DXF słupa (gniazda stopni i podstopni na rozwinięciu). Ostrzeżenie o nachodzących gniazdach dotyczy tylko gniazd wang
  (stopień obejmujący narożnik słupa ma gniazda na dwóch licach z definicji).
- Stopień wycięty wokół słupa z rowkiem pod podstopień: spód poniżej wysokości rowka = wycięty obrys minus pas rowka
  (`treadCuts[*].undersides`) — nosek zachowuje pełną grubość stopnia (poprawka 2026-09-28).
- Ograniczenia: rowek pod zakładkę podstopnia w DXF stopnia (`treadNotchEntities`) jest rysowany z niewyciętego
  obrysu; kosztorys liczy powierzchnię/formatkę stopnia jak dotąd (wycięcie jest niewielkie).

## Etap 3 (zrobiony): wanga ↔ wanga — doczołowo we wręg (narożnik bez słupa)

`stringerConstructionGeometry.js computeOpenCornerExtensions` (każde złącze `LAP_JOINT`, którego linie łańcucha się
spotykają) — deska PRZED narożnikiem (A) przechodzi, deska za nim (B) dochodzi do niej:
- **narożnik wypukły** (zewnętrzna wanga na zakręcie — B odchodzi w stronę wewnętrznej normalnej A): A kończy się
  dokładnie w zewnętrznym narożniku, B zaczyna się na WEWNĘTRZNYM licu A minus głębokość wręgu (`ends.start.butt =
  {intoSegmentId, depthMm, faceU, housed: true}`), a w wewnętrznym licu A powstaje wręg `kind: 'butt'` na szerokość
  grubości B i wysokość przekroju B na głębokości wejścia (`addButtHousings`, po zbudowaniu wszystkich desek; dla wangi
  nakładanej górna krawędź z konturu). Głębokość = `housingDepthMm` (ta sama co wpust stopnia w wangę — rysowana tą
  samą techniką warstw; bez nowej niezweryfikowanej liczby).
- **narożnik wklęsły** (wewnętrzna wanga po usunięciu słupa narożnego): A przechodzi o grubość za narożnik (przykrywa
  kwadrat narożnika), B dochodzi do niej równo, bez wręgu (wręg musiałby być w ZEWNĘTRZNYM licu A — nieobsługiwane).
- Wcześniej obie deski dochodziły do narożnika (albo, przy wyłączonym „Słupie na zakręcie", obie wychodziły o grubość
  za niego — pierwsza wystawała poza zewnętrzne lico drugiej) i w rzucie nachodziły na siebie kwadratem 40 × 40 mm.
- DXF wangi: wręg w A opisany „wreg pod wange B gl. N mm", na B linia lica A „lico wangi A - wreg gl. N mm" (warstwa
  JOINTS). Model złączy: `STRINGER_STRINGER_BUTT` (lista pod etap 4). Profil edytora rysuje wręg jak każde gniazdo.

## Etap 4 (zrobiony): łączniki (śruby schodowe) złączy wang

`src/geometry/jointConnectors.js` (czysty), wywoływany na końcu `buildJointModel` → `connectors`, `holesByPost`,
`holesBySegment`, `postWeakening` (+ diagnostyki). Skręcane są złącza **wanga ↔ słup** (`STRINGER_POST_HOUSING`) i
**wanga ↔ wanga** (`STRINGER_STRINGER_BUTT`); stopnie/podstopnie w gniazdach słupa — nie (klejone, poza zakresem).

- **Parametry** (wszystkie DO WERYFIKACJI, katalog `CO-MFG-J-CONNECTORS`; UI w folderze konstrukcji):
  `jointConnectorCount` 2 (0 = bez łączników), `jointConnectorSpacingMm` 120 (w pionie, symetrycznie względem środka
  przekroju wangi na licu złącza), `jointConnectorDiameterMm` 10 (M10 = otwór), `jointConnectorBoardDepthMm` 100 (od
  lica złącza w głąb wangi do środka gniazda nakrętki), `jointConnectorNutBoreMm` 30 (gniazdo nakrętki w licu
  wewnętrznym wangi), `jointConnectorPostMode` `'through'` (przez cały słup, podkładka/zaślepka po drugiej stronie) /
  `'blind'` + `jointConnectorPostDepthMm` 60 (od lica). Starszy projekt bez tych pól = bez łączników.
- **Wanga ↔ słup**: otwór na licu z gniazdem (środek grubości wangi), przy `through` wyjście na licu przeciwnym (`s`
  lustrzane); w wandze oś od czoła (dno gniazda) do gniazda nakrętki. Długość śruby = cała oś: `przekrój słupa +
  głębokość w wandze` (przelotowo) albo `głębokość w słupie + głębokość w wandze` (ślepo).
- **Wanga ↔ wanga**: przez deskę A (od jej lica zewnętrznego, w kierunku B) — w A otwór poprzeczny (okrąg), w B oś od
  czoła do gniazda nakrętki; długość = grubość A wzdłuż B + głębokość w B.
- **Wysokości otworów to decyzja solvera**: środek przekroju; jeśli otwory przecięłyby otwory innego złącza w tym samym
  słupie (dwie deski wchodzące w sąsiednie lica słupa narożnego na prawie tej samej wysokości — np. z podstopniami),
  cała grupa przesuwa się w górę/dół krokami d/2, najwyżej o rozstaw, do najbliższej wysokości, która je omija i trzyma
  odległość od krawędzi (`shiftMm` w łączniku). Nie da się → zostaje na środku i jest ostrzeżenie.
- **Kontrola (WARNING, przez bramkę kosztorysu)**: `JOINT-CONNECTOR-EDGE` (bliżej niż 3d od krawędzi wangi / końca
  słupa — EN 1995-1-1 tab. 8.4, a4,c = 3d dla śrub, przytoczone z pamięci, DO WERYFIKACJI; np. wanga nakładana ma przy
  słupku początkowym tylko ~135 mm przekroju, więc 2 śruby co 120 mm się nie mieszczą), `JOINT-CONNECTOR-CLASH`
  (otwory krzyżują się w słupie), `JOINT-CONNECTOR-SPACING` (gniazda nakrętek nachodzą na siebie),
  `JOINT-CONNECTOR-SHORT` (łącznik ślepy nie sięga za wręg), **`JOINT-POST-WEAKENED`** — osłabienie słupa: na każdej
  wysokości otworu/gniazda przekrój netto = przekrój − gniazda (szer. × głęb.) − otwory (Ø × długość), nakładania
  liczone podwójnie (bezpiecznie); poniżej 50 % (próg z oceny, do weryfikacji) ostrzeżenie; najsłabsze miejsce każdego
  słupa w `postWeakening`.
- **DXF**: słup — okrąg na licu dla każdego otworu (z opisem i wysokością od dołu), oś otworu w przekroju, w tytule
  liczba otworów i najsłabszy przekrój netto; wanga — oś otworu + okrąg gniazda nakrętki (albo okrąg otworu
  przelotowego), liczba otworów w tytule (warstwa JOINTS).
- **Kosztorys**: `takeoff/connectorItems.js` — pozycja `CONNECTOR` na złącze, ilość = liczba śrub, „Śruba schodowa
  M10 × L", materiał `joint-connector` **bez ceny** (brak w cenniku — koszt pusty, podsumowanie „Łączniki (bez ceny)"
  liczy je jako niewycenione), bez objętości drewna (ciężar własny ich nie liczy).
- **Warstwa 3D „Złącza (gniazda, śruby)”** (HUD widoku 3D, domyślnie wyłączona): gniazda w słupach i wangach,
  otwory na śruby i gniazda nakrętek — to samo, co zaznaczają DXF-y — rysowane półprzezroczyście przez drewno.
  Dane: `geometry/jointMarkers.js` (czysty), rysowanie: `scene/jointMarkersOverlay.js` (osobna grupa, poza modelem —
  nie trafia do eksportu OBJ/DAE).
- Ograniczenia: otwory nie są wycinane w bryłach 3D (tylko pokazywane warstwą „Złącza”); nie sprawdza, czy otwór trafia w gniazdo stopnia/podstopnia
  w słupie; jeden rodzaj łącznika i wspólne parametry dla wszystkich złączy; bez nośności łącznika.

Testy: `src/geometry/__tests__/jointSolver.test.js`, `jointConnectors.test.js` (etap 4 — test „holes of different
joints never cross" nie przechodzi bez przesuwania grup), `src/export/__tests__/dxfExport.test.js` (DXF słupa i wangi),
`postsAndWangi.test.js` / `stringerProfile.test.js` (wanga wchodzi w słup dokładnie na głębokość wręgu),
`polygonClip.test.js`, `treadPostJoints.test.js` (etap 2).
