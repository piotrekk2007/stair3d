# Stairwell room (klatka jako pomieszczenie) — `src/geometry/stairwell.js`

Stage 1 of the room-first designer (user decisions 2026-10-16). The stairwell is a ROOM the stair is placed in; the
automatic layout that fits the stair to it (variant list: type, turns, winders, width, going, counts) is stage 2,
the opening derived from the stair stage 3, a polygon room / solid-open walls / walls in 3D stage 4.

## Inputs (config, all optional — `stairwellRoomEnabled: false` keeps the old behaviour)

| field | meaning |
| --- | --- |
| `stairwellRoomEnabled` | the room is on |
| `stairwellRoomWidthMm`, `stairwellRoomLengthMm` | rectangle, X × Y in the room frame |
| `stairwellEntrySide` | `S`/`N`/`W`/`E` — the side one enters through; walking starts perpendicular to it, into the room |
| `stairwellEntryOffsetMm` | the first tread's front edge (no nosing) this far inside the entry side |
| `stairwellStraightWall` | `left`/`right` — the wall a straight stair runs along (seen walking up) |
| `stairwellWallGapMm` | wall → outer face of the wanga along it (default 0: the outer line IS the wall line, as in `stairwellFit.js`) |
| `stairwellExitSide` | `S`/`N`/`W`/`E` — the edge of the ceiling opening where the upper floor is; the last back edge must lie on it |

Room frame: X across (0..width), Y along (0..length), (0,0) its lower-left corner; sides by compass S (y = 0),
N (y = length), W (x = 0), E (x = width).

## Placement

The plan keeps its own frame (flight A from the origin along +Y, outer line at x = 0; a left turn is mirrored to
x ≤ 0). `stairPlacement(config, planLayout)` is ONE rigid transform (rotation + translation, det +1):
plan +Y = the entry walking direction; plan (0, 0) — the outer end of the first front edge — on the entry line,
`stairwellWallGapMm` off the wall on the walker's left for a right turn (or a straight stair along the left wall),
on the right for a left turn; a straight stair along the right wall has its INNER line at that wall.
`toRoom` / `toPlan` convert points. Nothing in the stair geometry changes.

## Ceiling opening in the room frame

`ceilingOpening.js openingFrame(config, planLayout)`: without a room the opening's offsets / polygon are relative to
`planLayout.bounds` min (as before); with a room they are ROOM coordinates, converted by `placement.toPlan`.
`resolveOpening(config, frame)` (still accepts plain bounds) returns the plan `outline` and the CCW
`relativeOutline`; `deriveCeilingFit` exposes `openingRelativeOutline`. The opening drawn / dragged on the plan is
converted back with `toRelative` (a translation is rotated, too). "Dosuń otwór" aligns to the room's sides.

## Report — `stairwellReport` (built once in `buildStaircase` → `built.stairwell`, diagnostics in the gate)

- `STAIRWELL-OUTSIDE` (WARNING): a tread outline or a stringer line point outside the room, with the largest
  protrusion and the sides.
- `STAIRWELL-EXIT-DIRECTION` (WARNING): the entry and exit call for another stair (`required`: exit normal = entry
  direction → straight; ± the walker's right → L right/left; opposite → U, turning toward the side of the entry side's
  middle the exit edge lies on) or the stair ends walking another way; oblique exit edge → no supported stair.
- `STAIRWELL-EXIT-OFFSET` (WARNING): the last back edge's mean signed distance past the exit line (+ = under the
  upper floor, "za długie"), tolerance `STAIRWELL_TOLERANCE_MM` = 1 mm.
- `STAIRWELL-EXIT-EDGE` (WARNING): no opening edge faces the exit side (normal within 45°; of several, the farthest
  that way, then the longest — `openingExitEdge`), or the back edge runs past the exit edge's ends.

All WARNING: stage 1 only measures; the automatic layout (stage 2) is what makes them match.

## Plan 2D

`stairwellPlanDrawing(report, config)` gives the room, entry side and exit edge in the PLAN frame;
`plan2dRenderer.js stairwellXML` draws the walls (thick grey; the open entry side thin dashed with an arrow
"wejście (side)") and the exit edge (thick green, "wyjście — piętro (side)"). Layer `stairwell` ("Klatka (ściany,
wejście, wyjście)"). "Dopasuj widok" includes the room. The plan is still drawn in the STAIR frame (the stair walks
up the screen), so with an entry other than S the room appears rotated — drawing the plan in the room frame is open.
