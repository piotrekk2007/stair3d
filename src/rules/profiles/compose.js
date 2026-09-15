// Resolves a named DesignProfile into its four concrete rule lists (filtered by context)
// plus one flat, tagged list for convenience. This is pure aggregation/filtering — it does
// not evaluate anything (see validator.js for that) and does not touch geometry.

import { ruleAppliesToContext } from '../schema.js';
import {
  DESIGN_PROFILES,
  LEGAL_PROFILE_SOURCES,
  BEST_PRACTICE_PROFILE_SOURCES,
  MANUFACTURING_PROFILE_SOURCES,
  USER_PREFERENCE_PROFILE_SOURCES,
} from './definitions.js';

function resolveLayer(sourceMap, layerId, context) {
  const rules = sourceMap[layerId];
  if (!rules) throw new Error(`Unknown rule-layer id "${layerId}"`);
  return rules.filter((r) => ruleAppliesToContext(r, context));
}

/**
 * @param {string|import('./schema.js').DesignProfile} profileOrId
 * @returns {{ profile: import('./schema.js').DesignProfile, layers: Object, rules: Array }}
 */
export function resolveProfile(profileOrId) {
  const profile = typeof profileOrId === 'string' ? DESIGN_PROFILES[profileOrId] : profileOrId;
  if (!profile) throw new Error(`Unknown design profile "${profileOrId}"`);

  const layers = {
    legal: resolveLayer(LEGAL_PROFILE_SOURCES, profile.legal, profile.context),
    bestPractice: resolveLayer(BEST_PRACTICE_PROFILE_SOURCES, profile.bestPractice, profile.context),
    manufacturing: resolveLayer(MANUFACTURING_PROFILE_SOURCES, profile.manufacturing, profile.context),
    userPreferences: resolveLayer(USER_PREFERENCE_PROFILE_SOURCES, profile.userPreferences, profile.context),
  };

  const rules = [...layers.legal, ...layers.bestPractice, ...layers.manufacturing, ...layers.userPreferences];

  return { profile, layers, rules };
}

export function listAvailableProfiles() {
  return Object.values(DESIGN_PROFILES);
}
