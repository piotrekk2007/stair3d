# Schody wspornikowe

Parametr **„Konstrukcja schodów”** (`config.stairConstruction`): `stringers` (na wangach, jak dotąd) albo
`cantilever` (**wspornikowe**). Folder panelu „Konstrukcja: wspornikowa”.

## Opis użytkownika / decyzje (2026-09-29)

- Ze ściany wystają **pełne profile stalowe** (np. 40 × 60) — firma zastaje je na budowie; stalowa wanga w ścianie
  jest niewidoczna. Ściana = strona **zewnętrzna** schodów (linia łańcucha zewnętrznego).
- Stopień to **okładzina drewniana (skrzynka)** nasuwana na profile i wklejana/przykręcana: **góra i front 40 mm**,
  **spód, tył i bok 20 mm**. Góra pełna (z noskiem), front pod górą, spód między frontem a tyłem, tył pod górą, bok na
  wolnym końcu między górą a spodem; koniec przy ścianie otwarty (tędy wchodzą profile).
- Wysokość skrzynki = **wysokość profila + góra + spód + luz** na nasunięcie.
- **Co najmniej 2 profile** na stopień; strona duszy **wolna** (bez wangi i słupów).
- Stopnie zabiegowe — ta sama skrzynka w kształcie trójkąta / latawca.
- Szerokość okładziny maks. **ok. 1800 mm**.

Parametry spoza opisu — DO WERYFIKACJI (`CO-MFG-J-CANTILEVER`): luz 2 mm, szczelina przy ścianie 5 mm, wysięg profila
700 mm (profile są mierzone na budowie).

## Architektura

- `src/geometry/cantileverModel.js` (czysty): `cantileverParams`, `cantileverBoxHeightMm`, `cantileverConfig` (dla
  solverów: grubość stopnia = wysokość skrzynki, bez podstopni, strony „nakładane” dla balustrady — tralki stoją na
  stopniach), `buildCantileverBox(treadModel, planTread, config)` → `{heightMm, parts[], profiles[], warnings}`.
  Elementy liczone z obrysu stopnia: pasy wzdłuż krawędzi czoła (40) i tyłu (20), bok wzdłuż wolnej krawędzi (20),
  spód = obrys minus pasy frontu i tyłu (`polygonClip.js`); każdy element ma obrys w rzucie, zakres wysokości,
  grubość i formatkę (prostokąt do wycięcia). Profile: prostopadle do ściany, równo rozłożone wzdłuż ściany w części,
  gdzie cała szerokość profila mieści się we wnętrzu skrzynki; profil wychodzący poza wnętrze (np. zabieg przy
  narożniku) → ostrzeżenie `CANTILEVER-PROFILE` z długością, która się tam mieści; za szeroka skrzynka →
  `CANTILEVER-WIDTH`.
- `edgeOverrides.js housingRecessMm`: przy wspornikowych stopień kończy się szczeliną przed ścianą, a po stronie duszy
  sięga linii łańcucha.
- `buildStaircase.js`: brak wang (puste modele z `absent: true` — walidator nie zgłasza „luki w wandze”), brak słupów
  konstrukcyjnych i złączy, profile rysowane w grupie `CantileverProfiles` (stal), diagnostyki w `cantilever` → bramka
  kosztorysu.
- 3D: stopień = elementy okładziny jako osobne płyty (`treadRenderer.js`). Kosztorys: pozycja na każdy element
  okładziny (typ TREAD/LANDING, grubość 40/20) — wyceniane z cennika desek w swojej klasie grubości. DXF stopnia:
  lista elementów z formatkami, obrysy płyt pod górą (warstwa NOTCH) i profile (JOINTS). Oferta: wiersz
  „Konstrukcja”. Kontrola konstrukcji: stopień wspornikowy pomijany (nośność daje stal, niesprawdzana).

## Ograniczenia

- Stal (profile, wanga w ścianie) nie jest wyceniana ani sprawdzana.
- Balustrada po stronie wolnej: tralki stoją na stopniach; szkło „na rotulach” liczy pas mocowania jak przy wandze
  nakładanej (przybliżenie).
- Jeden rodzaj układu okładziny; bez frezowań pod profile w okładzinie (koniec przy ścianie otwarty).
- Domyślny cennik z kodu ma przedziały głębokości od 240 mm — wąskie elementy (front, tył) wycenia z najbliższego
  przedziału; właściwe ceny po imporcie pełnego cennika CSV.

Testy: `src/geometry/__tests__/cantilever.test.js`.
