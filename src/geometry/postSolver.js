// PostModel — plain-data description of slupy (newel posts / corner posts), independent of
// Three.js. This is DELIBERATELY a thin model, not a full solver-with-invariants like
// StringerModel: there is nothing to validate beyond "where is it and how tall".
//
// Each post can be edited individually through `config.manualPostOverrides` (see
// sanitizePostOverrides): lengthened/shortened at the top and/or the bottom, or removed altogether.
// The nominal post is always built first, the override is applied on top (Nominal -> Override ->
// Final, like the tread edges), so an edit follows the post when the stair changes.
// It still earns a real model (not just inline box-building in the renderer) because its
// POSITION is a genuine, non-trivial derivation from planLayout (the start post is shifted
// forward by half its own size to avoid swallowing the first tread's nosing — see
// startPosition below), and posts already appear conceptually inside StringerModel's
// connection points (CONNECTION_TYPES.CORNER_POST/NEWEL_TENON) — a real PostModel is what a
// future cross-check between the two would compare against.

import { normalizeVector } from './pathUtils.js';

// A post shortened below this is treated as a mistake and the length edit is ignored (reported on the
// model as `overrideRejected`) — a 100 mm stub is not a post.
export const MIN_POST_HEIGHT_MM = 100;

const NEWEL_HEIGHT = 1000; // mm, wysokość słupka początkowego/końcowego ponad poziom podłogi

function unitDir(pFrom, pTo) {
  return normalizeVector({ x: pTo.x - pFrom.x, y: pTo.y - pFrom.y });
}

/**
 * @typedef {Object} PostModel
 * @property {string} postId
 * @property {'start'|'end'|'corner'} kind
 * @property {{x:number,y:number}} position
 * @property {{bottom:number, top:number}} elevation
 * @property {number} size  mm, przekrój kwadratowy (config.postSize)
 * @property {{bottom:number, top:number}} nominalElevation  before any manual length edit
 * @property {boolean} removed        the user deleted this post (only present in buildAllPostModels)
 * @property {boolean} overridden     a manual length edit is in effect
 * @property {boolean} overrideRejected  a length edit was ignored because it left less than MIN_POST_HEIGHT_MM
 */

/**
 * Cleans the manual per-post override layer: { [postId]: { removed?: true, topDeltaMm?, bottomDeltaMm? } }.
 * `topDeltaMm` > 0 lengthens the post upwards, < 0 shortens it; `bottomDeltaMm` > 0 lengthens it
 * downwards, < 0 shortens it. Anything that is not a finite number (or an empty entry) is dropped.
 */
export function sanitizePostOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [postId, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const clean = {};
    if (entry.removed === true) clean.removed = true;
    if (Number.isFinite(entry.topDeltaMm) && entry.topDeltaMm !== 0) clean.topDeltaMm = entry.topDeltaMm;
    if (Number.isFinite(entry.bottomDeltaMm) && entry.bottomDeltaMm !== 0) clean.bottomDeltaMm = entry.bottomDeltaMm;
    if (Object.keys(clean).length > 0) out[postId] = clean;
  }
  return out;
}

/**
 * The id of the corner post standing at `point` (a turn's inner corner), or null — the SAME
 * numbering buildAllPostModels() uses (`post-corner-<turn index>`, the first turn owning a corner
 * when a merged landing gives two turns the same one). One shared answer, so the stringer solver
 * and the post list can never disagree about which post is meant.
 */
export function cornerPostIdAt(planLayout, point) {
  const i = planLayout.turns.findIndex((turn) => Math.hypot(turn.innerCorner.x - point.x, turn.innerCorner.y - point.y) < 1);
  return i < 0 ? null : `post-corner-${i}`;
}

/** True when a corner post is switched on globally but the user removed this particular one. */
export function isCornerPostRemoved(planLayout, config, point) {
  const id = cornerPostIdAt(planLayout, point);
  return id !== null && sanitizePostOverrides(config.manualPostOverrides)[id]?.removed === true;
}

function applyPostOverrides(models, rawOverrides) {
  const overrides = sanitizePostOverrides(rawOverrides);
  return models.map((m) => {
    const o = overrides[m.postId];
    const base = { ...m, nominalElevation: { ...m.elevation }, removed: false, overridden: false, overrideRejected: false };
    if (!o) return base;
    if (o.removed) base.removed = true;
    const top = m.elevation.top + (o.topDeltaMm || 0);
    const bottom = m.elevation.bottom - (o.bottomDeltaMm || 0);
    if (o.topDeltaMm || o.bottomDeltaMm) {
      if (top - bottom >= MIN_POST_HEIGHT_MM) {
        base.elevation = { bottom, top };
        base.overridden = true;
      } else {
        base.overrideRejected = true;
      }
    }
    return base;
  });
}

/**
 * The posts that actually exist (removed ones left out) — what is rendered, priced and validated.
 *
 * @param {import('./planLayout.js').PlanLayout} planLayout
 * @param {Object} config
 * @returns {PostModel[]}
 */
export function buildPostModels(planLayout, config) {
  return buildAllPostModels(planLayout, config).filter((p) => !p.removed);
}

/**
 * Every post the stair has, INCLUDING the ones the user removed (flagged `removed`) — for the UI, so a
 * removed post can still be shown as a ghost and brought back.
 *
 * @returns {PostModel[]}
 */
export function buildAllPostModels(planLayout, config) {
  const { postSize, totalRise, hasCornerPost } = config;
  const path = planLayout.innerFullPath;
  const startPoint = path[0];
  const endPoint = path[path.length - 1];

  // Nosek pierwszego stopnia leży dokładnie na frontEdge stopnia 0 — czyli tam, gdzie stoi
  // słup startowy. Przesuwamy słup DO PRZODU (zgodnie z kierunkiem wchodzenia) o połowę jego
  // rozmiaru, żeby jego tylne lico leżało na linii konstrukcyjnej — inaczej słup wizualnie
  // połyka/zasłania nosek pierwszego stopnia, bo oba sięgają w tę samą przestrzeń za linią startu.
  const startForward = unitDir(path[0], path[1]);
  const startPosition = {
    x: startPoint.x + startForward.x * (postSize / 2),
    y: startPoint.y + startForward.y * (postSize / 2),
  };

  const models = [
    { postId: 'post-start', kind: 'start', position: startPosition, elevation: { bottom: 0, top: NEWEL_HEIGHT }, size: postSize },
    // Ostatni stopień nie ma noska na swojej przedniej (górnej) krawędzi — nosek jest tylko
    // na krawędziach czołowych — więc słup końcowy nie koliduje z niczym i zostaje wyśrodkowany.
    { postId: 'post-end', kind: 'end', position: endPoint, elevation: { bottom: totalRise - NEWEL_HEIGHT, top: totalRise }, size: postSize },
  ];

  if (hasCornerPost) {
    // Przy "1 dużym podeście" (patrz planLayout.js/mergeLandingPair) oba zakręty mają
    // dokładnie ten sam innerCorner — bez odfiltrowania duplikatu dostalibyśmy dwa
    // identyczne, nakładające się słupy.
    const placedCorners = [];
    planLayout.turns.forEach((turn, i) => {
      const isDuplicate = placedCorners.some((c) => Math.hypot(c.x - turn.innerCorner.x, c.y - turn.innerCorner.y) < 1);
      if (isDuplicate) return;
      placedCorners.push(turn.innerCorner);
      models.push({ postId: `post-corner-${i}`, kind: 'corner', position: turn.innerCorner, elevation: { bottom: 0, top: totalRise }, size: postSize });
    });
  }

  return applyPostOverrides(models, config.manualPostOverrides);
}
