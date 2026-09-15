// Named, swappable layer sources + the concrete profiles built from them. Adding a new
// company's manufacturing rules, or a new jurisdiction's legal layer, means adding one entry
// to the relevant *_SOURCES map below — every existing profile and every existing rule set
// stays untouched (the "independent change" property the profile system exists to provide).

import { plWarunkiTechniczne } from '../sets/plWarunkiTechniczne.js';
import { bwfIndustryGuidance } from '../sets/bwfIndustryGuidance.js';
import { generalErgonomics } from '../sets/generalErgonomics.js';
import { manufacturingAssumptions } from '../sets/manufacturingAssumptions.js';
import { exampleUserDesignPreferences } from '../sets/userDesignPreferences.js';
import { defineProfile } from './schema.js';

// --- Legal layer sources ---------------------------------------------------------------
// Each entry is a POOL of rules to be scoped down by context at composition time (see
// compose.js) — "POLAND_RESIDENTIAL_TIMBER" is not a separate copy of Polish law, it is the
// full plWarunkiTechniczne set, later filtered to single_family/timber/internal.
export const LEGAL_PROFILE_SOURCES = Object.freeze({
  POLAND_RESIDENTIAL_TIMBER: plWarunkiTechniczne,
});

// --- Best-practice layer sources --------------------------------------------------------
// Only non-legal entries from bwfIndustryGuidance are included here — its UK-legal
// (Building Regulations) entries are reference-only and must never be presented as
// "industry best practice" alongside the trade body's own non-binding recommendations.
const bwfNonLegal = bwfIndustryGuidance.filter((r) => r.ruleType !== 'LEGAL_REQUIREMENT');
export const BEST_PRACTICE_PROFILE_SOURCES = Object.freeze({
  TIMBER_INDUSTRY_BEST_PRACTICE: [...bwfNonLegal, ...generalErgonomics],
});

// --- Manufacturing layer sources ---------------------------------------------------------
// A real deployment would have one of these per company; only one default is defined here.
export const MANUFACTURING_PROFILE_SOURCES = Object.freeze({
  COMPANY_MANUFACTURING_RULES_DEFAULT: manufacturingAssumptions,
});

// --- User-preference layer sources --------------------------------------------------------
// Empty by default — a real project supplies its own array (see sets/userDesignPreferences.js
// header). USER_DESIGN_PREFERENCES_EXAMPLE exists only to demonstrate the shape.
export const USER_PREFERENCE_PROFILE_SOURCES = Object.freeze({
  USER_DESIGN_PREFERENCES_EMPTY: [],
  USER_DESIGN_PREFERENCES_EXAMPLE: exampleUserDesignPreferences,
});

// --- Concrete profiles ---------------------------------------------------------------------
export const DESIGN_PROFILES = Object.freeze({
  POLAND_RESIDENTIAL_TIMBER_DEFAULT: defineProfile({
    profileId: 'POLAND_RESIDENTIAL_TIMBER_DEFAULT',
    label: 'Polska — dom jednorodzinny, schody drewniane (domyślny)',
    context: { buildingType: 'single_family', material: 'timber', location: 'internal' },
    legal: 'POLAND_RESIDENTIAL_TIMBER',
    bestPractice: 'TIMBER_INDUSTRY_BEST_PRACTICE',
    manufacturing: 'COMPANY_MANUFACTURING_RULES_DEFAULT',
    userPreferences: 'USER_DESIGN_PREFERENCES_EMPTY',
  }),
});
