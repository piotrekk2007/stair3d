// The plan's TAPE MEASURE (user request 2026-10-28, plan mode "📏 Miarka"): two clicks on the plan — each snapped onto
// the nearest characteristic point (tread corners, the stringer lines' points, posts, the opening's corners, the
// walls' ends) within a few px, else to whole mm — draw a measure with its length and its Δx / Δy. A view tool only:
// nothing of it is in the config or the project. Pure (the plan renderer draws, planInteractions.js clicks).

/** The measured point: the nearest of `refs` within `tolMm`, else `raw` rounded to whole mm. */
export function snapMeasurePoint(raw, refs, tolMm) {
  let best = null;
  for (const p of refs || []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = Math.hypot(p.x - raw.x, p.y - raw.y);
    if (d <= tolMm && (!best || d < best.d)) best = { p, d };
  }
  return best ? { x: best.p.x, y: best.p.y, snapped: true } : { x: Math.round(raw.x), y: Math.round(raw.y), snapped: false };
}

/** What a measure from a to b says (mm). */
export function planMeasureText(a, b) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return `${Math.round(Math.hypot(dx, dy))} mm (Δx ${Math.round(dx)} · Δy ${Math.round(dy)})`;
}

/**
 * The points a measure snaps to, from the solved models: every tread's outline corners, the stringer lines' points,
 * the posts' centres, the opening's corners, the walls' ends.
 */
export function planMeasureRefs({ planLayout, treadModels, posts, openingOutline, walls }) {
  const out = [];
  for (const t of treadModels || planLayout?.treads || []) for (const p of t.outline || []) out.push(p);
  for (const p of [...(planLayout?.outerFullPath || []), ...(planLayout?.innerFullPath || [])]) out.push(p);
  for (const p of posts || []) if (!p.removed && p.position) out.push(p.position);
  for (const p of openingOutline || []) out.push(p);
  for (const w of walls || []) out.push(w.a, w.b);
  return out;
}
