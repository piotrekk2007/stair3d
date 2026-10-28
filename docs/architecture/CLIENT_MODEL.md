# The model 3D for the client — `src/export/clientModelExport.js`, `src/viewer/clientViewer.js`

User request 2026-10-28: the client gets a 3D model to look at — but only the geometry and its look, never the
designer's code, parameters or prices. A long link with the project inside was rejected (thousands of characters);
3D inside a PDF was ruled out (only Adobe Acrobat on a computer shows it).

## The three files ("Oferta" tab → "Model 3D dla klienta")

| button | file | opens in |
| --- | --- | --- |
| 📦 Podgląd 3D (HTML) | `<project>_model_3d.html` (~3–6 MB) | any browser, a phone too, offline |
| GLB — Windows / Android | `<project>_model_3d.glb` | Windows 3D viewer, Android 3D / AR apps, any 3D program |
| USDZ — iPhone / iPad (AR) | `<project>_model_3d.usdz` | iOS / iPadOS Quick Look — 3D and AR (the stair "in the room") |

`app/exports.js clientModel(kind)`: the scene is `buildClientScene({root, room})` — a clone of the stair root (every
layer shown, whatever the designer has hidden; userData emptied; materials cloned, taken with the selection highlight
off) plus the stairwell's walls and the slab tagged `userData.viewerLayer = 'room'`, scaled to METRES (glTF / USDZ /
AR units). GLB: three's `GLTFExporter` (binary, textures inside); USDZ: `USDZExporter` (Quick Look compatible).

## The HTML file

`clientViewerHTML({glbBase64, title, logo, facts, runtime})` (pure): `<script type="application/json"
id="stair-data">` (the GLB in base64, the title, the company logo, the facts — `clientFacts`: type, floor height, the
counts and sizes, no prices) + the viewer's runtime. `</` inside the data is escaped so it cannot close the script.

The runtime is a program of its own: `viewer/clientViewer.js` imports three.js only (a test checks it), and
`vite.config.js clientViewerRuntime` bundles it ON ITS OWN as one IIFE served as a string (`virtual:client-viewer-
runtime`, a separate chunk loaded only when the button is used). What it does: orbit / zoom / pan, views (Widok,
Przód, Bok, Góra), "Ściany i strop" on / off, the TAPE MEASURE (two clicks on the model — snapped to a corner of the
face hit within 14 px, else to its nearest edge — the distance, the height difference and the horizontal distance in
mm; several measures, "Wyczyść pomiary"), the logo and the facts on the page.

What the client can get out of it: the triangles of the model (as from any 3D model shown) — not the project, its
parameters, the workshop drawings or the prices.
