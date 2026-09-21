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
(`cut`, "wanga nakładana" — the tread rests on the notch alone; the former separate support-block
"cleats" were **removed**, see below), or a plain-rectangle contour (`closed`,
"wanga wpuszczana") with separate `housings[]` recessed into the inner face — never the old
per-bearing rectangle stack whose bottom edge sawtoothed along with the top. Diagnostics
(`STRINGER-MIN-SECTION`, `STRINGER-CONTOUR-SELF-INTERSECTION`) are computed by this layer and
surface in the Walidacja tab since stage 10 (via the takeoff validation gate — see "Workspace UI"). `stringerRenderer.js` now takes both `StringerModel` and this construction geometry
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

**Cleats ("klocki") removed.** The support blocks a `cut` string used to carry
(`config.stringerCleatThicknessMm`/`stringerCleatHeightMm`/`stringerCleatsEnabled`, `cleats[]` on
`StringerSegmentConstructionGeometry`, their meshes, `STRINGER_CLEAT` takeoff items, the two UI
sliders and the two `STAIR3D-STRINGER-CLEAT*` catalogue rules) were dropped at the user's request: they
were never a required part of the construction, weren't visibly effective in the model and were not
priced. A `cut` stringer is now just the notched board. Old project files that still carry the
removed config keys load fine (the keys are ignored). The historical sections/docs above and in
`docs/` that talk about cleats describe the earlier design.

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
§13 of the same doc.

**Third follow-up: a partial bearing at a lap joint was counted twice, spiking the board's
ends.** `stringerSolver.js` genuinely splits one tread's support across two boards when its raw
chain straddles a real corner (a `partial` bearing — one copy per segment, only one of which
`ownsStart`). The group-level pitch-knot builder counted BOTH copies as independent front
knots, inserting a spurious knot at the tread's own unchanged elevation right next to its real
one — an artificial near-zero-width flat plateau that made the immediately following slope
unrealistically steep, which the closing-knot extrapolation then amplified into a long, sharply
pointed spike at the very ends of the board (reported: projecting past the ceiling/floor).
Fixed by skipping any bearing where `!b.ownsStart` when building front knots — zero effect on
ordinary bearings, which always own their start. See §14 of the same doc.

**Fourth follow-up: a CORNER_POST-separated segment's own boundary overshot its neighbour.**
At a `CORNER_POST` joint each side is deliberately solved independently (a post absorbs the
difference — exact continuity isn't required, unlike a `LAP_JOINT`). When a segment's first
few treads are much narrower than the rest (the inner "dusza" side of a winder: measured 110mm
vs. 270mm treads), its local pitch slope near the start is far steeper than its overall pitch —
reaching that segment's own boundary requires extrapolating the steep slope backward, then
extrapolating its already-offset bottom line backward AGAIN (offsetting a steep segment shifts
its own u-domain further, requiring an even larger correction), compounding into a boundary far
below where it belongs (reported: one board's end visibly stretched/drooping past where the
post-jointed neighbour's own end already sits). `clampCrossSegmentOvershoot()` now clamps each
segment's own boundary so it never crosses past the immediately preceding segment's own
corresponding boundary — a sanity bound, not a continuity requirement, so a `LAP_JOINT` pair
(already exactly continuous) is untouched. See §15 of the same doc.

**Superseded (start of a post-jointed board):** the lower contour is no longer clamped up to the
previous board's bottom end. That clamp turned the start of a steep board (the narrow "dusza" treads
after a winder post) into a beak — the first edge left its own straight line and the local depth there
fell below the minimum (reported with a screenshot of `inner-seg-1`). The lower edge now runs straight
to the start face, lower than the neighbour's end if it must (the post covers it); only the upper edge of a
housed board is still clamped flush to the neighbour's top end.

**Fifth follow-up: the very first segment's own bottom extended below the floor.** Unlike a
joint, the very first segment of a run has no preceding segment to clamp against — reaching its
own start boundary extrapolates its local pitch slope backward past the first real bearing,
then offsets the result down by the full board width; near the bottom of a flight, the first
tread's own elevation (one riser height) is often smaller than the board's own width, so the
result naturally lands below the floor (measured: `v = -238.7`). Simply snapping that point's
elevation up to 0 in place was tried and rejected — it left the point's plan position
unchanged, swinging the bottom edge across the top edge's own notch pattern and introducing a
genuine self-intersection. `trimToFloor()` instead finds where the boundary's own first segment
actually crosses `v=0` by interpolating along its real direction — a true "cut flush with the
floor," not a vertical snap — applied only to the very first segment of a run
(`clampFirstSegmentToFloor()`); later, already-elevated segments are untouched. See §16 of the
same doc. Tests:
[src/geometry/__tests__/polylineProfile.test.js](src/geometry/__tests__/polylineProfile.test.js),
[src/geometry/__tests__/stringerConstructionGeometry.test.js](src/geometry/__tests__/stringerConstructionGeometry.test.js).

## Stringer profile model (implemented, Tier 1)

See [docs/architecture/STRINGER_PROFILE_MODEL.md](docs/architecture/STRINGER_PROFILE_MODEL.md) for
the design study and what was built. The board's **elevation profile** (its shape in the unfolded
`(u,v)` side view) is now a first-class model, separate from the plan path (which stays straight —
RULES #5 — and is never touched by any profile parameter or override).

- **`src/geometry/profileCurve.js`** — curve primitives: lines and true arcs, `filletPolyline`
  (tangent arcs with feasibility scaling), `sliceCurveByU`, `curveToPolyline` (arcs -> chords, only
  at the mesh/export edge), `mergeCollinearLines`, and the **exact** curve-to-curve
  `curveDistance`.
- **`stringerProfileModel.js`** — vocabulary (`PROFILE_MODES`, `RADIUS_SCOPES`,
  `TRANSITION_STYLES`), `profileParamsFromConfig`, the manual-override layer
  (`sanitizeStringerProfileOverrides`, `setVertexOverride`, `applyProfileEdit` + `PROFILE_EDITS`
  events), stable anchor ids (`support:step-N`, `end:top`).
- **`stringerProfileSolver.js`** — pure `solveStringerProfile()`: reference knots -> nominal control
  polygon (offset by the nominal depth) -> overrides -> radii (feasible, then depth-clamped in AUTO)
  -> lines + arcs. **Local stringer depth** = the exact minimum distance between the reference
  curve and the lower contour (NOT the vertical Z difference, NOT a bounding box).
- **`stringerProfileView.js`** — `buildProfileViewModel()`: plain data for a future side-view editor
  (treads, contours, minimum-depth envelope, depth samples, control points); the editor itself is not
  built.
- **`stringerConstructionGeometry.js`** is now the adapter: it decides the reference (bearings,
  lap-joint grouping, riser recess), calls the solver once per group, slices per board, builds the
  comb/housings/diagnostics. Its output gained `lowerCurve`/`upperCurve` (lines + arcs),
  `lowerControl`/`upperControl`, `localDepthMm`/`requiredDepthMm`; `outerContour` and the
  polylines are unchanged in meaning.
- **Config**: `minimumStringerDepthMm` (350; formerly `stringerHeight` — the minimum local depth AND
  the nominal offset; not the board thickness), `stringerProfileOffsetMm`, `stringerCornerRadiusMm`,
  `stringerRadiusScope`, `stringerTransitionStyle`, `stringerNotchRadiusMm` (cut inside corners),
  `manualStringerProfileOverrides`. Defaults keep straight lines. **Project file schema v3**
  (migration v2->v3 renames `stringerHeight`; `stringerProfileOverrides` is a top-level field).
- **Board ends**: every end is a plumb (vertical) face; the first board's foot is cut horizontally along the
  floor line (`ends.start.cut = 'FLOOR_HORIZONTAL'`), with a vertical start face. Both contours are cut at the
  same planes, so a postless lap joint no longer has a slanted end. See STRINGER_PROFILE_MODEL.md §11a.
- **Takeoff blank**: a stringer's STOCK is now the smallest rectangle covering the whole solved contour
  (`stockGeometry.js` `minAreaRectUV`) — the real board to buy/price — not the design depth. Straight
  flights stay at the design depth; winder boards come out deeper. `totalCost` is rounded to grosze.
- **Diagnostics**: `STRINGER-MIN-DEPTH` (ERROR), `STRINGER-FILLET-CLAMPED` (INFO),
  `STRINGER-OVERRIDE-ORPHANED`/`-REJECTED` (WARNING). An explicit override radius or moved point that
  breaks the minimum depth is KEPT and reported, not silently corrected.
- **Not done (next stages)**: deriving a *blank depth* from the profile for the takeoff/pricing (the
  takeoff still reads the nominal depth), a side-view editor UI, multi-arc/spline transitions, riser
  housings, curved plan paths, CNC.
- Tests: `geometry/__tests__/profileCurve.test.js`, `stringerProfile.test.js` (a 216-case grid of
  geometry x inclination x minimum depth x radius x construction type).

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

## Project file format v2 (implemented; now v3 — see "Stringer profile model")

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

## Per-tread edge overhang + drag snapping (implemented)

A second, deliberately separate manual-edit mechanism from the shared-corner
`config.manualEdgeOverrides` above: `config.manualTreadOverhangs` (`src/config/schema.js`) lets
one tread's own outer or inner edge be shifted sideways (e.g. "let this tread stick out 30mm
past the wanga") **without moving its neighbor's corner**, even though the two treads start
from an identical shared point. Keyed by tread index, value `{ side: 'inner'|'outer',
offsetMm }` (positive = away from the dusza/overhanging, negative = recessed).

- **`src/geometry/edgeOverrides.js`**'s `applyTreadOverhangs(treads, overhangs)` is the new
  geometric primitive, reusing the existing `retargetPoint()` helper but scoped to a SINGLE
  tread's `outline`/`frontEdge`/`backEdge` (never a neighbor) — `shiftEdgeCorner()` moves one
  edge's own corner along that edge's own hinge→corner direction by `offsetMm`. It deliberately
  never touches `innerChain`/`outerChain` (the only fields `stringerSolver.js` reads), so the
  wanga's reference line is provably unaffected and a tread can genuinely overhang past it with
  no stringer-side logic needed — locked in by a test comparing
  `StringerModel.segments[0].referenceLine` before/after (`deepEqual`). A resulting
  self-inverting/degenerate tread shape is rejected (reverted, `console.warn`), same pattern as
  `applyManualEdgeOverrides`. Wired into `buildPlanLayout()` right after
  `applyManualEdgeOverrides`; the two mechanisms compose without interfering (tested). Because
  it only edits the fields `TreadModel`'s nominal/final split already tracks, riser boards
  correctly follow an overhung edge with no additional code (same nominal/final machinery as
  `manualEdgeOverrides`). Tests:
  [src/geometry/__tests__/edgeOverrides.test.js](src/geometry/__tests__/edgeOverrides.test.js).
- **Input**: a new draggable diamond handle per side (`.overhang-handle` in
  `plan2dRenderer.js`'s `overhangHandlesXML()`, rendered only for the currently-selected tread),
  colored like the existing edge handles (orange once manually set, teal otherwise). Its
  drag has exactly one degree of freedom — distance along the edge's own inner↔outer axis —
  computed in `planInteractions.js` via a dot-product projection of the pointer position onto a
  `{anchor, dir}` pair the renderer derives from the tread's CURRENT (possibly already-offset)
  corners, algebraically recovering the pre-offset anchor. `main.js` wires
  `onOverhangDragMove`/`onOverhangDragEnd` (write `config.manualTreadOverhangs[treadIndex]`,
  live-preview `rebuild()` vs. committed `rebuild()+commitHistory()` — same pattern as edge
  drag) and `onOverhangContextMenu` (right-click deletes that tread's entry). Config reset
  clears both `manualEdgeOverrides` and `manualTreadOverhangs` together.
- **Snapping**: dragging either an edge handle or an overhang handle now also snaps to
  alignment with any other boundary point on the plan (`planInteractions.js`'s
  `snapToAlignment()`/`snapPoint()`, `ALIGN_TOLERANCE_MM = 60`), independently per axis, falling
  back to the existing grid snap (`snapMm`) on whichever axis didn't align — so two corners can
  be matched exactly without eyeballing it. `main.js` supplies `getSnapPoints()`, returning
  every tread's `frontEdge`/`backEdge` inner+outer points; the dragged point itself is filtered
  out by `planInteractions.js`, not by the supplier. No visual "smart guide" line is drawn yet
  showing why a point snapped — the snapping itself works, but that visual feedback is a
  separate, not-yet-requested follow-up.

## Workspace UI (stage 10, implemented)

The UI is a coherent workspace **around** the unchanged engine (`PARAMETRIC MODEL → 2D GEOMETRY →
TREAD/RISER/STRINGER/POST MODELS → VALIDATION → MATERIAL TAKEOFF → 3D`). It only consumes solved
models: UI → `config` change → `rebuild()` → models → (2D SVG | 3D renderer | validation | takeoff).
No panel or interaction computes geometry.

- **Layout** (`src/ui/workspace.js`, CSS grid in `style.css`): `#toolbar` (project name/notes,
  New/Save/Load, Undo/Redo, **Plan 2D | Widok 3D** tab switch, client mode) · `#sidebar-left`
  (`#info-panel` + the lil-gui parameter panel mounted via `new GUI({container})`) · `#main-view`
  (`#viewport` 3D and `#plan2d-panel` 2D — one visible at a time, 2D is the default) ·
  `#sidebar-right` with three tabs **Inspektor / Walidacja / Kosztorys** (badges show error count /
  estimated cost) · `#statusbar` (validity, manual-edit count, selection, scale/camera). Below
  ~1180px the sidebars narrow; below ~860px the grid becomes a single scrolling column.
- **One shared selection** (`main.js` `setSelection()`, shape from `src/ui/selection.js`; pure
  parsers `stepIndexFromElementId`/`selectionFromTakeoffSourceId`): a click in the 2D plan (step,
  `.stringer-path[data-side]`, `.post-marker[data-post-id]`), a 3D click (via
  `mesh.userData.geometrySourceId` — explicit model IDs, never geometry reverse-engineering), a
  diagnostic in Walidacja, or a row in Kosztorys all set the same selection, which then updates the
  2D highlight, the 3D highlight (`src/scene/selectionHighlight.js`: per-mesh material clone with
  emission, restored on clear; exports run without it), the Inspektor and the status bar.
  Selection is view state: never in history or the project file. Diagnostics carry only
  `elementType`/`elementId` (no `geometrySourceId`), so only `step-N`, stringer sides and known
  post IDs can be highlighted; stair-wide diagnostics are only marked in the list.
- **Value states** (`src/ui/valueState.js`): `AUTO` / `USER` (locked field) / `RĘCZNA` (manual
  geometry edit, from `TreadModel.overridden` + `config.manualTreadOverhangs`) / `UWAGA` /
  `BŁĄD` / `INFO` badges in the parameter rows, info panel and Inspektor.
- **Inspektor** (`inspectorPanel.js`): project summary when nothing is selected; for a step:
  elevation, widths, front/back edge coordinates with AUTO/RĘCZNA + displacement from nominal,
  overhang, that step's diagnostics, source ID; also stringer segments and posts.
- **Walidacja** (`ui.js`): findings grouped ERROR/WARNING/INFO with element, rule ID,
  measured/expected, message; click → selection. Its data comes from the **takeoff validation
  gate** (`buildPricedMaterialTakeoff(...).diagnostics` = `StaircaseValidator` + stringer
  construction diagnostics), so Walidacja and Kosztorys can never disagree and validation runs once.
- **Validation waivers ("Dodaj wyjątek")** (`src/diagnostics/waivers.js`, pure): the user can
  consciously accept one ERROR/WARNING, which then stops blocking the takeoff gate. A waiver is a
  `(ruleId, elementId)` pair — accepting "rule X on step 5" never silences X elsewhere. It is
  passed to the facade as `options.waivers`; `runTakeoffValidationGate`/`buildMaterialTakeoff` return
  `diagnostics` (everything — nothing is ever hidden), `activeDiagnostics`, `waivedDiagnostics` and
  `staleWaivers` (waivers matching nothing any more), and `status`/`errors`/`warnings` count active
  findings only. A waiver **never changes a quantity or fabricates a number**: a construction-level
  ERROR still marks its own stringer item `INVALID` ("BRAK WYLICZONEJ ILOŚCI"), and the Kosztorys
  banner, cost summary and TXT report title all say the takeoff was computed despite waived
  findings. Waivers are project decisions, so they are saved as an optional top-level `waivers` field
  in the project file (outside `config`, outside undo history, cleared by "Nowy"). Tests:
  `takeoff/__tests__/waivers.test.js`.
- **Board price list ("cennik desek")** (`src/takeoff/boardPricing.js`, ported from the DREWEX
  WordPress calculator `Kalkulator_DREWEX/staircost-calculator/includes/class-calculator.php`
  `board_price_for_depth`): treads, landings and (optionally) wooden risers are priced from a
  table of **PLN per running metre** — row chosen by the blank's DEPTH range (lower-inclusive,
  upper-exclusive, else nearest range), column by its LENGTH (≤1500 / 1501–2000 / >2000 mm), the
  thickness class 20/40/60 (material 10–20 / 21–40 / 41–65 mm), base = oak "Klasa Natura" 100%,
  other species/class = percentage multiplier; cost = price/mb × length[m]. A depth beyond the
  largest range is glued from several boards (sum of FULL per-mb prices; a remainder below the
  smallest range is priced like the top range, as in DREWEX). The blank is the takeoff's STOCK
  bounding rectangle (board length = its longer side, depth = shorter side; our tread outline
  already includes the nosing = DREWEX "formatka = beton + nosek"). **Waste is already inside the
  table price**, so board-priced items get `wasteFactor: 0` — never double-counted. An item that
  can't be priced (thickness > 65 mm, empty table) stays unpriced with an explanatory note rather
  than being guessed. Items carry `pricingSource: 'board-table'` + `priceBreakdown`, so
  `applyPricing()` (generic per-m³/m² list, still used for stringers/posts/cleats/MDF risers) skips
  them. Opt-in via `buildPricedMaterialTakeoff(..., {boardPricing})`; without it behaviour is the
  old generic pricing. The table is edited in the Kosztorys tab's "Cennik i materiały"
  (`ui/pricingEditor.js`), imported/exported as CSV in the exact DREWEX format
  (`cennik-stopni-*.csv`: `grubość_mm;głębokość_od_mm;głębokość_do_mm;cena_do_1500mb;…`), and saved
  in the project file under `takeoffSettings.boardPricing`. **The defaults are the plugin's
  code defaults, not necessarily the real production prices** (those live in the WordPress DB) —
  import the real price list via CSV. **Scope decision: the cost is MATERIAL only** — treads,
  winder treads, landings, risers (if any), load-bearing stringers and posts; no assembly, finishes,
  extra services, balustrades, VAT/margin, cleats or housings (those get `pricingSource:
  'excluded'`, no cost, and are left out of the summary sums). **Stringer** = a normal board from
  the same table (thickness class × board width from the stringer parameter, e.g. 40×330 × its true
  length, e.g. 2660) **+ a surcharge (default +20%, `stringerSurchargePct`)**. **Winder tread** =
  its PRODUCTION BLANK: `TreadModel.winderBlank` (from `winderBlank.js` `computeWinderBlank(tread, nosing)`, the very same
  numbers the 2D plan and 3D labels show) is now also the takeoff STOCK for winders, replacing the
  old bounding rectangle. **The blank includes the nosing** (`config.nosing`): the front edge lies on
  the outline's extreme, so depth grows by exactly the nosing while length is unchanged. **Post** = a separate table `postPrices` (smallest section
  >= the post's, per piece or per running metre; defaults: DREWEX's "Drewniany 80×80/100×100"
  per-piece prices plus 110×110 = 200 zł/mb; a larger post stays unpriced until a row is added).
  **Manual items** (`takeoff/manualItems.js`, `ui/manualItemsEditor.js`): balusters (qty × PLN/pc),
  handrails (m × PLN/m) and any other rows the user types in — user INPUT, not derived — are turned
  into `OTHER` items with `pricingSource: 'manual'`, added to the items/total by
  `applyManualItems()` (not when the takeoff is BLOCKED) and saved in
  `takeoffSettings.manualItems`. **The cost summary is per category** (`summarizeByCategory()`:
  Stopnie / Stopnie zabiegowe / Podesty / Podstopnie / Wangi / Słupy, then the manual rows; excluded
  items are left out; an unpriced item is counted and flagged, never silently added). Priced items get
  `catalogStock: null` (the illustrative C24 catalog does not apply). Tests:
  `takeoff/__tests__/boardPricing.test.js`.
- **Kosztorys** (`takeoffPanel.js` + pure `takeoffView.js` grouping/summing): NET (finished
  element) and STOCK/ORDER (raw + catalog size) shown side by side, group by element/material/
  construction, cost summary with explicit assumptions (illustrative prices, waste, no labour)
  and "≈" — never presented as exact; BLOCKED gate shows why instead of numbers; CSV/TXT export
  via the existing `takeoff/export/`. **Prices and waste factors are NOT `config`**: separate
  `takeoffSettings` state (edited in the "Materiały i ceny" folder), outside model history, saved in
  the project file as an optional top-level field.
- **2D** additions: selectable stringers/posts (`onStringerClick`/`onPostClick` in
  `planInteractions.js`), dimension layers `winderWidth` (width of each winder tread at the fixed
  `WINDER_WIDTH_MEASURE_OFFSET_MM` line — now the single source of truth shared with
  `validation/facts.js`) and `stringerSpacing` (stringer spacing + min. remaining section), both read
  from model data. **Fixed in this stage:** handle drags recomputed pointer→plan coordinates with the
  `<svg>` captured at pointerdown, which is detached after the first live redraw (its screen matrix
  is meaningless), so edge/overhang drags jumped to garbage offsets — `liveSvg()` now always uses the
  current `<svg>`. Also fixed: an intentional overhang (`TreadModel.overhang`) was reported as
  `CONSTRAINT-TOPOLOGY-CONTINUITY`/`VALIDATOR-WALKLINE-CONTINUITY` ERRORs (blocking the takeoff); those
  checks now skip the overhung side while a genuinely broken shared edge is still reported.
- **3D view**: `#viewport-hud` (layer toggles by group name Treads/RiserBoards/StringerOuter/
  StringerInner/Posts + ceiling, standard views Przód/Tył/Lewy/Prawy/Góra/Izo, perspective ↔
  orthographic in `sceneSetup.js` `setCameraMode`/`frameView`/`computeStandardView` — camera math
  only). Debug mode also marks ERROR/WARNING diagnostics pinned to a step (`DebugViolations`, only
  created when diagnostics are passed).
- **Client mode** (`viewState.clientMode`, toolbar "Prezentacja"): hides toolbar/sidebars/status and
  all technical overlays (grid, axes, dimension labels, debug, selection highlight), shows a ground
  plane, hides the ceiling (restored on exit), background colour picker. `config` untouched.
- **Project** (`projectIO.js`): optional top-level `projectName`, `notes`, `takeoffSettings` next to
  `config`/`edgeOverrides` (never inside `config`); `parseProjectFile()` returns `{config, meta}`
  (`parseProjectJSON` unchanged); schema version stays 2 — older files load with empty metadata.
- **Tests**: `ui/__tests__/selection.test.js`, `takeoffView.test.js`,
  `scene/__tests__/selectionHighlight.test.js`, project metadata tests in `projectIO.test.js`,
  overhang-validation tests in `geometry/__tests__/edgeOverrides.test.js`. DOM-bound behaviour was
  verified in the browser (2D edit/undo/redo, 2D↔3D selection, validation/takeoff panels, save/load
  round trip, OBJ/DAE export, client mode, ortho/standard views/layer toggles, narrow window).
- **Known limitations**: no split 2D+3D view (tabs by design); no minimum-depth envelope / support
  zone debug overlays; client mode has no material presets (realistic wood is not modelled);
  diagnostics without a step/stringer/post ID can't be highlighted; the plan is not auto-refit on
  window resize; SketchUp workflow beyond the existing OBJ/DAE export is not addressed.

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
`#validator-panel` in `style.css` — since stage 10 the "Walidacja" tab of the workspace's right
sidebar (previously a floating bottom-right panel), visible next to whichever of the 2D plan or 3D
view is shown. It lists every finding (ERROR/WARNING/INFO, sorted by
severity, each showing its step, message, and value/expected when present), a live
ERROR/WARNING/INFO count in the header, and a collapse toggle. `ui.js` only renders what it's
given — no validation logic lives there.

## Material Takeoff Layer (implemented; wired into the UI — see "Workspace UI (stage 10)")

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
  `StringerConstructionGeometry`), a housing = one item per tread
  (`STRINGER_HOUSING`, only created when the geometry layer actually produced one), a post = one item (`POST`). This maximizes
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
  an ERP. `roundUpToCatalogSize(requiredMm, availableSizesMm)` finds the smallest catalog size
  that is still `>=` a computed requirement — one dimension of one linear member at a time,
  never board-nesting/cutting-plan generation, which stays explicitly out of scope. Found by an
  end-to-end audit (a salesperson would otherwise have to look up real board sizes by hand):
  `materialTakeoff.js` now attaches a `catalogStock: {lengthMm, widthMm, thicknessMm, exact,
  unsupported}` to every STRINGER and POST item (not cleats — cut from scrap/offcuts, never
  bought to a catalog length; not risers/housings — sheet goods nested across a sheet, or not a
  purchasable item at all). `unsupported: true` (with an explanatory note, e.g. "wymaga
  łączenia/sklejania") when even the largest catalog size can't cover a dimension — e.g. the
  illustrative catalog's 350mm max board width can't cover a 450mm-deep stringer, and its 60mm
  max sawn-board thickness can't cover a typical ~110mm square post section (a genuine catalog
  gap: posts need their own stock entry) — surfaced honestly, never rounded to a number that
  doesn't exist. Exposed in both `export/toCSV.js` (Order length/width/thickness/gap columns)
  and `export/toTextReport.js` ("Zamówienie (katalog): ..."). Tests:
  [src/takeoff/__tests__/materialCatalog.test.js](src/takeoff/__tests__/materialCatalog.test.js).
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

**Wired into the UI in stage 10** (the "Kosztorys" tab — see the Workspace section below); the
facade needed no new plumbing, exactly as staged.
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
