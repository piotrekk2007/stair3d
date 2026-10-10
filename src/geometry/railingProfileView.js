// Side-view data of ONE handrail run for the "Profil poręczy" editor — plain data, no DOM, no geometry decisions:
// everything is read off the solved railing model (railingSolver.js `runs[].profile`) and unfolded along the run:
// u = plan distance along the run from its start (the start post's face), v = elevation.

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const VIEW_BELOW_NOSING_MM = 250;
const VIEW_ABOVE_RAIL_MM = 400;
const VIEW_MARGIN_MM = 120;

function cumulative(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
  return cum;
}

// Plan arc length of the point of `path` nearest to p, and how far p is from it.
function stationOf(path, cum, p) {
  let best = { u: 0, d: Infinity };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < best.d) best = { u: cum[i - 1] + Math.sqrt(l2) * t, d };
  }
  return best;
}

const unfold = (path) => {
  const cum = cumulative(path);
  return path.map((p, i) => ({ u: cum[i], v: p.z }));
};

/** v of an unfolded polyline at u (clamped to its ends). */
export function valueAt(line, u) {
  if (line.length === 0) return 0;
  if (u <= line[0].u) return line[0].v;
  for (let i = 1; i < line.length; i++) {
    if (u <= line[i].u) {
      const span = line[i].u - line[i - 1].u;
      const t = span > 0 ? (u - line[i - 1].u) / span : 0;
      return line[i - 1].v + (line[i].v - line[i - 1].v) * t;
    }
  }
  return line[line.length - 1].v;
}

/** Every run that can be edited: [{sectionId, runKey, label}]. */
export function listRailingRuns(railingModel) {
  const out = [];
  for (const s of railingModel?.sections || []) {
    if (!s.valid) continue;
    s.runs.forEach((run, i) => out.push({ sectionId: s.id, runKey: run.key, label: `${s.id} · bieg ${i + 1}: ${run.startPostId} → ${run.endPostId}` }));
  }
  return out;
}

/**
 * @param {Object} models  buildStaircase() result (railingModel, allPostModels, fullConfig)
 * @param {{sectionId: string, runKey: string}} which
 * @returns {null | Object}  see the fields below
 */
export function buildRailingProfileView(models, which) {
  const section = models?.railingModel?.sections?.find((s) => s.valid && s.id === which?.sectionId);
  const run = section?.runs.find((r) => r.key === which.runKey);
  if (!run?.profile) return null;
  const config = models.fullConfig;
  const { final, auto, base, nosing, control } = run.profile;
  const top = config.railingHeightMm; // the handrail's TOP above its nosing-level line
  const h = section.handrail.heightMm;
  const finalCum = cumulative(final);
  const lengthMm = finalCum[finalCum.length - 1];
  const lift = (line, by) => line.map((p) => ({ u: p.u, v: p.v + by }));
  const finalLine = unfold(final);
  const posts = (models.allPostModels || []).filter((p) => !p.removed);
  const postBox = (postId, atStart) => {
    const post = posts.find((p) => p.postId === postId);
    if (!post) return null;
    return { postId, u0: atStart ? -post.size : lengthMm, u1: atStart ? 0 : lengthMm + post.size, v0: post.elevation.bottom, v1: post.elevation.top };
  };
  const balusters = section.balusters
    .map((b) => ({ b, st: stationOf(final, finalCum, b.position) }))
    .filter(({ st }) => st.d < 60 && st.u > 0.5 && st.u < lengthMm - 0.5)
    .map(({ b, st }) => ({ u: st.u, v0: b.zBottom, v1: b.zTop }));
  const controls = control.map((c, i) => ({
    id: c.kind === 'end' ? (i === 0 ? 'end:start' : 'end:end') : `pt:${c.s.toFixed(3)}`,
    kind: c.kind,
    s: c.s,
    u: c.s,
    v: c.z + top,
    // an end's own correction is the run's start/end offset; a point's is its dz from the run's line
    dz: c.kind === 'end' ? (i === 0 ? run.startOffsetMm : run.endOffsetMm) : c.dz,
    edited: c.kind === 'end' ? (i === 0 ? run.startOffsetMm : run.endOffsetMm) !== 0 : c.dz !== 0 || c.kind === 'added',
  }));
  const railTop = lift(finalLine, top);
  const nosingLine = nosing.map((n) => ({ u: stationOf(final, finalCum, n).u, v: n.z }));
  const boxes = [postBox(run.startPostId, true), postBox(run.endPostId, false)].filter(Boolean);
  const railMax = Math.max(...railTop.map((p) => p.v));
  return {
    sectionId: section.id,
    runKey: run.key,
    startPostId: run.startPostId,
    endPostId: run.endPostId,
    bent: run.bent,
    lengthMm,
    handrailHeightMm: h,
    railingHeightMm: top,
    railTop,
    railBottom: lift(finalLine, top - h),
    autoTop: lift(unfold(auto), top), // the AUTO handrail (before any manual correction), for comparison
    baseTop: lift(unfold(base), top), // the line the points' dz is measured from (ends corrected, no points)
    nosing: nosingLine,
    posts: boxes,
    balusters,
    controls,
    edited: controls.some((c) => c.edited),
    bounds: {
      uMin: Math.min(0, ...boxes.map((p) => p.u0)),
      uMax: Math.max(lengthMm, ...boxes.map((p) => p.u1)),
      // the view shows the handrail and the nosing line; a newel standing on the floor is drawn only as far down as
      // VIEW_BELOW_NOSING_MM below the lowest nosing
      vMin: Math.min(...nosingLine.map((p) => p.v)) - VIEW_BELOW_NOSING_MM,
      vMax: Math.max(railMax, ...boxes.map((p) => Math.min(p.v1, railMax + VIEW_ABOVE_RAIL_MM))) + VIEW_MARGIN_MM,
    },
  };
}
