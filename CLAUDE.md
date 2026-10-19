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
`jointSolver`, `cantileverModel`, `metalStructureModel`) → plain-data models → renderers (`*Renderer.js`, Three.js) / plan 2D SVG / validation /
structural check / takeoff / DXF / offer.

- `geometry/buildStaircase.js` is the only orchestrator: it applies the stairwell fit, builds every model once and
  returns them all (`fullConfig`, `derived`, `planLayout`, `treadModels`, `riserModels`, `stringerModels`,
  `stringerConstruction`, `postModels`/`allPostModels`, `railingModel`, `joints`, `cantilever`, `metalStructure`, `ceilingFit`,
  `stairwellFit`, …). Every consumer reads those — no second geometry solve anywhere.
- No `*Solver.js`/`*Model.js` imports `three`; no renderer calls `buildPlanLayout` or decides geometry (enforced by
  `geometry/__tests__/consolidationInvariants.test.js`).
- `main.js` `rebuild()`: config → `buildStaircase` → validation + structural report + takeoff (one gate) → panels.
  UI writes only `config` (or the separate presentation/takeoff/offer state), then calls `rebuild()`. `main.js` holds
  the app state and wires the panels; self-contained page features live in `src/app/` and get the current state
  through getters: `presentation.js` (company logo + "Zapisz zdjęcie"), `offerController.js` (the "Oferta" tab: offer
  settings, company data, print to PDF), `exports.js` (DXF / takeoff CSV-TXT / OBJ-DAE downloads,
  `projectFileBaseName`).

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
- **One 180° winder zone** (U, `treadsLegB = 0`, both turns winders, `uSingleWinderZone`; user decision 2026-10-14):
  `uWindersTotal` winders on a walkline with a HALF CIRCLE round the dusza's middle, zone centred on it; flights A
  and C set by the distance between their inner wangi AXES (`uAxisGapMm`, 0 = C's wanga over A's; inner-line gap =
  axis gap − board thickness, may be negative). One turn `{halfTurn, innerCorners, outerCorners, centre, postSpots}`;
  one central post on the axes (two corner posts when the gap is wider than post − board). `winderArc.js
  halfTurnWinderGeometry`, `planLayout.js buildHalfTurnLocal`; doc section in WINDER_ARC_LAYOUT.md. Stacked inner wangi
  (axis gap < board thickness) overlap in height near the post: NOT trimmed (user decision, variant 2) — WARNING
  `STRINGER-STACKED-OVERLAP` on C's board with the amount and the fix (post-face points in "Profil wangi";
  `stackedStringers.js`).
- `planLayout.walkline = {path, points}` — the drawn walkline (arc as chords) and one point per edge (edit pivots).
- Override layers applied in `buildPlanLayout` (in this order): `manualEdgeOverrides` (`{[boundary]: {inner?, outer?}}`,
  older `{movedEndpoint, point}` still read — `edgeOverrides.js edgeOverrideEndpoints`; stamped with the tread layout
  they were made on, `manualEdgeOverridesLayout` = `edgeLayoutKey` (counts of treads / winders / turns): edits from
  another layout are NOT applied — WARNING `EDGE-OVERRIDES-OUT-OF-DATE`, replaced by the first new edit
  (`withEdgeOverride`); a rejected edit → WARNING `EDGE-OVERRIDE-SKIPPED`; `planLayout.edgeOverrideStatus
  {applied, skipped, stale}`, the plan draws and drags only the applied ones (`effectiveEdgeOverrides`); the two treads
  of an edited edge get their outlines RE-CUT along `innerFullPath`/`outerFullPath` between their final edges
  (`outlineRecutter`: corners of a line go to the tread they now lie in; edges crossing each other → triangle up to the
  crossing; an edge crossing a backwards dusza piece of its own tread ends the side there), `innerSide`/`outerSide`
  then feed the recess), the automatic housing recess
  (`applyHousingRecess`: a tread ends t − d from a housed wanga's chain line, on a line parallel to it —
  `recessTreadToWangi`), `manualTreadOverhangs` (one tread's own side, `{side, offsetMm}`).
- **Stairwell** (`stairwell.js` model v3 + `designer/stairwellVariants.js`, user decisions 2026-10-16; docs
  [STAIRWELL_ROOM.md](docs/architecture/STAIRWELL_ROOM.md)): no drawn room — the side lengths A/B/C of the outer line
  (`stairwellSide{A,B,C}Mm`, measured like `outerSideLengths`), each FIXED (exact) or FREE (follows from the counts,
  no limit — the entry floats), each optionally along a WALL (`stairwellWall*`, `stairwellWallGapMm`).
  `wellFrame` = the WALL frame (x from wall A, y from the end wall; a mirror of the plan for a right turn) — the
  opening is given in it whenever the stairwell is on, so it stays put when a free side changes. `stairwellReport` →
  `built.stairwell` (gate): WARNING `STAIRWELL-SIDE-FIXED` for a fixed side off > 1 mm. Plan 2D layer `stairwell`
  (walls + each side's dimension, fixed 🔒 green/red, free "(swobodny)"); 3D walls (`stairwellWalls` →
  `stairwellWallsRenderer.js`, `built.wallsMesh`, "Pokaż ściany klatki" in the panel's "Widok 3D" folder and "Ściany
  klatki" in the 3D HUD's Warstwy, kept in sync; the slab covers the stair + walls).
  **Variants** ("🔎 Szukaj wariantów schodów w klatce", folder 5, `ui/stairwellVariantsPanel.js`): the project's type;
  winders n−1..n+1 round round(arc/going)+1 + one landing; U one zone when the axis gap is 0..300 (the width narrows to
  (B + board)/2 for a smaller fixed B), else two turns (width solved for B) + one zone; width < 800 a warning, < 500
  dropped. Each = `solveFixedSides` (one `solveStairwellFit` with the fixed sides as targets, key = the fixed exit side,
  else the first fixed; free sides via `opts.freeSides`; a U's B by the axis gap / width); a fixed side still off → the
  variant's problem; sorted, "Zastosuj" writes the patch. **Kept LIVE**: `buildStaircase` runs `solveFixedSides` on
  every change (memoised; `opts.allowInfeasible`) and `rebuild()` copies the going / counts (unless
  `stairwellManualCounts`) / axis gap / width back as AUTO — the fixed sides stay pinned whatever the user edits. **Opening derived** (`openingMode: 'derived'`):
  `requiredOpeningRelative` = union of the headroom treads' bounding rectangles (frame axes, outward 0.1 mm, snapped
  to `frame.wallLines`); "⇩ Zapisz wyznaczony otwór jako zadany" / a hand edit freezes it.
- **Stairwell fit** (`stairwellFit.js`): not in the panel — the per-variant going/count solver of the designer
  (`opts.limits`, `opts.freeSides`). It derives going + straight counts from side lengths of the
  outer line (key side exact; the given dimensions come first: other sides within one going, then riser in range,
  then deviation / 2h+s — a riser forced out of range is a WARNING, never a reason to outgrow the room;
  `STAIR3D-FIT-01`). Going 150–320, found by sampling + narrowing (a side is not one straight line of the going).
  A U laid out as one 180° zone: side B = 2 × width + axis gap − board thickness — given B, the fit derives
  `uAxisGapMm` (exact). Key dimensions (rise, width, stairwell sides, axis gap, ceiling opening) take 1 mm steps.
- **Ceiling opening** (`ceilingOpening.js`): rectangle (sliders) or drawn polygon (`openingShape`, `openingPolygon`)
  — or DERIVED from the stair (`openingMode`, above) — in the frame of `openingFrame(config, planLayout)`: relative to
  `planLayout.bounds` min corner, or the WALL frame with the stairwell on; `resolveOpening(config, frame)` → plan
  `outline` (CCW) + `relativeOutline`; edges dragged on the plan (`.opening-edge`, wall snap); `deriveCeilingFit` →
  collisions/headroom; "Dosuń otwór" alignment.

## Treads, risers, posts

- `treadSolver.js` `TreadModel`: elevation, direction, widths, nominal/final edges, nosed `outline`, `winderInfo`
  (passthrough), `winderBlank` (`winderBlank.js` — the production blank incl. nosing, used by plan/3D labels/takeoff),
  `notch` (underside groove for the riser overlap: `strip`, `undersides` so the nosing keeps full thickness, `outline`
  for the DXF). Nosing slides front corners along the tread's FINAL sides (`nosingUtils.sideDirection`); the corners
  are the OUTLINE's own on the front edge's line (`withOutlineFrontCorners` — a triangular winder's apex, which then
  slides along its back edge; also the riser groove).
- `riserSolver.js` `RiserModel`: panels built from the FINAL front edge (winder fan of `WINDER_RISER_FAN_PANELS`,
  ends exactly the edge points), `directionSpreadDeg`, `riserTopOverlapMm` into the tread above; with risers the stair
  ends with a top riser under the "fajkowy" nosing tread (`riser-top`, `topNosingThicknessMm`, DO WERYFIKACJI).
- `postSolver.js` `PostModel`: structural posts on the inner wanga's AXIS (start/end newels, one corner post per turn,
  de-duplicated); a start/end newel overlapping a corner post is not placed; per-post edits `manualPostOverrides`
  (`removed`, `topDeltaMm`, `bottomDeltaMm`; removing a corner post turns that inner joint into a lap joint);
  balustrade posts are PostModels with `kind: 'railing'` and their own `sizeMm`. `buildAllPostModels` includes removed
  ones (ghosts in the plan). A post can belong to several chain points (`anchors` — the central post of a 180° zone);
  a chain point where the line turns back is a corner (`pathUtils.js goesStraightThrough`).

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
  postless corner the boards LAP, with no housing (user decision 2026-10-14): convex — B butts flush against A's inner
  face; concave — A runs one thickness past the corner LEVEL at the corner's heights (`flattenBeyond`), B starts flush
  against it; bolted (`jointConnectors.js`). An offset contour folding back at a sharp turn of the reference (steep
  dusza winders) is straightened toward more material (`polylineProfile.js unfoldOffsetPolyline`). Cut boards: notched comb with plumb riser cuts. Closed
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
  (`postTreadHousingDepthMm`); risers cut flush, not housed. Stringer ↔ stringer at a postless corner: lap joint,
  no housing, bolted. Stair bolts in stringer joints (`jointConnector*`, DO WERYFIKACJI), crossing groups shifted, clash /
  edge / spacing / short / post-weakening findings.
- Output `{joints, pocketsByPost, holesByPost, holesBySegment, treadCuts, riserCuts, connectors, postWeakening,
  diagnostics}` read by renderers, DXF, takeoff (`connectorItems.js`, unpriced) and the 3D layer "Złącza"
  (`jointMarkers.js` + `scene/jointMarkersOverlay.js`, never exported).

## Balustrade, glass, cantilever, metal structure

Docs: [RAILING_MODEL.md](docs/architecture/RAILING_MODEL.md), [CANTILEVER_MODEL.md](docs/architecture/CANTILEVER_MODEL.md),
[METAL_STRUCTURE_MODEL.md](docs/architecture/METAL_STRUCTURE_MODEL.md).
- `railingSolver.js`: sections `{id, side, fromStep, toStep}` (0-based); path along the tread chain cut into handrail
  runs ending at posts (existing structural posts reused, `postIdAt`); two baluster modes (housed: along the pitch line;
  overlay: rhythm per tread); bent handrail (`railingBent`), base rail (`railingBaseRail`); cut angles in the model
  (`annotateCuts`). Findings `RAILING-*`, `PL-LEGAL-H-01`. Every run is a piece BETWEEN two posts: simplified nosing
  line → short stub next to a post dropped (`RAIL_END_STUB_MM` 250, the straight piece carried on to the post) → cut
  or extended to the post FACES (`fitPathToPosts`; a post standing beside the run's line gets the run's end moved to
  its nearest point; a section whose own end post was removed goes on to the nearest standing post within reach —
  a handrail always reaches a post) → optional manual height of an end at its post
  (`config.railingEndOffsets`, `railingEndKey`, edited in the Inspektor's post view) → smoothing for a bent handrail.
  Balusters and glass read their height under the handrail's own line (`zOnPaths`). A post a handrail ends at reaches
  at least the handrail's top there (`postTopNeeds` → own posts in the solver, structural posts via `postSolver.js
  raisePostsToHandrail`; nominal height, manual `topDeltaMm` on top). The renderer cuts handrail ends PLUMB (sheared
  profile), flush with the post face.
- **Posts by hand** (`railingPostEdits.js`, user decision 2026-10-19): `config.railingPostEdits[section] = {added:
  [{id, s}], suppressed: [s]}` (s = plan mm along `section.path`). A hand-placed post (id `railing-post-<s>-m-<id>`,
  so `manualPostOverrides` size/height apply) cuts its run like any post (skipped + INFO `RAILING-POST-MANUAL-SKIPPED`
  within 100 mm of another post / off the handrail); an automatic CORNER post switched off merges its two runs into
  one (mitred corner; not with glass between posts; a step post cannot be). Automatic join ids keep their index among
  the automatic ones. `section.postSpots` / `suppressedCorners` feed the plan's "▮ Słupki" mode
  (`plan2dRenderer.js railingPostEditXML`: click the path = add, drag orange = move with snap to tread edges / 10 mm,
  right-click = remove / switch a corner off, dashed ghost = restore) and the Inspektor (position field, remove /
  switch off).
- **Balustrade round the ceiling opening** (`railingSolver.js buildOpeningRailing`, user decisions 2026-10-19):
  `railingOpeningEnabled` (independent of the stair balustrade), on the FLOOR (z = totalRise), posts' axis
  `railingOpeningSetbackMm` (60, ASSUMPTION) back from the edge, handrail top `railingOpeningHeightMm` (1100 — § 298,
  DO WERYFIKACJI) above it. Edges (`ceilingFit.openingOutline`): auto = all but the exit edge (the last back edge on it)
  and those along a stairwell wall; `railingOpeningEdges[i]` overrides, toggled by a click in the "▮ Słupki" mode
  (`railingModel.openingEdges`). Adjacent enabled edges = one section `opening-e<first edge>` (`kind: 'opening'`,
  `side: null`; all edges = a closed loop): corner + end posts, hand-placed posts / switched-off corners, balusters or
  glass between posts on the floor; read by 3D, plan, takeoff, DXF, checks like any section (not the side-view
  handrail editor, not end-height corrections). WARNING PL-LEGAL-H-01 below 1.1 m. `ceilingFit` and the stairwell are
  now built before the balustrade in `buildStaircase`.
- **Handrail profile editor** ("Profil poręczy" view tab): `railingProfileModel.js` (pure edit layer:
  `config.railingProfileOverrides = {[section]: {[railingRunKey 'postA>postB']: [{s, dz}]}}`, `applyRunPoints`,
  `RAILING_PROFILE_EDITS` / `applyRailingProfileEdit`), applied in the solver after the end corrections and before
  smoothing (`runs[].key`, `runs[].profile`); `railingProfileView.js` (unfolded view model),
  `railingEditor/railingEditorRenderer.js` (pure SVG), `ui/railingEditorPanel.js` (drag vertically, double-click adds,
  right-click/Delete removes, arrows, numeric field). INFO `RAILING-PROFILE-EDITED` / `-POINT-SKIPPED`.
- Glass (`railingGlass.js`, `railingInfill` balusters | glass-side (rotule Ø30, handrail on the glass) | glass-posts
  (one pane per span post to post, clamps on posts, post at every plan corner, spans split with the THINNER post));
  VSG 4.4.2/5.5.2, pane ≤ 1800 mm, tint clear/optiwhite/grey/bronze; other numbers DO WERYFIKACJI.
- Cantilever (`stairConstruction: 'cantilever'`, `cantileverModel.js`): steel profiles from the wall (≥ 2 per tread)
  with a wooden cladding box per tread; no wangi (empty models `absent: true`), no structural posts/joints. Profiles run
  like the cladding — the first parallel to the front board, the last to the back board, others interpolated — so a
  winder's profiles converge and stop where they would touch (or at their projection).
- Metal structure (`stairConstruction: 'metal-profile' | 'metal-flat'`, `metalStructureModel.js`): wooden treads on
  steel; no wangi (`absent: true`), no structural posts/joints, no risers. Profile: 1 central beam or 2 beams
  (`metalBeamCount`, `metalBeamSetbackMm`), each straight per plan run — the highest straight line under every tread's
  support plate, continuous at plan corners (small LP, `maximizeLinear`) — with a plate + web support per tread. Flat:
  two bars at the sides cut in teeth (top under the treads, the same zig-zag below leaving `metalFlatNeckMm`).
  Members are side outlines extruded across their plan piece; read by `metalStructureRenderer.js` (inside the
  `StringerOuter/Inner` layers), plan 2D footprints, the gate (`METAL-*`), takeoff (`metalItems.js`, `STEEL`,
  unpriced) and `buildMetalDXF`. All sizes DO WERYFIKACJI (`CO-MFG-J-METAL`); the steel is never checked.

## Validation

Docs: [CONSTRAINTS_AND_VALIDATION.md](docs/architecture/CONSTRAINTS_AND_VALIDATION.md).
- `validator/StaircaseValidator.js` `validateModels(models)` composes: `constraints/geometricConstraints.js` (hard
  invariants, ERROR), `validation/facts.js` + `rules/` (profile rules: PL legal, ergonomics…), `validator/checks.js`
  (walkline consistency, collisions/headroom, invalid/zero-length geometry, normals, missing surfaces, manual-edit INFO,
  moved walkline), `validator/railingChecks.js`.
- Winder width (`PL-LEGAL-C-01`) is measured 0.4 m FROM the dusza: `walklineModel.js offsetLineFromInner` (offset
  straights + arc round the corner) crossed with each edge. Blondel (`PL-LEGAL-A-01`) is WARNING, never blocks.
- **Takeoff validation gate** (`takeoff/validationGate.js`): validator + stringer construction + joints + cantilever + metal structure +
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
  = smallest rectangle round the solved contour), INVALID items never get invented numbers — but EVERYTHING in the
  project is priced (user decision 2026-10-16): a board with a design ERROR (too shallow, …) is measured and priced
  from its contour as it is, the error on the item + a note; only a board with no contour is INVALID; railing/glass/connector
  items in their own modules; `wasteFactors.js`, `materialCatalog.js`.
- Pricing: generic per-material list (`pricing.js`) and the DREWEX board price list (`boardPricing.js`: PLN/running
  metre by depth range × length column × thickness class, waste already inside; CSV import/export) — MATERIAL only;
  a wanga by `stringerPricingMode` (user decision 2026-10-16): `whole` (its minimal rectangle — default), `strips`
  (400 mm strips, each at its own depth measured at its own slant) or `split` (two straight blanks where they save the
  most) — all with the whole board's length column, ONE price, the note says what was priced (`stockGeometry.js
  stringerStrips / stringerSplitBlanks`, `calculatedDimensions.stringerPricing`);
  post price table; manual extra rows (`manualItems.js`). Takeoff settings are NOT config (own state, saved in the
  project). Summary per category (`ui/takeoffView.js summarizeByCategory`).
- Offer (`offer/offerModel.js`, `offerDocument.js`, `ui/offerPanel.js`): CNC + projekt is a hidden lump sum spread over
  material lines; categories can be shown separately; extras, discount (`discountPct`: % of the material + extras only,
  never of CNC + projekt or installation; INTERNAL — no line, the line prices are simply lower), installation, VAT
  23/8/0, gross; 3D view and plan one under the other at full width; printed via the
  browser's print-to-PDF. Company data = browser setting (`localStorage`), offer data = project.

## Plan 2D and workspace UI

- `plan2d/plan2dRenderer.js` (pure SVG from model + viewport; screen-constant strokes/handles/labels via `mmPerPx`),
  `planInteractions.js` (zoom/pan/pinch, drags, clicks, opening drawing), `viewport.js`, `edgeEdit.js` (edge edit:
  dragging an end turns the edge about its walkline point; ends slide along their WHOLE stringer line, past its corners
  (never ON a corner: `CORNER_MARGIN_MM`), between the neighbouring edges, and an edge cutting through a line piece
  with the stair on one side only (the hole of a 180° zone) is refused; Alt = free move of one end). Layers: grid, axes, widths, walkline, run/step boundaries, wangi as
  board footprints, posts, balustrade, opening, winder widths, stringer spacing, winder blanks.
- Workspace (`ui/workspace.js`, `style.css` grid): toolbar, left info + the variant list + lil-gui parameters (`ui/ui.js`,
  folders most to least important: 1 Schody, 2 Budynek, 3 Klatka, 4 Otwór, 5 Bieg i stopnie, 6 Zabieg, 7 Wangi/słupy/
  podstopnie, 8 Wspornikowa/metalowa, 9 Balustrada, then checks, view, export), main view
  (Plan 2D | Widok 3D | Profil wangi | Profil poręczy), right tabs Inspektor / Walidacja / Kosztorys / Konstrukcja / Oferta. One shared
  selection (`ui/selection.js`, model ids only). Value states AUTO/USER/RĘCZNA (`ui/valueState.js`). Undo/redo of
  config snapshots (`history/modelHistory.js`), committed on drag end.

## 3D, presentation

- Traceability `userData` on every mesh (`scene/traceability.js`, `elementInspector.js`); debug overlay
  (`debugOverlay.js`); selection highlight; standard views + ortho (`sceneSetup.js`); HUD layers.
- Presentation state (NOT config, not in undo): `scene/appearance.js` colours + finish per element (oak photo texture
  default — `src/assets/textures/oak-natural.jpg`, generated oak, solid; metal fixings), client mode, photo export with
  company logo (`presentationImage.js`, logo in `localStorage`). Lighting/texture are presentation only. Wood grain
  (`woodGrain.js`): UVs along the element's longest axis, or along `mesh.userData.grainDirection` when the renderer
  gives one — a tread's FINAL front edge (`treadRenderer.js`), so a winder's grain is parallel to its czoło.

## Export and project file

- DXF 1:1 (`export/dxfExport.js`, ASCII R12, mm, no diacritics): stringer board / all boards (outline with real arcs,
  housings, bearings, post faces, bolt holes, the board's own findings), posts (unfolded faces + pockets + holes),
  treads (outline, winder blank, riser groove, post cut), balustrade (pieces with cut angles, baluster cut list, glass
  panes). OBJ/DAE geometry export (`objExporter.js`, `daeExporter.js`). Missing geometry → `null`, never a fake file.
- Project file (`project/projectIO.js`, `_version: 6`, migrations v1→v6; v5: the side-length fit → a room, v6: a room → fixed/free sides): `config` + top-level `edgeOverrides`,
  `stringerProfileOverrides`, optional `postOverrides`, `projectName`, `notes`, `takeoffSettings`, `appearance`,
  `waivers`, `offer`. Runtime `config` still nests `manualEdgeOverrides`/`manualStringerProfileOverrides`/
  `manualPostOverrides`. New optional fields need no version bump; a changed shape does (RULES #15).

## Open items / known limitations

- Default L stair still has ceiling collisions and `STRINGER-MIN-SECTION` warnings (cleanup step 5: tune defaults).
- Winders: one dusza distribution (even); a ~10 mm dusza can flip the housed recess order on the wanga; in a U with a
  0-tread middle flight and a barely fitting arc the two corner posts may overlap.
- Metal structure: sizes are placeholders, the steel is not checked, no fixings / welds / corner details.
- Not done: multi-arc profile transitions, curved plan paths, CNC output,
  shaped transition piece at a newel, PL load values for the structural check.
