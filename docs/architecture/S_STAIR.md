# The S stair (`stairType: 'S'`)

User request 2026-10-23. Like a U, but the second turn goes the OTHER way, so flight C runs on in A's direction. The
user's case: up, left, up; the walls along the outer line go up, left, up.

User decisions 2026-10-23:
- each turn is a winder or a landing on its own;
- a dusza against a stairwell wall gets no post;
- the wangi are named left / right in the UI (stage 3).

## Plan — `planLayout.js buildMultiTurnLayout(config, 2, { reverseSecond: true })`

- The first turn is built as in an L / U: native right-turn frame, mirrored at the end for `turnDirection: 'left'`.
  `turnDirection` is the FIRST turn's direction.
- The second turn is built like any turn (`buildTurnOrLanding`, its native right-turn frame), then:
  1. mirrored in its own frame into a left turn (`mirrorLocalTread`, the walkline, the turn's points);
  2. placed with its local OUTER line starting at the first turn's exit on the INNER line;
  3. its two sides swapped (`swapTreadSides`). Every `[inner, outer]` pair, both chains and the winder edges are
     exchanged, and the outline is reversed so every tread winds the same way.
- The plan therefore keeps ONE inner line and ONE outer line through the whole stair:
  - inner = the first turn's dusza (the left line for a first turn to the left);
  - outer = the second turn's dusza.
  - `inwardNormal(direction, side, handedness)` stays valid everywhere: the inner line is always on the same hand of
    the walker.
- Markers: the second turn's treads and the turn itself carry `duszaSide: 'outer'`; `turn.innerCorner` is the DUSZA
  corner, here on the outer line.
- Not in an S:
  - `mergeLandings` — the two landings turn opposite ways, so there is no one platform;
  - the 180° winder zone (U only).
- `deriveStairData`: two turns, counted like a U.

## What reads the dusza side

- `postSolver.js`:
  - the second turn's corner post stands on the OUTER wanga's axis (`line: 'outer'`, `ontoWangaAxis(…, 'outer')`);
  - none when that dusza stands against a stairwell wall (`stairwellWalls` pieces within the gap + 2 mm) — the two
    outer boards then lap there.
- `stringerSolver.js`:
  - each side gets the posts on its own line (`p.line`);
  - a corner joint is `CORNER_POST` when a post of that side stands there, else `LAP_JOINT`;
  - the intermediate supports follow the turn's dusza side.
- `walklineModel.js`:
  - `offsetLinesFromDusza` — an offset line from the inner AND the outer line;
  - `duszaWeights(treads)` — per edge 0 (inner) → 1 (outer): 0 up to the first turn's last edge, 1 from the second
    turn's first edge on, linear across flight B (½ on the shared edge when B = 0). The walkline crosses B from one
    dusza to the other, continuous;
  - the DRAWN walkline (`planLayout.walkline`, user report 2026-10-23) is the same line: one straight across flight B
    from the last edge of turn 1's zone (its walkline point, off the inner line) to the first edge of turn 2's (off the
    outer line); the straight edges in between get their points (edit pivots) on it — before, two parallel pieces
    with a jump at turn 2's start;
  - `treadGoingAtOffsetFromInner` uses the same weights, so the legal winder width (`PL-LEGAL-C-01`, 0.4 m) is
    measured from each turn's own dusza.
- `stairwell.js` (stage 1):
  - sides A / B / C, exit side C;
  - the B–C corner of the outer line is CONCAVE: `wallSegments` / `stairwellWalls` shorten the walls there instead of
    running them on (`prevSign` / `nextSign`);
  - the frame's wall C line is at x = B − gap.

## Stairwell fit, variants, opening (stage 2)

- `stairwellFit.js`:
  - S has the sides A / B / C; B follows flight B's count and the going, like A and C;
  - `solveFixedSides`, like a U's B: a fixed B is met by narrowing the width — an S's B holds ONE width (a U's two),
    so `widthsInB` = 1. The width is never widened past the user's;
  - the key side is the exit side C; the other fixed sides come within one going (as in an L / U).
- `designer/stairwellVariants.js`: two 90° winder turns of n − 1..n + 1 (`S-w<n>`) and two landings (`S-landing`); no
  180° zone.
- Derived opening (`ceilingOpening.js requiredOpeningRelative`): works for S. A margin is added before the outward
  rounding (`OPENING_MARGIN_MM` 0.01) — regression for U and S: a tread corner on the 0.1 mm grid used to stick out by
  microns where two rectangles met, a false ceiling collision.
- The balustrade round the opening finds S's exit edge and the walled edges like any stair.

## Walls on the left or the right (user request 2026-10-23)

- (superseded by the wall editor, STAIRWELL_ROOM.md "Walls": walls are a list on either line; `stairwellWallHand` now
  only says which line the sides A / B / C are MEASURED along — '' = the line with most walls — and, for a project
  without a wall list, where its per-side walls stand)
- `stairwellWallHand` ('' | 'left' | 'right', an S only; panel „S: boki A/B/C mierzone”, folder 3) — the side the stairwell's
  walls are on, as seen walking up flight A (stored as the HAND, so a change of the turn direction keeps them where they
  are).
- `stairwell.js stairwellWallLine(config)` turns it into the plan's line ('outer' | 'inner'):
  - the sides A / B / C are measured along that line — `outerSides(planLayout, line)` and
    `stairwellFit.js outerSideLengths(planLayout, line)`;
  - the walls stand outside it: the outward normal is `−inwardNormal(dir, line, handedness)` (no centroid guess
    any more);
  - the frame's `wallLines` are taken from the walls themselves (any side of any stair);
  - `frame.line` says which line it is.
- What follows the wall line:
  - the button „Balustrada … tam, gdzie nie ma ściany” (`treadsOpenOnOuterSide` reads that line's chains, the sections
    go to that side);
  - the wall handrail (`railingSolver.js`, only on the wall side);
  - the post rule: a dusza against a wall gets no post — the first turn's too when the walls are on the inner line. A
    concave corner's walls stop gap × √2 from it — the tolerance (`postSolver.js atWall`).

## A new project waits for „Generuj schody” (user decision 2026-10-23)

- `config.stairPending` (saved with the project; old files lack it = generated). The app's start and „Nowy” set it
  (`main.js NEW_PROJECT_START`: `stairPending: true`, `stairwellRoomEnabled: true`).
- While pending, the stair is still built (the walls and the opening follow it) but not shown:
  - the 3D root is hidden, and so are the labels, the overlays and the headroom;
  - the plan draws only the grid, the stairwell and the opening (`plan2dRenderer.js`);
  - the Walidacja tab shows only the stairwell's own findings;
  - the Kosztorys tab shows a note — the panel is hidden, not replaced;
  - the info panel and the status bar say how to go on.
- „▶ Generuj schody” (folder 1, shown only while pending; `main.js generateStair`) clears it — one undo step. From then
  on everything is live, as always.

## Names: left / right (stage 3)

- `util/sideNames.js` is THE place that names the two sides:
  - an L / U keeps zewn. / wewn.;
  - an S is lewa / prawa as seen walking up flight A. The inner line is on the side the first turn goes to
    (`sideHand`).
  - Helpers: `sideShort`, `sideAdjective`, `sideGenitive`, `wangaName`, `wangaShortName`. No side (the opening's
    balustrade) → „przy otworze”.
- Read by:
  - the panel („Typ wangi …”, the balustrade sections' side lists, „Balustrada … tam, gdzie nie ma ściany”, the side
    note) — `gui.syncSideNames` after every rebuild, the section lists re-rendered only when the names change;
  - the 3D HUD layers (`viewportHud.js syncSideNames`, `main.js afterRebuild`);
  - the Inspektor (wanga title, edge rows, type summary, status bar), the profile editor's wanga list, the 3D length
    labels;
  - the structural check and its panel, the takeoff (railing notes), the balustrade DXF (without diacritics), the
    offer.

Tests: `geometry/__tests__/sStair.test.js`.
