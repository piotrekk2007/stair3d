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
    if (added.length || suppressed.length) out[sectionId] = { added, suppressed };
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
export function applyRailingPostEdit(rawEdits, { action, sectionId, id, s }) {
  const edits = sanitizeRailingPostEdits(rawEdits);
  const e = edits[sectionId] || { added: [], suppressed: [] };
  const next = { added: e.added.map((p) => ({ ...p })), suppressed: [...e.suppressed] };
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
  } else if (action === 'suppress') {
    if (!next.suppressed.some((x) => Math.abs(x - at) < SUPPRESS_MATCH_MM)) next.suppressed.push(at);
  } else if (action === 'restore') {
    next.suppressed = next.suppressed.filter((x) => Math.abs(x - at) >= SUPPRESS_MATCH_MM);
  }
  const out = { ...edits };
  if (next.added.length || next.suppressed.length) out[sectionId] = { added: next.added.sort((a, b) => a.s - b.s), suppressed: next.suppressed };
  else delete out[sectionId];
  return out;
}
