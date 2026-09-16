# Stringer profile refactor: unfolded (u,Z) profile through every bearing

## 0. Summary

The reported symptom: on winder stairs, treads appear unsupported/"floating" relative to the
stringer, because tread widths (and therefore bearing spacing) vary sharply while riser height
stays constant. This document covers the investigation and the fix that landed.

**Important correction to the initial diagnosis.** The original bug report attributed the
symptom to `COLLINEAR_EPS`-based segmentation splitting a winder run into many small,
unrelated "boards." This was checked empirically (see §1) and is **not** what happens in this
codebase: a winder turn's raw boundary chain already produces a small, fixed number of straight
segments (one per genuine architectural corner), regardless of winder count. The real defect
was entirely inside `stringerConstructionGeometry.js`: the "pitch line" used to derive a
segment's structural top/bottom edges was fit through only the segment's **first and last**
bearing. On a uniform straight flight every bearing is collinear with that line anyway, so the
bug was invisible there. On a winder, intermediate bearings can sit 100-250mm away from that
2-point line (measured, see §1) — which is the actual mechanism behind the floating-tread
symptom. **No change to `stringerSolver.js`'s segmentation was needed or made.**

## 1. Measured evidence

For an L-turn with 5 winders (`treadsLegA:2, treadsLegB:2, windersPerTurn:5`), the turn
produces exactly 2 straight `StringerSegment`s per side, independent of winder count (verified
for 3/5/8/10 winders — always 2). Within the 6-bearing segment, comparing each bearing's real
`bearingElevation` against the old first/last 2-point pitch line:

| bearing | u (mm) | real elevation (mm) | old 2-point line value | gap |
|---|---|---|---|---|
| 3 | 0 | 1080.0 | 1080.0 | 0.0 |
| 4 | 40 | 1360.0 | 1108.1 | **251.9** |
| 5 | 510 | 1640.0 | 1438.8 | **201.2** |
| 6 | 980 | 1920.0 | 1769.4 | **150.6** |
| 7 | 1450 | 2200.0 | 2100.1 | 99.9 |
| 8 | 1720 | 2480.0 | 2290.1 | **189.9** |

## 2. The fix — an unfolded profile through every bearing

`buildPitchKnots()` (`stringerConstructionGeometry.js`) builds one knot per bearing at its own
FRONT corner `(uStart, bearingElevation)`, plus one closing knot at the last bearing's own back
corner (`uEnd`), with its elevation **extrapolated** from the local slope of the last two real
knots rather than taken flat — using the flat elevation there would introduce an artificial
kink at the very last tread even on a perfectly uniform flight (this was verified directly: it
breaks collinearity and was caught by this file's own straight-flight tests during development).

Each bearing's own front corner and every internal tread boundary is a genuine knot — never
skipped, never averaged. `simplifyCollinear()` (`src/geometry/polylineProfile.js`) then removes
runs of collinear knots, so a uniform straight flight collapses back down to exactly 2 points
(bit-for-bit the old straight-flight output — proven by the existing test suite, unchanged for
that case) while a winder keeps every real kink.

## 3. Structural edges as LOCAL-NORMAL offsets, not vertical shifts

The old code built a 'closed' board's top/bottom edges (and a 'cut' board's bottom edge) as a
**vertical** (world-elevation) shift of the pitch line: `v - boardWidth`. This is only correct
when the pitch line is horizontal. `offsetPolylineByNormal()` instead offsets every segment of
the knot profile along **its own local normal** (`(dv,-du)/len` for "down", `(-dv,du)/len` for
"up" — since u is monotonically increasing along a board by construction, this sign convention
is unambiguous), then joins adjacent offset segments with a plain miter (their two infinite
lines' intersection). This is the standard, numerically simple way to offset a polyline
without introducing curvature the input didn't have.

For a single straight segment (2 knots) this is exactly a perpendicular parallel-line offset —
proven exact in `src/geometry/__tests__/polylineProfile.test.js`. For a genuinely kinked
profile, offsetting at a real kink correctly produces either a slightly extended or slightly
thinned region there — a real, physical consequence of a board changing direction, not an
artifact (see §5).

## 4. Minimum remaining section, measured perpendicular

`computeMinRemainingSectionCut()` now measures the PERPENDICULAR distance
(`distancePointToPolyline`) from every bearing corner to the solved bottom edge, instead of a
raw vertical gap. This matters even on a straight flight: a raw vertical gap overstates the
true remaining timber section by a factor of `1/cos(θ)` wherever the board is raked (θ = pitch
angle). See §5 for the closed-form consequence on a uniform flight.

## 5. A genuine, closed-form result: the notch "throat" thickness

For a **uniform** straight, 'cut' (overlay/notched) flight, every bearing's front corner sits
exactly `boardWidth` from the offset bottom line (by construction — offsetting a knot's own
line by a perpendicular distance places every point on that line exactly that far away). Every
bearing's **back** corner, however, sits at the SAME u as the next tread's front corner but at
the CURRENT tread's own (lower) flat elevation — i.e. exactly `riserHeight` below where the
smooth pitch line would put it at that u. Projected perpendicular to the pitch line, this is a
**smaller** remaining thickness than the front corner's, with a closed form:

```
throat = boardWidth − riserHeight · treadGoing / √(treadGoing² + riserHeight²)
```

This is the notch's real "throat" thickness — a well-known concern in cut-string design (the
material is thinnest at the inside corner of the notch, not at the nosing). The old code
reported a value that had nothing to do with this real quantity (it depended on the wrong
2-point slope); the new code reports this exact closed form, locked in by a dedicated
regression test (`stringerConstructionGeometry.test.js`, "reports the real notch-throat
thickness ... closed form, not a pitch-line artifact").

## 6. Stock length: arc length, not u-extent, not the offset contour's bounding box

`src/takeoff/materialTakeoff.js`'s stringer STOCK length used to come from the bounding box of
`geo.outerContour`. Two consequences of this refactor broke that:

1. The contour's top/bottom edges are now genuine perpendicular offsets, which shift a knot's
   `u` slightly as well as its `v` — the contour is a sheared quadrilateral, so its
   axis-aligned bounding box overstates true board length.
2. Even the pitch profile's own `u`-extent alone is **not** the true board length: `u` is the
   horizontal plan distance and `v` is world elevation — a raked board's real length is the
   hypotenuse of both, `profileLength()` (`src/geometry/polylineProfile.js`), not the
   u-projection. (This was a latent inaccuracy in the pre-refactor takeoff too, just masked by
   `boundingRectUV` happening to read a value close enough for typical shallow board contours;
   it became numerically obvious once the perpendicular-offset fix was in place.)

Stock length is now `profileLength(geo.pitchProfile)` — the true 3D-rake length of the board.

## 7. Method comparison (per the request's §15) and why local-normal offsetting was chosen

Three approaches were considered for solving the structural edges from the bearing profile:

- **A. Local normal envelope (chosen).** Offset each segment along its own normal, miter-join
  the results. Exact for straight flights (bit-identical to the old output), correct and
  numerically stable for the shallow, small-angle kinks that occur in practice (winder tread
  boundaries turn by at most a few tens of degrees relative to each other), trivial to reason
  about and test in isolation (`polylineProfile.test.js`), and requires no new dependency.
- **B. Constrained smooth curve / spline.** Rejected: a real stringer's structural envelope is
  not smooth even in the ideal case (a 'cut' board's top is a comb; a 'closed' board's top/
  bottom must remain straight-line-per-segment to stay manufacturable with a plain saw or
  router pass) — fitting a spline would add curvature the physical board never has, which
  §8/§9 of the request explicitly forbid ("do not force curvature where a straight solution is
  sufficient").
- **C. Piecewise structural profile with controlled transitions.** This is effectively what
  local-normal offsetting already produces (a piecewise-linear result with an explicit knot at
  every real transition) — A and C converge once curvature is ruled out; A was implemented
  because it is the more general and simpler formulation (no separate transition-detection
  logic is needed — every bearing already IS a transition point).

A mitered join can, in principle, self-intersect at a very sharp concave kink with a large
offset distance relative to the local radius of curvature (a known limitation of naive polyline
offsetting). This is not observed for any realistic winder configuration in this project's test
suite (bearing-to-bearing direction changes stay well within a few tens of degrees for the
`windersPerTurn` range this project supports), and the existing self-intersection diagnostic
(`STRINGER-CONTOUR-SELF-INTERSECTION`) already catches the resulting contour if it ever did
occur, so no failure mode here is silent.

## 8. New diagnostic: `STRINGER-TREAD-SUPPORT`

Two new ERROR-level checks (never previously present) verify a tread is not "silently floating":

- **'cut'**: `checkCutSupportFailure` — if a bearing corner's perpendicular distance to the
  bottom edge is `<= 0` (the corner has crossed through or sits exactly on the bottom edge),
  that specific tread is reported by index, in addition to the aggregate WARNING-level
  `STRINGER-MIN-SECTION`.
- **'closed'**: `checkClosedSupportContainment` — verifies each bearing's own elevation, at its
  own u-position, is contained within the solved `[bottom, top]` envelope (evaluated via
  `valueAtU`). This is precisely the check that would have caught the original bug on a closed
  stringer: on the un-fixed 2-point pitch line, an intermediate winder bearing's true elevation
  could fall entirely outside the naive (first/last-bearing-only) envelope.

## 9. Debug data (not a UI)

Each `StringerSegmentConstructionGeometry` now also carries `pitchProfile` (the solved knot
chain), `topProfile` (closed construction only), and `bottomProfile` — everything a future
debug view needs to show exactly why a contour has its shape, without recomputing anything.
`stringerRenderer.js` does not read these fields (it only reads `outerContour`/`cleats`/
`housings`, unchanged) — adding them is purely additive. Wiring an actual debug panel (in the
style of `src/scene/debugOverlay.js`) is a natural next step but out of scope for this stage.

## 10. What did NOT change

- `stringerSolver.js` — untouched. Segmentation, bearing projection onto each segment's
  straight `referenceLine`, and all of `StringerModel`'s shape are exactly as before.
- `stringerRenderer.js` — untouched. It still only extrudes whatever
  `stringerConstructionGeometry.js` hands it; no curvature or geometry is added at render time.
- The 'cut' construction's TOP edge (the notched comb) — it already used every bearing's own
  position and needed no change.

## 11. Tests

`src/geometry/__tests__/polylineProfile.test.js` — the generic 2D primitives in isolation
(collinearity simplification, exact perpendicular offset, distance-to-polyline, extrapolated
interpolation).

`src/geometry/__tests__/stringerConstructionGeometry.test.js` — updated for the corrected
semantics (perpendicular offset instead of vertical shift, housing containment via `valueAtU`
instead of a raw u-range check, the closed-form notch-throat regression) plus two new tests
proving the reported bug is fixed: every winder bearing is contained in its board's envelope
(no `STRINGER-TREAD-SUPPORT` errors on a realistic winder config), and the pitch profile passes
through every real bearing position (perpendicular distance ~0), not just the first and last.

## 12. Addendum — a second, more visible bug found by inspecting the actual 3D render

The fix above (§1-§9) was verified with unit and geometry tests, but a visual check of the
actual running app (a 'cut' L-winder, screenshot comparison against a hand-drawn expected
shape) still showed the board disconnecting from the treads at the turn — worse than the
original symptom in some views. Root cause: each `StringerSegment` was still solved in total
isolation. Two segments joined by a `LAP_JOINT` (board ends butted directly together, no post —
see `stringerModel.js`'s `CONNECTION_TYPES`) each fit their pitch profile from ONLY their own
bearings (§2's fix, correctly applied — but only *within* one segment). Their independently
offset bottom (and, for a closed board, top) edges generally do **not** land on the same
elevation at the shared corner point, even though each segment's own contour is perfectly valid
alone. Measured on a real L-winder: the outer stringer (which, per `stringerSolver.js`'s own
comment, is **always** a lap joint — a corner post only ever interrupts the inner stringer) had
a **54mm** jump in its bottom edge's elevation exactly at the turn. This is precisely what a
render of the board "hanging in the air" at a corner looks like.

**Fix**: `groupSegmentsByLapJoint()` groups consecutive segments that share a `LAP_JOINT` (never
a `CORNER_POST` — a post genuinely interrupts the run, and forcing continuity there is neither
necessary nor how a real post-jointed corner is built) and solves ONE pitch profile across the
whole group, using each segment's own `referenceLine.length` as a cumulative offset — an
"unfold" of the group's own physically-joined reference lines into one continuous
distance-traveled parameter. The group's offset top/bottom edges are then sliced back into each
segment's own local `(u,v)` via `sliceOffsetProfile()`/`slicePolylineByU()` — so a segment's
own contour, diagnostics, and debug data look exactly as before, except that adjacent lap-joint
segments' edges now provably meet (locked in by
`stringerConstructionGeometry.test.js`'s "joint bug fix" tests: outer stringer gap is now
`0.000mm`, `CORNER_POST` joints are explicitly left independent).

**A further numerical bug surfaced by this fix**: slicing a profile whose own first knot had
been shifted forward (e.g. by a riser-recess offset on the very first bearing) exposed two bugs
in `polylineProfile.js`:
1. `lineLineIntersect`'s parallel-line test used an **absolute** threshold on the raw cross
   product. Two segments that are collinear only up to floating-point noise (sin(angle) ~1e-16)
   still produce a cross product far above a tiny absolute epsilon when their own coordinates
   are ~10³ in magnitude — so the "intersection" was computed anyway, landing a mitered offset
   point thousands of mm away. Fixed by normalizing the test to a dimensionless
   sin(angle-between-segments), matching `tolerances.js`'s own `INTERSECTION_EPS` convention.
2. `slicePolylineByU`/`sliceOffsetProfile` treated a reference polyline's own first/last point
   as a candidate "interior" knot whenever the requested slice range extended past it (a
   riser-recess-shifted first bearing does exactly this). That endpoint is not a real kink —
   after offsetting it can land at a `u` that isn't even ordered relative to the boundary point
   just computed, producing a non-monotonic, self-crossing contour. Fixed by excluding a
   reference polyline's own index 0 and length-1 from ever being treated as interior.

Both are locked in by dedicated regression tests in `polylineProfile.test.js`.

All 251 project tests pass; `npx vite build` succeeds; the fix was additionally confirmed by
loading the actual dev server and comparing the rendered 'cut' L-winder stringer against the
expected shape.

## 13. Addendum 2 — the notch's riser face must be a plumb VERTICAL cut, never diagonal

A further visual check (with riser boards enabled) found the comb's rising edges drawn as
diagonal lines instead of plumb vertical cuts — screenshot comparison showed the "riser face"
of each notch sloping across the full width of a riser-board recess instead of stepping
straight down.

Root cause: `buildOverlayTop()` builds two points per bearing — its own flat front and back
corner, both at the tread's own (flat) elevation — and the polygon's edge from one bearing's
back corner straight to the next bearing's front corner is what actually forms the "riser
face." With riser boards enabled, `effectiveBearings()` shifts every tread's OWN front corner
forward by `riserRecess` (room for the riser board's thickness), so a bearing's raw back corner
and the next bearing's shifted front corner no longer share the same `u` — the connecting edge
then spans both that horizontal gap and the full riser height in one diagonal stroke.

Fix: when a gap exists, `buildOverlayTop()` now inserts an explicit ledge point at the CURRENT
tread's own elevation across the gap (the physical shoulder the riser board's edge sits
against), so the polygon reads as an L — a short flat ledge, then a true vertical rise at the
next tread's own front corner — rather than one diagonal line. Verified: every rising edge in
the profile now has zero horizontal travel (locked in by a dedicated regression test), checked
against the exact config the live app uses.
