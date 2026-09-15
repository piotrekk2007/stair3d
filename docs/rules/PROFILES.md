# Staircase Design Profile system

This document explains the **profile and validation layer** built on top of the technical
rules catalogue (see [`TECHNICAL_RULES_CATALOGUE.md`](TECHNICAL_RULES_CATALOGUE.md)). It
covers `src/rules/profiles/`, `src/rules/checks.js`, and `src/rules/validator.js`.

**Status: implemented as a standalone, importable module. Not yet wired into `buildStaircase.js`,
`main.js`, or the UI.** The only change made to the geometry/model side of the app is one new,
inert field on the default config (`designProfileId`) — see "What is not wired up yet" below.

## The problem this solves

The same geometric solver can be checked against different, independently-editable sets of
rules. A single number — say, riser height — is judged differently by up to **four layers**,
and the same numeric value can pass one layer while failing another:

1. **Legal maximum** (jurisdiction: Poland) — what the law *permits*.
2. **Industry best practice** — what is *comfortable*, independent of any one country's law.
3. **Company manufacturing rules** — what *this workshop* prefers to build, given its jigs,
   stock, and house style.
4. **User design preferences** — what *this specific client/project* asked for, narrower
   still.

These four are never merged into one number. Each is a separate, independently-swappable
rule layer, and the validator always reports which layer a finding came from.

## The four layers, concretely

| Layer | Example rule (riser height) | Value | ruleType | jurisdiction |
|---|---|---|---|---|
| Legal | `PL-LEGAL-A-05a` | `<= 190 mm` | `LEGAL_REQUIREMENT` | `PL` |
| Industry best practice | `GEN-ERGO-B-05` | `170–190 mm` | `INDUSTRY_BEST_PRACTICE` | `GENERAL` |
| Company manufacturing rules | `CO-STD-B-01` | `150–180 mm` | `USER_DEFINED_COMPANY_STANDARD` | `COMPANY` |
| User design preferences | `USER-PREF-B-01` (example only) | `<= 170 mm` | `USER_DESIGN_PREFERENCE` | `PROJECT` |

Each narrows the one before it. A design profile does not require this nesting (a company
could in principle prefer a *wider* range than the comfort guidance), but in the common case
each layer is the most-specific override of the ones above it.

### Worked example: riserHeight = 183mm

Running the validator (see "How to use it" below) against the default profile for exactly
this value produces:

```
[PL-LEGAL-A-05a] Reguła SPEŁNIONA — wymóg prawny, jurysdykcja: PL.
  Sprawdzenie: OK (wartość: 900mm, wymagane: >= 800mm); OK (wartość: 183mm, wymagane: <= 190mm)

[GEN-ERGO-B-05] Reguła SPEŁNIONA — dobra praktyka branżowa, jurysdykcja: GENERAL.
  Sprawdzenie: OK (wartość: 183mm, wymagane: 170–190mm)

[CO-STD-B-01] Reguła NARUSZONA [severity: WARNING, tylko ostrzeżenie] — standard firmowy, jurysdykcja: COMPANY.
  Sprawdzenie: NIE SPEŁNIONO (wartość: 183mm, wymagane: 150–180mm)
```

183mm is **legal** and **comfortable**, but violates **this company's** narrower house
standard (150–180mm) — exactly the distinction the task required, produced by the real
code, not asserted in prose. Adding the example user-preference layer
(`USER-PREF-B-01`, `<= 170mm`) makes 183mm fail that fourth layer too, with its own
independent explanation citing "ten projekt" (this project) as the jurisdiction.

## Architecture

```
src/rules/
  schema.js                    Rule shape + RULE_TYPES/JURISDICTIONS/SEVERITIES/CATEGORIES
                                + RuleScope (buildingTypes/materials/locations) +
                                ruleAppliesToContext(rule, context)
  checks.js                    Pure predicate functions per ruleId — the ONLY place that
                                turns a rule's condition into a real evaluation
  validator.js                 validateFacts(facts, rules) -> Finding[]
                                explainFinding(finding) -> readable Polish explanation
  sets/
    plWarunkiTechniczne.js     LEGAL_REQUIREMENT, jurisdiction PL (scoped per building type)
    bwfIndustryGuidance.js     mixed: UK-LEGAL (reference only) + INDUSTRY_BEST_PRACTICE
    generalErgonomics.js       INDUSTRY_BEST_PRACTICE / ENGINEERING_GUIDANCE, jurisdiction GENERAL
    manufacturingAssumptions.js  MANUFACTURING_ASSUMPTION / USER_DEFINED_COMPANY_STANDARD, COMPANY
    userDesignPreferences.js   factory + example, USER_DESIGN_PREFERENCE, jurisdiction PROJECT
    validationMeta.js          category K meta-rules (unrelated to profiles directly)
  profiles/
    schema.js                  DesignProfile shape (profileId, label, context, 4 layer ids)
    definitions.js              *_PROFILE_SOURCES maps (the swappable layers) + DESIGN_PROFILES
    compose.js                  resolveProfile(id) -> filters each layer by context, flattens
```

A **DesignProfile** is a name plus four ids, one per layer, plus a `context` (building type /
material / location) used to scope the legal and best-practice layers:

```js
POLAND_RESIDENTIAL_TIMBER_DEFAULT: {
  profileId: 'POLAND_RESIDENTIAL_TIMBER_DEFAULT',
  label: 'Polska — dom jednorodzinny, schody drewniane (domyślny)',
  context: { buildingType: 'single_family', material: 'timber', location: 'internal' },
  legal: 'POLAND_RESIDENTIAL_TIMBER',
  bestPractice: 'TIMBER_INDUSTRY_BEST_PRACTICE',
  manufacturing: 'COMPANY_MANUFACTURING_RULES_DEFAULT',
  userPreferences: 'USER_DESIGN_PREFERENCES_EMPTY',
}
```

`resolveProfile()` never copies rule data — it filters the existing arrays in `src/rules/sets/`
by `ruleAppliesToContext`. `POLAND_RESIDENTIAL_TIMBER` is not a separate file of Polish law;
it is the full `plWarunkiTechniczne` set, scoped down to `buildingType: 'single_family'` at
resolution time. This is why `PL-LEGAL-A-03a` (max 17 steps) correctly disappears for a
single-family project — that rule's `scope.buildingTypes` excludes `single_family` because
the regulation itself exempts single-family homes, not because the profile hides it.

## Independence guarantee

Each of the four layers can be replaced without touching the other three or any rule's
source data:

- Swap `legal: 'POLAND_RESIDENTIAL_TIMBER'` for a future `'GERMANY_RESIDENTIAL_TIMBER'` once
  that rule set exists — `bestPractice`/`manufacturing`/`userPreferences` are untouched.
- Add a second company's manufacturing rules as `COMPANY_MANUFACTURING_RULES_ACME` in
  `MANUFACTURING_PROFILE_SOURCES` — every existing profile keeps using the default.
- Give one project its own `userPreferences` array — no other project, and no shared rule
  set, is affected (see `sets/userDesignPreferences.js`, designed to be created per-project).

## How the validator explains a failure

`validator.js`'s `explainFinding()` always states, for every finding:

1. The `ruleId` and verdict (SPEŁNIONA / NARUSZONA / not evaluable).
2. The rule's **type in plain language** (wymóg prawny / dobra praktyka branżowa / standard
   firmowy / preferencja projektowa klienta / wytyczna inżynierska / założenie produkcyjne) —
   so a legal violation is never visually or textually confused with a company preference.
3. The **jurisdiction**.
4. The **actual value vs. the required value/range** for every criterion the rule checks.
5. **Severity and whether it blocks generation.**
6. **The citable source.**

A rule with no entry in `checks.js` is reported as "brak automatycznej oceny liczbowej —
wymaga ręcznej weryfikacji" (no automatic numeric evaluation — needs manual review) rather
than silently treated as passing. Coverage in `checks.js` is intentionally partial today
(riser height plus the Blondel formula) — extending it rule-by-rule, with each new check
tied to a specific `ruleId`, is future work.

## How to use it (current API)

```js
import { resolveProfile } from './src/rules/profiles/compose.js';
import { validateFacts, explainAll, getFailures } from './src/rules/validator.js';

const { profile, rules } = resolveProfile('POLAND_RESIDENTIAL_TIMBER_DEFAULT');

const facts = {
  buildingType: 'single_family',
  stairLocation: 'internal',
  stairMaterial: 'timber',
  riserHeight: 183,   // mm
  treadGoing: 270,    // mm
  stairWidth: 900,    // mm
};

const findings = validateFacts(facts, rules);
console.log(explainAll(findings));
console.log('Failures:', getFailures(findings).map((f) => f.rule.ruleId));
```

## What is not wired up yet

- **`config.designProfileId`** (new field, default `'POLAND_RESIDENTIAL_TIMBER_DEFAULT'`) is
  the only change made to `src/config/schema.js`. It is purely informational — nothing in
  `deriveStairData`, `buildPlanLayout`, or any geometry file reads it. It exists solely so a
  project can answer "which profile is this being checked against right now?", per the task
  requirement that a project must indicate its active profile.
- **No `facts` adapter exists yet** that converts a real `config`/`derived` object into the
  `facts` shape `checks.js` expects. `buildingType`/`stairMaterial`/`stairLocation` do not
  exist as config fields today (noted as a gap in the technical rules catalogue, e.g.
  `PL-LEGAL-A-05a` notes). Building that adapter, and calling the validator from `main.js` to
  show findings in the UI, is deliberately left for a future pass — this pass is the profile
  and validation *system*, not its UI integration.
- **`checks.js` covers a curated subset of rules** (riser height, Blondel formula) to prove
  the four-layer distinction end-to-end. It does not yet cover every rule in the catalogue.
