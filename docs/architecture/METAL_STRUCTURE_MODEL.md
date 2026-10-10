# Metal structure (konstrukcja metalowa)

Parameter **"Konstrukcja schodów"** (`config.stairConstruction`): `stringers` | `cantilever` | **`metal-profile`** |
**`metal-flat`**. GUI folder "Konstrukcja: wspornikowa / metalowa".

## User decisions (2026-10-10)

- **Wanga na profilu** (`metal-profile`): both variants selectable — **one central beam** or **two beams** under the
  treads (`metalBeamCount` 1 | 2; two beams have their axes `metalBeamSetbackMm` from the tread's sides).
- Beam shape: a **straight beam + supports** — a closed steel profile, straight per plan run, with a support welded
  under every tread (a horizontal plate under the tread + a web down to the beam).
- **Wanga na płaskowniku** (`metal-flat`): **two flat bars at the sides, cut in teeth** — a zig-zag top and the same
  zig-zag below; the treads lie on the teeth.

Everything else is a placeholder — DO WERYFIKACJI (`CO-MFG-J-METAL`): beam 200 × 100 × 5, support plate 8 × 300 mm,
flat bar 12 mm, neck 120 mm, setbacks 150 / 30 mm, support-height warning 400 mm. **The steel is not structurally
checked** (sections, welds, fixing to the floor and the slab, tread fixings); the model always reports the INFO
`METAL-UNVERIFIED`.

## What a metal stair is for the rest of the program

`metalConfig()` (applied in `buildStaircase.js`, like `cantileverConfig()`): no risers, both sides treated as overlay
sides (`cut`) — treads are not recessed and balusters stand on the treads. `buildStaircase` builds no wooden wangi
(`absent: true` models), no structural posts and so no joints; balustrade posts are still built by the railing solver.
The result carries `metalStructure` (null for other constructions).

## Model — `src/geometry/metalStructureModel.js` (pure)

- **Plan line** (`planLineAt`): the outer and inner lines of the stair are parallel, so the line `d` mm from one of
  them is the point-by-point blend of `outerFullPath` / `innerFullPath` (`d / stairWidth`). One straight **piece** per
  plan run.
- **Tread stretches** (`treadStretches`): the line is cut where each tread's FINAL front edge (and the last back
  edge) crosses it; tread *i* owns the stretch between cut *i* and *i + 1*, split at plan corners. Each stretch knows
  its tread's underside elevation and how skew its edges are to the piece.
- **Beam row** (`buildBeamRow`): unknowns = the beam top's height at each end of each piece (continuous at plan
  corners). Constraint: the top stays below every tread's support plate (underside − plate thickness −
  `metalSupportClearanceMm`) over the tread's stretch, widened by what a skew winder edge adds across the beam's
  width. Goal: the highest such beam (maximum total height under the treads' middles). It is a small linear program
  solved exactly by vertex enumeration (`maximizeLinear`; only the lower convex hull of each piece's points is used, a
  "never downhill" guard is added only when needed). On a straight flight the beam touches every plate at its back; in
  winders it stays straight and the supports grow (`METAL-SUPPORT-HEIGHT` WARNING above `metalSupportMaxHeightMm`).
  Ends: the foot is cut along the floor, the top end plumb at the last back edge; at a plan corner each beam runs half
  a beam width past the corner so the two fill it (a mitre weld in reality).
- **Supports**: per tread stretch a plate (`supportPlateThicknessMm` × `supportPlateWidthMm`, 20 mm inside the
  stretch) and a web from the beam's top to the plate, as wide as the beam. A stretch shorter than 40 mm gets no
  support on that piece; a tread left without a support on some row → `METAL-SUPPORT-MISSING` WARNING.
- **Flat bar row** (`buildFlatRow`, `toothedPlateOutline`): top = level under each tread, plumb at each next front
  edge; bottom = the SAME line moved square to the piece's pitch, by the shift that leaves exactly `metalFlatNeckMm`
  of steel at the narrowest place (bisection on the exact distance between the two lines). Ends plumb; on the first
  piece the front edge runs plumb from the first tread to the floor and the foot is cut along the floor. The bar's
  centre line is `metalFlatSetbackMm + thickness / 2` from the stair's side.
- **Members** — the only output shape: `{id, kind: beam | support-plate | support-web | plate, rowId, side: outer |
  inner | centre, pieceIndex, origin, dir, normal, outline [{u, v}], nFrom, nTo, bounds, areaMm2, massKg, …}` — a
  side outline (u along the piece, v = elevation) extruded across the piece. `rows`, `params`, `totalMassKg`,
  `diagnostics` (`METAL-LAYOUT`, `METAL-SUPPORT-HEIGHT`, `METAL-SUPPORT-MISSING`, `METAL-UNVERIFIED`).

## Consumers

- 3D: `metalStructureRenderer.js` extrudes every member; the meshes live inside the `StringerOuter` (outer + central
  rows) and `StringerInner` groups, so the existing "Wanga zewn. / wewn." layers show and hide them.
- Plan 2D: dashed footprint of every beam / flat bar (`metalStructure` option, drawn with the stringer layer).
- Validation gate: `metalStructure.diagnostics`.
- Takeoff (`takeoff/metalItems.js`, element type `STEEL`): one item per beam and per flat bar (blank size, mass), one
  per row for its supports (quantity = supports) — **unpriced**, no timber volume.
- DXF (`buildMetalDXF`, button "Stal (DXF 1:1)"): every flat bar's cutting outline with its blank rectangle and
  tread bearings; every beam in side view with its supports and their sizes listed.
- Structural check: a tread on a beam's supports is skipped (not a beam between two wangi); on flat bars the tread's
  span is measured between the bars' centre lines.
- Offer and Inspektor name the construction.

## Limits

- No fixings (base plates, slab anchors, tread screws / brackets on the flat bars), no welds, no steel calculation.
- Plates of two plan runs simply meet at the plan corner (plumb ends); the corner detail is the fabricator's.
- A landing gets the same supports as a tread (a real landing needs its own frame).
- Steel colour is fixed (not in the appearance settings).
