# The ceiling opening's trim ("fajka") — `src/geometry/openingTrimModel.js`

User request 2026-10-26. A wooden finishing piece along chosen edges of the ceiling opening: it finishes the edge
(the slab's face can be covered) and takes the gallery balustrade's posts and balusters.

## Section

Along each piece, square to its edge (n = from the opening's edge into the slab, z up, F = the slab's top =
`totalRise`, T = F + boardThickness — the board LIES ON the slab, user report 2026-10-26; sunk into it, it collided):

| part  | n                      | z                          | config |
| ---   | ---                    | ---                        | --- |
| nose  | `[−noseWidth, 0]`      | `[T − noseHeight, T]`      | `openingTrimNoseWidthMm` (20) — how far it stands out into the opening; `openingTrimNoseHeightMm` (null = `treadThickness`; up to the slab's thickness, to cover its whole edge) |
| board | `[0, boardDepth]`      | `[F, T]`                   | `openingTrimBoardThicknessMm` (15), `openingTrimBoardDepthMm` (100) — on the slab, top flush with the floor, meeting the floor finish |

All sizes ASSUMPTION (workshop practice, no published figure). A nose taller than the slab → WARNING
`OPENING-TRIM-NOSE-HEIGHT`.

## Which edges

`openingTrimEnabled` switches it on. The pieces are the opening balustrade's free pieces — ONE rule for both
(`railingSolver.js openingEdgePieces(outline, ctx, overrides)`): not along a stairwell wall, not the stretch where the
stair arrives (last back edge + one wanga each side) — except that a WALL does not cut the trim (`wallsCut: false`): an
edge along a wall is off by default, but switched on it gets the trim along its whole length; every edge on / off by hand (`openingTrimEdges[i]`, plan mode
"▬ Fajka": click an edge — green = with trim, grey dashed = without).

## At the stair's exit

The stretch of the exit edge the stair arrives at is its own piece `opening-trim-exit` (user request 2026-10-26): the
whole stretch cut out for the stair (the last back edge and one wanga past each end), so it BUTTS against the trim on
either side of it on its edge and is MITRED at a corner like any piece (user report 2026-10-26: stopped at the wangi's
inner faces it left a gap each side and never met the next edge); `openingTrimExit` (default on), toggled on its own in
the "▬ Fajka" mode (orange line). The housed wangi ending at the slab are NOTCHED under its nose (the last
`noseWidth` of their top down to the nose's underside — `stringerConstructionGeometry.js notchPolylineEnd`,
`fullConfig.exitTrimNoseWidthMm`); a post standing in the trim (an end newel at the exit) gets a hole like the
balustrade's posts. Every free part of an edge that is on gets the trim however short (the balustrade drops a stub
under 100 mm). It is the stair's nosing tread on the slab ("stopień fajkowy"): the top
riser ends under its nose (`exitNoseBottomZ` → `fullConfig.exitTrimNoseBottomZ` → `riserSolver.js
topRiserElevation`: its underside + `riserTopOverlapMm`; the wanga's top-riser housing follows the same function).

## Holes for the balustrade

`withTrimHoles(trim, railingModel, config)` (buildStaircase, right after the balustrade is solved): every post and
baluster of the opening's balustrade standing on the trim gets a hole of its own section (posts square, balusters
square / round) through the solid under it (`depthMm` = the solid's height); the post / baluster goes down the hole to
the slab (`railingSolver.js openingGroundAt.holeBottomAt`), the handrail is measured from the trim's top. 3D: the holes
cut in the extruded solid (only those wholly inside one solid — a corner post across a mitre is not cut); plan: drawn;
DXF: drawn (layer JOINTS) and counted per piece; takeoff note.

## Corners and ends

Two pieces meeting at a corner of the opening are MITRED: each band's corner is where the two edges' offset lines meet
(convex and concave corners alike). A free end (at the stair, a wall, an edge without trim) is cut square to its edge.

## Output and consumers

`buildOpeningTrim(ctx)` → `built.openingTrim = {enabled, edges, pieces, dims, diagnostics}`; each piece `{id, edge,
part, a, b, outward, lengthMm, widthMm, solids: [{kind: 'nose'|'board', outline (plan), zBottom, zTop}]}`.

- 3D: `openingTrimRenderer.js` extrudes every solid (tread material, grain along the piece) — part of the stair root.
- Plan 2D: `plan2dRenderer.js openingTrimXML` (the solids; the clickable edges in the "▬ Fajka" mode).
- Takeoff: one `OPENING_TRIM` item per piece (`materialTakeoff.js buildOpeningTrimItems`): NET = the solids' volume,
  STOCK = one board of the nose's height, the piece's longest side × (nose width + board depth); priced from the board
  price list like a tread (`boardPricing.js boardBlankOf`), category „Obróbka otworu (fajka)”.
- Gate: its diagnostics.
- DXF (`dxfExport.js buildOpeningTrimDXF`, Kosztorys → „Fajka (DXF 1:1)”): one 1:1 sheet, per piece its plan (u along
  the edge, the nose on top, nose = layer NOTCH, board = OUTLINE) with the length, width and the end cuts (square /
  mitre angle), and its section (the L-profile).
- The opening's BALUSTRADE stands in the trim (user request 2026-10-26, `railingSolver.js openingGroundAt`): a post /
  baluster over a trim solid goes down its hole to the solid's underside, a glass pane stands on the trim's top; the
  handrail's height is measured from the highest ground (the trim's top) along the section.
