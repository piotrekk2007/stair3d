// The hand-placed balustrade posts (user decision 2026-10-19: "posts in specific places") — the pure edit layer, read
// by railingSolver.js (like railingProfileModel.js for the handrail line). Nothing here solves geometry.
//
// `config.railingPostEdits = { [sectionId]: { added: [{ id, s }], suppressed: [s] } }`:
//   - `added`: a post placed by hand at distance `s` (mm, in PLAN, along the section's own path from its start — the
//     path railingSolver.js gives as `section.path`). The handrail is cut there like at any post. Its post id is
//     `railing-post-<section>-m-<id>`, so the per-post edits (size, height, …) of `manualPostOverrides` apply to it.
//   - `suppressed`: an AUTOMATIC corner post switched off by hand, identified by the `s` of its corner (matched within
//     SUPPRESS_MATCH_MM): the two handrail runs meeting there become ONE run with a mitred corner. A post where the
//     handrail steps in height cannot be switched off (the handrail must end there).
//   - `moved` (user decision 2026-10-20: every automatic post can be moved): `{ [spotKey]: s }` — an AUTOMATIC post
//     put elsewhere along the path: `start` / `end` (the section's balustrade then begins / ends there — a structural
//     post it stood on stays, the balustrade gets its own post) or `join-<k>` (an automatic corner post — its corner
//     becomes a mitred one and the post cuts the handrail at `s` instead). Back to AUTO = the key removed.
//   - `bare`: [runKey] — handrail runs ('postA>postB', railingRunKey) with NO infill: no balusters / glass, the handrail
//     on its two posts only.
//   - `wallRail`: { start?: true, end?: true } — before the section's (moved) start post / after its (moved) end post
//     the handrail goes on along the WALL to the path's end: on wall brackets, no posts, no infill, free end.

export const SUPPRESS_MATCH_MM = 50;
// A hand-placed post closer than this to a run's end (another post, a corner, a step) is not placed — it would leave a
// handrail piece too short to hold (reported).
export const MANUAL_POST_MIN_FROM_END_MM = 100;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Cleans the edits: known shape only, finite non-negative distances, unique ids per section. */
export function sanitizeRailingPostEdits(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [sectionId, e] of Object.entries(raw)) {
    if (!e || typeof e !== 'object') continue;
    const seen = new Set();
    const added = (Array.isArray(e.added) ? e.added : [])
      .filter((p) => p && typeof p.id === 'string' && p.id && finite(p.s) && p.s >= 0 && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ id: p.id, s: Math.round(p.s * 10) / 10 }))
      .sort((a, b) => a.s - b.s);
    const suppressed = (Array.isArray(e.suppressed) ? e.suppressed : []).filter((s) => finite(s) && s >= 0).map((s) => Math.round(s * 10) / 10);
    const moved = {};
    if (e.moved && typeof e.moved === 'object') {
      for (const [key, s] of Object.entries(e.moved)) if (/^(start|end|join-\d+)$/.test(key) && finite(s) && s >= 0) moved[key] = Math.round(s * 10) / 10;
    }
    const bare = [...new Set((Array.isArray(e.bare) ? e.bare : []).filter((k) => typeof k === 'string' && k.includes('>')))];
    const wallRail = {};
    if (e.wallRail?.start === true) wallRail.start = true;
    if (e.wallRail?.end === true) wallRail.end = true;
    const entry = { added, suppressed };
    if (Object.keys(moved).length) entry.moved = moved;
    if (bare.length) entry.bare = bare;
    if (Object.keys(wallRail).length) entry.wallRail = wallRail;
    if (added.length || suppressed.length || entry.moved || entry.bare || entry.wallRail) out[sectionId] = entry;
  }
  return out;
}

/** The post id of a hand-placed post. */
export function manualRailingPostId(sectionId, id) {
  return `railing-post-${sectionId}-m-${id}`;
}

/**
 * The pure edit behind the plan's "Słupki balustrady" mode and the Inspektor's position field: returns NEW edits.
 * `add` (s) → a new post (the next free id `m1`, `m2`, …); `move` (id, s); `remove` (id); `suppress` (s — an
 * automatic corner post off); `restore` (s — back on).
 */
export function applyRailingPostEdit(rawEdits, { action, sectionId, id, s, key, runKey, on, end }) {
  const edits = sanitizeRailingPostEdits(rawEdits);
  const e = edits[sectionId] || { added: [], suppressed: [] };
  const next = { added: e.added.map((p) => ({ ...p })), suppressed: [...e.suppressed], moved: { ...(e.moved || {}) }, bare: [...(e.bare || [])], wallRail: { ...(e.wallRail || {}) } };
  const at = Math.max(0, Math.round((Number(s) || 0) * 10) / 10);
  if (action === 'add') {
    let k = 1;
    while (next.added.some((p) => p.id === `m${k}`)) k++;
    next.added.push({ id: `m${k}`, s: at });
  } else if (action === 'move') {
    const p = next.added.find((x) => x.id === id);
    if (p) p.s = at;
  } else if (action === 'remove') {
    next.added = next.added.filter((x) => x.id !== id);
  } else if (action === 'remove-all-manual') {
    next.added = [];
  } else if (action === 'suppress') {
    if (!next.suppressed.some((x) => Math.abs(x - at) < SUPPRESS_MATCH_MM)) next.suppressed.push(at);
  } else if (action === 'restore') {
    next.suppressed = next.suppressed.filter((x) => Math.abs(x - at) >= SUPPRESS_MATCH_MM);
  } else if (action === 'move-auto' && typeof key === 'string') {
    next.moved[key] = at;
  } else if (action === 'reset-auto' && typeof key === 'string') {
    delete next.moved[key];
  } else if (action === 'bare' && typeof runKey === 'string') {
    next.bare = next.bare.filter((k) => k !== runKey);
    if (on) next.bare.push(runKey);
  } else if (action === 'wall-rail' && (end === 'start' || end === 'end')) {
    if (on) next.wallRail[end] = true;
    else delete next.wallRail[end];
  }
  return sanitizeRailingPostEdits({ ...edits, [sectionId]: { ...next, added: next.added.sort((a, b) => a.s - b.s) } });
}
