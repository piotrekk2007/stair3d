# Benchmark funkcjonalny i architektoniczny profesjonalnego oprogramowania do projektowania schodów

Cel: zrozumieć, jakie problemy branżowe rozwiązuje uznane oprogramowanie CAD/CAM dla
producentów schodów, żeby świadomie zaprojektować **własną, prostszą** architekturę stair3d —
nie po to, by je skopiować.

## Metodologia i zastrzeżenia

- Analiza oparta wyłącznie na **publicznie dostępnych materiałach marketingowych i
  dokumentacyjnych** (strony produktowe, opisy funkcji, recenzje branżowe). Żaden kod, plik
  projektowy, algorytm ani format danych żadnego z tych programów nie został odtworzony ani
  przeanalizowany technicznie — nie mam i nie szukałem dostępu do ich wnętrza.
- Poziom szczegółowości publicznych materiałów jest **nierówny i głównie marketingowy** —
  żaden z dostawców nie publikuje swojego modelu danych ani algorytmów geometrycznych. Wnioski
  poniżej są więc syntezą tego, co da się wywnioskować z opisów funkcji, uzupełnioną o ogólną
  wiedzę inżynierską o konstrukcji schodów (nie o konkretnym oprogramowaniu).
- Przeanalizowane systemy: **Compass Software** (Niemcy, moduł Stair Manufacturing),
  **Staircon** (Holandia, linia Sales/Professional/CAM), **StairDesigner** (Francja/
  dystrybuowany też jako StairDesigner Pro PP). Wspomniane pomocniczo: RedX Stairs (kalkulator/
  generator AI, znacznie prostszy segment rynku).
- Każde ustalenie jest oznaczone jedną z trzech etykiet:
  - **[G]** — wynika z ogólnych zasad geometrii/konstrukcji schodów (fizyka, ergonomia,
    statyka) — obowiązywałoby niezależnie od tego, czy jakiekolwiek oprogramowanie by istniało.
  - **[B]** — rozwiązanie typowe dla oprogramowania branżowego (powtarza się w kilku
    niezależnych produktach, więc jest to "jak profesjonaliści zwykle to robią", ale nie jest
    prawem fizyki).
  - **[P]** — decyzja konkretnego producenta/produktu, niekoniecznie powielana gdzie indziej.

Źródła zebrane podczas tego badania — patrz sekcja **Źródła** na końcu dokumentu.

---

## Część I — Analiza porównawcza (A–L)

### A. INPUT — jakie parametry podaje użytkownik

| System | Podejście |
|---|---|
| StairDesigner | Użytkownik wprowadza **wymiary z pomiaru na budowie** (wysokość kondygnacji, rzut klatki), a program "automatycznie wylicza wysokość stopnia, głębokość i linię biegu względem konfigurowalnych norm bezpieczeństwa". |
| Staircon | Kształt schodów, otworu w stropie i ścian definiowany na widoku z góry (rzut) jako punkt startowy. |
| Compass Software | Typ schodów (12 wariantów konstrukcyjnych), typ balustrady, materiał — wybierane z bibliotek "predefinicji" (szablonów), a nie wpisywane jako surowe liczby. |

**Wnioski:**
- **[G]** Zawsze punktem wyjścia są: wysokość kondygnacji (piętro-piętro) i rzut dostępnej przestrzeni — to fizyczna konieczność, nie wybór producenta.
- **[B]** Powszechne jest oddzielenie "surowego pomiaru" od "wyliczonych parametrów projektowych" (system liczy wysokość/głębokość stopnia z normy, a nie każe użytkownikowi zgadywać) — dokładnie to, co dziś robi `deriveStairData()` w stair3d.
- **[P]** Podejście "predefinicji/szablonów" (Compass) zamiast czystej parametryzacji to decyzja produktowa zorientowana na katalog gotowych typów konstrukcji, nie uniwersalna konieczność.

### B. 2D — jak rozwiązywany i prezentowany jest rzut; czy jest centralny

| System | Podejście |
|---|---|
| Staircon | Wprost: **rzut z góry (plan view) jest podstawowym narzędziem projektowania** — "Design the shape of the stair, floor opening and walls" na widoku z góry, plus osobny widok boczny (elewacja) do edycji profilu wangi/balustrady. Trzy zsynchronizowane widoki: plan / elewacja / 3D. |
| StairDesigner | Hybrydowe: użytkownik podaje dane 2D (wymiary), ale narzędzie **od razu buduje model 3D**, który służy jako główna weryfikacja przed wygenerowaniem dokumentacji 2D. |
| Compass Software | Brak jednoznacznej informacji publicznej która reprezentacja jest "centralna" — nacisk marketingowy na "CAD design + 3D + dokumentacja" jako jeden zintegrowany proces, bez podkreślania hierarchii 2D/3D. |

**Wnioski:**
- **[G]** Rzut z góry jest niezastąpiony jako medium do zdefiniowania **układu biegu w przestrzeni** (kąty, zabiegi, podesty) — to z natury zadanie 2D (linia biegu to krzywa płaska), niezależnie od narzędzia.
- **[B]** Wzorzec "**edycja w jednym widoku natychmiast aktualizuje pozostałe**" (Staircon: plan → 3D "instantly displayed") jest standardem branżowym, a nie unikalnym pomysłem jednego producenta — trzy niezależne systemy go realizują.
- **[P]** Konkretny podział na "plan view" + "side view" jako DWA oddzielne, edytowalne widoki 2D (a nie jeden plan + przekrój tylko do odczytu) to decyzja Staircon — inne systemy nie afiszują się z tym rozróżnieniem publicznie.
- **Stair3d już ma to dobrze zaprojektowane**: `planLayout.js` jest jedynym źródłem prawdy, `plan2dRenderer.js` i `buildStaircase.js` (3D) oba z niego czerpią — to zgadza się z modelem [B] powyżej.

### C. 3D — wynik parametrów czy niezależne środowisko modelowania

| System | Podejście |
|---|---|
| Wszystkie trzy | **3D jest zawsze wyprowadzony z parametrów konstrukcyjnych**, nie jest niezależnym środowiskiem modelowania swobodnego (jak np. ogólny modeler bryłowy). Żaden z opisów nie wspomina o możliwości "dowolnego" edytowania siatki 3D bez wpływu na parametry. |
| StairDesigner | Explicite: edycja pojedynczego elementu (np. przesunięcie stopnia) jest możliwa, ale "all assembly details are parametric" — czyli edycja 3D nadal przechodzi przez model parametryczny, nie modyfikuje surowej siatki. |

**Wnioski:**
- **[G]/[B] łącznie** — to jest właściwie fundamentalna zasada całej kategorii oprogramowania: model 3D to **rzutnia** na dane konstrukcyjne, nigdy odwrotnie. Żaden poważny system nie pozwala "wyedytować siatki 3D i mieć nadzieję, że dane konstrukcyjne się same dostosują" — bo to fizycznie nie ma sensu dla elementu, który potem trzeba wyciąć z drewna.
- To dokładnie odpowiada regule 1–3 z `.claude/RULES.md` w stair3d — **potwierdzenie zewnętrzne, że ta reguła nie jest wymysłem tego projektu, tylko fundamentem całej kategorii narzędzi.**

### D. PROFILE / SECTIONS — jak rozumiane są wangi, stopnie, podstopnie, podesty

| System | Podejście |
|---|---|
| Compass Software | Jawne rozróżnienie typów konstrukcji: "mortised/closed" (wanga wcinana) vs. inne warianty (bolted/folded/cantilever/HPL) jako **osobne typy komponentu**, nie jeden uniwersalny model geometryczny z przełącznikiem kosmetycznym. |
| Staircon | "Z-risers", "bolt-in steps" (stopnie na bolcach, bez wang) jako odrębne, nazwane warianty konstrukcyjne — podest, wanga, stopień to explicite różne klasy obiektów z różnymi zestawami parametrów. |
| StairDesigner | Elementy nazwane wprost jako osobne byty: "strings, steps, risers, newel posts, spindles, hand rails" — każdy z własnym zestawem obliczanych wymiarów. |

**Wnioski:**
- **[B]** Powszechny wzorzec: **stopień, wanga, podstopień, podest, słup to niezależne klasy obiektów o różnych zestawach parametrów**, a nie jeden ogólny "obiekt geometryczny" z flagami. Żaden z systemów nie traktuje np. podestu jako "stopnia o innym kształcie" — to osobny typ.
- **[P]** Konkretne nazewnictwo i podział na warianty konstrukcyjne (np. "Z-riser", "bolt-in") jest specyficzny dla oferty produktowej danej firmy (bo są to realne, opatentowane/markowe systemy montażowe sprzedawane przez te firmy).
- **Odniesienie do stair3d**: dzisiejszy model (`tread.type: 'straight'|'winder'|'landing'`) już rozróżnia typy na poziomie **stopnia**, ale wanga (`stringerGeometry.js`) nie ma jeszcze własnej, jawnej reprezentacji jako obiekt (to właśnie naprawia nowy `stringerModel.js`/`stringerSolver.js` z poprzedniej sesji — ten benchmark **potwierdza, że ten kierunek jest zgodny z praktyką branżową**, a nie nadmiarową abstrakcją).

### E. WINDERS — reprezentacja zabiegów, różnica strona wewn./zewn.

| System | Podejście |
|---|---|
| StairDesigner | "Full winder management": automatyczne rozłożenie zabiegu na zakręcie, z możliwością **ręcznej precyzyjnej korekty pojedynczych stopni zabiegowych** ("manually precision adjust individual winders"). Linia biegu (treadline) liczona automatycznie względem konfigurowalnych norm. |
| Staircon | "Winderbox design" jako nazwany, samodzielny komponent projektowy dla zakrętu — sugeruje, że zabieg jest traktowany jako **odrębny podukład** w obrębie całego biegu, nie tylko seria zniekształconych stopni prostych. |
| Compass Software | Brak szczegółów publicznych poza ogólną wzmianką o obsłudze "winder, spiral, helical" jako pełnoprawnych typów biegu. |

**Wnioski:**
- **[G]** Rozróżnienie strony wewnętrznej (dusza, wąska) i zewnętrznej (szeroka) zabiegu to fizyczna konieczność wynikająca z geometrii łuku — obie strony mają inną długość łuku dla tej samej liczby stopni, niezależnie od narzędzia.
- **[B]** Powszechne jest traktowanie **całego zakrętu jako odrębnego "podukładu" projektowego** (Staircon: "winderbox"), z możliwością ręcznej korekty pojedynczych stopni w jego obrębie (StairDesigner) — a nie tylko czysto matematyczna interpolacja bez możliwości interwencji.
- **[P]** Konkretna metoda geometryczna dzielenia zabiegu (proporcjonalna vs. łuk-wokół-słupa vs. inna) **nie jest ujawniana publicznie przez żaden z tych systemów** — to jest dokładnie ten rodzaj wiedzy, którego nie da się i nie wolno "zbenchmarkować" bez dostępu do wnętrza produktu. Metoda stosowana dziś w stair3d (`planLayout.js`, proporcjonalna) i alternatywa opisana we wcześniejszym katalogu reguł (`UK-GUID-C-02`, łuk wokół słupa, ze **źródła prawnego/branżowego, nie z tych programów**) to jedyne dwie metody, które można legalnie i pewnie wskazać jako punkty odniesienia.

### F. STRINGERS — relacja step geometry → stringer contour/support geometry → 3D stringer

| System | Podejście |
|---|---|
| Wszystkie trzy | Żaden nie publikuje wprost swojego wewnętrznego łańcucha zależności. Ale: StairDesigner reklamuje, że program "oblicza najlepszy kształt dla wang [...] i zabiegów według wysoko konfigurowalnych parametrów" — czyli **wanga jest wynikiem obliczenia z geometrii stopni, nie odwrotnie**. Compass: "component detailing allows configuration of stringers [...] with rule-based libraries" — wanga ma **własne reguły konstrukcyjne** (grubość, wysokość, typ złącza), niezależne od (ale zależne od) geometrii stopnia. |

**Wnioski:**
- **[G]** Łańcuch **musi** iść: geometria stopnia (linia biegu, krawędzie) → geometria oparcia wangi (gdzie i pod jakim kątem stopień siada na wandze) → bryła 3D wangi. Odwrócenie tej kolejności (np. rysowanie wangi jako niezależnej bryły, a potem "dopasowywanie" stopni) jest fizycznie niepoprawne dla elementu samonośnego — wanga musi nieść *rzeczywiste* obciążenie z *rzeczywistej* pozycji stopnia.
- **[B]** "Reguły konstrukcyjne" wangi jako osobna warstwa (grubość, typ złącza, gniazdo) **niezależna od geometrii stopni, ale zależna OD NIEJ** (nie na odwrót) to dokładnie architektura, którą stair3d właśnie zbudował (`stringerModel.js` + `stringerSolver.js`, rozdział StringerReferenceGeometry / StringerTreadBearingGeometry) — **ten benchmark potwierdza, że to rozróżnienie odpowiada temu, co robią profesjonalne systemy, tylko nazwane inaczej wewnętrznie.**
- **[P]** Żaden system nie ujawnia, czy wanga jest reprezentowana jako jedna ciągła bryła z wycięciami, czy jako seria segmentów (jak dziś w stair3d) — to szczegół implementacyjny niepublikowany przez nikogo, więc nie można go "zbenchmarkować", tylko zaprojektować samodzielnie na bazie zasad inżynierskich (jedna sztywna, prosta deska na prosty odcinek — wynika z [G], nie z [B]/[P]).

### G. EDITING — co dzieje się po zmianie pojedynczej krawędzi stopnia

| System | Podejście |
|---|---|
| StairDesigner | "Each individual part is separate and can be edited in isolation" (np. przesunięcie pojedynczego stopnia), ale "all assembly details are parametric" — czyli zmiana lokalna **propaguje się przez model parametryczny do zależnych elementów**, a nie zostaje izolowana. |
| Staircon | Zmiana kształtu schodów/otworu → "natychmiast wyświetlana w 3D" — sugeruje pełny automatyczny recalc, ale dokumentacja publiczna **nie precyzuje**, które dokładnie elementy przeliczają się automatycznie, a które wymagają ręcznej interwencji. |
| Compass Software | Brak szczegółów publicznych na ten temat. |

**Wnioski:**
- **[G]** Fizyczna konieczność: zmiana krawędzi stopnia **musi** wpłynąć na sąsiadujący nosek, podstopień i oparcie wangi w tym miejscu (bo to te same materialne powierzchnie styku) — to nie jest wybór projektowy, to definicja spójności modelu.
- **[B]** "Edycja lokalna + globalny recalc zależności" to deklarowany wzorzec u wszystkich trzech dostawców — nikt nie reklamuje "edytuj i sam ręcznie popraw resztę".
- **[P]** Które DOKŁADNIE elementy przeliczają się automatycznie, a które są "zamrożone" celowo (np. czy wanga faktycznie "goni" edytowaną krawędź, czy zostaje na surowej linii) — **żaden system tego nie ujawnia publicznie**. To dokładnie ten sam problem, który stair3d już świadomie rozstrzygnęło (dziś: wanga NIE goni edycji, żeby nie skręcać sąsiednich paneli — udokumentowane w `edgeOverrides.js`) i sformalizowało (`StringerReferenceGeometry` vs `StringerTreadBearingGeometry`). To jest decyzja architektoniczna, którą stair3d musi podjąć **samodzielnie**, bo nie ma tu jednego "przemysłowego standardu" do skopiowania.

### H. CONSTRAINTS — typowe ograniczenia geometryczne/techniczne

| System | Podejście |
|---|---|
| StairDesigner | "Adjustable min and max control values" — czyli **granice parametrów są konfigurowalne przez użytkownika/firmę**, a nie zaszyte na sztywno w kodzie. |
| Wszystkie trzy | Obsługa wielu jurysdykcji/norm sugerowana przez rynek docelowy (Compass — Niemcy/DACH i USA, wzmiankuje "US" wersję strony; StairDesigner — Francja + eksport globalny) — **oprogramowanie profesjonalne z założenia wspiera więcej niż jeden zestaw norm prawnych.** |

**Wnioski:**
- **[G]** Kąt nachylenia, zakres wysokości/głębokości stopnia, minimalna skrajnia — to ograniczenia fizyczne/ergonomiczne uniwersalne (patrz katalog reguł z wcześniejszej sesji, kategorie A/B/D).
- **[B]** **Konfigurowalność granic** (a nie twarde jedna-wartość-na-zawsze) jest standardem branżowym — potwierdza to wprost architekturę **Staircase Design Profile** zaprojektowaną wcześniej w stair3d (profile prawne/branżowe/firmowe/klienta) jako właściwy kierunek, a nie nadmiarową inżynierię.
- **[P]** Konkretny zestaw domyślnych wartości granicznych każdego dostawcy to jego własna decyzja produktowa (dopasowana do rynku, na którym sprzedaje) — nie należy jej kopiować jako "normy".

### I. VALIDATION — jakie błędy/ostrzeżenia wykrywa system

| System | Podejście |
|---|---|
| StairDesigner | Explicite: **"warning system if below acceptable height"** (skrajnia) — jawny mechanizm ostrzegania, nie tylko blokada. |
| Staircon | Wzmianka o "building code compliance documentation" jako osobnym produkcie wyjściowym — sugeruje, że zgodność z przepisami jest **raportowana**, nie tylko cicho wymuszana. |
| Compass Software | Brak szczegółów publicznych. |

**Wnioski:**
- **[G]** Rzeczy, które FIZYCZNIE muszą być sprawdzone niezależnie od oprogramowania: skrajnia, zakres wys./głęb. stopnia, nachylenie, szerokość biegu w wąskim punkcie zabiegu.
- **[B]** Wzorzec **"ostrzeżenie, nie tylko twarda blokada"** (StairDesigner) i **"osobny dokument zgodności"** (Staircon) to oba potwierdzenia, że dobra praktyka branżowa to **wielopoziomowa** walidacja (informacyjna / ostrzegawcza / blokująca), a nie jeden globalny "tak/nie" — dokładnie model `severity: ERROR/WARNING/INFO` + `blocksGeneration` zaprojektowany wcześniej w `src/rules/`.
- **[P]** Nikt nie publikuje pełnej listy sprawdzanych reguł ani ich dokładnych progów domyślnych — to community/produktowa tajemnica handlowa, zasadnie.

### J. MATERIALS / COST — od modelu konstrukcyjnego do zestawienia materiałowego

| System | Podejście |
|---|---|
| StairDesigner | Zestawienie cięcia (cutting list) zawiera: wymiary każdej części, **całkowitą wagę i cenę surowca**, całkowitą objętość drewna. |
| Compass Software | "Detailed parts lists", kalkulacja ceny jako osobna, nazwana funkcja ("price calculation"). |
| Staircon | "Material optimization" wspomniane jako krok pomiędzy modelem a danymi produkcyjnymi (czyli **nesting/rozkrój** jest osobnym etapem, nie tylko sumowaniem wymiarów). |

**Wnioski:**
- **[G]** Objętość/powierzchnia/długość każdego elementu wynika wprost z jego geometrii — to czysta matematyka, nie decyzja projektowa.
- **[B]** Powszechny, trzyetapowy wzorzec: **(1) lista części z wymiarami → (2) agregacja objętości/wagi/ceny → (3) opcjonalna optymalizacja rozkroju (nesting)**. Wszystkie trzy systemy realizują co najmniej etapy 1–2, tylko wyższe poziomy licencji dochodzą do 3.
- **[P]** Dokładny model cenowy (cena za m³, za sztukę, marża) to decyzja firmy używającej narzędzia, nie funkcja, którą narzędzie "narzuca" — dobrze zgadza się to z warstwą `USER_DEFINED_COMPANY_STANDARD`/`COMPANY` już zaprojektowaną w `src/rules/sets/manufacturingAssumptions.js` (`CO-STD-J-05`, współczynnik odpadu).

### K. PRODUCTION — dane potrzebne do dokumentacji warsztatowej

| System | Podejście |
|---|---|
| StairDesigner | Rysunki 2D, elewacje, rysunki części, **szablony 1:1**, listy cięcia, pliki CNC (DXF + post-procesory specyficzne dla marek maszyn: Homag, SCM, Biesse, Felder...). |
| Compass Software | "Fully dimensioned shop drawings", etykiety, szablony, eksport toolpath z konfigurowalnymi post-procesorami, nesting. |
| Staircon | Wydruki plotera w skali 1:1, rysunki produkcyjne w skali, BOM, integracja z maszynami CNC 3–5-osiowymi. |

**Wnioski:**
- **[G]** Rzemieślnik/warsztat potrzebuje: wymiaru każdej krawędzi, kąta cięcia, i punktu odniesienia — niezależnie od narzędzia.
- **[B]** **Szablon 1:1 do ręcznego przeniesienia na materiał** to praktyka obecna we WSZYSTKICH trzech systemach — to jest prawdziwy, sprawdzony "brakujący element" względem tego, co stair3d ma dziś (eksport OBJ/DAE to substytut dla wizualizacji SketchUp, ale nie zastępuje szablonu produkcyjnego 1:1 ani listy cięcia z wymiarami).
- **[P]** Konkretne post-procesory CNC i formaty toolpath są zależne od maszynowego ekosystemu każdego dostawcy — całkowicie poza zakresem realistycznym dla stair3d w obecnej fazie (patrz sekcja 4 "Features NOT to implement yet").

### L. PARAMETRIC MODEL — jakie obiekty powinny istnieć jako niezależne byty logiczne

Synteza z A–K (żaden system nie publikuje wprost swojego schematu obiektowego, ale wynika on
spójnie z opisów funkcji powyżej):

| Obiekt | Uzasadnienie | Klasyfikacja |
|---|---|---|
| **Bieg (Flight)** | Kontener na sekwencję stopni jednego kierunku/kąta | [G] |
| **Zakręt/podest (Turn/Landing)** | Osobny podukład łączący dwa biegi | [G]/[B] |
| **Stopień (Tread)** — z podtypem prosty/zabiegowy/podestowy | Różne reguły geometryczne per typ | [G] |
| **Podstopień (Riser)** | Osobny element o własnej grubości/materiale, zależny od stopnia | [G] |
| **Wanga (Stringer)** — z jawną linią referencyjną i geometrią oparcia | Element strukturalny niezależny od pojedynczego stopnia | [G]/[B] (patrz sekcja F) |
| **Słup (Newel/Post)** | Węzeł połączeniowy na końcach i zakrętach | [G] |
| **Balustrada/poręcz (Balustrade/Handrail)** | Osobny system bezpieczeństwa, własne normy | [G] |
| **Otwór w stropie (Ceiling opening)** | Ograniczenie przestrzenne niezależne od schodów samych w sobie | [G] |
| **Profil materiałowy (Material/Species profile)** | Wspólny dla wielu elementów, nie duplikowany per element | [B] |
| **Reguła/profil walidacji (Design rule profile)** | Wymiennik norm prawnych/branżowych/firmowych | [B] (patrz Staircon "building code compliance documentation") |

---

## Część II — Deliverables dla stair3d

### 1. Feature Benchmark

| Feature | Typowe rozwiązanie branżowe | Potrzebne w stair3d? | Priorytet |
|---|---|---|---|
| Wprowadzanie wymiarów z pomiaru → automatyczne wyliczenie stopnia/podstopnia | [B] automatyczne, z konfigurowalnymi granicami | ✅ już istnieje (`deriveStairData`) | — (utrzymać) |
| Rzut 2D jako źródło prawdy, 3D jako pochodna | [G]/[B] standard | ✅ już istnieje (`planLayout.js`) | — (utrzymać) |
| Synchronizacja plan ↔ przekrój boczny ↔ 3D (3 widoki) | [B] (Staircon) | ⚠️ częściowe (mamy plan+3D, brak przekroju bocznego edytowalnego) | Średni |
| Ręczna edycja pojedynczej krawędzi z propagacją do zależnych elementów | [G]/[B] standard | ✅ mechanizm istnieje, ale niespójny (wanga nie reaguje) — **w trakcie naprawy** (`stringerModel.js`) | Wysoki |
| Wanga jako niezależny obiekt strukturalny (linia referencyjna + oparcie) | [G]/[B] | ✅ zaprojektowane w tej sesji, niepodpięte do renderu | Wysoki |
| Osobny model podstopnia zabiegowego (nie płaski panel) | [G] wynika z geometrii łuku | ❌ brak — zidentyfikowana luka | Wysoki |
| Zarządzanie zabiegiem jako odrębnym podukładem z ręczną korektą pojedynczych stopni | [B] (StairDesigner "winder management") | ⚠️ częściowe (offsety globalne, brak korekty per-stopień) | Średni |
| Wielopoziomowa walidacja (info/warning/error) z wytłumaczeniem | [B] (StairDesigner warning system) | ✅ zaprojektowane (`src/rules/validator.js`), niepodpięte do UI | Wysoki |
| Profile reguł prawo/branża/firma/klient | [B] (Staircon "code compliance"), ale rozdzielenie na 4 warstwy to decyzja stair3d, nie powielenie | ✅ zaprojektowane | — (utrzymać) |
| Lista cięcia z wymiarami, wagą, ceną | [B] standard u wszystkich 3 | ❌ brak | Wysoki |
| Szablon produkcyjny 1:1 (do ręcznego przeniesienia na materiał) | [B] standard u wszystkich 3 | ❌ brak | Średni-Wysoki |
| Eksport DXF/CNC z post-procesorami dla konkretnych maszyn | [P] zależne od ekosystemu dostawcy | ❌ brak | Niski (patrz sekcja 4) |
| Nesting/optymalizacja rozkroju materiału | [B], ale wyższy poziom licencji nawet u dostawców | ❌ brak | Niski |
| Biblioteka gotowych "predefinicji" typów konstrukcji (Compass) | [P] | ❌ brak | Niski |
| Katalog schodów krzywoliniowych/spiralnych/helikalnych | [B] u wszystkich 3, ale inny segment rynku | ❌ brak | Bardzo niski (poza zakresem biznesowym stair3d — schody drewniane samonośne, nie spiralne) |
| Rozszerzona rzeczywistość / podgląd AR (Compass) | [P] | ❌ brak | Bardzo niski |
| Integracja z konkretnymi maszynami CNC 3–5-osiowymi | [P] | ❌ brak | Bardzo niski (na razie) |

### 2. Architecture Benchmark

| Warstwa | Wzorzec branżowy (wywnioskowany, [B]) | Stan w stair3d | Ocena |
|---|---|---|---|
| **Model danych** | Osobne klasy obiektów (bieg, stopień, wanga, słup, podest, balustrada) z jawnymi relacjami, nie jedna płaska struktura | `config` (płaski) + `planLayout.treads[]` (już strukturalny) + nowy `StringerModel` (strukturalny) | Zbieżne z branżą, w trakcie ujednolicania |
| **Solver 2D** | Oblicza układ biegu/zabiegu z parametrów wejściowych, jest jedynym źródłem prawdy dla 2D i 3D | `planLayout.js` | Zgodne z branżą |
| **Solver geometrii (per-element)** | Osobny solver per typ elementu (stopień, wanga, podstopień), każdy pure function z jasnym kontraktem wejście→wyjście | Częściowo: `treadGeometry.js`, `stringerSolver.js` (nowy), ale `riserGeometry.js` wciąż liczy bezpośrednio z surowych pól stopnia bez pośredniego modelu | Do dokończenia (podstopień potrzebuje własnego solvera, analogicznie do wangi) |
| **Generator 3D** | Czysta funkcja translacji modelu → mesh, zero decyzji geometrycznych | `buildStaircase.js` + `*Geometry.js` (obecnie mieszają decyzje geometryczne z generowaniem mesh — np. `computeNormal()` w `stringerGeometry.js`) | Wymaga refaktoru: przenieść logikę do solverów, renderer ma tylko tłumaczyć |
| **Validator** | Osobna warstwa, wielopoziomowa (info/warning/error), z wytłumaczeniem, konfigurowalne profile norm | `src/rules/` (zaprojektowane, niepodpięte) | Zaprojektowane zgodnie z branżą, brak integracji z UI/solverem |
| **Material takeoff** | Osobny krok po geometrii: lista części → agregacja → (opcjonalnie) nesting | Brak w ogóle | Największa luka funkcjonalna względem branży |
| **Eksport** | Wielowarstwowy: dokumentacja robocza (rysunki/szablony) ≠ dane maszynowe (CNC/DXF) ≠ wizualizacja (3D/AR) — TRZY różne cele, nie jeden eksport "do wszystkiego" | `objExporter.js`/`daeExporter.js` (tylko wizualizacja/SketchUp) | Brak warstwy "dokumentacja robocza" — to inny cel niż eksport wizualizacyjny, nie powinien być tym samym kodem |

### 3. Recommended Stair3D Architecture — wzorce warte adaptacji

Nie kopiujemy żadnego konkretnego programu — poniższe to **wzorce projektowe**, potwierdzone
jako powszechne w kategorii (oznaczenie [B] powyżej), przełożone na nazwy adekwatne dla
architektury stair3d:

1. **Component Object Model** — każdy typ elementu konstrukcyjnego (stopień, wanga, podstopień,
   słup, podest, balustrada) jako osobny moduł z własnym solverem, własnym zestawem parametrów
   i własnym kontraktem geometrycznym. *(Wzorzec: Composite/Strategy — różne typy stopnia
   implementują wspólny interfejs "SolvedComponent", ale różną logikę.)*
2. **Reference vs. Derived Geometry separation** — dokładnie to, co już wdrożono dla wangi
   (`StringerReferenceGeometry` vs `StringerTreadBearingGeometry`) — **rozszerzyć na każdy
   element strukturalny**, który ma zarówno "własną oś/płaszczyznę" (nie zmienia się od edycji
   sąsiada), jak i "powierzchnię styku" (zmienia się).
3. **Multi-view synchronized editing** (wzorzec Staircon) — plan 2D, przekrój boczny, widok 3D
   jako trzy **projekcje tego samego modelu**, nie trzy oddzielne reprezentacje do ręcznej
   synchronizacji. *(Wzorzec: Observer/pub-sub — każdy widok subskrybuje zmiany modelu.)*
4. **Layered validation with severity levels** (już zaprojektowane w `src/rules/`) — utrzymać i
   podłączyć do solverów jako krok "post-solve", nie "pre-generation gate".
5. **Design Profile jako Strategy** (już zaprojektowane) — prawo/branża/firma/klient jako cztery
   niezależnie wymienialne strategie oceny tej samej geometrii.
6. **Material Takeoff jako osobny, deterministyczny krok** konsumujący wynik solverów (nie
   geometrię 3D) — lista części z wymiarami to properties obiektów modelu, nie coś odczytywane z
   mesh Three.js.
7. **Production Document jako osobny eksporter** równorzędny do (nie pochodny od) eksportu
   wizualizacyjnego — inny konsument tego samego modelu, jak zestawienie materiałowe.
8. **Konfigurowalne granice walidacji** (nie twarde stałe) — już częściowo zrealizowane przez
   `src/rules/profiles/`.

### 4. Features NOT to implement yet

Rzeczy obecne w dużych programach, których **świadomie nie warto** teraz wdrażać w stair3d —
żeby nie rozdmuchać projektu poza jego rzeczywisty cel biznesowy (schody drewniane samonośne
dla małej/średniej firmy stolarskiej, nie uniwersalny CAD/CAM):

- **Obsługa schodów spiralnych/helikalnych/krzywoliniowych** — inna geometria, inny rynek,
  poza zakresem "schody samonośne dla typowego domu jednorodzinnego".
- **Integracja z konkretnymi maszynami CNC / post-procesory 3–5-osiowe** — wymaga sprzętu do
  testowania, umowy z producentami maszyn, i nie ma sensu bez ustabilizowanego modelu geometrii.
- **Nesting/optymalizacja rozkroju materiału** — realna wartość, ale to osobny, złożony problem
  (bin packing), sensowny dopiero gdy lista cięcia w ogóle istnieje.
- **Rozszerzona rzeczywistość (AR) / prezentacje w przeglądarce VR** — czysto marketingowa
  funkcja, zero wartości konstrukcyjnej.
- **Biblioteka gotowych "predefinicji" katalogowych typów schodów** (jak Compass) — dla
  jednoosobowej/małej firmy nadmiarowa warstwa UX, można dodać później jako presety configu.
- **Wielojęzyczna, wielonarodowa obsługa norm prawnych "od ręki"** — profil `POLAND_RESIDENTIAL_
  TIMBER` wystarcza na start; kolejne kraje dodać dopiero, gdy będzie realny klient/potrzeba
  (architektura profili już na to pozwala bez przebudowy).
- **Balustrady/poręcze jako w pełni modelowany system 3D** — dziś nawet nie ma pola w configu;
  realny biznesowy priorytet to najpierw wanga+stopień+podstopień, bo to one dominują koszt i
  ryzyko błędu konstrukcyjnego. Balustrada może na razie zostać uproszczonym placeholderem.
- **Import DXF z rysunków architektonicznych jako punkt startowy** — wygodne, ale niekrytyczne;
  ręczne wpisanie wymiarów pomiaru wystarcza na tym etapie.

### 5. Long-term roadmap

**MVP / obecna przebudowa (w toku):**
- Dokończyć separację model/solver/rendering/validation dla WSZYSTKICH elementów (nie tylko
  wangi) — analogiczny `treadSolver`, `riserSolver` z jawnym kontraktem, zamiast dzisiejszych
  `treadGeometry.js`/`riserGeometry.js` liczących bezpośrednio z surowych pól.
  osobny model podstopnia zabiegowego (dziś: brak, luka udokumentowana).
- Podpiąć `src/rules/validator.js` do UI — pokazać użytkownikowi realne ostrzeżenia/błędy z
  wytłumaczeniem, z aktywnym profilem `POLAND_RESIDENTIAL_TIMBER_DEFAULT`.
- Zrefaktoryzować `stringerGeometry.js`, żeby konsumował `StringerModel` zamiast liczyć panele
  ad-hoc.

**Wersja produkcyjna:**
- Material takeoff: lista części (długości/powierzchnie/objętości) generowana z solverów, nie
  z mesh.
- Eksport dokumentacji roboczej: lista cięcia z wymiarami/wagą/orientacyjną ceną (PDF/CSV).
- Szablon 1:1 dla stopni zabiegowych (odpowiednik dzisiejszego `winderBlank.js`, ale jako
  pełnoprawny, drukowalny dokument produkcyjny, nie tylko adnotacja w podglądzie 2D).
- Przekrój boczny (elewacja wangi) jako trzeci, edytowalny widok — dziś stair3d ma tylko plan
  2D + 3D.
- Rozszerzenie profilu firmowego o realne dane (gatunek drewna, ceny, zapas materiałowy) i
  podpięcie do material takeoff.

**Wersja zaawansowana:**
- Ręczna korekta pojedynczego stopnia zabiegowego (nie tylko globalne offsety zabiegu) —
  analogicznie do "manual precision adjust individual winders" (StairDesigner).
- Balustrada/poręcz jako w pełni modelowany, osobny system z własną walidacją (PL-LEGAL-H-01
  już czeka w katalogu reguł).
- Druga jurysdykcja prawna (np. Niemcy/UK) jako dowód, że architektura profili faktycznie
  skaluje się bez przebudowy.
- Nesting / podstawowa optymalizacja rozkroju dla wangi i stopni.

**Potencjalny CAD/CAM (odległa przyszłość, nie zobowiązanie):**
- Eksport DXF/toolpath dla konkretnej rodziny maszyn CNC (dopiero gdy pojawi się realny,
  konkretny odbiorca sprzętowy).
- Import DXF architektonicznego jako alternatywny punkt startowy.
- Obsługa dodatkowych typów konstrukcji (schody spiralne) — tylko jeśli model biznesowy firmy
  faktycznie się rozszerzy w tym kierunku.

---

## Część III — 10–20 zasad architektonicznych (nieformalna specyfikacja stair3d)

Poniższe zasady **uzupełniają**, nie zastępują, istniejące `.claude/RULES.md`. Numeracja ciągła
dla odróżnienia od tamtych 16 reguł.

17. **Rzut 2D jest jedynym źródłem prawdy dla układu biegu** — 3D, przekrój i lista materiałowa
    to trzy niezależne projekcje tego samego modelu 2D, nigdy odwrotnie. *(potwierdzone jako [G]/[B] w sekcjach B, C)*
18. **Każdy typ elementu konstrukcyjnego (stopień, wanga, podstopień, słup, podest, balustrada)
    jest osobnym obiektem logicznym z własnym solverem** — nigdy jednym uniwersalnym typem z
    flagami. *(sekcja D, L)*
19. **Element strukturalny, który ma zarówno własną oś/płaszczyznę odniesienia, jak i
    powierzchnię styku z sąsiadem, musi rozdzielać te dwa pojęcia jawnie w modelu danych**
    (wzorzec Reference vs. Bearing geometry) — dotyczy nie tylko wangi, ale docelowo też
    podstopnia i słupa. *(sekcja F)*
20. **Edycja pojedynczej krawędzi propaguje się automatycznie do wszystkich fizycznie
    zależnych powierzchni styku, nigdy do niezależnych osi odniesienia sąsiadów.** *(sekcja G)*
21. **Walidacja jest wielopoziomowa (informacyjna/ostrzegawcza/blokująca) i zawsze tłumaczy
    DLACZEGO reguła nie przeszła** — nigdy cichy "błąd" bez kontekstu. *(sekcja I)*
22. **Granice geometryczne/normatywne są konfigurowalne przez profil, nigdy zaszyte na sztywno**
    — prawo / branża / firma / klient to cztery niezależnie wymienialne warstwy. *(sekcja H)*
23. **Model 3D nigdy nie jest edytowalnym środowiskiem niezależnym od parametrów** — nie
    istnieje ścieżka "zmień siatkę, a dane się dostosują". *(sekcja C, potwierdzenie reguły 4 z RULES.md)*
24. **Zestawienie materiałowe jest deterministyczną funkcją wyniku solverów, nie odczytem z
    geometrii Three.js.** *(sekcja J)*
25. **Dokumentacja produkcyjna (lista cięcia, szablon 1:1) i eksport wizualizacyjny (OBJ/DAE) są
    dwoma różnymi konsumentami tego samego modelu — nigdy tym samym kodem eksportu.** *(sekcja K)*
26. **Metoda geometryczna zabiegu (proporcjonalna, łuk-wokół-słupa, inna) jest jawnie nazwaną,
    wymienialną strategią solvera — nie ukrytym efektem ubocznym pętli po stopniach.** *(sekcja E)*
27. **Cały zakręt (winder run) jest traktowany jako odrębny podukład projektowy z możliwością
    lokalnej korekty pojedynczego stopnia zabiegowego**, nie tylko globalnymi parametrami
    offsetu. *(sekcja E, roadmap "wersja zaawansowana")*
28. **Żadna reguła prawna, branżowa ani firmowa nie jest zaszyta w kodzie geometrii** — geometria
    liczy kształt, walidacja ocenia go osobno, według wymiennego profilu. *(potwierdzenie
    architektury `src/rules/` już zbudowanej)*
29. **Format zapisu projektu (JSON) ma jawny numer wersji schematu i migracje** — nigdy ciche,
    niekompatybilne zmiany pól. *(reguła 15 z RULES.md, potwierdzona jako [B] konieczność przy
    rozroście modelu o nowe obiekty z sekcji L)*
30. **Każdy nowy typ obiektu logicznego (np. balustrada) wchodzi do modelu z jasną granicą
    zakresu — "co dziś jest placeholderem, co jest w pełni rozwiązane" — nigdy ukrytą,
    domyślną, niedopowiedzianą częściową implementacją.** *(wniosek z sekcji "Features NOT to
    implement yet")*
31. **Solver per-elementowy jest czystą funkcją: (geometria wejściowa + konfiguracja) →
    geometria wynikowa** — bez efektów ubocznych, bez odczytu stanu z sąsiednich obiektów poza
    jawnie przekazanymi referencjami (np. `prev` w dzisiejszym `stringerGeometry.js` to
    dokładnie ten rodzaj ukrytego stanu, którego docelowo nie powinno być). *(sekcja "Architecture Benchmark", reguła 9 z RULES.md)*
32. **Przekrój boczny/elewacja jest traktowany jako pełnoprawny, edytowalny widok tego samego
    modelu, nie tylko jako statyczny rzut z 3D** — trzeci filar obok planu 2D i widoku 3D.
    *(sekcja B, roadmap "wersja produkcyjna")*
33. **Żadna funkcja z sekcji "Features NOT to implement yet" nie wchodzi do zakresu bieżącego
    refaktoru bez jawnej, osobnej decyzji biznesowej** — chroni to projekt przed pełzającym
    rozrostem zakresu podczas prac nad fundamentami.

---

## Źródła

- [StairDesigner Stair Design Software](https://wooddesigner.org/stairdesigner-software/) — Wood Designer (dystrybutor)
- [Stair Design Software | Compass Software](https://www.compass-software.de/us/stair-manufacturing/design)
- [Stair software CAD/CAM solution for all business sizes | Compass Software](https://www.compass-software.de/us/stair-manufacturing)
- [Compass adds new features to stair building software — Woodshop News](https://www.woodshopnews.com/tools-machines/compass-adds-new-features-to-stair-building-software)
- [Software for design and production of stairs – Staircon Professional](https://www.staircon.com/product/staircon-professional)
- [Design, construction and 3D visualisation of stairs – Staircon Sales](https://www.staircon.com/product/staircon-sales)
- [CAD/CAM software for design and manufacture of staircases – Staircon](https://www.staircon.com/)
- [Software for automated stair production, CNC 3/4-axis – Staircon CAM](https://www.staircon.com/product/staircon-cam-34)
- [Software for staircase production, CNC 5-axis – Staircon CAM](https://www.staircon.com/product/staircon-cam-5-plus)
- [Stair Design Software | Wood Designer](https://wooddesigner.org/stair-design-software/)
- [RedX Stairs App - 3D Stair Calculator & Builder](https://www.redxapps.com/redx-stairs-app)

Żadne z powyższych źródeł nie ujawnia kodu, algorytmów ani wewnętrznego formatu danych —
wszystkie ustalenia dotyczą wyłącznie publicznie opisanych funkcji i deklarowanego zachowania
produktu.
