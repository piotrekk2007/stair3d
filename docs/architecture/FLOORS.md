# Floors: raw and finished — `src/geometry/floors.js`

User decisions 2026-10-28: the height is entered as measured on site, between the RAW slabs, with the floor finish at
the bottom and at the top; the stair stands on the FINISHED bottom floor; the opening trim's board defaults to the
top finish.

| config | meaning |
| --- | --- |
| `rawStoreyHeightMm` | the height between the raw slabs (null = an older project: `totalRise` is given directly) |
| `floorFinishBottomMm` | the floor finish at the bottom (the stair stands on it: z = 0 of every model) |
| `floorFinishTopMm` | the floor finish at the top (on the upper raw slab) |
| `totalRise` | the stair's rise between the finished floors = raw − bottom + top — AUTO when the raw height is given (`floorDrivenFields`; `buildStaircase` → `withFloorRise`, `rebuild()` copies it back) |
| `ceilingThickness` | the RAW slab's thickness |

Derived (the one place): `rawSlabTopZ` = `totalRise` − top finish (the upper slab's raw top — the trim's board lies on
it), `slabSoffitZ` = that − `ceilingThickness` (the soffit: `deriveCeilingFit.soffitZ`, `requiredOpeningRelative`'s
headroom line, `headroomModel`, the stairwell walls' height).

Consumers:
- the 3D slab (`ceilingGeometry.js buildCeiling`): the raw slab from the soffit up to its raw top, plus the top
  finish as its own lighter layer (`CeilingFloorFinish`) up to the finished floor;
- the opening trim (`openingTrimModel.js`): its board lies on the raw slab, its thickness by default the top finish
  (else 15 mm; `openingTrimBoardThicknessMm` given by hand is kept) — so its top is flush with the finished floor;
- everything standing on the upper floor (the opening's balustrade, an end newel on the slab, the wanga's top end cut
  level) keeps the finished floor (`totalRise`).

Panel „2. Budynek”: „Wys. kondygnacji SUROWA” (a project without a raw height shows the one matching its rise;
editing it switches over), „Posadzka na dole / na górze”, „Wys. schodów (podłoga–podłoga gotowa)” (AUTO, disabled),
„Grubość stropu (surowego)”. The info panel shows both heights.
