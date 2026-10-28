# Tape measures — 3D and plan (user request 2026-10-28)

View tools only: nothing of them is in the config, the project, the undo history or any export.

## 3D — `scene/measureTool.js` (viewport HUD → „Miarka”: „📏 Miarka”, „Wyczyść”)

While on, a click in the 3D view (also in the presentation mode) is a measure point instead of a selection: the
first and the second point → a red line, two dots (kept a few px big while zooming — `sceneApi.addFrameHook`) and a
CSS2D label "1234 mm · wys. 175 · poziomo 1222". Several measures stay until „Wyczyść”. Targets: the stair, the slab
and the stairwell's walls, as shown (hidden layers are not hit).

The rule — `viewer/measure3d.js` (three.js only, shared with the client's viewer, `CLIENT_MODEL.md`):
`snapHitPoint(hit, click, toScreen)` = a corner of the face hit within 14 px on screen, else its nearest edge within
0.6 × that, else the hit point; `measureValues(a, b, toMm)` = distance, height difference (Y), horizontal distance;
`measureText`.

## Plan 2D — `plan2d/planMeasure.js` (plan toolbar → „📏 Miarka”)

While on (exclusive with the other plan modes), a click is a point (the plan still pans with the middle button /
space): `snapMeasurePoint(raw, refs, 10 px)` — the nearest of `planMeasureRefs` (every tread outline corner, the
stringer lines' points, the posts' centres, the opening's corners, the walls' ends), else whole mm. The first point
draws a dashed rubber band to the cursor; the second makes a measure: a red line with end ticks and "940 mm (Δx 900 ·
Δy 270)" (`plan2dRenderer.js measuresXML`). Right-click = every measure removed; switching the mode off removes them.
