// Aggregates every independent rule set into one queryable catalogue. This file performs
// NO evaluation/validation of a config or planLayout — it only combines and indexes data.
// Building an actual validation engine (which WOULD read a config/planLayout and produce
// pass/fail results) is future work, kept in its own layer per .claude/RULES.md rule 10.

import { plWarunkiTechniczne } from './sets/plWarunkiTechniczne.js';
import { eurocodeStructural } from './sets/eurocodeStructural.js';
import { bwfIndustryGuidance } from './sets/bwfIndustryGuidance.js';
import { generalErgonomics } from './sets/generalErgonomics.js';
import { manufacturingAssumptions } from './sets/manufacturingAssumptions.js';
import { validationMeta } from './sets/validationMeta.js';

// Each entry is independently addable/removable here without touching any other set —
// this array IS the "independent change" seam requested for the architecture.
export const RULE_SETS = Object.freeze({
  plWarunkiTechniczne,
  eurocodeStructural,
  bwfIndustryGuidance,
  generalErgonomics,
  manufacturingAssumptions,
  validationMeta,
});

export function getFullCatalogue() {
  return Object.values(RULE_SETS).flat();
}

export function getRulesByCategory(category) {
  return getFullCatalogue().filter((r) => r.category === category);
}

export function getRulesByJurisdiction(jurisdiction) {
  return getFullCatalogue().filter((r) => r.jurisdiction === jurisdiction);
}

export function getRulesByType(ruleType) {
  return getFullCatalogue().filter((r) => r.ruleType === ruleType);
}

export function getRuleById(ruleId) {
  return getFullCatalogue().find((r) => r.ruleId === ruleId) || null;
}

export function getRulesNeedingVerification() {
  return getFullCatalogue().filter((r) => r.needsVerification === true);
}
