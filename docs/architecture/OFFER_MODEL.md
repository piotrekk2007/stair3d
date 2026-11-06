# Oferta dla Klienta (PDF)

Zakładka **Oferta** w prawym panelu: ustawienia oferty, podgląd pozycji i sum oraz przycisk **„Generuj ofertę (PDF)”**.

## Decyzje użytkownika (2026-09-28)

| Temat | Decyzja |
|---|---|
| Koszt CNC + projekt | **kwota ryczałtowa netto**, w PDF **ukryta**: rozkłada się proporcjonalnie na pozycje materiału („materiał wraz z przygotowaniem”) |
| Materiał | jedna pozycja „Schody — materiał wraz z przygotowaniem” (z listą, co zawiera); zaznaczone kategorie (np. podstopnie) jako osobne pozycje, każda ze swoim udziałem w CNC + projekt |
| Pozycje spoza cennika | jak dotąd, Kosztorys → „Pozycje dodatkowe” (np. lakierowanie wang na biało) — w ofercie osobne pozycje |
| Rabat (`discountPct`, decyzje użytkownika 2026-10-14) | procent od **materiału**: materiał wyliczony z kosztorysu + ręczne pozycje dodatkowe; **nie** od CNC + projekt (choć ten siedzi w pozycjach materiału) ani od montażu. **Wewnętrzny**: w PDF nie ma pozycji „Rabat” — każda pozycja materiału traci rabat od swojej części materiałowej (jej udział CNC + projekt zostaje), pozycja dodatkowa od ceny; kwota rabatu tylko w podglądzie wyceny |
| Obrazy w PDF | wizualizacja 3D i rzut jeden pod drugim, na całą szerokość strony (do 112 / 110 mm wysokości) |
| Montaż | kwota ręczna netto, osobna pozycja |
| Ceny | netto + VAT + brutto; stawka VAT wybierana w projekcie (23 / 8 / 0 %) |
| PDF | druk z przeglądarki („Zapisz jako PDF” w oknie drukowania) — bez biblioteki PDF |
| Cennik | import CSV (jak dotąd) wystarcza |

## Architektura

- `src/offer/offerModel.js` (czysty): `buildOffer({summary, manualItems, settings, blocked})` → pozycje, sumy, ostrzeżenia.
  `summary` = `ui/takeoffView.js summarizeByCategory` (to samo, co pokazuje Kosztorys) — oferta niczego nie wycenia
  sama. Udział CNC + projekt = ryczałt × koszt kategorii / koszt materiału; zaokrąglenia do groszy, różnica trafia do
  pierwszej pozycji materiału (suma zawsze = materiał + ryczałt). Brak materiału a ryczałt > 0 → ryczałt w pozycji
  materiału. Pozycje bez ceny (cena 0 w cenniku, np. akcesoria — łączniki, LED, stal — dopóki nie wpiszesz ceny) nie wchodzą — ostrzeżenie w panelu (nie w PDF). Zablokowany kosztorys →
  brak pozycji materiału i ostrzeżenie.
- `stairFacts(config, derived, {material})`: parametry schodów + sekcja „Wygoda i zgodność z przepisami” — wzór Blondela
  (600–650 mm, WT § 69 ust. 4), wysokość stopnia (≤ 190 mm, dom jednorodzinny, WT § 68), szerokość biegu (≥ 800 mm,
  WT § 68), kąt nachylenia (≤ 36°, WT § 69) — progi z katalogu reguł (`rules/sets/plWarunkiTechniczne.js`), nie
  wymyślone. Sekcję można wyłączyć (np. gdy schody są celowo poza zakresem).
- `src/offer/offerDocument.js` (czysty): `buildOfferHTML(...)` → styl klasyczny, kompletna strona A4 (nagłówek z logo i danymi
  firmy, klient, numer, data i ważność liczona w dniach kalendarzowych, wizualizacja 3D, rzut, parametry, wygoda,
  wycena, netto/VAT/brutto, uwagi). Kwota CNC + projekt nigdzie się nie pojawia.
- `src/ui/offerPanel.js`: formularz (tworzony raz) + podgląd; `main.js`: stan, obraz 3D (`sceneSetup.js
  renderViewImage` — osobna kamera w widoku izometrycznym, wygląd jak w prezentacji, bez nakładek technicznych), rzut
  (`renderPlan2DSVG` dopasowany do schodów), druk przez ukrytą ramkę `<iframe srcdoc>`.
- Dane: ustawienia oferty = **projekt** (opcjonalne pole `offer` w pliku, poza `config` i historią; starszy plik →
  domyślne); dane firmy = **firma** (`localStorage` `stair3d.company`, jak logo prezentacji).

## Styl nowoczesny (decyzje użytkownika 2026-11-06)

Drugi wygląd tej samej oferty, w **obu** modułach (schody samonośne i „Na beton”), wybierany w zakładce Oferta:
„Styl oferty” klasyczny | nowoczesny (`offerStyle`, domyślnie klasyczny — starsze projekty bez zmian). Klasyczny
`offerDocument.js` jest nietknięty; nowoczesny to osobny `src/offer/offerDocumentModern.js
buildModernOfferHTML(input)` — **to samo wejście** co `buildOfferHTML` (`offer`, `facts`, `settings`, `company`,
`logoDataUrl`, `image3d`, `planSvg`, `projectName`), więc oba moduły podają je bez zmian w wycenie. Wzór graficzny:
`docs/design/oferta-nowoczesna-wzor.html` (przeniesiony 1:1, CSS + struktura), podgląd
`docs/design/oferta-nowoczesna-podglad.pdf`.

| Temat | Decyzja |
|---|---|
| Strona 1 | **stałe A4** (nic nie może wyjść poza arkusz): po lewej „hero” 84 × 150 mm z wizualizacją 3D, po prawej numer, data i ważność, klient i opiekun oferty, nadtytuł, tytuł, specyfikacja (≤ 7 linii z `facts.rows`, bez „Montaż”), pozycje, sumy netto / VAT, brutto („z dostawą i montażem” / „z dostawą” / „z montażem” — wg `deliveryIncluded` i pozycji montażu), uwagi, termin realizacji i dostawa; stopka z danymi firmy i godzinami otwarcia |
| Strona 2 | dane techniczne: „Rzut z góry”, parametry (`facts.rows`), „Wygoda i zgodność z przepisami” (gdy włączona), ewentualnie „Szczegółowa wycena” i dłuższe uwagi |
| Nowe pola oferty (projekt) | `offerTitle` (pusty = „Schody — materiał” / „Okładziny schodów betonowych — materiał”), `offerSubtitle`, `leadTime` („3–5 tygodni”), `leadTimeNote` („gotowe schody na miejscu”), `deliveryIncluded` (tak) |
| Nowe pola firmy (`localStorage`) | `contactName`, `contactPhone`, `contactEmail` (opiekun oferty), `hours` (godziny otwarcia) — opcjonalne, zapisywane tylko gdy podane |
| Wizualizacja | pionowy kadr w proporcji hero (1120 × 2000 px), tło `#ECECEB` (jak hero), bez siatki / osi / podłogi (tylko jej cień), w module bez ścian i stropu; schody **wypełniają** kadr — `scene/offerFraming.js fitViewToBox` (rzut narożników prostopadłościanu schodów na kamerę widoku izometrycznego, odległość z bisekcji, środek wyrównany) |
| Czcionki | Inter Tight + Inter z Google Fonts, z zapasowymi; `app/printHtml.js` czeka na `document.fonts.ready` i dekodowanie obrazów (każde ≤ 4 s), dopiero potem drukuje |
| Kod QR | nie teraz (etap 2) |

**Co przechodzi na stronę 2** (`planPage1`): pozycje — gdy jest ich więcej niż `MAX_P1_LINES` (6), na stronie 1
zostaje jeden wiersz „Szczegółowa wycena (N pozycji) — strona 2”, a pełna tabela (Lp. | Pozycja | Ilość | Cena netto
| Wartość netto) jest na stronie 2; uwagi — gdy są długie (> 280 znaków lub > 4 linie). Do tego **budżet wysokości
strony 1** (`page1Height`, mm): oszacowanie wysokości bloków wg CSS (linie tekstu z liczby znaków na linię przy danym
stopniu pisma, odstępy bloków; zgodne z pomiarem w przeglądarce ±2 mm) plus 5 mm zapasu. Sam limit 6 pozycji nie
wystarcza (zmierzone: domyślny tytuł modułu „Na beton” łamie się na 3 linie i 4 pozycje + 7 linii specyfikacji + uwagi
wychodziły 8 mm poza arkusz), a niższy limit zabierałby pozycje także tam, gdzie się mieszczą — dlatego limit zostaje
6, a gdy budżet mówi „nie zmieści się”, kolejno: uwagi na stronę 2 → specyfikacja skrócona (do 4 linii) → pozycje na
stronę 2, po czym to, co zdjęto, wraca, gdzie znów się mieści. Tytuł dłuższy niż 2 linie (lub > 60 znaków) jest o
stopień mniejszy.

Testy: `src/offer/__tests__/offerDocumentModern.test.js`.

## Ograniczenia

- Jedna wizualizacja (widok izometryczny) i rzut; bez wyboru ujęcia.
- Numer oferty podpowiadany z daty („Nadaj”), bez numeracji ciągłej.
- Brak osobnych ofert-wariantów (np. dąb / jesion) — kolejny krok, jeśli potrzebny.

Testy: `src/offer/__tests__/offer.test.js`.

## Wycena wang (decyzja użytkownika 2026-10-16)

Kosztorys → „Cennik i materiały” → **„Wycena wang”** (`takeoffSettings.boardPricing.stringerPricingMode`, zapisywane w
projekcie). Wanga jest zawsze **jedną pozycją z jedną ceną**; w notatce pozycji jest opis, co policzono.

| Tryb | Co jest wyceniane |
|---|---|
| `whole` — cała formatka (domyślnie, jak dotąd) | najmniejszy prostokąt obejmujący cały kontur wangi — deska, z której wangę da się wyciąć w jednym kawałku |
| `strips` — dokładnie | długość formatki w **pasach co 400 mm**, każdy wyceniony wg **własnej** głębokości (mierzonej pod lokalnym nachyleniem deski, ±30° od osi formatki) |
| `split` — uproszczona | **dwie proste formatki**, podział tam, gdzie oszczędza najwięcej materiału (krok 50 mm, każda część ≥ 300 mm); bez podziału, gdy oszczędność < 2 % |

Wszystkie tryby biorą **kolumnę długości całej wangi** (to jedna deska — krótsze kolumny cennika zaniżałyby cenę).
Duża formatka w trybie `whole` bierze się zwykle z **załamania profilu** (bieg prosty, potem strome zabiegi), a nie
tylko z szerszej końcówki — na domyślnych schodach L wangi ~352 mm głębokości mają formatki 506–521 mm. Kod:
`takeoff/stockGeometry.js` (`stringerStrips`, `stringerSplitBlanks`), `takeoff/boardPricing.js`
(`STRINGER_PRICING_MODES`, `priceStringerPieces`).

## The whole price list as a file (user report 2026-11-03)

„💾 Zapisz cały cennik” writes `takeoff/priceListFile.js priceListToFile(settings)` — `{_type: 'schody3d-cennik',
_version: 1, priceList, wasteFactors, boardPricing}` (the general list's prices — balusters, handrail, base rail,
glass, fittings, bolts, LED strip / profile, brackets, steel, MDF —, the waste factors, the whole board pricing: board
table, species multipliers, post table with the profiles added by hand, LED supplies, the chosen species / class,
riser material, wanga pricing mode); „📂 Wczytaj cały cennik” applies such a file or a project file's price list
(`applyPriceListFile`: prices by `materialId`, known waste factors, `sanitizeBoardPricing`). The project's own extra rows
(`manualItems`) are not part of it. „Wczytaj / Pobierz CSV” remain the DREWEX board table only.

A landing's stock rectangle is the smallest one round its outline (`stockGeometry.js minAreaRectUV`): its `direction`
(read off its L-shaped outer chain) ran diagonally and a 1080 × 1020 landing was priced as 1486 × 1483.
