# LED lighting — `src/geometry/ledModel.js`

User decisions 2026-10-28: LED under the treads' noses, in the wanga along the flight and under the handrail; shown in
3D (glowing), on the plan, as grooves in the DXF and in the takeoff; a recessed aluminium profile 17 × 8 mm by default.

## Config (folder „10. Oświetlenie LED”)

| field | meaning |
| --- | --- |
| `ledTreadEnabled` / `ledStringerEnabled` (+ `ledStringerSide` both / outer / inner) / `ledHandrailEnabled` | the three places |
| `ledProfileWidthMm` × `ledProfileDepthMm` | the profile = the routed groove (17 × 8, ASSUMPTION) |
| `ledTreadSetbackMm` | under the nose: the groove's edge behind the nosed front face (4) |
| `ledStringerFromTopMm` | in the wanga: the groove's centre below the board's top edge (25) |
| `ledEndMarginMm` | the strip short of each end (30) |
| `ledPowerWPerM`, `ledSupplyReservePct` | the strip's power (9.6 W/m) and the supply's reserve (20 %) — ASSUMPTION |

## Model (`buildLedModel` → `built.led`)

- Under the nose: on the tread's underside along its FINAL front edge, the groove's centre `nosing − setback − width/2`
  forward of the front edge (so with the default 25 mm nose: 4–21 mm behind the face, in front of the riser, which
  stands behind the front edge). Landings and cantilever treads have none. WARNING `LED-TREAD-NOSING` when the groove
  does not fit in front of a riser board; WARNING `LED-GROOVE-DEEP` deeper than half the tread.
- In the wanga: on the board's face toward the stair (`referenceLine` + `inwardNormal × thickness`), its centre line
  (u, v) = the solved top profile − `ledStringerFromTopMm`, over the board less the end margins. Housed boards only — a cut
  board's top is the comb (INFO `LED-STRINGER-CUT`); a band crossing a tread / riser housing → WARNING
  `LED-STRINGER-HOUSING`.
- Under the handrail: along each handrail piece of every section (the opening's and the wall handrail included), half
  the handrail's height under its axis, square to it (the up vector like `railingRenderer.js`). WARNING
  `LED-HANDRAIL-NARROW` when the profile is wider than the handrail less 10 mm.
- Each strip: `{id, kind, elementId, points (plan x / y + z), faceNormal, roomMm (the face's room either side), lengthMm,
  groove}`; `totals` per place, `powerW`, `supplyW`, `diagnostics` (in the takeoff gate).

## Consumers

- 3D (`ledRenderer.js renderLed`): a glowing band (emissive) per strip, 0.5 mm proud of its face, and a soft additive glow
  round it (up to 5 × the profile, never past the face's edge); the root's layer `LedLighting` (3D HUD „LED”, photos,
  the client's model).
- Plan (`plan2dRenderer.js ledXML`, layer „Oświetlenie LED”): every strip's centre line, as wide as the profile.
- DXF (layer `LED`): the tread's groove rectangle with „frez LED od spodu W x D mm” (`buildTreadDXF` /
  `buildAllTreadsDXF` `{led}`), the wanga's band along its line (`buildStringerBoardDXF` / `…AllBoardsDXF` `{led}`), and
  a header line on the balustrade sheet (`buildRailingDXF` `{led}`).
- Takeoff (`takeoff/ledItems.js`, `ELEMENT_TYPES.LED`, UNPRICED like the connectors): per place the strip in its profile
  in running metres with its cut list, and the power supply `≥ supplyW`; category „Oświetlenie LED (bez ceny)”.
