# Part of the stair on a concrete flight — `src/geometry/concreteStair.js`

User request 2026-11-02: a U stair with winders, wooden (on wangi) up to the turn, and from a chosen winder on a
concrete flight cast on site with wooden cladding treads on it. Decisions: the concrete is a slab with a SMOOTH soffit;
the wangi run up to the concrete (no post at the joint); no balustrade on the concrete part; the concrete is not in the
takeoff.

## Config

| field | meaning |
| --- | --- |
| `concreteEnabled` | the switch (only with `stairConstruction: 'stringers'`) |
| `concretePart` | `upper` (from `concreteFromTread` to the exit) or `lower` (from the floor to `concreteToTread`, wood above — user request 2026-11-02) |
| `concreteFromTread` | the first tread on concrete, its plan NUMBER (1-based); null = the first tread of the first turn (flight A + 1) |
| `concreteToTread` | the lower part's last tread (1-based); null = the last tread of flight A |
| `concreteSlabThicknessMm` | the slab's thickness square to the pitch (150, ASSUMPTION) |
| `concreteWallSide` | a wall under the flight: `none` / `inner` / `outer` / `both` (user request 2026-11-02 — a stairwell wall runs up to the slab, this one only to the stair) |
| `concreteWallThicknessMm` | its thickness (null = `freeWallThicknessMm`) |
| `concreteWallAbove` | that wall stands ABOVE the flight too (cast between walls): the treads / risers on the concrete end at its face (user request 2026-11-02); never above a landing (it closed the way onto it — the landing is not cut back, the wall stands only under it) |
| `concreteWallAboveHeightMm` | its height above the nose line, parallel to the flight up to the exit (a low wall, past the floor's level like a balustrade); 0 = up to the floor above |
| `concreteWallHandrail` | a handrail lying on that low wall (default on; only with a height) |

New optional fields — no project version bump.

## The one rule

`concreteRange(config, treadCount)` → `{from, to}` (0-based, inclusive) or null. `planLayout.js` marks those treads
`onConcrete` (and `planLayout.concreteRange`, `concreteFromIndex`); everything else reads the flag:

- `edgeOverrides.js applyHousingRecess` / `treadSolver.js nominalEdgesOf`: no housing recess — a concrete tread runs from
  line to line, or to the face of a wall standing above the flight (`concreteTreadRecessMm`: the wall's thickness on
  that side, the same recess rule as a housed wanga, so not reported as a manual edit; risers follow the final front
  edge); `TreadModel.onConcrete`.
- A LOWER part: the wooden flight's wangi stand on its last step — `stringerSolver.js footZ` = that tread's top, the
  first board's foot cut level there and nothing of any board below it (`stringerConstructionGeometry.js`; the short
  piece before a corner post too). No start newel on the floor (it is not on a wooden line).
- `stringerSolver.js buildRawWalks`: a concrete tread breaks the walk — the wangi carry the wooden treads only. The
  model carries the stair's `lastTreadIndex`, so the board ending at the concrete is NOT treated as the board ending at
  the slab (`stringerConstructionGeometry.js endsAtSlab`): it ends with the usual plumb cut at the concrete step's front.
  A walk ending at the dusza's turning point of a 180° zone (its chain repeats that point) gives no zero-length board
  (`splitWalkIntoRuns` — user report 2026-11-02: the empty board broke the profile editor for the inner wanga).
- `postSolver.js`: only posts whose anchor lies on a wooden tread's line (a corner post of a concrete turn and the end
  newel are not made).
- `buildStaircase.js`: the balustrade sections cut to the wooden part(s) (`woodOnlyRailingSections` — a section across a
  concrete part in the middle splits in two); the opening's balustrade is not affected.
- Checks: `VALIDATOR-MISSING-SURFACE` skips concrete treads; `CONSTRAINT-TOPOLOGY-CONTINUITY` accepts the wood / concrete
  boundary when both edges lie on one line (the wooden one is shorter by the recess); the structural check skips
  concrete treads (they lie on the concrete over their whole area).

## The concrete model (`buildConcreteModel` → `built.concrete`)

`{fromIndex, fromTreadNo, slabThicknessMm, blocks: [{treadIndex, outline, topZ, bottomZ[]}], volumeM3}`:

- One block per concrete step: top = its tread's underside; in plan from the step's riser back face (front edge moved
  back by the riser board's thickness when the stair has risers) to the next one's (the last step: to the back edge —
  the top riser stands behind it). The strip of the next tread up to its riser's back face is a second piece.
- The soffit: on the line where step i begins, step i−1's top less the slab's plumb thickness (`slab / cos(pitch)`); on
  the line where it ends, step i's top less it; between them by the distance to each line (a winder's soffit twists with
  it); never below the floor (a flight starting low is solid down to the floor).
- Blocks and walls stand on each tread's footprint from line to line (its chains — `fullFootprint`), whatever the tread
  itself is cut back to.
- Past the last step (an upper part only), only where the ceiling opening runs on beyond it: a piece at the floor (top = the raw slab's top)
  up to the slab's edge (a ray from the back edge's middle to the opening's outline), its soffit rising to the slab's.
  None when the slab starts right behind the last step — it used to be a fixed 250 mm block whose soffit hung 190 mm
  below the slab like a third step (user report 2026-11-02).
- Walls (`walls`): along the chosen side's chain line of every concrete tread, the wall's thickness into the stair
  (the tread's outline clipped by a band per chain segment), from the floor up to the soffit (one height per outline
  point; with `concreteWallAbove` up to the raw slab's top); a piece with no height (a step down at the floor) is dropped. Wherever its line breaks off — where the concrete begins, and at a concrete
  landing with no line on that side (a U's big landing: the wall runs on under it, user report 2026-11-02) — the wall is
  CARRIED ON along its line (the first concrete tread's chain, backwards) to the nearest wall across it
  (`wallSegments` = walls.js allWallSegments: the stairwell's and the drawn ones; within 20 m), under every concrete
  step that strip passes, up to that step's soffit (`toWall: true`; user report 2026-11-02 — under the first concrete
  winder of a 180° zone the wall stopped short and the step hung over open space). Counted in `volumeM3`.
- `volumeM3` — information only.

## Consumers

- 3D: `concreteRenderer.js` — the layer `Concrete` in the stair root (HUD „Beton”), not selectable; the walls in it,
  solid, wall colour.
- Plan 2D: the walls dashed, darker, over the concrete footprint.
- Plan 2D: the steps' footprint grey under the treads (with the wangi layer).
- Panel: folder „1. Schody” — „Górna część na biegu betonowym”, „Beton od stopnia nr”, „Grubość płyty betonowej”,
  „Ściana przy biegu betonowym” (+ „Grubość ściany”), „Ściana także nad biegiem (stopnie do ściany)” — always offered with
  the concrete part; ticked with no side chosen it puts the wall on the outer side.
- Inspektor summary and the offer's facts: „Bieg betonowy: od stopnia nr …”.
- Takeoff / DXF / labels: the concrete is not there; the cladding treads are ordinary treads (no housing).

## Handrail on the low wall (user request 2026-11-02)

`capRails` (`buildConcreteModel`): per side, along the low wall's middle (the chain line moved half the wall's thickness
into the stair), its points at the wall's top (nose line + height); broken where there is no low wall (a landing, a
tread off the concrete); collinear points dropped (`straightPieces`) — one piece per straight stretch, the section of the
balustrade's handrail (`railingHandrail*`). Read by `concreteRenderer.js renderConcreteCapRails` (a box per piece, the
railing material, the root's `Railing` layer), the plan (a brown line) and the takeoff (`railingItems.js
buildWallCapRailItems`: a HANDRAIL item per piece, `railing-handrail`, priced per metre — part codes PR).
