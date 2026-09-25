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
import { inwardNormal } from './planLayout.js';

// A post shortened below this is treated as a mistake and the length edit is ignored (reported on the
// model as `overrideRejected`) — a 100 mm stub is not a post.
export const MIN_POST_HEIGHT_MM = 100;
export const MIN_POST_SIZE_MM = 20;
export const MAX_POST_SIZE_MM = 300;

const NEWEL_HEIGHT = 1000; // mm, wysokość słupka początkowego/końcowego ponad poziom podłogi
// Two post positions closer than this are the same place (same 1 mm tolerance as the corner-post de-duplication).
const POST_COINCIDENCE_MM = 1;
// Below this (1 + cos of the angle between the two legs' normals) the legs double back on themselves and a mitre
// point would fly off — the second leg's normal is used instead (same guard as railingSolver.js offsetLookup).
const MITRE_MIN_DENOM = 0.1;

function unitDir(pFrom, pTo) {
  return normalizeVector({ x: pTo.x - pFrom.x, y: pTo.y - pFrom.y });
}

/**
 * @typedef {Object} PostModel
 * @property {string} postId
 * @property {'start'|'end'|'corner'|'railing'} kind  'railing' = an end post of a balustrade section (railingSolver.js)
 * @property {{x:number,y:number}} position  centre of the post — on the inner wanga's axis for structural posts
 * @property {{x:number,y:number}} [anchor]  structural posts: the inner-line chain point the post belongs to (start/end of
 *   the inner line, a turn's inner corner) — how a wanga board finds the post it ends at (stringerSolver.js)
 * @property {{bottom:number, top:number}} elevation
 * @property {number} size  mm, przekrój kwadratowy (config.postSize; for a 'railing' post config.railingPostSizeMm or its own override)
 * @property {number} [nominalSize]  the size before a manual thickness edit (only railing posts can have one)
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
    // Thickness (square section) of a balustrade post — the structural posts share config.postSize instead.
    if (Number.isFinite(entry.sizeMm) && entry.sizeMm >= MIN_POST_SIZE_MM && entry.sizeMm <= MAX_POST_SIZE_MM) clean.sizeMm = entry.sizeMm;
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

export function applyPostOverrides(models, rawOverrides) {
  const overrides = sanitizePostOverrides(rawOverrides);
  return models.map((m) => {
    const o = overrides[m.postId];
    const base = { ...m, nominalElevation: { ...m.elevation }, removed: false, overridden: false, overrideRejected: false };
    if (!o) return base;
    if (o.removed) base.removed = true;
    if (o.sizeMm && m.kind === 'railing') {
      base.nominalSize = m.size;
      base.size = o.sizeMm;
      base.overridden = true;
    }
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
// The inner line with consecutive duplicate points removed (a winder's dusza collapses several chain points onto
// the corner), so every step has a real direction.
function distinctPath(path) {
  const out = [];
  for (const p of path) if (out.length === 0 || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) >= POST_COINCIDENCE_MM) out.push(p);
  return out;
}

// Offsets a point of the inner line onto the inner wanga's AXIS (half its thickness into the stair). At a corner the
// two legs' axes are offset lines that meet at the mitre point — that is where a corner post's centre belongs, so
// both wangi run into it on their own axis. `before`/`after` are the legs' walking directions (either may be null
// at the line's ends).
function ontoWangaAxis(point, before, after, halfThickness, handedness) {
  const a = before ? inwardNormal(before, 'inner', handedness) : null;
  const b = after ? inwardNormal(after, 'inner', handedness) : null;
  let n;
  if (a && b) {
    const denom = 1 + a.x * b.x + a.y * b.y;
    n = denom < MITRE_MIN_DENOM ? b : { x: (a.x + b.x) / denom, y: (a.y + b.y) / denom };
  } else {
    n = a || b || { x: 0, y: 0 };
  }
  return { x: point.x + n.x * halfThickness, y: point.y + n.y * halfThickness };
}

export function buildAllPostModels(planLayout, config) {
  const { postSize, totalRise, hasCornerPost } = config;
  const handedness = planLayout.handedness ?? 1;
  const half = (config.stringerThickness || 0) / 2;
  const path = distinctPath(planLayout.innerFullPath);
  const startPoint = path[0];
  const endPoint = path[path.length - 1];
  const dirAt = (i) => (i >= 0 && i < path.length - 1 ? unitDir(path[i], path[i + 1]) : null);

  // Every structural post stands on the inner wanga's AXIS (half its thickness in from the chain line — the board
  // extrudes inward from that line, stringerRenderer.js), never centred on the chain line itself, where half of
  // it would stick out of the stair. The balustrade's own posts already did so (railingSolver.js).
  //
  // Nosek pierwszego stopnia leży dokładnie na frontEdge stopnia 0 — czyli tam, gdzie stoi
  // słup startowy. Przesuwamy słup DO PRZODU (zgodnie z kierunkiem wchodzenia) o połowę jego
  // rozmiaru, żeby jego tylne lico leżało na linii konstrukcyjnej — inaczej słup wizualnie
  // połyka/zasłania nosek pierwszego stopnia, bo oba sięgają w tę samą przestrzeń za linią startu.
  const startForward = dirAt(0) || { x: 0, y: 1 };
  const startOnAxis = ontoWangaAxis(startPoint, null, startForward, half, handedness);
  const startPosition = {
    x: startOnAxis.x + startForward.x * (postSize / 2),
    y: startOnAxis.y + startForward.y * (postSize / 2),
  };
  const endPosition = ontoWangaAxis(endPoint, dirAt(path.length - 2), null, half, handedness);
  // A flight that starts (or ends) straight away with winders has no inner leg before (after) its corner; the
  // stair's own first (last) walking direction — the outer line's first (last) side — stands in for it.
  const outer = distinctPath(planLayout.outerFullPath);
  const firstDir = outer.length > 1 ? unitDir(outer[0], outer[1]) : null;
  const lastDir = outer.length > 1 ? unitDir(outer[outer.length - 2], outer[outer.length - 1]) : null;
  const cornerPosition = (corner) => {
    const i = path.findIndex((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < POST_COINCIDENCE_MM);
    if (i < 0) return corner;
    const before = dirAt(i - 1) ?? (i === 0 ? firstDir : null);
    const after = dirAt(i) ?? (i === path.length - 1 ? lastDir : null);
    return ontoWangaAxis(corner, before, after, half, handedness);
  };

  const models = [
    { postId: 'post-start', kind: 'start', position: startPosition, anchor: startPoint, elevation: { bottom: 0, top: NEWEL_HEIGHT }, size: postSize },
    // Ostatni stopień nie ma noska na swojej przedniej (górnej) krawędzi — nosek jest tylko
    // na krawędziach czołowych — więc słup końcowy nie koliduje z niczym i zostaje wyśrodkowany.
    { postId: 'post-end', kind: 'end', position: endPosition, anchor: endPoint, elevation: { bottom: totalRise - NEWEL_HEIGHT, top: totalRise }, size: postSize },
  ];

  if (hasCornerPost) {
    // Przy "1 dużym podeście" (patrz planLayout.js/mergeLandingPair) oba zakręty mają
    // dokładnie ten sam innerCorner — bez odfiltrowania duplikatu dostalibyśmy dwa
    // identyczne, nakładające się słupy.
    const placedCorners = [];
    planLayout.turns.forEach((turn, i) => {
      const isDuplicate = placedCorners.some((c) => Math.hypot(c.x - turn.innerCorner.x, c.y - turn.innerCorner.y) < POST_COINCIDENCE_MM);
      if (isDuplicate) return;
      placedCorners.push(turn.innerCorner);
      models.push({ postId: `post-corner-${i}`, kind: 'corner', position: cornerPosition(turn.innerCorner), anchor: turn.innerCorner, elevation: { bottom: 0, top: totalRise }, size: postSize });
    });
  }

  // A flight can start (treadsLegA = 0) or end (last straight leg = 0) directly with winders: the inner
  // path then begins/ends AT the turn's inner corner, so the start/end newel would stand exactly where the
  // corner post already stands (two posts in one place). The full-height corner post takes that role; the
  // start/end post is only kept when the user removed that corner post, so the spot is never left empty.
  const overrides = sanitizePostOverrides(config.manualPostOverrides);
  const coveredByCornerPost = (point) =>
    models.some((m) => m.kind === 'corner' && !overrides[m.postId]?.removed && Math.hypot(m.anchor.x - point.x, m.anchor.y - point.y) < POST_COINCIDENCE_MM);

  const kept = models.filter(
    (m) => !(m.postId === 'post-start' && coveredByCornerPost(startPoint)) && !(m.postId === 'post-end' && coveredByCornerPost(endPoint)),
  );

  return applyPostOverrides(kept, config.manualPostOverrides);
}
