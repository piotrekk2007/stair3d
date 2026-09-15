// Shape of a "Staircase Design Profile" — a named bundle of FOUR independently-swappable
// rule layers, plus the context used to scope the legal/best-practice layers. Composing a
// profile never copies or rewrites rule data — see compose.js, which only filters/selects
// from the existing sets in src/rules/sets/.

/**
 * @typedef {Object} DesignProfileContext
 * @property {'single_family'|'multi_family'|'public'|'healthcare'|'preschool'} buildingType
 * @property {string} material   e.g. 'timber'
 * @property {'internal'|'external'} location
 */

/**
 * @typedef {Object} DesignProfile
 * @property {string} profileId
 * @property {string} label                Human-readable name shown in the UI/project header
 * @property {DesignProfileContext} context
 * @property {string} legal                Id into LEGAL_PROFILE_SOURCES
 * @property {string} bestPractice         Id into BEST_PRACTICE_PROFILE_SOURCES
 * @property {string} manufacturing        Id into MANUFACTURING_PROFILE_SOURCES
 * @property {string} userPreferences      Id into USER_PREFERENCE_PROFILE_SOURCES
 */

export function defineProfile(profile) {
  const required = ['profileId', 'label', 'context', 'legal', 'bestPractice', 'manufacturing', 'userPreferences'];
  for (const key of required) {
    if (profile[key] === undefined) throw new Error(`DesignProfile ${profile.profileId || '(unknown)'} is missing "${key}"`);
  }
  return profile;
}
