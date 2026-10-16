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
- **Gdy łuk się nie mieści** przy ustawionym odsunięciu (Lw − π·off/2 < 1 mm, np. 2 zabiegi × 270 mm przy 400 mm,
  gdzie sama ćwiartka łuku ma 628 mm), zabieg jest rozkładany na linii biegu przysuniętej do duszy
  (`winderArc.js fittingWalklineOffset`). Jest to największe odsunięcie, przy którym łuk się mieści i zostaje
  `minInnerWidth` przy duszy na każdy zabieg (albo pół strefy, jeśli i to się nie mieści). Odsunięcie użyte
  naprawdę zapisuje `turns[].walklineOffsetMm`. Walidacja zgłasza to jako ostrzeżenie `WINDER-WALKLINE-MOVED`
  (`validator/checks.js checkWalklineMovedInTurn`), a `checkTurnFeasibility` uznaje skręt za niewykonalny i podaje
  komunikat z tą wartością. Wcześniej działała tu metoda proporcjonalna: z niewykonalnymi parametrami zawracała
  końce przy duszy (900 → 770 → 640 mm), a budowa wangi się wywracała. Teraz `buildTurnLocalProportional` zostaje
  tylko dla niepoprawnych danych (0 zabiegów, zerowa głębokość). Rodzaj metody zapisuje `turns[].method`.
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
- edytor krawędzi (`plan2d/edgeEdit.js`): punkt zaczepienia krawędzi to `points[i]`. Końce krawędzi zabiegu
  przesuwają się po CAŁEJ linii (także za narożniki duszy strefy 180°); obrys obu stopni jest wtedy przycinany na nowo
  wzdłuż linii (`edgeOverrides.js outlineRecutter`) — narożnik linii przechodzi do stopnia, w którym teraz leży,
  krzyżujące się krawędzie dają trójkąt do punktu przecięcia. Przy wangach na sobie (odstęp osi < grubość) odcinek
  duszy biegnie wstecz WEWNĄTRZ schodów, więc krawędź może go przeciąć; przy szerszym odstępie przecięcie odcinka duszy
  (przez otwór) jest odrzucane. Zakres ruchu ogranicza nadal obrót wokół punktu na linii biegu i sąsiednie krawędzie
  (10 mm) — swobodnie: Alt.

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
- **Naprawione (2 zabiegi na skręt):** skręt, w którym łuk ledwo się mieści, a biegu nie ma przed lub za zabiegiem,
  zostawiał kilkanaście milimetrów linii duszy między słupem narożnym a startowym lub końcowym. Słupy na siebie
  nachodziły, a deska wangi między nimi miała ujemną długość, przez co budowa się wywracała. Teraz:
  - słup startowy lub końcowy, który *nachodzi* na narożny (a nie tylko stoi w tym samym punkcie), nie jest stawiany
    (`postSolver.js`);
  - deska mieszcząca się w całości między licami słupów nie powstaje (`stringerSolver.js MIN_BOARD_SPAN_MM`), bo
    stopnie nad nią niesie słup.

  Przeskanowano 5832 konfiguracje: L/U, lewo/prawo, 2–4 zabiegi, długości biegów 0/1/3, głębokości 180/270/320,
  odsunięcia 250/400/500, ze słupem narożnym i bez. Wynik: 0 wywrotek, 0 przecinających się konturów.
- W U, w którym środkowy bieg ma 0 stopni, a łuk ledwo się mieści, dwa słupy narożne mogą częściowo na siebie
  nachodzić. Nie są scalane. Taka dusza i tak nie spełnia minimalnej szerokości.
- Rozkład końców przy duszy jest równy (każdy zabieg ma tę samą szerokość przy duszy). Inne metody wyrównania, np.
  stopniowe poszerzanie od narożnika, nie są zrobione.

Testy: `geometry/__tests__/winderArc.test.js`. Obejmują m.in. przysunięcie linii biegu i ostrzeżenie oraz brak
wywrotki przy 2 zabiegach (sprawdzone, że na starym kodzie nie przechodzi). Pozostałe przypadki:
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

## Jedna klatka zabiegowa 180° (U bez stopni w biegu B)

Decyzja użytkownika 2026-10-14: w schodach U, w których bieg B nie ma stopni prostych, a oba zakręty są zabiegowe, oba
zakręty mogą być **jedną klatką zabiegową** z dowolną łączną liczbą zabiegów, wokół **jednego słupa środkowego**.
Odstęp biegów A i C ustawia się jako **rozstaw osi wewnętrznych wang A i C**; 0 oznacza wangę C dokładnie nad wangą A
(jedna płaszczyzna, oba wchodzą w ten sam słup). Włącza się to opcją (domyślnie wyłączone — zostają dwa zakręty jak
dotąd).

- Konfiguracja: `uSingleWinderZone` (przełącznik), `uWindersTotal` (łączna liczba zabiegów), `uAxisGapMm` (rozstaw
  osi). Stosowane tylko, gdy `stairType = 'U'`, `treadsLegB = 0` i oba zakręty są `winder` (`winderArc.js
  isHalfTurnU`); wtedy `windersPerTurn` nie gra roli.
- Geometria (`winderArc.js halfTurnWinderGeometry`, układ lokalny jak dla ćwiartki, skręt w prawo): A idzie w +y z
  linią wewnętrzną x = W; C wraca w −y z linią wewnętrzną x = W + g, gdzie g = rozstaw osi − grubość wangi (ujemne,
  gdy osie są bliżej niż grubość deski: stopnie C sięgają wtedy nad stopnie A, pół kondygnacji wyżej). Linia biegu:
  prosta `walklineOffset` od linii A, **półokrąg** wokół środka duszy o promieniu `walklineOffset + g/2`, prosta
  `walklineOffset` od linii C. Strefa zabiegów to `uWindersTotal` równych odcinków na linii biegu, **zawsze
  wyśrodkowana na półokręgu** (także gdy A albo C nie ma stopni prostych — przypięta do narożnika strefa dawałaby
  krawędzie przecinające pierwszą/ostatnią krawędź schodów). Każda krawędź przechodzi przez swój punkt linii biegu i
  swój punkt na linii wewnętrznej; końce przy duszy rozłożone równo wzdłuż linii A, odcinka duszy i linii C (każdy zabieg
  ma tę samą szerokość przy duszy). Gdy półokrąg się nie mieści, linia biegu jest przysuwana do duszy
  (`fittingHalfTurnOffset`, jak przy ćwiartce).
- Rzut (`planLayout.js buildHalfTurnLocal`): jeden zakręt `turns[0]` z `halfTurn: true`, `innerCorners`/`outerCorners`
  (po dwa narożniki), `centre` (środek półokręgu), `postSpots`. Stopień przy środku duszy, którego krawędzie przednia i
  tylna przecinają się (dusza zachodząca, g < 0), ma zarys od punktu przecięcia — leży on w słupie, który i tak ten
  stopień wycina.
- Słup (`postSolver.js`): **jeden słup środkowy** na osiach wang — w połowie między osią A i C, pół grubości deski od
  linii duszy — gdy obejmuje obie wangi (rozstaw osi ≤ przekrój słupa − grubość wangi). Przy szerszym rozstawie stoją
  **dwa słupy**, po jednym na każdym narożniku duszy, a między nimi deska duszy. Słup środkowy należy do obu narożników
  (`anchors`): wanga wewnętrzna A kończy się w nim, wanga C z niego wychodzi (`stringerSolver.js boardEndPosts`,
  `cornerPostIdAt`).
- Pomiar szerokości zabiegu 0,4 m od duszy (`walklineModel.js offsetLineRoundHalfTurn`): linia odsunięta to proste
  przy A i C i półokrąg wokół środka duszy.
- Dopasowanie do klatki (`stairwellFit.js`) przy tej opcji nie dokłada stopni do biegu B, a gdy podany jest bok B,
  **wylicza rozstaw osi** tak, żeby B wyszedł dokładnie: B = 2 × szerokość biegu + rozstaw osi − grubość wangi (np.
  szerokość 920, B = 1886 → rozstaw 86 mm); `uAxisGapMm` jest wtedy AUTO.
- Poprawki we wspólnym kodzie, których ten układ wymagał (każda z testem, który nie przechodzi na starym kodzie):
  - narożnik, w którym linia zawraca (linie A i C się pokrywają), jest narożnikiem (`pathUtils.js
    goesStraightThrough`);
  - cofanie końca stopnia przy wandze wpuszczanej liczone w stronę WŁASNEJ krawędzi stopnia (`edgeOverrides.js`), a
    dwa narożniki w jednym punkcie dostają w zarysie kolejno swoje miejsca; dla zwykłych schodów wynik bez zmian
    (1080 układów porównanych bit w bit);
  - deska wangi niosąca tylko stopnie zaczęte na poprzedniej desce dostaje węzeł profilu
    (`stringerConstructionGeometry.js buildPitchKnots`).

**Wangi jedna nad drugą** (rozstaw osi mniejszy niż grubość wangi): wangi A i C leżą w jednym pasie rzutu i przy
słupie zachodzą na siebie wysokością — górna krawędź A jest wyżej niż dolna krawędź C. Decyzja użytkownika 2026-10-14
(wariant 2): **nie są docinane automatycznie**. `stackedStringers.js checkStackedInnerStringers` porównuje górną
krawędź A z dolną krawędzią C na całej wspólnej długości (co 10 mm; przy wandze nakładanej A doliczona grubość
stopni leżących na niej) i zgłasza WARNING `STRINGER-STACKED-OVERLAP` na wandze C — ile milimetrów i gdzie — z
podpowiedzią: obniżyć górną krawędź A albo podnieść dolną krawędź C punktami na licu słupa w edytorze „Profil wangi”.
Ogólne `JOINT-POST-POCKETS-OVERLAP` nie jest dla dwóch desek wchodzących w tę samą ścianę słupa zgłaszane (jego rada —
płytszy wręg, grubszy słup — tu nie pomaga).

Testy: `geometry/__tests__/halfTurnU.test.js`. Zakres: kiedy opcja działa, rozstaw osi, równe biegi na półokręgu,
szerokość przy duszy, szerokość 0,4 m od duszy, słup środkowy i dwa słupy, odbicie dla skrętu w lewo, rozstaw równy
grubości wangi, krótka deska duszy, dopasowanie do klatki, oferta, strzałka kierunku na planie. Skan 768 konfiguracji
(prawo/lewo, rozstaw 0/40/120/300, A 0/2/4, C 0/3, 4–10 zabiegów, wangi wpuszczane/nakładane, balustrada po obu
stronach): 0 wywrotek, 0 przecinających się konturów; zostają ustalenia o zbyt stromej/płytkiej wandze przy bardzo małej
liczbie zabiegów albo bez stopni prostych w A i C.
