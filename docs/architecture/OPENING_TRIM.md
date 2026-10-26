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

Not done: DXF of the trim, the gallery balustrade standing ON the trim (it stands on the floor as before).
