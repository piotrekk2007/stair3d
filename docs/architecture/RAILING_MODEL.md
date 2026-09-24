# Balustrada (poręcz + tralki) — plan wdrożenia

Status: **zaplanowane, jeszcze niezaimplementowane.** Decyzje z użytkownikiem są na końcu.

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
- Zakręt (etap 2): poręcz jako łamana z prostych odcinków, ze skosami po każdym stopniu zabiegowym; słupek w narożniku. Poręcz gięta poza zakresem.
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

## Do zweryfikowania przy starcie etapu 1

- gdzie dokładnie leży wanga względem `outerChain`/`innerChain` (przesunięcie poprzeczne balustrady od osi wangi)
- na którym stopniu leży pierwsza/ostatnia tralka, gdy odcinek kończy się w środku biegu (słupek końcowy)
