# Kontrola konstrukcji (orientacyjna) — ciężary, obciążenia, wytrzymałość

Status: **etapy A1 i A2 zaimplementowane** (tablica drewna, współczynniki EC5, ciężar własny wszystkich elementów,
zakładka „Konstrukcja"; stopień jako belka). Etapy A3–A5 — plan poniżej, jeszcze nie ma kodu.

> **To jest kontrola orientacyjna. Nie zastępuje projektu konstrukcyjnego ani obliczeń konstruktora.** Program
> upraszcza schemat statyczny (belki swobodnie podparte, wsporniki), nie liczy połączeń, drgań ani stateczności, a
> część wartości wejściowych nie ma potwierdzonego polskiego źródła (status „do weryfikacji" niżej). Wynik ma
> pomóc zauważyć element wyraźnie za słaby, a nie potwierdzić, że schody są bezpieczne.

## Zasada (bez wyjątku od RULES.md)

`config` + modele (tread/riser/stringer/post/railing) → **pozycje kosztorysu (objętości netto)** → `src/structural/`
(czyste funkcje, bez Three.js, bez liczenia geometrii) → wynik: ciężary, wykorzystania, `Diagnostic`-i.

- Objętości biorę z `computeMaterialTakeoff` (ta sama reguła „ile drewna ma element" co w kosztorysie — RULES #8),
  wywołanego bez bramki walidacji, więc ciężar liczy się także przy zablokowanym kosztorysie.
- Wynik kontroli nigdy nie blokuje kosztorysu ani nie zmienia geometrii: wykorzystanie > 100% = **WARNING**.
- Klasa drewna do obliczeń to osobne pole `config.structuralMaterialClass` (domyślnie **D30**, dąb). Pole
  `timberGrade` (używane przez kosztorys/cennik) zostaje bez zmian.

## Materiał — klasy wytrzymałości (EN 338)

| Klasa | f_m,k [N/mm²] | f_v,k [N/mm²] | E0,mean [kN/mm²] | E0,05 [kN/mm²] | ρk [kg/m³] | ρmean [kg/m³] |
|---|---|---|---|---|---|---|
| C24 | 24 | 2,5 | 11,0 | 7,4 | 350 | 420 |
| D30 | 30 | 3,0 | 10,0 | 8,0 | 530 | 640 |
| D40 | 40 | 3,8 | 11,0 | 9,4 | 590 | 700 |

- **Źródło:** tablica „BS EN 338 table 1" w opracowaniu RoyMech (roymech.org, „Timber") — źródło wtórne, bez
  podanego wydania; wartości odpowiadają **EN 338:2003**. Wydania 2009 i 2016 zmieniły część liczb (m.in. f_v,k,
  E0 dla drewna liściastego), a EN 338:2016 dodało klasy D18/D24/D27. **Status: do weryfikacji z tekstem normy.**
  Starsze f_v,k są niższe (bezpieczniejsze dla kontroli ścinania).
- **D24 nie ma w tablicy** — brak zweryfikowanych wartości; dopisać po sprawdzeniu w EN 338:2016.
- **Dąb = D30** to założenie: klasę nadaje sortowanie wg EN 1912 (EC5-STRUCT-I-02), nie sama nazwa gatunku.
- **Podstopnie z MDF** (gdy w „Cennik i materiały" wybrano MDF): gęstość **750 kg/m³** — typowa wartość z kart
  producentów (zakres ok. 700–800), bez normy; do weryfikacji. MDF nie ma klasy EN 338 i nie jest liczony jako nośny.
- Poręcz i tralki liczone z tą samą klasą drewna co schody (założenie).

## Współczynniki EC5 (EN 1995-1-1) i kombinacje (EN 1990)

- `X_d = k_mod · X_k / γ_M` (EC5-STRUCT-I-03).
- `k_mod`, drewno lite, klasa użytkowania 1 (Tab. 3.1): stałe 0,60 · długotrwałe 0,70 · średniotrwałe 0,80 ·
  krótkotrwałe 0,90 · chwilowe 1,10.
- `γ_M = 1,3` (drewno lite, Tab. 2.3 — wartość zalecana; polski załącznik do weryfikacji).
- `k_def = 0,60` (drewno lite, klasa użytkowania 1, Tab. 3.2).
- Kombinacja SGN: `1,35·G + 1,5·Q` (EN 1990, wartości zalecane; polski załącznik do weryfikacji).
- Klasa trwania: obciążenie użytkowe równomierne = średniotrwałe; siła skupiona i poziome na poręczy/wypełnieniu =
  krótkotrwałe (założenie; do weryfikacji). W kombinacji decyduje obciążenie najkrótsze.

## Obciążenia (parametry w zakładce, jawne źródło)

Decyzja użytkownika: **wartości brytyjskie**, wyraźnie tak oznaczone (polska wartość PL-LEGAL-I-01 nie jest
potwierdzona źródłowo i nie zakładamy, że jest taka sama):

- użytkowe schodów: **1,5 kN/m²** równomierne, **2,0 kN** skupione — UK-GUID-I-01 (UK NA do EN 1991-1-1, kat. A1);
- poziome na poręczy: **0,36 kN/m** — UK-GUID-I-02;
- wypełnienie balustrady: **0,5 kN/m²** (oraz 0,35 kN skupione) — UK-GUID-I-02;
- ugięcie poręczy: ≤ **25 mm** — UK-GUID-I-02.

Stała ostrzeżenie w zakładce: „obciążenia wg brytyjskiego załącznika krajowego — polskie wartości do weryfikacji".

## Kontrole

1. **Ciężar własny (A1, zrobione).** `m = ρmean · V_netto`, `G = m · g` (g = 9,81 m/s²) dla: stopni, podestów,
   podstopni, wang (objętość deski minus wręgi — wręg to materiał usunięty), słupów konstrukcyjnych, słupków
   balustrady, poręczy, tralek. Suma i podział na kategorie. Element bez objętości (np. wanga z błędem geometrii)
   jest zgłaszany jako brakujący, nie szacowany.
2. **Stopień (A2, zrobione — `src/structural/treadCheck.js`).** Belka swobodnie podparta między wangami
   (EC5-STRUCT-I-01).
   - **Długość stopnia** = średnia z długości krawędzi czołowej i tylnej (finalnych). Dla prostego to jego szerokość;
     zabiegowy to długi klin od duszy do ściany (krawędzie np. 1375 i 1121 mm) — średnia to długość zastępcza.
   - **Rozpiętość L** = długość − dwa oparcia. Wanga zajmuje pas [0, t] w głąb od łańcucha; koniec stopnia leży
     `recess` od łańcucha (`edgeOverrides.js` `housingRecessMm`: głębokość wpustu przy wpuszczanej, 0 przy
     nakładanej), więc stopień opiera się na długości `t − recess`, a środek oparcia jest `(t − recess)/2` od końca.
     Domyślnie (po poprawce wpustu: stopień kończy się na dnie wpustu, t − d = 24 mm od łańcucha) 852 − 2·8 = 836 mm; oparcie = głębokość wpustu 16 mm.
   - **Przekrój** `b × h`: `b` = pole stopnia / jego długość (prosty: głębokość + nosek; zabiegowy: średnia
     głębokość — prostokąt zastępczy), `h` = grubość stopnia. Rowek pod zakładkę podstopnia pominięty.
   - **Przypadki SGN** (nigdy razem, EN 1991-1-1): ciężar + równomierne `q·b` (średniotrwałe, k_mod 0,8):
     `M = (1,35·g + 1,5·q·b)·L²/8`; ciężar + siła skupiona w środku (krótkotrwałe, k_mod 0,9):
     `M = 1,35·g·L²/8 + 1,5·Q·L/4`. `σ = M/W`, `W = b·h²/6`, porównanie z `f_m,d = k_mod·f_m,k/γ_M`. Ścinanie
     `τ = 1,5·V/(k_cr·b·h)`, k_cr = 0,67, porównanie z `f_v,d`.
   - **SGU** (EC5-STRUCT-I-04): chwilowe od obciążenia użytkowego (gorsze z `5·q·b·L⁴/(384·E·I)` i
     `Q·L³/(48·E·I)`, E0,mean) ≤ L/300; końcowe `w_G·(1+k_def) + w_q·(1+ψ2·k_def)`, ψ2 = 0,3 (kat. A) ≤ L/250.
     Limity to łagodny koniec zakresów EC5 Tab. 7.2 (l/300–l/500, l/250–l/350) — parametry, do weryfikacji.
   - **Podesty** nie są sprawdzane (wymagają własnej konstrukcji — legarów — której model nie opisuje).
   - **Wynik:** tabela w zakładce (klik = zaznaczenie stopnia), WARNING `EC5-STRUCT-I-01` (nośność) lub
     `EC5-STRUCT-I-04` (ugięcie) na stopniu > 100 %.
   - **Przykład (domyślne schody L, dąb D30 40 mm, szer. 900):** proste 57 % (decyduje ugięcie chwilowe 1,6 / 2,8 mm),
     dwa środkowe zabiegowe 136 % i 152 % (ugięcie chwilowe 5,5–6,2 mm przy L ≈ 1,2 m; zginanie 66–73 %). Przy
     50 mm wszystkie ≤ 100 %.
   - **Ograniczenie:** zabiegowy to w rzeczywistości płyta klinowa (narożny oparty na dwóch wangach w narożniku);
     belka zastępcza jest uproszczeniem, nie wykazano, że po bezpiecznej stronie.
3. **Wanga (A3).** Belka nachylona, swobodnie podparta między podporami (podłoga / słup / podest), obciążenie z
   połowy szerokości biegu (+ ciężar stopni, podstopni, balustrady po tej stronie). Przekrój: **nakładana** —
   osłabiony gardzielą (najmniejsza pozostała wysokość deski, `minRemainingSectionMm` / diagnostyka
   `STRINGER-MIN-SECTION`); **wpuszczana** — efektywna grubość = grubość − głębokość wpustu. Wykorzystanie w % i
   ugięcie. Sposób modelowania wangi zgodnie z EC5-STRUCT-F-01 (typ wangi zmienia model statyczny).
4. **Poręcz i słupek (A4).** Poręcz: belka między słupkami przy 0,36 kN/m poziomo, zginanie względem osi pionowej i
   ugięcie ≤ 25 mm. Słupek: wspornik utwierdzony w podstawie, `F = q · (połowa rozpiętości z każdej strony)`,
   `M = F · H` (H = wysokość poręczy nad podstawą słupka). Połączenie słupka z konstrukcją — poza zakresem.
5. **Tralka (A5).** Wspornik od podstawy: obciążenie wypełnienia 0,5 kN/m² × rozstaw × wysokość,
   `M = w·s·H²/2`.

## Wynik i UI

- Zakładka **„Konstrukcja"** (prawy panel): baner z zastrzeżeniem, tabela ciężarów (kategoria, objętość, gęstość,
  masa, ciężar), w kolejnych etapach tabela kontroli (element, wykorzystanie %, ugięcie), lista założeń ze
  statusami.
- `Diagnostic`-i (`STRUCT-*`) przechodzą przez bramkę walidacji do zakładki Walidacja — zawsze najwyżej WARNING.

## Reguły w katalogu

EC5-STRUCT-I-01…05, EC5-STRUCT-F-01 (`src/rules/sets/eurocodeStructural.js`), UK-GUID-I-01/02
(`bwfIndustryGuidance.js`), PL-LEGAL-I-01 (`plWarunkiTechniczne.js`, do weryfikacji).

## Etapy

- **A1** (zrobione): dokument, `src/structural/timberClasses.js`, `selfWeight.js`, `index.js`, pole
  `structuralMaterialClass`, zakładka „Konstrukcja".
- **A2** (zrobione): `treadCheck.js`, parametry obciążeń i limitów ugięć w folderze „Kontrola konstrukcji" (domyślnie UK).
- **A3** wanga · **A4** poręcz + słupek · **A5** tralka — każdy z testami, diagnostyką i wierszem w
  tabeli.
