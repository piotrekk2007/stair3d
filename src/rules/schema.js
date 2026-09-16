// Typed shape and enums for the technical rules layer (staircase design knowledge base).
//
// This module defines DATA ONLY — no geometry, no evaluation engine. It exists so that
// every rule set (src/rules/sets/*.js) shares one vocabulary, and so that a future
// validation engine (see .claude/RULES.md rule 10 — validation is its own layer) has a
// stable contract to consume. Do not add executable geometric checks here.

/**
 * @typedef {'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'} RuleCategory
 */
export const CATEGORIES = Object.freeze({
  A: 'Geometric rules',
  B: 'Ergonomic rules',
  C: 'Winder/walkline rules',
  D: 'Headroom rules',
  E: 'Construction rules for timber stairs',
  F: 'Stringer/stringboard rules',
  G: 'Tread/riser construction rules',
  H: 'Connection rules',
  I: 'Structural assumptions',
  J: 'Manufacturing constraints',
  K: 'Validation rules (meta-rules)',
});

// Legal standing of a rule — NEVER mix these within one rule set / source file.
// See src/rules/README.md for why this separation is architectural, not cosmetic.
export const RULE_TYPES = Object.freeze({
  LEGAL_REQUIREMENT: 'LEGAL_REQUIREMENT', // binding law/regulation in the stated jurisdiction
  ENGINEERING_GUIDANCE: 'ENGINEERING_GUIDANCE', // standards/codes of practice, structural methods (EC5, BS, prEN)
  INDUSTRY_BEST_PRACTICE: 'INDUSTRY_BEST_PRACTICE', // trade-body / manufacturer guidance, not law
  MANUFACTURING_ASSUMPTION: 'MANUFACTURING_ASSUMPTION', // workshop/production constraint, not a design law
  USER_DEFINED_COMPANY_STANDARD: 'USER_DEFINED_COMPANY_STANDARD', // company-wide policy, freely editable, no external source
  USER_DESIGN_PREFERENCE: 'USER_DESIGN_PREFERENCE', // ONE project/client's own narrowing choice, not a company-wide policy
  SOFTWARE_DESIGN_CHOICE: 'SOFTWARE_DESIGN_CHOICE', // an algorithmic/implementation decision made BY Stair3D itself —
  // not sourced from any law, standard, trade body, or company policy. Exists specifically so a
  // rule set can say "this is simply how our code works" instead of dressing an implementation
  // detail up as INDUSTRY_BEST_PRACTICE or MANUFACTURING_ASSUMPTION when no external authority
  // actually endorses it (see docs/STRINGER_CONSTRUCTION_SPEC.md for the case that required this).
});

// Whether a rule's claim has actually been checked against a source, is an unconfirmed
// judgment call, or is deliberately left to the user/company to set — a DIFFERENT axis from
// `ruleType` (which says WHOSE authority a rule claims) and from `needsVerification` (a
// narrower "the exact figure/clause is unconfirmed" flag on LEGAL/ENGINEERING rules). Optional;
// rules that predate this field simply don't set it.
export const RULE_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED', // checked against the cited source; the source really does say this
  ASSUMPTION: 'ASSUMPTION', // a judgment call made without a directly-supporting source
  CONFIGURABLE: 'CONFIGURABLE', // deliberately exposed as a user/company-adjustable parameter,
  // precisely because no single authoritative value exists — see config/schema.js.
});

// Which stringer construction type a rule applies to — 'both' for rules independent of the
// choice, null/omitted for rules that aren't stringer-construction-specific at all.
export const CONSTRUCTION_TYPE_SCOPES = Object.freeze({
  CUT: 'cut',
  CLOSED: 'closed',
  BOTH: 'both',
});

export const SEVERITIES = Object.freeze({
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

// A jurisdiction is not always a country — 'GENERAL' means "not tied to one legal system",
// 'COMPANY' means "defined by the tool's operator", used for MANUFACTURING_ASSUMPTION /
// USER_DEFINED_COMPANY_STANDARD rules that have no external authority to cite.
export const JURISDICTIONS = Object.freeze({
  PL: 'PL', // Rzeczpospolita Polska — Warunki Techniczne (legally binding for this tool's primary market)
  UK: 'UK', // England/Wales/Scotland/NI Building Regulations + BWF Stair Scheme guidance
  EU: 'EU', // Eurocodes (require a National Annex to become binding in any single country)
  US: 'US', // referenced only for comparison (IRC) — NOT applied by default, no PL/UK authority
  GENERAL: 'GENERAL', // widely-shared engineering/ergonomic convention, no single legal source
  COMPANY: 'COMPANY', // the workshop/company operating the tool — applies to every project it runs
  PROJECT: 'PROJECT', // one specific project/client — narrower than COMPANY, never shared across projects
});

// Building/stair context a rule's applicability can be scoped to. All dimensions are
// OPTIONAL on a rule: omitting `scope` entirely means "applies in every context". Values
// are arrays so a rule can apply to more than one context (e.g. multi-family AND public).
// 'all' is a wildcard meaning every value in that dimension.
/**
 * @typedef {Object} RuleScope
 * @property {string[]} [buildingTypes] e.g. ['single_family','multi_family','public','healthcare','preschool','all']
 * @property {string[]} [materials]     e.g. ['timber','any']
 * @property {string[]} [locations]     e.g. ['internal','external']
 */

// True if `rule` applies under `context` (a plain object with the same dimension names as
// RuleScope, singular values, e.g. { buildingType: 'single_family', material: 'timber',
// location: 'internal' }). A rule with no `scope` always applies. This is pure filtering —
// it never inspects geometry, only the small context object passed to it.
export function ruleAppliesToContext(rule, context) {
  if (!rule.scope) return true;
  const dims = [
    ['buildingTypes', 'buildingType'],
    ['materials', 'material'],
    ['locations', 'location'],
  ];
  for (const [scopeKey, contextKey] of dims) {
    const allowed = rule.scope[scopeKey];
    if (!allowed) continue; // dimension not restricted by this rule
    const actual = context ? context[contextKey] : undefined;
    if (actual === undefined) continue; // context doesn't specify this dimension — don't filter on it
    if (!allowed.includes('all') && !allowed.includes(actual)) return false;
  }
  return true;
}

/**
 * @typedef {Object} Rule
 * @property {string} ruleId            Stable, human-readable id, e.g. "PL-LEGAL-A-01"
 * @property {RuleCategory} category    One of A..K (see CATEGORIES)
 * @property {string} description       Plain-language statement of the rule
 * @property {string} [condition]       Mathematical/logical condition, as a formula string
 *                                       (e.g. "550mm <= 2*riserHeight + treadGoing <= 700mm").
 *                                       Intentionally NOT executable code — see README.
 * @property {string[]} [configRefs]    Names of config/derived fields this rule reads,
 *                                       for future wiring; documentation only, not logic.
 * @property {RuleScope} [scope]        Building/stair context this rule is restricted to.
 *                                       Omit entirely for a rule that always applies.
 * @property {keyof RULE_TYPES} ruleType
 * @property {keyof JURISDICTIONS} jurisdiction
 * @property {string} source            Citation: document, clause/paragraph, edition/year
 * @property {keyof SEVERITIES} severity
 * @property {boolean} blocksGeneration Whether a violation should prevent model generation
 *                                       (true) or only be reported (false)
 * @property {boolean} [needsVerification] True if the figure/clause could not be confirmed
 *                                       against a primary source during this research pass —
 *                                       must never be used with blocksGeneration:true until cleared.
 * @property {string} [notes]           Caveats, scope limits, or relationship to other rules
 * @property {keyof RULE_STATUS} [status]  CONFIRMED/ASSUMPTION/CONFIGURABLE — see RULE_STATUS.
 *                                       Optional; older rules predate this field.
 * @property {keyof CONSTRUCTION_TYPE_SCOPES|null} [constructionType]  Which stringer
 *                                       construction type this rule applies to — 'both' if
 *                                       independent of the choice. Only meaningful for
 *                                       stringer-construction rules (category F).
 * @property {boolean} [affectsGeometry]        Does this rule change what 3D geometry is built?
 * @property {boolean} [affectsValidation]      Does this rule drive a Validator/constraint check?
 * @property {boolean} [affectsMaterialTakeoff] Will this rule matter once Material Takeoff exists?
 */

// Fails loudly if a rule set author forgets a required field or mixes rule types with the
// wrong jurisdiction shape — cheap sanity check, not a validation engine.
export function assertValidRule(rule) {
  const required = ['ruleId', 'category', 'description', 'ruleType', 'jurisdiction', 'source', 'severity', 'blocksGeneration'];
  for (const key of required) {
    if (rule[key] === undefined) throw new Error(`Rule ${rule.ruleId || '(unknown)'} is missing required field "${key}"`);
  }
  if (!CATEGORIES[rule.category]) throw new Error(`Rule ${rule.ruleId}: unknown category "${rule.category}"`);
  if (!RULE_TYPES[rule.ruleType]) throw new Error(`Rule ${rule.ruleId}: unknown ruleType "${rule.ruleType}"`);
  if (!JURISDICTIONS[rule.jurisdiction]) throw new Error(`Rule ${rule.ruleId}: unknown jurisdiction "${rule.jurisdiction}"`);
  if (!SEVERITIES[rule.severity]) throw new Error(`Rule ${rule.ruleId}: unknown severity "${rule.severity}"`);
  if (rule.needsVerification && rule.blocksGeneration) {
    throw new Error(`Rule ${rule.ruleId}: a rule pending verification must not block generation`);
  }
  if (rule.status !== undefined && !RULE_STATUS[rule.status]) {
    throw new Error(`Rule ${rule.ruleId}: unknown status "${rule.status}"`);
  }
  if (rule.constructionType !== undefined && rule.constructionType !== null && !Object.values(CONSTRUCTION_TYPE_SCOPES).includes(rule.constructionType)) {
    throw new Error(`Rule ${rule.ruleId}: unknown constructionType "${rule.constructionType}"`);
  }
  return rule;
}

export function defineRuleSet(rules) {
  return rules.map(assertValidRule);
}
