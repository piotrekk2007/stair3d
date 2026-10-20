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
- The wangi and the start newel are adapted to it (user decisions 2026-10-20, below).

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
  - the plan's drag handles (below);
  - Inspektor (`inspectorPanel.js starterHTML`) — „Stopień zapraszający” checkbox, then „Poszerzenie w lewo / w prawo”,
    „Zaoblenie boku (promień)”, „Wygięcie czoła (strzałka łuku)” and „Z podstopniem”;
  - `main.js` (`data-starter-toggle`, `data-starter-field`): the first tick writes `defaultStarterSpec` (right 200,
    radius 150, the riser as the stair's).

## Wangi and the newel (user decisions 2026-10-20)

- **The starter lies ON the wanga it is widened past.** `starterGeometry` gives `widened: {inner, outer}`;
  `starterLiesOn(tread, side)` marks that wanga's bearing `starterOnTop`.
  - The wanga still runs as usual and carries the tread.
  - A HOUSED board (`stringerConstructionGeometry.js`): no tread housing and no riser housing for that tread. The
    board's contour is cut (`cutRect`) above the tread's underside, over the tread's span along the board, its nosing
    included. The tread rests on the board's top and overhangs past it.
  - `checkClosedSupportContainment` skips that bearing.
  - A cut (nakładana) board is unchanged: the tread already rests on its notch.
  - The other wanga (not widened) houses the tread as before.
- **The start newel stands on the starter step** (`starterNewelTread`): when the stair STARTS with starter treads
  widened on the dusza side, `post-start` stands on the last of them.
  - Bottom = that tread's top; `NEWEL_HEIGHT` above it.
  - On the inner wanga's axis, its back face at that tread's back edge.
  - Anchor = that back-edge point, so the inner board gets no `startPost`: under the tread it runs on to the floor,
    and above the tread it meets the newel's back face with a plumb cut, with no pocket.
  - A dusza balustrade section starts at the newel at the earliest (`fromStep ≥ that tread + 1`).
  - Widened to the outer side only: the newel stays where it is.
- Constraints: `checkRiserFollowsFinalTreadEdge` skips a starter's bent riser (it follows the bowed front, not the
  edge).
- `localShape` keeps a back corner grown by the nosing short enough not to run past the front corner's arc (a
  half-circle end with the nosing used to self-intersect — regression test).

## Plan handles (user request 2026-10-20)

- When the selected tread is a starter step, the plan draws orange squares (`plan2dRenderer.js starterHandlesXML`,
  from `starterHandles(tread)`):
  - `left` / `right` — at the widened end, mid-depth; drag across = the widening;
  - `bow` — the front's middle; drag forward / back = the bow;
  - `radius-left` / `radius-right` — where a widened end's front rounding meets the front; drag along the front = the
    radius.
- Dashed lines mark the stair lines the widening is measured from.
- They are not drawn in the opening, railing-post or client modes.
- `planInteractions.js` (`.starter-handle`, dragState `starter`) → `main.js onStarterHandleDrag` →
  `starterDragValue(tread, kind, point)`:
  - the point is read in the tread's local frame (`tread.starter.layout`), with 5 mm steps and never negative;
  - a widened end carries the nosing, so the handle stays under the pointer;
  - one undo step per drag (committed on release).

## Limitations / next

- The riser of a starter is not housed in a wanga.

Tests: `geometry/__tests__/starterSteps.test.js`.
