# stair3d

See [.claude/RULES.md](.claude/RULES.md) for the mandatory architecture and
geometry rules governing this project. Read them before making any change
to model, solver, validation, rendering, or UI code.

See [docs/rules/TECHNICAL_RULES_CATALOGUE.md](docs/rules/TECHNICAL_RULES_CATALOGUE.md) and
[src/rules/README.md](src/rules/README.md) for the technical staircase-design knowledge base
(legal requirements, engineering guidance, industry best practice, manufacturing assumptions).
This is a data layer — no geometry wiring exists yet. Consult it before implementing any
geometry rule, validation check, or default value so numbers are traceable to a source
instead of invented.

See [docs/rules/PROFILES.md](docs/rules/PROFILES.md) for the Staircase Design Profile system
(`src/rules/profiles/`, `src/rules/checks.js`, `src/rules/validator.js`): a project selects
one named profile (e.g. `POLAND_RESIDENTIAL_TIMBER_DEFAULT`, recorded in
`config.designProfileId`) bundling four independently-swappable rule layers — legal,
industry best practice, company manufacturing rules, and user/project preferences — and the
validator explains, per rule, why it passed or failed. Not yet wired into `buildStaircase.js`
or the UI.

See [docs/architecture/STAIR_SOFTWARE_BENCHMARK.md](docs/architecture/STAIR_SOFTWARE_BENCHMARK.md)
for a functional/architectural benchmark of professional stair-design software, and
[docs/model/STAIRCASE_DATA_MODEL.md](docs/model/STAIRCASE_DATA_MODEL.md) for the formal,
parametric staircase data model (coordinate system, `frontEdge`/`backEdge` terminology, the
`Nominal → Override → Final` edge model, the object model for `Staircase`/`Run`/`Step`/
`TreadEdge`/`Walkline`/`Stringer`/`StringerSupport`/`Riser`/`Landing`/`WinderGroup`, and the
persisted-project/resolved-model JSON Schemas). Consult both before changing
`src/config/schema.js`, `src/geometry/planLayout.js`, or any geometry solver.

See [docs/architecture/CONSOLIDATION.md](docs/architecture/CONSOLIDATION.md) for the full
per-function duplication analysis behind the sections below (which pairs were the same case
and got merged, which were genuinely different and were deliberately kept separate, and why).

## Stringer: one implementation (consolidated)

`src/geometry/stringerModel.js` (data shape + invariants) and
`src/geometry/stringerSolver.js` (`buildStringerModel(planLayout, config, side)`, a pure
function) are now the **only** stringer geometry logic in the codebase, consumed by
`src/geometry/stringerRenderer.js` — the **only** Three.js mesh builder for wangi, wired into
`buildStaircase.js`. The old `stringerGeometry.js` (per-tread flat panels + a centroid-based
`computeNormal()` heuristic) has been **deleted**; there is no fallback. Every stringer
segment is `StringerReferenceGeometry` (the physical board's straight axis, derived ONLY from
`tread.outerChain`/`innerChain` — never touched by manual edits) plus one `StringerSupport`
(kind `'tread-bearing'`) per tread, derived from `tread.frontEdge`/`backEdge` (the FINAL,
possibly manually-edited fields) and rendered as one flat panel spanning
`[finalUStart, finalUEnd]` along that segment's own already-straight reference line — so a
panel can never be crooked, because there is nothing left to compute per-panel except where
along a known-straight line it starts and ends. `stringerRenderer.js` also reproduces the old
renderer's lap-joint corner extension (when `hasCornerPost` is false) generically, by
detecting geometrically-adjacent segments, rather than tracking specific bend points.
Regression tests enforcing this ("no `stringerGeometry.js`", "no independent path solver in
the renderer", "renderer panel count == solver bearing count", straightness/parallelism/
spacing, manual-edit invariants) live in
[src/geometry/__tests__/consolidationInvariants.test.js](src/geometry/__tests__/consolidationInvariants.test.js).

## Terminology: `frontEdge`/`backEdge` (consolidated)

The legacy field names `rearRiser`/`frontRiser` (which were backwards relative to their own
names — see the historical audit) have been **fully renamed** to `frontEdge` (czoło, first
contact when walking up — `Step[0].frontEdge` is the Origin) and `backEdge` (tył, shared with
the next tread), across `planLayout.js`, `edgeOverrides.js`, `stringerSolver.js`,
`riserSolver.js`, `treadSolver.js`, `winderBlank.js`, `dimensionLabels.js`, and all tests.
`nosingUtils.js`'s `outwardRearNormal`/`shiftRearEdge` are now `outwardNormalFromOutline`/
`shiftFrontEdge`. No alias or compatibility shim was kept — a static test
(`consolidationInvariants.test.js`, "invariant 8") greps the entire active source tree and
fails if either legacy name reappears. `tread.winderInfo.frontEdge`/`.backEdge` (a richer,
nested per-side-direction object, unrelated name collision — see planLayout.js) predates and
is unaffected by this rename.

## Geometric primitives (consolidated)

- **Tolerances**: `src/geometry/tolerances.js` defines exactly three canonical epsilons —
  `GEOMETRY_EPS` (mm, point/length identity), `COLLINEAR_EPS` (mm², corner detection),
  `INTERSECTION_EPS` (dimensionless, parallel-line degeneracy) — replacing four previously
  independent, undocumented local epsilons. A few genuinely different-purpose `1e-3`
  tolerances remain local in `stringerModel.js` (comparing two independently-computed
  representations of the same quantity) — each has an inline comment explaining why it is
  *not* one of the three canonical ones.
- **Point/vector primitives**: `pathUtils.js` now owns the canonical `pointsEqual()` and
  `normalizeVector()`, previously reimplemented independently (different names, same formula)
  in `nosingUtils.js`, `planLayout.js`, and `stringerSolver.js`.
- **Outward-normal primitives** (`nosingUtils.js`): two, *deliberately* not merged because
  they are mathematically different cases — `outwardNormalFromOutline()` (centroid-based sign
  test, used when only a tread's outline is known) and `outwardNormalFromForward()` (a
  known walking-direction vector negated, used by `riserGeometry.js`'s winder fan and by
  `stringerRenderer.js`, both of which already know the direction and must never fall back to
  the centroid heuristic that was the root cause of the winder-riser bug).
- **Transverse direction**: `planLayout.js` exports `rotate90CW()` as the one, canonical
  "kierunek poprzeczny" definition (right = `rotate90CW(forward)`, always pointing outer →
  inner/dusza) — `stringerRenderer.js` imports it rather than re-deriving which way a board's
  thickness should extrude.

## Project file format v2 (implemented)

`src/project/projectIO.js` writes/reads `_version: 2`: `edgeOverrides` lives as its own
top-level field in the **file**, separate from `config` (matching
`docs/model/STAIRCASE_DATA_MODEL.md` §7.1 — manual edge overrides are the `Nominal → Override
→ Final` correction layer, not a `Staircase` input parameter). `parseProjectJSON` migrates a
v1 file (`edgeOverrides` nested as `config.manualEdgeOverrides`) automatically via a
`MIGRATIONS` registry keyed by source version, open to future versions. **Scope note**: this
is a file-format-only change — the in-memory runtime `config` object still nests
`manualEdgeOverrides`, since that shape is deeply wired through `buildPlanLayout`/
`edgeOverrides.js`/`main.js`/`ui.js`; splitting it at runtime is a separate, larger data-model
refactor not undertaken here. Tests: `src/project/__tests__/projectIO.test.js`.

## 2D plan editor (implemented)

`src/plan2d/viewport.js` (pure pan/zoom/fit math), `src/plan2d/planInteractions.js` (wheel
zoom anchored at the cursor, pinch, middle-button/space+drag pan, edge-handle drag, step
click-to-select — all pointer/keyboard handling for the plan panel), and
`src/history/modelHistory.js` (undo/redo stack of `config` snapshots — MODEL-level, never
view/selection state) are wired into `main.js`/`ui.js`. `src/plan2d/plan2dRenderer.js` renders
purely from a caller-supplied `viewport` and `layers` (grid/axes/widths/walkline/
runBoundaries/stepBoundaries/stringers) and never owns pan/zoom state itself. The HUD
(`#plan2d-hud`: zoom/fit buttons, scale readout, legend) lives in a DOM node that is a
**sibling** of the SVG container (`#plan2d-svg-container`) inside `#plan2d-panel`, both created
once — `regeneratePlan2D()` only ever overwrites `#plan2d-svg-container.innerHTML`, never
`#plan2d-panel.innerHTML`, so redrawing the plan can no longer destroy the HUD (a real,
browser-verified bug from an earlier pass, fixed in the consolidation pass — see git history).
Edge dragging still only ever writes to `config.manualEdgeOverrides` (never a Three.js mesh);
undo history is committed on `pointerup`/`onFinishChange`, not on every live-drag tick.

## Winder riser fix (implemented)

`planLayout.js`'s `buildTurnLocal` attaches a `tread.winderInfo` object to every winder
tread — `frontEdge`/`backEdge` (each with `inner`, `outer`, and per-side
`innerDirection`/`outerDirection` unit vectors), `direction`, `stationStart`/`stationEnd`,
`widths`, `walklinePosition`. This exists because the inner ("dusza") boundary is always
already-turned within a turn zone while the outer boundary only bends at its own corner
point, so a winder tread's inner and outer boundary points can legitimately face different
local directions ("different phases"). `riserSolver.js`'s `buildWinderPanels` uses
this to build every winder riser as a `WINDER_RISER_FAN_PANELS`-panel fan (currently 2),
blending the inner/outer directions across the panel's width — applied uniformly to every
winder tread (a type check, not a numeric-threshold patch), and exposes the divergence itself
as plain data (`RiserModel.directionSpreadDeg`, `.maxPanelWidth` — see the section below) so
this exact bug class is detectable before any mesh exists. `winderInfo` is correctly carried
through both `transformTread`'s frame-chaining (U-shaped double turns) and the
`turnDirection === 'left'` mirror step. Extreme-case tests (90°, a 180°-equivalent double
U-turn, small/large effective radius, 2–12 winders, asymmetric `walklineSplitOffset`, and
`turnDirection='left'` mirroring) live in
[src/geometry/__tests__/winderStep.test.js](src/geometry/__tests__/winderStep.test.js).

## Tread / Riser / Post: MODEL/SOLVER split from the Three.js renderer (implemented)

Following the same pattern already established for stringers, every remaining staircase
element now has its geometry decided in a plain-data MODEL/SOLVER file and turned into
triangles by a separate RENDERER file that contains no geometric decision-making of its own.
The only allowed dependency direction is `MODEL → SOLVER → MODEL RESULT → RENDERER →
THREE.JS`; no `*Solver.js`/`*Model.js` file imports `three`, and no `*Renderer.js` file calls
`buildPlanLayout()` itself (both are enforced by `consolidationInvariants.test.js`,
invariants 9b/9c). `buildStaircase.js` is a pure orchestrator: it calls
`buildTreadModels()`/`buildRiserModels()`/`buildStringerModelsForFlight()`/`buildPostModels()`
(all `(planLayout, config) -> data`, no Three.js), then
`renderTreads()`/`renderRisers()`/`renderStringers()`/`renderPosts()` (all
`(model, material) -> THREE.Group`, no geometric solving) — it contains no staircase-geometry
logic itself.

- **`treadSolver.js`** (`TreadModel`) — per tread: `elevation`, `direction`, `widths`,
  `frontEdge`/`backEdge` as `{nominal, final, overridden}` (nominal from the tread's raw
  `innerChain`/`outerChain`; landing treads have an empty `innerChain` by design, so their
  nominal is defined as equal to final — an honest, documented limitation, not a bug), the
  nosed `outline`, and a passthrough `winderInfo`. `treadRenderer.js` only extrudes
  `outline`/`elevation`/`thickness` into a prism.
- **`riserSolver.js`** (`RiserModel`) — this is the model that makes the historical
  "podstopień nienaturalnie szeroki lub obrócony" bug class provably testable at the data
  level: `panels` (one for straight/landing, `WINDER_RISER_FAN_PANELS` for a winder tread's
  fan), `directionSpreadDeg` (the angle between the tread's inner/outer local directions —
  large exactly when a flat single panel would have been wrong), and `maxPanelWidth`. See
  [src/geometry/__tests__/riserModel.test.js](src/geometry/__tests__/riserModel.test.js)'s
  "THE PROBLEMATIC CASE" test, which asserts this divergence is visible as a plain number,
  before any `THREE.BufferGeometry` exists. `riserRenderer.js` only extrudes each panel.
- **`postSolver.js`** (`PostModel`) — deliberately kept thin (no nominal/override/final):
  posts have no manual-edit path today, so there is nothing to validate beyond position/size/
  elevation. Still a real model (not inline box-building in the renderer) because the start
  post's position is a genuine derivation from `planLayout` (shifted forward to avoid
  swallowing the first tread's nosing) and corner posts are de-duplicated when a merged
  landing gives two turns the same corner point. `postRenderer.js` only builds a box mesh per
  model.
- **`stringerRenderer.js`** no longer calls `stringerSolver.js` itself — its signature changed
  from `buildStringerMeshGeometries(planLayout, config, side)` to
  `buildStringerMeshGeometries(model, hasCornerPost)`, taking an already-built `StringerModel`.
  `buildStaircase.js` is now the only place a `StringerModel` gets built and then rendered.

**Deleted** (superseded, no compatibility shim): `treadGeometry.js`, `riserGeometry.js`,
`postGeometry.js`. THREE.js group/mesh naming (`Treads`, `StringerOuter`, `StringerInner`,
`Posts`, `RiserBoards`, and each mesh's name) is unchanged from before this split, since
`objExporter.js`/`daeExporter.js` key their "Zaznacz wg materiału" grouping off these exact
names. Tests:
[src/geometry/__tests__/treadModel.test.js](src/geometry/__tests__/treadModel.test.js),
[src/geometry/__tests__/riserModel.test.js](src/geometry/__tests__/riserModel.test.js).

## Staircase Validator (implemented)

[src/validator/StaircaseValidator.js](src/validator/StaircaseValidator.js) is THE independent,
read-only entry point for "is this staircase okay?" — `validateStaircase(config)` /
`validateModels(models)`, never mutating config or a model, never touching Three.js. It
composes three layers rather than reimplementing any of them: `src/constraints/` (hard
invariants), `src/rules/`+`src/validation/facts.js` (profile-dependent technical/legal/
ergonomic rules), and [src/validator/checks.js](src/validator/checks.js) (the remaining
checklist items that had no home yet — walkline consistency, collisions/headroom, invalid
points, zero-length riser/stringer geometry, reversed normals, missing surfaces, and an INFO
note per actually-applied manual edit, read from `TreadModel.overridden` — never from
`config.manualEdgeOverrides` presence, so a solver-rejected edit correctly produces no note).
Findings are `Diagnostic`s (`src/diagnostics/diagnostic.js`, now carrying an explicit
`parameter` field alongside `elementType`/`elementId`/`value`/`expected`) at one of exactly
three levels — `ERROR`/`WARNING`/`INFO`. Two catalogue rules that existed but had no evaluable
check (`GEN-ERGO-B-03` riser-height consistency, `GEN-ERGO-B-04` tread-going consistency) were
wired up in `checks.js`/`facts.js` as part of this stage.

**Adding a norm/building-code rule later** does not touch this file: add a rule set under
`src/rules/sets/`, an optional predicate in `src/rules/checks.js`, and reference it from a
profile in `src/rules/profiles/definitions.js` — exactly the mechanism the profile system
already provides (see `docs/rules/PROFILES.md`); no new registration API was introduced.
Tests: [src/validator/__tests__/checks.test.js](src/validator/__tests__/checks.test.js),
[src/validator/__tests__/StaircaseValidator.test.js](src/validator/__tests__/StaircaseValidator.test.js).

**Wired into the UI.** `buildStaircase.js` now also returns `fullConfig`/`treadModels`/
`riserModels`/`stringerModels`/`postModels` (the models it already computed internally)
specifically so `main.js`'s `rebuild()` can call `validateModels(...)` on the EXACT same
models, never solving geometry a second time just to validate it. Results render in a new
floating panel — `createValidatorPanel()`/`updateValidatorPanel()` in `src/ui/ui.js`,
`#validator-panel` in `style.css` — docked bottom-right with a higher z-index than
`#plan2d-panel`, so it stays visible **next to whichever of the 2D plan or 3D view is
currently shown**, not only one of them. It lists every finding (ERROR/WARNING/INFO, sorted by
severity, each showing its step, message, and value/expected when present), a live
ERROR/WARNING/INFO count in the header, and a collapse toggle. `ui.js` only renders what it's
given — no validation logic lives there.

## Material Takeoff Layer (implemented, not yet wired into the UI)

`src/takeoff/` computes a bill-of-quantities from the same constructional model as everything
above (`TreadModel[]`/`RiserModel[]`/`StringerModel`/`PostModel[]`) — zero Three.js, zero cost
calculation. Three deliberately separate layers, mirroring the Validator's own composition:

- **`src/takeoff/materialTakeoff.js`** (`computeMaterialTakeoff`) — QUANTITIES only. One
  `TakeoffItem` per (element type, subtype): `tread-straight`/`tread-winder`/`tread-landing`
  (a landing tread already covers "podesty" — it's just a tread of type `landing`),
  `stringer-outer`/`stringer-inner`, `riser-board` (present only when `hasRiserBoards`),
  `post-newel`/`post-corner` (corner posts only when `hasCornerPost`) — config-conditional
  elements are simply absent, never emitted with `quantity: 0`, and are marked `optional: true`
  when present. Every quantity is measured from the REAL model (tread area via
  `pathUtils.js`'s new canonical `signedPolygonArea`, summed per real winder tread — never a
  nominal `width × treadGoing` guess), never re-derived independently of it.
- **`src/takeoff/wasteFactors.js`** — the waste/reserve fraction per element type ("odpady" /
  "zapas materiałowy"), a MANUFACTURING_ASSUMPTION-style figure (same category as
  `src/rules/sets/manufacturingAssumptions.js`), fully overridable per call — never hardcoded
  into the solver above.
- **`src/takeoff/pricing.js`** (`applyPricing`, `DEFAULT_PRICE_CATALOG`) — COST, joined onto
  quantities by `itemId` afterwards. `calculatedCost`/`unitPrice` are `null` until this runs;
  changing a price catalog never touches quantities (proven by
  `pricing.test.js`), and an item missing from the catalog stays honestly unpriced rather than
  guessed.
- **`src/takeoff/index.js`** — the facade (`buildTakeoff` for quantities-only,
  `buildPricedTakeoff` for quantities+cost in one call), plus **`src/takeoff/export/`**:
  `toCSV.js`/`toJSON.js` (ready now) and `toTextReport.js` (the intended PDF export point — its
  plain-text lines are exactly what a PDF layout library would consume; none is wired in, per
  the project's no-new-dependency-without-a-concrete-need stance).

Every `TakeoffItem` (`src/takeoff/takeoffTypes.js`) always carries `type`, `dimensions`,
`quantity`, `netVolume`/`grossVolume`, `material`, `wasteFactor`, and the (possibly still-null)
cost fields — exactly the fields requested. **Not yet wired into the UI** — same deliberate
staging as the Validator was before this stage; `buildStaircase.js` already returns everything
`computeMaterialTakeoff` needs, so wiring it in later needs no new plumbing.
Tests: [src/takeoff/__tests__/materialTakeoff.test.js](src/takeoff/__tests__/materialTakeoff.test.js),
[src/takeoff/__tests__/pricing.test.js](src/takeoff/__tests__/pricing.test.js),
[src/takeoff/__tests__/export.test.js](src/takeoff/__tests__/export.test.js),
[src/takeoff/__tests__/index.test.js](src/takeoff/__tests__/index.test.js).

## Constraints & Technical Validation (implemented)

See [docs/architecture/CONSTRAINTS_AND_VALIDATION.md](docs/architecture/CONSTRAINTS_AND_VALIDATION.md)
for the full model. Two deliberately distinct layers, never mixed:

- **`src/constraints/geometricConstraints.js`** — GEOMETRIC/STRUCTURAL CONSTRAINTS: what
  geometry is allowed to exist (step ordering, `frontEdge`/`backEdge` direction semantics,
  non-degenerate edges/widths, simple tread polygons, topological continuity through
  landings/winders, stringer straightness/parallelism/spacing, bearing-to-tread attachment).
  Always severity `ERROR`, always evaluated on already-built MODEL data
  (`TreadModel[]`/`StringerModel`), never on a `THREE.Mesh`.
- **`src/rules/` + `src/validation/`** — TECHNICAL VALIDATION RULES: whether an otherwise
  valid staircase is *acceptable* under a selected profile. `src/rules/` (catalogue/profiles/
  `checks.js`/`validator.js`) is unchanged data from the earlier rules stage;
  `src/validation/facts.js` (new) is the adapter that finally wires it to real geometry —
  `buildFacts(config, derived, planLayout, treadModels)` — including
  [src/geometry/walklineModel.js](src/geometry/walklineModel.js)'s new `WalklineModel` (the
  walkline as a first-class object: `origin`/`direction`/`offset`/per-tread `points`), used to
  evaluate winder width (`PL-LEGAL-C-01`, new entry in `checks.js`) at a fixed distance from
  the inner edge, independent of `config.walklineOffset`.

Both layers speak one shape, `src/diagnostics/diagnostic.js`'s `Diagnostic` (`ruleId`,
`severity`, `elementType`, `elementId`, `value`, `expected`, `unit`, `message`) — structured
data, no UI strings, no coupling to the UI.

`src/validation/pipeline.js`'s `runValidationPipeline(config, profileId)` is the deterministic
8-stage orchestrator (`BASIC_NUMERIC → TOPOLOGY → GEOMETRIC_CONSTRAINTS → ERGONOMICS → WINDER →
STRINGER → CONSTRUCTION → MANUFACTURING`) and the one place geometry-building and rule-profile
resolution meet — it is intentionally not called from anywhere in `src/geometry/`, so the
geometry engine stays independent of jurisdiction. **Not yet wired into `main.js`/`ui.js`/
`buildStaircase.js`** — same deliberate staging as the rules/profiles system before it. Manual
edits need no separate path: `config.manualEdgeOverrides` is just a config field, so
re-running the pipeline on an edited config re-solves and re-validates from scratch.
Tests: [src/constraints/__tests__/geometricConstraints.test.js](src/constraints/__tests__/geometricConstraints.test.js),
[src/geometry/__tests__/walklineModel.test.js](src/geometry/__tests__/walklineModel.test.js),
[src/validation/__tests__/pipeline.test.js](src/validation/__tests__/pipeline.test.js).

**RiserModel nominal/final split (fixed, found via an end-to-end manual-edit trace):**
`riserSolver.js` used to read `tread.innerChain`/`tread.outerChain`/`tread.winderInfo.frontEdge`
(all RAW, never touched by `edgeOverrides.js`) to build every riser panel — so a manual
tread-edge edit correctly moved the tread outline and the stringer bearing but silently left
every riser panel untouched. `RiserModel` now carries an explicit `frontEdge: {nominal, final,
overridden}` (reusing `treadSolver.js`'s own exported `nominalEdgesOf`/`edgesEqual` — one
canonical nominal/final answer, not one per solver); panel endpoints are always built from
`frontEdge.final`, while a winder fan's panel *direction* deliberately stays the nominal
construction reference (documented in `riserSolver.js`'s header — there is no independently
computed "final direction" for a turn boundary). See
[docs/architecture/CONSTRAINTS_AND_VALIDATION.md](docs/architecture/CONSTRAINTS_AND_VALIDATION.md)
§6a for the full before/after, and the new constraint
`CONSTRAINT-RISER-FOLLOWS-FINAL-EDGE` (`checkRiserFollowsFinalTreadEdge`) that now guards
against this regression permanently. Tests:
[src/geometry/__tests__/riserModel.test.js](src/geometry/__tests__/riserModel.test.js),
[src/geometry/__tests__/manualEdgeConsistency.test.js](src/geometry/__tests__/manualEdgeConsistency.test.js),
[src/geometry/__tests__/riserRenderer.test.js](src/geometry/__tests__/riserRenderer.test.js).
