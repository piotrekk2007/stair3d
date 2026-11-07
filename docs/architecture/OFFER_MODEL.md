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
| Szerokość pasa (zmiana 2026-11-06) | **100 mm** (wzór: 84) — `HERO_WIDTH_MM`; marginesy boczne prawej kolumny 8,5 mm (wzór: 11,5), jej tekst `MAIN_CONTENT_MM` = 93 mm; budżet strony 1 liczy znaki na linię w tej szerokości (`charsAt`); numer oferty (≤ 21 pt), kwota brutto (≤ 24 pt) i termin (≤ 15 pt) dostają rozmiar dopasowany do miejsca w jednej linii (`fitPt`, szerokość tekstu z tabeli szerokości znaków Inter Tight). Zmierzone: 108 mm już nie (kwota < 14 pt, wychodzi poza ramkę) |
| Wizualizacja (zmiana 2026-11-06) | pas po lewej **na całą wysokość kartki** do stopki (`heroFull`, `HERO_FULL_MM` 100 × 276 mm, render 960 px szeroki), tło `#ECECEB`, bez siatki / osi / podłogi (tylko jej cień) i bez ścian, **ze stropem** z otworem (samonośne: `currentCeiling`, moduł: `Room` → `Slab`, gdy strop jest włączony). Kadr: `scene/offerFraming.js fitViewToBox` z `fill: 0.5` — w połowie (w skali obrazu) między „całe schody w pasie” (`contain`) a „schody wypełniają wysokość pasa” (`height`, boki przycięte); decyzja użytkownika po porównaniu trzech wariantów: pas 1 : 3,3, schody L z ukosa ~1 : 1 — całe byłyby małe, na wysokość mocno przycięte |
| Czcionki | Inter Tight + Inter z Google Fonts, z zapasowymi; `app/printHtml.js` czeka na `document.fonts.ready` i dekodowanie obrazów (każde ≤ 4 s), dopiero potem drukuje |
| Kod QR (etap 2, 2026-11-06) | „Pokaż kod QR z kontaktem” (`showContactQr`, domyślnie wyłączony, w obu modułach): na stronie 1 trzecia kolumna obok „Dostawa” — „Zapisz kontakt” + kod 24 mm. Treść: `offer/contactCard.js contactCardText(company)` — vCard 3.0 (N / FN opiekuna, ORG firma, TEL opiekuna i firmy, EMAIL opiekuna albo firmy, URL, ADR), zwięzła (bez parametrów TYPE, www tak jak wpisane — pełna z adresem miała ~230 B); gdy się nie mieści w wersji 10: bez adresu, potem MECARD (bez adresu, potem bez www); bez telefonu i e-maila — bez kodu. Kod: własny enkoder `util/qrCode.js` (bajtowo UTF-8, korekcja M, wersje 1–10, maska wg 4 reguł kar, SVG jednym `<path>`, strefa ciszy 2 moduły + biały margines strony). Testy: znane wektory (RS „HELLO WORLD” 1-M, ciągi formatu M, ciągi wersji 7–10) + niezależny dekoder w teście (format, odmaskowanie, zygzak, deinterleave, syndromy RS = 0, tekst); budżet strony 1 liczy kolumnę kodu (`page1Height({qr})`) |

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

Opcjonalne teksty wejścia (dla oferty pisanej ręcznie, poza aplikacją; brak pola = jak dotąd, `''` = nic):
`heroCaption` (podpis obrazka, domyślnie „Wizualizacja poglądowa”), `offerEyebrow` (nadtytuł, domyślnie z pozycji
montażu), `deliveryNote` („Wycena po pomiarach i ocenie wykonawcy.”), `closingNote` (zdanie na końcu strony 2),
`technicalSheet: false` (bez rzutu / parametrów / wygody — strona 2 tylko, gdy przeszła tam wycena albo uwagi),
`heroFull: true` (obrazek na całą wysokość pola po lewej, 84 × 276 mm — `HERO_FULL_MM`, zamiast kadru 84 × 150 mm).

Testy: `src/offer/__tests__/offerDocumentModern.test.js`, `src/util/__tests__/qrCode.test.js`.

## Obraz AI do oferty nowoczesnej (TEST, prośba użytkownika 2026-11-06)

Tryb prezentacji (oba moduły) → „✨ Obraz AI do oferty”: panel obok widoku 3D (`app/aiRenderPanel.js`) i ramka 9:16 na
widoku (przerywany pas = to, co zostaje w pasie oferty na całą wysokość). Kadr ustawia użytkownik kamerą; „Wyślij kadr
do AI” robi render jego kamery w tej ramce (`sceneSetup.js renderFrameImage`, `frameInViewport`) i wysyła do modelu
obrazów Google (domyślnie `gemini-2.5-flash-image` — „Nano Banana”, jak w projekcie Ala_Ang; nazwa do zmiany w panelu):
prompt z `offer/aiRender.js buildAiPrompt` — kadr WIĄŻĄCY (kamera, geometria, liczba stopni / słupów / tralek / szyb,
materiały i kolory bez zmian, nic nie dodawać / usuwać; bez ludzi, napisów), nasze zdjęcie dębu
(`assets/textures/oak-natural.jpg`) jako IMAGE 2 = wzór drewna (wyłączalne), otoczenie do wyboru (nowoczesne / klasyczne
/ studio), dopiski użytkownika, a jako opis — te same wiersze `facts.rows`, które drukuje oferta. Prompt widoczny i
do poprawienia w panelu. Klucz Gemini API = użytkownika, w tej przeglądarce (`localStorage` `stair3d.ai`), zapytanie
prosto do `generativelanguage.googleapis.com`, klucz w nagłówku `x-goog-api-key` (nigdy w URL), `imageConfig.aspectRatio
9:16`. Wynik obok kadru → „Użyj w ofercie nowoczesnej” (w ofercie: cała wysokość — boki przycięte — albo środek
84 × 150 mm, cały obraz) albo „Pobierz”. Zakładka Oferta: „Obraz po lewej” (wizualizacja 3D / obraz AI / „Z pliku…” —
np. zdjęcie realizacji; „Wróć do wizualizacji 3D”) — tylko na czas sesji, nie w projekcie. Model może mimo zakazów
zmienić szczegóły (liczbę tralek) — stąd porównanie z kadrem przed użyciem.

**Czego schody NIE mają** (zgłoszenie użytkownika 2026-11-06: do schodów bez balustrady model dorysował nierealną —
samo „zachowaj IMAGE 1” traktował jako lukę do uzupełnienia): każdy moduł wylicza z projektu listę braków
(`offerModel.js stairAiAbsent(config, railingModel)`, `cladding/quote/claddingOffer.js claddingAiAbsent(built)`:
balustrada przy biegu / wokół otworu / poręcz na ścianie, podstopnice, LED, wangi — wspornikowe / metalowe), prompt
dostaje sekcję „WHAT THIS STAIRCASE DOES NOT HAVE — never add it” (`AI_ABSENT`; trzy rodzaje balustrady naraz = jedna
mocna reguła „NO balustrade of any kind … the client's choice, not something missing”), ogólną zasadę „Add NOTHING …
not in IMAGE 1” i na końcu „Final check … above all: no …”. Panel pokazuje listę („Zakaz dodawania (z projektu): …”). Testy: `src/offer/__tests__/aiRender.test.js`
(prompt, treść zapytania, klucz tylko w nagłówku, odpowiedzi / błędy).

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

## Two floors in one offer (user request 2026-11-07)

„Dolicz podpięte piętro (wyżej / niżej) do tej oferty” (`includeLinkedFloor`, both modules, off by default) counts the
linked floor (geometry/referenceStair.js — its own project file) into this offer. User decisions: **this project's
prices**, **all the items in one list** (no split per floor), the technical page for **both floors**.
- Self-supporting + self-supporting: the floor's takeoff priced with this project's price list / waste / board pricing
  (its own waivers — `app/linkedFloorOffer.js stairFloorSummary`); the two summaries merged by category
  (`offerModel.js mergeSummaries`) before `buildOffer` — one material line, one CNC + projekt, separate categories summed.
- **Two kinds of stair** (user decision 2026-11-07 — a self-supporting and a concrete project price differently: the
  wangi in one, the richer installation labour in the other): each floor priced from **its own project file**.
  Self-supporting + concrete floor: `cladding/floorOffer.js claddingFloorOfferPart(file, {ownOffer: true})` (handed in
  by main.js) — its quote with its own price list and labour, its own offer's lines (mode, names, hidden rows, extras),
  the discount 0; added with `appendOfferLines` (this offer's discount once, same label / unit merged, before the
  installation, this offer's VAT).
- Concrete + concrete: the floor quoted with this project's whole quote settings, the two quotes merged
  (`claddingOffer.js mergeQuotes` — ids prefixed, the detailed lines marked with the floor's name, groups sum by themselves).
- Concrete + self-supporting floor: the app prices it from its own file (main.js `priceLinkedStair` →
  `stairFloorOfferLines`: `stairFilePrices` — its price list, waste, board pricing, manual rows — and its own offer's CNC
  + projekt and installation, the discount 0); the lines as quote lines (`quoteFromOfferLines`) merged.
- Two floors of the same kind: the installation, CNC + projekt and VAT once — this project's. A floor whose own takeoff is blocked by its findings is
  not counted (a warning / the panel says so). Both documents take `floors: [{name, facts, planSvg}]` — „<name> — rzut z
  góry / parameters” on the technical page (classic: after the own parameters). Note: a floor placed over the stair
  no longer blocks THIS project's takeoff: the linked floor's findings (`REFERENCE-STAIR-HEADROOM` / `-INVALID`) are
  listed but non-blocking (`takeoff/validationGate.js NON_BLOCKING_RULES`, user decision 2026-11-07).
Tests: `src/offer/__tests__/linkedFloorOffer.test.js`.

## Frames for the offer (user request 2026-11-07)

Presentation mode (both modules) → „🖼 Kadry do oferty” (`app/offerFramesPanel.js`, the AI panel's look; one of the
two panels open at a time): a frame over the 3D view in the chosen format, the user's own camera rendered in it
(`sceneSetup.js renderFrameImage`), „＋ Dodaj ten kadr”:
- „do galerii na ostatniej stronie” (3:2, 1500 × 1000 px) — several, reordered / removed in the panel; both documents
  take `gallery: [dataUrl]` → „Wizualizacje”, two per row, at the end (modern: the last sheet — a sheet 2 for it even
  with `technicalSheet: false`; classic: after the notes);
- „obraz po lewej” (the full-height strip, or the 9:16 box) — the modern hero instead of the automatic render, as the
  AI picture (`source: 'frame'`, „kadr z prezentacji” in „Obraz po lewej”).
The „Oferta” tab shows „Wizualizacje na ostatniej stronie: N kadrów” with „Wyczyść”. Session only (not in the project).
