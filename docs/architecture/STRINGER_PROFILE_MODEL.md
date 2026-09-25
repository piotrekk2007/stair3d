# Stringer profile model

Status: **Tier 1 implemented** (this document is the design study plus what was built from it).
Code: `src/geometry/profileCurve.js`, `stringerProfileModel.js`, `stringerProfileSolver.js`,
`stringerProfileView.js`, integrated by `stringerConstructionGeometry.js`.
Tests: `profileCurve.test.js`, `stringerProfile.test.js`, plus the untouched
`stringerConstructionGeometry.test.js`.

## 1. Why

The earlier construction geometry auto-generated the board contour with almost no control: the plan path
is always straight, the lower edge was a constant-distance offset polyline (sharp corners only), a cut
string had a stepped top and a fixed straight lower contour, a housed string had a continuous silhouette
with simplified housings, and there was no side-view profile, no corner radius, no offset parameter and
no manual layer. Professional tools (public marketing-level capabilities only — no algorithm is copied):
tread-shaped string contours with a user corner radius and distance, side-view editing of the string
shape, arc strings, CNC/DXF output. This model gives Stair3D the same *level of control* in its own terms.

## 2. Terminology (exact — code, docs and UI use these words)

| Term | Meaning |
|---|---|
| **Stringer reference path** ("plan path") | The stringer's line in plan (XY). One straight line per segment (RULES #5). A property of the plan, not of the profile. |
| **Elevation frame (u, v)** | The unfolded side view: `u` = distance travelled along the reference path, `v` = world elevation. Everything in the profile model lives here. |
| **Stringer profile** | The board's shape in that frame. |
| **Reference curve R** | The structural line depth is measured from: the polyline through the tread *front corners* (the "pitch curve"), one knot per bearing. |
| **Upper contour** | Top edge. `cut`: the notched comb derived from treads/risers — never edited. `closed`: a continuous edge above R. |
| **Lower contour L** | Bottom edge, independent of the comb. |
| **Tread support** | Where a tread rests (`StringerTreadBearing`), straight from the model. |
| **Housing** | A recess in the inner face (`closed` only). |
| **Local stringer depth** | See §3. |
| **Board thickness** | The board's dimension across the profile (`stringerThickness`, 40 mm). A different quantity. **Never call the depth "thickness".** |
| **Blank depth** | Width of the raw board needed to cut the profile. Derived, not a parameter: the smallest rectangle covering the solved contour (`minAreaRectUV`); the takeoff STOCK and the price use it. |

## 3. Local stringer depth — the mathematical definition

Let R be the depth reference (`cut`: the reference curve; `closed`: the upper contour) and L the lower contour.

> **δ(q) = min over r ∈ R of |q − r|**, for every point q on L.
> **δ_min = min over q ∈ L of δ(q)**, and the requirement is **δ_min ≥ `minimumStringerDepthMm`** (350 by default).

It is the exact minimum distance between two curves (`curveDistance` in `profileCurve.js`, closed-form for
line/line, line/arc and arc/arc) — a *geometric distance measured in the profile*, not the vertical Z
difference and not a bounding-box size. Consequences:

* Straight profile: δ = d (the parallel offset). The vertical gap is `d / cos α`, which is a different quantity.
* Arc, S-shaped and winder-transition profiles: the definition does not change (a buffer distance does not
  depend on the sign of curvature).
* The depth may be 360, 390 or 450 mm locally — never 290 when the minimum is 350.

**A fillet can violate it, exactly.** Where L turns *toward* the board (the board is convex there), rounding
with radius r removes material and the arc apex lands at `(d − r)/cos φ + r` from the reference vertex —
which is ≥ d **iff r ≤ d**. Rounding a corner that turns the other way only ever adds material, so it is
always safe. (Both facts are tested: `profileCurve.test.js`, `stringerProfile.test.js`.)

Three quantities that must never be mixed: **local depth** (this section, a geometric constraint),
**remaining section** (`STRINGER-MIN-SECTION`: timber left under a notch / behind a housing) and **blank depth**.

## 4. Algorithms considered

* **A – offset/envelope.** L = offset(R, d), miter or round joins. Depth holds by construction; edited by
  changing a parameter, not a shape.
* **B – lines + tangent arcs.** L is a few lines joined by arcs of a set radius. Natively CNC/template
  friendly, arcs stay arcs, needs explicit feasibility rules.
* **C – free control points + smoothing.** Best interaction, worst guarantees (no closed form for depth;
  a "pretty but wrong" spline is possible).

| | A | B | C |
|---|---|---|---|
| Geometric correctness | exact | good (feasibility rules) | hard to guarantee |
| Minimum-depth control | by construction | checked/clamped, closed form `r ≤ d` | non-linear optimisation |
| Manual editing | weak | good (vertex + radius) | best freedom, least predictable |
| Winders | good | good | short/steep pieces misbehave |
| Manufacturability / CNC | lines + arcs natively | lines + arcs natively | spline must be re-fitted |
| Determinism | full | full | solver-dependent |
| Complexity | low | medium | high |

**Chosen: B's representation, generated by A, edited like C — on a control polygon.**
The nominal control polygon is the reference offset by the nominal depth (A); each control point carries a
corner radius / transition style and the polygon resolves to lines + tangent arcs (B); the user moves or
inserts control points and sets radii on that polygon (C without a free spline, so no "pretty but wrong"
curve). Curvature appears only where required: radius 0 (the default) keeps straight lines; turns under
0.5° stay straight. A spline/multi-arc transition would be one more `TRANSITION_STYLES` entry (Tier 2).

## 5. The solver — `solveStringerProfile()`

Pure (no Three.js, no side effects). Input: reference knots (with stable ids), construction type, params,
overrides. Output: `referenceCurve`, `lowerCurve`, `upperCurve`, `depthReferenceCurve`, control points and
`findings` — as lines and true arcs.

1. **Nominal control polygon**: reference offset along its local normal by the nominal depth
   (`minimumStringerDepthMm + stringerProfileOffsetMm`; `closed`: the split above/below R by
   `stringerTopMarginMm`).
2. **Overrides** move/insert control points relative to the nominal polygon (§8). A move that would fold the
   polygon back on itself is rejected and reported.
3. **Radii** per control point (parameter or explicit override). First made *feasible* (tangent lengths must
   fit their edges — deterministic one-pass scaling), then in AUTO reduced at any corner where rounding
   would push the depth below the minimum (bisection against the exact curve distance). **An explicit
   radius is a design decision and is never silently reduced** — a violation is reported.
4. Each contour becomes lines + tangent arcs. Arcs are turned into chords only at the edge
   (`curveToPolyline`, chord deviation ≤ 0.1 mm) by the adapter that builds the mesh/export.

`stringerConstructionGeometry.js` is now the adapter: it decides *what the reference is* (bearings, lap-joint
grouping, riser recess, corner extension), calls the solver once per lap-joint group, slices the solved
curves per physical board (`sliceCurveByU`), builds the comb, housings and diagnostics, and keeps the
existing floor/overshoot clamps.

## 6. Cut / overlay ("wanga nakładana")

* Upper contour = the comb, derived only from final tread/riser geometry. Its only parameter is
  `stringerNotchRadiusMm` (default 0): a tool radius at each notch's *inside* corner (adds material, never
  thins the board; the tread's own front edge stays sharp).
* Lower contour is independent of the comb: generated at the nominal depth, with optional corner radius
  (`stringerCornerRadiusMm`, scope), min-depth clamping, transitions and manual overrides. It is not
  permanently one straight line.
* `STRINGER-MIN-SECTION` (timber under the notch) stays a separate check.

## 7. Housed / closed ("wanga wpuszczana")

* Continuous outer upper and lower silhouettes; depth is measured between them.
* Tread housings are separate recess features (`housings[]`, depth `housingDepthFor`, unchanged).
  Riser housings, combined housings and wedge/glue data are *not* built yet — the feature list is where they
  will go.

## 8. Manual override model — `Nominal → Override → Final`

Data, never mesh edits. Runtime: `config.manualStringerProfileOverrides`; project file: top-level
`stringerProfileOverrides` (schema **v3**, migration v2→v3 renames `stringerHeight`).

```
manualStringerProfileOverrides = {
  outer|inner: {
    mode: 'AUTO' | 'MANUAL',                 // AUTO: entries are kept but ignored
    lower|upper: { [anchorId]: { ds?, dn?, radiusMm? } },
    inserted: [{ id, contour, after, t, dn?, radiusMm? }]
  }
}
```

* **Anchors are semantic ids** (`support:step-7`, `end:top`), never indices, so an override survives a change
  of tread count. An override whose anchor is gone is **orphaned**: reported (`STRINGER-OVERRIDE-ORPHANED`),
  never silently deleted. With overrides present every tread is a control point (collinear simplification
  is skipped).
* `ds` moves along the reference, `dn` along the contour's outward normal (positive = deeper), both from the
  *nominal* position — the point follows the treads when they change.
* Geometric impossibility (folding the polygon) → rejected + `STRINGER-OVERRIDE-REJECTED`.
  A production-constraint violation (minimum depth) → **kept** and reported as ERROR `STRINGER-MIN-DEPTH`
  (it can be accepted as a waiver like any finding).
* Edit events for a future editor (`applyProfileEdit`): `moveVertex`, `setRadius`, `insertVertex`,
  `resetVertex`, `setMode`.

## 9. Winders

Each stringer has its own reference path, support mapping and profile (inner and outer profiles differ; only
the treads' elevations are shared). Segments joined by a lap joint (no post) share **one** profile, solved
across the whole group and cut per board; `CORNER_POST` joints stay independent (the post absorbs the
difference, with the existing sanity clamp). A tread never loses its support (`STRINGER-TREAD-SUPPORT`, in
every grid test). Not built: local board widening at a winder, a shaped transition piece at the newel
(documented in `docs/STRINGER_CONSTRUCTION_SPEC.md`).

## 10. Side-view model and editor (implemented)

`buildProfileViewModel()` returns, per segment, plain data to *draw*: treads and risers, upper/lower contours
(lines + arcs), the reference, the **minimum-depth envelope** (reference pushed down by the minimum), depth
samples along L, control points (id, contour, position, nominal position, tangent/normal frame, radius, kind
`anchored|overridden|inserted`), arcs and diagnostics. `offsetFromDrag()` turns a dragged position back into
`(ds, dn)`. Interaction: drag → `PROFILE_EDITS` event → new overrides → `rebuild()` → 3D updates. Round-trip
through the solver is tested.

## 11. Elevation curvature ≠ plan-path curvature

The whole profile lives in (u, v). The plan is touched only through the reference path (`pointAt(s)`,
tangent, length), which today is straight and is **not modified by any profile parameter or override**
(tested). A curved plan path (Tier 3) would change only the path, the end cuts and the takeoff (bent or
laminated board) — not the profile solver. Nothing curves the plan to solve the profile.

## 11a. Board ends (implemented)

Specified by the user: **floor** — a horizontal cut along the floor line; **post and joint with another
stringer** — a vertical cut; **top, at the landing** — a vertical cut, as if the board rests against a beam
or the floor slab.

* Every end of a board is a **plumb face**. A board's span is its segment's `[0, length]` widened to also
  cover the first/last tread seat (at a postless lap joint that seat reaches one board thickness past the
  segment end); the lower and upper contours are cut at the *same* two planes. Before this, the top ran on
  while the lower contour stopped, giving a slanted end face at lap joints. A tread seat that stops short of
  a face continues flat to it.
* **Foot**: the first board of a stringer stands on the floor. Its lower contour is cut where it meets `v = 0`
  and the contour then runs *along the floor* back to a vertical start face (previously a slanted line from
  the floor point to the top of the start face).
* `StringerSegmentConstructionGeometry.ends = { start: {u, cut}, end: {u, cut} }`, `cut` = `VERTICAL` |
  `FLOOR_HORIZONTAL`.
* Not built: a tenon/housing where a board enters a post (only the plumb face), a cut that adapts to a
  tilted beam, and a board whose lower contour never reaches the floor (it simply ends in a vertical face).

## 12. Parameters

| Config key | Default | Meaning |
|---|---|---|
| `minimumStringerDepthMm` | 350 | Minimum local depth **and** the AUTO nominal offset. Formerly `stringerHeight`. |
| `stringerProfileOffsetMm` | 0 | Extra depth over the minimum (≥ 0). |
| `stringerCornerRadiusMm` | 0 | Corner radius; 0 = sharp (previous behaviour). |
| `stringerRadiusScope` | `BOTTOM` | `BOTTOM` / `TOP` / `BOTH`. |
| `stringerTransitionStyle` | `TANGENT_ARC` | `SHARP` switches rounding off. |
| `stringerNotchRadiusMm` | 0 | Cut string: inside-corner tool radius. |
| `manualStringerProfileOverrides` | `{}` | §8. |

Diagnostics: `STRINGER-MIN-DEPTH` (ERROR), `STRINGER-FILLET-CLAMPED` (INFO), `STRINGER-OVERRIDE-ORPHANED` /
`-REJECTED` (WARNING); existing `STRINGER-MIN-SECTION`, `STRINGER-CONTOUR-SELF-INTERSECTION`,
`STRINGER-TREAD-SUPPORT` unchanged.

## 13. Tiers

* **Tier 1 (done):** contour offset, corner radius, top/bottom/both scope, minimum local depth, manual control
  points + radii, side-view data model, edit events, project file v3.
* **Tier 2:** multi-arc transitions, free-form profiles, templates (not built); **1:1 DXF export**
  (implemented — see CLAUDE.md "1:1 DXF export", `src/export/dxfExport.js`). The data was already
  export-ready (unfolded frame, real arcs), so this was serialization only, no new geometry.
  **SPLINE transition style** (implemented — see CLAUDE.md "SPLINE transition style",
  `TRANSITION_STYLES.SPLINE`, `profileCurve.js` `splineThroughPoints`): a whole contour as one
  continuous centripetal-Catmull-Rom curve instead of per-corner rounding, exactly the "one more
  entry, one more branch" this doc predicted for it.
* **Tier 3 (not built):** curved plan path, multi-floor arcs, CNC/CAM.

## 14. Migration notes

* Default output for default parameters is the previous geometry, except: the default depth is now 350 (was
  300) and a board deeper than the first tread's elevation is cut flush with the floor (the floor trim now
  drops *every* leading point below the floor, not just the boundary point).
* `sliceOffsetProfile` was removed (superseded by `sliceCurveByU` + `mergeCollinearLines`); its regression
  test moved to `profileCurve.test.js`.
* The takeoff STOCK/price for a stringer now uses the **blank** (smallest covering rectangle of the solved
  contour): unchanged for straight flights, deeper for winder boards.
* Older docs (`docs/model/STAIRCASE_DATA_MODEL.md`, the rules catalogue text) still say `stringerHeight`; the
  code and project files use `minimumStringerDepthMm`.

## 15. Known limitations

* The upper edge of a housed board after a corner post is still clamped flush to the neighbour's top end
  (`clampCrossSegmentOvershoot`); the lower edge is not (it used to be, which made a beak at the start of a
  steep board). That top clamp can shave ~1 mm off the local depth of a housed board there — `localDepthMm`
  is measured before the end clamps and does not include it.
* `localDepthMm` is measured before the end clamps, so it does not reflect them.
* The side-view editor (tab "Profil wangi") exposes the override layer; its limits are listed in CLAUDE.md
  ("Side-view editor"): no handles for control points beyond a board's end faces, and the first edit turns every
  tread into a control point.


## Kotwy na słupach i edycje przypisane do desek (etap po „deski przy słupie są niezależne")

- **Kotwa na słupie** (`post:<słup>@<deska>`): punkt krawędzi deski dokładnie na licu słupa, w który deska wchodzi —
  po jednym na koniec deski i kontur; porusza się tylko w pionie po licu słupa (`anchors[id][kontur] = {dv}`).
  Nieruszona nie zmienia deski (uchwyt na krawędzi policzonej bez niej); ruszona staje się wierzchołkiem, przez który
  liczony jest kontur (także spline). To jest „kotwienie wangi na słupie" z prośby użytkownika.
- **Edycje przypisane do desek**: każda grupa desek dostaje tylko swoje punkty; edycja pasująca do żadnej deski jest
  zgłaszana raz (INFO) i można ją usunąć jednym przyciskiem (`PROFILE_EDITS.PRUNE`).
- **Uwagi w edytorze**: jedna zwinięta linia z licznikami zamiast listy na pół ekranu.

## Punkt zamykający na grupę desek; pierwsza edycja zostaje lokalna

- **`end:top` tylko dla ostatniej grupy wangi** — pozostałe grupy desek (przy słupach każda deska to osobna grupa)
  zamykają się na `end:<id deski>`. Wcześniej jedna edycja `end:top` przesuwała koniec każdej deski naraz.
- **Wszystkie węzły stopni zawsze istnieją**; współliniowe, nieedytowane są w solverze „pasywne" (pomijane w
  rozwiązaniu tym samym testem, którym wcześniej upraszczano węzły tylko w AUTO) i pokazywane jako uchwyty na krzywej.
  AUTO bez zmian (bit w bit); pierwsza edycja nie przełącza już deski na gęstszy zestaw węzłów. Dwóch sąsiadów z każdej
  strony edycji zostaje aktywnych.
- **SPLINE po edycji** podąża za krzywą AUTO (z jej odsunięciem głębokości): nieedytowane węzły leżą na niej, kawałki
  spline'u poza zasięgiem edycji (węzły i-1..i+2 nieedytowane) są z niej kopiowane, a przy edycji tylko na zewnątrz
  (pogłębienie) kontur nie wchodzi płycej niż AUTO. Edycja do wewnątrz zostaje dokładnie i jest zgłaszana (WARNING).
  Zmiana deski daleko od pierwszej edycji: było 50,5 mm (SPLINE, L), jest 0,000 mm.
- **Strzałki w edytorze** dla dolnego konturu działały odwrotnie (↓ spłycała deskę) — poprawione.
- Ograniczenie: styk kopii AUTO z kawałkiem spline'u ma ciągłą pozycję i niewielką zmianę kierunku (do ok. 3° między
  próbkami co 15 mm).
