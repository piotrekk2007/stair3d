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

- `config.postTreadHousingDepthMm` (UI „Wpust stopnia/podstopnia w słup [mm]"; katalog `CO-MFG-J-POST-TREAD-HOUSING`;
  20 mm DO WERYFIKACJI; 0 = element wycięty równo z licem słupa, bez gniazda). `jointSolver.js postTreadHousingDepthMm`
  (nigdy przez słup: najwyżej połowa przekroju − 1 mm).
- Każdy stopień i każdy panel podstopnia, który w rzucie i na wysokości przechodzi przez słup konstrukcyjny (nie
  słupek balustrady), jest **wycinany wokół słupa**: obrys minus „rdzeń" słupa (kwadrat słupa zmniejszony o głębokość
  wpustu) — `polygonClip.js subtractConvex` (Weiler–Atherton dla wypukłej dziury, bez zależności). To, co zostaje
  w pasie między licem a rdzeniem, to czop wchodzący w gniazdo.
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
- Ograniczenia: rowek pod zakładkę podstopnia w DXF stopnia (`treadNotchEntities`) jest rysowany z niewyciętego
  obrysu; kosztorys liczy powierzchnię/formatkę stopnia jak dotąd (wycięcie jest niewielkie).

## Etapy następne

3. **Wanga ↔ wanga** (narożnik bez słupa, zawsze zewnętrzna wanga na zakręcie): doczołowo we wręg. Dziś obie deski
   dochodzą do zewnętrznego narożnika i w rzucie nachodzą na siebie kwadratem grubość × grubość.
4. **Łączniki**: liczba/rozstaw jako parametry, otwory na DXF wangi i słupa, pozycje w kosztorysie; kontrola
   osłabienia słupa.

Testy: `src/geometry/__tests__/jointSolver.test.js`, `src/export/__tests__/dxfExport.test.js` (DXF słupa i wangi),
`postsAndWangi.test.js` / `stringerProfile.test.js` (wanga wchodzi w słup dokładnie na głębokość wręgu),
`polygonClip.test.js`, `treadPostJoints.test.js` (etap 2).
