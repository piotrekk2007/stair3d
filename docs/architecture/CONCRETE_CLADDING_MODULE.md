# Concrete cladding module ("Schody na beton") — plan

Status: stages 1–5 BUILT (2026-11-04), stage 6 (offer documents) planned (user request 2026-11-04). This document is the agreed
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
   appearance), `plan2d/viewport.js`, `export/` writers where the format fits. Where the module needs different
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
  finished treads and risers, top raked through the noses + `skirtingHeightMm` or stepped; `skirtingThicknessMm` into the
  stair) and the COVER STRINGER on an open side (`coverStringers {[flight]: {left, right}}`, bottom along the soffit,
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

## Open questions

1. (answered 2026-11-04) Winder edges are measured from the wall corner and the dusza corner; the uneven-rise
   tolerance is 5 mm.
2. Labour rates (the user types them; the item list can grow with own items).
