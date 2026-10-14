// Stacked inner wangi of a 180° winder zone (planLayout.js buildHalfTurnLocal) — a pure CHECK, decides no geometry.
// With the axes of A's and C's inner wangi closer than a board's thickness (config.uAxisGapMm < stringerThickness;
// 0 = the wanga of C straight above the wanga of A) the two boards share one strip of the plan, A low, C high. Near the
// central post their AUTO profiles overlap in height (A's top edge climbs towards the post, C's bottom edge starts
// there). User decision 2026-10-14 (variant 2): they are NOT trimmed automatically — the overlap is reported, with
// how much and where, and corrected by hand in the "Profil wangi" editor (the board's points on the post face).

import { createDiagnostic } from '../diagnostics/diagnostic.js';

const SAMPLE_STEP_MM = 10;
const OVERLAP_TOLERANCE_MM = 0.5;

// The lowest and highest v of a closed (u, v) outline at u = u0, or null when the outline does not reach there.
function sliceAt(outline, u0) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if ((a.u - u0) * (b.u - u0) > 0 || (a.u === b.u && a.u !== u0)) continue;
    const vs = a.u === b.u ? [a.v, b.v] : [a.v + ((b.v - a.v) * (u0 - a.u)) / (b.u - a.u)];
    for (const v of vs) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/**
 * @param {{planLayout, stringerModels, stringerConstruction, config}} models
 * @returns {import('../diagnostics/diagnostic.js').Diagnostic[]}  one WARNING per overlapping pair (on the upper board)
 */
export function checkStackedInnerStringers({ planLayout, stringerModels, stringerConstruction, config }) {
  const turn = (planLayout?.turns || []).find((t) => t.halfTurn && t.postSpots?.length === 1);
  const t = Number(config?.stringerThickness) || 0;
  const d = Number(config?.uAxisGapMm) || 0;
  if (!turn || !(t > 0) || !(d < t)) return [];
  const segments = stringerModels?.inner?.segments || [];
  const lower = segments.find((s) => s.endPost?.postId && segments.some((o) => o !== s && o.startPost?.postId === s.endPost.postId));
  const upper = lower && segments.find((s) => s !== lower && s.startPost?.postId === lower.endPost.postId);
  if (!lower || !upper) return [];
  const geoOf = (seg) => (stringerConstruction?.inner || []).find((g) => g.segmentId === seg.id);
  const gLow = geoOf(lower);
  const gUp = geoOf(upper);
  if (!gLow?.outerContour?.length || !gUp?.outerContour?.length) return [];

  // one plan coordinate for both boards: the distance along the LOWER board's own line
  const base = lower.referenceLine.start;
  const dir = lower.referenceLine.direction;
  const along = (seg, u) => (seg.referenceLine.start.x + seg.referenceLine.direction.x * u - base.x) * dir.x + (seg.referenceLine.start.y + seg.referenceLine.direction.y * u - base.y) * dir.y;
  const backTo = (seg, s) => {
    const k = seg.referenceLine.direction.x * dir.x + seg.referenceLine.direction.y * dir.y; // ±1: parallel or back
    return (s - along(seg, 0)) / (k || 1);
  };
  const range = (seg, g) => {
    const us = g.outerContour.map((p) => along(seg, p.u));
    return [Math.min(...us), Math.max(...us)];
  };
  const [l0, l1] = range(lower, gLow);
  const [u0, u1] = range(upper, gUp);
  const from = Math.max(l0, u0);
  const to = Math.min(l1, u1);
  if (!(to > from)) return [];

  // on an overlay (nakładana) lower board A's treads lie ON its top edge, in the same strip: the upper board has to
  // clear them too; a housed board holds its treads below its top edge
  const onTop = lower.constructionType === 'cut' ? Number(config.treadThickness) || 0 : 0;
  let worst = null;
  for (let s = from; s <= to + 1e-9; s += SAMPLE_STEP_MM) {
    const a = sliceAt(gLow.outerContour, backTo(lower, s));
    const b = sliceAt(gUp.outerContour, backTo(upper, s));
    if (!a || !b) continue;
    const overlap = a.hi + onTop - b.lo;
    if (!worst || overlap > worst.overlap) worst = { overlap, s };
  }
  if (!worst || worst.overlap <= OVERLAP_TOLERANCE_MM) return [];
  const postId = lower.endPost.postId;
  const fromPost = lower.endPost.faceU - worst.s;
  const where = fromPost < 1 ? `przy licu słupa ${postId}` : `${Math.round(fromPost)} mm od lica słupa ${postId}`;
  return [
    createDiagnostic({
      ruleId: 'STRINGER-STACKED-OVERLAP',
      severity: 'WARNING',
      elementType: 'stringer',
      elementId: upper.id,
      parameter: 'manualStringerProfileOverrides',
      value: Math.round(worst.overlap),
      expected: '<= 0',
      unit: 'mm',
      message:
        `Wangi ${lower.id} i ${upper.id} leżą jedna nad drugą (klatka zabiegowa 180°, rozstaw osi ${Math.round(d)} mm) i zachodzą na siebie do ` +
        `${Math.round(worst.overlap)} mm wysokości ${where}${onTop ? ' (licząc stopnie leżące na wandze nakładanej)' : ''}. Skoryguj w „Profil wangi”: obniż górną ` +
        `krawędź wangi ${lower.id} albo podnieś dolną krawędź wangi ${upper.id} przy słupie (punkty na licu słupa).`,
    }),
  ];
}
