# Part codes and labels — `src/production/`

User decisions 2026-10-28: codes by the part's type, numbered walking up; shown in the Inspektor; printed on an A4
sheet of stickers; no QR code.

## Codes (`partCodes.js buildPartList(models)`)

The parts are the takeoff's items (`computeMaterialTakeoff`, one item per physical component) computed WITHOUT the
validation gate, so a project with design errors still has its codes. Connectors (hardware) and housings (a feature of
the board) get none; manual takeoff rows are not parts of the model.

| code | part |
| --- | --- |
| `ST-01` | tread — the same number as on the plan (tread index + 1); a cantilever tread's cladding boards `ST-01.1`, `ST-01.2`, … |
| `PD-03` | landing (the same numbering as the treads) |
| `PS-01` | the riser of tread 1; a winder's fan riser one code per flat panel (`PS-06a`, `PS-06b`, with each panel's length); `PS-G` the top riser under the nosing tread |
| `WZ-1` / `WW-1` | wanga outer / inner, board by board along the side; an S: `WL` / `WP` (left / right, `util/sideNames.js`) |
| `SL-1` / `SB-1` | structural post / balustrade post |
| `PR-1`, `UP-1`, `PP-1` | handrail piece, the wall handrail's brackets, base rail |
| `TR-1`, `SZ-1`, `MS-1` | balusters of one length, a glass pane, glass fixings |
| `FJ-1`, `KS-1` | opening trim piece, steel member |

Each part: `{code, itemId, sourceElementId, elementType, name (Polish), dimensions (the takeoff's calculated sizes,
`describeDimensions`), material, quantity, unit}`. The numbers follow the takeoff's order (walking up).

## Consumers

- Inspektor (`ui/inspectorPanel.js partsRow`): „Kod elementu” for the selected tread (its tread + riser codes), wanga
  (its board, or every board of the side) and post — `partsForSelection(partList, selection)`; `main.js partList()`
  builds the list once per rebuild when first asked for.
- Labels (`labelSheet.js labelSheetHTML`): Kosztorys tab „🏷 Etykiety A4” + the sheet (3 × 8 = 70 × 37 mm, 2 × 7 =
  105 × 42.4 mm, edge to edge) → printed through a hidden frame like the offer (`app/exports.js labels`). One label per
  piece (`1/2`, `2/2` for a quantity), bulk parts (balusters, glass fixings, wall brackets) once with `× n`. A label: the
  code, the name, the sizes, the material, the project name and the date. With design errors the sheet still prints and
  says so on screen only.

## The installer's sheet („Karta dla montażysty”, user request 2026-11-19)

`production/installerSheet.js installerSheetHTML(models, {projectName, date, warning})` — a pure HTML document for the
fitter to check the number and the shape of the parts, printed like the labels (`app/exports.js installerSheet` →
`app/printHtml.js`; Kosztorys „🛠 Karta dla montażysty”, beside „🏷 Etykiety A4”; with design errors too, then it says
so). The same codes as the labels (`buildPartList`). Colours per kind (`SHEET_COLORS`: straight / winder / landing /
outer wanga / inner wanga / post / bearing / housing). User decisions 2026-11-19:
- page 1: the plan (tread outlines coloured by kind with their codes, every wanga board's footprint — reference line +
  its thickness inward — with its code, the structural posts) and a quantities table (count + the codes as ranges,
  `codeRanges`);
- the wangi: each board from the side (its `outerContour` in u / v), its overall length × height as dimension lines,
  thickness, type (housed / cut), the blank (the takeoff's dimensions), a red line + the tread's number where each tread
  bears (`treadBearings`), the housings (violet), the faces of the posts it enters — no chain of dimensions;
- the treads: grouped when identical (`treadGroups`: the outline as cut — round a post too, `treadJointsByStep` — in the
  tread's own frame, x along the front edge, rounded to 1 mm, the same kind and riser groove) — one drawing „× n” with
  the codes; the front (nosed) edge red, the overall width × depth, and for a non-rectangle every edge ≥ 30 mm that is
  not an overall dimension; winders and landings the same way (usually one each);
- the risers grouped by size and the structural posts (section, height) as tables. No balustrade, no prices.
Test: `production/__tests__/installerSheet.test.js`.
