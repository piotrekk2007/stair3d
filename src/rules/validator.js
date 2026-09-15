// The validator: evaluates a plain `facts` object against a list of rules and produces
// Findings that explain, in plain language, why each rule passed, failed, or could not be
// evaluated. This module imports ONLY from within src/rules/ — no geometry, no Three.js, no
// src/geometry/* import anywhere. Wiring this into buildStaircase.js/main.js is a deliberate
// future step, not done here (see docs/rules/PROFILES.md "What is not wired up yet").

import { CHECKS, hasCheck } from './checks.js';

/**
 * @typedef {Object} Finding
 * @property {import('./schema.js').Rule} rule
 * @property {boolean} evaluable      False if no check exists for this rule (informational only)
 * @property {boolean|null} passed    null when not evaluable
 * @property {*} [actual]
 * @property {*} [expected]
 * @property {string} [unit]
 * @property {Array} [criteria]       Present when a rule bundles more than one condition
 */

/**
 * @param {Object} facts   See checks.js "Facts contract"
 * @param {import('./schema.js').Rule[]} rules
 * @returns {Finding[]}
 */
export function validateFacts(facts, rules) {
  return rules.map((rule) => {
    if (!hasCheck(rule.ruleId)) {
      return { rule, evaluable: false, passed: null };
    }
    const result = CHECKS[rule.ruleId](facts);
    return { rule, evaluable: true, ...result };
  });
}

export function getFailures(findings) {
  return findings.filter((f) => f.evaluable && f.passed === false);
}

export function getPasses(findings) {
  return findings.filter((f) => f.evaluable && f.passed === true);
}

export function getUnevaluated(findings) {
  return findings.filter((f) => !f.evaluable);
}

const RULE_TYPE_LABEL_PL = {
  LEGAL_REQUIREMENT: 'wymóg prawny',
  ENGINEERING_GUIDANCE: 'wytyczna inżynierska',
  INDUSTRY_BEST_PRACTICE: 'dobra praktyka branżowa',
  MANUFACTURING_ASSUMPTION: 'założenie produkcyjne',
  USER_DEFINED_COMPANY_STANDARD: 'standard firmowy',
  USER_DESIGN_PREFERENCE: 'preferencja projektowa klienta',
};

// Builds a full, human-readable (Polish) explanation of one finding — this is the "validator
// must explain why a rule failed" requirement. It never hides WHICH kind of rule this is:
// the explanation always names the ruleType and jurisdiction, so a legal violation and a
// company-preference violation can never be confused with each other in the output.
export function explainFinding(finding) {
  const { rule } = finding;
  const typeLabel = RULE_TYPE_LABEL_PL[rule.ruleType] || rule.ruleType;
  const jurisdictionLabel = rule.jurisdiction === 'PROJECT' ? 'ten projekt' : rule.jurisdiction;

  if (!finding.evaluable) {
    return `[${rule.ruleId}] ${typeLabel} (${jurisdictionLabel}) — brak automatycznej oceny liczbowej dla tej reguły; wymaga ręcznej weryfikacji. ${rule.description}`;
  }

  const criteria = finding.criteria || [finding];
  const criteriaText = criteria
    .map((c) => `${c.passed ? 'OK' : 'NIE SPEŁNIONO'} (wartość: ${c.actual}${c.unit || ''}, wymagane: ${c.expected}${c.unit || ''})`)
    .join('; ');

  const verdict = finding.passed ? 'SPEŁNIONA' : 'NARUSZONA';
  const severityNote = finding.passed ? '' : ` [severity: ${rule.severity}${rule.blocksGeneration ? ', blokuje generację' : ', tylko ostrzeżenie'}]`;

  return (
    `[${rule.ruleId}] Reguła ${verdict}${severityNote} — ${typeLabel}, jurysdykcja: ${jurisdictionLabel}.\n` +
    `  Opis: ${rule.description}\n` +
    `  Sprawdzenie: ${criteriaText}\n` +
    `  Źródło: ${rule.source}`
  );
}

export function explainAll(findings) {
  return findings.map(explainFinding).join('\n\n');
}
