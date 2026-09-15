# Katalog reguł technicznych — schody drewniane samonośne

Ten dokument jest czytelnym dla człowieka odbiciem danych z [`src/rules/`](../../src/rules/).
Źródłem prawdy dla implementacji są pliki `.js` w `src/rules/sets/` — ten dokument nie
zawiera żadnej logiki wykonywalnej, tylko skatalogowaną wiedzę.

**Status:** katalog wiedzy. Nie istnieje jeszcze silnik walidacji, który odczytywałby
`config`/`planLayout` i oceniał te reguły — to celowo osobny, przyszły krok
(`.claude/RULES.md`, reguła 10: walidacja to osobna warstwa).

## Jak czytać ten katalog

Każda reguła ma jednoznacznie zadeklarowany **rodzaj** (`ruleType`) — nigdy nie zgadujemy:

| ruleType | Znaczenie |
|---|---|
| `LEGAL_REQUIREMENT` | Wiążące prawo w danej jurysdykcji (np. polskie Warunki Techniczne, brytyjskie Building Regulations — te ostatnie NIE wiążą projektów w jurysdykcji PL). |
| `ENGINEERING_GUIDANCE` | Norma/metoda inżynierska (Eurokod, prEN, BS jako metoda obliczeniowa) — nie jest prawem samym w sobie, dopóki krajowy załącznik nie nada jej wartości wiążącej. |
| `INDUSTRY_BEST_PRACTICE` | Wytyczna branżowa/organizacji rzemieślniczej (np. BWF) — dobra praktyka, nie prawo. |
| `MANUFACTURING_ASSUMPTION` | Ograniczenie produkcyjne (zapas materiałowy, wymiary handlowe) — specyficzne dla warsztatu. |
| `USER_DEFINED_COMPANY_STANDARD` | Domyślna wartość/polityka firmy używającej narzędzia — w pełni edytowalna. |

Oraz **jurysdykcję** (`jurisdiction`): `PL`, `UK`, `EU`, `US` (tylko porównawczo), `GENERAL`
(konwencja bez jednego źródła prawnego), `COMPANY` (decyzja firmy). **Reguły z różnych
jurysdykcji prawnych nigdy nie są łączone w jedną ocenę** — dokładnie jedna jurysdykcja
prawna jest aktywna dla danego projektu (patrz kategoria K, `META-K-04`).

Kolumna **Blokuje?** = czy naruszenie ma domyślnie wstrzymywać generację modelu
(`blocksGeneration`), czy tylko być zaraportowane.

---

## A. Reguły geometryczne

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Severity | Blokuje? | Źródło |
|---|---|---|---|---|---|---|---|
| `PL-LEGAL-A-01` | Wzór Blondela dla schodów wewnętrznych | `0,6 m ≤ 2·h + s ≤ 0,65 m` | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 69 ust. 4 |
| `PL-LEGAL-A-02` | Maks. nachylenie biegu (stała komunikacja) | `≤ 36°` | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 69 |
| `PL-LEGAL-A-03` | Maks. liczba stopni w biegu (wewn.) | `≤ 17` (ogólne) / `≤ 14` (ZOZ); nie dotyczy budynków jednorodzinnych | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 69 ust. 1 |
| `PL-LEGAL-A-04` | Maks. liczba stopni w biegu (zewn.) | `≤ 10` | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 69 ust. 2 |
| `PL-LEGAL-A-05` | Min. szerokość biegu / maks. wys. stopnia wg typu budynku (tabela) | patrz niżej | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 68 |
| `PL-LEGAL-A-06` | Min. szerokość biegu zewnętrznego | `≥ 1,2 m` | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 68 |
| `UK-LEGAL-A-01` | Relacja rise/going (UK, porównawczo) | `pitch ≤ 42°`; `550 ≤ 2R+G ≤ 700 mm` | LEGAL_REQUIREMENT | UK | INFO | ❌ | AD K 2013 §1.1-1.2 |
| `GEN-ERGO-A-01` | Komfortowe mijanie się dwóch osób | `stairWidth ≳ 1,0-1,1 m` (orientacyjnie) | INDUSTRY_BEST_PRACTICE | GENERAL | INFO | ❌ | konwencja architektoniczna |

**Tabela § 68 (PL-LEGAL-A-05)** — minimalna szerokość biegu / maksymalna wysokość stopnia:

| Typ budynku | Min. szerokość biegu | Maks. wys. stopnia |
|---|---|---|
| Jednorodzinne / zagrodowe / mieszkania dwupoziomowe | 0,8 m | 0,19 m |
| Wielorodzinne, użyteczności publicznej (poza ZOZ) | 1,2 m | 0,175 m |
| Przedszkola/żłobki | 1,2 m | 0,15 m |
| Zakłady opieki zdrowotnej | 1,4 m | 0,15 m |
| Piwnice/pomieszczenia techniczne (wszystkie budynki) | 0,8 m | 0,20 m |

> **Luka w modelu:** `config.js` nie ma dziś pola "przeznaczenie budynku" — bez niego nie da
> się automatycznie wybrać właściwego wiersza tej tabeli.

---

## B. Reguły ergonomiczne

| ruleId | Opis | Typ | Jurysdykcja | Severity | Blokuje? | Źródło |
|---|---|---|---|---|---|---|
| `GEN-ERGO-B-01` | Historyczna formuła Blondela (1672) jako podstawa wszystkich nowożytnych wzorów 2R+G | ENGINEERING_GUIDANCE | GENERAL | INFO | ❌ | F. Blondel, *Cours d'architecture* (1675) |
| `GEN-ERGO-B-02` | Stromość schodów dobierana do roli (główne vs. gospodarcze) | ENGINEERING_GUIDANCE | GENERAL | INFO | ❌ | konwencja |
| `GEN-ERGO-B-03` | Spójność wysokości stopni w obrębie biegu (zapobieganie potknięciom) | INDUSTRY_BEST_PRACTICE | GENERAL | WARNING | ❌ | konwencja bezpieczeństwa |
| `GEN-ERGO-B-04` | Spójność głębokości stopni w obrębie prostego odcinka | INDUSTRY_BEST_PRACTICE | GENERAL | WARNING | ❌ | konwencja |
| `BWF-GUID-B-01` | Poręcz wymagana przy wys. biegu > 0,6 m; wys. poręczy 0,9-1,1 m (UK, porównawczo) | LEGAL_REQUIREMENT | UK | INFO | ❌ | AD K 2013 §1.5 |
| `BWF-GUID-B-02` | Min. przekroje słupka/poręczy/balasek (schody standardowe) | MANUFACTURING_ASSUMPTION | UK | INFO | ❌ | BWF Guide, Tabela 6.1 |

---

## C. Reguły zabiegu/linii biegu (walkline)

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Severity | Blokuje? | Źródło |
|---|---|---|---|---|---|---|---|
| `PL-LEGAL-C-01` | Min. szerokość stopnia zabiegowego mierzona 0,4 m od duszy | `≥ 0,25 m` w odległości 0,4 m od wewnętrznej krawędzi | LEGAL_REQUIREMENT | PL | ERROR | ✅ | Rozporządzenie MI, § 69 ust. 5 |
| `UK-LEGAL-C-01` | Kolejne stopnie zabiegowe: ta sama głębokość na linii biegu; głębokość zabiegowa ≥ głębokość prosta | LEGAL_REQUIREMENT | UK | INFO | ❌ | AD K 2013 §1.3 |
| `UK-GUID-C-02` | Definicja linii biegu jako łuku wokół słupa + parametry pomocnicze (maks. zmiana kierunku 180°, min. szerokość 50mm w wąskim końcu, maks. szerokość biegu 1000mm dla metody uproszczonej) | INDUSTRY_BEST_PRACTICE | UK | INFO | ❌ | BWF Guide §7.6 |
| `US-REF-C-03` | *(wyłącznie porównawczo)* Linia biegu 305mm od wąskiej strony; tolerancja różnicy głębokości 9,5mm | ENGINEERING_GUIDANCE | US | INFO | ❌ | IRC 2021 §R311.7.5.2 |
| `BWF-GUID-G-04` | Brak udokumentowanej reguły dla kształtu podstopnia zabiegowego — otwarty problem inżynierski | ENGINEERING_GUIDANCE | GENERAL | INFO | ❌ | brak źródła — luka zidentyfikowana świadomie |

> **Rozbieżność do naprawienia:** `config.walklineOffset` (domyślnie 400mm) i
> `config.minInnerWidth` (domyślnie 110mm) w obecnym kodzie **nie odzwierciedlają**
> `PL-LEGAL-C-01` (250mm w konkretnym punkcie 400mm od duszy) — to inna reguła niż to, co
> aplikacja dziś sprawdza.
>
> **Bezpośrednio istotne dla wcześniejszego audytu architektury:** `UK-GUID-C-02` opisuje
> metodę linii biegu jako **łuku wokół słupa**, odmienną od metody **proporcjonalnej
> interpolacji**, którą dziś stosuje `planLayout.js`. To wart rozważenia punkt odniesienia
> przy przebudowie solvera zabiegu. `BWF-GUID-G-04` wprost potwierdza, że problem
> "nienaturalnej geometrii podstopnia zabiegowego" (zgłoszony przez użytkownika) nie ma
> gotowego rozwiązania w żadnym z przejrzanych źródeł — wymaga samodzielnego zaprojektowania.

---

## D. Reguły skrajni (headroom)

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Severity | Blokuje? | Źródło |
|---|---|---|---|---|---|---|---|
| `PL-LEGAL-D-01` | Min. wysokość w świetle nad biegiem/spocznikiem | `≥ 2,05 m` | LEGAL_REQUIREMENT | PL | **WARNING** ⚠️ | ❌ | ⚠️ **niepotwierdzone źródłowo** — patrz niżej |
| `UK-LEGAL-D-01` | Min. skrajnia nad biegiem (UK, porównawczo) | `≥ 2,0 m` | LEGAL_REQUIREMENT | UK | INFO | ❌ | AD K 2013, Diagram 1.3 |
| `UK-LEGAL-D-02` | Zredukowana skrajnia dla schodów na poddasze (UK) | `1,8-1,9 m` wg diagramu | LEGAL_REQUIREMENT | UK | INFO | ❌ | AD K 2013, Diagram 1.4 |

> ⚠️ **Wymaga weryfikacji:** wartość 2,05 m dla Polski pochodzi wyłącznie z wtórnych źródeł
> branżowych (nie z bezpośrednio zweryfikowanego tekstu paragrafu podczas tego badania).
> Obecny `config.minHeadroom` w kodzie to **2000mm (2,0 m)** — jeśli prawidłowa polska
> wartość to 2,05 m, domyślna wartość aplikacji jest zaniżona. Reguła celowo ma
> `severity: WARNING` i `blocksGeneration: false`, dopóki nie zostanie potwierdzona wprost w
> tekście rozporządzenia — schemat danych (`schema.js`) **wymusza** to programowo (rzuca
> błąd, jeśli ktoś ustawi `needsVerification: true` razem z `blocksGeneration: true`).

---

## E. Reguły konstrukcyjne schodów drewnianych (ogólne)

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Blokuje? | Źródło |
|---|---|---|---|---|---|---|
| `BWF-GUID-E-01` | Docelowa wilgotność drewna wg środowiska | ogrzewane wewn.: 7-11% (~50% RH) / nieogrzewane wewn.: 10-14% (~65% RH) | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide, Tabela 3.1 |
| `BWF-GUID-E-02` | Referencyjna lista gatunków drewna i klas wytrzymałości | np. sosna/świerk/dąb europejski → C24; buk/sapele → D40 | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide, Tabela 4.1 (wg BS EN 1912:2012) |
| `BWF-GUID-E-03` | Min. klasa kleju do złączy wewnętrznych | `≥ D3` (EN 204) lub `≥ C1` (EN 12765) | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §4.4 |
| `BWF-GUID-E-04` | Min. klasa odporności korozyjnej łączników metalowych | Klasa 2 (ogrzewane) / Klasa 3 (nieogrzewane) wg EN 1670 | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §4.5.2 |
| `CO-STD-E-01` | Domyślna wysokość/grubość wangi (placeholder firmowy) | `stringerHeight = 300mm`, `stringerThickness = 40mm` | USER_DEFINED_COMPANY_STANDARD | COMPANY | ❌ | brak źródła — obecny default w `config.js` |

---

## F. Reguły wangi/policzka

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Blokuje? | Źródło |
|---|---|---|---|---|---|---|
| `EC5-STRUCT-F-01` | Klasyfikacja układu statycznego wg typu wangi (zamknięta/wycinana) i usztywnienia krzyżowego | ENGINEERING_GUIDANCE | EU | ❌ | prEN 16481 (wg BWF Guide §8, Tabela 8.1) |
| `EC5-STRUCT-F-02` | Połączenia modelowane jako przegubowe / sztywne / odkształcalne | ENGINEERING_GUIDANCE | EU | ❌ | prEN 16481 |
| `BWF-GUID-F-01` | Głębokość gniazda wangi na stopień/podstopień | `≥ max(12mm, 0,4·grubość_wangi)` | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §6.2.3 |
| `BWF-GUID-F-02` | Czop wangi w słupku (newel) | grubość ≥12mm, długość ≥45mm | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §6.2.3 |
| `BWF-GUID-F-03` | Wanga na zakręcie zabiegowym wymaga lokalnego poszerzenia pod gniazda | **WARNING** ⚠️ | UK | ❌ | BWF Guide §6.2.3 |
| `BWF-GUID-F-04` | Prescriptywny przekrój wangi 220×26mm — **tylko w zdefiniowanej obwiedni** (≤900mm szer., 13 stopni) | MANUFACTURING_ASSUMPTION | UK | ❌ | BWF Guide, Tabela 6.1 |

> **Bezpośrednio istotne dla audytu architektury:** `EC5-STRUCT-F-01` i `BWF-GUID-F-03`
> potwierdzają zewnętrznie to, co audyt architektury już zidentyfikował jako problem C.2/C.4
> — wanga na zakręcie zabiegowym to **osobny problem konstrukcyjny**, wymagający jawnej
> klasyfikacji (zamknięta/wycinana, usztywniona/nie), a nie tego samego płaskiego modelu
> panelu co prosty odcinek.

---

## G. Reguły konstrukcyjne stopnia/podstopnia

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Blokuje? | Źródło |
|---|---|---|---|---|---|---|
| `EC5-STRUCT-I-01` | Stopień jako belka wolnopodparta (lub ciągła) do sprawdzenia zginania/ścinania/ugięcia | ENGINEERING_GUIDANCE | EU | ❌ | EN 1995-1-1 (metoda, nie tabela) |
| `BWF-GUID-G-01` | Mocowanie podstopnia do stopnia wkrętami | rozstaw ≤230mm; penetracja ≥max(23mm, 1,5·grubość) | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §6.2.2 |
| `BWF-GUID-G-02` | Rowek pod podstopień + klocki narożne | głębokość rowka 5mm–1/4 grubości stopnia; 2-4 klocki wg szerokości | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §6.2.2 |
| `UK-LEGAL-G-03` | Otwarty podstopień: zakładka stopni + brak przelotu kuli Ø100mm | zakładka ≥16mm (Anglia/NI/Walia) / ≥15mm (Szkocja) | LEGAL_REQUIREMENT | UK | ❌ | AD K 2013 §1.9 |
| `BWF-GUID-G-04` | **Brak** udokumentowanej reguły podstopnia zabiegowego — otwarty problem | — | ENGINEERING_GUIDANCE | GENERAL | ❌ | brak źródła |
| `CO-STD-G-01` | Domyślne wysunięcie noska (placeholder firmowy) | `nosing = 25mm` | USER_DEFINED_COMPANY_STANDARD | COMPANY | ❌ | brak źródła — obecny default |

> **Polski odpowiednik `UK-LEGAL-G-03` nie został odnaleziony** w tym badaniu — to
> zidentyfikowana luka badawcza, nie potwierdzony brak wymogu. Wymaga osobnego sprawdzenia
> przed założeniem, że otwarte podstopnie są w Polsce nieregulowane.
>
> `BWF-GUID-G-04` to bezpośrednie potwierdzenie problemu C.3 z audytu architektury
> (nienaturalna geometria płaskiego podstopnia między punktem wewn./zewn. w zabiegu) — żadne
> z przejrzanych źródeł (PL, UK, BWF) nie podaje gotowej reguły. To wymaga własnego
> rozwiązania inżynierskiego, opisanego jako taki właśnie fakt, a nie ukrytego pod
> domniemanym brakiem problemu.

---

## H. Reguły połączeń

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Blokuje? | Źródło |
|---|---|---|---|---|---|---|
| `PL-LEGAL-H-01` | Wysokość balustrady i maks. prześwity wypełnienia | `≥1,1m`; prześwit `≤0,2m` (ogólnie) / `≤0,12m` (wielorodzinne, zbiorowe, oświata, ZOZ) | LEGAL_REQUIREMENT | PL | ✅ | Rozporządzenie MI, § 298 |
| `EC5-STRUCT-I-05` | Łączniki metalowe przenoszące obciążenia wg EC5 | `F_v,Ed ≤ F_v,Rd` | ENGINEERING_GUIDANCE | EU | ❌ | EN 1995-1-1 rozdz. 8 |
| `BWF-GUID-F-02` *(patrz F)* | Czop wangi w słupku | — | INDUSTRY_BEST_PRACTICE | UK | ❌ | BWF Guide §6.2.3/6.2.4 |

> **Luka w modelu:** balustrada/poręcz nie istnieje dziś w ogóle w `config.js` ani w
> geometrii 3D — cały obszar `PL-LEGAL-H-01` jest poza dzisiejszym zakresem modelu.

---

## I. Założenia konstrukcyjne (strukturalne)

| ruleId | Opis | Warunek | Typ | Jurysdykcja | Blokuje? | Źródło |
|---|---|---|---|---|---|---|
| `PL-LEGAL-I-01` | Obciążenie użytkowe schodów wg polskiego zał. krajowego | ⚠️ **niepotwierdzone** | LEGAL_REQUIREMENT | PL | ❌ (WARNING) | PN-EN 1991-1-1 + zał. krajowy — wymaga weryfikacji |
| `UK-GUID-I-01` | Obciążenie schodów kat. A1 (UK, porównawczo) | UDL 1,5 kN/m²; siła skupiona 2,0 kN | ENGINEERING_GUIDANCE | UK | ❌ | UK NA do EN 1991-1-1, Tabela NA.3 |
| `UK-GUID-I-02` | Obciążenia poziome poręczy/balustrady (UK, porównawczo) | UDL poręczy 0,36 kN/m; wypełnienie 0,5 kN/m²/0,35 kN | ENGINEERING_GUIDANCE | UK | ❌ | UK NA Tabela NA.8 / PD 6688-1-1 |
| `EC5-STRUCT-I-02` | Dobór klasy wytrzymałości drewna wg gatunku/sortowania | — | ENGINEERING_GUIDANCE | EU | ❌ | EN 1912:2012 |
| `EC5-STRUCT-I-03` | Korekta wartości obliczeniowych wg klasy użytkowania i czasu trwania obciążenia (k_mod) | `X_d = k_mod·X_k/γ_M` | ENGINEERING_GUIDANCE | EU | ❌ | EN 1995-1-1 §2.3/§3.1.3 |
| `EC5-STRUCT-I-04` | Stan graniczny użytkowalności (ugięcie/drgania dynamiczne) wg rozdz. 7 EC5 | — | ENGINEERING_GUIDANCE | EU | ❌ | EN 1995-1-1 rozdz. 7 |
| `BWF-GUID-I-03` | Drewno = kategoria E reakcji na ogień; okładzina ognioodporna tylko gdy schody rozdzielają strefy pożarowe | ENGINEERING_GUIDANCE | UK | ❌ | BWF Guide §3.6 |

> **Kluczowa niepewność:** wartość obciążenia użytkowego dla Polski (`PL-LEGAL-I-01`) NIE
> została potwierdzona — nie należy zakładać, że jest identyczna z wartością brytyjską
> (1,5 kN/m²). Ogólna, niesprecyzowana wartość Eurokodu bazowego dla kategorii A (stropy/
> balkony/schody) mieści się w przedziale 2,0-4,0 kN/m², w zależności od załącznika
> krajowego.

---

## J. Ograniczenia produkcyjne

| ruleId | Opis | Typ | Jurysdykcja | Blokuje? | Źródło |
|---|---|---|---|---|---|
| `CO-MFG-J-01` | Standardowe grubości handlowe stopni/podstopni | MANUFACTURING_ASSUMPTION | COMPANY | ❌ | brak źródła — placeholder |
| `CO-MFG-J-02` | Maks. długość elementu wg dostępnego materiału/maszyn | MANUFACTURING_ASSUMPTION | COMPANY | ❌ | brak źródła — placeholder |
| `CO-MFG-J-03` | Naddatek na klin w gnieździe wangi (ograniczenie narzędziowe) | MANUFACTURING_ASSUMPTION | COMPANY | ❌ | wywiedzione z BWF §6.2.3 |
| `CO-MFG-J-04` | Min. praktyczna szerokość stopnia zabiegowego w wąskim punkcie (produkcyjna, ostrzejsza niż prawna) | MANUFACTURING_ASSUMPTION | COMPANY | ❌ | brak źródła — placeholder |
| `CO-STD-J-05` | Współczynnik odpadu materiałowego przy wycenie | USER_DEFINED_COMPANY_STANDARD | COMPANY | ❌ | brak źródła — wymagane dla celu biznesowego 3 |

> Ten cały blok nie ma odpowiednika w obecnym kodzie — `config.js` nie ma żadnego pola
> dotyczącego zapasu materiałowego, maks. długości elementu ani wyceny. To bezpośrednio
> potrzebne dla celu biznesowego "orientacyjny koszt materiału".

---

## K. Reguły walidacji (meta-reguły architektury)

| ruleId | Opis |
|---|---|
| `META-K-01` | Naruszenie `LEGAL_REQUIREMENT` w aktywnej jurysdykcji domyślnie = ERROR + blokada, ale musi istnieć tryb "as-built/legacy" generujący geometrię mimo naruszenia (do modelowania istniejących schodów). |
| `META-K-02` | Naruszenie `ENGINEERING_GUIDANCE`/`INDUSTRY_BEST_PRACTICE` domyślnie = WARNING, nigdy nie blokuje samo w sobie. |
| `META-K-03` | Naruszenie `MANUFACTURING_ASSUMPTION`/`USER_DEFINED_COMPANY_STANDARD` domyślnie = INFO, chyba że firma świadomie podniesie severity we własnym profilu. |
| `META-K-04` | Dokładnie jedna jurysdykcja prawna aktywna naraz; reguły z innych jurysdykcji prawnych to wyłącznie porównanie, nigdy cicha blokada. |
| `META-K-05` | Każdy zestaw reguł (plik w `src/rules/sets/`) niezależnie włączalny/wyłączalny bez wpływu na inne zestawy. |
| `META-K-06` | Każdy warunek liczbowy odwołuje się do nazwanego pola configu (`configRefs`), nigdy do liczby magicznej wprost. |
| `META-K-07` | Reguła oznaczona `needsVerification: true` nigdy nie może jednocześnie blokować generacji — wymuszone programowo w `schema.js`. |

---

## Statystyka katalogu

Wygenerowana z `src/rules/catalogue.js` (`getFullCatalogue()`), stan na dzień utworzenia tego
dokumentu: **59 reguł** łącznie.

| ruleType | Liczba |
|---|---|
| `LEGAL_REQUIREMENT` | 16 |
| `ENGINEERING_GUIDANCE` | 20 |
| `INDUSTRY_BEST_PRACTICE` | 13 |
| `MANUFACTURING_ASSUMPTION` | 6 |
| `USER_DEFINED_COMPANY_STANDARD` | 4 |

Reguły oznaczone jako wymagające weryfikacji źródłowej (`needsVerification: true`):
`PL-LEGAL-D-01`, `PL-LEGAL-I-01`.

## Źródła

- Rozporządzenie Ministra Infrastruktury z dnia 12.04.2002 r. w sprawie warunków
  technicznych, jakim powinny odpowiadać budynki i ich usytuowanie (Dz.U. 2002 nr 75 poz.
  690, z późn. zm.), Dział III Rozdział 4 (§ 66-71), Dział VII (§ 298).
- British Woodworking Federation / JELD-WEN (UK) Ltd, *Design Guide: Timber Stairs* (BWF
  Stair Scheme, 2013/2014).
- PN-EN 1995-1-1 (Eurokod 5) — Projektowanie konstrukcji drewnianych.
- PN-EN 1991-1-1 (Eurokod 1) — Oddziaływania ogólne.
- PN-EN 1912:2012 — Drewno konstrukcyjne. Klasy wytrzymałości.
- prEN 16481 — Timber stairs, structural design, calculation methods (cytowane pośrednio,
  metodologia opisana przez BWF Guide §8 — nie kopiowano żadnych tabel/algorytmów
  własnościowych).
- UK Building Regulations: Approved Document K 2013 (Anglia), Technical Handbook (Szkocja),
  Technical Booklet H (Irlandia Płn.), Approved Document K 1998+zm. (Walia) — wyłącznie jako
  materiał porównawczy, cytowane przez BWF Guide.
- International Residential Code 2021, §R311.7.5.2 (USA) — wyłącznie jako punkt porównawczy
  dla koncepcji linii biegu.

Żadna reguła w tym katalogu nie odtwarza zastrzeżonego algorytmu ani nie jest wynikiem
inżynierii wstecznej oprogramowania komercyjnego — każda cytuje publicznie dostępny
akt prawny, normę lub przewodnik branżowy, albo jest jawnie oznaczona jako własny placeholder
firmowy bez zewnętrznego źródła.
