# Part of the stair on a concrete flight — `src/geometry/concreteStair.js`

User request 2026-11-02: a U stair with winders, wooden (on wangi) up to the turn, and from a chosen winder on a
concrete flight cast on site with wooden cladding treads on it. Decisions: the concrete is a slab with a SMOOTH soffit;
the wangi run up to the concrete (no post at the joint); no balustrade on the concrete part; the concrete is not in the
takeoff.

## Config

| field | meaning |
| --- | --- |
| `concreteEnabled` | the switch (only with `stairConstruction: 'stringers'`) |
| `concreteFromTread` | the first tread on concrete, its plan NUMBER (1-based); null = the first tread of the first turn (flight A + 1) |
| `concreteSlabThicknessMm` | the slab's thickness square to the pitch (150, ASSUMPTION) |

New optional fields — no project version bump.

## The one rule

`concreteFromIndex(config, treadCount)` → the 0-based index or null. `planLayout.js` marks those treads `onConcrete`
(and `planLayout.concreteFromIndex`); everything else reads the flag:

- `edgeOverrides.js applyHousingRecess` / `treadSolver.js nominalEdgesOf`: no housing recess — a concrete tread runs from
  line to line (and is not reported as a manual edit); `TreadModel.onConcrete`.
- `stringerSolver.js buildRawWalks`: a concrete tread breaks the walk — the wangi carry the wooden treads only. The
  model carries the stair's `lastTreadIndex`, so the board ending at the concrete is NOT treated as the board ending at
  the slab (`stringerConstructionGeometry.js endsAtSlab`): it ends with the usual plumb cut at the concrete step's front.
- `postSolver.js`: only posts whose anchor lies on a wooden tread's line (a corner post of a concrete turn and the end
  newel are not made).
- `buildStaircase.js`: the balustrade sections cut back to the wooden part (`woodOnlyRailingSections`); the opening's
  balustrade is not affected.
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
- Past the last step a block up to the raw slab's top, `max(200, ceilingThickness)` deep (the flight cast into the slab).
- `volumeM3` — information only.

## Consumers

- 3D: `concreteRenderer.js` — the layer `Concrete` in the stair root (HUD „Beton”), not selectable.
- Plan 2D: the steps' footprint grey under the treads (with the wangi layer).
- Panel: folder „1. Schody” — „Górna część na biegu betonowym”, „Beton od stopnia nr”, „Grubość płyty betonowej”.
- Inspektor summary and the offer's facts: „Bieg betonowy: od stopnia nr …”.
- Takeoff / DXF / labels: the concrete is not there; the cladding treads are ordinary treads (no housing).
