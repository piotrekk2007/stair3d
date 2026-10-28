// THE STAIR ON THE NEXT FLOOR as a reference (user decisions 2026-10-28) — pure, no Three.js.
//
// A stair through two floors is two projects: this one and the other floor's own file, loaded into
// `config.referenceStair = {name, level: 'above' | 'below', file (the other project's file, as saved), dxMm, dyMm,
// rotationDeg (0 / 90 / 180 / 270), mirror}`. The other stair is built by the same buildStaircase and placed in THIS
// stair's plan frame: its plan point p → R(rotation)·M(mirror)·p + (dx, dy), its heights + this stair's rise (above —
// it starts on this stair's upper floor) or − its own rise (below — it ends on this stair's floor). It is shown (3D,
// plan) and checked: walking up the LOWER stair, inside its ceiling opening (elsewhere the slab is lower than anything
// of the upper stair), the clearance from every tread up to the upper stair's underside (its treads, wangi, posts —
// walls.js stairParts) must be at least the lower stair's minHeadroom — else ERROR `REFERENCE-STAIR-HEADROOM` on this
// project's element (a tread of the lower stair, or the part of the upper stair that is too low). Edited / priced in its
// own file; "Zamień" swaps the two (inverseReference).

import { parseProjectFile } from '../project/projectIO.js';
import { createDefaultConfig } from '../config/schema.js';
import { pointInPolygon } from './polygonClip.js';
import { stairParts } from './walls.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

export const REFERENCE_ROTATIONS = Object.freeze([0, 90, 180, 270]);
const SAMPLE_MM = 50;

/** The reference made valid (null when there is none / no file). */
export function sanitizeReferenceStair(ref) {
  if (!ref || typeof ref !== 'object' || !ref.file || typeof ref.file !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rot = ((Math.round(n(ref.rotationDeg) / 90) * 90) % 360 + 360) % 360;
  return { name: String(ref.name ?? ''), level: ref.level === 'below' ? 'below' : 'above', file: ref.file, dxMm: n(ref.dxMm), dyMm: n(ref.dyMm), rotationDeg: rot, mirror: !!ref.mirror };
}

/** The other floor's runtime config from its file (migrated like any project file), without its own reference. */
export function referenceConfig(ref) {
  const { config } = parseProjectFile(JSON.stringify(ref.file));
  return { ...createDefaultConfig(), ...config, referenceStair: null, stairPending: false };
}

const rot = (p, deg) => {
  const a = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/** The placement: the reference's plan point → this stair's plan (and back), its height offset. */
export function referenceTransform(ref, ownRiseMm, refRiseMm) {
  const m = (p) => (ref.mirror ? { x: -p.x, y: p.y } : p);
  const dz = ref.level === 'above' ? ownRiseMm : -refRiseMm;
  return {
    dz,
    toOwn: (p) => {
      const q = rot(m(p), ref.rotationDeg);
      return { x: q.x + ref.dxMm, y: q.y + ref.dyMm };
    },
    toRef: (p) => m(rot({ x: p.x - ref.dxMm, y: p.y - ref.dyMm }, -ref.rotationDeg)),
  };
}

/**
 * The reference seen from the other stair (for "Zamień"): the inverse placement and the other level. With
 * p' = R(θ)·M·p + d: without a mirror p = R(−θ)·(p' − d); with one M·R(−θ) = R(θ)·M, so the inverse keeps θ and the
 * mirror, d' = −R(θ)·M·d.
 */
export function inverseReference(ref) {
  const d = { x: ref.dxMm, y: ref.dyMm };
  let dd;
  let rotationDeg;
  if (ref.mirror) {
    rotationDeg = ref.rotationDeg;
    const q = rot({ x: -d.x, y: d.y }, rotationDeg);
    dd = { x: -q.x, y: -q.y };
  } else {
    rotationDeg = (360 - ref.rotationDeg) % 360;
    const q = rot(d, rotationDeg);
    dd = { x: -q.x, y: -q.y };
  }
  const zero = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { level: ref.level === 'above' ? 'below' : 'above', dxMm: zero(dd.x), dyMm: zero(dd.y), rotationDeg, mirror: ref.mirror };
}

// sample points of a polygon on a 50 mm grid (its own bounding box), inside it and inside `within`
function samplePoints(poly, within) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const out = [];
  for (let x = Math.min(...xs) + SAMPLE_MM / 2; x < Math.max(...xs); x += SAMPLE_MM) {
    for (let y = Math.min(...ys) + SAMPLE_MM / 2; y < Math.max(...ys); y += SAMPLE_MM) {
      const p = { x, y };
      if (pointInPolygon(p, poly) && (!within || pointInPolygon(p, within))) out.push(p);
    }
  }
  return out;
}

/**
 * The clearance between the lower stair's treads and the upper stair's underside, in the UPPER stair's plan frame:
 * `lowerTreads` / `lowerOpening` already mapped into it, `lowerDz` = the lower stair's heights in the upper's frame.
 * @returns {{lowerStepId, lowerIndex, part, clearanceMm, at}[]} the tightest spot per lower tread (all of them)
 */
export function stairClearances({ lowerTreads, lowerOpening, lowerDz, upperParts }) {
  const out = [];
  for (const t of lowerTreads) {
    let best = null;
    for (const p of samplePoints(t.outline, lowerOpening)) {
      for (const part of upperParts) {
        if (!pointInPolygon(p, part.outline)) continue;
        const z = part.bottomAt(p);
        if (!Number.isFinite(z)) continue;
        const c = z - (t.top + lowerDz);
        if (!best || c < best.clearanceMm) best = { lowerStepId: t.stepId, lowerIndex: t.index, part, clearanceMm: c, at: p, floorZ: t.top + lowerDz };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

const PART_TYPE = { tread: 'tread', stringer: 'stringer', post: 'post' };

/**
 * The reference built and placed, and the check.
 * @param {object} own      this stair's built models (buildStaircase)
 * @param {Function} build  buildStaircase (injected — this module is called from it)
 */
export function buildReferenceModel(own, build) {
  const ref = sanitizeReferenceStair(own.fullConfig.referenceStair);
  if (!ref) return null;
  let other;
  try {
    other = build(referenceConfig(ref));
  } catch (e) {
    return { ref, error: `Nie da się zbudować schodów z pliku: ${e.message}`, diagnostics: [createDiagnostic({ ruleId: 'REFERENCE-STAIR-INVALID', severity: 'WARNING', elementType: 'stair', elementId: 'reference', parameter: null, message: `Bieg ${ref.level === 'above' ? 'wyżej' : 'niżej'} („${ref.name}”): ${e.message}` })] };
  }
  const T = referenceTransform(ref, own.fullConfig.totalRise, other.fullConfig.totalRise);
  const ownIsLower = ref.level === 'above';
  const lower = ownIsLower ? own : other;
  const upper = ownIsLower ? other : own;
  // everything in the UPPER stair's frame (its parts' own heights along their boards are read there)
  const mapLower = ownIsLower ? T.toRef : T.toOwn;
  const lowerDz = ownIsLower ? -T.dz : T.dz;
  const minHeadroom = Number(lower.fullConfig.minHeadroom) || 2000;
  const lowerTreads = lower.treadModels.filter((t) => t.outline?.length >= 3).map((t) => ({ stepId: t.stepId, index: t.index, top: t.elevation.top, outline: t.outline.map(mapLower) }));
  const opening = lower.ceilingFit?.openingOutline?.length >= 3 ? lower.ceilingFit.openingOutline.map(mapLower) : null;
  const upperParts = stairParts(upper);
  const clearances = opening ? stairClearances({ lowerTreads, lowerOpening: opening, lowerDz, upperParts }) : [];
  const clashes = clearances.filter((c) => c.clearanceMm < minHeadroom - 0.5);
  const where = ref.level === 'above' ? 'wyżej' : 'niżej';
  const diagnostics = clashes.map((c) => {
    const value = Math.round(c.clearanceMm);
    const expected = `≥ ${minHeadroom}`;
    if (ownIsLower) {
      return createDiagnostic({ ruleId: 'REFERENCE-STAIR-HEADROOM', severity: 'ERROR', elementType: 'tread', elementId: c.lowerStepId, parameter: 'minHeadroom', value, expected, unit: 'mm', message: `Nad stopniem ${c.lowerIndex + 1} bieg wyżej („${ref.name}”, ${c.part.label}) jest tylko ${value} mm nad stopniem — za mało na przejście (min. ${minHeadroom} mm).` });
    }
    return createDiagnostic({ ruleId: 'REFERENCE-STAIR-HEADROOM', severity: 'ERROR', elementType: PART_TYPE[c.part.kind] || 'stair', elementId: c.part.id, parameter: 'minHeadroom', value, expected, unit: 'mm', message: `${c.part.label[0].toUpperCase()}${c.part.label.slice(1)} jest tylko ${value} mm nad stopniem ${c.lowerIndex + 1} biegu niżej („${ref.name}”) — za mało na przejście (min. ${minHeadroom} mm).` });
  });
  // the other stair in THIS stair's plan frame (the plan's drawing)
  const toOwn = ownIsLower ? T.toOwn : (p) => p;
  const mapOther = T.toOwn;
  const planDrawing = {
    treads: other.treadModels.filter((t) => t.outline?.length >= 3).map((t) => ({ index: t.index, outline: t.outline.map(mapOther) })),
    stringers: stairParts(other).filter((p) => p.kind === 'stringer').map((p) => p.outline.map(mapOther)),
    posts: (other.postModels || []).map((p) => ({ at: mapOther(p.position), size: p.size })),
  };
  // the clashes in THIS stair's frame and heights (3D markers): from the lower tread up to the upper underside
  const ownZ = (z) => (ownIsLower ? z - lowerDz : z);
  const markers = clashes.map((c) => ({ at: toOwn(c.at), fromZ: ownZ(c.floorZ), toZ: ownZ(c.floorZ + c.clearanceMm), clearanceMm: c.clearanceMm }));
  return { ref, name: ref.name, level: ref.level, other, transform: T, minHeadroom, clearances, clashes, markers, planDrawing, diagnostics };
}
