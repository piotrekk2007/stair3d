# Starter steps (stopnie zapraszające) — `geometry/starterSteps.js`

User decisions 2026-10-20, second version. The first version — the first 1–3 treads as BLOCKS on the floor, the
wangi starting behind them, the newel on the last block — was withdrawn by the user the same day: "not good, it's a
block construction". Now:

- ANY ordinary straight tread can be marked as a starter step in the Inspektor of that tread (select it on the
  plan 2D).
- Its parameters:
  - `leftMm` / `rightMm` — the widening to the LEFT / RIGHT as seen walking up, measured from the stair's line on that
    side (the raw wanga line);
  - `radiusMm` — the widened end rounded, up to a half circle of the depth; the back corner at most the widening;
  - `bowMm` — the front bowed: a circular arc of this sagitta over the whole width, fading to 0 at the back edge;
  - `riser` — its own riser board or none, independent of the stair's `hasRiserBoards`.
- The wangi and the posts are NOT adapted yet. A widened tread runs through the wanga on that side; the next step is
  redesigning the wanga's run round such a tread.

## Config

`config.manualStarterTreads = { [treadIndex]: { leftMm, rightMm, radiusMm, bowMm, riser } }` (`sanitizeStarterTreads`).
A new optional field, so no version bump. The first version's `starterStepCount` / `starterStep{k}*` are ignored.

## Pipeline

- `planLayout.js` applies `applyStarterSteps` as its LAST layer to every marked tread that `canBeStarter`.
  - `tread.outline` = the starter shape WITH its nosing: the front moved forward by `nosing`, and a widened end grown
    by it too, while its back corner arc still ends on the back edge.
  - `tread.starter = {…spec, riserPath, depthMm, widthMm}`.
  - Shape (`starterGeometry`): local u LEFT → RIGHT walking up, v from the front edge back. A widened side starts from
    the stair line; a side not widened keeps the tread's own end (the housing recess).
  - `riserPath` = the riser's face line: along the front, wrapping a widened end to the back edge. On a side not
    widened it starts at the front corner.
- `treadSolver.js`: a starter keeps that outline — no nosing added, no riser groove; `TreadModel.starter`.
- `riserSolver.js`:
  - `buildRiserModels`: a starter tread gets `buildStarterRiserModel` when `riser` is on, never the ordinary riser.
    Every other tread gets the ordinary riser only with `hasRiserBoards`, and so does the top riser.
  - The starter riser is one flat panel per piece of `riserPath` (a bent board, like a winder's fan), each thick
    toward the tread's inside. Its top is at the tread's underside, with no groove overlap. It carries `starter: true`
    and `lengthMm`.
- Every consumer takes `riserModels` as they come, no longer gated on `hasRiserBoards`: `buildStaircase` (joints,
  render, return) and `materialTakeoff.js buildRiserItems`. A starter riser's takeoff note says „GIĘTY”, with its
  unrolled length.
- Validator:
  - `checkMissingRiserSurfaces` skips starter treads (they have their own riser choice);
  - `checkRiserNormalOrientation` skips starter risers (each panel faces its own way).
- `starterWallDiagnostics`, added to `built.stairwell.diagnostics`: WARNING `STARTER-INTO-WALL` when the tread
  reaches into a stairwell wall.
- UI:
  - Inspektor (`inspectorPanel.js starterHTML`) — „Stopień zapraszający” checkbox, then „Poszerzenie w lewo / w prawo”,
    „Zaoblenie boku (promień)”, „Wygięcie czoła (strzałka łuku)” and „Z podstopniem”;
  - `main.js` (`data-starter-toggle`, `data-starter-field`): the first tick writes `defaultStarterSpec` (right 200,
    radius 150, the riser as the stair's).

## Limitations / next

- The wangi (housings, the board's run), the start newel and a balustrade on a starter step are not adapted yet.
- No drag handles on the plan yet: the shape is edited by numbers in the Inspektor.
- The riser of a starter is not housed in a wanga.

Tests: `geometry/__tests__/starterSteps.test.js`.
