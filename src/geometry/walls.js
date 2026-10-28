// FREE WALLS, DOORS and WINDOWS (user decisions 2026-10-28) — pure, no Three.js.
//
// Besides the stairwell's walls along the sides A / B / C (stairwell.js, they still fit the stair), the user draws any
// wall on the plan as a polyline (`config.freeWalls`): its points are the wall's FACE, in the frame the ceiling opening
// uses (ceilingOpening.js openingFrame — the stairwell's wall frame when it is on, so a free wall stays put when a free
// side changes), `thicknessMm` of masonry on its `side` ('left' | 'right' of the drawing direction), up to the raw
// slab's underside. Doors and windows (`config.wallOpenings`) sit in ANY wall segment (a side wall `side:<id>` or a free
// wall's segment `free:<id>:<k>`): `offsetMm` from the segment's start along it, `widthMm`, `heightMm`, `sillMm` (a
// window's parapet; 0 for a door).
//
// Checks: a free wall the stair runs into (a tread / post) → ERROR `WALL-COLLISION`; at a DOOR, in a strip in front of it
// on the stair's side (door width × `doorClearDepthMm`): a tread low down there → WARNING `DOOR-STEP-IN-FRONT` (no free
// floor before the door), the stair's underside lower than the door → ERROR `DOOR-HEADROOM` (the passage under the
// stair). Windows are only shown.

import { openingFrame } from './ceilingOpening.js';
import { slabSoffitZ } from './floors.js';
import { clipToConvex, pointInPolygon, polygonArea } from './polygonClip.js';
import { boardPlanFootprint } from './stringerModel.js';
import { valueAtU } from './polylineProfile.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

export const FREE_WALL_DEFAULT_THICKNESS_MM = 120; // ASSUMPTION — a partition wall
export const DOOR_CLEAR_DEPTH_DEFAULT_MM = 1000; // ASSUMPTION — a free strip of floor before a door
const STEP_LOW_MM = 600; // a tread whose top is this low in front of a door is a step there, not a ceiling
const SAMPLE_MM = 50;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
function meet(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

/** A free wall made valid: ≥ 2 points, a positive thickness, a side. */
export function sanitizeFreeWall(w, i = 0) {
  const points = (Array.isArray(w?.points) ? w.points : []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  const t = Number(w?.thicknessMm);
  return { id: String(w?.id ?? `fw-${i + 1}`), points, closed: !!w?.closed && points.length >= 3, thicknessMm: t > 0 ? t : FREE_WALL_DEFAULT_THICKNESS_MM, side: w?.side === 'right' ? 'right' : 'left' };
}

/**
 * The free walls in the plan frame: each with its segments (face a→b, `outward` = toward the masonry, the mitred plan
 * quad of its masonry).
 */
export function resolveFreeWalls(config, planLayout) {
  const list = Array.isArray(config.freeWalls) ? config.freeWalls.map(sanitizeFreeWall).filter((w) => w.points.length >= 2) : [];
  if (!list.length || !planLayout) return [];
  const frame = openingFrame(config, planLayout);
  return list.map((w) => {
    const pts = w.points.map((p) => frame.toPlan(p));
    const n = pts.length;
    const count = w.closed ? n : n - 1;
    const segs = [];
    for (let k = 0; k < count; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const dir = unit(sub(b, a));
      const outward = w.side === 'left' ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
      segs.push({ id: `free:${w.id}:${k}`, wallId: w.id, index: k, a, b, dir, outward, length: len, thickness: w.thicknessMm, height: Math.max(0, slabSoffitZ(config)) });
    }
    // the masonry's back line mitred with the neighbouring segments (a closed loop wraps round)
    segs.forEach((s, i) => {
      const prev = w.closed ? segs[(i - 1 + segs.length) % segs.length] : segs[i - 1];
      const next = w.closed ? segs[(i + 1) % segs.length] : segs[i + 1];
      const back = (p, sg) => add(p, mul(sg.outward, sg.thickness));
      const backA = prev ? meet(back(s.a, s), s.dir, back(prev.a, prev), prev.dir) || back(s.a, s) : back(s.a, s);
      const backB = next ? meet(back(s.b, s), s.dir, back(next.a, next), next.dir) || back(s.b, s) : back(s.b, s);
      s.quad = [s.a, s.b, backB, backA];
    });
    return { ...w, planPoints: pts, segments: segs };
  });
}

/**
 * Every wall segment a door / window can sit in: the stairwell's side walls (`stairwellWalls(...).pieces`, face a→b,
 * `outward`) and the free walls' segments; `label` for the panel, `height` to the raw slab's underside.
 */
export function allWallSegments(config, sidePieces = [], freeWalls = []) {
  const height = Math.max(0, slabSoffitZ(config));
  const out = [];
  for (const p of sidePieces || []) {
    const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    if (len < 1) continue;
    out.push({ id: `side:${p.id}`, label: `Ściana ${p.side}${p.line === 'inner' ? ' (wewn.)' : ''}`, a: p.a, b: p.b, dir: unit(sub(p.b, p.a)), outward: p.outward, length: len, thickness: p.thickness, height, kind: 'side' });
  }
  freeWalls.forEach((w, wi) => {
    for (const s of w.segments) out.push({ ...s, label: `Ściana dowolna ${wi + 1}${w.segments.length > 1 ? `, odcinek ${s.index + 1}` : ''}`, height, kind: 'free' });
  });
  return out;
}

/** A door / window made valid. */
export function sanitizeWallOpening(o, i = 0) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const type = o?.type === 'window' ? 'window' : 'door';
  return {
    id: String(o?.id ?? `wo-${i + 1}`),
    type,
    segmentId: String(o?.segmentId ?? ''),
    offsetMm: n(o?.offsetMm, 0),
    widthMm: n(o?.widthMm, type === 'door' ? 900 : 1200) || (type === 'door' ? 900 : 1200),
    heightMm: n(o?.heightMm, type === 'door' ? 2050 : 1300) || (type === 'door' ? 2050 : 1300),
    sillMm: type === 'door' ? 0 : n(o?.sillMm, 900),
  };
}

/**
 * The doors and windows on their segments: plan points of the opening on the wall's face (a → b), its stretch along the
 * segment `[u0, u1]`, the heights; `valid` false (+ the reason) when its segment is gone or it does not fit in it.
 */
export function resolveWallOpenings(config, segments) {
  const list = Array.isArray(config.wallOpenings) ? config.wallOpenings.map(sanitizeWallOpening) : [];
  return list.map((o) => {
    const seg = segments.find((s) => s.id === o.segmentId);
    if (!seg) return { ...o, valid: false, reason: 'brak ściany (usunięta albo zmieniona)' };
    const u0 = o.offsetMm;
    const u1 = o.offsetMm + o.widthMm;
    const at = (u) => add(seg.a, mul(seg.dir, u));
    const fits = u1 <= seg.length + 0.5 && o.sillMm + o.heightMm <= seg.height + 0.5;
    return { ...o, valid: true, fits, segment: seg, u0, u1, a: at(u0), b: at(Math.min(u1, seg.length)), dir: seg.dir, outward: seg.outward };
  });
}

/**
 * The stair's parts for the checks: their plan outline and the height of their underside / top at a plan point.
 * Treads (flat), the wangi (their solved lower edge along the board), the posts (down to the floor).
 */
export function stairParts(built) {
  const parts = [];
  for (const t of built.treadModels || []) {
    if (!(t.outline?.length >= 3)) continue;
    parts.push({ kind: 'tread', id: t.stepId, label: `stopień ${t.index + 1}`, outline: t.outline, bottomAt: () => t.elevation.bottom, top: t.elevation.top });
  }
  for (const side of ['outer', 'inner']) {
    const model = built.stringerModels?.[side];
    for (const seg of model?.segments || []) {
      const geo = (built.stringerConstruction?.[side] || []).find((g) => g.segmentId === seg.id);
      if (!geo?.bottomProfile?.length) continue;
      const { start, direction } = seg.referenceLine;
      parts.push({
        kind: 'stringer',
        id: seg.id,
        label: `wanga ${seg.id}`,
        outline: boardPlanFootprint(seg, geo),
        bottomAt: (p) => valueAtU(geo.bottomProfile, (p.x - start.x) * direction.x + (p.y - start.y) * direction.y),
        top: Infinity,
      });
    }
  }
  for (const p of built.postModels || []) {
    if (p.removed) continue;
    const h = p.size / 2;
    const c = p.position;
    parts.push({ kind: 'post', id: p.postId, label: `słup ${p.postId}`, outline: [{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }], bottomAt: () => p.elevation.bottom, top: p.elevation.top });
  }
  return parts;
}

const diag = (ruleId, severity, elementType, elementId, message, extra = {}) => createDiagnostic({ ruleId, severity, elementType, elementId, parameter: null, message, ...extra });

/**
 * The checks: the stair running into a free wall, and at every door the free floor and the headroom in front of it.
 * @returns {Object[]} diagnostics
 */
export function wallChecks(config, freeWalls, openings, parts) {
  const out = [];
  // the stair into a free wall (its masonry quad)
  for (const w of freeWalls) {
    for (const s of w.segments) {
      const hits = parts.filter((p) => p.kind !== 'stringer' && polygonArea(clipToConvex(p.outline, s.quad)) > 1);
      if (hits.length) out.push(diag('WALL-COLLISION', 'ERROR', 'wall', s.id, `Schody wchodzą w ścianę dowolną (${hits.map((h) => h.label).join(', ')}). Przesuń ścianę albo zmień schody.`));
    }
  }
  const depth = Number(config.doorClearDepthMm) > 0 ? Number(config.doorClearDepthMm) : DOOR_CLEAR_DEPTH_DEFAULT_MM;
  for (const o of openings) {
    if (!o.valid) {
      out.push(diag('WALL-OPENING-INVALID', 'WARNING', 'wallOpening', o.id, `${o.type === 'door' ? 'Drzwi' : 'Okno'} ${o.id}: ${o.reason}.`));
      continue;
    }
    if (!o.fits) out.push(diag('WALL-OPENING-INVALID', 'WARNING', 'wallOpening', o.id, `${o.type === 'door' ? 'Drzwi' : 'Okno'} ${o.id} nie mieści się w ścianie (${o.segment.label}).`));
    if (o.type !== 'door') continue;
    // the strip in front of the door, on the stair's side (away from the masonry)
    const front = mul(o.outward, -1);
    const doorTop = o.sillMm + o.heightMm;
    let lowest = Infinity;
    let lowPart = null;
    let step = null;
    const width = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
    for (let du = SAMPLE_MM / 2; du < width; du += SAMPLE_MM) {
      for (let dv = SAMPLE_MM / 2; dv < depth; dv += SAMPLE_MM) {
        const p = add(add(o.a, mul(o.dir, du)), mul(front, dv));
        for (const part of parts) {
          if (!pointInPolygon(p, part.outline)) continue;
          const z = part.bottomAt(p);
          if (Number.isFinite(z) && z < lowest) {
            lowest = z;
            lowPart = part;
          }
          if (part.kind === 'tread' && part.top <= STEP_LOW_MM && (!step || part.top < step.top)) step = part;
        }
      }
    }
    if (step) out.push(diag('DOOR-STEP-IN-FRONT', 'WARNING', 'wallOpening', o.id, `Przed drzwiami ${o.id} (pas ${depth} mm) jest ${step.label} — nie ma wolnej podłogi przed drzwiami.`, { value: Math.round(step.top), unit: 'mm' }));
    else if (lowest < doorTop - 0.5) out.push(diag('DOOR-HEADROOM', 'ERROR', 'wallOpening', o.id, `Nad przejściem przez drzwi ${o.id} schody (${lowPart.label}) są na wysokości ${Math.round(lowest)} mm — niżej niż drzwi (${Math.round(doorTop)} mm).`, { value: Math.round(lowest), expected: `≥ ${Math.round(doorTop)}`, unit: 'mm' }));
  }
  return out;
}

/**
 * The free walls' and openings' edits (pure): every panel / plan gesture is one change on `config.freeWalls` /
 * `config.wallOpenings`; returns `{freeWalls, wallOpenings}`. Points are in the opening frame.
 *   {action: 'add', points, closed, thicknessMm?, side?} · {action: 'move-vertex', id, index, point} ·
 *   {action: 'remove-vertex', id, index} (a wall keeps ≥ 2 points; a closed one with < 3 opens) · {action: 'remove', id}
 *   (its doors / windows go with it) · {action: 'set', id, patch} · {action: 'add-opening', opening} ·
 *   {action: 'set-opening', id, patch} · {action: 'remove-opening', id}
 */
export function applyFreeWallEdit(freeWalls = [], wallOpenings = [], change = {}) {
  let walls = (freeWalls || []).map((w, i) => sanitizeFreeWall(w, i));
  let openings = (wallOpenings || []).map((o, i) => sanitizeWallOpening(o, i));
  const nextId = (prefix, list) => {
    let n = list.length + 1;
    while (list.some((x) => x.id === `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  const round = (p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  const onWall = (o, id) => o.segmentId.startsWith(`free:${id}:`);
  switch (change.action) {
    case 'add': {
      const w = sanitizeFreeWall({ id: nextId('fw-', walls), points: change.points, closed: change.closed, thicknessMm: change.thicknessMm, side: change.side });
      if (w.points.length >= 2) walls = [...walls, w];
      break;
    }
    case 'move-vertex':
      walls = walls.map((w) => (w.id === change.id && w.points[change.index] ? { ...w, points: w.points.map((p, i) => (i === change.index ? round(change.point) : p)) } : w));
      break;
    case 'remove-vertex':
      walls = walls.map((w) => {
        if (w.id !== change.id || w.points.length <= 2) return w;
        const points = w.points.filter((_, i) => i !== change.index);
        return { ...w, points, closed: w.closed && points.length >= 3 };
      });
      break;
    case 'remove':
      walls = walls.filter((w) => w.id !== change.id);
      openings = openings.filter((o) => !onWall(o, change.id));
      break;
    case 'set':
      walls = walls.map((w) => (w.id === change.id ? sanitizeFreeWall({ ...w, ...change.patch }) : w));
      break;
    case 'add-opening':
      openings = [...openings, sanitizeWallOpening({ ...change.opening, id: nextId(change.opening?.type === 'window' ? 'okno-' : 'drzwi-', openings) })];
      break;
    case 'set-opening':
      openings = openings.map((o) => (o.id === change.id ? sanitizeWallOpening({ ...o, ...change.patch, ...(change.patch?.type && change.patch.type !== o.type ? { widthMm: undefined, heightMm: undefined, sillMm: undefined } : {}) }) : o));
      break;
    case 'remove-opening':
      openings = openings.filter((o) => o.id !== change.id);
      break;
    default:
      break;
  }
  return { freeWalls: walls, wallOpenings: openings };
}
