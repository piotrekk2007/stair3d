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
possibly manually-edited fields), positioned at `[finalUStart, finalUEnd]` along that segment's
own already-straight reference line — so a bearing can never be crooked, because there is
nothing left to compute per-bearing except where along a known-straight line it sits. **This
analytical model is unchanged by the construction-geometry stage below** — only how
`stringerRenderer.js` turns it into a mesh changed (it used to render one independent
rectangle per bearing; see "Stringer construction geometry" for why and what replaced it).
`hasCornerPost === false` lap-joint corner extension is still driven by real geometric
adjacency between consecutive segments, generically. Regression tests enforcing this ("no
`stringerGeometry.js`", "no independent path solver in the renderer", straightness/
parallelism/spacing, manual-edit invariants) live in
[src/geometry/__tests__/consolidationInvariants.test.js](src/geometry/__tests__/consolidationInvariants.test.js).

## Stringer construction geometry (implemented)

See [docs/architecture/STRINGER_CONSTRUCTION_MODEL.md](docs/architecture/STRINGER_CONSTRUCTION_MODEL.md)
for the full technical model. `src/geometry/stringerConstructionGeometry.js`
(`buildStringerConstructionGeometry(stringerModel, config)`) is a NEW solver layer **on top
of**, never replacing, `StringerModel`/`StringerSegment`/`StringerTreadBearing` — it turns the
analytical bearing model into a real, continuous timber board contour
(`StringerSegmentConstructionGeometry`, one per segment): a plain 2-point "pitch line" struck
through the segment's first/last bearing, then either a stepped-top/straight-bottom contour
(`cut`, "wanga nakładana") with separate `cleats[]`, or a plain-rectangle contour (`closed`,
"wanga wpuszczana") with separate `housings[]` recessed into the inner face — never the old
per-bearing rectangle stack whose bottom edge sawtoothed along with the top. Diagnostics
(`STRINGER-MIN-SECTION`, `STRINGER-CONTOUR-SELF-INTERSECTION`) are computed but **not yet wired
into the Staircase Validator UI** — same deliberate staging pattern used throughout this
project. `stringerRenderer.js` now takes both `StringerModel` and this construction geometry
and decides nothing itself — one continuous board mesh per segment, plus one small mesh per
cleat/housing, each tagged with the same traceability `userData` scheme as every other element.
Tests: [src/geometry/__tests__/stringerConstructionGeometry.test.js](src/geometry/__tests__/stringerConstructionGeometry.test.js).

**Technical specification lock (implemented, docs+rules-catalogue only — no geometry/UI
change).** A product/geometry reality check across 6 live scenarios (straight/L-winder ×
overlay/housed, plus manual outer/inner edge edits) confirmed the geometry works, but
surfaced open technical questions the spec above didn't yet resolve. See
[docs/STRINGER_CONSTRUCTION_SPEC.md](docs/STRINGER_CONSTRUCTION_SPEC.md) for the full
resolution: terminology (confirms `cut`=cut/open string, `closed`=housed/closed string, but
finds **`cleats[]`'s attachment to `cut` is a Stair3D software choice, not a confirmed industry
pairing** — "open-cleated" isn't a distinct published category), the two-point pitch-line
method (now explicitly documented as a `SOFTWARE_DESIGN_CHOICE`/`ASSUMPTION`, not an
established industry method — mathematically exact for uniform straight flights, an
approximation elsewhere, safely diagnosed when it degrades), winder transition (multi-piece
post-jointed boards confirmed as the right structural concept per published sources, with two
gaps documented but not fixed: local board widening at a winder, and a shaped transition piece
at the newel), housing depth (flagged as conflating structural-minimum/manufacturing-depth/
visual-recess into one number), and every `stringer*Mm` config default reclassified as
`CONFIGURABLE` (never "recommended") pending an authoritative source.
`src/rules/schema.js` gained `RULE_TYPES.SOFTWARE_DESIGN_CHOICE` and a new `RULE_STATUS`
(`CONFIRMED`/`ASSUMPTION`/`CONFIGURABLE`) + `constructionType`/`affects*` optional Rule fields
(purely additive — existing rules untouched); the classifications themselves live in
[src/rules/sets/stringerConstructionAssumptions.js](src/rules/sets/stringerConstructionAssumptions.js).
Tests: [src/rules/__tests__/schema.test.js](src/rules/__tests__/schema.test.js).

## Stringer profile refactor: unfolded (u,Z) profile through every bearing (implemented)

See [docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md](docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md)
for the full investigation and math. Fixes a reported "floating winder tread" symptom, but the
diagnosis behind it turned out to be wrong in one specific, empirically-checked way: the
2-point "pitch line" (`stringerConstructionGeometry.js`, fit through only a segment's first and
last bearing) was the actual defect, **not** `stringerSolver.js`'s `COLLINEAR_EPS`-based
segmentation, which was measured to already produce a small, fixed number of straight
per-corner boards regardless of winder count — `stringerSolver.js` was not touched by this
stage. `buildPitchKnots()` now builds one knot per bearing at its own front corner (plus an
extrapolated closing knot), so intermediate winder bearings — previously up to ~250mm away
from the naive 2-point line — sit exactly on it. `src/geometry/polylineProfile.js` (new, pure,
independently tested) offsets that knot profile along its OWN LOCAL NORMAL to produce the
structural top/bottom edges — never a raw vertical (world-elevation) shift, which was only
correct for a horizontal profile and, on a uniform straight flight, also overstated the true
remaining board thickness by `1/cos(pitch angle)`. This surfaced a real, closed-form quantity
that the old code never actually computed correctly: a 'cut' board's notch "throat" thickness
(`boardWidth − riserHeight·treadGoing/√(treadGoing²+riserHeight²)`), now locked in by a
regression test. Two new ERROR-level `STRINGER-TREAD-SUPPORT` diagnostics
(`checkCutSupportFailure`/`checkClosedSupportContainment`) verify a tread is never silently
rendered without real support. `src/takeoff/materialTakeoff.js`'s stringer STOCK length was
also fixed in the same pass: it must be the pitch profile's true arc length (a raked board's
real 3D length, `profileLength()`), not the bounding box of the now-sheared offset contour nor
even the profile's own horizontal u-extent. `stringerRenderer.js` was **not** touched — it
still only extrudes whatever this file hands it.

**Follow-up (same stage): adjacent segments at a postless corner now actually meet.** A visual
check of the real running app (loaded via the dev server, compared against a hand-drawn expected
shape) found the fix above wasn't the whole story: each `StringerSegment` was still solved in
total isolation, so two segments joined by a `LAP_JOINT` (no corner post — per
`stringerSolver.js`'s own comment, the OUTER stringer's turn is **always** a lap joint, never
interrupted by a post) each fit their profile from only their own bearings — their
independently-offset bottom/top edges generally don't land on the same elevation at the shared
corner (measured: a real 54mm jump on the outer stringer of an L-winder), which is exactly what
a board "hanging in the air" at a turn looks like. `groupSegmentsByLapJoint()` now groups
lap-jointed segments (never `CORNER_POST` ones — a post genuinely doesn't need this) and solves
ONE profile across the whole group, sliced back into each segment's own local `(u,v)` via two
new primitives, `sliceOffsetProfile()`/`slicePolylineByU()`. Fixing this also surfaced two real
numerical bugs in `polylineProfile.js` itself: `lineLineIntersect`'s parallel-line test used an
*absolute* threshold on a raw cross product (now a dimensionless sin(angle), matching
`tolerances.js`'s `INTERSECTION_EPS` convention) — an absolute threshold let two segments that
were collinear only up to floating-point noise be treated as "not parallel", computing a miter
intersection thousands of mm away; and the slice helpers were reinserting a reference
polyline's own first/last point as a spurious "interior" knot whenever the slice range extended
past it, producing a non-monotonic self-crossing contour. See
[docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md](docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md)
§12 for the full account.

**Second follow-up: the notch's riser face must be a plumb vertical cut, never diagonal.** With
riser boards enabled, `effectiveBearings()` shifts every tread's own front corner forward by
`riserRecess` (room for the riser board's thickness) — so a bearing's raw back corner and the
next bearing's shifted front corner no longer share the same `u`, and `buildOverlayTop()`'s old
single straight edge between them spanned both that horizontal gap and the full riser height at
once, drawing a visibly diagonal "riser face" instead of a plumb cut. Fixed by inserting an
explicit ledge point at the current tread's own elevation across the gap, so the profile reads
as an L (a short flat ledge, then a true vertical rise) — locked in by a test asserting every
rising edge has zero horizontal travel, and confirmed against the live app's own config. See
§13 of the same doc. Tests:
[src/geometry/__tests__/polylineProfile.test.js](src/geometry/__tests__/polylineProfile.test.js),
[src/geometry/__tests__/stringerConstructionGeometry.test.js](src/geometry/__tests__/stringerConstructionGeometry.test.js).

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
above (`TreadModel[]`/`RiserModel[]`/`StringerModel`+`StringerConstructionGeometry`/
`PostModel[]`) — zero Three.js, zero cost calculation, and (unlike the takeoff's first draft)
never derives a stringer quantity from tread-bearing count. Five deliberately separate layers,
mirroring the Validator's own composition:

- **`src/takeoff/materialTakeoff.js`** (`computeMaterialTakeoff`) — QUANTITIES only, at maximum
  granularity: ONE ITEM PER PHYSICAL COMPONENT, never one item per element-type GROUP. A tread
  = one item (`TREAD` or `LANDING`), a riser = one item (`RISER` — one `RiserModel` already IS
  one physical riser even when it fans into several winder panels), a stringer SEGMENT = one
  item (`STRINGER` — a 14-tread straight flight's stringer is genuinely ONE board, hence ONE
  item; a winder's real segmentation is respected because it comes straight from
  `StringerConstructionGeometry`), a cleat/housing = one item per tread
  (`STRINGER_CLEAT`/`STRINGER_HOUSING`, only created when the geometry layer actually produced
  one — respects `config.stringerCleatsEnabled`), a post = one item (`POST`). This maximizes
  traceability: every item's `sourceElementId` is one unambiguous id
  (`tread:step-3`, `stringer:outer:outer-seg-0`, `stringer:outer:outer-seg-0:cleat-3`,
  `post:post-start`) — grouping/rollup for a human-readable report is a UI/export concern (see
  `export/toTextReport.js`), never baked into this core model.
  - **NET vs STOCK, everywhere**: `nominalDimensions`/`netVolume`/`netArea` are the actual
    finished geometry (tread outline via `pathUtils.js`'s `signedPolygonArea`, stringer contour
    via the same on `StringerConstructionGeometry.outerContour`); `calculatedDimensions`/
    `stockVolume`/`stockArea` are the rectangular raw-material blank that must be purchased —
    always ≥ NET, computed by the new `src/takeoff/stockGeometry.js` (`boundingRectAlong` for a
    tread, rotated into its own walking direction so a winder's stock size isn't inflated by an
    arbitrary global axis; `boundingRectUV` for a stringer board's length along its own local
    u-axis). A stringer board's STOCK *width* deliberately reads the design parameter
    `boardWidthMm` directly rather than the contour's own v-range, because that v-range is
    WORLD ELEVATION, not true perpendicular-to-pitch width (an inherited convention from
    `stringerConstructionGeometry.js`, documented in the item's own `notes`, not fixed here —
    fixing it is a geometry-architecture change explicitly out of scope for this stage).
  - **Housings are informational, never a separate board** (`materialId: null`, always
    unpriced) — `netVolume` reports material *removed*, not a purchase quantity.
  - **INVALID items**: if a stringer segment's own `StringerConstructionGeometry.diagnostics`
    contains an ERROR (self-intersection, etc.), that segment's `STRINGER` item gets
    `status: 'INVALID'` with every dimension/volume field `null` — never an invented number —
    and no cleat/housing items are generated off of it.
- **`src/takeoff/wasteFactors.js`** — the waste/reserve fraction per element type ("odpady" /
  "zapas materiałowy"), a MANUFACTURING_ASSUMPTION-style figure (same category as
  `src/rules/sets/manufacturingAssumptions.js`), overridable per call and optionally per
  `(elementType, materialId)` pair — never hardcoded into the solver above.
- **`src/takeoff/materialCatalog.js`** — a deliberately thin material catalog (species,
  available thicknesses/widths/lengths per `materialId`) — explicitly not stock-optimization or
  an ERP; nothing here rounds a computed STOCK size up to an available board yet.
- **`src/takeoff/pricing.js`** (`applyPricing`, `DEFAULT_PRICE_LIST`) — COST, joined onto
  quantities by **`materialId`** (not `itemId` — the same price entry prices every tread, every
  cleat, etc. made of that material) afterwards, multiplying `wasteAdjustedQuantity` (STOCK ×
  `(1 + wasteFactor)`, computed once in `takeoffTypes.js`'s `createTakeoffItem`).
  `calculatedCost`/`unitPrice` are `null` until this runs; changing a price list never touches
  quantities (proven by `pricing.test.js`), and an item whose material has no matching entry
  (or whose `materialId` is `null`, e.g. a housing) stays honestly unpriced rather than guessed.
- **`src/takeoff/validationGate.js`** (`runTakeoffValidationGate`, `GATE_STATUS`) —
  "Material Takeoff must NOT silently calculate from invalid construction geometry." Runs the
  EXISTING `StaircaseValidator.validateModels()` (never reimplemented) plus every
  `StringerConstructionGeometry` segment's own `diagnostics` (a source the Validator itself
  doesn't see yet). Any ERROR anywhere → `GATE_STATUS.BLOCKED` (the facade returns `items: []`,
  never a partial/misleading result); WARNING-only → `GATE_STATUS.WARNING` (items are still
  computed); otherwise `GATE_STATUS.OK`. Deliberately literal/simple — a documented limitation,
  not a refinement to make now, is that it does not yet distinguish "geometry-breaking" errors
  from "legal/ergonomic non-compliance" errors.
- **`src/takeoff/index.js`** — the facade: `buildMaterialTakeoff(models, options)` (quantities +
  gate) and `buildPricedMaterialTakeoff(models, options)` (+ cost), both taking the SAME full
  shape `buildStaircase.js` already returns (`fullConfig`/`derived`/`planLayout`/
  `treadModels`/`riserModels`/`stringerModels`/`stringerConstruction`/`postModels`) — no second
  geometry solve, exactly like `main.js`'s Validator wiring. Plus **`src/takeoff/export/`**:
  `toCSV.js` (fixed columns: Element/ID/Material/Quantity/Unit/Length/Width/Thickness/Net
  volume/Stock length/Stock width/Waste %/Status/Cost/Currency/Notes), `toJSON.js` (ready now),
  and `toTextReport.js` (the intended PDF export point; an INVALID/UNSUPPORTED item is reported
  as "BRAK WYLICZONEJ ILOŚCI" with its diagnostics, never a fabricated number).

**Not yet wired into the UI** — same deliberate staging as the Validator was before its own UI
stage; wiring it in later needs no new plumbing.
Tests: [src/takeoff/__tests__/materialTakeoff.test.js](src/takeoff/__tests__/materialTakeoff.test.js)
(scenarios A/B/C/D/E/G/H/I/J/K plus waste/posts/risers),
[src/takeoff/__tests__/pricing.test.js](src/takeoff/__tests__/pricing.test.js),
[src/takeoff/__tests__/export.test.js](src/takeoff/__tests__/export.test.js),
[src/takeoff/__tests__/index.test.js](src/takeoff/__tests__/index.test.js) (validation-gate
scenarios K/L).

## 3D generator traceability + Debug Mode (implemented)

The 3D generator was already architecturally forbidden from reinventing geometry (`MODEL →
SOLVER → RENDERER → THREE.JS`, enforced since the Tread/Riser/Post/Stringer split — see
above) — this stage adds two things on top of that, without touching any solver:

- **Traceability**: every rendered mesh (`treadRenderer.js`/`riserRenderer.js`/
  `stringerRenderer.js`/`postRenderer.js`) now carries `mesh.userData` built by
  [src/scene/traceability.js](src/scene/traceability.js) — `elementType`
  (`'tread'|'riser'|'stringer'|'post'`), `stepId` (e.g. `'step-7'`, `null` for posts — they
  aren't tied to one tread), `stringerId` (`'outer'|'inner'`, `null` otherwise), and a globally
  unique `geometrySourceId` (e.g. `'stringer:outer:outer-seg-2:bearing-7'`) — read straight off
  the already-solved model (`StringerTreadBearing.treadIndex`, `StringerSegment.id`, etc.),
  never invented. `stringerRenderer.js`/`riserRenderer.js` each gained an internal
  `build*MeshEntries()` that pairs geometry with this metadata; the old `build*MeshGeometries()`
  (used by existing tests) is now a thin projection over it — one implementation, not two.
  [src/scene/elementInspector.js](src/scene/elementInspector.js)'s `resolveTraceability()` is
  the reverse lookup (walks up the Object3D parent chain to find it). **Wired into the UI**:
  clicking any traceable mesh in the 3D view (`main.js`'s `renderer.domElement` click listener,
  `THREE.Raycaster` against `currentRoot` only — never the debug overlay/ceiling/grid) shows its
  raw traceability in a new `#element-inspector-panel` (`createElementInspectorPanel()`/
  `updateElementInspectorPanel()` in `src/ui/ui.js`) and, when the element has a `stepId`,
  selects that step exactly like clicking it in the 2D plan would — the concrete answer to
  "point at a 3D element, get back to its 2D source".
- **Debug Mode**: [src/scene/debugOverlay.js](src/scene/debugOverlay.js)'s `buildDebugOverlay()`
  is a pure visualization layer (own `THREE.Group`, toggled via `viewState.showDebug` — "Debug
  mode" in the Widok 3D folder) showing, all read directly off already-solved models: stringer
  **reference lines** (outer/inner, at floor level), tread **construction points** (every
  final `frontEdge`/`backEdge` corner), **intersections** (turn corners + stringer segment
  joints), **normals** (each tread's own walking direction, as an arrow), and **bearing
  positions** (`StringerTreadBearing`'s `[finalUStart, finalUEnd]` projected onto its segment,
  at its own `bearingElevation`). It never computes new geometry — every point/line/arrow is a
  model value already computed by a solver, merely drawn.

Tests: [src/geometry/__tests__/traceability.test.js](src/geometry/__tests__/traceability.test.js),
[src/scene/__tests__/elementInspector.test.js](src/scene/__tests__/elementInspector.test.js),
[src/scene/__tests__/debugOverlay.test.js](src/scene/__tests__/debugOverlay.test.js).

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
