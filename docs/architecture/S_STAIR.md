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
  - `treadGoingAtOffsetFromInner` uses the same weights, so the legal winder width (`PL-LEGAL-C-01`, 0.4 m) is
    measured from each turn's own dusza.
- `stairwell.js`:
  - sides A / B / C, exit side C;
  - the B–C corner of the outer line is CONCAVE: `wallSegments` / `stairwellWalls` shorten the walls there instead of
    running them on (`prevSign` / `nextSign`);
  - the frame's wall C line is at x = B − gap.

## Not yet (stages 2 and 3)

- The stairwell fit / variants for S: `stairwellFit.js`, `designer/stairwellVariants.js` still treat C like a U's.
- The opening (derived, snapping), the balustrade round it, headroom: checked only lightly.
- Left / right names (wangi, balustrade sides, takeoff, Inspektor) — stage 3.

Tests: `geometry/__tests__/sStair.test.js`.
