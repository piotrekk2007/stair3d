# Constraints & Validation

This document describes the CONSTRAINT and TECHNICAL VALIDATION stage introduced on top of
the already-consolidated Tread/Riser/Post/Stringer model/solver/renderer architecture (see
[CONSOLIDATION.md](CONSOLIDATION.md) and `CLAUDE.md`). It does not change how geometry is
*solved* — it adds a layer that checks the solved geometry, in two deliberately distinct ways.

## 1. Constraint vs Validation — the mandatory distinction

| | **Geometric/structural CONSTRAINT** | **Technical VALIDATION rule** |
|---|---|---|
| Question it answers | "Is this even a staircase?" | "Is this staircase *acceptable*, under a chosen profile?" |
| Where it lives | `src/constraints/geometricConstraints.js` | `src/rules/` (catalogue, unchanged) + `src/validation/` (the new wiring) |
| Severity | Always `ERROR` — a violation means the solver itself produced broken geometry | `ERROR`/`WARNING`/`INFO`, per rule |
| Depends on jurisdiction/profile? | No — a self-intersecting tread is wrong everywhere | Yes — e.g. max riser height differs by building type and country |
| Example | Paired stringers must stay parallel and correctly spaced | Recommended tread depth; maximum legal riser height |

A self-intersecting tread polygon is a **constraint** violation (fatal geometry error) — it is
never "just a warning". A comfortable-but-not-legally-required tread depth is a **validation**
rule — it is never treated as a hard invariant the solver must enforce. Mixing these two was
explicitly disallowed for this stage; see the tests in
`src/constraints/__tests__/geometricConstraints.test.js` (constraints only) vs
`src/validation/__tests__/pipeline.test.js` (both layers, kept in clearly separate pipeline
stages).

## 2. Constraint model

`src/constraints/geometricConstraints.js` exports one small, pure predicate function per
invariant, each returning `Diagnostic[]` (empty = satisfied) from already-built MODEL data
(`TreadModel[]`, `StringerModel`) — never from a `THREE.Mesh`, never with renderer-specific
conditionals:

- `checkStepOrdering` — tread index and elevation strictly increase.
- `checkEdgeDirectionSemantics` — `backEdge` genuinely lies "after" `frontEdge` along the
  tread's own walking direction (a dot-product test) — protects the `frontEdge`/`backEdge`
  naming from silently becoming a lie.
- `checkNoZeroLengthEdges` / `checkNoNegativeTreadWidth` — no degenerate edges or widths.
- `checkOutlineNotSelfIntersecting` — a tread's own outline polygon is simple (brute-force
  proper-intersection test over its small vertex set — see `pathUtils.js`'s new
  `segmentsProperlyIntersect`).
- `checkTopologicalContinuity` — consecutive treads share their boundary point exactly, on
  both inner and outer sides (this is what "continuous through landings and winders" means for
  a chain of quads).
- `checkStringerReferenceLinesStraight` — wraps `stringerModel.js`'s existing
  `assertReferenceLineIsStraight` per segment, converting a thrown internal-consistency error
  into a `Diagnostic` instead of an exception.
- `checkStringerPairInvariants` — wraps the existing `checkParallelAndSpaced` for outer/inner
  segment pairs (only where segment topology 1:1-matches — see the function's own doc comment
  for why a differing-topology case is skipped rather than guessed at).
- `checkBearingAttachment` — every `StringerTreadBearing.treadIndex` refers to a real tread.

`evaluateGeometricConstraints({ treadModels, stringerModels, config })` aggregates all of the
above. Manual edits need no separate constraint path: `edgeOverrides.js` already has its own
admission-time guard (a `signedArea` sign/magnitude heuristic) that rejects most obviously
degenerate edits before they reach a tread; `checkOutlineNotSelfIntersecting` is a stronger,
independent, defense-in-depth check run *after* the solver, catching shapes (e.g. a bowtie
quad) the lighter area heuristic could in principle miss — see the "negative, hand-built"
tests in `geometricConstraints.test.js`, which construct a corrupted model directly rather
than trying to coax the UI into producing one (the point of testing at the model level).

## 3. Technical rule model (unchanged data, newly wired)

`src/rules/` (catalogue, profiles, `checks.js`, `validator.js`) already existed from an
earlier stage and is **unchanged in shape** — every rule still has `ruleId`, `category`,
`description`, `ruleType`, `jurisdiction`, `source`, `severity`, `blocksGeneration`, and
optional `scope`/`configRefs`/`needsVerification`. What changed is that it is now **wired to
real geometry** for the first time:

- **`src/geometry/walklineModel.js`** (new) — the walkline as a first-class object
  (`origin`, `direction`, `offset`, per-tread `points`), built from an already-solved
  `planLayout` (never re-derives geometry independently of it). `treadGoingAtOffsetFromInner`
  measures a winder tread's going at a *fixed* distance from its inner edge — exactly what
  `PL-LEGAL-C-01` ("min. 250mm measured 400mm from the dusza") requires, independent of
  whatever `config.walklineOffset` this project happens to use.
- **`src/validation/facts.js`** (new) — the adapter: `buildFacts(config, derived, planLayout,
  treadModels)` turns a real, solved staircase into the plain `facts` object
  `src/rules/checks.js` already expected but nothing previously computed. This is the file
  that ends "not yet wired into `buildStaircase.js`" for the ergonomic/legal rule layer — and
  it is intentionally its own file, importing `src/geometry/` read-only, so the geometry engine
  itself never imports `src/rules/` and stays independent of jurisdiction (requirement 4).
- **`src/rules/checks.js`** gained one new entry, `PL-LEGAL-C-01` (winder width), evaluated
  per winder tread via `facts.winderTreads` — every other existing check is untouched.
- **`src/validation/toDiagnostics.js`** (new) — converts a `Finding[]` (from the existing
  `validateFacts`) into the same `Diagnostic[]` shape the constraint layer produces, so a
  caller never needs two result shapes.

Profiles (`POLAND_RESIDENTIAL_TIMBER_DEFAULT`, bundling the legal/best-practice/manufacturing/
user-preference layers) are consumed exactly as before via `resolveProfile()` — nothing in
this stage changed how a profile is composed, only how its resulting rule list gets facts to
check against.

## 4. Data flow

```
config (incl. manualEdgeOverrides)
  │
  ▼
runValidationPipeline(config, profileId)          [src/validation/pipeline.js]
  │
  ├─ 1. BASIC_NUMERIC            — sanity-checks raw config fields, no geometry built yet
  │
  ├─ (build) deriveStairData → buildPlanLayout     — same solver as buildStaircase.js
  │
  ├─ 2. TOPOLOGY                 — did the plan come out structurally sound?
  │
  ├─ (build) buildTreadModels / buildRiserModels / buildStringerModelsForFlight
  │
  ├─ 3. GEOMETRIC_CONSTRAINTS    — evaluateGeometricConstraints(...)
  │
  ├─ resolveProfile(profileId) → rules
  ├─ buildFacts(config, derived, planLayout, treadModels) → facts
  │
  ├─ 4. ERGONOMICS   (rule categories A, D + B)
  ├─ 5. WINDER       (rule category C)
  ├─ 6. STRINGER     (rule category F)
  ├─ 7. CONSTRUCTION (rule categories E, G, H, I)
  ├─ 8. MANUFACTURING(rule category J)
  │
  ▼
{ diagnostics: Diagnostic[], stages: {STAGE: Diagnostic[]}, hasErrors, models }
```

A stage only runs once every stage before it that could invalidate its inputs has reported no
`ERROR`. Stage 1 failing means stage 2 never runs (there is no safe way to build a plan from
numerically broken config); stage 2 failing means stages 3-8 never run (models built on
structurally broken topology would themselves be meaningless) — this is what "a later rule
must not conceal a failure of an earlier geometric rule" means operationally. Stages 3-8 all
run even if one of them reports an ERROR, since they are independent checks on the same,
already-valid models.

**Manual edits require no separate code path.** `config.manualEdgeOverrides` is just another
config field; `runValidationPipeline(config)` always rebuilds `planLayout`/models from
scratch and re-validates, so an edit is validated exactly the same way as any other config
change (requirement 8). If an edit would produce genuinely corrupted geometry,
`edgeOverrides.js`'s existing guard rejects it before it reaches a model at all (with a
console warning); this pipeline's constraint stage is the second, independent line of defense
against any case that guard doesn't catch.

## 5. Diagnostics

Both layers speak `src/diagnostics/diagnostic.js`'s one shape:

```js
{ ruleId, severity, elementType, elementId, value, expected, unit, message }
```

`createDiagnostic()` validates required fields and defaults the optional ones — no UI string
formatting happens in either `src/constraints/` or `src/validation/`; a UI consuming
`result.diagnostics` decides its own presentation (this file explicitly does not couple the
validator to the UI, per requirement 9).

## 6a. RiserModel nominal/final split (fixed — found by an end-to-end manual-edit trace)

A manual trace of `Step 7 manual edge moved → new PlanLayout → constraints → StringerSupport
changed → StringerModel changed → RiserModel changed → validation → 3D` (see git history for
the full trace transcript) found that the "RiserModel changed" step never actually happened:
`riserSolver.js` read `tread.innerChain`/`tread.outerChain` (straight/landing) or
`tread.winderInfo.frontEdge` (winder) to build a riser panel — both are RAW/NOMINAL
construction data, computed once by `planLayout.js` and never touched by
`edgeOverrides.js`. So a manual tread-edge edit correctly moved the tread's own outline and the
stringer's bearing (see §2/§3 above) but silently left every riser panel exactly where it was
before the edit — for every tread type except a landing, and there only by the accident of
landings having no raw chain to prefer. This was invisible to every existing unit test because
none of them checked "does an edit propagate into RiserModel" — it took tracing one concrete
edit through every stage by hand to surface it.

**Fix** — `RiserModel` now has the same explicit nominal/final split `TreadModel` already had,
reusing (not reimplementing) `treadSolver.js`'s own `nominalEdgesOf`/`edgesEqual`:

```js
RiserModel.frontEdge = {
  nominal: [inner, outer],   // construction reference — from the tread's raw chain, exactly
                              // TreadModel.frontEdge.nominal's source, NEVER used for panel position
  final:   [inner, outer],   // tread.frontEdge — after any manual edge override. THIS is what
                              // panels are built from.
  overridden: boolean,
}
```

- **Panel endpoints** (the physical, visible riser boundary) are now always built from
  `frontEdge.final` — for both the single straight/landing panel and every panel in a winder's
  N-panel fan (the fan's own inner/outer corners are `final[0]`/`final[1]`; only the
  interpolated interior fan points have no independent "final" value, since they were never a
  boundary to begin with).
  and reuses the same `outwardNormalFromOutline` every other straight/landing element already
  uses — no separate nominal reconstruction is needed there any more, because `tread.outline`
  itself is already final.
- **Panel direction** for a winder's fan stays the NOMINAL construction-reference direction
  (`tread.winderInfo.frontEdge.innerDirection`/`outerDirection`) — a deliberate, documented
  choice (see `riserSolver.js`'s header): there is no independently-computed "final direction"
  for a boundary inside a turn (direction comes from the solved turn geometry, not from a
  single dragged point), so treating it as final would be inventing geometry, not deriving it.
  `RiserFrontEdge.nominal` stays exposed specifically so a future construction/manufacturing
  rule could compare final-vs-nominal explicitly, instead of the choice being buried in an
  `if (tread.innerChain)` branch the way it was before.
- A new constraint, `CONSTRAINT-RISER-FOLLOWS-FINAL-EDGE`
  (`checkRiserFollowsFinalTreadEdge` in `geometricConstraints.js`), checks exactly this
  invariant on every riser going forward — it is now impossible for this specific regression to
  reoccur silently.

Regression tests: `src/geometry/__tests__/riserModel.test.js` (nominal/final split; Test A —
straight; Test B — winder, inner untouched/outer follows the edit, direction stays nominal;
Test C — unedited case is bit-identical; shared-boundary canonicalness), plus
`src/geometry/__tests__/manualEdgeConsistency.test.js` (Test D — the SAME edit checked against
StringerModel and RiserModel together) and `src/geometry/__tests__/riserRenderer.test.js`
(Test E — the actual `THREE.BufferGeometry` bounding box moves, as a pure downstream
consequence of the model change, never a renderer-level fix).

## 6. What is NOT done in this stage

- **Not wired into `main.js`/`ui.js`/`buildStaircase.js`.** `runValidationPipeline` exists,
  is fully tested, and is the intended integration point — but no UI currently calls it. This
  mirrors the same deliberate staging already used for the rules/profiles system before this
  stage (see `docs/rules/PROFILES.md`).
- **`checks.js` coverage is not exhaustive.** Most catalogue rules still have no evaluable
  check (same as before this stage — see `hasCheck()`/`getUnevaluated()`); this stage adds
  exactly the one check needed to prove winder-width validation is wired end-to-end
  (`PL-LEGAL-C-01`), not a full audit of every rule in the catalogue.
- **`checkStringerPairInvariants` is skipped, not solved, when outer/inner segment topology
  differs** (different segment counts between the two sides) — a real limitation, not silently
  papered over; see the risks section in the final stage summary delivered in-chat.
