# Zabiegi rozkładane od linii biegu (etap C)

Decyzja użytkownika z 2026-10-02 (wzorem StairDesignera 7.18): linia biegu to prawdziwy łuk wokół narożnika duszy, a
każda krawędź stopnia zabiegowego jest zaczepiona na swoim punkcie tej linii. Metoda obowiązuje we **wszystkich**
projektach, również wczytanych ze starych plików. Dawna metoda proporcjonalna została tylko jako awaryjna, gdy łuk nie
mieści się w zabiegu.

## Geometria (`src/geometry/winderArc.js`, czysta funkcja)

Układ lokalny jest taki sam jak w `planLayout.js`:
- +y to kierunek wejścia, +x to kierunek wyjścia po skręcie w prawo;
- x = 0 to linia zewnętrzna (ściana), x = W to dusza;
- narożniki: duszy Ic = (W, Yc), ściany Oc = (0, Yc + W).

- **Linia biegu** biegnie w odległości `off = walklineOffset` od duszy:
  - prosta x = W − off,
  - **ćwiartka łuku o promieniu off wokół Ic**,
  - prosta y = Yc + off.
- **Strefa zabiegu** to `windersPerTurn` równych odcinków *mierzonych na linii biegu* (Lw = n·g). Wartość
  `walklineSplitOffset` (`before`) mówi, ile z nich leży przed środkiem łuku (punktem na przekątnej narożnika). Jest
  ograniczona do [π·off/4, Lw − π·off/4], żeby cały łuk mieścił się w strefie. Połowa Lw daje zabieg symetryczny.
- **Krawędź k** przechodzi przez dwa punkty:
  - swój punkt linii biegu (równe biegi na linii biegu wynikają z konstrukcji);
  - swój punkt na duszy. Końce przy duszy rozkładają się równo na całej linii duszy w strefie (przez narożnik), więc
    każdy zabieg ma tę samą szerokość przy duszy: g·(Lw − π·off/2)/Lw. Przy domyślnych wartościach 144 mm, a dawna
    metoda dawała 110.

  Oba ciągi punktów rosną monotonicznie, więc krawędzie nie przecinają się między duszą a linią biegu. W zabiegu
  symetrycznym krawędź środkowa przechodzi dokładnie przez Ic i Oc.
- **Kotwice biegu.** Bieg zaczynający się zabiegiem (0 prostych przed nim) zaczyna strefę w narożniku (before =
  π·off/4). Bieg kończący się zabiegiem kończy ją w narożniku. Słup startowy lub końcowy jest wtedy tym samym słupem
  co narożny (`postSolver.js`), jak w starej metodzie.
- **Gdy łuk się nie mieści** (Lw − π·off/2 < 1 mm, off ≥ W): `planLayout.js buildTurnLocalProportional`, czyli
  dawny kod. Rodzaj metody zapisuje `turns[].method`: `'walkline-arc'` albo `'proportional'`.
- **Pierwsza próba (odrzucona):** wszystkie końce przy duszy przed środkiem łuku zbiegały się w Ic, czyli czysty
  wachlarz w narożniku. Przy małej wartości `before` dawało to stopnie-trójkąty o zerowej szerokości przy duszy (np.
  w projekcie U użytkownika: 0 prostych na starcie, 3 zabiegi). To psuło nosek, wpust i złącza przy słupie.

## Linia biegu jako dane

`planLayout.walkline = { path, points }`:
- `path` to droga do rysowania, z łukiem rozbitym na cięciwy co 3°;
- `points` to jeden punkt linii biegu na każdej granicy stopni, a `null` tam, gdzie go nie ma.

Działa to dla schodów prostych, zabiegów, podestów (ta sama ćwiartka łuku), U, „1 dużego podestu” (punkt między
połówkami usunięty) i dla skrętu w lewo (odbicie lustrzane).

Korzystają z niej:
- plan 2D: rysuje `path`, numery stopni stawia między punktami, a `smoothPath.js` został usunięty;
- edytor krawędzi (`plan2d/edgeEdit.js`): punkt zaczepienia krawędzi to `points[i]`.

## Pomiar szerokości zabiegu (PL-LEGAL-C-01) — poprawiony

`walklineModel.js offsetLineFromInner(planLayout, D)` wyznacza linię w odległości D od duszy (`innerFullPath`):
- proste odsunięte do środka schodów;
- **łuk o promieniu D** wokół narożnika, który schody obchodzą;
- przecięcie odsuniętych prostych, gdy linia skręca do środka schodów.

Każdą krawędź stopnia przecinamy z tą linią. Przepis mówi o szerokości mierzonej 0,4 m od duszy, a dla D =
`walklineOffset` wychodzi dokładnie linia biegu z planu (różnica do 0,13 mm wynika z cięciw łuku). Dawny pomiar brał
punkt 400 mm *wzdłuż* krawędzi od jej końca przy duszy. Na ukośnej krawędzi zabiegu ten punkt leży bliżej duszy, więc
domyślne L dostawało fałszywe błędy (233 mm zamiast ok. 267). Dawny pomiar został tylko jako zapas, gdy krawędź nie
dochodzi do linii.

## Skutki w innych miejscach

- **Wanga wpuszczana** (`stringerProfileSolver.js throatBelowReference`): długi, płaski bok zewnętrzny zabiegu
  obchodzącego narożnik ściany daje płaski odcinek profilu (np. 17°). Przy minimalnej głębokości dolna krawędź deski
  nie sięgała tam pod tylny dolny narożnik stopnia. AUTO pogłębia deskę do Δv·Δu/długość odcinka + 1 mm i zgłasza to
  jako `STRINGER-DEPTH-FOR-SUPPORT` (INFO). Minimalna głębokość to minimum, a stopień nigdy nie zostaje bez podparcia.
- **Dopasowanie do klatki** (`stairwellFit.js sideVsCount`): bok rośnie o jedną głębokość na każdy stopień prosty,
  ale nie między 0 a 1 stopniem, bo przy 0 strefa jest zakotwiczona w narożniku. Pierwsza liczba jest więc mierzona
  osobno. Wynik sprawdzono brute force na wszystkich wariantach.
- **Szkło między słupkami** (`railingGlass.js intermediatePostSplits`): podział przęsła liczy się teraz z cieńszym
  słupkiem. Z grubszym tafla między dwoma cieńszymi słupkami wychodziła 1806 mm zamiast maksymalnie 1800. Był to
  istniejący wcześniej błąd, który ujawniła nowa długość środkowego biegu U (1916 mm).
- **Podstopnie:** skrajne punkty wachlarza paneli to dokładnie punkty krawędzi, bez błędu interpolacji. W zabiegu
  symetrycznym obie strony krawędzi skręcają razem, więc rozbieżność kierunków wynosi 0. W asymetrycznym
  rozbieżność może się pojawić i wtedy obsługuje ją ten sam wachlarz co wcześniej.
- **Słup narożny** nie odcina już „czubka” zabiegu, bo żaden stopień nie traci kawałka.

## Ograniczenia

- Przy bardzo wąskiej duszy (ok. 10 mm, np. 3 zabiegi × 220 mm) i ukośnych krawędziach wpust wangi wpuszczanej
  przesuwa sąsiednie narożniki tak, że kolejność oparcia na wandze się odwraca (1155 → 1152 mm). Żaden kontur stopnia
  się nie przecina: sprawdzono 624 konfiguracje. Taką konfigurację i tak zgłasza kontrola minimalnej szerokości przy
  duszy.
- 2 zabiegi na skręt nie mieszczą łuku. Wtedy działa metoda awaryjna, która przy domyślnym przesunięciu jest
  geometrycznie niewykonalna i w części konfiguracji wywraca budowę wangi. To błąd z wcześniejszego kodu (24 takie
  przypadki na starym kodzie, 14 teraz), poza zakresem tego etapu.
- Rozkład końców przy duszy jest równy (każdy zabieg ma tę samą szerokość przy duszy). Inne metody wyrównania, np.
  stopniowe poszerzanie od narożnika, nie są zrobione.

Testy: `geometry/__tests__/winderArc.test.js`. Obejmują:
- łuk;
- równe biegi;
- równe szerokości przy duszy;
- krawędź środkową przez oba narożniki;
- kotwice;
- metodę awaryjną;
- linię biegu jako dane;
- siatkę prostych konturów;
- pogłębienie wangi (potwierdzone, że bez poprawki nie przechodzi);
- pomiar 400 mm od duszy (potwierdzone, że ze starym pomiarem nie przechodzi).
