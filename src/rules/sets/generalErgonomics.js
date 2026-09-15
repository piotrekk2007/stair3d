// Widely-shared ergonomic conventions with no single national legal source — these are the
// "everyone's textbook cites this" rules (Blondel's original step formula, comfort/safety
// consistency conventions repeated across many national codes without being identical in any
// one of them). jurisdiction GENERAL means exactly that: not tied to PL or UK law, cited here
// as ENGINEERING_GUIDANCE / INDUSTRY_BEST_PRACTICE only.

import { defineRuleSet } from '../schema.js';

export const generalErgonomics = defineRuleSet([
  {
    ruleId: 'GEN-ERGO-B-01',
    category: 'B',
    description:
      'Blondel\'s step formula (1672): the sum of one going and two risers approximates a comfortable human stride length. Modern codes narrow the historical ~600-640mm band differently (see PL-LEGAL-A-01 for the binding Polish band, UK-LEGAL-A-01 for the UK band) — this entry records the underlying ergonomic principle, not a jurisdiction-specific numeric limit.',
    condition: '2*riserHeight + treadGoing ~= stride length (~600-640mm, historical basis for all modern 2R+G bands)',
    configRefs: ['riserHeight', 'treadGoing'],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'François Blondel, Cours d\'architecture (1675); cited as the historical basis for the 2R+G formula in essentially all modern staircase codes/guides reviewed (PL Warunki Techniczne, UK Approved Document K, BWF Guide)',
    severity: 'INFO',
    blocksGeneration: false,
    notes: 'Do not implement as a standalone gating rule — it is superseded in force by the specific legal rules (PL-LEGAL-A-01, UK-LEGAL-A-01) that already encode a jurisdiction\'s chosen numeric band.',
  },
  {
    ruleId: 'GEN-ERGO-B-02',
    category: 'B',
    description:
      'A steeper stair (higher riser, shorter going) is used for infrequent-access/utility circulation; a shallower stair (lower riser, longer going) is preferred for frequent, comfortable, primary circulation. This is a design-intent principle, not a single numeric threshold.',
    condition: 'riserHeight/treadGoing ratio should be chosen deliberately per stair role (primary vs. secondary/utility)',
    configRefs: ['riserHeight', 'treadGoing'],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'GENERAL',
    source: 'Common architectural design convention, consistent with the differentiated riser/going bands set by both PL Warunki Techniczne §68 (different max riser by building type) and UK Approved Document K (different R/G bands, e.g. loft-stair vs. standard stair)',
    severity: 'INFO',
    blocksGeneration: false,
  },
  {
    ruleId: 'GEN-ERGO-B-03',
    category: 'B',
    description: 'Riser height should be consistent within a single flight — variation between consecutive risers is a well-established trip hazard, independent of the exact numeric tolerance a given jurisdiction enforces.',
    condition: 'max(riserHeight_i) - min(riserHeight_i) should approach 0 within one flight; some jurisdictions set an explicit tolerance (e.g. US IRC: <=9.5mm, see US-REF-C-03 for the analogous winder-going tolerance)',
    configRefs: ['riserHeight'],
    ruleType: 'INDUSTRY_BEST_PRACTICE',
    jurisdiction: 'GENERAL',
    source: 'Widely-cited safety principle in stair ergonomics literature; the project\'s current model already guarantees this by construction (single computed riserHeight applied uniformly), so this rule mainly matters as a REGRESSION GUARD once manual edge overrides or per-tread geometry become editable in ways that could break uniform riser height.',
    severity: 'WARNING',
    blocksGeneration: false,
  },
  {
    ruleId: 'GEN-ERGO-B-04',
    category: 'B',
    description: 'Tread going should be consistent within a straight flight (each straight tread the same depth); tapered/winder treads should be consistent with each other along the walkline, per the winder-specific rules in category C.',
    condition: 'going(straight_i) == going(straight_j) within one straight run',
    configRefs: ['treadGoing'],
    ruleType: 'INDUSTRY_BEST_PRACTICE',
    jurisdiction: 'GENERAL',
    source: 'Companion principle to GEN-ERGO-B-03; formalised for winders specifically by UK-LEGAL-C-01',
    severity: 'WARNING',
    blocksGeneration: false,
  },
  {
    ruleId: 'GEN-ERGO-B-05',
    category: 'B',
    description:
      'Recommended comfortable riser-height range for primary residential circulation stairs — narrower than any single jurisdiction\'s bare legal maximum, reflecting adult gait comfort rather than a minimum safety threshold.',
    condition: '170 mm <= riserHeight <= 190 mm',
    configRefs: ['riserHeight'],
    scope: { locations: ['internal'] },
    ruleType: 'INDUSTRY_BEST_PRACTICE',
    jurisdiction: 'GENERAL',
    source: 'Widely repeated in stair-design literature and trade guidance as a comfort optimum (e.g. consistent with the BWF/UK "steeper for utility, shallower for primary" framing in GEN-ERGO-B-02) — not a single primary standard, hence jurisdiction GENERAL rather than a specific citation.',
    severity: 'WARNING',
    blocksGeneration: false,
    notes:
      'This is the concrete, evaluable form of GEN-ERGO-B-02. It exists specifically to demonstrate the four-layer distinction requested for the profile system: this "comfortable" range is DIFFERENT from a jurisdiction\'s legal maximum (e.g. PL-LEGAL-A-05a: riserHeight <= 190mm) and different again from a company\'s or a client\'s own preferred range (see manufacturingAssumptions.js CO-STD-B-01, userDesignPreferences.js USER-PREF-B-01).',
  },
  {
    ruleId: 'GEN-ERGO-A-01',
    category: 'A',
    description: 'A single flight should allow two people to pass without both turning sideways once the flight is used as shared/primary circulation — a wider ergonomic threshold than the bare legal minimum width for solitary use.',
    condition: 'stairWidth >= ~1.0-1.1 m for comfortable two-person passing (contextual, not a single hard legal number)',
    configRefs: ['stairWidth'],
    ruleType: 'INDUSTRY_BEST_PRACTICE',
    jurisdiction: 'GENERAL',
    source: 'General architectural ergonomics convention; consistent with UK Scotland\'s explicit 800mm "with handrail both sides" vs 900mm baseline distinction (see UK-LEGAL-A-01 notes) and PL\'s tiered minimums by building type (PL-LEGAL-A-05)',
    severity: 'INFO',
    blocksGeneration: false,
  },
]);
