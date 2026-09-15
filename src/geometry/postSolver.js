// PostModel — plain-data description of slupy (newel posts / corner posts), independent of
// Three.js. This is DELIBERATELY a thin model, not a full solver-with-invariants like
// StringerModel: a post has no manual-edit/nominal-vs-final distinction (nothing about it is
// user-editable today), so there is nothing to validate beyond "where is it and how tall".
// It still earns a real model (not just inline box-building in the renderer) because its
// POSITION is a genuine, non-trivial derivation from planLayout (the start post is shifted
// forward by half its own size to avoid swallowing the first tread's nosing — see
// startPosition below), and posts already appear conceptually inside StringerModel's
// connection points (CONNECTION_TYPES.CORNER_POST/NEWEL_TENON) — a real PostModel is what a
// future cross-check between the two would compare against.

import { normalizeVector } from './pathUtils.js';

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
 */

/**
 * @param {import('./planLayout.js').PlanLayout} planLayout
 * @param {Object} config
 * @returns {PostModel[]}
 */
export function buildPostModels(planLayout, config) {
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

  return models;
}
