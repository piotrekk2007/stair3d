# Starter steps (stopnie zapraszające) — `geometry/starterSteps.js`

User decisions 2026-10-20: the first 1–3 treads of flight A can be made wider, each on its own; their ends rounded
(up to a full half circle) and optionally a bowed (arched) front. They are BLOCKS standing on the floor; the wangi
start behind the last one, the start newel stands on it.

## Config

| field | meaning |
| --- | --- |
| `starterStepCount` | 0..3 — clamped to the leading straight treads of flight A (`availableStarterSteps`), and the stair must go on past them |
| `starterStep{k}OuterMm` / `InnerMm` | widening past the stair's OUTER / INNER line (the raw wanga lines `outerChain` / `innerChain` — not the housing-recessed tread edge) |
| `starterStep{k}RadiusMm` | the rounded ends: a widened side's front corner up to half the depth (a half circle), its back corner also at most the widening; a side with no widening stays square |
| `starterStep{k}BowMm` | the front's sagitta: a circular arc over the whole widened width, fading linearly to 0 at the back edge (the next step still meets a straight edge) |

UI: folder „5. Bieg i stopnie” → „Stopnie zapraszające”. New optional fields — no project file version bump.

## Pipeline

- `planLayout.js` applies `applyStarterSteps` as its LAST layer: `tread.outline` = the block outline (same orientation
  as before), `tread.starter = {index, outerMm, innerMm, radiusMm, bowMm, depthMm, widthMm, exposedMm, perimeterMm}`
  (`exposedMm` = perimeter minus the next step's width — the cladding length). The chains stay (side lengths A/B/C, the
  walkline, the stairwell fit are unchanged).
- `treadSolver.js`: a starter tread keeps the outline as it is (no nosing, no riser groove), `TreadModel.starter`
  (`blockBottom: 0`).
- `riserSolver.js`: no riser board for a starter step (the block's cladding is its front); validator
  `checkMissingRiserSurfaces` / `checkMissingStringerSupport` skip them.
- `stringerSolver.js`: the walks are built from the treads past the starter steps — every wanga starts at the first
  carried tread's front edge (the back face of the last block); the first board's foot is cut along the floor as usual.
- `postSolver.js`: `post-start` stands ON the last block (bottom = its top, `NEWEL_HEIGHT` above), its back face at the
  wangi's start on the inner wanga's axis, anchored there — the inner board butts into it (`boardEndPosts`, faceU 0).
- `railingSolver.js`: a stair section starts at the first carried tread at the earliest (at the newel).
- 3D: `treadRenderer.js renderStarterBlocks` — the body from the floor to the tread's underside in the risers'
  material (`StarterBlock_<i>`), the tread board as usual.
- Takeoff: `materialTakeoff.js buildStarterBlockItems` — per block the cladding `exposedMm × height` in the risers'
  sheet material (bent where curved; the part hidden behind a lower block counted; the block's inner structure DO
  WERYFIKACJI); the tread board as any tread.
- `starterWallDiagnostics` (added to `built.stairwell.diagnostics`, so the gate shows it): WARNING `STARTER-INTO-WALL`
  when a block reaches into a stairwell wall (fix: less widening, or a wall that starts later — `stairwellWallAExtent`).

## Limitations

- The 2D edge editor still offers the starter treads' edges; an edit there does not change their (final) outline.
- One block per step from the floor: no stepped inner structure, no separate inner frame in the takeoff.
- The ceiling-collision check reads the widened outline like any tread.

Tests: `geometry/__tests__/starterSteps.test.js`.
