// USER_DESIGN_PREFERENCE rules, jurisdiction PROJECT — the narrowest, most specific layer.
//
// Unlike every other set in src/rules/sets/, this is NOT a fixed catalogue of researched
// rules. A design preference belongs to ONE project/client (e.g. "the client is elderly and
// wants a shallower stair than our usual house style"), so in a real deployment these would
// be created per-project (analogous to how config.manualEdgeOverrides is per-project data in
// src/geometry/edgeOverrides.js), not shipped as a shared default.
//
// This file provides:
//   1. `createUserPreferenceRule(fields)` — a small factory that fills in the fixed parts
//      (ruleType, jurisdiction, source wording) so a project only has to state what actually
//      varies (id, description, condition, severity).
//   2. `exampleUserDesignPreferences` — ONE illustrative example (clearly a template, not a
//      real default — see docs/rules/PROFILES.md worked example) showing the shape a real
//      per-project preference takes. The default profile (see src/rules/profiles/) uses an
//      EMPTY user-preference layer, not this example.

import { assertValidRule } from '../schema.js';

/**
 * @param {Object} fields
 * @param {string} fields.ruleId
 * @param {import('../schema.js').RuleCategory} fields.category
 * @param {string} fields.description
 * @param {string} [fields.condition]
 * @param {string[]} [fields.configRefs]
 * @param {import('../schema.js').RuleScope} [fields.scope]
 * @param {keyof import('../schema.js').SEVERITIES} [fields.severity]
 * @param {boolean} [fields.blocksGeneration]
 * @param {string} fields.projectRef  Free-text identifying which project/client this came from
 *                                    (e.g. "Kowalski, ul. Lipowa 4, ustalenie z 2026-09-10") —
 *                                    required, because a USER_DESIGN_PREFERENCE with no
 *                                    traceable origin is indistinguishable from an invented rule.
 */
export function createUserPreferenceRule(fields) {
  return assertValidRule({
    ruleType: 'USER_DESIGN_PREFERENCE',
    jurisdiction: 'PROJECT',
    severity: fields.severity || 'WARNING',
    blocksGeneration: fields.blocksGeneration ?? false,
    source: `Ustalenie projektowe/z klientem — ${fields.projectRef}`,
    ...fields,
  });
}

// Illustrative only — see file header. A real project would create its own array like this
// one, most likely stored alongside the project's config (see project/projectIO.js), not
// hard-coded in the source tree.
export const exampleUserDesignPreferences = [
  createUserPreferenceRule({
    ruleId: 'USER-PREF-B-01',
    category: 'B',
    description:
      'PRZYKŁAD (nie domyślne): klient poprosił o niższe niż zwykle stopnie ze względu na potrzeby osoby starszej w gospodarstwie domowym.',
    condition: 'riserHeight <= 170 mm',
    configRefs: ['riserHeight'],
    scope: { locations: ['internal'] },
    projectRef: 'PRZYKŁAD ILUSTRACYJNY — podmień na rzeczywiste ustalenie z konkretnym projektem/klientem',
    severity: 'WARNING',
    blocksGeneration: false,
  }),
];
