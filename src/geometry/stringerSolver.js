// Builds a StringerModel (see stringerModel.js) for one side ('outer' | 'inner') of a
// staircase from a planLayout. This is the SOLVER for stringers: pure function, no
// Three.js, no rendering, no mutation of its inputs. stringerRenderer.js is the ONLY
// consumer that turns this into Three.js geometry — see .claude/RULES.md rule 8.
//
// The one idea this whole file exists to implement correctly:
//
//   StringerReferenceGeometry comes from tread.outerChain / tread.innerChain (RAW, never
//   touched by edgeOverrides.js).
//   StringerTreadBearingGeometry comes from tread.frontEdge / tread.backEdge (the FINAL,
//   possibly manually-edited fields).
//
// Because those are already two different fields on `tread` upstream (planLayout.js /
// edgeOverrides.js), this solver gets the separation "for free" as long as it is careful to
// read the right field for the right purpose — which is exactly what buildRawWalks (reads
// chain fields) and buildBearingsForWalk (reads frontEdge/backEdge fields) each do.

import { cumulativeDistances, isCollinear, projectPointOntoLine, pointsEqual } from './pathUtils.js';
import { COLLINEAR_EPS } from './tolerances.js';
import { isCornerPostRemoved, buildPostModels } from './postSolver.js';
import { inwardNormal } from './planLayout.js';
import { profileParamsFromConfig } from './stringerProfileModel.js';
import {
  CONSTRUCTION_TYPES,
  CONNECTION_TYPES,
  housingDepthFor,
  constructionTypeForSide,
  MIN_NEWEL_TENON_THICKNESS_MM,
  MIN_NEWEL_TENON_LENGTH_MM,
  assertReferenceLineIsStraight,
} from './stringerModel.js';

// One "walk" = a maximal run of treads whose raw chain (on this side) is physically
// continuous — broken only where this side genuinely has no board (a landing tread's
// innerChain is an empty array by construction, see planLayout.js buildLandingLocal). Each
// point in a walk records which tread(s) start/end exactly there, so later steps can assign
// bearings by identity instead of re-matching coordinates.
function buildRawWalks(treads, chainKey) {
  const walks = [];
  let current = null;
  for (const tread of treads) {
    const chain = tread[chainKey];
    if (!chain || chain.length < 2) {
      current = null;
      continue;
    }
    if (current && pointsEqual(current.points[current.points.length - 1].pt, chain[0])) {
      current.points[current.points.length - 1].treadStarts.push(tread.index);
    } else {
      current = { points: [{ pt: chain[0], treadStarts: [tread.index], treadEnds: [] }] };
      walks.push(current);
    }
    for (let k = 1; k < chain.length; k++) {
      current.points.push({ pt: chain[k], treadStarts: [], treadEnds: [] });
    }
    current.points[current.points.length - 1].treadEnds.push(tread.index);
  }
  return walks;
}

// Splits one walk's points into maximal straight runs, at real corners only (cross-product
// test — see planLayout.js removeCollinearPoints for the same underlying idea, applied there
// to a different problem, using the SAME canonical isCollinear()/COLLINEAR_EPS). Returns runs
// with GLOBAL (walk-relative) cumulative-distance bounds — buildBearingsForWalk consumes
// those directly; buildStringerModel converts to segment-local u before the model is
// returned, so a StringerSegment's own u values are always relative to ITS OWN
// referenceLine.start, never to some other segment's.
function splitWalkIntoRuns(walk) {
  const pts = walk.points.map((e) => e.pt);
  const cum = cumulativeDistances(pts);
  const cornerIdx = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    if (!isCollinear(pts[i - 1], pts[i], pts[i + 1])) cornerIdx.push(i);
  }
  cornerIdx.push(pts.length - 1);

  const runs = [];
  for (let k = 0; k < cornerIdx.length - 1; k++) {
    const i0 = cornerIdx[k];
    const i1 = cornerIdx[k + 1];
    if (i0 === i1) continue; // zero-length (can happen if two "corners" coincide)
    runs.push({ startIdx: i0, endIdx: i1, uStart: cum[i0], uEnd: cum[i1], start: pts[i0], end: pts[i1] });
  }
  return runs;
}

// For every tread touched by this walk, finds which run(s) its raw [start,end] boundary
// range overlaps, and builds one bearing entry per overlapping run. In the overwhelmingly
// common case exactly one run overlaps. More than one run overlaps only when a SINGLE
// tread's own raw chain crosses a genuine corner (e.g. a winder tread whose fraction of the
// turn happens to straddle the outer bend point) — in that case the tread's structural
// support is genuinely split across two boards, and both bearings are returned, each marked
// `partial: true`.
function buildBearingsForWalk(walk, runs, treads, sideIdx) {
  const cum = cumulativeDistances(walk.points.map((e) => e.pt));
  const treadRange = new Map();
  walk.points.forEach((entry, idx) => {
    for (const ti of entry.treadStarts) treadRange.set(ti, { ...(treadRange.get(ti) || {}), startIdx: idx });
    for (const ti of entry.treadEnds) treadRange.set(ti, { ...(treadRange.get(ti) || {}), endIdx: idx });
  });

  const bearingsByRun = runs.map(() => []);

  for (const [treadIndex, range] of treadRange) {
    if (range.startIdx === undefined || range.endIdx === undefined) continue;
    const rawUStartGlobal = cum[range.startIdx];
    const rawUEndGlobal = cum[range.endIdx];

    const overlapping = [];
    runs.forEach((run, runIdx) => {
      if (run.uStart < rawUEndGlobal - COLLINEAR_EPS && run.uEnd > rawUStartGlobal + COLLINEAR_EPS) {
        overlapping.push({ run, runIdx });
      }
    });

    const tread = treads[treadIndex];
    overlapping.forEach(({ run, runIdx }, i) => {
      const ownsStart = i === 0; // this run contains the tread's TRUE front boundary
      const ownsEnd = i === overlapping.length - 1; // this run contains the TRUE back boundary
      const localRawUStart = Math.max(0, rawUStartGlobal - run.uStart);
      const localRawUEnd = Math.min(run.uEnd - run.uStart, rawUEndGlobal - run.uStart);

      let finalUStart = localRawUStart;
      let offsetStart = 0;
      if (ownsStart) {
        const proj = projectPointOntoLine(tread.frontEdge[sideIdx], run.start, run.end);
        finalUStart = proj.u;
        offsetStart = proj.offset;
      }

      let finalUEnd = localRawUEnd;
      let offsetEnd = 0;
      if (ownsEnd) {
        const proj = projectPointOntoLine(tread.backEdge[sideIdx], run.start, run.end);
        finalUEnd = proj.u;
        offsetEnd = proj.offset;
      }

      bearingsByRun[runIdx].push({
        treadIndex,
        partial: overlapping.length > 1,
        ownsStart,
        ownsEnd,
        uStart: localRawUStart,
        uEnd: localRawUEnd,
        finalUStart,
        finalUEnd,
        offsetStart,
        offsetEnd,
      });
    });
  }

  return bearingsByRun;
}

// A board never runs past a structural post (start newel, corner post, end newel): it butts into the post's face,
// and the post is where the two boards of a turn are joined (the joint itself — tenon, housing — is a later detail).
// This finds, for one board of the INNER wanga, the post standing at its start / end chain point (postSolver.js
// `anchor` — the SAME posts that are rendered and priced) and where that post's face lies along the board's own
// reference line (local u). null when no post stands there (a postless lap joint, a removed post, the outer side).
const POST_ANCHOR_TOLERANCE_MM = 1;
function boardEndPosts(segment, posts) {
  const { start, end, direction } = segment.referenceLine;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < POST_ANCHOR_TOLERANCE_MM;
  const centreU = (p) => (p.position.x - start.x) * direction.x + (p.position.y - start.y) * direction.y;
  const describe = (p, faceSign) => ({
    postId: p.postId,
    centreU: centreU(p),
    faceU: centreU(p) + (faceSign * p.size) / 2,
    sizeMm: p.size,
    elevation: { ...p.elevation },
  });
  const withAnchor = posts.filter((p) => p.anchor);
  const atStart = withAnchor.find((p) => near(p.anchor, start));
  const atEnd = withAnchor.find((p) => near(p.anchor, end));
  return { startPost: atStart ? describe(atStart, +1) : null, endPost: atEnd ? describe(atEnd, -1) : null };
}

/**
 * @param {import('./planLayout.js').PlanLayout} planLayout  (already includes any manual
 *   edge overrides — see planLayout.js buildPlanLayout, which applies them before returning)
 * @param {Object} config  Full staircase config, plus `riserHeight` (as buildStaircase.js
 *   already merges in before calling buildPlanLayout — see fullConfig there)
 * @param {'outer'|'inner'} side
 * @returns {import('./stringerModel.js').StringerModel}
 */
export function buildStringerModel(planLayout, config, side) {
  const chainKey = side === 'outer' ? 'outerChain' : 'innerChain';
  const sideIdx = side === 'outer' ? 1 : 0; // frontEdge/backEdge = [innerPoint, outerPoint]
  const { riserHeight, treadThickness, stringerThickness, riserBoardThickness, hasRiserBoards } = config;
  // The nominal depth the lower contour is generated at (minimum depth + profile offset) — the
  // segment's "width" is that board depth, one definition shared with the profile solver.
  const boardDepth = profileParamsFromConfig(config).nominalDepthMm;
  const constructionType = constructionTypeForSide(config, side);

  const walks = buildRawWalks(planLayout.treads, chainKey);
  // Structural posts stand on the inner line only (postSolver.js), so only an inner board can end at one.
  const posts = side === 'inner' ? buildPostModels(planLayout, config) : [];

  const segments = [];
  const segmentJoints = [];
  let segmentCounter = 0;

  for (const walk of walks) {
    const runs = splitWalkIntoRuns(walk);
    const bearingsByRun = buildBearingsForWalk(walk, runs, planLayout.treads, sideIdx);
    const walkSegmentIds = [];

    runs.forEach((run, runIdx) => {
      const dx = run.end.x - run.start.x;
      const dy = run.end.y - run.start.y;
      const length = Math.hypot(dx, dy);
      const direction = length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };

      const treadBearings = bearingsByRun[runIdx].map((b) => {
        const tread = planLayout.treads[b.treadIndex];
        // The wanga steps back by the riser board's own thickness (the riser stands in that gap) — NOT by
        // the nosing, which is only an overhang measured forward from the riser face.
        const riserRecess = hasRiserBoards && tread.type !== 'landing' && riserBoardThickness > 0 ? riserBoardThickness : 0;
        return {
          ...b,
          bearingElevation: (tread.index + 1) * riserHeight - treadThickness,
          riserRecess,
        };
      });

      const segment = {
        id: `${side}-seg-${segmentCounter++}`,
        referenceLine: { start: run.start, end: run.end, direction, length },
        // Plan direction the board's thickness goes to from its reference line (into the stair) — decided here,
        // from the layout's handedness, so the renderer never has to (planLayout.js inwardNormal).
        inwardNormal: inwardNormal(direction, side, planLayout.handedness ?? 1),
        width: boardDepth,
        thickness: stringerThickness,
        constructionType,
        treadBearings,
      };
      Object.assign(segment, boardEndPosts(segment, posts));
      assertReferenceLineIsStraight(segment);
      segments.push(segment);
      walkSegmentIds.push(segment.id);
    });

    for (let k = 0; k < walkSegmentIds.length - 1; k++) {
      const prev = segments.find((s) => s.id === walkSegmentIds[k]);
      segmentJoints.push({
        // A corner post the user removed no longer interrupts the board: that turn's two boards
        // meet on a lap joint (and are solved as one continuous profile), like with no posts at all.
        type: side === 'inner' && config.hasCornerPost && !isCornerPostRemoved(planLayout, config, prev.referenceLine.end) ? CONNECTION_TYPES.CORNER_POST : CONNECTION_TYPES.LAP_JOINT,
        position: prev.referenceLine.end,
        beforeSegmentId: walkSegmentIds[k],
        afterSegmentId: walkSegmentIds[k + 1],
      });
    }
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const bottomConnection = first ? { type: CONNECTION_TYPES.NEWEL_TENON, position: first.referenceLine.start } : null;
  const topConnection = last ? { type: CONNECTION_TYPES.NEWEL_TENON, position: last.referenceLine.end } : null;

  // Corner posts sit at the inner-turn corner regardless of which side's board is nearest —
  // see postGeometry.js buildPosts, which places exactly one post per turn at
  // turn.innerCorner. We only attach it as an "intermediate support" to the inner-side model
  // here because that is the board it structurally interrupts; the outer board's corner is a
  // bend WITHIN its own reference-line runs (already captured as a segmentJoint above), not a
  // separate post.
  const intermediateSupports = [];
  if (side === 'inner' && config.hasCornerPost) {
    for (const turn of planLayout.turns) {
      if (isCornerPostRemoved(planLayout, config, turn.innerCorner)) continue;
      intermediateSupports.push({ type: CONNECTION_TYPES.CORNER_POST, position: turn.innerCorner });
    }
  }

  const strengthClass = config.timberGrade || 'C24';
  const material = {
    species: `Drewno konstrukcyjne, klasa ${strengthClass}`,
    strengthClass,
    serviceClass: 'SC1', // heated interior — see EC5-STRUCT-I-03 in docs/rules/TECHNICAL_RULES_CATALOGUE.md
  };
  const manufacturing = {
    housingDepth: constructionType === CONSTRUCTION_TYPES.CLOSED ? housingDepthFor(stringerThickness) : null,
    tenonThickness: MIN_NEWEL_TENON_THICKNESS_MM,
    tenonLength: MIN_NEWEL_TENON_LENGTH_MM,
  };

  return { side, segments, segmentJoints, topConnection, bottomConnection, intermediateSupports, material, manufacturing };
}

export function buildStringerModelsForFlight(planLayout, config) {
  return {
    outer: buildStringerModel(planLayout, config, 'outer'),
    inner: buildStringerModel(planLayout, config, 'inner'),
  };
}
