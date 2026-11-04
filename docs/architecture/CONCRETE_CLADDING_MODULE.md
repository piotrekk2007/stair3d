# Concrete cladding module ("Schody na beton") — plan

Status: PLANNED (user request 2026-11-04). Nothing of it is built yet; this document is the agreed direction and is
updated as each stage lands.

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
   - the toolbar's tab "Schody na beton" (workspace switch) — `ui/workspace.js` / `main.js`;
   - linking floors (below): the reference-stair loader chooses the builder by the file type;
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

## Open questions

1. Winder edge measurement: from where are the two distances measured — the wall corner (outer) and the dusza corner,
   or from the previous edge / the flight's last straight riser?
2. The tolerance for uneven finished rises (warning) — e.g. 5 mm?
3. Labour rates and the full item list (stage 4).
