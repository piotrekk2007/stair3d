# Free walls, doors and windows — `src/geometry/walls.js`

User decisions 2026-10-28: both kinds of wall together — the stairwell's side walls stay (stairwell.js, they still fit
the stair) and any other wall is drawn freely as a polyline; a door or a window can go in ANY wall. A door gets the
headroom of the passage through it and a free strip of floor in front of it; a window is only shown. A wall is drawn
by clicking points (like the drawn ceiling opening: snapping, lengths) and has a thickness; its corners are dragged
afterwards.

## Data (config)

| field | meaning |
| --- | --- |
| `freeWalls` | `[{id, points, closed, thicknessMm, side}]` — `points` = the wall's FACE in the opening frame (`ceilingOpening.js openingFrame`: the stairwell's wall frame when it is on, else the plan bounds' min corner — so a wall stays put when a free side changes); the masonry `thicknessMm` thick on the `side` ('left' / 'right') of the drawing direction; `closed` = a loop |
| `wallOpenings` | `[{id, type 'door'/'window', segmentId, offsetMm, widthMm, heightMm, sillMm}]` — `segmentId` = `side:<stairwell wall piece id>` or `free:<wall id>:<segment index>`; `offsetMm` from the segment's start along it; a door's sill is 0 (defaults: door 900 × 2050, window 1200 × 1300 on 900) |
| `doorClearDepthMm` | the free strip checked in front of a door (1000, ASSUMPTION) |
| `freeWallThicknessMm` | the thickness a newly drawn wall gets (120, ASSUMPTION) |

New optional fields — no project version bump. Edits: `applyFreeWallEdit(freeWalls, wallOpenings, change)` (pure; add /
move-vertex / remove-vertex (≥ 2 points kept) / remove (its doors and windows go with it) / set / add-opening /
set-opening (a type change takes that type's default sizes) / remove-opening).

## Model (built in `buildStaircase` → `built.wallsModel`)

- `resolveFreeWalls` → each wall with `planPoints` and `segments` `{id, a, b, dir, outward (toward the masonry), length,
  thickness, height (the raw slab's underside, floors.js slabSoffitZ), quad}` — the quad's back line mitred with the
  neighbouring segments (a closed loop wraps round).
- `allWallSegments` → every segment a door / window can sit in (the stairwell's pieces first, then the free ones), with
  a panel `label`.
- `resolveWallOpenings` → each opening on its segment: `u0 / u1` along it, plan points `a / b` on the face, `valid`
  (its segment exists), `fits` (inside the segment's length and height).
- `wallChecks` (in the takeoff gate):
  - ERROR `WALL-COLLISION` — a tread or a post overlapping a free wall's masonry (the wangi are not checked: a board
    running along a wall is normal);
  - WARNING `WALL-OPENING-INVALID` — the wall is gone, or the opening does not fit in it;
  - at a DOOR, the strip `width × doorClearDepthMm` in front of it on the side away from the masonry, sampled every
    50 mm against the stair's parts (`stairParts`: treads flat, the wangi by their solved lower edge, the posts):
    a tread with its top ≤ 600 mm there → WARNING `DOOR-STEP-IN-FRONT` (no free floor in front of the door);
    otherwise the lowest underside there below the door's top → ERROR `DOOR-HEADROOM` (the passage under the stair).

## Consumers

- 3D (`stairwellWallsRenderer.js buildStairwellWalls(walls, wallsModel)`): every segment — side wall or free — is its
  face shape (u along it, z up) with a hole per door / window, extruded through its masonry; free segments run one
  thickness on at a joined end (the corner closes). Drawn even with the stairwell off; the same group = `built.wallsMesh`,
  so the „Ściany klatki” toggles and the client's model (the 'room' layer) take them too.
- Plan 2D (`plan2dRenderer.js freeWallsXML`): the masonry grey; a door = a gap with its leaf open 90° toward the stair and
  its swing; a window = a gap with a double line; labels with the sizes. In the „▥ Ściany” mode `freeWallEditXML` on
  top: the corner handles (drag, snapped like the opening; right-click = remove the corner) and the masonry (right-click =
  remove the wall), with the segment lengths.
- Drawing: „✏ Rysuj ścianę” (plan toolbar, also in folder 3) = the opening's draw mode as `'draw-wall'`
  (`planInteractions.js`: ≥ 2 points, Enter / double-click ends it open, a click on the first point closes it) →
  `main.js onWallDrawFinish` → the wall mode. The opening snaps to the free walls too.
- Panel folder „3. Klatka schodowa”: the free walls (thickness, side of the masonry, delete, draw), the doors and windows
  (type, wall segment, offset, width × height, a window's sill, delete, „+ Dodaj drzwi / okno”), the new wall's
  thickness and the free strip in front of a door.

Known limitation: removing a corner of a free wall renumbers its segments, so a door / window on a later segment moves
to the one before it.
