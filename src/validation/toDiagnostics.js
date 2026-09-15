// Converts src/rules/validator.js Findings (rule-shaped, Polish-explanation-oriented) into the
// same structured Diagnostic[] shape the geometric constraint layer produces (src/diagnostics/
// diagnostic.js) — so a caller (UI, tests, the pipeline) never needs two different result
// shapes depending on whether a violation came from a hard geometric constraint or a technical
// rule. A finding that is not evaluable (no CHECKS entry — "informational only") is skipped
// here, not silently treated as passed; callers wanting that detail should still consult
// validateFacts()/getUnevaluated() directly.

import { createDiagnostic } from '../diagnostics/diagnostic.js';

function elementTypeFor(elementId) {
  if (!elementId) return 'stair';
  if (elementId.startsWith('step-')) return 'tread';
  return 'stair';
}

/**
 * @param {import('../rules/validator.js').Finding[]} findings
 * @returns {import('../diagnostics/diagnostic.js').Diagnostic[]}
 */
export function findingsToDiagnostics(findings) {
  const diagnostics = [];
  for (const finding of findings) {
    if (!finding.evaluable || finding.passed !== false) continue;
    const criteria = finding.criteria || [finding];
    for (const criterion of criteria) {
      if (criterion.passed) continue;
      const elementId = criterion.elementId || null;
      diagnostics.push(
        createDiagnostic({
          ruleId: finding.rule.ruleId,
          severity: finding.rule.severity,
          elementType: elementTypeFor(elementId),
          elementId,
          // Best-effort: a catalogue rule can reference several config fields at once (e.g.
          // Blondel reads both riserHeight and treadGoing) — the first one is a reasonable
          // primary "what is this actually about" label, not a precise single-field claim.
          parameter: finding.rule.configRefs?.[0] || null,
          value: criterion.actual,
          expected: criterion.expected,
          unit: criterion.unit || null,
          message: finding.rule.description,
        })
      );
    }
  }
  return diagnostics;
}
