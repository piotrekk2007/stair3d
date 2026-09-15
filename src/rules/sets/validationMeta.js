// Category K — meta-rules about how the OTHER rule sets must be combined and evaluated by
// a future validation engine. These are not staircase-geometry rules; they are architecture
// rules for the rules layer itself, written down so the eventual engine (see
// .claude/RULES.md rule 10 — validation is its own layer, separate from model/solver) has an
// explicit contract to satisfy instead of an implicit one buried in code.
//
// jurisdiction GENERAL/COMPANY throughout — these are project-architecture decisions, not
// citations from an external authority.

import { defineRuleSet } from '../schema.js';

export const validationMeta = defineRuleSet([
  {
    ruleId: 'META-K-01',
    category: 'K',
    description: 'A violation of a LEGAL_REQUIREMENT rule in the project\'s currently-selected legal jurisdiction defaults to severity ERROR and blocks generation of a "compliant" model — but the tool must still allow an explicit "as-built / legacy" mode that generates the geometry anyway with the violation surfaced, since the tool must also be able to model existing staircases that predate or fall outside current regulation.',
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'Derived from business goal 1 (generate a correct model from real, as-measured dimensions) — a real existing staircase must remain representable even when it would not be legal to build new today.',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'META-K-02',
    category: 'K',
    description: 'A violation of an ENGINEERING_GUIDANCE or INDUSTRY_BEST_PRACTICE rule defaults to severity WARNING and never blocks generation by itself.',
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'Project architecture decision, consistent with how BWF Timber Stair Design Guide itself frames its own content ("industry guidance — minimum requirements", not law) in its Foreword.',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'META-K-03',
    category: 'K',
    description: 'A violation of a MANUFACTURING_ASSUMPTION or USER_DEFINED_COMPANY_STANDARD rule defaults to severity INFO, unless the company operating the tool explicitly promotes it to a stricter severity in their own editable rule profile.',
    ruleType: 'USER_DEFINED_COMPANY_STANDARD',
    jurisdiction: 'COMPANY',
    source: 'Project architecture decision',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'META-K-04',
    category: 'K',
    description: 'Exactly one legal jurisdiction profile is active for a given project at a time (e.g. "PL"), selected explicitly by the user; rules from a non-selected legal jurisdiction (e.g. UK-LEGAL-* while PL is selected) must be evaluated as reference/comparison only and must never silently gate generation.',
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'Directly required by the task instruction: "Do not mix Polish legal requirements with general industry recommendations."',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'META-K-05',
    category: 'K',
    description: 'Each rule set (source file under src/rules/sets/) must be independently enabled/disabled without affecting any other set — disabling BWF-derived guidance must not remove Polish legal rules, and vice versa. This is guaranteed structurally by keeping one ruleType/jurisdiction pairing dominant per file (see src/rules/README.md) and by the catalogue aggregator treating each imported set as an opaque, independently-toggleable array.',
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'Directly required by the task instruction: "The architecture must allow these rule sets to be changed independently."',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'META-K-06',
    category: 'K',
    description: 'Every numeric condition attached to a rule must reference a named config/derived field (via configRefs) rather than an inline magic number, mirroring the project\'s own geometry rule: "every geometric rule must have a named constant or function."',
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: '.claude/RULES.md rule 11/12',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'META-K-07',
    category: 'K',
    description: 'A rule whose figure or clause could not be confirmed against a primary source during authoring must be marked needsVerification: true and must never be assigned blocksGeneration: true until it is confirmed — schema.js enforces this at the data-shape level (assertValidRule throws if both are set).',
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'Project architecture decision, applied to PL-LEGAL-D-01 and PL-LEGAL-I-01 in this catalogue',
    severity: 'INFO',
    blocksGeneration: false,
  },
]);
