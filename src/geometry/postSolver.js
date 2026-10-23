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
import { starterNewelTread } from './starterSteps.js';
import { stairwellReport, stairwellWalls } from './stairwell.js';

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
// The end newel is moved onto the slab only when the last walking direction leaves the opening's exit edge at least
// this steeply (cos of the angle to its outward normal) — a stair arriving along an edge does not walk out there.
const SLAB_WALK_MIN_COS = 0.5;
// A dusza corner this close (+ the wanga-to-wall gap) to a stairwell wall stands against it — no post there (mm).
const WALL_CORNER_TOL_MM = 2;

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function unitDir(pFrom, pTo) {
  return normalizeVector({ x: pTo.x - pFrom.x, y: pTo.y - pFrom.y });
}

/**
 * @typedef {Object} PostModel
 * @property {string} postId
 * @property {'start'|'end'|'corner'|'railing'} kind  'railing' = an end post of a balustrade section (railingSolver.js)
 * @property {{x:number,y:number}} position  centre of the post — on the inner wanga's axis for structural posts (on the
 *   OUTER one for the second turn's post of an S — `line: 'outer'`)
 * @property {'inner'|'outer'} [line]  the wanga line a structural post stands on (absent = 'inner')
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
  const near = (c) => Math.hypot(c.x - point.x, c.y - point.y) < 1;
  for (let i = 0; i < planLayout.turns.length; i++) {
    const turn = planLayout.turns[i];
    // a 180° winder zone: its post spots (one central post for both dusza corners, or one per corner)
    if (turn.postSpots) {
      const j = turn.postSpots.findIndex((spot) => spot.anchors.some(near));
      if (j >= 0) return `post-corner-${i + j}`;
      continue;
    }
    if (near(turn.innerCorner)) return `post-corner-${i}`;
  }
  return null;
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
 * Posts a handrail ends at reach at least the handrail's top there (railingSolver.js `postTopNeeds`): the NOMINAL top
 * of such a post is raised to that height; a manual length correction (topDeltaMm) keeps applying on top of it.
 * @param {PostModel[]} posts
 * @param {Object<string, number>} needs  post id -> the lowest allowed nominal top (mm)
 */
export function raisePostsToHandrail(posts, needs = {}) {
  return posts.map((p) => {
    const need = needs[p.postId];
    const nominalTop = p.nominalElevation?.top ?? p.elevation.top;
    if (!(need > nominalTop)) return p;
    const delta = p.elevation.top - nominalTop; // the user's own correction, if any
    return { ...p, nominalElevation: { ...(p.nominalElevation || p.elevation), top: need }, elevation: { ...p.elevation, top: need + delta }, raisedForHandrail: true };
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
function ontoWangaAxis(point, before, after, halfThickness, handedness, side = 'inner') {
  const a = before ? inwardNormal(before, side, handedness) : null;
  const b = after ? inwardNormal(after, side, handedness) : null;
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
  let startPosition = {
    x: startOnAxis.x + startForward.x * (postSize / 2),
    y: startOnAxis.y + startForward.y * (postSize / 2),
  };
  // Starter steps widened on the dusza side at the stair's start (starterSteps.js starterNewelTread): the newel stands
  // ON the last of them, on the inner wanga's axis, its back face at that tread's back edge — the wanga above the
  // tread meets its back face, the wanga under the tread runs on to the floor (it carries the tread)
  let startAnchor = startPoint;
  let startElevation = { bottom: 0, top: NEWEL_HEIGHT };
  const onStarter = starterNewelTread(planLayout);
  if (onStarter >= 0) {
    const chain = planLayout.treads[onStarter].innerChain;
    const at = chain[chain.length - 1];
    const forward = unitDir(chain[0], at);
    const onAxis = ontoWangaAxis(at, forward, null, half, handedness);
    startPosition = { x: onAxis.x - forward.x * (postSize / 2), y: onAxis.y - forward.y * (postSize / 2) };
    startAnchor = at; // not the board's start: the inner board runs on under the tread, no post at its end
    const tread = (onStarter + 1) * (config.riserHeight || 0);
    startElevation = { bottom: tread, top: tread + NEWEL_HEIGHT };
  }
  let endPosition = ontoWangaAxis(endPoint, dirAt(path.length - 2), null, half, handedness);
  let endElevation = { bottom: totalRise - NEWEL_HEIGHT, top: totalRise };
  // With a balustrade round the ceiling opening ending at it, the end newel stands ON THE SLAB, moved on along the last
  // walking direction until its centre is on that balustrade's line (railingSolver.js endNewelOntoSlab, set by
  // buildStaircase.js as `config.endNewelOntoSlab`); the inner wanga runs on to its face (stringerSolver.js) and its end
  // over the slab is cut at the floor (stringerConstructionGeometry.js).
  let onSlab = null;
  const slab = config.endNewelOntoSlab;
  const lastWalk = dirAt(path.length - 2);
  if (slab && lastWalk) {
    const along = lastWalk.x * slab.outward.x + lastWalk.y * slab.outward.y;
    const shift = -((endPosition.x - slab.linePoint.x) * slab.outward.x + (endPosition.y - slab.linePoint.y) * slab.outward.y) / (along || 1);
    // only a stair that really walks out onto the slab there, and only forward
    if (along > SLAB_WALK_MIN_COS && shift > 0) {
      endPosition = { x: endPosition.x + lastWalk.x * shift, y: endPosition.y + lastWalk.y * shift };
      endElevation = { bottom: totalRise, top: totalRise + NEWEL_HEIGHT };
      onSlab = { floorZ: totalRise, shiftMm: shift, edge: slab.edge, outward: slab.outward };
    }
  }
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
  // the second turn of an S (planLayout.js `duszaSide: 'outer'`): its dusza corner is on the OUTER line — the post on
  // the outer wanga's axis there
  const outerDirAt = (i) => (i >= 0 && i < outer.length - 1 ? unitDir(outer[i], outer[i + 1]) : null);
  const outerCornerPosition = (corner) => {
    const i = outer.findIndex((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < POST_COINCIDENCE_MM);
    if (i < 0) return corner;
    return ontoWangaAxis(corner, outerDirAt(i - 1), outerDirAt(i), half, handedness, 'outer');
  };
  // a dusza against a stairwell wall gets no post (user decision 2026-10-23): its two wangi lap at the wall
  const wallPieces = stairwellWalls(stairwellReport(config, planLayout), config, planLayout)?.pieces || [];
  const gap = Math.max(0, Number(config.stairwellWallGapMm) || 0);
  // (in a concave corner the two walls stop where their faces meet — gap × √2 from the corner)
  const atWall = (p) => wallPieces.some((w) => distanceToSegment(p, w.a, w.b) <= gap * Math.SQRT2 + WALL_CORNER_TOL_MM);

  const models = [
    { postId: 'post-start', kind: 'start', position: startPosition, anchor: startAnchor, elevation: startElevation, size: postSize, ...(onStarter >= 0 ? { onStarter } : {}) },
    // Ostatni stopień nie ma noska na swojej przedniej (górnej) krawędzi — nosek jest tylko
    // na krawędziach czołowych — więc słup końcowy nie koliduje z niczym i zostaje wyśrodkowany.
    { postId: 'post-end', kind: 'end', position: endPosition, anchor: endPoint, elevation: endElevation, size: postSize, ...(onSlab ? { onSlab } : {}) },
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
      // one 180° winder zone (planLayout.js buildHalfTurnLocal): ONE central post between the dusza's two corners, on the
      // wangi's axes; both inner boards of the zone (A's end, C's start) butt into it
      if (turn.postSpots) {
        turn.postSpots.forEach((spot, j) => models.push({ postId: `post-corner-${i + j}`, kind: 'corner', position: spot.at, anchor: spot.anchors[0], anchors: spot.anchors, elevation: { bottom: 0, top: totalRise }, size: postSize }));
        return;
      }
      if (turn.duszaSide === 'outer') {
        if (atWall(turn.innerCorner)) return;
        models.push({ postId: `post-corner-${i}`, kind: 'corner', line: 'outer', position: outerCornerPosition(turn.innerCorner), anchor: turn.innerCorner, elevation: { bottom: 0, top: totalRise }, size: postSize });
        return;
      }
      if (atWall(turn.innerCorner)) return; // (an S's walls on the inner line: this dusza stands at the wall)
      models.push({ postId: `post-corner-${i}`, kind: 'corner', position: cornerPosition(turn.innerCorner), anchor: turn.innerCorner, elevation: { bottom: 0, top: totalRise }, size: postSize });
    });
  }

  // A flight can start (treadsLegA = 0) or end (last straight leg = 0) directly with winders: the inner
  // path then begins/ends AT (or, when a turn's arc barely fits, a few mm from) the turn's inner corner, so the
  // start/end newel would stand where the corner post already stands — two posts in one place, or overlapping. The
  // full-height corner post takes that role; the start/end post is only kept when the user removed that corner post,
  // so the spot is never left empty.
  const overrides = sanitizePostOverrides(config.manualPostOverrides);
  const overlaps = (a, b) => Math.abs(a.position.x - b.position.x) < (a.size + b.size) / 2 && Math.abs(a.position.y - b.position.y) < (a.size + b.size) / 2;
  const coveredByCornerPost = (post) => models.some((m) => m.kind === 'corner' && !overrides[m.postId]?.removed && ((m.anchors || [m.anchor]).some((a) => Math.hypot(a.x - post.anchor.x, a.y - post.anchor.y) < POST_COINCIDENCE_MM) || overlaps(m, post)));

  const kept = models.filter((m) => !((m.postId === 'post-start' || m.postId === 'post-end') && coveredByCornerPost(m)));

  return applyPostOverrides(kept, config.manualPostOverrides);
}
