// The ONE structured diagnostic shape shared by the geometric CONSTRAINT layer
// (src/constraints/) and the TECHNICAL VALIDATION layer (src/validation/, src/rules/). Both
// produce arrays of these — never UI strings — so the UI (and tests) can consume constraint
// violations and technical-rule violations identically, while still telling them apart by
// `ruleId`/`elementType` when it matters. This file has zero geometry and zero Three.js.

/**
 * @typedef {'ERROR'|'WARNING'|'INFO'} DiagnosticSeverity
 */

/**
 * @typedef {Object} Diagnostic
 * @property {string} ruleId        Stable id — a CONSTRAINT-* id for geometric constraints, or
 *                                   a catalogue ruleId (e.g. "PL-LEGAL-A-01") for technical rules.
 * @property {DiagnosticSeverity} severity
 * @property {string} elementType   e.g. 'tread' | 'riser' | 'stringer' | 'post' | 'stair' | 'config'
 * @property {string|null} elementId   e.g. 'step-7', or null when the diagnostic is stair-wide
 * @property {string|null} [parameter]  Which named quantity this diagnostic is actually about,
 *                                       e.g. 'riserHeight', 'treadGoing', 'stringerParallelism' —
 *                                       lets a caller group/filter findings by parameter, not
 *                                       just by ruleId. See src/validator/StaircaseValidator.js.
 * @property {*} [value]            The actual measured value, when applicable
 * @property {*} [expected]         The expected value/range, as a short string or number
 * @property {string|null} [unit]
 * @property {string} message       Plain-language explanation, safe to show directly in a UI
 */

const REQUIRED = ['ruleId', 'severity', 'elementType', 'message'];
const VALID_SEVERITIES = new Set(['ERROR', 'WARNING', 'INFO']);

/**
 * @param {Partial<Diagnostic>} fields
 * @returns {Diagnostic}
 */
export function createDiagnostic(fields) {
  for (const key of REQUIRED) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`createDiagnostic: missing required field "${key}"`);
    }
  }
  if (!VALID_SEVERITIES.has(fields.severity)) {
    throw new Error(`createDiagnostic: invalid severity "${fields.severity}"`);
  }
  return {
    ruleId: fields.ruleId,
    severity: fields.severity,
    elementType: fields.elementType,
    elementId: fields.elementId ?? null,
    parameter: fields.parameter ?? null,
    value: fields.value ?? null,
    expected: fields.expected ?? null,
    unit: fields.unit ?? null,
    message: fields.message,
  };
}

export function hasErrors(diagnostics) {
  return diagnostics.some((d) => d.severity === 'ERROR');
}

export function hasWarnings(diagnostics) {
  return diagnostics.some((d) => d.severity === 'WARNING');
}

export function filterBySeverity(diagnostics, severity) {
  return diagnostics.filter((d) => d.severity === severity);
}
