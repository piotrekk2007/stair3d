# Stringer Construction Model

This document covers the stringer CONSTRUCTION GEOMETRY stage: turning the existing analytical
`StringerModel` (segments + tread bearings) into a physically plausible timber board contour,
suitable for client-facing 3D visualization and as a starting point for manufacturing
documentation. It does not replace anything — see [CONSOLIDATION.md](CONSOLIDATION.md) and
`CLAUDE.md` for the `StringerReferenceGeometry`/`StringerSupport`/`StringerModel` layer this
stage builds on top of, unchanged.

## 1. Why this stage exists

Before this stage, `stringerRenderer.js` built **one independent rectangular panel per tread
bearing**: each panel's bottom edge sat at `bearingElevation - boardWidth`, and since
`bearingElevation` increases every tread, the panels' bottom edges formed the same staircase
pattern as their top edges. The result was a stack of boxes, not a real board — visually
correct at the top (where a real stringer's contour DOES step, for one of the two construction
types) but wrong at the bottom (where a real stringer's edge never does).

## 2. Terminology

| Internal (`CONSTRUCTION_TYPES`) | Polish (user-facing) | English (general carpentry term) |
|---|---|---|
| `cut` | wanga nakładana | cut / open string (also "open-cleated string" when built with support cleats rather than a fully notched top) |
| `closed` | wanga wpuszczana | closed / housed string |

These are the two most common timber staircase stringer/string construction methods described
in general carpentry and staircase-industry literature (e.g. trade-body joinery guides such as
the BWF Timber Stair Design Guide, already cited elsewhere in this codebase for joinery
constants — see `stringerModel.js`). This document does not reproduce any proprietary
algorithm — only the same widely-published construction *concepts* (a notched/open top vs. a
routed housing) already common to staircase carpentry references and CAD/CAM staircase
software documentation in general.

**Category discipline** (per the technical-rules layer's own convention — see
`docs/rules/TECHNICAL_RULES_CATALOGUE.md`):
- *Established general construction principle*: a cut string has a stepped top / continuous
  straight bottom edge; a closed string is a plain rectangular board with routed housings. This
  is universal, uncontested staircase-carpentry knowledge.
- *Engineering guidance*: `MIN_HOUSING_DEPTH_MM`/`HOUSING_DEPTH_THICKNESS_FRACTION` (BWF-cited,
  unchanged from the earlier stage).
- *Company/manufacturing assumption, explicitly configurable, not authoritative*:
  `stringerTopMarginMm`, `stringerMinRemainingSectionMm`, `stringerCleatThicknessMm`,
  `stringerCleatHeightMm` (see `src/config/schema.js`) — reasonable defaults, never presented
  as a code requirement.
- *This project's own software-specific behaviour*: the two-point "pitch line" method below.

## 3. The pitch line

`StringerTreadBearing.bearingElevation` is an **exact** affine function of tread index
(`(index+1)*riserHeight - treadThickness`, unaffected by manual edits — see `stringerSolver.js`).
For a straight flight this means every bearing's `(u, elevation)` corner point in one segment is
already collinear. `stringerConstructionGeometry.js` strikes a straight line through the
**first** and **last** bearing's own corner points — the traditional two-point method a joiner
uses to strike a chalk/margin line for laying out a stringer (a general, established practice,
not a number invented for this codebase). Both construction types derive their straight
edge(s) from this one pitch line.

For a winder segment (tread-to-tread going varies), intermediate bearings can deviate slightly
from this straight line. `minRemainingSectionMm` is exactly the diagnostic that catches when
that deviation — or an unrealistically steep straight flight — would leave too little (or
negative) material; see §6.

## 4. Two contours, one shared method

**`cut` (overlay/open-cleated)** — `outerContour`:
- **Top edge**: steps to match each tread bearing's own `[finalUStart, finalUEnd]` region at its
  own `bearingElevation` — the classic notched/"sawtooth" top of an open string. This is a
  **real, correct feature** of this construction type, not the defect the old renderer had.
- **Bottom edge**: the single straight pitch-line-parallel line, shifted down by `boardWidth`
  (`config.stringerHeight`) — continuous for the segment's entire length.
- **Cleats** (`cleats[]`): one small support block per tread, reported **separately** from the
  board's own contour (never merged into it) — dimensions from `stringerCleatThicknessMm`/
  `stringerCleatHeightMm`.

**`closed` (housed/recessed)** — `outerContour`:
- **A plain 4-point parallelogram** — both top and bottom edges straight and parallel to the
  pitch line, regardless of how many treads the segment supports. The top edge sits
  `stringerTopMarginMm` above the pitch line.
- **Housings** (`housings[]`): one recess per tread — `[uStart, uEnd]` × `[bearingElevation -
  treadThickness, bearingElevation]`, cut `housingDepthFor(stringerThickness)` deep (unchanged,
  BWF-cited) into the board's inner face — **never** changing the outer silhouette.

Both contours share one `computePitchLine()`/`pitchValueAt()` implementation — never two
independent slope calculations that could drift apart.

## 5. Diagnostics

`minRemainingSectionMm` means something different per type (both are real, distinct timber
failure modes, not the same number relabeled):
- `closed`: material remaining **through the board's thickness**, behind the routed housing —
  `stringerThickness - housingDepthFor(stringerThickness)`.
- `cut`: material remaining **along the board's width**, between a tread's notch and the single
  straight bottom edge — the smallest gap found at any bearing's own corners.

A value below `config.stringerMinRemainingSectionMm` produces a `WARNING` diagnostic
(`STRINGER-MIN-SECTION`); a self-intersecting contour (checked via the same
`segmentsProperlyIntersect` primitive used elsewhere in this codebase) produces an `ERROR`
(`STRINGER-CONTOUR-SELF-INTERSECTION`). **Not yet wired into the Staircase Validator UI** — the
diagnostics exist, are fully tested, and are the obvious next integration point, but this stage
stayed scoped to the construction-geometry model itself, per the explicit instruction not to
begin the next stage yet.

## 6. Known, deliberate limitations (not overengineered further)

- **No true CSG.** A housing's rendered "recess" is a small, slightly-inset, slightly-darker
  box at the housing's real position — not a boolean-subtracted volume (Three.js has no built-in
  CSG; no library was added for this, per the project's no-new-dependency-without-a-concrete-need
  stance). The *analytical* housing data (position/size/depth) is exact; only its visual
  rendering is a simplification.
- **No angled/wedged housings.** Real closed-string housings are sometimes tapered for a wedged
  fit; this model uses a plain rectangular recess.
- **No CNC toolpaths, joinery optimization, or manufacturing drawings** — explicitly out of
  scope for this stage.
- **The two-point pitch line can go geometrically invalid for unrealistically steep flights**
  (very tall risers over very short goings) — `minRemainingSectionMm` correctly reports this as
  a diagnostic (see the dedicated test in `stringerConstructionGeometry.test.js`) rather than
  silently producing bad geometry; no fallback method was invented, since realistic,
  code-compliant stairs (reasonable riser/going ratios) do not hit this in practice.

## 7. Data flow (unchanged direction, one more stage)

```
config → buildPlanLayout() → buildStringerModel() [StringerModel, unchanged]
                            → buildStringerConstructionGeometry() [NEW — the physical contour]
                            → renderStringers() [consumes BOTH, decides nothing]
```

`stringerRenderer.js` never computes geometry — it extrudes `outerContour` (one continuous
board mesh per segment), and separately extrudes each `cleats[]`/`housings[]` entry as its own
small mesh, tagged with the same traceability `userData` scheme as every other element (a
board mesh has `stepId: null` — it spans many treads; a cleat/housing mesh has `stepId:
'step-N'` — it supports exactly one).
