// HANDRAIL PROFILE — the manual-edit layer of a handrail run (pure, no Three.js, no DOM). A run is a piece of
// handrail between two posts (railingSolver.js); its AUTO line is the simplified nosing line cut to the post faces.
// The user may shape it by hand, the same way a wanga's profile is edited:
//
//   * the END of a run at its post moves up/down:   config.railingEndOffsets = { [railingEndKey]: mm }
//   * POINTS along the run move its line up/down:   config.railingProfileOverrides =
//         { [sectionId]: { [railingRunKey]: [{ s, dz }] } }
//     `s` = plan distance along the run from its start (the start post's face), `dz` = mm up (+) / down (−) from the
//     run's own line there (the line through its ends as corrected at the posts). A point at an existing vertex of the
//     line moves that vertex; anywhere else it adds a vertex.
//
// A manual edit is kept as given and reported, never silently corrected (the project's rule); only values out of range
// are clamped, and a point outside its run (the run got shorter) is skipped and reported.

export const MAX_RAILING_END_OFFSET_MM = 400;
export const MAX_RAILING_POINT_OFFSET_MM = 400;
export const SAME_STATION_MM = 1; // two points closer than this along the run are the same point
export const MIN_POINT_FROM_END_MM = 20; // a point this close to a run's end is the end itself (edited there)

export function railingEndKey(sectionId, postId, end) {
  return `${sectionId}|${postId}|${end}`;
}

export function railingRunKey(startPostId, endPostId) {
  return `${startPostId}>${endPostId}`;
}

const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));

export function sanitizeRailingEndOffsets(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const v = Number(value);
    if (!/\|(start|end)$/.test(key) || !Number.isFinite(v) || v === 0) continue;
    out[key] = clamp(v, MAX_RAILING_END_OFFSET_MM);
  }
  return out;
}

function sanitizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const points = [];
  for (const p of raw) {
    const s = Number(p?.s);
    const dz = Number(p?.dz);
    if (!Number.isFinite(s) || !Number.isFinite(dz) || s < 0) continue;
    if (points.some((q) => Math.abs(q.s - s) < SAME_STATION_MM)) continue;
    points.push({ s, dz: clamp(dz, MAX_RAILING_POINT_OFFSET_MM) });
  }
  return points.sort((a, b) => a.s - b.s);
}

export function sanitizeRailingProfileOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [sectionId, runs] of Object.entries(raw)) {
    if (!runs || typeof runs !== 'object') continue;
    const kept = {};
    for (const [runKey, points] of Object.entries(runs)) {
      const clean = sanitizePoints(points);
      if (clean.length > 0) kept[runKey] = clean;
    }
    if (Object.keys(kept).length > 0) out[sectionId] = kept;
  }
  return out;
}

/**
 * Lays the user's points onto a run's line.
 * @param {{x:number,y:number,z:number}[]} path  the run's line (nosing level), from post face to post face
 * @param {{s:number, dz:number}[]} points  sanitized points of this run
 * @returns {{path: Object[], control: Array<{s, z, baseZ, dz, kind:'end'|'vertex'|'added'}>, skipped: number}}
 *   `control` = every vertex of the shaped line (the editor's handles); `skipped` = points outside the run.
 */
export function applyRunPoints(path, points = []) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = cum[cum.length - 1];
  const verts = path.map((p, i) => ({ ...p, s: cum[i], baseZ: p.z, dz: 0, kind: i === 0 || i === path.length - 1 ? 'end' : 'vertex' }));
  // a point's base height is read off the ORIGINAL line, so the result does not depend on the order of the points
  const baseAt = (s) => {
    let i = 1;
    while (i < path.length - 1 && cum[i] < s) i++;
    const span = cum[i] - cum[i - 1];
    const t = span > 0 ? (s - cum[i - 1]) / span : 0;
    const a = path[i - 1];
    const b = path[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  };
  let skipped = 0;
  for (const point of points) {
    if (!(point.s > MIN_POINT_FROM_END_MM && point.s < total - MIN_POINT_FROM_END_MM)) {
      skipped++;
      continue;
    }
    const existing = verts.find((v) => v.kind !== 'end' && Math.abs(v.s - point.s) < SAME_STATION_MM);
    if (existing) {
      existing.dz = point.dz;
      existing.z = existing.baseZ + point.dz;
      continue;
    }
    const base = baseAt(point.s);
    verts.push({ ...base, s: point.s, baseZ: base.z, z: base.z + point.dz, dz: point.dz, kind: 'added' });
  }
  verts.sort((a, b) => a.s - b.s);
  return {
    path: verts.map(({ s, baseZ, dz, kind, ...node }) => node),
    control: verts.map((v) => ({ s: v.s, z: v.z, baseZ: v.baseZ, dz: v.dz, kind: v.kind })),
    skipped,
  };
}

// ---- edits (the editor's gestures become these; they only produce new config values) ----

export const RAILING_PROFILE_EDITS = Object.freeze({
  SET_POINT: 'SET_POINT', // {sectionId, runKey, s, dz}: add or move a point (dz 0 keeps an added point on the line)
  REMOVE_POINT: 'REMOVE_POINT', // {sectionId, runKey, s}
  SET_END: 'SET_END', // {sectionId, postId, end: 'start'|'end', dz}
  RESET_RUN: 'RESET_RUN', // {sectionId, runKey, startPostId, endPostId}: the run back to AUTO (points and both ends)
});

/**
 * @param {{railingProfileOverrides?: Object, railingEndOffsets?: Object}} state  the two config fields
 * @param {Object} edit
 * @returns {{railingProfileOverrides: Object, railingEndOffsets: Object}}  new values (inputs untouched)
 */
export function applyRailingProfileEdit(state, edit) {
  const profile = sanitizeRailingProfileOverrides(state?.railingProfileOverrides);
  const ends = { ...sanitizeRailingEndOffsets(state?.railingEndOffsets) };
  const runPoints = () => [...(profile[edit.sectionId]?.[edit.runKey] || [])];
  const store = (points) => {
    profile[edit.sectionId] = { ...(profile[edit.sectionId] || {}), [edit.runKey]: points };
  };
  switch (edit?.type) {
    case RAILING_PROFILE_EDITS.SET_POINT: {
      const points = runPoints().filter((p) => Math.abs(p.s - edit.s) >= SAME_STATION_MM);
      points.push({ s: edit.s, dz: Number.isFinite(edit.dz) ? edit.dz : 0 });
      store(points);
      break;
    }
    case RAILING_PROFILE_EDITS.REMOVE_POINT:
      store(runPoints().filter((p) => Math.abs(p.s - edit.s) >= SAME_STATION_MM));
      break;
    case RAILING_PROFILE_EDITS.SET_END:
      ends[railingEndKey(edit.sectionId, edit.postId, edit.end)] = Number.isFinite(edit.dz) ? edit.dz : 0;
      break;
    case RAILING_PROFILE_EDITS.RESET_RUN:
      store([]);
      delete ends[railingEndKey(edit.sectionId, edit.startPostId, 'start')];
      delete ends[railingEndKey(edit.sectionId, edit.endPostId, 'end')];
      break;
    default:
      break;
  }
  return { railingProfileOverrides: sanitizeRailingProfileOverrides(profile), railingEndOffsets: sanitizeRailingEndOffsets(ends) };
}
