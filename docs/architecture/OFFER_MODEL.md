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
- `src/offer/offerDocument.js` (czysty): `buildOfferHTML(...)` → kompletna strona A4 (nagłówek z logo i danymi
  firmy, klient, numer, data i ważność liczona w dniach kalendarzowych, wizualizacja 3D, rzut, parametry, wygoda,
  wycena, netto/VAT/brutto, uwagi). Kwota CNC + projekt nigdzie się nie pojawia.
- `src/ui/offerPanel.js`: formularz (tworzony raz) + podgląd; `main.js`: stan, obraz 3D (`sceneSetup.js
  renderViewImage` — osobna kamera w widoku izometrycznym, wygląd jak w prezentacji, bez nakładek technicznych), rzut
  (`renderPlan2DSVG` dopasowany do schodów), druk przez ukrytą ramkę `<iframe srcdoc>`.
- Dane: ustawienia oferty = **projekt** (opcjonalne pole `offer` w pliku, poza `config` i historią; starszy plik →
  domyślne); dane firmy = **firma** (`localStorage` `stair3d.company`, jak logo prezentacji).

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
