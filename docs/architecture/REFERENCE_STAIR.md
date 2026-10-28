# The stair on the next floor — `src/geometry/referenceStair.js`

User decisions 2026-10-28: a stair through two floors is two projects; the other floor's stair is LOADED FROM ITS OWN
FILE as a reference (shown and checked, edited / priced in its own file); a switch swaps which one is edited.

## Data

`config.referenceStair` (null = none; a new optional field, no project version bump — the reference's whole file is
saved inside this project's config, so undo and the project file carry it):

| field | meaning |
| --- | --- |
| `name` | the other project's name |
| `level` | `'above'` (it starts on this stair's upper floor) / `'below'` (it ends on this stair's floor) |
| `file` | the other project's file as saved (`buildProjectPayload`; read back by `parseProjectFile` — migrated like any file) |
| `dxMm`, `dyMm`, `rotationDeg` (0 / 90 / 180 / 270), `mirror` | the placement: its plan point p → R(rotation)·M(mirror)·p + (dx, dy) in this stair's plan frame; (0, 0) = the start of its first tread |

Heights: + this stair's rise (above) or − its own rise (below) — `referenceTransform`.

## Model (`buildReferenceModel(own, buildStaircase)` → `built.reference`)

- The other stair built by the same `buildStaircase` (its own reference stripped) — every rebuild (≈ 10 ms); a file that
  cannot be built → WARNING `REFERENCE-STAIR-INVALID`, never a crash.
- The check, in the UPPER stair's frame (its parts' heights along their boards are read there — `walls.js stairParts`:
  treads, wangi by their solved lower edge, posts): every LOWER tread sampled on a 50 mm grid INSIDE the lower stair's
  ceiling opening (elsewhere the slab is lower than anything of the upper stair, and the ceiling check covers it); the
  clearance from the tread's top up to the upper stair's underside above it; the tightest spot per tread
  (`clearances`), below the lower stair's `minHeadroom` → ERROR `REFERENCE-STAIR-HEADROOM` (in the takeoff gate) — on
  this project's own element: the lower tread (this stair is the lower one) or the upper stair's part that is too low.
- `planDrawing` (its treads, wangi, posts in this plan frame), `markers` (the clashes: from the lower tread up to the
  upper underside, in this stair's frame and heights).

## Consumers

- 3D (`referenceStairRenderer.js`): the other stair's own root placed (mirror → rotation about the vertical → shift,
  height offset) + a red line per clash — its own scene object (`built.referenceMesh`), never picked / highlighted /
  exported with this project; hidden in the offer's picture; the tape measure snaps to it.
- Plan (`plan2dRenderer.js referenceXML`, layer „Bieg na sąsiednim piętrze”): its treads / wangi / posts dashed (above —
  purple, below — teal), the clashes as red dots, its name.
- Panel „2. Budynek → Bieg na sąsiednim piętrze (z pliku)”: load above / below, the placement, „⇅ Zamień — edytuj tamten
  bieg” (`main.js swapReferenceStair`: this project becomes the reference of the other one — `inverseReference`: without a
  mirror θ' = −θ, d' = −R(−θ)·d; with one θ' = θ, d' = −R(θ)·M·d — and the other file becomes the project being edited;
  each is saved in its own file), remove, and the tightest clearance found.
