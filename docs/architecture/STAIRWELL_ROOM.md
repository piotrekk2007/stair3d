# Stairwell (klatka schodowa) — fixed and free sides — `src/geometry/stairwell.js`, `src/designer/stairwellVariants.js`

Model v3 (user decisions 2026-10-16). Earlier models — a drawn room rectangle with an entry and an exit (stages 1–4,
reworked once) — are in git history; they forced the entry onto a fixed line and treated the walls as limits, while
a real stairwell is described by the dimensions that are RIGID.

## Inputs (config, folder "3. Klatka schodowa")

| field | meaning |
| --- | --- |
| `stairwellRoomEnabled` | the stairwell dimensions are on |
| `stairwellSide{A,B,C}Mm` | the side lengths of the stair's OUTER line (outer face of the outer wanga = the wall line), measured like `stairwellFit.js outerSideLengths`: A from the first front edge (no nosing) to the corner, B along flight B (L: to the last back edge; U: corner to corner, wall to wall), C from the corner to the last back edge (U) |
| `stairwellSide{A,B,C}Fixed` | FIXED = must come out exactly; FREE = follows from the tread counts (no limit) |
| `stairwellWall{A,B,C}` | the side runs along a wall (drawn in 2D / 3D, what the opening is measured from) |
| `stairwellWall{A,B,C}Extent` + `…LengthMm` | how far the wall reaches (user decision 2026-10-19): `full` (the whole side), `start` (from the side's start — A: the first front edge, B/C: the corner — that long, at most the side), `end` (back from the side's end — A: the corner / side B, C: the slab edge — that long; longer than the side = the wall goes on past its start, e.g. behind the entry) — `wallInterval` |
| `stairwellWallGapMm` | wall → wanga face |

The exit side is the one the stair ends on (`exitSideLetter`: straight A, L B, U C). Example (the user's U): B = 1885
wall to wall and C = 2350 from the end wall to the slab edge fixed, A free — the entry floats (2000 or 2500 depending
on the counts), so the entry and the exit need not be on one line.

## Kept LIVE — `stairwellFit.js solveFixedSides`

The fixed sides hold on every change, not only when a variant is applied (user, 2026-10-16: "the exit treads must be
pinned"): `buildStaircase` runs `solveFixedSides(config)` whenever the stairwell is on with a fixed side — the same
solve the designer uses for each variant — and `rebuild()` copies the result back (AUTO): the going, the counts
(unless "Liczby stopni ustawiam ręcznie" — then only the going follows the key side, e.g. 4 or 5 straight in C and A
follows), a one-zone U's axis gap from a fixed B (`stairwellDrivenFields`: those fields show AUTO and are disabled — free
B to set the axis gap by hand), the width when B needs it. The user's winders, turns, zone etc. stay theirs. A turn
the layout calls infeasible (e.g. too few winders for the walkline) no longer drops the solution here
(`opts.allowInfeasible`: it ranks last; the validator reports it — `WINDER-WALKLINE-MOVED` now names the zone's count
and the count it needs, ≈ ⌈walkline arc / going⌉). No solution → WARNING, the user's values stay. Memoised on its
inputs (manual overrides excluded), so an edge drag does not re-solve.

Few winders in one 180° zone (e.g. 5 × 225 mm at a 500 mm walkline): the zone's goings cover only 1125 mm of walkline,
the half circle at 500 mm needs π × 500 ≈ 1571 — the zone is laid out on a walkline ~200 mm from the post (narrow
wedges at the dusza, big corner winders). That is the geometry, not a bug; the warning says how many winders it needs.

## Wall frame and the opening

`wellFrame(config, planLayout)`: origin = the end of side A (the end wall's corner); x = the distance from wall A
(along side B; a straight stair: across the flight toward the inner line); y = the distance from the end wall back
toward the entry. A mirror image of the plan frame for a right turn — `resolveOpening` re-orients the plan outline
(`toCCW`). `ceilingOpening.js openingFrame` uses it whenever the stairwell is on: the rectangle sliders are "od ściany A
(X)" and "od ściany końcowej (Y)", polygons / edge drags / the derived opening live in it, so the opening stays put when
a free side changes. `wallLines` = the walls in frame coordinates (x = −gap for wall A, y = −gap for the end wall, a U's
wall C at x = B + gap) — the derived opening snaps its edges to them (never pulled back inside).

## Report — `stairwellReport` (built once in `buildStaircase` → `built.stairwell`, diagnostics in the gate)

Every side measured (`sides: {side, achieved, target, fixed, deviation}`); a fixed side off by more than
`WELL_TOLERANCE_MM` (1) → WARNING `STAIRWELL-SIDE-FIXED` with the amount. Free sides are never reported.

## Walls

A partial wall is drawn on the plan with a cap at its free end(s) and "ściana A: 1300" beside it. What depends on the
walls follows their real stretch: the opening's balustrade leaves out only the part of an edge a wall runs along
(railingSolver.js `cuts` — see RAILING_MODEL.md), and `treadsOpenOnOuterSide` (a tread with < 50 % of its outer
side along a wall is open) + `openOuterRailingRanges` drive the button "Balustrada zewn. tam, gdzie nie ma ściany"
(folder 9: replaces the OUTER balustrade sections by one per run of open treads, the inner ones kept, editable after).
The wall frame's `wallLines` (opening snapping) still take a wall as a whole line.

`stairwellWalls` (3D, presentation only): one piece per side along a wall — only its `wallInterval` stretch — the
outer side moved `gap` outward, extended at a corner shared with another wall (only when both walls reach that corner;
a partial wall's free end is square, `partial: true`) (by the gap, and by the drawn thickness 120 mm in 3D), up to the slab's
underside; `slab` = the box round the stair and the walls (wall frame) grown by 120 — `buildCeiling(…, slab)`.
`stairwellWallsRenderer.js` draws them translucent ("Pokaż ściany klatki"). `stairwellPlanDrawing` → plan 2D layer
`stairwell`: the walls (thick grey on the wall side) and every side's dimension outside them — a fixed one "B: 1885 🔒"
(green; red "(sztywny …)" when off), a free one "(swobodny)".

## The variant list — `designer/stairwellVariants.js` (rule STAIR3D-WELL-01)

"🔎 Szukaj wariantów schodów w klatce" (folder 5) — a few variants by rules: the project's type and turn; winders
round n = round(walkline arc / going) + 1 (three counts, ≥ 3 per 90° turn) + one landing; a U as one 180° zone when its
axis gap is 0..300 at the width it gets, else two turns + one zone. The width is the user's, narrowed where a fixed side
needs it (one zone: 2 × width − board ≤ B, so the width becomes (B + board) / 2 when B is smaller; two turns: the width
that makes B exact, re-solved up to 4 rounds) — below 800 mm a WARNING, below 500 dropped.

Each variant = ONE `solveStairwellFit` with the FIXED sides as targets: key = the exit side when fixed, else the first
fixed one (exact); the other fixed sides as close as the counts allow (a U's B exact by the axis gap — the fit derives
`uAxisGapMm` from B — or by the width); FREE sides via `opts.freeSides` — their flights' counts chosen for the riser /
2h+s like the others, no target. A fixed side still off → a problem of the variant (listed, `ok: false`), never hidden.
Measured on a real layout (report, ceiling fit with the opening from the walls, the validator) and sorted: fixed sides
met, riser in range, width ≥ 800, distinct rules in error, ceiling collisions, |2h+s − 625|. "Zastosuj" writes the
patch (type, turns, winders, width, going, counts, axis gap, `stairwellFitEnabled: false`).

## Opening derived from the stair

`openingMode: 'derived'` (folder 4): `requiredOpeningRelative` = the union of the bounding rectangles (frame axes,
rounded outward to 0.1 mm, snapped to the walls) of the treads that need headroom; "⇩ Zapisz wyznaczony otwór jako
zadany" / any hand edit freezes it as a given polygon. Variants show the opening they need.

While the opening is drawn ("Rysuj otwór") and edited, every edge carries its length (`plan2dRenderer.js
edgeLengthLabelXML`: the drawn edges, the rubber band to the cursor and the closing edge; user request 2026-10-23).

## Project file

v4 → v5 turned the old side-length fit into a room; v5 → v6 turns a room into sides (U: B = W and C = L − exit inset
fixed, A = L − entry offset free; L: B fixed, A free; straight: A fixed) and moves its opening to the wall frame. The
old fit (`stairwellFitEnabled`, `stairwellKeySide`, …) is internal to the solver, no longer in the panel.

## Headroom in 3D — `headroomModel.js`, `scene/headroomOverlay.js`

`buildHeadroomModel({planLayout, ceilingFit, config})` (built in `buildStaircase`, `built.headroom`): EDGE pieces —
every opening edge sampled every 10 mm; the first tread under the point 5 mm past the edge on the slab's side (the
highest plan outline containing it, top (index + 1) × riser below the soffit — the same as `deriveCeilingFit`, so the
3D agrees with the validator; none at the exit, where nothing of the stair is under the slab past the edge) → a
vertical strip a→b from that tread's top to the soffit, `headroomMm`, `ok` (≥ `minHeadroom`). BLOCKS — every tread of
`ceilingFit.violatingTreads` below the soffit: its outline minus a convex opening (the whole tread otherwise), from
its top to the soffit, red. `min` = the tightest spot. The overlay (presentation only): translucent quads / prisms
(green 0x2e7d32 / red 0xc0392b), the meeting line on the treads, a vertical dimension at `min` and a sprite label
(canvas texture, 200 mm high — drawn into the WebGL image, so saved photos have it). Toggle `viewState.showHeadroom`
(HUD „Skrajnia” + panel „Widok 3D” „Pokaż skrajnię pod stropem”, kept in sync), default off, also in the presentation
mode. Tests: `geometry/__tests__/headroom.test.js`.

## Open

Two fixed sides along the walking line (an L's A and B, a U's A and C) are met only as far as the counts allow — an
asymmetric winder zone (`walklineSplitOffset`) could make the second exact; a straight stair's second wall; the plan
is drawn in the stair frame.
