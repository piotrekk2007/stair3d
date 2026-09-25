// Eurocode-derived structural principles: EN 1995-1-1 (Eurocode 5, timber structures),
// EN 1991-1-1 (imposed loads), EN 1912 (strength class assignment), prEN 16481 (timber
// stair structural design calculation methods).
//
// These are ruleType ENGINEERING_GUIDANCE (methods/standards), NOT Polish law by
// themselves — a Eurocode only becomes a LEGAL_REQUIREMENT once a country's National
// Annex sets binding values, which is why the one Polish-binding figure we could not
// verify lives in plWarunkiTechniczne.js (PL-LEGAL-I-01) instead of here. Do not add
// prescriptive UK National Annex figures here either — those belong in
// bwfIndustryGuidance.js, tagged jurisdiction UK, since they only bind in the UK.
//
// This set intentionally does NOT copy prEN 16481's calculation models or BWF's
// prescriptive span/thickness tables verbatim — per instructions, we record the
// *engineering principle* (what must be checked, and under what idealisation) so a
// future solver can implement its own calculation, not someone else's table.

import { defineRuleSet } from '../schema.js';

export const eurocodeStructural = defineRuleSet([
  {
    ruleId: 'EC5-STRUCT-I-01',
    category: 'I',
    description:
      'A stair tread may be idealised as a simply-supported (or, for continuous strings, multi-span) timber beam for bending/shear/deflection checks, loaded per the applicable imposed-load standard.',
    condition: 'M_Ed <= M_Rd ; V_Ed <= V_Rd ; deflection under quasi-permanent load <= serviceability limit (project-specific, see EC5-STRUCT-I-04)',
    configRefs: ['treadThickness', 'treadGoing', 'stairWidth'],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'EN 1995-1-1:2004+A1:2008 (Eurocode 5), general bending-member design; principle also stated in BWF Timber Stair Design Guide 2013 §6.1/Table 6.2 (which computes example thicknesses FROM this assumption — the assumption itself, not the resulting UK table, is what is recorded here)',
    severity: 'WARNING',
    blocksGeneration: false,
    notes:
      'This is a methodological rule, not a numeric one — it says HOW a future structural module should check a tread, not what dimension to use. Reduced tread sizes are achievable with a more rigorous whole-stairwell analysis (stated explicitly in BWF guide) — i.e. the simply-supported idealisation is conservative, not the only correct model.',
  },
  {
    ruleId: 'EC5-STRUCT-I-02',
    category: 'I',
    description:
      'Timber strength/stiffness properties (E, f_m,k) must be selected per an assigned strength class (e.g. C24 softwood, D30/D40/D50 hardwood), determined from visual/machine grading, not assumed from species name alone.',
    condition: 'timberGrade -> {E, f_m,k, f_v,k, ...} per assigned strength class table',
    configRefs: [],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'EN 1912:2012, Structural timber — Strength classes — Assignment of visual grades and species',
    severity: 'WARNING',
    blocksGeneration: false,
    notes: 'Wired: config.structuralMaterialClass (C24/D30/D40, default D30 for oak — an assumption, grading per EN 1912 decides) selects the class for the orientative structural check (src/structural/timberClasses.js, values needsVerification). config.timberGrade stays the takeoff/pricing field.',
  },
  {
    ruleId: 'EC5-STRUCT-I-03',
    category: 'I',
    description:
      'Design values must be adjusted for load-duration class and service class (moisture environment) via k_mod, not treated as constant regardless of environment.',
    condition: 'X_d = k_mod * X_k / gamma_M',
    configRefs: [],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'EN 1995-1-1:2004+A1:2008 §2.3, §3.1.3',
    severity: 'WARNING',
    blocksGeneration: false,
    notes: 'Service Class 1 (heated interior, avg. moisture content <=12%) is the applicable class for the vast majority of domestic timber staircases — see BWF-GUID-E-01 for the moisture-content figures this class is built from.',
  },
  {
    ruleId: 'EC5-STRUCT-I-04',
    category: 'I',
    description:
      'Serviceability (deflection/vibration "bounce" under dynamic pedestrian loading) must be checked per EC5 Section 7, in addition to ultimate limit state strength — a stair can pass a strength check and still fail in use if it feels unacceptably springy.',
    condition: 'w_inst, w_net,fin <= project-specific serviceability limits (span- and use-dependent, not a single universal constant)',
    configRefs: [],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'EN 1995-1-1:2004+A1:2008 Section 7; referenced directly by BWF Timber Stair Design Guide 2013 §3.2 ("serviceability limit state for a staircase shall be determined in accordance with Section 7 of Eurocode 5")',
    severity: 'WARNING',
    blocksGeneration: false,
  },
  {
    ruleId: 'EC5-STRUCT-I-05',
    category: 'I',
    description:
      'Metal connectors carrying structural load (screws, nails, bolts) must be sized per Eurocode 5 connection design, not selected by convention alone.',
    condition: 'F_v,Ed <= F_v,Rd (per connector type, per EC5 Ch. 8)',
    configRefs: [],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'EN 1995-1-1:2004+A1:2008 Chapter 8; BWF Timber Stair Design Guide 2013 §4.5.2',
    severity: 'WARNING',
    blocksGeneration: false,
  },
  {
    ruleId: 'EC5-STRUCT-F-01',
    category: 'F',
    description:
      'A staircase\'s stringer/tread structural system is classified by string type (closed vs. cut) and by whether treads are cross-braced — this classification changes the correct static (beam) model, so it must be chosen deliberately, not implied by geometry alone.',
    condition: 'staticModel = f(stringType: closed|cut, crossBracing: yes|no, risers: with|without)',
    configRefs: [],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'prEN 16481, Timber stairs — Structural design — Calculation methods (as summarised in BWF Timber Stair Design Guide 2013 §8, Table 8.1)',
    severity: 'INFO',
    blocksGeneration: false,
    notes:
      'Directly relevant to the prior geometry audit: the current stringerGeometry.js has no concept of "closed vs. cut string" at all — it treats every stringer as a flat panel per tread-chain segment. A future stringerLayout solver should make this classification an explicit, named model input, not an emergent side effect of panel generation.',
  },
  {
    ruleId: 'EC5-STRUCT-F-02',
    category: 'F',
    description:
      'Connections between components (tread-to-string, string-to-newel, string-to-structure) must be modelled as loose-jointed (no moment transfer), rigid, or deformable — the choice affects the structural analysis, not just the joinery detail.',
    condition: 'connectionModel in {loose-jointed, rigid, deformable}',
    configRefs: [],
    ruleType: 'ENGINEERING_GUIDANCE',
    jurisdiction: 'EU',
    source: 'prEN 16481 (as summarised in BWF Timber Stair Design Guide 2013 §8 "Joints")',
    severity: 'INFO',
    blocksGeneration: false,
  },
]);
