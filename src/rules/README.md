# Technical rules layer

This directory holds the **staircase design knowledge base** — a catalogue of externally
sourced or explicitly company-defined rules, kept completely separate from geometry code.
See [`docs/rules/TECHNICAL_RULES_CATALOGUE.md`](../../docs/rules/TECHNICAL_RULES_CATALOGUE.md)
for the human-readable version of every rule listed here.

## Why this is its own layer

Per `.claude/RULES.md` rule 10, validation is a separate concern from model/solver/rendering.
This directory is one step earlier than validation: it is the **knowledge** a validation
engine will eventually consume. Nothing here evaluates a `config` or `planLayout` — there is
no geometry import anywhere in `src/rules/`. That is deliberate: this is a data layer,
implemented, then wired to real validation later.

## Why rule sets are split into separate files

The task that produced this catalogue was explicit: **do not mix Polish legal requirements
with general industry recommendations.** That is enforced structurally, not just by
convention:

- [`sets/plWarunkiTechniczne.js`](sets/plWarunkiTechniczne.js) — Polish binding law only
  (`ruleType: LEGAL_REQUIREMENT`, `jurisdiction: PL`). Nothing else may live in this file.
- [`sets/eurocodeStructural.js`](sets/eurocodeStructural.js) — Eurocode 5 / EN 1991
  structural methods and principles (`ENGINEERING_GUIDANCE`, `jurisdiction: EU`). A Eurocode
  is only binding once a National Annex sets a value — Polish-binding figures go in the PL
  file instead, tagged `needsVerification` where the Polish Annex value could not be
  confirmed.
- [`sets/bwfIndustryGuidance.js`](sets/bwfIndustryGuidance.js) — British Woodworking
  Federation Timber Stair Design Guide content and the UK Building Regulations it cites
  (`jurisdiction: UK`). UK Building Regulations rules ARE `LEGAL_REQUIREMENT` — but only in
  the UK. They are recorded here as comparative reference and must never gate generation for
  a PL-jurisdiction project.
- [`sets/generalErgonomics.js`](sets/generalErgonomics.js) — conventions with no single
  national source (`jurisdiction: GENERAL`), e.g. Blondel's historical step formula.
- [`sets/manufacturingAssumptions.js`](sets/manufacturingAssumptions.js) — workshop/company
  defaults with no external citation at all (`jurisdiction: COMPANY`,
  `MANUFACTURING_ASSUMPTION` / `USER_DEFINED_COMPANY_STANDARD`). These must stay trivially
  editable per company.
- [`sets/validationMeta.js`](sets/validationMeta.js) — category K, rules about how the other
  rule sets combine (jurisdiction selection, severity defaults, independence guarantees).

**Adding a new rule set never requires editing an existing one.** Register it in
[`catalogue.js`](catalogue.js)'s `RULE_SETS` map; every existing set is untouched.

## Rule shape

See [`schema.js`](schema.js) for the full `Rule` shape and the four enums (`CATEGORIES`,
`RULE_TYPES`, `SEVERITIES`, `JURISDICTIONS`). Every rule must declare, at minimum: which of
the five `ruleType`s it is (`LEGAL_REQUIREMENT`, `ENGINEERING_GUIDANCE`,
`INDUSTRY_BEST_PRACTICE`, `MANUFACTURING_ASSUMPTION`, `USER_DEFINED_COMPANY_STANDARD`), which
`jurisdiction` it applies in, a citable `source`, and a `severity` with an explicit
`blocksGeneration` boolean.

`condition` is a **formula string**, not executable code — e.g.
`"0.6 m <= 2*riserHeight + treadGoing <= 0.65 m"`. This catalogue intentionally stops short of
writing an evaluation engine (out of scope for this pass); when one is built, it should parse
or reimplement these conditions against real `config`/derived values, using `configRefs` as
the field-name contract.

## What is *not* here

- No geometry, no Three.js, no reference to `planLayout`/`buildStaircase` — this catalogue
  must not create a dependency in either direction with `src/geometry/`.
- No reverse-engineered or proprietary commercial-software logic — every rule cites a public
  regulation, standard, or trade-body guide, or is explicitly marked as this project's own
  manufacturing placeholder.
- No enforcement/UI wiring yet — `catalogue.js` only aggregates and queries data.

## Profiles and validation

This directory also contains the **Staircase Design Profile system**
(`profiles/`, `checks.js`, `validator.js`) built on top of the rule sets described above —
see [`docs/rules/PROFILES.md`](../../docs/rules/PROFILES.md) for the full explanation,
including the worked example distinguishing a Polish legal maximum, a general comfort
recommendation, a company house standard, and a per-project user preference for the same
riser-height value. In short:

- `profiles/definitions.js` names four independently-swappable rule layers (legal,
  industry-best-practice, company-manufacturing, user-preference) and bundles them into
  named `DesignProfile`s (e.g. `POLAND_RESIDENTIAL_TIMBER_DEFAULT`).
- `profiles/compose.js` resolves a profile by filtering each layer's source rules against the
  profile's context (`buildingType`/`material`/`location`) — it never copies rule data.
- `checks.js` holds the only executable rule-evaluation logic in this whole layer, as small
  pure functions keyed by `ruleId`, operating on a plain `facts` object.
- `validator.js` runs those checks and produces `Finding`s with a full, human-readable
  explanation of why each rule passed, failed, or could not be evaluated.
- `config.designProfileId` (in `src/config/schema.js`) records which profile a project is
  currently checked against — informational only, not read by any geometry code.

## Known gaps flagged during authoring

Two rules are marked `needsVerification: true` because a primary source could not be
confirmed in the research pass that produced this catalogue:

- `PL-LEGAL-D-01` (Polish minimum headroom — found as 2.05m only via secondary sources)
- `PL-LEGAL-I-01` (Polish National Annex imposed load value for stairs)

Both default to `severity: WARNING`, `blocksGeneration: false` — `schema.js`'s
`assertValidRule` throws if a rule is ever marked both `needsVerification` and
`blocksGeneration: true`, so this cannot regress silently.
