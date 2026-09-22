// STRINGER PROFILE MODEL — vocabulary, parameters and the manual-override data layer of a
// stringer's ELEVATION PROFILE (the board's shape in the unfolded (s,z) side view).
// See docs/architecture/STRINGER_PROFILE_MODEL.md for the full design.
//
// Terminology (kept exact — the code, the docs and the UI all use these words):
//
//   Stringer reference path  the stringer's line in PLAN (XY). Today one straight line per
//                            segment (RULES.md #5). A property of the PLAN, not of the profile.
//   Elevation frame (u,v)    the unfolded side view: u = distance travelled along the reference
//                            path, v = world elevation. Everything in this file lives here.
//   Stringer profile         the board's shape in that frame.
//   Reference curve  R       the structural line the depth is measured from. Built from the
//                            tread FRONT corners (the "pitch curve"), one knot per bearing.
//   Upper contour            the top edge. 'cut': the notched comb derived from the treads and
//                            risers (never edited here). 'closed': a continuous edge above R.
//   Lower contour            the bottom edge. Independent of the comb.
//   Tread support            where a tread rests: a bearing, straight from StringerModel.
//   Housing                  a recess in the inner face ('closed' only).
//   Local stringer depth     the minimum distance between the reference curve R and the lower
//                            contour L — a GEOMETRIC distance (see solver), never the vertical
//                            Z difference, never a bounding-box dimension.
//   Board thickness          the board's dimension across the profile (config.stringerThickness).
//                            A different quantity from the depth. Never call the depth "thickness".
//
// Pure data and pure functions — no Three.js.

export const PROFILE_MODES = Object.freeze({ AUTO: 'AUTO', MANUAL: 'MANUAL' });

// Which contour(s) the corner radius applies to.
export const RADIUS_SCOPES = Object.freeze({ TOP: 'TOP', BOTTOM: 'BOTTOM', BOTH: 'BOTH' });

// How a contour is shaped. SHARP/TANGENT_ARC round (or don't) each corner independently, one
// discrete radius at a time — SPLINE replaces that with ONE continuous smooth curve through every
// control point of the WHOLE contour (Tier 2 "spline transition" — see stringerProfileSolver.js
// solveContour and profileCurve.js splineThroughPoints). SPLINE only ever applies to a contour that
// is a plain offset curve (a closed board's upper/lower edge, or a cut board's lower edge) — a cut
// board's stepped/notched top ("the comb") is a different, separate code path
// (stringerConstructionGeometry.js buildOverlayTop/buildCombCurve) that solveStringerProfile never
// produces, so it is structurally unaffected by this setting, correctly: those notches are where a
// tread physically rests and can never be smoothed away. A multi-arc transition (an intermediate
// style between a single tangent arc and a full spline) remains Tier 2, not implemented.
export const TRANSITION_STYLES = Object.freeze({ SHARP: 'SHARP', TANGENT_ARC: 'TANGENT_ARC', SPLINE: 'SPLINE' });

export const PROFILE_CONTOURS = Object.freeze({ LOWER: 'lower', UPPER: 'upper' });

// Stable, semantic vertex ids — never array indices, so an override survives a change in the
// number of treads elsewhere in the flight. A vertex of the reference curve exists at each
// tread's front corner and at the closing point past the last tread.
export const END_ANCHOR_ID = 'end:top';
export function anchorIdForTread(treadIndex) {
  return `support:step-${treadIndex}`;
}

// A manual override may not be more than this far from the required depth to count as met —
// float noise only, not a design tolerance.
export const DEPTH_TOLERANCE_MM = 1e-3;

// Two adjacent contour vertices must stay this far apart in u after an override, so a moved
// control point can never make the profile fold back on itself.
export const MIN_VERTEX_SPACING_MM = 1;

export const DEFAULT_PROFILE_PARAMS = Object.freeze({
  minimumStringerDepthMm: 350,
  stringerProfileOffsetMm: 0,
  stringerCornerRadiusMm: 0,
  stringerRadiusScope: RADIUS_SCOPES.BOTTOM,
  stringerTransitionStyle: TRANSITION_STYLES.TANGENT_ARC,
  stringerNotchRadiusMm: 0,
});

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The profile parameters, read out of a config with defaults for anything missing/invalid.
 * `nominalDepthMm` is the distance the AUTO lower contour is generated at: the minimum depth
 * plus the (never negative) profile offset. So the minimum is met by construction, and a
 * positive offset makes the board deeper everywhere.
 */
export function profileParamsFromConfig(config) {
  const d = DEFAULT_PROFILE_PARAMS;
  const minimumDepthMm = Math.max(0, finiteOr(config.minimumStringerDepthMm, d.minimumStringerDepthMm));
  const profileOffsetMm = Math.max(0, finiteOr(config.stringerProfileOffsetMm, d.stringerProfileOffsetMm));
  const scope = Object.values(RADIUS_SCOPES).includes(config.stringerRadiusScope) ? config.stringerRadiusScope : d.stringerRadiusScope;
  const style = Object.values(TRANSITION_STYLES).includes(config.stringerTransitionStyle) ? config.stringerTransitionStyle : d.stringerTransitionStyle;
  return {
    minimumDepthMm,
    profileOffsetMm,
    nominalDepthMm: minimumDepthMm + profileOffsetMm,
    // config.stringerTopMarginMm is specified relative to the TREAD'S OWN TOP (the walking
    // surface) — see stringerProfileSolver.js's solveStringerProfile for why the reference curve
    // itself (through bearingElevation, the tread's own BOTTOM) is never moved for this: only
    // where the closed contour's upper offset is measured FROM shifts, by treadThicknessMm.
    topMarginMm: Math.max(0, finiteOr(config.stringerTopMarginMm, 0)),
    treadThicknessMm: Math.max(0, finiteOr(config.treadThickness, 0)),
    cornerRadiusMm: Math.max(0, finiteOr(config.stringerCornerRadiusMm, d.stringerCornerRadiusMm)),
    radiusScope: scope,
    transitionStyle: style,
    notchRadiusMm: Math.max(0, finiteOr(config.stringerNotchRadiusMm, d.stringerNotchRadiusMm)),
  };
}

export function scopeIncludes(scope, contour) {
  if (scope === RADIUS_SCOPES.BOTH) return true;
  return contour === PROFILE_CONTOURS.LOWER ? scope === RADIUS_SCOPES.BOTTOM : scope === RADIUS_SCOPES.TOP;
}

// --- manual override layer ----------------------------------------------------------------------
//
// NominalProfile -> manualStringerProfileOverrides -> FinalProfile. Stored as MODEL data (in
// config at runtime, as its own top-level field in the project file — like the tread edge
// overrides), never as a mutation of a mesh. Shape, per stringer side:
//
//   {
//     mode: 'AUTO' | 'MANUAL',        // AUTO: the profile is fully derived, entries are ignored
//     lower: { [anchorId]: { ds?, dn?, radiusMm? } },
//     upper: { [anchorId]: { ds?, dn?, radiusMm? } },     // 'closed' only
//     inserted: [{ id, contour, after, t, dn?, radiusMm? }]
//   }
//
// `ds` moves a control point ALONG the reference curve, `dn` along the contour's own outward
// normal (positive = deeper, further from the reference), both measured from the NOMINAL
// position — so the point follows the treads when they change. `radiusMm` sets that corner's
// radius explicitly (an explicit radius is a design decision: it is never silently reduced to
// protect the minimum depth — a violation is reported instead). `inserted` adds a control point
// on the nominal edge that starts at `after`, `t` (0..1, exclusive) of the way to the next one.

function sanitizeVertexOverride(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (Number.isFinite(raw.ds)) out.ds = raw.ds;
  if (Number.isFinite(raw.dn)) out.dn = raw.dn;
  if (Number.isFinite(raw.radiusMm) && raw.radiusMm >= 0) out.radiusMm = raw.radiusMm;
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeContourOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [anchorId, entry] of Object.entries(raw)) {
    const clean = sanitizeVertexOverride(entry);
    if (clean) out[anchorId] = clean;
  }
  return out;
}

export function sanitizeStringerProfileOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const side of ['outer', 'inner']) {
    const entry = raw[side];
    if (!entry || typeof entry !== 'object') continue;
    const inserted = [];
    for (const ins of Array.isArray(entry.inserted) ? entry.inserted : []) {
      if (!ins || typeof ins.id !== 'string' || typeof ins.after !== 'string') continue;
      if (ins.contour !== PROFILE_CONTOURS.LOWER && ins.contour !== PROFILE_CONTOURS.UPPER) continue;
      if (!(ins.t > 0 && ins.t < 1)) continue;
      const clean = sanitizeVertexOverride(ins) || {};
      inserted.push({ id: ins.id, contour: ins.contour, after: ins.after, t: ins.t, ...clean });
    }
    const lower = sanitizeContourOverrides(entry.lower);
    const upper = sanitizeContourOverrides(entry.upper);
    if (Object.keys(lower).length === 0 && Object.keys(upper).length === 0 && inserted.length === 0) continue;
    result[side] = {
      // A layer with entries but no explicit mode is a manual profile — the entries exist because
      // someone edited it.
      mode: entry.mode === PROFILE_MODES.AUTO ? PROFILE_MODES.AUTO : PROFILE_MODES.MANUAL,
      lower,
      upper,
      inserted,
    };
  }
  return result;
}

/** Number of manually edited control points/radii — for a status readout. */
export function countProfileOverrides(all) {
  let count = 0;
  for (const entry of Object.values(sanitizeStringerProfileOverrides(all))) {
    if (entry.mode === PROFILE_MODES.AUTO) continue;
    count += Object.keys(entry.lower).length + Object.keys(entry.upper).length + entry.inserted.length;
  }
  return count;
}

/**
 * Pure setter for the future side-view editor: returns a new overrides object with one control
 * point's override merged in. `patch` keys with the value `null` are removed; an override that
 * ends up empty disappears.
 */
export function setVertexOverride(all, side, contour, anchorId, patch) {
  const current = sanitizeStringerProfileOverrides(all);
  const entry = current[side] || { mode: PROFILE_MODES.MANUAL, lower: {}, upper: {}, inserted: [] };
  const merged = { ...(entry[contour][anchorId] || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const contourNext = { ...entry[contour] };
  if (Object.keys(merged).length === 0) delete contourNext[anchorId];
  else contourNext[anchorId] = merged;
  return sanitizeStringerProfileOverrides({ ...current, [side]: { ...entry, mode: PROFILE_MODES.MANUAL, [contour]: contourNext } });
}

/** Overrides that actually take effect for one stringer, or null. */
export function activeOverridesFor(all, side) {
  const entry = sanitizeStringerProfileOverrides(all)[side];
  return entry && entry.mode === PROFILE_MODES.MANUAL ? entry : null;
}

// --- edit events ---------------------------------------------------------------------------------
//
// The contract a side-view editor speaks (the editor itself is not built yet): every interaction is
// one of these plain-data events, applied by applyProfileEdit() to the override layer — never to a
// mesh. side view edit -> event -> new overrides -> rebuild() -> 3D updates.

export const PROFILE_EDITS = Object.freeze({
  MOVE_VERTEX: 'moveVertex',
  SET_RADIUS: 'setRadius',
  INSERT_VERTEX: 'insertVertex',
  RESET_VERTEX: 'resetVertex',
  SET_MODE: 'setMode',
  RESET_SIDE: 'resetSide',
});

function withEntry(current, side, entry) {
  return sanitizeStringerProfileOverrides({ ...current, [side]: { ...entry, mode: entry.mode === PROFILE_MODES.AUTO ? PROFILE_MODES.AUTO : PROFILE_MODES.MANUAL } });
}

/**
 * @param {Object} all   the current manualStringerProfileOverrides
 * @param {Object} edit  { type, side, contour?, anchorId?, ds?, dn?, radiusMm?, id?, after?, t?, mode? }
 * @returns {Object}     a new overrides object (the input is never mutated)
 */
export function applyProfileEdit(all, edit) {
  const current = sanitizeStringerProfileOverrides(all);
  const entry = current[edit.side] || { mode: PROFILE_MODES.MANUAL, lower: {}, upper: {}, inserted: [] };
  const isInserted = (id) => entry.inserted.some((i) => i.id === id);
  switch (edit.type) {
    case PROFILE_EDITS.MOVE_VERTEX: {
      if (!isInserted(edit.anchorId)) return setVertexOverride(all, edit.side, edit.contour, edit.anchorId, { ds: edit.ds ?? 0, dn: edit.dn ?? 0 });
      const inserted = entry.inserted.map((i) => (i.id === edit.anchorId ? { ...i, dn: edit.dn ?? i.dn, t: edit.t ?? i.t } : i));
      return withEntry(current, edit.side, { ...entry, inserted });
    }
    case PROFILE_EDITS.SET_RADIUS: {
      if (!isInserted(edit.anchorId)) return setVertexOverride(all, edit.side, edit.contour, edit.anchorId, { radiusMm: edit.radiusMm ?? null });
      const inserted = entry.inserted.map((i) => {
        if (i.id !== edit.anchorId) return i;
        const { radiusMm, ...rest } = i;
        return edit.radiusMm === null || edit.radiusMm === undefined ? rest : { ...rest, radiusMm: edit.radiusMm };
      });
      return withEntry(current, edit.side, { ...entry, inserted });
    }
    case PROFILE_EDITS.INSERT_VERTEX: {
      const inserted = [...entry.inserted.filter((i) => i.id !== edit.id), { id: edit.id, contour: edit.contour, after: edit.after, t: edit.t, dn: edit.dn ?? 0, radiusMm: edit.radiusMm }];
      return withEntry(current, edit.side, { ...entry, inserted });
    }
    case PROFILE_EDITS.RESET_VERTEX: {
      const next = { ...entry, inserted: entry.inserted.filter((i) => i.id !== edit.anchorId) };
      if (edit.contour && next[edit.contour]) {
        next[edit.contour] = { ...next[edit.contour] };
        delete next[edit.contour][edit.anchorId];
      }
      return withEntry(current, edit.side, next);
    }
    case PROFILE_EDITS.RESET_SIDE: {
      const { [edit.side]: _dropped, ...rest } = current;
      return sanitizeStringerProfileOverrides(rest);
    }
    case PROFILE_EDITS.SET_MODE:
      return withEntry(current, edit.side, { ...entry, mode: edit.mode === PROFILE_MODES.AUTO ? PROFILE_MODES.AUTO : PROFILE_MODES.MANUAL });
    default:
      return current;
  }
}
