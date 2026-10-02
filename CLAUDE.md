# stair3d

A parametric staircase designer for a timber-stair workshop (Polish UI): plan 2D + 3D, validation against Polish
regulations, structural pre-check, material takeoff and pricing, client offer (PDF), 1:1 DXF production drawings.

This file describes the CURRENT state. How it got here — every stage, bug, user decision, measured number and
superseded approach — is in [docs/HISTORY.md](docs/HISTORY.md) (the former CLAUDE.md, verbatim). Read the relevant
part of it before changing an area with a long history (stringer profile, winders, joints).

## Read first

- [.claude/RULES.md](.claude/RULES.md) — mandatory architecture and geometry rules (model → solver → renderer, pure
  solvers, no mesh patching, one place per geometric rule, regression test per geometry bug, schema versions).
- [docs/rules/TECHNICAL_RULES_CATALOGUE.md](docs/rules/TECHNICAL_RULES_CATALOGUE.md) + [src/rules/README.md](src/rules/README.md)
  — the knowledge base (legal / industry / manufacturing / software-choice rules with sources and status). Every
  number in a rule, check or default must be traceable to it or marked `DO WERYFIKACJI` / `ASSUMPTION`.
- [docs/rules/PROFILES.md](docs/rules/PROFILES.md) — design profiles (`config.designProfileId`, four rule layers).
- [docs/model/STAIRCASE_DATA_MODEL.md](docs/model/STAIRCASE_DATA_MODEL.md) — coordinate system, `frontEdge`/`backEdge`,
  the `Nominal → Override → Final` edge model, object model, JSON schemas. Consult before touching `config/schema.js`,
  `planLayout.js` or any solver.
- [docs/architecture/](docs/architecture/) — one document per area (listed in each section below).
  [CONSOLIDATION.md](docs/architecture/CONSOLIDATION.md) explains which duplicates were merged and which were kept apart on
  purpose; [STAIR_SOFTWARE_BENCHMARK.md](docs/architecture/STAIR_SOFTWARE_BENCHMARK.md) compares professional software.

## Working on this project

- Tests: `npm test` (= `node --test --test-concurrency=2 "src/**/*.test.js"`; full concurrency runs out of memory on
  the dev machine). Build: `npx vite build`. Dev server: `.claude/launch.json` "schody3d-dev",
  http://localhost:5173/stair3d/.
- Every geometry/behaviour fix gets a regression test that is **confirmed to fail on the old code**.
- After a change: tests + build, a browser check when the change is visible, then update this file (current state)
  and the matching `docs/architecture/*.md`; append nothing historical here — history goes to docs/HISTORY.md only if
  it is worth keeping.
- No new dependencies. Commit/push only after the user agrees. The user is Polish: answers in Polish; code comments
  and docs in English (older comments are partly Polish).

## Pipeline and layers

`config` (+ override layers) → `geometry/planLayout.js` (2D plan) → solvers (`treadSolver`, `riserSolver`,
`stringerSolver` → `stringerConstructionGeometry` → `stringerProfileSolver`, `postSolver`, `railingSolver`,
`jointSolver`, `cantileverModel`) → plain-data models → renderers (`*Renderer.js`, Three.js) / plan 2D SVG / validation /
structural check / takeoff / DXF / offer.

- `geometry/buildStaircase.js` is the only orchestrator: it applies the stairwell fit, builds every model once and
  returns them all (`fullConfig`, `derived`, `planLayout`, `treadModels`, `riserModels`, `stringerModels`,
  `stringerConstruction`, `postModels`/`allPostModels`, `railingModel`, `joints`, `cantilever`, `ceilingFit`,
  `stairwellFit`, …). Every consumer reads those — no second geometry solve anywhere.
- No `*Solver.js`/`*Model.js` imports `three`; no renderer calls `buildPlanLayout` or decides geometry (enforced by
  `geometry/__tests__/consolidationInvariants.test.js`).
- `main.js` `rebuild()`: config → `buildStaircase` → validation + structural report + takeoff (one gate) → panels.
  UI writes only `config` (or the separate presentation/takeoff/offer state), then calls `rebuild()`.

## Conventions

- **Plan frame**: mm, flight starts at the origin; L/U are built in a native right-turn frame and mirrored for a left
  turn (`planLayout.handedness` ±1; `inwardNormal(direction, side, handedness)` is THE "into the stair" direction).
  `rotate90CW` is the one transverse-direction definition.
- **Edges**: boundary i = front edge of tread i (0 = first front edge, N = last back edge), `[inner, outer]`.
  `frontEdge` = czoło (first contact walking up), `backEdge` = shared with the next tread (legacy `rearRiser`/
  `frontRiser` names are banned by a static test). `innerChain`/`outerChain` are the RAW stringer lines — never moved
  by any edit; stringers read only them.
- **Nominal/final**: `TreadModel.frontEdge = {nominal, final, overridden}`; the automatic housing recess counts as
  nominal (an unedited tread never reads "RĘCZNA").
- **Tolerances** (`geometry/tolerances.js`): `GEOMETRY_EPS` (mm), `COLLINEAR_EPS` (mm²), `INTERSECTION_EPS`
  (dimensionless). Primitives: `pathUtils.js` (`pointsEqual`, `normalizeVector`, `signedPolygonArea`, `crossZ`,
  `segmentsProperlyIntersect`, cumulative distances), `polygonClip.js` (`clipToConvex`, `subtractConvex`,
  `pointInPolygon`, `cleanPolygon`), `rectUnion.js`, `nosingUtils.js` (two deliberately different outward normals),
  `util/format.js` (`escapeHtml`, `round2` — the one copy).
- **Diagnostics**: `diagnostics/diagnostic.js` — `{ruleId, severity ERROR|WARNING|INFO, elementType, elementId,
  parameter, value, expected, unit, message}`; Polish messages, structured data, no UI strings elsewhere.
- **A manual edit is kept and reported, never silently corrected** (profile points, radii, edges, posts). Severity of
  a finding caused by a hand edit is WARNING where an AUTO result would be an ERROR (user decision).

## Plan layout, winders, walkline — `geometry/planLayout.js`, `winderArc.js`

Docs: [WINDER_ARC_LAYOUT.md](docs/architecture/WINDER_ARC_LAYOUT.md).
- Types `straight` / `L` / `U`; turns `winder` or `landing`; U with two landings can be one big landing
  (`mergeLandings`). Flight counts `treadsLegA/B/C` (A may be 0 for L/U: the flight starts with winders).
- **Winders are laid out from the walkline** (every project; user decision 2026-10-02): the walkline is a straight,
  a quarter arc of radius `walklineOffset` round the inner corner, a straight; the zone is `windersPerTurn` equal
  goings ON it, `walklineSplitOffset` of it before the arc's middle (clamped so the arc fits). Each edge runs through
  its walkline point and its dusza point; dusza ends spread evenly → every winder has the same dusza width. A flight
  starting/ending with winders starts/ends the zone at the corner (one post there). If the arc does not fit at the
  configured offset, the turn uses the largest offset that fits (`fittingWalklineOffset`, `turns[].walklineOffsetMm`,
  WARNING `WINDER-WALKLINE-MOVED`). `buildTurnLocalProportional` (old method) only serves invalid input.
- `planLayout.walkline = {path, points}` — the drawn walkline (arc as chords) and one point per edge (edit pivots).
- Override layers applied in `buildPlanLayout` (in this order): `manualEdgeOverrides` (`{[boundary]: {inner?, outer?}}`,
  older `{movedEndpoint, point}` still read — `edgeOverrides.js edgeOverrideEndpoints`), the automatic housing recess
  (`applyHousingRecess`: a tread ends t − d from a housed wanga's chain line, on a line parallel to it —
  `recessTreadToWangi`), `manualTreadOverhangs` (one tread's own side, `{side, offsetMm}`).
- **Stairwell fit** (`stairwellFit.js`, "Dopasuj do klatki"): derives going + straight counts from side lengths of the
  outer line (key side exact, others as close as counts allow; 2h+s only breaks ties — `STAIR3D-FIT-01`); `rebuild()`
  copies the result back into config; driven fields show AUTO.
- **Ceiling opening** (`ceilingOpening.js`): rectangle (sliders) or drawn polygon (`openingShape`, `openingPolygon`
  relative to `planLayout.bounds` min corner); `deriveCeilingFit` → collisions/headroom; "Dosuń otwór" alignment.

## Treads, risers, posts

- `treadSolver.js` `TreadModel`: elevation, direction, widths, nominal/final edges, nosed `outline`, `winderInfo`
  (passthrough), `winderBlank` (`winderBlank.js` — the production blank incl. nosing, used by plan/3D labels/takeoff),
  `notch` (underside groove for the riser overlap: `strip`, `undersides` so the nosing keeps full thickness, `outline`
  for the DXF). Nosing slides front corners along the tread's FINAL sides (`nosingUtils.sideDirection`).
- `riserSolver.js` `RiserModel`: panels built from the FINAL front edge (winder fan of `WINDER_RISER_FAN_PANELS`,
  ends exactly the edge points), `directionSpreadDeg`, `riserTopOverlapMm` into the tread above; with risers the stair
  ends with a top riser under the "fajkowy" nosing tread (`riser-top`, `topNosingThicknessMm`, DO WERYFIKACJI).
- `postSolver.js` `PostModel`: structural posts on the inner wanga's AXIS (start/end newels, one corner post per turn,
  de-duplicated); a start/end newel overlapping a corner post is not placed; per-post edits `manualPostOverrides`
  (`removed`, `topDeltaMm`, `bottomDeltaMm`; removing a corner post turns that inner joint into a lap joint);
  balustrade posts are PostModels with `kind: 'railing'` and their own `sizeMm`. `buildAllPostModels` includes removed
  ones (ghosts in the plan).

## Stringers (wangi)

Docs: [STRINGER_CONSTRUCTION_MODEL.md](docs/architecture/STRINGER_CONSTRUCTION_MODEL.md),
[STRINGER_PROFILE_MODEL.md](docs/architecture/STRINGER_PROFILE_MODEL.md),
[STRINGER_ARC_LENGTH_PROFILE.md](docs/architecture/STRINGER_ARC_LENGTH_PROFILE.md),
[docs/STRINGER_CONSTRUCTION_SPEC.md](docs/STRINGER_CONSTRUCTION_SPEC.md).
- **Analytical model** (`stringerModel.js` + `stringerSolver.js`, the only stringer geometry): straight segments split
  at real corners of the raw chain; one bearing per tread (`finalUStart/End` from FINAL edges, `ownsStart`, `partial`
  at a lap joint, `riserRecess` = riser thickness); joints `CORNER_POST` / `LAP_JOINT`; inner boards carry
  `startPost`/`endPost` (face positions); a board wholly between post faces is not made. Construction type PER SIDE:
  `stringerConstructionTypeOuter/Inner` = `closed` (wpuszczana, housed) | `cut` (nakładana, the tread rests on the
  notch; no cleats). `housingDepthMm(config)` (`stringerHousingDepthMm`, default 20) is THE housing depth.
- **Construction geometry** (`stringerConstructionGeometry.js`): reference = one knot per bearing front corner;
  lap-jointed boards are solved as one group profile and sliced per board; at a POST each board is independent (user
  decision) and treads standing wholly on the post neither shape the board nor get a housing. Board ends: plumb faces,
  the first board's foot cut along the floor; a board entering a post goes `postHousingDepthMm` past its face; at a
  postless corner one board butts into the other's housing. Cut boards: notched comb with plumb riser cuts. Closed
  boards: `housings[]` (`kind` tread/riser/butt; tread housing extended by the nosing), united `housingPockets` (real
  pockets in 3D). Diagnostics: `STRINGER-MIN-DEPTH`, `STRINGER-MIN-SECTION`, `STRINGER-TREAD-SUPPORT`,
  `STRINGER-CONTOUR-SELF-INTERSECTION`, `STRINGER-OVERRIDE-*`, `STRINGER-FILLET-CLAMPED`, `STRINGER-SPLINE-REJECTED`,
  `STRINGER-DEPTH-FOR-SUPPORT`.
- **Profile model/solver** (`profileCurve.js`, `polylineProfile.js`, `stringerProfileModel.js`,
  `stringerProfileSolver.js`): lines + true arcs; nominal control polygon offset along the local normal; local depth =
  exact curve distance. Params: `minimumStringerDepthMm` (350, a minimum), `stringerProfileOffsetMm`,
  `stringerTopMarginMm` (closed: measured from the tread TOP), `stringerCornerRadiusMm`, `stringerRadiusScope`,
  `stringerTransitionStyle` SHARP | TANGENT_ARC | SPLINE (centripetal Catmull-Rom; AUTO depth push only without hand
  edits), `stringerNotchRadiusMm`. AUTO guarantees the minimum depth and that a housed board reaches below every
  tread's back corner (`throatBelowReference`, deepens + INFO). Steep end edges are capped (`MAX_END_EXTENSION_SLOPE`).
- **Manual profile edits**: `manualStringerProfileOverrides` per side — vertex `(ds, dn, radius)` by stable anchor ids
  (`support:step-N`, closing `end:top` / `end:<segmentId>`, post anchors `post:<postId>@<segmentId>` moving only
  vertically); handed to each board group only (`overridesForGroup`); out-of-date ones → one INFO + "Usuń nieaktualne
  edycje" (`PRUNE`); collinear unedited knots are passive so a first edit stays local.
- **Profile editor** ("Profil wangi" tab): `profileEditor/profileEditorRenderer.js` (pure SVG), `profileEditorSnapping.js`,
  `stringerProfileView.js` (view model), `ui/profileEditorPanel.js`; gestures → `applyProfileEdit` events only.
- `stringerRenderer.js` extrudes what it is given (housed board = solid layer + layer with pocket holes, no CSG).

## Joints — `geometry/jointSolver.js`, `jointConnectors.js`

Docs: [JOINTS_MODEL.md](docs/architecture/JOINTS_MODEL.md).
- Stringer ↔ post: full-section housing in the post (`postHousingDepthMm`, DO WERYFIKACJI); pocket on the face the
  board enters. Tread ↔ post: ONE plain notch and ONE full-width tongue on the face it bears on most
  (`postTreadHousingDepthMm`); risers cut flush, not housed. Stringer ↔ stringer at a postless corner: butt joint
  into a housing. Stair bolts in stringer joints (`jointConnector*`, DO WERYFIKACJI), crossing groups shifted, clash /
  edge / spacing / short / post-weakening findings.
- Output `{joints, pocketsByPost, holesByPost, holesBySegment, treadCuts, riserCuts, connectors, postWeakening,
  diagnostics}` read by renderers, DXF, takeoff (`connectorItems.js`, unpriced) and the 3D layer "Złącza"
  (`jointMarkers.js` + `scene/jointMarkersOverlay.js`, never exported).

## Balustrade, glass, cantilever

Docs: [RAILING_MODEL.md](docs/architecture/RAILING_MODEL.md), [CANTILEVER_MODEL.md](docs/architecture/CANTILEVER_MODEL.md).
- `railingSolver.js`: sections `{id, side, fromStep, toStep}` (0-based); path along the tread chain cut into handrail
  runs ending at posts (existing structural posts reused, `postIdAt`); two baluster modes (housed: along the pitch line;
  overlay: rhythm per tread); bent handrail (`railingBent`), base rail (`railingBaseRail`); cut angles in the model
  (`annotateCuts`). Findings `RAILING-*`, `PL-LEGAL-H-01`.
- Glass (`railingGlass.js`, `railingInfill` balusters | glass-side (rotule Ø30, handrail on the glass) | glass-posts
  (one pane per span post to post, clamps on posts, post at every plan corner, spans split with the THINNER post));
  VSG 4.4.2/5.5.2, pane ≤ 1800 mm, tint clear/optiwhite/grey/bronze; other numbers DO WERYFIKACJI.
- Cantilever (`stairConstruction: 'cantilever'`, `cantileverModel.js`): steel profiles from the wall (≥ 2 per tread)
  with a wooden cladding box per tread; no wangi (empty models `absent: true`), no structural posts/joints.

## Validation

Docs: [CONSTRAINTS_AND_VALIDATION.md](docs/architecture/CONSTRAINTS_AND_VALIDATION.md).
- `validator/StaircaseValidator.js` `validateModels(models)` composes: `constraints/geometricConstraints.js` (hard
  invariants, ERROR), `validation/facts.js` + `rules/` (profile rules: PL legal, ergonomics…), `validator/checks.js`
  (walkline consistency, collisions/headroom, invalid/zero-length geometry, normals, missing surfaces, manual-edit INFO,
  moved walkline), `validator/railingChecks.js`.
- Winder width (`PL-LEGAL-C-01`) is measured 0.4 m FROM the dusza: `walklineModel.js offsetLineFromInner` (offset
  straights + arc round the corner) crossed with each edge. Blondel (`PL-LEGAL-A-01`) is WARNING, never blocks.
- **Takeoff validation gate** (`takeoff/validationGate.js`): validator + stringer construction + joints + cantilever +
  railing + structural + stairwell-fit diagnostics; any active ERROR → takeoff BLOCKED. Walidacja tab and Kosztorys show
  the same list. Waivers (`diagnostics/waivers.js`, `(ruleId, elementId)`, saved in the project) un-block without
  hiding or changing any number.
- `validation/pipeline.js` (8-stage `runValidationPipeline`) is a standalone entry point, not wired into the UI.

## Structural check (orientative) — `src/structural/`

Docs: [STRUCTURAL_CHECKS.md](docs/architecture/STRUCTURAL_CHECKS.md). Never a substitute for an engineer; WARNING at most.
Self-weight from the takeoff's net volumes; treads (beam between wangi), wanga boards (inclined beams incl. balustrade
weight), handrail runs and balustrade posts under horizontal load. EN 338 values from a secondary source, UK load
values (user decision) — all flagged for verification. Config `structural*`, tab "Konstrukcja".

## Takeoff, pricing, offer

Docs: [OFFER_MODEL.md](docs/architecture/OFFER_MODEL.md).
- `takeoff/materialTakeoff.js`: one item per physical component, NET vs STOCK (winder = its production blank; stringer
  = smallest rectangle round the solved contour), INVALID items never get invented numbers; railing/glass/connector
  items in their own modules; `wasteFactors.js`, `materialCatalog.js`.
- Pricing: generic per-material list (`pricing.js`) and the DREWEX board price list (`boardPricing.js`: PLN/running
  metre by depth range × length column × thickness class, waste already inside; CSV import/export) — MATERIAL only;
  post price table; manual extra rows (`manualItems.js`). Takeoff settings are NOT config (own state, saved in the
  project). Summary per category (`ui/takeoffView.js summarizeByCategory`).
- Offer (`offer/offerModel.js`, `offerDocument.js`, `ui/offerPanel.js`): CNC + projekt is a hidden lump sum spread over
  material lines; categories can be shown separately; extras, installation, VAT 23/8/0, gross; printed via the
  browser's print-to-PDF. Company data = browser setting (`localStorage`), offer data = project.

## Plan 2D and workspace UI

- `plan2d/plan2dRenderer.js` (pure SVG from model + viewport; screen-constant strokes/handles/labels via `mmPerPx`),
  `planInteractions.js` (zoom/pan/pinch, drags, clicks, opening drawing), `viewport.js`, `edgeEdit.js` (edge edit:
  dragging an end turns the edge about its walkline point, ends stay on their own stringer line piece and between the
  neighbouring edges; Alt = free move of one end). Layers: grid, axes, widths, walkline, run/step boundaries, wangi as
  board footprints, posts, balustrade, opening, winder widths, stringer spacing, winder blanks.
- Workspace (`ui/workspace.js`, `style.css` grid): toolbar, left info + lil-gui parameters (`ui/ui.js`), main view
  (Plan 2D | Widok 3D | Profil wangi), right tabs Inspektor / Walidacja / Kosztorys / Konstrukcja / Oferta. One shared
  selection (`ui/selection.js`, model ids only). Value states AUTO/USER/RĘCZNA (`ui/valueState.js`). Undo/redo of
  config snapshots (`history/modelHistory.js`), committed on drag end.

## 3D, presentation

- Traceability `userData` on every mesh (`scene/traceability.js`, `elementInspector.js`); debug overlay
  (`debugOverlay.js`); selection highlight; standard views + ortho (`sceneSetup.js`); HUD layers.
- Presentation state (NOT config, not in undo): `scene/appearance.js` colours + finish per element (oak photo texture
  default — `src/assets/textures/oak-natural.jpg`, generated oak, solid; metal fixings), client mode, photo export with
  company logo (`presentationImage.js`, logo in `localStorage`). Lighting/texture are presentation only.

## Export and project file

- DXF 1:1 (`export/dxfExport.js`, ASCII R12, mm, no diacritics): stringer board / all boards (outline with real arcs,
  housings, bearings, post faces, bolt holes, the board's own findings), posts (unfolded faces + pockets + holes),
  treads (outline, winder blank, riser groove, post cut), balustrade (pieces with cut angles, baluster cut list, glass
  panes). OBJ/DAE geometry export (`objExporter.js`, `daeExporter.js`). Missing geometry → `null`, never a fake file.
- Project file (`project/projectIO.js`, `_version: 4`, migrations v1→v4): `config` + top-level `edgeOverrides`,
  `stringerProfileOverrides`, optional `postOverrides`, `projectName`, `notes`, `takeoffSettings`, `appearance`,
  `waivers`, `offer`. Runtime `config` still nests `manualEdgeOverrides`/`manualStringerProfileOverrides`/
  `manualPostOverrides`. New optional fields need no version bump; a changed shape does (RULES #15).

## Open items / known limitations

- Default L stair still has ceiling collisions and `STRINGER-MIN-SECTION` warnings (cleanup step 5: tune defaults).
- `main.js` (~1400 lines) still holds offer, presentation/logo and export wiring (cleanup step 4: split).
- Moving a stringer-line corner from one tread to another by an edge edit is not supported (edges stop at corners).
- Winders: one dusza distribution (even); a ~10 mm dusza can flip the housed recess order on the wanga; in a U with a
  0-tread middle flight and a barely fitting arc the two corner posts may overlap.
- Not done: multi-arc profile transitions, curved plan paths, CNC output, metal stringers (user's later list),
  shaped transition piece at a newel, PL load values for the structural check.
