# Etap CONSOLIDATION — analiza i decyzje

Ten dokument realizuje punkt 6 zadania konsolidacji: dla każdego miejsca, gdzie Architecture
Checkpoint wskazał zduplikowaną logikę geometryczną, odpowiada wprost — czy to ten sam
przypadek, czy matematycznie inny, czy powinien korzystać ze wspólnego prymitywu, czy może
zostać lokalny. Cel: **ONE CONCEPT → ONE CANONICAL IMPLEMENTATION**, ale bez sztucznego
scalania rzeczy, które są naprawdę różne.

## 1. "Outward normal" — trzy niezależne implementacje

| Implementacja | Gdzie żyła | Werdykt |
|---|---|---|
| `outwardRearNormal()` | `nosingUtils.js` | **Kanoniczna** dla przypadku "znam tylko kontur i jego krawędź" — zachowana, przemianowana na `outwardNormalFromOutline()`. |
| `computeNormal()` (+ dziedziczenie z poprzedniego panelu) | `stringerGeometry.js` | **USUNIĘTA razem z plikiem.** To nie był inny matematyczny przypadek — to była próba załatania niestabilności centroidu przez odgadywanie normalnej z sąsiedniego panelu. Nowy `stringerRenderer.js` nie potrzebuje ŻADNEGO odpowiednika, bo każdy panel siedzi na już-prostym `segment.referenceLine.direction` — nie ma czego zgadywać. |
| Inline `{-dir.x,-dir.y}` w `riserGeometry.js` (wachlarz zabiegowy) | `riserGeometry.js` | **Genuinely inny przypadek** (kierunek już znany, brak testu centroidu) — wydzielony jako drugi kanoniczny prymityw `outwardNormalFromForward()` w `nosingUtils.js`, bo ta sama potrzeba (kierunek znany z góry) występuje też w `stringerRenderer.js` (`inwardDirection()`). |

**Decyzja:** dwa kanoniczne prymitywy w `nosingUtils.js`, nie jeden — bo to naprawdę dwa różne
pytania ("jaki kierunek?" vs "mam już kierunek, jaka normalna?"), zgodnie z zasadą "nie scalaj
automatycznie wszystkiego".

## 2. Test współliniowości — dwie niezależne implementacje

| Implementacja | Gdzie | Werdykt |
|---|---|---|
| `removeCollinearPoints()` inline cross-check, epsilon `PT_EPS=1e-6` | `planLayout.js` | **Ten sam koncept** co `isCollinear()` w `pathUtils.js` — scalone. `planLayout.js` woła teraz `isCollinear()` z domyślnym `COLLINEAR_EPS`. |
| `isCollinear()` | `pathUtils.js` (wołane przez `stringerSolver.js`) | **Kanoniczna implementacja.** |

**Decyzja:** scalone w jedno. Efekt uboczny (świadomy, przetestowany): epsilon użyty przez
`removeCollinearPoints()` zmienił się z `1e-6` (mm-skala, błędnie użyta do iloczynu
wektorowego mm²-skali) na `COLLINEAR_EPS=1e-2` (poprawna skala) — to naprawia utajoną
niespójność jednostek, nie tylko usuwa duplikat.

## 3. Punkt-równość (`sameAs`/`sameAsPt`) — trzy niezależne implementacje

`nosingUtils.js` (`sameAs`), `planLayout.js` (`sameAsPt`), `stringerSolver.js` (`sameAsPt`) —
identyczna formuła, trzy nazwy, trzy osobne epsilony (wszystkie `1e-6`, ale niezależnie
zdefiniowane, więc podatne na przyszły rozjazd).

**Werdykt:** dokładnie ten sam przypadek. **Decyzja:** jedna funkcja, `pointsEqual()` w
`pathUtils.js`, z domyślnym `GEOMETRY_EPS`. Wszystkie trzy miejsca wywołania zaktualizowane;
żaden alias nie został zachowany.

## 4. Normalizacja wektora (`unit`/`normalize`) — dwie niezależne implementacje

`planLayout.js` (`unit(dx,dy)`, lokalna domknięta funkcja w `buildTurnLocal`) i
`riserGeometry.js` (`normalize(v)`).

**Werdykt:** dokładnie ten sam przypadek (trywialna algebra wektorowa). **Decyzja:** jedna
funkcja, `normalizeVector()` w `pathUtils.js`. `planLayout.js`'s `unit()` pozostał jako cienki,
lokalny adapter zmieniający sygnaturę `(dx,dy) → Vec2D` na `(Vec2D) → Vec2D` — to NIE jest
duplikat logiki, tylko wygodna otoczka wywołania, więc może zostać lokalny.

## 5. Epsilon — cztery niezależne stałe

`EPS` (`nosingUtils.js`), `PT_EPS` (`planLayout.js`), `CORNER_JOIN_EPS` (`stringerGeometry.js`,
usunięty razem z plikiem), `REFERENCE_LINE_EPS_MM` (`stringerModel.js`).

**Werdykt:** trzy naprawdę różne znaczenia matematyczne ukryte pod czterema nazwami (patrz
`src/geometry/tolerances.js` dla pełnego uzasadnienia jednostek):
- "czy te punkty/długości są identyczne" (mm) → `GEOMETRY_EPS`
- "czy to prawdziwy narożnik" (mm², iloczyn wektorowy) → `COLLINEAR_EPS`
- "czy te proste są zbyt równoległe, żeby się przeciąć" (bezwymiarowe) → `INTERSECTION_EPS`

**Decyzja:** trzy nazwane stałe w jednym module (`tolerances.js`), każda z komentarzem
wyjaśniającym jednostkę i uzasadnienie wartości. Kilka **innych** epsilonów (`1e-3` w
`stringerModel.js`, porównujące dwie NIEZALEŻNIE POLICZONE reprezentacje tej samej wielkości)
pozostały lokalne — to naprawdę czwarty rodzaj pytania ("czy dwie niezależne ścieżki obliczeń
dały ten sam wynik"), różny od powyższych trzech, więc scalanie ich zepsułoby, a nie
uprościło, semantykę. Każdy ma inline komentarz tłumaczący, dlaczego nie jest kanoniczny.

## 6. `lineIntersect` (przecięcie dwóch prostych) — jedna implementacja, sprawdzona pod kątem duplikacji

`nosingUtils.js` ma prywatną `lineIntersect(p1,d1,p2,d2)` (przecięcie DWÓCH nieskończonych
prostych, obie zadane punkt+kierunek). `pathUtils.js` ma `projectPointOntoLine(p,lineStart,
lineEnd)` (rzut PUNKTU na prostą zadaną dwoma punktami).

**Werdykt:** matematycznie różne operacje (przecięcie dwóch prostych vs. rzut punktu na
jedną) — mimo pokrewieństwa NIE są tym samym przypadkiem. **Decyzja:** obie zostają, każda w
swoim miejscu; `lineIntersect()` zaktualizowana tylko o wspólny `INTERSECTION_EPS` zamiast
własnego, lokalnego `1e-9`.

## 7. Kierunek poprzeczny / "prawa strona" (`rotate90CW`)

Istniała tylko jedna implementacja (`planLayout.js`), ale używana WYŁĄCZNIE wewnętrznie do
łańcuchowania ramek — nowy `stringerRenderer.js` potrzebował dokładnie tej samej definicji
("która strona jest 'do wnętrza schodów'"), więc **groził** powstaniem drugiej, niezależnej
definicji tego samego kierunku.

**Decyzja:** wyeksportowana z `planLayout.js` (jedyne miejsce definicji), zaimportowana przez
`stringerRenderer.js` — zapobiegawcza konsolidacja, nie naprawa istniejącego duplikatu.

## Podsumowanie decyzji

| # | Koncept | Wynik |
|---|---|---|
| 1 | Outward normal | 2 kanoniczne warianty (różne dane wejściowe), 1 usunięty (był łatką) |
| 2 | Współliniowość | scalone w 1 |
| 3 | Równość punktów | scalone w 1 |
| 4 | Normalizacja wektora | scalone w 1 (+ 1 lokalny adapter sygnatury) |
| 5 | Epsilon | 3 kanoniczne + udokumentowane lokalne wyjątki |
| 6 | Przecięcie prostych vs. rzut punktu | pozostają 2 (różne operacje) |
| 7 | Kierunek poprzeczny | 1 (eksport zapobiegawczy) |

Żadna z tych decyzji nie wprowadziła nowej warstwy abstrakcji ponad to, co było potrzebne do
usunięcia realnego duplikatu lub udokumentowania świadomej różnicy — zgodnie z zastrzeżeniem
"nie twórz kolejnej warstwy abstrakcji tylko po to, aby ukryć bałagan" z briefu tego etapu.
