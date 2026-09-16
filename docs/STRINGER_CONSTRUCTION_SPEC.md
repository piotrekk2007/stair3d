# Stringer Construction Specification

**Status: technical specification lock.** This document is the source specification for all
future stringer-related development. It resolves the open technical questions raised by the
"product/geometry reality check" performed on the stringer construction geometry stage (see
`docs/architecture/STRINGER_CONSTRUCTION_MODEL.md` for the geometric implementation this
document specifies). Every claim below is classified as one of:

- **Established construction practice** — a real, widely-published fact about how timber
  stairs are actually built, independent of any software.
- **Engineering guidance** — a standard/trade-body-sourced number or method (e.g. BWF Timber
  Stair Design Guide, Eurocode 5).
- **Software design choice** — an algorithmic decision Stair3D itself makes, with no claim of
  external authority.
- **Company/manufacturing parameter** — a number a workshop would set for itself; not
  universal.

No number in this document is presented as an engineering requirement unless a source is
cited for it. Where no authoritative universal value exists, the corresponding config field is
explicitly marked configurable, not "recommended."

The machine-readable form of this document's classifications lives in
`src/rules/sets/stringerConstructionAssumptions.js` (see §J and §K below, and
`docs/rules/TECHNICAL_RULES_CATALOGUE.md` for how it fits the wider technical-rules layer).

---

## A. Terminology

| Term(s) | Are they the same construction type? |
|---|---|
| **Cut string** = **cut and mitred string** = **open string** = **open stair stringer** = **return string** | **Yes — one category.** Confirmed by multiple independent general sources (This Old House, WOOD DESIGNER, Continox, DailyCivil): a board with triangular notches sawn into its top edge so the treads/risers sit in/on the notches, tread ends visible from the side, lower edge left straight and parallel to the pitch. |
| **Housed string** = **closed string** = **boxed string** = **side string** | **Yes — one category, distinct from cut/open.** Confirmed (InterNACHI, Fine Homebuilding, Continox): treads/risers are hidden between two solid boards, let into routed housings (mortises) in the inner face; outer silhouette stays a plain, uncut board. |
| **"Open-cleated stringer"** | **Not confirmed as its own distinct, separately-named category.** No source reviewed uses this exact term for a third construction method. General stair-terminology sources (e.g. Cooper Stairworks' glossary) instead describe **cleats fixed to the inner face as a technique associated with CLOSED (housed) construction** — a simpler alternative to routing a full housing, not a defining feature of an open/cut string. |

**Resolution — this is a real terminology correction, not a restatement:**

- **`cut`** (Stair3D internal id) = **cut/open string**. This mapping is CONFIRMED correct.
  Polish label **"wanga nakładana"** is kept.
- **`closed`** (Stair3D internal id) = **housed/closed string**. This mapping is CONFIRMED
  correct. Polish label **"wanga wpuszczana"** is kept.
- **Cleats are NOT a confirmed defining feature of the `cut` type.** The current
  implementation (§I) attaches `cleats[]` to `cut` unconditionally — this is a **Stair3D
  software design choice**, not an industry-standard pairing. If anything, general sources
  associate cleats more closely with an economical variant of the CLOSED type (a "cleated
  closed string", avoiding routing). **No third construction type is introduced** at this
  stage — see §I for the concrete recommendation.

---

## B. Construction types (summary)

| | `cut` (wanga nakładana) | `closed` (wanga wpuszczana) |
|---|---|---|
| Top edge | Steps to match each tread's bearing (visible notch) | Plain, straight, parallel to pitch |
| Bottom edge | Single straight line, parallel to pitch | Plain, straight, parallel to pitch |
| Tread support | Notch (+ Stair3D's own optional cleats, see §I) | Routed housing (mortise) into inner face |
| Tread visibility | Tread/riser ends visible from outside | Hidden between the two boards |

---

## C. Geometric model (unchanged summary — see STRINGER_CONSTRUCTION_MODEL.md for full detail)

`StringerModel` → `StringerSegment` (one per straight reference-line run) →
`StringerConstructionGeometry` (one per segment): `pitchLine`, `outerContour`, and either
`cleats[]` (`cut`) or `housings[]` (`closed`). Nothing in this stage changes this pipeline;
this document only reclassifies and documents the assumptions inside it.

---

## D. Reference line

Unchanged invariant, reconfirmed by the reality check: `StringerReferenceGeometry` is derived
ONLY from the raw/unedited tread chain, is always straight (asserted), and paired stringers
remain parallel and correctly spaced (verified numerically in every tested scenario). This
holds identically for both construction types and is unaffected by manual tread-edge edits.

---

## E. Tread support model

- `cut`: tread support = the notch itself (`outerContour`'s top step) **plus** a `cleats[]`
  entry per tread (see §I for whether this should be unconditional).
- `closed`: tread support = a `housings[]` entry per tread (see §H).

Both are derived from each tread's **FINAL** (possibly manually-edited) bearing position
(`finalUStart`/`finalUEnd`/`bearingElevation`) — reconfirmed exactly by the reality check's
edit-propagation tests (§G/2 of the reality check).

---

## F. Lower contour model — the pitch line

**Question asked**: is the two-point chord through the first/last bearing appropriate for (A)
straight flights, (B) landings, (C) winders, (D) manually modified geometry?

**Finding**: A published general principle exists — *"the lower edge remains parallel to the
pitch of the stair"* (This Old House; WOOD DESIGNER) — confirming THAT a cut string's bottom
edge should be straight and pitch-parallel. **No source reviewed describes the specific
two-point-chord PROCEDURE** Stair3D uses to compute that line from bearing data. Per this
document's own rule (§9 of the requesting task): this procedure is documented as a

> **STAIR3D GEOMETRIC ASSUMPTION** (`SOFTWARE_DESIGN_CHOICE`, `status: ASSUMPTION` — see
> `STAIR3D-STRINGER-PITCH-LINE-METHOD` in the rules catalogue).

**Per-case assessment:**

| Case | Verdict | Why |
|---|---|---|
| A. Straight, uniform flight | **Acceptable as the default — mathematically exact.** | `bearingElevation` is an EXACT affine function of tread index (`(index+1)*riserHeight - treadThickness`, never edited). Every bearing corner in a straight, unedited segment is therefore already perfectly collinear; the two-point chord equals every intermediate point exactly. Reality-check scenario 1/2 confirmed 0 diagnostics. |
| B. Landings | **N/A / not applicable.** A landing tread has no stringer bearing chain of its own in the sense a straight/winder flight does (see `planLayout.js`'s landing handling) — the pitch-line method only ever runs on segments that DO have tread bearings. |
| C. Winders | **Acceptable as the default, with a real limit.** Going varies tread-to-tread within a winder segment, so intermediate bearing corners are NOT guaranteed collinear with the two extreme points. Reality-check scenarios 3/4 (a realistic winder) showed 0 diagnostics and plausible remaining-section values (101–196mm), but a synthetic steep/coarse configuration was shown to drive the same method's `minRemainingSectionMm` negative (a real degenerate case, correctly caught as a diagnostic, not silently produced as bad geometry). |
| D. Manually modified geometry | **Acceptable — edits are correctly reflected, either at the notch (interior edit) or by moving the chord's own endpoint (first/last bearing edited).** Reality-check scenarios 5/6 confirmed exact numeric propagation with no diagnostic regressions. |

**Recommendation**: keep the two-point chord as the **default** for all cases (it is exact for
the common case and safely diagnosed when it degrades). For a future stage — **not this
one** — consider an explicit, user-settable pitch angle / reference line as an alternative
input for atypical/very asymmetric winders, so a designer isn't limited to what the two
extreme bearings imply. Do not implement this now.

---

## G. Winder treatment

**Question asked**: does each straight winder segment get its own pitch/reference line; how is
the lower-flight → winder → upper-flight transition handled; is generating two independent
straight boards the final engineering answer?

**Finding**:
- **Each straight segment already has its own independent, correctly straight reference line
  and pitch line** — confirmed both by the existing `assertReferenceLineIsStraight` invariant
  and by the reality check (2 segments/side in the tested L-winder, each internally consistent).
- **The multi-piece, post-jointed structural CONCEPT is CONFIRMED as correct**, not merely a
  Stair3D convenience: StairBox's winder-fitting guide describes stringers at a winder/newel
  turn as modified, separately-shaped pieces joined at the newel (glued/wedged or
  dowelled/bolted) — consistent with `BWF-GUID-F-03` (already in `bwfIndustryGuidance.js`),
  which states strings at a winder turn "may need local enlargement... a distinct,
  purpose-shaped construction problem", not the same flat-panel logic as a straight run.
- **Two things described by real sources are NOT yet modeled** (documented gaps, not fixed in
  this stage):
  1. **Local enlargement** — `BWF-GUID-F-03`'s point that the board may need to be locally
     WIDER (not just longer) at a winder to fully contain the housing/notch geometry of a
     winder tread. The current model uses one constant `boardWidthMm` for the whole segment.
  2. **A shaped transition piece at the post** — some sources (StairBox) describe a "curved
     triangle" piece added at the newel joint rather than two flat boards butting squarely into
     a plain post. The current model terminates each segment as a flat end (optionally
     extended for a lap joint when there's no post — unchanged from the earlier consolidation
     stage).
- **Continuity/self-intersection**: both tested winder scenarios (overlay and housed) produced
  simple, non-self-intersecting contours on every segment, with correct parallel/spacing
  results — no engineering blocker found for the segments as currently generated; the two gaps
  above are refinements, not defects.

**Conclusion**: "two independent straight boards, joined at a post" is the right STRUCTURAL
answer per real sources, but is not yet the FINAL engineering solution in full — local
enlargement and a shaped transition piece remain open, explicitly deferred items.

---

## H. Housed stringer model

**Question asked**: is a rectangular recess the right representation; what should `housingDepth`
mean; should the current simplification stay for now?

**Findings from real construction practice** (Fine Homebuilding, two independent articles):
housed-string mortises are typically **tapered (back-angled)**, and assembly is
**glued and wedged** — a wedge matching the mortise's taper is driven in to lock the joint,
producing a tight, self-locking fit; this is explicitly *why* housed stairs are "stronger and
less likely to squeak" than a simply-notched string.

**Current Stair3D model**: a plain, axis-aligned rectangular recess. No taper, no wedge, no
glue line. **This may remain simplified for now** (explicitly acceptable per this stage's
scope) — but per the requesting task's own instruction, **the data model must stay capable of
representing the more realistic joint later**: `StringerHousing`'s shape (see
`stringerModel.js`'s typedef) should not be assumed to be forever a simple box; a future
`taperAngle`/`wedge` field would extend it, not replace it.

**What `housingDepth` currently means — and the conflation found**: today, ONE number
(`housingDepthFor(stringerThickness) = max(12mm, 0.4×thickness)`, the same BWF-cited formula
as `BWF-GUID-F-01`) is used simultaneously as:

- (A) the assumed final physical routing depth (what a manufacturing drawing would read), and
- (B) the input to the `minRemainingSectionMm` structural diagnostic, and
- (C) the literal depth rendered as the visual recess indicator in 3D.

**This is a genuine conflation, flagged (not fixed) in this stage.** `BWF-GUID-F-01`'s own
wording states a *minimum* depth requirement — it does not claim to be the exact depth a real
joiner would route to (which may be deeper for a tighter wedge fit). **Recommendation for a
future stage**: split this into an explicit **structural minimum** (this formula, unchanged)
versus a separate, possibly-deeper **actual/manufacturing routing depth** (configurable,
defaulting to the structural minimum until a real value is set) — do not implement this split
yet.

**Classification of `housingDepth` today**: **(B) structural minimum**, currently reused as a
stand-in for (A) and (C) — not yet disambiguated.

---

## I. Cleats

**Question asked**: do `cleats[]` represent (A) a genuinely distinct construction method, (B) a
visual aid, (C) optional support blocks, (D) a company-specific method?

**Answer**: **(C) — optional support blocks, currently generated unconditionally for `cut`,
but they should NOT be assumed mandatory for every cut/open string.** General sources describe
a plain cut/open string relying on the notch alone as entirely valid and common; cleats are a
genuine, real construction detail, but not a universally-required part of "cut string"
construction — and are, if anything, more often documented in connection with an economical
closed-string variant (§A).

**This is a Stair3D software design choice** (`SOFTWARE_DESIGN_CHOICE` / `ASSUMPTION` in the
rules catalogue), not an industry requirement, and not (yet) a company-specific manufacturing
method either (no company has specified this — it's simply how the geometry stage was built).

**Recommendation (not implemented)**: make cleats an explicit, independent option (e.g. a
boolean orthogonal to `constructionType`) rather than hard-attached to `cut` — this matches how
real sources actually use the term, and avoids materially overstating cleats as a requirement
once Material Takeoff starts counting them as purchasable items.

---

## J. Parameters

| Parameter | Value | 1. Legal? | 2. Structural calc? | 3. Industry recommendation? | 4. Practical manufacturing parameter? | 5. Stair3D design choice? | **Classification** |
|---|---|---|---|---|---|---|---|
| `stringerTopMarginMm` | 50mm | No | No | No | Plausible, unconfirmed | Yes | **CONFIGURABLE** — no authoritative source |
| `stringerMinRemainingSectionMm` | 30mm | No | No (would require Eurocode 5 species/grade-specific check) | No | Sanity-check default | Yes | **CONFIGURABLE** — diagnostic threshold only |
| `stringerCleatThicknessMm` / `HeightMm` | 20mm / 40mm | No | No | No | Plausible carpentry scale | Yes | **CONFIGURABLE** |
| Housing depth formula | `max(12mm, 0.4×thickness)` | No | No | **Yes** — BWF Timber Stair Design Guide 2013 §6.2.3 (same source as `BWF-GUID-F-01`) | — | — | **CONFIRMED** (industry best practice, cited) |

None of the four Stair3D-only defaults above is presented anywhere in the UI or code as
"recommended" — they are starting points, explicitly labeled `CONFIGURABLE` in the rules
catalogue.

---

## K. Technical assumptions (machine-readable form)

Every classification in this document has a corresponding entry in
`src/rules/sets/stringerConstructionAssumptions.js`, each stating `ruleId`, `source`, `type`
(reusing the existing `ruleType` enum, now including the new `SOFTWARE_DESIGN_CHOICE` value),
`status` (`CONFIRMED`/`ASSUMPTION`/`CONFIGURABLE`), `constructionType` (`cut`/`closed`/`both`),
and the three `affects*` booleans (geometry/validation/material takeoff). See that file for the
full entries; summary:

| ruleId | status | constructionType |
|---|---|---|
| `STAIR3D-STRINGER-CUT-BOTTOM-PARALLEL` | CONFIRMED | cut |
| `STAIR3D-STRINGER-PITCH-LINE-METHOD` | **ASSUMPTION** | both |
| `STAIR3D-STRINGER-WINDER-SEGMENTED` | CONFIRMED | both |
| `STAIR3D-STRINGER-TOP-MARGIN-DEFAULT` | CONFIGURABLE | closed |
| `STAIR3D-STRINGER-MIN-SECTION-DEFAULT` | CONFIGURABLE | both |
| `STAIR3D-STRINGER-CLEAT-DIMENSIONS-DEFAULT` | CONFIGURABLE | cut |
| `STAIR3D-STRINGER-CLEATS-OPTIONALITY` | **ASSUMPTION** | cut |
| `STAIR3D-STRINGER-HOUSING-DEPTH-FORMULA` | CONFIRMED | closed |
| `STAIR3D-HOUSING-RECTANGULAR-SIMPLIFICATION` | CONFIRMED (as a documented simplification) | closed |

---

## L. Sources

1. This Old House — ["What to Know About Cutting Stair Stringers"](https://www.thisoldhouse.com/stairs/21591423/how-to-cut-stair-stringers)
2. WOOD DESIGNER — ["How to cut stair stringers: a complete guide"](https://wooddesigner.org/how-to-cut-stair-stringers/)
3. DailyCivil — ["Stair Stringer – Types, Calculation And Cutting Procedure"](https://dailycivil.com/types-of-stair-stringer/)
4. Continox — ["Open vs Closed String Staircase UK"](https://continox.uk/open-vs-closed-string-staircase/)
5. Fine Homebuilding — ["Shop-Built Housed-Stringer Stairs"](https://www.finehomebuilding.com/project-guides/framing/shop-built-housed-stringer-stairs)
6. Fine Homebuilding — ["How To Build Housed-Stringer Stairs"](https://www.finehomebuilding.com/2010/09/09/housed-stringer-stairs-the-frame-is-the-finish)
7. InterNACHI — ["Inspecting Stair Stringers"](https://www.nachi.org/inspecting-stair-stringers.htm)
8. StairBox — ["How to Fit Kite Winder Turns"](https://www.stairbox.com/staircase-fitting-guide-winders.html)
9. Oz Stair Pty Ltd — ["Construction Methods"](https://ozstair.com.au/construction-methods/)
10. `BWF-GUID-F-01`/`F-02`/`F-03`/`F-04` (BWF Timber Stair Design Guide 2013 §6.2.3, Table 6.1) — already in `src/rules/sets/bwfIndustryGuidance.js` from an earlier research stage, reused (not re-verified independently) here.

Per the requesting task's explicit instruction: professional/commercial staircase-CAD software
was **not** used as proof of any technical requirement in this document — general/public
carpentry and trade-body references only.

---

## M. Items intentionally left configurable

- `stringerTopMarginMm`, `stringerMinRemainingSectionMm`, `stringerCleatThicknessMm`,
  `stringerCleatHeightMm` — all `CONFIGURABLE`, no authoritative universal value exists.
- Whether cleats are generated at all for a `cut` string — currently unconditional; recommended
  (not implemented) to become an explicit, independent option (§I).
- The exact housing routing depth vs. the structural-minimum housing depth — currently the same
  number; recommended (not implemented) to be split (§H).
- The pitch-line derivation method itself for winders/edited flights — acceptable as the
  default; an explicit alternative (user-set pitch angle) is a candidate future option, not
  built now (§F).

**Not changed in this stage**: `stringerConstructionGeometry.js`, `stringerRenderer.js`, the
UI, and Material Takeoff are all untouched. This document and the accompanying rules-catalogue
entries are the only artifacts of this stage.
