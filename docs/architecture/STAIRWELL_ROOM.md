# Stairwell (klatka schodowa) — fixed and free sides — `src/geometry/stairwell.js`, `src/designer/stairwellVariants.js`

Model v3 (user decisions 2026-10-16). Earlier models — a drawn room rectangle with an entry and an exit (stages 1–4,
reworked once) — are in git history; they forced the entry onto a fixed line and treated the walls as limits, while
a real stairwell is described by the dimensions that are RIGID.

## Inputs (config, folder "3. Klatka schodowa")

| field | meaning |
| --- | --- |
| `stairwellRoomEnabled` | the stairwell dimensions are on |
| `stairwellSide{A,B,C}Mm` | the side lengths of the stair's OUTER line (outer face of the outer wanga = the wall line), measured like `stairwellFit.js outerSideLengths`: A from the first front edge (no nosing) to the corner, B along flight B (L: to the last back edge; U: corner to corner, wall to wall), C from the corner to the last back edge (U) |
| `stairwellSide{A,B,C}State` | the side's state (user decision 2026-10-23 — the walls' dimensions never change): `free` (swobodny — follows from the stair), `rigid` (sztywny — exactly its dimension), `main` (główny — rigid, and the going follows it; one only) — `wellSideState` / `wellMainSide`; null = from `…Fixed` |
| `stairwellSide{A,B,C}Fixed` | (older projects) FIXED = rigid; the exit side when fixed, else the first fixed, is then main |
| `stairwellWallList` | THE WALLS (the wall editor, user request 2026-10-23 — see "Walls" below): `[{id, side, line, from, to}]`; `null` = taken from the per-side fields below |
| `stairwellWall{A,B,C}` | (per-side, older projects; read only without a list) the side runs along a wall |
| `stairwellWall{A,B,C}Extent` + `…LengthMm` | (per-side, as above) how far the wall reaches (user decision 2026-10-19): `full` (the whole side), `start` (from the side's start — A: the first front edge, B/C: the corner — that long, at most the side), `end` (back from the side's end — A: the corner / side B, C: the slab edge — that long; longer than the side = the wall goes on past its start, e.g. behind the entry) — `wallInterval` |
| `stairwellWallGapMm` | wall → wanga face |

The exit side is the one the stair ends on (`exitSideLetter`: straight A, L B, U C). Example (the user's U): B = 1885
wall to wall and C = 2350 from the end wall to the slab edge fixed, A free — the entry floats (2000 or 2500 depending
on the counts), so the entry and the exit need not be on one line.

## Kept LIVE — `stairwellFit.js solveFixedSides`

**Every rigid side exact** (user decision 2026-10-23, "Zabiegi + szerokość"): `solveStairwellFit` picks the counts and
the going with the MAIN side as the key (exact) and the other rigid ones within a going; then `exactRigidSides`
(Gauss–Newton on real layouts, finite-difference Jacobian, active set at the bounds, the main side weighted ×100)
solves — with the counts fixed — the going and each shiftable turn's own split (`turnSplitOffsetsMm[k]`: how much of
that turn's winder zone lies before the arc's middle, within [π·off/4, zone − π·off/4]; a winder turn laid out from the
walkline whose zone is not pinned to the corner — not a landing, not the one 180° zone) so that every rigid side is
met; only when that is not enough the width as well (never wider than given, ≥ 500). When they still miss, the counts
±1 on every rigid side's flight are tried, ranked: sides met → riser in range → least narrowed → 2h+s. A turn's split
moves length from the side before it to the side after it (1:1). `turnSplitOffsetsMm` is the solver's OUTPUT only —
applied in `fullConfig` (planLayout.js `paramsOfTurn`, schema.js turn feasibility), never copied into `config` (nor by
a variant's "Zastosuj"), never read as an input, so it is gone when the stairwell is off. A rigid side still off by
more than 1 mm → **ERROR** `STAIRWELL-SIDE-FIXED` (it blocks the takeoff, waivable) naming what to change (winder
count, turn type, width, another side free, the variant search).

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

**The wall editor** (user request 2026-10-23: walls on both sides of a flight, e.g. along flight C, which the per-side
fields could not say). `config.stairwellWallList` = `[{id, side: 'A'|'B'|'C', line: 'outer'|'inner', from, to}]`:
each wall stands beside one side of one of the plan's lines (`line`: the outer or the inner line — an S's names
lewa / prawa, util/sideNames.js), the wanga face `stairwellWallGapMm` off it, over `[from, to]` mm measured from the
side's FIXED corner — side A back from its end (the corner; a straight stair: the exit) toward the entry, B and C on
from their start corner — so a wall keeps its place when a free side changes; `to: null` = to the side's far end
(follows the side). `stairwellWallList(config, planLayout)` returns the list, or — for a project without one — the
per-side fields turned into it (`wall-A` …, on the measured line); the first edit writes the list
(`stairwellWallEdits.js applyWallEdit`: `add` / `remove` / `set` / `set-span` (a dragged end, min 50 mm) / `clear`).

Sides are found BY DIRECTION (`lineSides(planLayout, line, stairType)`): a line's straight pieces are matched in order
to the flights' directions (A = the outer line's first piece, B = its second, C = −A for a U, A for an S); a flight
with no piece on the line gets a zero-length side where it would be. Before, the pieces were numbered in order, so an
S's inner line starting with winders (A = 0) shifted the letters: its B wall was drawn as "A" and wall C was lost (user
report 2026-10-23). The fit (`stairwellFit.js outerSideLengths(…, stairType)`) and the report measure the same way.

The sides A / B / C are measured along `stairwellMeasureLine(config)`: the outer line; an S along its left / right
(`stairwellWallHand`, panel „S: ściany klatki i boki A/B/C”) or, by default, the line most of its walls stand along.
Choosing left / right there also MOVES the wall list's walls to that side (`applyWallEdit` 'to-line': when most walls
stand on the other line every wall changes sides — user report 2026-10-23: the switch only changed the measuring, the
stair stayed on the wrong side of its walls); the opening, given in the wall frame, keeps its place relative to the
walls.

Editing: plan mode "▥ Ściany" (`plan2dRenderer.js wallEditXML`, `planInteractions.js` → `main.js applyWallChange /
wallDrag`): a dashed place beside every side of both lines (click = a wall on the whole side), every wall with a handle
at each end (drag along the side; snaps to the side's ends and the tread edges on that line within 8 px, else 10 mm),
right-click = remove; its length labelled. Folder 3: one row per wall (side, line, from, to — empty = to the end —,
its length, ✕), "+ Dodaj ścianę", "▥ Edytuj ściany na planie".

Corners: two walls of the SAME line on neighbouring sides, both reaching their shared corner, close it — convex (the
line turns away from the stair: outer L / U corners) run on past it, concave (toward the stair: an S's B–C corner, a
dusza's two inner walls) stop short. What reads the walls: posts (no dusza post against a wall — any line), the
opening's balustrade, the wall handrail (`wallRailAllowed`: a side with a wall; with the stairwell off the outer side,
as before), "Balustrada tam, gdzie nie ma ściany" (every side with a wall: `treadsOpenOnOuterSide(…, line)`, a side
with no wall keeps its sections), the opening's snapping (`frame.wallLines`), 3D walls and the slab.

A partial wall is drawn on the plan with a cap at its free end(s) and "ściana A: 1300" beside it. What depends on the
walls follows their real stretch: the opening's balustrade leaves out only the part of an edge a wall runs along
(railingSolver.js `cuts` — see RAILING_MODEL.md), and `treadsOpenOnOuterSide` (a tread with < 50 % of its outer
side along a wall is open) + `openOuterRailingRanges` drive the button "Balustrada tam, gdzie nie ma ściany"
(folder 9: on every side with a wall, its sections replaced by one per run of open treads; a side with no wall keeps its sections; editable after).
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
