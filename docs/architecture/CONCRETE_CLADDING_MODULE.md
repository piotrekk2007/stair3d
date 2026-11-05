# Concrete cladding module ("Schody na beton") — plan

Status: stages 1–5 BUILT, stage 6 part 1 (the offer and the estimate) BUILT (2026-11-04); the contract / payment schedule later (user decision); the gaps the user listed 2026-11-04 next (see the end) (user request 2026-11-04). This document is the agreed
direction and is updated as each stage lands.

## Purpose

A separate tool for wooden cladding of an existing, cast concrete stair. The method differs from the self-supporting
designer: there is nothing to fit to the opening or the room — the stair is the concrete that is already there. The
user enters the MEASURED raw concrete step by step, the program lays the wooden cladding on it (treads with front and
side nosings, risers, landings, skirting boards, cover stringers, decorative posts, balustrade) and its main value is a
fast, good-looking quotation: material + labour per element, presented in 3D for the client.

## The isolation rule (hard — user decision 2026-11-04)

The self-supporting engine must not be touched: it works and the user does not want it at risk. Therefore:

1. All of the module lives in `src/cladding/` (its own model, solvers, renderers, plan, panel, takeoff, labour price
   list). It never imports the self-supporting solvers or orchestrator (`planLayout.js`, `treadSolver.js`,
   `stringer*`, `postSolver.js`, `railingSolver.js`, `buildStaircase.js`, …) and they never import it — enforced by a
   static test in `src/cladding/__tests__/isolation.test.js` (stage 1).
2. Shared code is used READ-ONLY, only pure libraries: `geometry/pathUtils.js`, `polygonClip.js`, `tolerances.js`,
   `diagnostics/diagnostic.js`, `takeoff/takeoffTypes.js` (`createTakeoffItem`), `takeoff/boardPricing.js` (the board
   price lookup), `takeoff/pricing.js`, `util/format.js`, `util/sideNames.js`, `scene/` helpers (scene setup, wood grain,
   appearance), `plan2d/viewport.js`, `export/downloadTextFile.js` (the module writes its own DXF / OBJ / DAE). Where the module needs different
   behaviour it gets its own code, not a parameter in the shared one.
3. The only edits outside `src/cladding/` are small hooks, each listed here when made and covered by the existing tests
   (all of which must stay green, unchanged):
   - (made, stage 1) the module switch „Samonośne | Na beton” in the toolbar and the page container `#cladding-root` —
     `ui/workspace.js` (`onModuleChange`, `setModule`, `claddingEl`); `main.js setModule` (loads
     `cladding/app/claddingApp.js` on first use, remembers the module in `localStorage` `stair3d.module`, the
     self-supporting Ctrl+Z / Ctrl+Y skip while the module is shown); `style.css` (the switch's look);
   - (made, stage 3) linking floors: `geometry/referenceStair.js registerReferenceBuilder(fileType, build)` — a
     registry consulted by `buildReferenceModel` before the injected buildStaircase (the module is never imported
     there); `main.js` registers `cladding/floorStair.js buildCladdingFloorFromFile` for `schody3d-beton`, reads a
     floor file of either kind (`readFloorFile`, used by both the self-supporting „Wczytaj bieg wyżej / niżej” and the
     module), and hands the module `linkFloor` (= `buildReferenceModel` + `renderReferenceStair`) on mounting;
   - nothing else without asking the user first.
4. The project file of the module is its own type (`_type: 'schody3d-beton'`, own version and migrations) — the
   self-supporting `projectIO.js` stays as it is.

## Linking floors

As today with two self-supporting floors (`referenceStair.js`), a concrete project can sit above or below a
self-supporting one and vice versa. The contract is the shape `buildReferenceModel` already reads from the other
floor: `fullConfig.totalRise`, `treadModels[] {index, outline, elevation}`, `ceilingFit.openingOutline`,
`postModels[]`, the parts list for the headroom check (`walls.js stairParts`: treads, posts — a concrete stair adds the
concrete body as its own part kind) and `root` for the 3D. `src/cladding/buildCladdingStair.js` returns that shape
(`asFloorStair()`), so the only change on the self-supporting side is the loader picking `buildCladdingStair` for a
`schody3d-beton` file (hook 3b). The cladding module reads a self-supporting floor by calling `buildStaircase` (a call,
not a change).

## Data model (`config.cladding`, own schema `src/cladding/schema.js`)

- `sequence` — the steps in walking order, as groups: `{kind: 'steps', count, riseMm, goingMm, widthMm}`,
  `{kind: 'landing', depthMm, widthMm, turn: 'left'|'right'|null, finish: 'wood'|'floorboard'}`, `{kind: 'winders',
  count, turn, spaceAMm, spaceBMm}`, `{kind: 'gap', mm}` (flights apart, U). All sizes = the RAW CONCRETE (height,
  going, width), as measured (user, 2026-11-04).
- `steps[i]` overrides — any single step's own rise / going / width, nosings (front, left, right — the side nosing is
  what sticks out past the concrete), riser on / off, profile, starter step.
- `winderEdges[k]` — a winder edge from the site measurement: distance on the wall and at the dusza (user: "odległości
  krawędzi na ścianie i przy duszy"); see open question 1.
- `walls` — per flight and side (none / wall / partial from–to), as the stairwell's wall list.
- `floors` — finish below / above (the first and the last finished rise), the antresola edge (its nosing).
- `finish` — tread thickness, front / side nosing, riser board, edge profile, species / class.
- `opening`, `balustrade`, `posts`, `skirting`, `coverStringer` — added by the stages below.

## Geometry (pure, `src/cladding/`)

`concreteModel.js`: the sequence → each concrete step as a plan polygon + its top z + its riser line; a straight
flight, a landing (turning the flight left / right), winders (stage 2), flights apart. `claddingModel.js`: on every
concrete step its cladding tread (the step's top polygon + the front nosing + a side nosing on each open side +
the thickness), its riser board, the landing (solid wood, or OSB + floor boards with a nosing hiding the OSB edge),
then skirting / cover stringer / posts. Finished heights: the finished rise of every step (concrete rises + the first /
last floor finishes) reported in a table, WARNING where a flight's finished rises differ by more than a tolerance
(ASSUMPTION, to be agreed) — the installer sees before ordering where the concrete is uneven.

## Winders

1. Generator as in the DREWEX calculator: the space A × B, the number of winders and the turn → an even layout along a
   walkline (its own small function; the self-supporting `winderArc.js` may be CALLED as a pure function if it fits,
   never changed).
2. Measured input: per winder edge its two distances (wall, dusza) typed in — the main way, it is how the site is
   measured.
3. Dragging the edge ends on the plan (own interaction code, the same feel as the self-supporting edge edit).
   Every winder may have its own rise.

## Labour (stage 4) — every element has its own labour price (user, 2026-11-04)

Own editable list, unit + rate per item, e.g.: montaż stopnia prostego bez / z podstopnicą, stopnia zabiegowego bez /
z podstopnicą, półpodestu, podestu z drewna, podestu z deski podłogowej (OSB + deska + nosek), noska (bocznego /
antresoli), listwy schodowej (mb), wangi obiciowej (mb), słupa, balustrady na schodach (per tread), balustrady na
antresoli (mb), plus pomiar / transport / lakierowanie. Rates come later from the user. Every takeoff item carries its
material (board price list, as today) and its labour line, shown separately; VAT 8 % with installation / 23 % material
only (as DREWEX).

## Stages

1. **Skeleton + straight work, visible end to end** — the tab, own panel and project file, the sequence of straight
   groups and landings (L / U turns on a landing, flights apart), per-step overrides, concrete + cladding treads (front
   and side nosings, thickness, risers on / off), plan 2D and 3D (grey concrete, wood cladding), the finished-heights
   table + warning, the isolation test.
2. **Winders** — generator A × B + count, measured edges (wall / dusza), drag edit, own rise per winder.
3. **Surroundings** — walls per flight / side, floor finishes, the antresola nosing, the floor-board landing, the
   ceiling opening (shown, its edge finish), linking floors (hook 3b).
4. **Quotation** — material takeoff of every cladding piece (blanks, board price list), the labour list, the
   Kosztorys for the module (material + labour per line).
5. **Finishing elements** — skirting boards (inner / outer, stepped or raked), cover stringer, decorative posts
   (section, cap, milling — parametric), balustrade (own solver standing on the treads / fixed to the concrete side,
   output in the shape the shared railing renderer and takeoff read), starter steps, edge profiles.
6. **Offer documents** — a free-form offer editor, detailed estimate, contract from the company's template, payment
   schedule (user: last).

## Stage 1 — as built

- `schema.js` — `createDefaultCladdingConfig` / `sanitizeCladdingConfig`: `sequence` of `{kind: 'steps', count, riseMm,
  goingMm, widthMm}` / `{kind: 'landing', riseMm, depthMm (null = auto: the next flight's width for an L, the flight's
  for a straight landing, the larger for a U), turn none / left / right / u-left / u-right, gapMm (U)}`, `exitRiseMm`
  (null = the last step's), `stepOverrides[i] {riseMm, goingMm, widthMm, nosingLeft, nosingRight, riser}`, the finish
  (`treadThicknessMm`, `nosingFrontMm`, `sideNosingMm`, `sideNosingLeft/Right`, `riserBoards`, `riserThicknessMm`,
  `floorFinishBottomMm/TopMm`, `concreteSlabThicknessMm` drawing only, `riseToleranceMm` 5 — ASSUMPTION).
- `concreteModel.js buildConcreteModel` — every element a rectangle in its flight frame `{o, f, r}` (u across, v
  along; `planPoint`), anchored on the OUTER line (away from the first / next turn), so measured widths keep the wall
  side straight; tops cumulative from the raw floor; a landing's `exitSide`; the exit (`rawSlabTopZ`).
- `claddingModel.js buildCladdingModel` — treads (front nosing past the riser board, side nosing on open sides, none
  on a landing's exit side, a U landing's front nosing only over the incoming flight + the gap), riser boards (from the
  tread / floor below up to the concrete top; the exit riser up to the finished floor above), `finishedHeights` (every
  finished rise incl. the first and the exit) and WARNING `CLAD-RISE-UNEVEN` for a rise off the median by more than the
  tolerance.
- `buildCladdingStair.js` — the orchestrator (pure); `claddingRenderer.js` — 3D (concrete prisms with a soffit sloping
  at the slab's plumb thickness, oak treads, risers); `claddingPlanRenderer.js` — plan SVG; `projectFile.js` — file
  type `schody3d-beton` v1 (refuses a self-supporting file with a hint).
- `app/claddingApp.js` + `cladding.css` — the page: own bar (Nowy / Zapisz / Wczytaj, undo / redo, Plan 2D / Widok
  3D), the sequence editor (rows, ↑ ↓ ✕, + Stopnie / + Podest), the finish (lil-gui), the plan (wheel zoom, drag pan,
  double click fit, click = select), the 3D (`scene/sceneSetup.js createScene`), the selected step's own values, the
  finished-heights table (click = select) and the findings.
- Tests: `__tests__/claddingModel.test.js` (sequence, overrides, L right / left, U with a gap, nosings, risers, heights,
  sanitize, file, plan), `__tests__/isolation.test.js` (imports only the module, the read-only list, packages; outside
  only `main.js`; models never import Three.js).

## Stage 2 — winders, as built

- Sequence group `{kind: 'winders', count 2–8, riseMm, turn left / right, spaceAMm, spaceBMm, walklineOffsetMm (null =
  automatic), edges: [count − 1 × {outerMm?, innerMm?} | null]}`.
- `concreteModel.js winderZone`: the zone in its own coordinates (x across from the OUTER line, y along the incoming
  flight): wall corner O = (0, A), dusza corner C = (W, A − Wn); A ≥ Wn, B ≥ W (defaults: the corner square + 125 mm
  per winder beyond the first on each side — ASSUMPTION, overwritten by the measured A / B). The edge between two
  winders = two numbers measured FROM THE CORNERS (user decision 2026-11-04): on the wall signed from O (negative = on
  the incoming wall), at the dusza signed from C. Unmeasured: the dusza ends evenly along the dusza line, the edge
  through its walkline point (equal goings on a walkline `walklineOffsetMm` from the dusza — default half the
  narrower width: a straight, a quarter arc round C, a straight) carried on to the wall (`hitOuter`); one end measured,
  the other still generated. Each winder = a polygon (the corners included where its edges pass them) with named edges;
  `walkGoingsMm` (where the edges cross the walkline) = the winder's going in the heights table; edges out of order →
  ERROR `CLAD-WINDER-ORDER`. `signedOnZoneLine` = a plan point → the signed corner distance (dragging).
- Every element now has `outline` + `edges [{a, b, role}]` (front / back / left / right / front-covered);
  `claddingModel.js offsetEdges` moves each edge out by its role's nosing (front = nosing + riser board, a side = the
  side nosing on an open side, a mitre where neighbours meet — round the dusza corner too), riser boards along every
  front edge, the exit riser along the last back edge.
- UI: „+ Zabiegi”, the zone row (count × rise, turn, A, B, walkline), folded „Krawędzie zabiegów z pomiaru” (per
  edge: wall / dusza, before / past the corner, mm — empty = generated, the placeholder shows the generated value, ✕
  clears), the plan's edge handles (white = generated, orange = measured) dragged along their line (1 mm), the zone's
  walkline dashed, its corners as dots.
- Tests: `__tests__/winders.test.js`.

## Winder warnings (2026-11-04, user request)

`claddingModel.js winderDiagnostics` — WARNINGs only (the concrete is already there): `PL-LEGAL-C-01` (WT § 69 ust. 5:
a winder at least `winderLegalMinGoingMm` 250 deep `winderLegalOffsetMm` 400 from the dusza — `zone.legalGoingsMm`,
the goings on the line that far from the dusza), `CO-MFG-J-04` (the dusza end at least `winderMinDuszaMm` 100 —
`zone.duszaWidthsMm`; company placeholder), `CLAD-WINDER-GOING` (the walkline going within `winderGoingToleranceMm`
20 of the straight steps' median — ASSUMPTION). The unmeasured A / B now default so the walkline goings EQUAL the
straight going (`zoneSizes`: 2·ext + the drawn quarter arc = count × going), so a generated zone raises no going warning.

## Stage 3, part 1 — as built

- Walls (`surroundingsModel.js`): `config.walls = {[flight]: {left, right}}`; `edgeWallKey` — a step's side edge
  belongs to its flight, a landing's / zone's side edge to the flight it runs along (by direction), an L landing's back
  edge to the next flight's outer side, a U landing's back edge = the end wall (the incoming flight's outer side);
  `buildWalls` → `built.walls` (a piece per walled edge, `wallThicknessMm` outward, floor to the raw slab). A walled
  edge gets NO side nosing (`sideNosingOn(…, edge)`; a step's own override still wins). Panel „Ściany przy biegach”
  (per flight, z lewej / z prawej), plan dark pieces, 3D see-through.
- Floor-board landing (user, 2026-11-04): landing `finish: 'floorboard'` — OSB (`osbThicknessMm` 18) + floor boards
  (`floorboardThicknessMm` 15) with a solid nosing piece along the front (`landingNosingDepthMm` 120 onto the
  concrete) hiding the OSB, all flush (`tread.parts {nosing, osb, boards}`, `clipToConvex`); its build-up counts in the
  finished heights (`finishThicknessMm`). Sizes ASSUMPTION.
- The antresola nosing (`cladding.exitNosing`, `exitNosing` on by default): a solid piece along the last back edge,
  over the exit riser by the front nosing, `exitNosingDepthMm` 120 onto the slab, top flush with the finished floor
  above, the tread's thickness; the exit riser ends under it.
- The slab (`buildSlab` → `built.slab`, „Pokaż strop z otworem”): the stair's extent + 1 m, `slabThicknessMm` 220;
  the opening = the UNION of the rectangles round every tread whose finished top is closer than `minHeadroomMm` 2000
  to the soffit (`geometry/rectUnion.js` — added to the read-only list), so an L stair gets an L opening; plan dashed
  blue, 3D extruded with the hole.
- Tests: `__tests__/surroundings.test.js`.

## Stage 3, part 2 — linking floors, as built

`floorStair.js claddingAsFloor(built)` — the module's stair in the shape the shared check reads (heights from the
FINISHED floor: z − `floorFinishBottomMm`; a tread's `elevation.bottom` = the concrete's underside under it; the
opening = `built.slab.opening`; no posts; `root` without walls / slab). Both ways: a self-supporting project loads a
concrete file as its floor above / below (built by the module through the registry), the module loads a self-supporting
or a concrete file (`config.referenceFloor {name, level, file, dxMm, dyMm, rotationDeg, mirror}`, panel „Piętro wyżej /
niżej”): the other stair in 3D (raised by the bottom finish into the module's raw-floor frame) and on the plan (dashed
purple), the clash findings (`REFERENCE-STAIR-HEADROOM`) in the module's list. Tests: `__tests__/floorLink.test.js`.

## Stage 4 — the quotation, as built

- `quote/labour.js` — the labour list (user, 2026-11-04 — every installed element its own price): montaż stopnia
  prostego / zabiegowego bez / z podstopnicą, półpodestu (a landing turning 90°), podestu z drewna, podestu z deski
  podłogowej (per m²), noska, listwy schodowej (mb), balustrady na schodach (per tread) / na antresoli (mb), pomiar,
  transport (lump sums, on / off); own items `own-…` (label, unit, quantity, rate); floor boards / OSB per m²; VAT 8 %
  with installation / 23 % material only; the board price list (`boardPricing`, null = the default DREWEX table;
  „📂 Wczytaj cennik desek” reads the self-supporting „Zapisz cały cennik” file through `takeoff/priceListFile.js`) and
  the species / class. Rates 0 = unpriced. `sanitizeQuoteSettings`. Saved in the project file (`quote`), NOT in the
  undo history (as the self-supporting takeoff settings); „Nowy” keeps them.
- `quote/claddingQuote.js buildCladdingQuote(built, settings)` — a line per tread (its blank along the grain ×
  across × thickness priced per running metre by `takeoff/boardPricing.js lookupBoardPricePerMb`; labour by its kind
  and riser), per landing (wood: a board + montaż półpodestu / podestu; floor boards: labour per m², the boards and the
  OSB per m², its nosing as a board), per riser board (material; its fitting in the tread's labour), the antresola
  nosing (board + montaż noska), the lump sums, the own items; grouped (proste, zabiegowe, podesty, podstopnice, noski,
  usługi, własne); totals material / labour / net / VAT / gross; a missing price is never invented (`—`, the reason in
  its tooltip, `unpriced`).
- UI: the right panel's tabs „Pomiar | Kosztorys” — the quote table, the totals, „Cennik robocizny i materiałów”.
- Tests: `__tests__/quote.test.js`.

## Stage 5, part 1 — skirting, cover stringers, balustrade, decorative posts (as built)

- `sideRuns.js buildSideRuns` — every (flight, side) unfolded: the pieces of the stair's edge along that line (a
  step's side, a landing's / zone's side by its direction, an L landing's back edge for the next flight; never the side
  a turning landing's next flight leaves from) with s along the flight, the finished top, the height below, the
  concrete's soffit (`soffitAt`); `walled` from the walls. One source for the three elements below.
- `finishModel.js buildFinishBoards` — boards in their own vertical plane (polygon in s / z, `origin`, `dir`,
  `normal`, thickness; blank along the top line): the SKIRTING on a walled side (`skirtingEnabled`, bottom cut to the
  finished treads and risers, top raked through the noses + `skirtingHeightMm` — one board —, or STEPPED;
  `skirtingThicknessMm` into the stair) and the COVER STRINGER on an open side (`coverStringers {[flight]: {left, right}}`, bottom along the soffit,
  top stepped under the treads — the side nosing over it — or raked `coverStringerAboveMm` over the noses — then no
  side nosing there, `surroundingsModel.js edgeHasRakedCover`).
- `balustradeModel.js buildBalustrade` — the module's own balustrade (the self-supporting railingSolver.js untouched):
  `railingSides {[flight]: {left, right}}` (open sides only): a decorative post at each end, the handrail
  `railingHeightMm` over the noses (level over a landing), `balustersPerTread` on the treads (on a landing ≤
  `railingMaxClearMm` apart), the axis `railingInsetMm` in from the tread ends; `railingAntresola`: round the opening
  on the floor above (`antresolaSetbackMm` back, `railingAntresolaHeightMm`), not on the exit edge, a post at every
  corner. Decorative posts (user request): `postSizeMm`, `postAboveHandrailMm`, `postCap` flat / pyramid / ball,
  `postCapHeightMm`, `postGrooves` (milled rings). All sizes ASSUMPTION / DO WERYFIKACJI.
- 3D (`claddingRenderer.js`: boards extruded in their plane, handrail beams, balusters, posts with caps and rings), the
  plan (boards, handrail, balusters, posts), the panel („Listwy, wangi obiciowe, balustrada” per flight / side;
  „Wykończenie → Listwy i wangi obiciowe / Balustrada i słupy”), the quote (skirting per mb, the cover stringer as a
  board from the price list, handrail per mb, balusters / posts per piece; labour skirting / cover-stringer per mb,
  railing-stairs per tread, railing-antresola per mb, post per piece).
- Tests: `__tests__/finish.test.js`.

## Stage 5, part 2 — starter steps and edge profiles (as built)

- `starterProfile.js` — a STARTER STEP = `stepOverrides[i].starter {leftMm, rightMm, radiusMm, bowMm}` on a straight
  step: `starterEdges` — the tread widened past the concrete on its sides, the front corners of a widened side rounded,
  the front bowed by its sagitta (edges with roles; `inset` gives the same shape further in); its riser BENT round the
  front and the widened sides (`starterRiserStrip`, developed length priced), a support block inside the riser under the
  widening (`cladding.starterBlocks`, drawn as concrete). Step editor „Stopień zapraszający” (default 300 left, R 200).
- EDGE PROFILE — `edgeProfile` square / chamfer / round (R) / bullnose (`edgeProfileMm` 5; a step's own
  `stepOverrides[i].profile`): only the tread's EXPOSED edges (the front, a nosed side, a starter's round — per outline
  vertex `tread.exposed`, from `claddingModel.js offsetEdgesDetailed`) are milled; `profileRings` (inset, z) → the
  renderer lofts the tread through them (`claddingRenderer.js loftGeometry`, `insetExposed` keeps the point count).
- Quote: „Stopnie zapraszające” (labour `tread-starter`), the bent riser, „Profilowanie” per mb of every milled edge
  (labour `edge-profile`).
- Tests: `__tests__/starterProfile.test.js`.

## Stage 6, part 1 — the shared price list, the offer, the estimate (as built)

- The price list is THE self-supporting one (user, 2026-11-04): `quote/labour.js` settings carry `priceList` (the
  general list by material id — `takeoff/pricing.js DEFAULT_PRICE_LIST`; the balusters / handrail / glass / LED /
  brackets read from it, `priceOf`), `wasteFactors` and the whole `boardPricing` (boards, species, the post table by
  section — the decorative posts priced from it, per piece or per mb of their height); „💾 Zapisz / 📂 Wczytaj cały
  cennik” = `takeoff/priceListFile.js` (the same file both modules read). The module's own: the labour list, floor
  boards / OSB per m², skirting per mb. A project saved before took its handrail / baluster prices over.
- `quote/claddingOffer.js` — the offer from the quote: `mode` groups / detailed / split (material + installation), a
  line renamed or left out (`lineEdits`), extra rows, a discount spread over the quote's lines (not the extras, no line
  of its own), the quote's VAT; `claddingFacts` (the stair's parameters, the comfort table with the self-supporting
  offer's requirements); printed by the SHARED `offer/offerDocument.js buildOfferHTML` (the same look) through
  `app/printHtml.js` — the 3D picture (`sceneApi.renderViewImage`, iso), the plan without editing aids
  (`clientView`), the company data from the same browser setting (`stair3d.company`) and the presentation logo;
  `buildEstimateHTML` — the internal estimate (material and labour per line). Saved in the project file (`offer`).
- UI: the right panel's third tab „Oferta” (client, number, validity, mode, discount, comfort table, the lines with
  their names / on-off, extra rows, notes, totals, „📄 Drukuj ofertę”, „🧾 Drukuj kosztorys”, the company data).
- Tests: `__tests__/offer.test.js`.

## Walls following the stair (user request 2026-11-04, as built)

- `walls[f][side]` is a TYPE (true in older files = full; `schema.js sanitizeWallTypes`): `full` (beside the stair,
  floor to the slab — surroundingsModel.js `buildWalls`, unchanged), `low` + `heightAboveMm` (beside the stair, its top
  raked that far over the noses, 0 = up to the slab), `under` (under the flight's edge, its thickness under the stair,
  floor to the concrete's soffit — the side above stays OPEN: nosing, cover stringer, balustrade allowed). `wallOn(key)`;
  `edgeHasWall` = full / low / gap (no side nosing, the skirting there).
- The wall between flights set apart: a U landing with `gapMm > 0` and `gapWall` (+ `gapWallTop` slab / nose,
  `gapWallAboveMm`): the landing element records its `gap` (`concreteModel.js`), `sideWallsModel.js withGapWalls` walls
  both flights' facing sides (`{type: 'gap'}` — the config the cladding, skirting and balustrade read; the user's own
  wall on a side wins), `buildSideWalls` → `built.sideWalls` (the low / under walls from the side runs, the gap wall
  filling the gap from the flights' floor end to the landing, up to the slab or the higher flight's raked noses + the
  height). 3D (the board geometry, a solid masonry colour for the carrying ones), plan (dark; under the flight dashed).
- Panel: „Ściany przy biegach” — a type per flight side (+ the height of a wall above the steps); the U landing's row —
  „ściana między biegami”, do stropu / nad noskami o … mm.
- Tests: `__tests__/sideWalls.test.js`.

## The balustrade's types and editors (user request 2026-11-04, as built 2026-11-05)

- `balustradeModel.js` rewritten round a SECTION LINE (straight plan pieces with s, the ground, the handrail top): a
  stair side (`railing-<flight>-<side>`) or an antresola chain (`railing-antresola-e<first edge>` — the opening's free
  edges, consecutive ones joined, a closed loop when all are free; `railingAntresolaEdges[k] = false` takes edge k off;
  never the exit edge).
- `railingInfill`: `balusters` (`balusterShape` square / round — cylinders in 3D), `glass-posts` (a pane per span
  between posts, posts added where a span is wider than `glassMaxWidthMm`, `glassClampsPerSide` × 2 per pane),
  `glass-side` (panes on the concrete's side face — `glassStandoffMm` out, `glassOverlapMm` below the treads — or the
  slab's edge at the antresola, no posts of their own, `glassFixingsPerPane` rotules, the handrail on the glass; that
  side gets no side nosing — `surroundingsModel.js edgeHasSideGlass`). `glassTint` (`GLASS_TINTS`), the gaps; sizes
  ASSUMPTION. Panes are plane polygons (as the boards), `blankAreaM2` priced per m² (`railing-glass`), the fixings per
  piece (`railing-glass-fixing`) — the shared price list.
- Posts by hand: `railingPostEdits[section] = {added: [{id, s}], removed: [post id]}`; ids `<section>:start / end /
  c<k> / g<k>-<j> / m-<id>`; `section.removedPosts` (ghosts), `sNearest(section, p)`.
- The opening by hand: `openingManual` (plan points, CCW-made) replaces the derived one (`surroundingsModel.js
  buildSlab`, `slab.manual`); „Otwór: wróć do wyznaczonego” clears it.
- The plan's edit modes (`claddingApp.js planMode`, buttons over the plan): „Wybór”; „▮ Słupy” (the balustrade lines
  clickable — a post added at the nearest s, a click on a post removes it, a dashed ghost restores it); „▭ Otwór i
  antresola” (the opening's corners dragged in 10 mm steps, a middle square adds a corner, a right click removes one, a
  click on an edge switches its antresola balustrade — green on, grey off; the first edit takes the derived opening over).
- Tests: `__tests__/balustrade.test.js`.

## Colours and LED lighting (user request 2026-11-04, as built 2026-11-05)

- Colours: one material per element group in `claddingRenderer.js` (`MATERIALS`: tread — treads, landings, noses;
  riser; stringer — skirting boards and cover stringers; post; railing — the handrail; baluster; glassFixing), coloured
  by the SHARED `scene/appearance.js` (`applyAppearanceToMaterials` — the same colour presets and finishes oak photo /
  generated oak / solid as the self-supporting module; `setCladdingAppearance`). The appearance is presentation state
  (not the config, not in undo), saved in the project file (`appearance`, `sanitizeAppearance`); panel „Kolory i
  wykończenie” (a preset / own colour / finish per element, the glass fixings' metal). The offer's 3D picture uses it.
- LED (`ledModel.js buildCladdingLed` → `built.led`): `ledTreadEnabled` (under every tread's nose along its front
  edges, in front of the riser board — the concrete front moved forward by riser + nosing − `ledTreadSetbackMm` − half
  the profile, at the tread's underside), `ledSkirtingEnabled` (in every skirting board, parallel to the noses
  `ledSkirtingAboveMm` over them, on its face toward the stair), `ledHandrailEnabled` (under every balustrade
  section's handrail); `ledEndMarginMm` off each end; `ledPowerWPerM`, `ledSupplyReservePct` → `powerW` / `supplyW`.
  The self-supporting names and defaults (ASSUMPTION). 3D layer `LedLighting` (an emissive band), the plan (a warm
  line), the quote („Oświetlenie LED”: strip and profile per mb from the shared list, the supply from the table by
  power — `boardPricing.ledSupplyPrices`, editable in the Kosztorys tab —, labour `led` per mb). Folder „Oświetlenie LED”.
- Tests: `__tests__/ledColors.test.js`.

## Gaps listed by the user (2026-11-04) — the next batches

1. (done) Walls between / above / under the flights.
2. (done) Balustrade types, posts by hand, the antresola per edge, the opening's editor — below.
3. (done) Colours and LED lighting — below.
4. (done) Export: DXF (treads, risers, boards), DAE (SketchUp), OBJ — below.

## The stepped skirting in pieces (user request 2026-11-05, as built)

„tak faktycznie robią stolarze”: `skirtingStyle: 'stepped'` is no longer one board but PARTS
(`finishModel.js steppedSkirtingParts` → `skirting[].parts [{id h01 / v02 …, part 'horizontal' | 'vertical', polygon
{s, z} CCW, lengthMm along its grain, depthMm = H, notch {widthMm, heightMm} | null, exit?}]`, the board's `polygon`
null; `boardPolygons(b)` gives either): a HORIZONTAL piece on every tread / landing (consecutive pieces at one height
merged) and a VERTICAL piece in front of every riser — at the riser board's face, or the concrete's face without riser
boards (`riserOn`) — the board H = `skirtingHeightMm` wide, mitred at 45° at both corners: the inner one (tread ×
riser: from (F, top below) to (F − H, top below + H)) and the outer one (from (F − H, top + H) to (F, top)). The vertical
piece is NOTCHED for the tread's nose: up the riser face to the tread's underside, out by `nosingFrontMm`, up the
tread's thickness. A nose reaching past the board (overhang ≥ H): the vertical piece ends level under it, the horizontal
one starts square over it at F − H. The first piece from the floor (or the tread before the run) has a level bottom; at
the stair's exit a vertical piece in front of the exit riser up to the floor above + H (level top), notched for the
antresola nosing; a run ending elsewhere ends square. Consumers: 3D one mesh per piece (a vertical piece's grain up),
plan / tape measure from every part, the DXF one piece per part (`LS-<flight><L|P>-nn`, the grain along x — a vertical
one turned —, notes „poziomy, końce 45°” / „pionowy, 45°, wycięcie pod nosek w × h”) and so the cut list, the quote
(material per mb of all pieces, labour `skirting-stepped` PER PIECE), the LED in the skirting one strip per horizontal
piece `ledSkirtingAboveMm` over its tread. The raked skirting stays one board. Tests: `__tests__/finish.test.js`.

## Measured as finished elements (user request 2026-11-05, as built)

Every group of the sequence has „beton” / „gotowe” (`measured: 'finished'`): the contractor's sizes of the treads /
landings he wants to order. `buildCladdingStair.js concreteFromFinished` builds once with the entered numbers as the
concrete; every element's finished − concrete size is its offset (the nosing, a carpet riser, the side nosings, the
finishes on the first rise — additive, so one pass is exact) and the concrete = the entered − the offset →
`config.derivedConcrete {[index]: {riseMm, goingMm, widthMm, depthMm}}`, applied in `expandSequence` after the step's
own sizes (not marked as own): a step's going from its tread's depth, its width from its length, a landing's depth,
every element's rise from its finished rise. A winder zone measured so: its edges' numbers are where the finished
treads' NOSES meet the wall and the dusza line (`concreteWinderEdges`: each winder's nose line = its concrete front
edge moved forward by the nosing + its riser board, crossed with the zone's wall / dusza path; the concrete edge moved
by the miss, a few rounds, kept within the line) — its A / B stay measured on the walls. In such a zone the plan's edge
handles stand at the NOSES (`built.winderNoses`, `winderNose` — one rule for the conversion and the plan; the concrete
edge drawn dashed behind), so a drag sets exactly what the numbers mean.
The heights table's „beton” / „głęb.” show the derived concrete. Tests: `__tests__/finishedMeasure.test.js`.

## Glass clamps (user request 2026-11-05, as built)

Glass between posts (`railingInfill 'glass-posts'`): every pane carries its metal CLAMPS (`pane.clamps [{s, postFaceS,
z}]`, `balustradeModel.js paneClamps` — as the self-supporting `railingGlass.js clamps`): always on a post, at each edge
of the pane where a post stands, from the post's face (`glassGapMm` before the pane's edge) over the edge,
`glassClampsPerSide` spread evenly over the pane's height there; 3D a steel block each (30 grip × 60 × the pane + 16 —
picture sizes, as the self-supporting), plan a grey square per held edge, the quote's fixings = the clamps. Tests:
`__tests__/glassClamps.test.js`.

## The production order (user request 2026-11-05, as built)

„🏭 Zamówienie PDF” (`export/productionOrder.js`, printed by the shared `app/printHtml.js`): the blanks as the workshop
writes them, large type (16–21 pt). Per group a heading = the element + its edges in the workshop's words
(„Stopnie proste kr. R6 + kanał na LED + wpust pod podstopnicę 10 mm”; „fazka n”, „półwałek”, „kr. proste”) — the treads
and the trim „fajka” with a SECTION DRAWING of the profile (`profileRings`: the front edge, the LED channel, the riser's
groove / a carpet riser's tongue groove with their distances from the front; the trim's nose + board) —, then the lines
„grubość x szerokość x długość - typ - n szt.” (identical pieces counted together, their codes under the line; the type
L / P / CZ / PL — a riser takes its tread's). Groups: straight / starter / winder treads, landings, risers („Podstopnie
dąb — za stopnicą, wpust …” / „dywanowe, na obce pióro”), noses, trims, skirting (stepped pieces with their mitres and
notches), cover stringers, posts (cap, grooves), balusters (rounded up to 10 mm), handrails (wall handrails with their
brackets), loose tongues. The both-sides tread type is now „PL” (the workshop's word, was LP). Layout (user request
2026-11-05): two columns, the drawings half size (1.5 px/mm), the sizes 15 pt — the order on one or two A4 pages; the
section outlines run the profile bottom → top (a crossing outline reported and fixed). The workshop's names: the
trim „fajka” is „Nosek wyk.” (nosek wykończeniowy) on the order, the DXF and the cut list (code `NW-n`; the app and the
client's offer keep „fajka”); winders / starter steps noted once per group „kształt wg szablonów”; a box to tick off
in front of every line. Tests:
`__tests__/productionOrder.test.js`.

## The opening's trim „fajka”; the posts' tops (user request 2026-11-05, as built)

`openingTrimModel.js buildOpeningTrim` → `built.openingTrim.pieces` (the module's own, as the self-supporting
`openingTrimModel.js`): along the chosen edges of the ceiling opening (`openingTrimEnabled`, `openingTrimEdges[k]`;
`trimEdges` — never the stair's exit edge, the antresola nosing is there) a NOSE into the opening
(`openingTrimNoseWidthMm` 20 × `openingTrimNoseHeightMm`, null = the tread's thickness) and a BOARD on the slab
(`openingTrimBoardThicknessMm`, null = the top floor finish else 15; `openingTrimBoardDepthMm` 100), their top flush
with the finished floor; mitred at a corner with the next trimmed edge, square where it has none. Plan mode „▬ Fajka”
(a click on an opening edge = trim there or not — the first click switches the trim on, on that edge only), 3D (nose +
board), the plan, the quote (a board per edge from the board price list, labour „nosing”), the DXF / cut list
(`NW-n`). The decorative posts' tops (`POST_CAPS`): flat, pyramid, ball, `round` (turned — a lathe profile: collar,
neck, dome) and `none` (the shaft to the top). Tests: `__tests__/trimCaps.test.js`.
- The trim meets the ANTRESOLA NOSING at the exit corner (user report 2026-11-05): the exit edge counts as a trimmed
  neighbour with the nosing's own lines (its overhang `overMm`, its depth on the slab `onSlabMm` — `exitNosing[].edge`);
  both are cut on the corner's diagonal (through the crossings of their inner / outer lines — exactly 45° when the two
  overhangs are equal); a nosing ending short of the opening's corner along its line (≤ 200 mm — the opening wider than
  the stair by its side nosing) is carried on to it. By default (user decision 2026-11-05) the trim's nose reach and
  board depth are the nosing's (`openingTrimNoseWidthMm` / `openingTrimBoardDepthMm` null → `trimNoseWidthMm` = front
  nosing + riser board, `trimBoardDepthMm` = `exitNosingDepthMm`), so the corner cut is one straight 45° line; the panel's
  „Wymiary jak nosek antresoli (45°)” switches back to them, the sliders set own values. The trim model returns the nosing's mitred outline
  (`exitNosingOutlines`), the orchestrator puts it on the nosing (`mitred`, its length anew).
- The 3D view's layers (bottom right, „Warstwy”, as the self-supporting HUD): concrete, treads (+ noses, trims),
  risers, skirting / cover stringers, balustrade, LED, walls, slab, the linked floor — view state only, remembered in
  this browser (`stair3d.claddingLayers`); the presentation's own slab / walls switches on top.

## A wall's end part-way along a step (user request 2026-11-05, as built)

A wall entry's ends may sit inside a step: `fromOffsetMm` / `toOffsetMm` (mm from the `from` step's start / the `to`
step's end, + = on up the flight). `surroundingsModel.js resolveWalls` (built once per build, `cfg.wallIndex`) places
every wall along its side in mm (`sA`, `sB` in the flight's frame) and `spansOf(element, edge)` splits an edge where a
wall ends; the treads' side edges are split (`splitEdgesByWalls` — the side nosing on the free part only, a jog at the
wall's end), the side runs' pieces too (`cutStart` / `cutEnd`: no riser piece / exit piece of the stepped skirting
there, the raked one starts at the tread's top), the full walls per stretch. Edits: drag a wall's end on the plan
(mode „▥ Ściany”, `wallEdits.js wallEnds` / `sideSAt` / `moveWallEnd` — snapped to the steps' edges within 12 px,
else 10 mm, the ends never crossing) or type the offsets in the list. Tests: `__tests__/wallEnds.test.js`.

## The riser boards' fitting; edge channels (user request 2026-11-05, as built)

The self-supporting mechanism (`riserSolver.js` / `treadSolver.js buildNotch`): `riserMount`
- `'behind'` (default): the riser stands BEHIND the tread below — that tread's edge on the next element's front edge
  (`onFrontOf`) / the last tread's back edge at the slab recedes by the riser's thickness (it ends at the riser's face),
  the riser goes down to its underside (the concrete; the first one on the raw floor, z = 0 — the floor finish laid
  against it) and UP `riserTopOverlapMm` (10, as the self-supporting) into a groove in the tread above's underside —
  `tread.grooves [{depthMm, strip = the riser's footprint}]` (the exit riser into the antresola nosing's); the DXF
  draws the groove on layer NOTCH and notes „wpust pod podstopnice n mm (spod)”; the nosing in front keeps its full
  thickness;
- `'carpet'` (dywanowa): BETWEEN the treads — on the tread below (which runs on under it) up to the tread above's
  underside, as thick as a tread (`riserThicknessOf`), on LOOSE TONGUES top and bottom (`riser.tongues = 2`): the DXF
  notes the tongue grooves on both treads, the cut list `OP-nn` × 2 (as long as the riser), the quote „Obce pióro” per mb
  (`looseTonguePerMb`, 15 zł).
The skirting's riser faces and the LED under the noses use the same thickness. The slab's opening runs to the slab's
edge (the exit riser's footprint included — the last tread now ends in front of it). The quote's option „Kanały i
obróbka krawędzi” (`edgeChannels`, a checkbox in „Cennik”): `edgeChannelsPerTread` (25 zł) per tread (landings not
counted), a material line. Tests: `__tests__/risers.test.js`.

## The wall editor — walls on some steps (user request 2026-11-05, as built)

„w 3 biegu pierwszy stopień jest ściana tylko z prawej, na kolejnych 4 po obu stronach, ściana tylko od płyty schodów w
górę”. `config.wallList` (null = the older per-flight `walls`, read as one entry per side): `[{id, flight, side, type,
heightAboveMm?, from, to}]`, `from` / `to` element indices (null = the side's start / end), a later entry wins where
two overlap. Types (`WALL_TYPES`): `full` (floor → slab), `low` (floor → `heightAboveMm` over the noses, 0 = slab),
`above` (NEW — from the stair's concrete: its bottom along the soffit, nothing under the flight → the slab / a height
over the noses), `under` (under the flight's edge → the soffit, the side above open); the walls between flights set
apart are list entries too (`withGapWalls` → `config.gapWalls`, before the user's own). `surroundingsModel.js wallsOf`
/ `wallOn(key, config, index)` / `edgeHasWall` resolve them PER ELEMENT; `sideRuns.js buildSideRuns` splits a side
into stretches under one wall (`run.wall`, `run.walled`, `run.seg`, `run.id` — the first stretch keeps the side's old
id `<flight>-<side>`, the next `-s<k>`), so the skirting / wall handrail go along the walled stretches and the cover
stringer / balustrade along the open ones (the panel's checkboxes are per side, enabled where it has such a stretch),
the side nosings / tread types follow per step. `built.sideRuns`, `built.gapWalls` for the panel / plan. Edits
(`wallEdits.js`): the list in „Ściany przy biegach” (flight, side, type, from / to step numbers as on the plan, height;
„+ Dodaj ścianę”) and the plan mode „▥ Ściany” (every step's side a clickable line coloured by its wall's type —
`wallCells`; a click = `toggleWallCell`: out of its wall (shortened / split) or the neighbouring wall grown onto it,
else a new one of the type chosen „z planu”; right click = the wall's next type). Tests: `__tests__/wallList.test.js`.

## The skirting at a turn's wall corner (user request 2026-11-05, as built)

`finishModel.js buildFinishBoards`: two skirted runs where one ends at the point the next starts (a wall's end on the
other wall's line — the outer corner of a landing turn, the wall corner inside a winder zone, both corners of a U) are
JOINED: `cornerCuts` gives each board's end there `corners.end` / `corners.start` `{s, k, angleDeg}` — the end cut
through the board's thickness so the two meet on the corner's bisector (k = (1 − nA·nB) / (dA·nB) for the ending
board, (1 − nA·nB) / (dB·nA) for the starting one: −1 / +1 at a 90° inside corner = 45°; > 0 an outside corner); walls in
line are not cut. The run going on at the same height starts like a landing (no vertical piece / raked bottom from its
top — `joinedStart`). The renderer shears the end's vertices by k × their depth from the wall's face
(`planeBoardGeometry`), the plan draws the cut footprint, the DXF notes „narożnik: koniec cięty 45° przez grubość
(wewnętrzny / zewnętrzny)” on the board / the piece at the corner. Tests: `__tests__/cornerType.test.js`.

## The tread's type L / P / CZ (user request 2026-11-05, as built)

Every tread / landing gets `sideType` from its side nosings (`claddingModel.js treadSideType`, `TREAD_SIDE_TYPES`):
L = nosed on the left (walking up), P = on the right, CZ (czołowy) = between walls — no side nosing, PL = both sides
free. Automatic from the walls and the panel's „Nosek boczny z lewej / prawej”; the step editor's „Typ stopnia (nosek
boczny)” sets it per tread (auto / L / P / CZ / PL = the own `nosingLeft` / `nosingRight`). Shown on the plan (under
the number), in the heights table (column „typ”), in the quote's tread names, the DXF / cut list (name „Stopień n P” +
a note). Tests: `__tests__/cornerType.test.js`.

## The wall handrail (user request 2026-11-05, as built)

`wallRails[flight][side]` (the column „poręcz przyścienna” in „Listwy, wangi obiciowe, balustrada” — only on a walled
side, the balustrade only on an open one) → `balustradeModel.js wallRail` → `built.balustrade.wallRails[]` `{id
'wall-rail-<flight>-<side>', key, handrail [{x, y, z}] (its centre line), brackets [{s, wall, rail, z}], lengthMm,
treadCount, outward}`. Its top `wallRailHeightMm` (900, DO WERYFIKACJI) over every nose, level over a landing (the
balustrade's own rule, `topOver`); its axis `wallRailClearanceMm` (50, the self-supporting
`railingWallRailClearanceMm`) + half the handrail's width off the wall's face (= the concrete's side edge), the whole
side long; `wallRailReturn` turns both ends into the wall. Brackets evenly ≤ `wallRailBracketSpacingMm` (1000, as the
self-supporting) apart, the outer ones `wallRailBracketEndMm` (150, ASSUMPTION) in from the ends, at least two. A wall
„above the steps” lower than the handrail + 50 mm carries none — WARNING `CLAD-WALL-RAIL-LOW`. 3D (the handrail, each
bracket an arm + stub + wall plate, in the `Railing` group), plan (the line + a tick per bracket), LED under the handrail
(`ledHandrailEnabled`), the quote („Poręcz przyścienna” per mb — `railing-handrail` —, „Uchwyty” per piece —
`railing-wall-bracket` — from the shared list, labour `wall-rail` per mb). Folder „Poręcz przyścienna”. Tests:
`__tests__/wallRail.test.js`.

## The presentation mode (user request 2026-11-05, as built)

„🎬 Prezentacja” (toolbar, `app/claddingApp.js setPresentation`): the 3D only (the bar, the panels and the plan's modes
hidden — `.clad-app.clad-present`), no grid / axes, the ground and its shadow as the self-supporting presentation, the
slab hidden and the walls shown by default (toggles „Strop” / „Ściany” on the floating bar), the stair framed again
without the room; Esc or „✕ Zakończ” goes back to the view before. The company logo through the SHARED
`app/presentation.js createPresentationLogo` (read-only — the same logo, corner and size as the self-supporting one,
remembered in this browser under `stair3d.presentationLogo`; „Logo…”, corner, size, „✕ logo”); „📷 Zapisz zdjęcie” =
the shared `savePresentationSnapshot` (the scene at 2× + the logo, PNG named after the project). View state only — not
the config, not in undo. The isolation list gains `app/presentation.js` and `scene/presentationImage.js`.

## The model 3D for the client (user request 2026-11-05, as built)

„Oferta” tab → „📦 Model 3D dla klienta”: HTML (one self-contained file — the self-supporting client's viewer with its
views, „Ściany i strop”, tape measure, the logo and the stair's facts), GLB (Windows / Android / any 3D program), USDZ
(iPhone / iPad, AR). `export/clientModel.js claddingClientScene` renders the stair (concrete, cladding, balustrade,
LED) and hands the walls + slab (`Room`) as the viewer's 'room' layer to the SHARED `export/clientModelExport.js`
(read-only: `buildClientScene`, `sceneToGLB` / `sceneToUSDZ`, `clientViewerHTML`) with the viewer bundle
`virtual:client-viewer-runtime`; `claddingClientFacts` = the offer's stair facts without „Montaż”. A linked floor is
not included. Never the project, its parameters or prices. The isolation list gains `export/clientModelExport.js` and
the package `virtual:client-viewer-runtime`. Tests: `__tests__/clientModel.test.js`.

## Tape measures (user request 2026-11-05, as built)

View tools only — never the config, the project or an export. Plan: mode „📏 Miarka” (claddingApp.js `planMode
'measure'`): a click = the start, a second = the end, each snapped by the SHARED `plan2d/planMeasure.js
snapMeasurePoint` within 10 px to `claddingPlanRenderer.js claddingMeasureRefs` (the concrete's / treads' / risers' /
the antresola nosing's / walls' corners, the opening's corners, the finishing boards' and side walls' ends, the posts,
the handrails' points, the winder zones' corners), else whole mm; drawn by the plan renderer (`measures`,
`measureDraft`, screen-constant text — `mmPerPx`) with `planMeasureText` (length, Δx, Δy); right click = remove the
last, Esc = cancel the one being drawn; leaving the mode clears them. 3D: „📏 Miarka” / „Wyczyść” bottom left of the
3D view (also in the presentation) = the SHARED `scene/measureTool.js createMeasureTool` (snap to a corner / edge of
the face hit — `viewer/measure3d.js`, the client's viewer's rule): distance, height difference, horizontal; Esc turns
it off. The isolation list gains `plan2d/planMeasure.js`, `scene/measureTool.js`, `viewer/measure3d.js`. Tests:
`__tests__/measure.test.js`.

## Export (user request 2026-11-04, as built 2026-11-05)

Toolbar „⬇ DXF 1:1”, „⬇ DAE”, „⬇ OBJ” (files named after the project).
- DXF (`export/claddingDxf.js buildCladdingDXF`, the module's own small R12 writer — ASCII, mm, no diacritics; the
  self-supporting `dxfExport.js` is built round that engine's models and is not used): every cladding piece FLAT 1:1 on
  one sheet, in rows — treads and noses (a tread in its own frame: grain along x = its longest front edge, the front at
  the bottom; a floor-board landing only its nosing piece), landings, risers (length × height; a starter's bent riser
  developed), skirting boards and cover stringers (their polygon in their own vertical plane), glass panes. Layers
  `OUTLINE`, `PROFILE` (a profiled tread's milled edges — the front and the nosed sides, `tread.exposed`), `TEXT` (code,
  name, size, thickness, notes: profile, starter, winder). Codes (`claddingPieces`): `ST-nn` tread, `PD-nn` landing
  (`PD-nnN` its nosing), `PS-nn` riser (`PS-nna/b…` a winder's panels, `PS-G` the exit riser), `NA` antresola nosing,
  `LS-<flight><L|P>` skirting, `WO-<flight><L|P>` cover stringer, `SZ-n` pane. Nothing to draw → `null`.
- Cut list „⬇ Formatki CSV” (`export/cutList.js buildCutList` / `cutListToCSV`, user request 2026-11-05): one row per
  piece of the DXF (same codes, Polish names — the DXF writes them in ASCII) at its blank size + thickness + the wood
  (`boardPricing.species` / `cls`) / „szkło VSG”, then a floor-board landing's OSB / boards in m² (`PD-nn-OSB`,
  `PD-nn-DP`), the balustrade's wood per section (`PR-n` handrail by its developed length, `TR-n` balusters — the
  longest —, `SL-n` posts with the cap) and the wall handrails (`PR-n`, brackets in the notes). For Excel in Polish:
  `;`, a decimal comma, UTF-8 with a BOM, CRLF (the self-supporting takeoff CSV has English headers and its own items —
  not used).
- DAE / OBJ: the module's OWN small writers (`export/claddingMeshExport.js buildCladdingDAE` / `buildCladdingOBJ`,
  pure text) — the shared `export/daeExporter.js` / `objExporter.js` have the self-supporting categories built in (an
  unknown group falls into „Stopnie”), so the concrete could not be a group of its own there (user request
  2026-11-05). `claddingExportRoot(root, {concrete = true})`: every visible mesh with its world transform baked into
  a copy of its geometry, one group per category (`EXPORT_GROUPS`): „Stopnie” (treads, landings, noses),
  „Podstopnice”, „Listwy_i_wangi” (skirting, cover stringers), „Balustrada”, „Beton” (the concrete steps / landings,
  the starter blocks). The room, the LED strips and a linked floor are not exported. DAE: COLLADA 1.4.1, mm declared,
  Y up, a colour per material (glass with its transparency); OBJ: mm (set on import). Only
  `export/downloadTextFile.js` is shared. The isolation test lets `*MeshExport.js` use Three.js (it works on the
  rendered scene, like a renderer).
- Tests: `__tests__/export.test.js`.

## Open questions

1. (answered 2026-11-04) Winder edges are measured from the wall corner and the dusza corner; the uneven-rise
   tolerance is 5 mm.
2. Labour rates (the user types them; the item list can grow with own items).
