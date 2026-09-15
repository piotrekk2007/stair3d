# Matematyczny model danych schodów — stair3d

Status: **specyfikacja projektowa. Brak implementacji, brak UI.** Ten dokument jest wejściem
do przyszłego refaktoru `src/geometry/` i `src/config/schema.js`, nie zamianą ich.

## 0. Wejścia do tego projektu

Ten model powstał jako bezpośrednia konsekwencja dwóch wcześniejszych dokumentów tej sesji
projektowej:

- **[docs/rules/TECHNICAL_RULES_CATALOGUE.md](../rules/TECHNICAL_RULES_CATALOGUE.md)** —
  wymusza, żeby model danych miał osobne, nazwane pola dla wielkości regulowanych prawnie
  (np. `treadGoing`, `riserHeight`, `stairWidth`, szerokość stopnia zabiegowego w konkretnym
  punkcie) — reguła walidacji musi mieć DO CZEGO się odwołać po nazwie pola, nie po pozycji w
  tablicy punktów.
- **[docs/architecture/STAIR_SOFTWARE_BENCHMARK.md](../architecture/STAIR_SOFTWARE_BENCHMARK.md)**
  — potwierdza zewnętrznie (sekcje C, F, G, L tamtego dokumentu) trzy fundamentalne decyzje
  przyjęte tutaj: (1) 2D jako jedyne źródło prawdy, 3D jako projekcja; (2) każdy typ elementu
  konstrukcyjnego jako osobny obiekt logiczny, nie jedna uniwersalna struktura; (3) rozdzielenie
  "geometrii odniesienia" od "geometrii styku" dla każdego elementu, który ma obie te role
  (zasada 19 tamtego dokumentu).

Ten dokument **rozszerza** (a w jednym miejscu **koryguje nazewnictwo** — patrz §2.4) model
`StringerModel`/`stringerSolver.js` zaprojektowany i przetestowany w poprzedniej sesji. Nie
zastępuje go — `StringerReferenceGeometry`/`StringerTreadBearingGeometry` stamtąd odpowiadają
tu `Stringer.segments[].referenceLine` / `StringerSupport` (§4.7–4.8).

---

## 1. Fundamentalna zasada

> **2D jest źródłem prawdy. 3D jest generowane z modelu 2D + wysokości.**

Formalnie: niech `M2D` będzie kompletnym, rozwiązanym modelem płaskim (§4: `Staircase` wraz ze
wszystkimi `Run`/`Step`/`TreadEdge`/`Walkline`/`WinderGroup`/`Landing`) i niech `H` będzie
funkcją wysokości `H(globalIndex) = (globalIndex + 1) × riserHeight`. Wtedy:

```
Model3D = Generate3D(M2D, H)
```

`Generate3D` jest **czystą funkcją bez stanu własnego** — nie istnieje żadna ścieżka, którą
dane mogłyby płynąć w odwrotnym kierunku (3D → 2D). Model 3D nigdy nie jest edytowalnym
środowiskiem (potwierdzenie reguły 4 z `.claude/RULES.md` oraz zasady 23 z benchmarku).

---

## 2. Układ współrzędnych i terminologia

### 2.1 Układ współrzędnych 2D (płaszczyzna modelu)

- Kartezjański, jednostka **milimetr**, dwie współrzędne: **X** (poprzeczna), **Y** (wzdłużna).
- **Z nie istnieje w modelu 2D.** Żaden obiekt opisany w §4 poniżej aż do `Stringer`/`Riser`
  nie przechowuje współrzędnej pionowej — wysokość jest własnością GLOBALNĄ, wyliczaną wyłącznie
  z `globalIndex` i `riserHeight` (patrz §2.6), nigdy przechowywaną jako niezależne,
  edytowalne pole punktu.
- Współrzędne globalne (X, Y) to układ **wyłącznie do zapisu bezwzględnej pozycji punktu** —
  powstają przez łańcuchowe składanie lokalnych ramek kolejnych `Run` (patrz §2.5). **Nigdy nie
  wolno wnioskować czoła/tyłu/strony wewnętrznej/zewnętrznej stopnia przez porównanie surowych
  wartości X/Y** — to dokładnie ostrzeżenie z wymagań tej sesji, i jest tu wymuszone
  architektonicznie: te pojęcia są zdefiniowane wyłącznie względem **lokalnego** kierunku
  wchodzenia danego `Run`/`Step` (§2.3, §2.7).

### 2.2 Początek schodów (Origin)

`Origin = (0, 0)` w globalnym układzie — punkt na `Walkline`, w którym `TreadEdge` o
`id = "edge-0"` (krawędź czołowa stopnia 0, czyli granica podłoga/pierwszy stopień) przecina
policzek zewnętrzny. Formalnie:

```
Origin = TreadEdge["edge-0"].nominalOuterPoint = (0, 0)
```

Policzek wewnętrzny (dusza) startuje w `(stairWidth, 0)`. Wybór "outer = origin" (a nie np.
środek szerokości biegu) jest **zgodny z dzisiejszą implementacją** (`planLayout.js`,
`outerFullPath[0] = {x:0,y:0}`) — nie jest to nowa, arbitralna decyzja tego dokumentu, tylko
formalizacja istniejącej, sprawdzonej konwencji.

### 2.3 Kierunek wchodzenia (globalny, początkowy)

`Run[0].localFrame.forward = (0, 1)` **z definicji** — czyli globalna oś **+Y jest równa
początkowemu kierunkowi wchodzenia**. To nie przypadek, tylko konstrukcja: lokalna ramka
pierwszego `Run` JEST globalnym układem współrzędnych modelu.

### 2.4 Kierunek poprzeczny

`transverse = rotate90CW(forward)`, gdzie `rotate90CW((x,y)) = (y, -x)` (ta sama funkcja co
dzisiejsze `rotate90CW` w `planLayout.js`). Dla `Run[0]`: `transverse = (1, 0)` = globalna oś
**+X**, skierowana **od policzka zewnętrznego do wewnętrznego (duszy)**.

**Korekta nazewnictwa — WYKONANA (etap konsolidacji).** Pola `rearRiser`/`frontRiser` (kiedyś
NAZWANE ODWROTNIE względem terminologii tej sesji — patrz `winderBlank.js`, historyczny
komentarz autora) zostały w pełni przemianowane w całym aktywnym kodzie:

| Termin w tej specyfikacji | Znaczenie | Pole w kodzie |
|---|---|---|
| **czoło stopnia** (`frontEdge`) | krawędź pierwszego kontaktu, bliżej startu biegu | `tread.frontEdge` |
| **tył stopnia** (`backEdge`) | krawędź współdzielona z następnym stopniem | `tread.backEdge` |

Ta korekta nazw została wskazana już w pierwszym audycie architektury tego cyklu prac (nazwany
tam "problem C.8: nazewnictwo `rearRiser`/`frontRiser` jest mylące — przyznane w kodzie") i
potwierdzona w sekcji D benchmarku branżowego jako źródło ryzyka błędu. Rename wykonano w
`planLayout.js`, `edgeOverrides.js`, `stringerSolver.js`, `riserGeometry.js`,
`treadGeometry.js`, `winderBlank.js`, `dimensionLabels.js` i wszystkich testach — bez aliasu
kompatybilności; statyczny test (`consolidationInvariants.test.js`) pilnuje, żeby stare nazwy
nie wróciły.

### 2.5 Lokalne ramki `Run` (łańcuchowanie)

Każdy `Run` ma własną ramkę `{origin, forward, right}` w układzie globalnym. Ramka pierwszego
`Run` to `{origin: (0,0), forward: (0,1), right: (1,0)}` (§2.2–2.4). Ramka `Run[k+1]` jest
wyliczana z punktu wyjścia `Run[k]` przez obrót o −90° (skręt w prawo) lub jego lustrzane
odbicie (`turnDirection === 'left'`) — dokładnie mechanizm dzisiejszego `makeFrame`/`toWorld` w
`planLayout.js`, tu tylko podniesiony do rangi formalnej własności `Run`, a nie ukrytego
detalu implementacyjnego funkcji budującej.

### 2.6 Wysokość Z

`Z` jest **osobną, globalną, zawsze pionową osią**, całkowicie nieobecną w warstwie 2D.

```
riserHeight = totalRise / numRisers                    (stała dla całego Staircase)
Z_top(globalIndex)    = (globalIndex + 1) × riserHeight
Z_bottom(globalIndex) = Z_top(globalIndex) − treadThickness
```

`Z = 0` odpowiada poziomowi podłogi w `Origin`. Żaden punkt 2D nie ma "swojego Z" — wysokość
jest funkcją WYŁĄCZNIE pozycji stopnia w globalnej kolejności (`globalIndex`), nigdy
niezależnym, ręcznie edytowalnym polem. To wprost wymusza regułę 5 z `.claude/RULES.md`
("stopnie muszą pozostać na spójnej siatce wysokości") na poziomie schematu danych, a nie tylko
konwencji kodowania.

### 2.7 Terminologia stopnia — zawsze względem lokalnego kierunku wchodzenia

| Termin | Definicja | Pole w modelu |
|---|---|---|
| **czoło stopnia** | krawędź PIERWSZEGO kontaktu użytkownika wchodzącego na dany stopień — ta z bounding TreadEdge o niższym `globalIndex` | `Step.frontEdge` |
| **tył stopnia** | krawędź przeciwległa, współdzielona z kolejnym stopniem (`globalIndex + 1`) | `Step.backEdge` |
| **góra stopnia** | powierzchnia, na której staje użytkownik, na wysokości `Z_top(globalIndex)` | `Step.topSurface` |
| **spód stopnia** | dolna powierzchnia elementu, na wysokości `Z_bottom(globalIndex)` | `Step.bottomSurface` |
| **strona wewnętrzna** | strona przy duszy — `+transverse` względem `Step.localWalkingDirection` | `Step.innerSideEdge` |
| **strona zewnętrzna** | strona przy policzku zewnętrznym — `−transverse` | `Step.outerSideEdge` |

**Zasada:** *Pierwszy stopień rozpoczyna schody swoim czołem* → `Step[0].frontEdge ===
TreadEdge["edge-0"]`, a `Origin` (§2.2) leży dokładnie na tej krawędzi. To domyka cały układ:
Origin, kierunek wchodzenia i czoło pierwszego stopnia to trzy opisy tego samego miejsca w
modelu, nie trzy niezależne ustalenia, które mogłyby się rozjechać.

### 2.8 Kierunek postępu (progresja) — uogólnienie kierunku wchodzenia

`Step.localWalkingDirection` to **styczna do `Walkline` w punkcie danego stopnia**:

- dla stopnia prostego (`Run.runType === 'straight'`): stała, równa `Run.localFrame.forward`.
- dla stopnia zabiegowego (`Run.runType === 'winder'`): zmienia się w sposób ciągły wzdłuż
  łuku zabiegu — dlatego jest polem `Step`, nie `Run` (w przeciwieństwie do stopnia prostego,
  gdzie oba pojęcia się pokrywają).

**Terminologia czoło/tył/wewn./zewn. z §2.7 ZAWSZE odnosi się do `Step.localWalkingDirection`
TEGO KONKRETNEGO stopnia** — nigdy do kierunku stopnia 0 ani do globalnych osi X/Y. To jest
mechanizm, który sprawia, że terminologia pozostaje poprawna nawet w zabiegu, gdzie globalny
kierunek "do przodu" fizycznie się obraca w trakcie pokonywania jednego stopnia.

---

## 3. Trójstanowa geometria krawędzi — `Nominal` / `Override` / `Final`

To jest **najważniejsza zasada tego dokumentu**, bezpośrednio odpowiadająca na wymóg
rozróżnienia nominalnej krawędzi, ręcznej korekty i finalnej krawędzi.

```
                    ┌─────────────────────┐
                    │   Solver Run/Walkline │
                    └──────────┬──────────┘
                               │ wylicza zawsze na nowo
                               ▼
                    NominalEdgeGeometry            (algorytm, deterministyczny,
                    { innerPoint, outerPoint }       NIGDY nie czyta override)
                               │
                               │  + opcjonalna korekta użytkownika
                               ▼
                    EdgeOverride                    (dane wejściowe użytkownika,
                    { movedEndpoint, point }          PRZECHOWYWANE w projekcie)
                               │
                               │  walidacja (pole nie może się zdegenerować)
                               ▼
                    FinalEdgeGeometry               (to, czego używa Step.outline
                    { innerPoint, outerPoint }         i nic więcej — patrz §5)
```

Reguły:

1. **`NominalEdgeGeometry` jest zawsze wyliczana od zera** z algorytmu `Run`/`Walkline` —
   nigdy nie zależy od tego, czy istnieje `EdgeOverride`. To jest "geometria wzorcowa" —
   dokładnie to, co dziś w kodzie nazywa się `current` w `edgeOverrides.js`, tu podniesione do
   rangi jawnego, nazwanego stanu.
2. **`EdgeOverride` to jedyne dane wejściowe użytkownika w całym `TreadEdge`.** Ma dokładnie
   jedno aktywne pole ruchome (`movedEndpoint: 'inner' | 'outer'`) — drugi koniec krawędzi
   ("zawias") ZAWSZE bierze aktualną wartość z `NominalEdgeGeometry`, nigdy nie jest
   zamrożony na wartości sprzed edycji. Dzięki temu edycja przetrwa późniejszą zmianę innych
   parametrów (np. liczby stopni) bez potrzeby ręcznej korekty przez użytkownika — to
   zachowanie już istnieje w `edgeOverrides.js` i jest tu formalnie utrwalone jako właściwość
   modelu, nie przypadek implementacji.
3. **`FinalEdgeGeometry` = `NominalEdgeGeometry` z nałożonym `EdgeOverride`**, o ile wynik
   przechodzi walidację (pole sąsiadujących `Step` nie zmienia znaku/nie zeruje się —
   dzisiejszy `signedArea` check w `edgeOverrides.js`). Jeśli walidacja się nie powiedzie,
   `FinalEdgeGeometry = NominalEdgeGeometry` (override jest ignorowany DO CELÓW GEOMETRII, ale
   **wartość override pozostaje zapisana** — użytkownik nie traci swojej próby edycji, widzi
   tylko, że została odrzucona).

### 3.1 Zasada: manual edit nie modyfikuje bezpośrednio geometrii 3D

> Ręczna edycja zapisuje WYŁĄCZNIE `EdgeOverride` w modelu 2D (`Staircase.edgeOverrides`).
> Nie istnieje żadna ścieżka kodu, która przyjmowałaby edycję bezpośrednio do mesha 3D.

Pełny cykl po edycji:

```
User drag (2D UI)
  → zapis EdgeOverride do Staircase.edgeOverrides[edgeId]
  → PEŁNE ponowne rozwiązanie modelu 2D:
      Nominal* (bez zmian — nie zależy od override)
      Final* (przeliczone dla dotkniętych TreadEdge)
      Step.outline / topSurface / bottomSurface (przeliczone — używają Final*)
  → PEŁNE ponowne rozwiązanie Stringer / Riser / StringerSupport
      (używają Nominal*, więc dla NICH override jest niewidoczny poza polem
       StringerSupport.finalOffset — patrz §5)
  → Generate3D(M2D, H) od zera
```

To jest formalizacja reguły 7 z `.claude/RULES.md` ("Recalculate dependent geometry after
every model change") na poziomie konkretnego przepływu danych, nie tylko ogólnej deklaracji.

### 3.2 Kluczowy niezmiennik krzyżowy: kto czyta `Nominal`, kto czyta `Final`

| Konsument | Czyta | Uzasadnienie |
|---|---|---|
| `Step.outline` / `topSurface` / `bottomSurface` (widoczny kształt stopnia, nosek) | **`Final`** | To jedyne miejsce, gdzie użytkownik chce zobaczyć efekt swojej edycji |
| `Stringer.segments[].referenceLine` | **`Nominal`** | Fizyczna deska policzka ma zostać prosta i na miejscu — edycja noska nie może jej wygiąć (reguła 5 z `.claude/RULES.md`) |
| `Riser.outline` | **`Nominal`** (strona przylegająca do wangi) | Podstopień wypełnia szczelinę zostawioną przez wangę w tym samym, niezmiennym miejscu |
| `StringerSupport.finalOffset` | oblicza **różnicę** `Final − Nominal` | To jest JEDYNE miejsce, w którym efekt edycji dociera do wangi — jako zmierzone odchylenie oparcia, nie jako przesunięcie deski |
| `Walkline.path` | **`Nominal`** | Linia biegu to konstrukcja algorytmu (ergonomia/zabieg), nie podąża za lokalnymi, ręcznymi korektami noska |

Ta tabela to bezpośrednie uogólnienie tego, co zaprojektowano w poprzedniej sesji dla
`stringerModel.js`, rozciągnięte na WSZYSTKIE elementy modelu, nie tylko wangę.

---

## 4. Model obiektowy

Konwencja zapisu dla każdego typu: **Identyfikator**, **Dane wejściowe** (co można/trzeba
podać), **Dane obliczane** (zawsze wyliczane na nowo, nigdy nie edytowane wprost), **Zależy
od**, **Co może edytować użytkownik**, **Co ZAWSZE jest przeliczane**.

### 4.1 `Staircase`

Korzeń modelu. Jeden na projekt.

- **Identyfikator:** `"staircase"` (singleton w obrębie jednego projektu).
- **Dane wejściowe:** `stairType`, `turnDirection`, `totalRise`, `stairWidth`, `treadGoing`,
  `treadsLegA/B/C`, `windersPerTurn`, `turn1Type`/`turn2Type`, `mergeLandings`,
  `walklineOffset`, `walklineSplitOffset`, `minInnerWidth`, `treadThickness`, `nosing`,
  `stringerHeight`, `stringerThickness`, `stringerConstructionType`, `timberGrade`,
  `hasRiserBoards`, `riserBoardThickness`, `postSize`, `hasCornerPost`, `minRiser`/`maxRiser`,
  `minHeadroom`, `ceilingThickness`, `openingLength/Width/OffsetX/OffsetY`, `designProfileId`
  — **to jest dzisiejszy `config` z `src/config/schema.js`, tu formalnie przypisany jako
  wejście obiektu `Staircase`**, nie osobna, równoległa struktura.
- **Dane obliczane:** `numTreads`, `numRisers`, `riserHeight` (§2.6), `runs: Run[]` (w
  kolejności wchodzenia), `walkline: Walkline`, `stringers: {outer: Stringer, inner: Stringer}`,
  `bounds` (prostokąt otaczający rzut), `derived` (istniejące `blondelOk`/`riserRangeOk`/
  `turnFeasible` z `deriveStairData` — teraz jako pochodna właściwość obiektu, nie osobna
  funkcja zwracająca luźny obiekt).
- **Zależy od:** niczego (korzeń).
- **Co może edytować użytkownik:** wszystkie pola *Dane wejściowe* powyżej, plus
  `edgeOverrides: Map<TreadEdgeId, EdgeOverride>` (§3).
- **Co ZAWSZE jest przeliczane:** cała sekcja *Dane obliczane* — pełne, deterministyczne
  rozwiązanie od zera po każdej zmianie wejścia (reguła 7 `.claude/RULES.md`).

### 4.2 `Run`

Jeden ciągły odcinek biegu o spójnej, łańcuchowanej ramce lokalnej: prosty, zabiegowy lub
podest.

- **Identyfikator:** `"run-{n}"`, `n` = 0-based pozycja w `Staircase.runs`.
- **Dane wejściowe:** `runType: 'straight' | 'winder' | 'landing'`; liczba stopni (dla
  `'straight'`) — **pochodna** z `Staircase.treadsLegA/B/C`, nie jest to niezależne pole
  wpisywane na poziomie `Run`.
- **Dane obliczane:** `localFrame: {origin, forward, right}` (§2.5); `globalIndexRange:
  {start, end}`; `content`: `steps: Step[]` (gdy `'straight'`) **albo** `winderGroup:
  WinderGroup` (gdy `'winder'`) **albo** `landing: Landing` (gdy `'landing'`); `bounds`.
- **Zależy od:** ramki wyjściowej poprzedniego `Run` (albo `Staircase` origin, dla pierwszego);
  `Staircase.stairWidth/treadGoing/turnDirection/walklineOffset/walklineSplitOffset`.
- **Co może edytować użytkownik:** nic bezpośrednio — `Run` jest w całości pochodną
  rozkładu `Staircase` na odcinki.
- **Co ZAWSZE jest przeliczane:** `localFrame`, `content`, `bounds`.

### 4.3 `Step`

Stopień jako **obiekt geometryczny**, nie cztery przypadkowe punkty.

- **Identyfikator:** `"step-{globalIndex}"`, `globalIndex` = 0-based pozycja w kolejności
  wchodzenia, **wspólna dla całego `Staircase`** (nie resetowana per `Run`) — to jest ten sam
  indeks, którego używa `Z_top`/`Z_bottom` (§2.6).
- **Dane wejściowe:** **żadne bezpośrednie.** Step nie ma własnych, przechowywanych pól — jest
  w 100% pochodną `frontEdge`/`backEdge` i parametrów `Staircase`. (Jedyny "wpływ" użytkownika
  na `Step` biegnie pośrednio przez `EdgeOverride` na jego `frontEdge`/`backEdge`.)
- **Dane obliczane:**
  - `stepType: 'straight' | 'winder'` (landing to OSOBNY typ, §4.9 — nie wariant `Step`)
  - `localWalkingDirection`, `localTransverseDirection` (§2.8)
  - `frontEdge: TreadEdgeRef` = `edge-{globalIndex}` (czoło, §2.7)
  - `backEdge: TreadEdgeRef` = `edge-{globalIndex+1}` (tył)
  - `innerSideEdge`, `outerSideEdge`: łańcuchy punktów łączące `frontEdge`/`backEdge` po
    stronie wewnętrznej/zewnętrznej — **źródło `Nominal`** dla tych łańcuchów (odpowiednik
    dzisiejszych `innerChain`/`outerChain`)
  - `outline`: wielobok Final — `[frontEdge.finalInner, backEdge.finalInner,
    backEdge.finalOuter, frontEdge.finalOuter]` (kolejność jak dziś w `planLayout.js`)
  - `topSurface: {elevation: Z_top(globalIndex), outline}` (góra stopnia)
  - `bottomSurface: {elevation: Z_bottom(globalIndex), outline}` (spód stopnia)
  - `nosingLine` (tylko gdy nie jest to stopień podestowy — landing nie ma noska)
  - `area` (pole `outline`, do walidacji degeneracji — dzisiejszy `signedArea`)
- **Zależy od:** `frontEdge`, `backEdge` (oba `TreadEdge`), macierzystego `Run`
  (`localWalkingDirection` dla zabiegu), `Staircase.treadThickness/nosing/riserHeight`.
- **Co może edytować użytkownik:** nic bezpośrednio.
- **Co ZAWSZE jest przeliczane:** wszystko — `Step` nie jest nigdy serializowany jako
  samodzielny byt w pliku projektu (§6), wyłącznie odtwarzany przy każdym rozwiązaniu modelu.

### 4.4 `TreadEdge`

Granica pomiędzy dwoma stopniami (albo podłogą/podestem a stopniem) — nośnik trójstanowej
geometrii z §3.

- **Identyfikator:** `"edge-{n}"`, `n` = 0..`numTreads` (n=0 to krawędź startowa/`Origin`,
  n=`numTreads` to krawędź końcowa biegu).
- **Dane wejściowe:** `override: EdgeOverride | null` = `{ movedEndpoint: 'inner' | 'outer',
  point: {x, y} }` — jedyne pole wpisywane przez użytkownika w całym tym obiekcie.
- **Dane obliczane:** `nominalInnerPoint`, `nominalOuterPoint` (z solvera `Run`/`Walkline`,
  §3 pkt 1); `finalInnerPoint`, `finalOuterPoint` (§3 pkt 3); `isOverridden: boolean`;
  `isValid: boolean` (czy override przeszedł walidację degeneracji).
- **Zależy od:** obu sąsiadujących `Step` (do walidacji degeneracji — patrz `edgeOverrides.js`,
  sprawdzenie działa na `before`/`after`), solvera macierzystego `Run`.
- **Co może edytować użytkownik:** `override` (ustawienie, usunięcie).
- **Co ZAWSZE jest przeliczane:** `nominal*`, `final*`, `isOverridden`, `isValid`.

### 4.5 `Walkline`

Linia biegu — referencja ergonomiczna używana do rozkładu zabiegu i (opcjonalnie) wymiarowania.

- **Identyfikator:** `"walkline"` (jeden na `Staircase`, ciągły przez wszystkie `Run`).
- **Dane wejściowe:** `Staircase.walklineOffset` (odsunięcie od duszy); per-`WinderGroup`
  `walklineSplitOffset` (§4.10) — **znana dziś ograniczoność**: obecny `config` ma te pola
  jako globalne, więc przy `stairType === 'U'` z dwoma zakrętami dzielą jedną wartość zamiast
  mieć niezależne offsety per zakręt. Ten dokument nazywa to ograniczenie wprost, zamiast je
  ukrywać — naprawa (osobne pole per `WinderGroup`) to decyzja do podjęcia przy migracji
  schematu (§6.3), nie coś domyślnie zakładane jako już rozwiązane.
- **Dane obliczane:** `path: Point2D[]` (odcinki proste w `Run` prostych, łuk/interpolacja w
  `WinderGroup`); `totalLength`; funkcja `tangentAt(globalIndex) → Vec2D` (używana przez
  `Step.localWalkingDirection` w zabiegu, §2.8).
- **Zależy od:** wszystkich `Run` (kolejność, ramki), `Staircase.walklineOffset`.
- **Co może edytować użytkownik:** nic bezpośrednio dziś (offsety to pola `Staircase`) —
  przyszłe rozszerzenie: ręczne przeciąganie punktu linii biegu, poza zakresem tego dokumentu.
- **Co ZAWSZE jest przeliczane:** `path`, `totalLength`, `tangentAt`.

### 4.6 `WinderGroup`

Jeden zakręt zabiegowy jako odrębny podukład projektowy (zgodnie z zasadą 27 benchmarku
branżowego — "cały zakręt jest odrębnym podukładem, nie tylko serią zniekształconych stopni
prostych").

- **Identyfikator:** `"winder-{n}"`, `n` = kolejność wśród zakrętów zabiegowych w `Staircase`
  (0 dla L, 0 lub 1 dla U).
- **Dane wejściowe:** `windersPerTurn`, `walklineOffset` (odziedziczone/odniesione do
  `Staircase`), `walklineSplitOffset` (patrz zastrzeżenie w §4.5).
- **Dane obliczane:** `steps: Step[]` (te same obiekty `Step`, na które wskazuje też
  macierzysty `Run.content`); `innerCorner`, `outerCorner` (punkty odniesienia zakrętu);
  `walklineSegment` (wycinek `Walkline.path` należący do tego zakrętu); `feasibility:
  {feasible: boolean, minInnerSegment: number, message: string}` (dzisiejszy
  `checkTurnFeasibility`, teraz własność obiektu, a nie osobna, luźna funkcja zwracająca
  tablicę wyników do ręcznego dopasowania do zakrętu po indeksie).
- **Zależy od:** macierzystego `Run`, `Staircase.treadGoing/stairWidth/minInnerWidth`.
- **Co może edytować użytkownik:** `windersPerTurn` (i pośrednio odziedziczone offsety) — na
  poziomie `Staircase`, nie bezpośrednio na obiekcie.
- **Co ZAWSZE jest przeliczane:** wszystko.

### 4.7 `Landing`

Podest — płaska platforma zastępująca zakręt.

- **Identyfikator:** `"landing-{n}"`, `n` = kolejność wśród podestów.
- **Dane wejściowe:** żadne bezpośrednie — obecność/scalanie sterowane przez
  `Staircase.turn1Type/turn2Type === 'landing'` i `mergeLandings`.
- **Dane obliczane:** `outline` (kwadrat/prostokąt `stairWidth × stairWidth`, ew. scalony —
  dzisiejsze `mergeLandingPair`); `elevation = Z_top(globalIndex)` (podest liczy się jako JEDEN
  stopień w globalnej numeracji, tak jak dziś); `entryEdge`, `exitEdge: TreadEdgeRef` (dwie
  krawędzie o RÓŻNYCH lokalnych kierunkach — podest łączy dwa `Run` o różnym `forward`).
- **Zależy od:** dwóch sąsiadujących `Run` (wejściowego i wyjściowego), `Staircase.stairWidth`.
- **Co może edytować użytkownik:** nic bezpośrednio poza wyborem typu zakrętu na poziomie
  `Staircase`.
- **Co ZAWSZE jest przeliczane:** wszystko.

### 4.8 `Stringer`

Wanga jako **element konstrukcyjny**, nie dekoracyjna bryła. Pełny opis kształtu danych — patrz
`src/geometry/stringerModel.js` z poprzedniej sesji; tutaj tylko domknięcie w kontekście
całego modelu.

- **Identyfikator:** `"stringer-outer"` / `"stringer-inner"` — jedna na stronę, obejmuje
  CAŁĄ długość `Staircase` (wszystkie `Run` razem), złożona z wielu prostych `segments`.
- **Dane wejściowe:** `width` (= `Staircase.stringerHeight`), `thickness` (=
  `stringerThickness`), `constructionType` (`'closed' | 'cut'`), `material.strengthClass` (=
  `timberGrade`).
- **Dane obliczane:** `segments: StringerSegment[]` — każdy `{referenceLine, treadBearings
  (jako lista `StringerSupport`, §4.9), width, thickness, constructionType}`; `segmentJoints`;
  `topConnection`, `bottomConnection`, `intermediateSupports` (jako `StringerSupport` o
  odpowiednim `kind`, §4.9); `manufacturing` (`housingDepth`, `tenon*`).
- **Zależy od:** **`NominalEdgeGeometry` WSZYSTKICH `TreadEdge`** (nigdy `Final` — §3.2!),
  `Staircase.stairWidth/hasCornerPost`, geometrii zakrętów (`WinderGroup.innerCorner/
  outerCorner`).
- **Co może edytować użytkownik:** `width`, `thickness`, `constructionType`, `material` (jako
  pola `Staircase`) — nigdy geometrię segmentów bezpośrednio.
- **Co ZAWSZE jest przeliczane:** `segments`, `segmentJoints`, connections — przy KAŻDEJ
  zmianie `Staircase` LUB dowolnego `EdgeOverride` (bo nawet jeśli sam `referenceLine` się nie
  zmieni, `StringerSupport.finalOffset` może się zmienić — patrz §3.2).

### 4.9 `StringerSupport`

Punkt oparcia lub połączenia wangi — **jeden obiekt na dwa różne, ale pokrewne zjawiska**:
gdzie wanga niesie stopień, i czym wanga jest sama podparta/połączona.

- **Identyfikator:** `"support-{stringerId}-{n}"`.
- **Dane wejściowe:** żadne bezpośrednie.
- **Dane obliczane:**
  - `kind: 'tread-bearing' | 'newel-tenon' | 'corner-post' | 'lap-joint'`
  - dla `'tread-bearing'`: `stepId` (który `Step` tu siedzi), `uStart/uEnd` (pozycja NA
    `referenceLine` segmentu, z geometrii **Nominal**), `finalOffsetStart/End` (odchylenie
    PUNKTU FINALNEGO od `referenceLine` — jedyne miejsce, gdzie efekt ręcznej edycji dociera
    do wangi, jako zmierzona wielkość, nie jako deformacja), `bearingElevation` (z §2.6),
    `riserRecess` (patrz niezmiennik krzyżowy niżej)
  - dla pozostałych `kind`: `position`, wymiary joinerskie (`tenonThickness/Length` albo
    `housingDepth`, z `stringerModel.js`)
- **Zależy od:** macierzystego `Stringer`, `Step`/`TreadEdge` (dla `'tread-bearing'`),
  `WinderGroup`/`Run` (dla `'corner-post'`/`'lap-joint'`).
- **Co może edytować użytkownik:** nic bezpośrednio.
- **Co ZAWSZE jest przeliczane:** wszystko.
- **Niezmiennik krzyżowy:** `StringerSupport.riserRecess` (strona `tread-bearing`) MUSI być
  liczbowo równe `Riser.recess` (§4.10) dla TEGO SAMEGO `stepId` — to jest ta sama fizyczna
  szczelina, opisywana z dwóch stron złącza. Rozjazd tych dwóch wartości byłby błędem modelu,
  nie wariantem projektowym.

### 4.10 `Riser`

Podstopień.

- **Identyfikator:** `"riser-{globalIndex}"`.
- **Dane wejściowe:** obecność sterowana przez `Staircase.hasRiserBoards`; `thickness` = 
  `Staircase.nosing` (dla zwykłego stopnia — wypełnia szczelinę zostawioną przez wangę) albo
  `Staircase.riserBoardThickness` (dla podestu).
- **Dane obliczane:** `outline` (z `Nominal` geometrii `frontEdge` należącego `Step` — **nigdy
  z `Final`**, ta sama zasada co dla wangi, §3.2); `elevationRange: {bottom, top}` (z §2.6);
  `recess` (patrz niezmiennik krzyżowy w §4.9).
- **Zależy od:** `Step.frontEdge` (geometria Nominal), `Staircase.hasRiserBoards/nosing/
  riserBoardThickness/treadThickness`.
- **Co może edytować użytkownik:** nic bezpośrednio — obecność/grubość to pola `Staircase`.
- **Co ZAWSZE jest przeliczane:** wszystko.

---

## 5. Zasady podsumowujące (odniesienie do §3.2)

1. **Widoczny kształt stopnia** (`Step.outline`, nosek) = funkcja `Final` geometrii krawędzi.
2. **Wanga i podstopień** (elementy stykające się z surową konstrukcją, nie z "kosmetyczną"
   krawędzią) = funkcja `Nominal` geometrii krawędzi.
3. **Jedyny kanał, którym edycja dociera do wangi**, to zmierzone odchylenie
   (`StringerSupport.finalOffsetStart/End`) — liczba opisująca DYSTANS między tym, co
   użytkownik chciał, a tym, gdzie fizycznie stoi deska. Nigdy deformacja samej deski.
4. **`Walkline` zawsze czyta `Nominal`** — linia biegu to konstrukcja ergonomiczna/zabiegowa,
   niezależna od lokalnych, kosmetycznych korekt.

---

## 6. Stabilność identyfikatorów — jawne ograniczenie

`globalIndex` (a więc też `Step`/`TreadEdge`/`Riser`/`StringerSupport` id) jest **pozycyjny, nie
trwały**: zmiana liczby stopni w dowolnym `Run` przesuwa indeksy wszystkiego, co po nim
następuje. To jest DOKŁADNIE dzisiejsze zachowanie `manualEdgeOverrides` (klucz to
`boundaryIndex`, interpretowany na nowo przy każdym rozwiązaniu, z bezpiecznym zachowaniem
"granica już nie istnieje" — patrz `getBoundaryPoints` w `edgeOverrides.js`). Ten dokument
**świadomie zachowuje** tę własność zamiast wprowadzać trwałe UUID-y dla każdej krawędzi —
ponieważ (a) obecna implementacja już poprawnie obsługuje "znikającą granicę" i (b) trwałe
UUID-y dodałyby złożoność bez wyraźnej korzyści biznesowej na tym etapie. Jeśli w przyszłości
pojawi się potrzeba "ta sama edycja przetrwa przesunięcie o dwa stopnie", będzie to wymagało
osobnej decyzji projektowej (np. UUID + heurystyka dopasowania), nie domyślnego założenia.

---

## 7. Schemat JSON

Dwa OSOBNE schematy, celowo różnej wielkości:

- **7.1 Schemat projektu (persisted)** — to, co faktycznie trafia do pliku `.json` zapisywanego
  przez użytkownika. Mały: parametry `Staircase` + mapa `edgeOverrides`. WSZYSTKO inne w §4 jest
  w 100% pochodne i nigdy nie jest zapisywane.
- **7.2 Schemat modelu rozwiązanego (resolved)** — kontrakt danych, jaki solver produkuje dla
  konsumentów (renderer 2D/3D, walidator, przyszły material takeoff, eksporter). Nie jest
  zapisywany na dysk — istnieje tylko w pamięci po wywołaniu `solve()`.

### 7.1 Schemat projektu (persisted) — wersja 2

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "StaircaseProjectFile",
  "type": "object",
  "required": ["_type", "_version", "config", "edgeOverrides"],
  "properties": {
    "_type": { "const": "schody3d-project" },
    "_version": { "const": 2 },
    "savedAt": { "type": "string", "format": "date-time" },
    "config": {
      "type": "object",
      "description": "Dane wejściowe Staircase — patrz §4.1. Odpowiednik dzisiejszego config/schema.js createDefaultConfig().",
      "required": [
        "stairType", "turnDirection", "totalRise", "stairWidth", "treadGoing",
        "treadsLegA", "windersPerTurn", "treadsLegB", "treadsLegC",
        "turn1Type", "turn2Type", "mergeLandings",
        "walklineOffset", "walklineSplitOffset", "minInnerWidth",
        "treadThickness", "nosing",
        "stringerHeight", "stringerThickness", "stringerConstructionType", "timberGrade",
        "hasRiserBoards", "riserBoardThickness",
        "postSize", "hasCornerPost",
        "minRiser", "maxRiser", "minHeadroom", "ceilingThickness",
        "openingLength", "openingWidth", "openingOffsetX", "openingOffsetY",
        "designProfileId"
      ],
      "properties": {
        "stairType": { "enum": ["straight", "L", "U"] },
        "turnDirection": { "enum": ["right", "left"] },
        "totalRise": { "type": "number", "exclusiveMinimum": 0 },
        "stairWidth": { "type": "number", "exclusiveMinimum": 0 },
        "treadGoing": { "type": "number", "exclusiveMinimum": 0 },
        "treadsLegA": { "type": "integer", "minimum": 0 },
        "windersPerTurn": { "type": "integer", "minimum": 0 },
        "treadsLegB": { "type": "integer", "minimum": 0 },
        "treadsLegC": { "type": "integer", "minimum": 0 },
        "turn1Type": { "enum": ["winder", "landing"] },
        "turn2Type": { "enum": ["winder", "landing"] },
        "mergeLandings": { "type": "boolean" },
        "walklineOffset": { "type": "number", "minimum": 0 },
        "walklineSplitOffset": { "type": "number", "minimum": 0 },
        "minInnerWidth": { "type": "number", "minimum": 0 },
        "treadThickness": { "type": "number", "exclusiveMinimum": 0 },
        "nosing": { "type": "number", "minimum": 0 },
        "stringerHeight": { "type": "number", "exclusiveMinimum": 0 },
        "stringerThickness": { "type": "number", "exclusiveMinimum": 0 },
        "stringerConstructionType": { "enum": ["closed", "cut"] },
        "timberGrade": { "type": "string" },
        "hasRiserBoards": { "type": "boolean" },
        "riserBoardThickness": { "type": "number", "minimum": 0 },
        "postSize": { "type": "number", "exclusiveMinimum": 0 },
        "hasCornerPost": { "type": "boolean" },
        "minRiser": { "type": "number" },
        "maxRiser": { "type": "number" },
        "minHeadroom": { "type": "number" },
        "ceilingThickness": { "type": "number" },
        "openingLength": { "type": "number" },
        "openingWidth": { "type": "number" },
        "openingOffsetX": { "type": "number" },
        "openingOffsetY": { "type": "number" },
        "designProfileId": { "type": "string" }
      }
    },
    "edgeOverrides": {
      "type": "object",
      "description": "Klucz = TreadEdge id ('edge-{n}' jako string). Odpowiednik dzisiejszego config.manualEdgeOverrides — tu jawnie wydzielony z config, bo koncepcyjnie NIE jest parametrem wejściowym Staircase, tylko osobną warstwą korekt (§3).",
      "additionalProperties": {
        "type": "object",
        "required": ["movedEndpoint", "point"],
        "properties": {
          "movedEndpoint": { "enum": ["inner", "outer"] },
          "point": {
            "type": "object",
            "required": ["x", "y"],
            "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
          }
        }
      }
    }
  }
}
```

**Migracja z wersji 1 → 2 — ZAIMPLEMENTOWANA** (`src/project/projectIO.js`, etap
konsolidacji): `_version: 1` miał `manualEdgeOverrides` jako pole WEWNĄTRZ `config`;
`_version: 2` wydziela je do `edgeOverrides` na najwyższym poziomie pliku, bo §3 tego
dokumentu formalnie traktuje korekty jako coś koncepcyjnie różnego od parametrów `Staircase`,
nie ich część. `parseProjectJSON()` migruje stare pliki automatycznie (rejestr `MIGRATIONS`
otwarty na kolejne wersje); testy w `src/project/__tests__/projectIO.test.js`. **Zakres:** to
zmiana WYŁĄCZNIE formatu pliku — wewnętrzny, runtime'owy kształt `config` w `main.js`/
`planLayout.js` nadal zagnieżdża `manualEdgeOverrides` (rozdzielenie tego na poziomie modelu w
pamięci to osobny, większy refaktor, świadomie odłożony).

### 7.2 Schemat modelu rozwiązanego (resolved, w pamięci)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ResolvedStaircaseModel",
  "type": "object",
  "required": ["id", "numTreads", "numRisers", "riserHeight", "origin", "runs", "walkline", "stringers", "derived"],
  "properties": {
    "id": { "const": "staircase" },
    "numTreads": { "type": "integer" },
    "numRisers": { "type": "integer" },
    "riserHeight": { "type": "number" },
    "origin": { "$ref": "#/$defs/Point2D" },
    "bounds": { "$ref": "#/$defs/Bounds" },
    "runs": { "type": "array", "items": { "$ref": "#/$defs/Run" } },
    "walkline": { "$ref": "#/$defs/Walkline" },
    "stringers": {
      "type": "object",
      "required": ["outer", "inner"],
      "properties": {
        "outer": { "$ref": "#/$defs/Stringer" },
        "inner": { "$ref": "#/$defs/Stringer" }
      }
    },
    "risers": { "type": "array", "items": { "$ref": "#/$defs/Riser" } },
    "derived": {
      "type": "object",
      "properties": {
        "blondel": { "type": "number" },
        "blondelOk": { "type": "boolean" },
        "riserRangeOk": { "type": "boolean" },
        "turnFeasible": { "type": "boolean" }
      }
    }
  },
  "$defs": {
    "Point2D": {
      "type": "object",
      "required": ["x", "y"],
      "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
    },
    "Vec2D": { "$ref": "#/$defs/Point2D" },
    "Bounds": {
      "type": "object",
      "required": ["minX", "maxX", "minY", "maxY"],
      "properties": {
        "minX": { "type": "number" }, "maxX": { "type": "number" },
        "minY": { "type": "number" }, "maxY": { "type": "number" }
      }
    },
    "Frame": {
      "type": "object",
      "required": ["origin", "forward", "right"],
      "properties": {
        "origin": { "$ref": "#/$defs/Point2D" },
        "forward": { "$ref": "#/$defs/Vec2D" },
        "right": { "$ref": "#/$defs/Vec2D" }
      }
    },
    "Run": {
      "type": "object",
      "required": ["id", "runType", "localFrame", "globalIndexRange"],
      "properties": {
        "id": { "type": "string", "pattern": "^run-\\d+$" },
        "runType": { "enum": ["straight", "winder", "landing"] },
        "localFrame": { "$ref": "#/$defs/Frame" },
        "globalIndexRange": {
          "type": "object",
          "required": ["start", "end"],
          "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } }
        },
        "steps": { "type": "array", "items": { "$ref": "#/$defs/Step" } },
        "winderGroup": { "$ref": "#/$defs/WinderGroup" },
        "landing": { "$ref": "#/$defs/Landing" }
      }
    },
    "TreadEdgeRef": { "type": "string", "pattern": "^edge-\\d+$" },
    "TreadEdge": {
      "type": "object",
      "required": ["id", "nominalInnerPoint", "nominalOuterPoint", "finalInnerPoint", "finalOuterPoint", "isOverridden", "isValid"],
      "properties": {
        "id": { "$ref": "#/$defs/TreadEdgeRef" },
        "nominalInnerPoint": { "$ref": "#/$defs/Point2D" },
        "nominalOuterPoint": { "$ref": "#/$defs/Point2D" },
        "override": {
          "type": ["object", "null"],
          "properties": {
            "movedEndpoint": { "enum": ["inner", "outer"] },
            "point": { "$ref": "#/$defs/Point2D" }
          }
        },
        "finalInnerPoint": { "$ref": "#/$defs/Point2D" },
        "finalOuterPoint": { "$ref": "#/$defs/Point2D" },
        "isOverridden": { "type": "boolean" },
        "isValid": { "type": "boolean" }
      }
    },
    "Step": {
      "type": "object",
      "required": ["id", "globalIndex", "stepType", "localWalkingDirection", "frontEdge", "backEdge", "outline", "topSurface", "bottomSurface"],
      "properties": {
        "id": { "type": "string", "pattern": "^step-\\d+$" },
        "globalIndex": { "type": "integer", "minimum": 0 },
        "stepType": { "enum": ["straight", "winder"] },
        "localWalkingDirection": { "$ref": "#/$defs/Vec2D" },
        "localTransverseDirection": { "$ref": "#/$defs/Vec2D" },
        "frontEdge": { "$ref": "#/$defs/TreadEdgeRef" },
        "backEdge": { "$ref": "#/$defs/TreadEdgeRef" },
        "innerSideEdge": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } },
        "outerSideEdge": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } },
        "outline": { "type": "array", "items": { "$ref": "#/$defs/Point2D" }, "minItems": 3 },
        "topSurface": {
          "type": "object",
          "required": ["elevation", "outline"],
          "properties": {
            "elevation": { "type": "number" },
            "outline": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } }
          }
        },
        "bottomSurface": {
          "type": "object",
          "required": ["elevation", "outline"],
          "properties": {
            "elevation": { "type": "number" },
            "outline": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } }
          }
        },
        "nosingLine": {
          "type": ["array", "null"],
          "items": { "$ref": "#/$defs/Point2D" }
        },
        "area": { "type": "number" }
      }
    },
    "WinderGroup": {
      "type": "object",
      "required": ["id", "steps", "innerCorner", "outerCorner", "feasibility"],
      "properties": {
        "id": { "type": "string", "pattern": "^winder-\\d+$" },
        "steps": { "type": "array", "items": { "$ref": "#/$defs/Step" } },
        "innerCorner": { "$ref": "#/$defs/Point2D" },
        "outerCorner": { "$ref": "#/$defs/Point2D" },
        "walklineSegment": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } },
        "feasibility": {
          "type": "object",
          "required": ["feasible", "minInnerSegment", "message"],
          "properties": {
            "feasible": { "type": "boolean" },
            "minInnerSegment": { "type": ["number", "null"] },
            "message": { "type": "string" }
          }
        }
      }
    },
    "Landing": {
      "type": "object",
      "required": ["id", "outline", "elevation", "entryEdge", "exitEdge"],
      "properties": {
        "id": { "type": "string", "pattern": "^landing-\\d+$" },
        "outline": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } },
        "elevation": { "type": "number" },
        "entryEdge": { "$ref": "#/$defs/TreadEdgeRef" },
        "exitEdge": { "$ref": "#/$defs/TreadEdgeRef" }
      }
    },
    "Walkline": {
      "type": "object",
      "required": ["path", "totalLength"],
      "properties": {
        "path": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } },
        "totalLength": { "type": "number" }
      }
    },
    "StringerSupport": {
      "type": "object",
      "required": ["id", "kind"],
      "properties": {
        "id": { "type": "string", "pattern": "^support-.+-\\d+$" },
        "kind": { "enum": ["tread-bearing", "newel-tenon", "corner-post", "lap-joint"] },
        "stepId": { "type": "string", "pattern": "^step-\\d+$" },
        "uStart": { "type": "number" },
        "uEnd": { "type": "number" },
        "finalOffsetStart": { "type": "number" },
        "finalOffsetEnd": { "type": "number" },
        "bearingElevation": { "type": "number" },
        "riserRecess": { "type": "number" },
        "position": { "$ref": "#/$defs/Point2D" },
        "tenonThickness": { "type": "number" },
        "tenonLength": { "type": "number" },
        "housingDepth": { "type": ["number", "null"] }
      }
    },
    "StringerSegment": {
      "type": "object",
      "required": ["id", "referenceLine", "width", "thickness", "constructionType", "treadBearings"],
      "properties": {
        "id": { "type": "string" },
        "referenceLine": {
          "type": "object",
          "required": ["start", "end", "direction", "length"],
          "properties": {
            "start": { "$ref": "#/$defs/Point2D" },
            "end": { "$ref": "#/$defs/Point2D" },
            "direction": { "$ref": "#/$defs/Vec2D" },
            "length": { "type": "number" }
          }
        },
        "width": { "type": "number" },
        "thickness": { "type": "number" },
        "constructionType": { "enum": ["closed", "cut"] },
        "treadBearings": { "type": "array", "items": { "$ref": "#/$defs/StringerSupport" } }
      }
    },
    "Stringer": {
      "type": "object",
      "required": ["id", "side", "segments", "material", "manufacturing"],
      "properties": {
        "id": { "enum": ["stringer-outer", "stringer-inner"] },
        "side": { "enum": ["outer", "inner"] },
        "segments": { "type": "array", "items": { "$ref": "#/$defs/StringerSegment" } },
        "segmentJoints": { "type": "array", "items": { "$ref": "#/$defs/StringerSupport" } },
        "topConnection": { "$ref": "#/$defs/StringerSupport" },
        "bottomConnection": { "$ref": "#/$defs/StringerSupport" },
        "intermediateSupports": { "type": "array", "items": { "$ref": "#/$defs/StringerSupport" } },
        "material": {
          "type": "object",
          "required": ["species", "strengthClass", "serviceClass"],
          "properties": {
            "species": { "type": "string" },
            "strengthClass": { "type": "string" },
            "serviceClass": { "type": "string" }
          }
        },
        "manufacturing": {
          "type": "object",
          "properties": {
            "housingDepth": { "type": ["number", "null"] },
            "tenonThickness": { "type": "number" },
            "tenonLength": { "type": "number" }
          }
        }
      }
    },
    "Riser": {
      "type": "object",
      "required": ["id", "outline", "elevationRange", "recess"],
      "properties": {
        "id": { "type": "string", "pattern": "^riser-\\d+$" },
        "outline": { "type": "array", "items": { "$ref": "#/$defs/Point2D" } },
        "elevationRange": {
          "type": "object",
          "required": ["bottom", "top"],
          "properties": { "bottom": { "type": "number" }, "top": { "type": "number" } }
        },
        "recess": { "type": "number" }
      }
    }
  }
}
```

---

## 8. Poza zakresem tego dokumentu

- **UI** — żaden komponent interfejsu, żadna interakcja (drag&drop, panele) nie jest tu
  projektowana. To wyłącznie model danych i jego niezmienniki.
- **Algorytm solvera** (jak dokładnie liczy się `NominalEdgeGeometry` dla zabiegu — metoda
  proporcjonalna dzisiejszego `planLayout.js` vs. alternatywy z benchmarku, np. łuk-wokół-słupa)
  — pozostaje nierozstrzygnięty tutaj; ten dokument definiuje KONTRAKT (co solver musi
  wyprodukować), nie JAK go osiągnąć.
- ~~Kod migracji wersji 1 → 2 pliku projektu~~ — **zaimplementowany w etapie konsolidacji**,
  patrz §7.1 i `src/project/projectIO.js`.
- **Material takeoff, eksport produkcyjny, walidator UI** — konsumują ten model (patrz §7.2),
  ale ich własna logika to osobny temat, poza zakresem tego dokumentu.
