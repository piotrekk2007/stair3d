// Rods hung from the ceiling down to the treads (user request 2026-11-03: a straight stair on a steel spine, its open
// side closed off by thin steel rods running from the ceiling through the end of every tread — no posts, no handrail
// on that side). Pure: plan + treads in, plain data out; drawn by ceilingRodsRenderer.js, the plan, the takeoff
// (railingItems.js buildCeilingRodItems) and checked here (the clear gap between rods).
//
// Rules:
//  * the rods stand along ONE line (`ceilingRodsSide`), on the treads `ceilingRodsFromTread`..`ceilingRodsToTread`
//    (plan numbers, null = the first / the last);
//  * per tread `ceilingRodsPerTread` rods spread evenly along the tread's side (its final side — after the housing
//    recess —, front to back), at (k + ½) / n of its length, so the spacing is the same within a tread and across the
//    joint to the next one; a landing gets as many as its side needs at that spacing;
//  * the axis `ceilingRodsInsetMm` in from the tread's end (square to the side);
//  * bottom: the tread's underside (the rod goes through the tread, a nut under it); top: under the slab its soffit;
//    inside the ceiling opening (`ceilingRodsTop`) either the slab's raw top, the rod fixed to the slab's SIDE face — the
//    opening's nearest edge — by a bracket at the middle of the slab's thickness ('slab', default: user request
//    2026-11-03, nothing sticks up above the opening), or the upper storey's ceiling (`ceilingRodsTopAboveFloorMm` above
//    the upper floor, 'ceiling');
//  * WARNING `CEILING-RODS-BRACKET` when a bracket would reach farther than CEILING_ROD_MAX_BRACKET_MM (the rod stands
//    far from the opening's edge);
//  * WARNING `CEILING-RODS-GAP` when the clear gap between two neighbours exceeds `railingMaxClearMm` (§ 298 — the
//    same limit as between balusters).

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { pointInPolygon } from './polygonClip.js';
import { inwardNormal } from './planLayout.js';
import { slabSoffitZ, rawSlabTopZ } from './floors.js';

export const CEILING_ROD_SIDES = Object.freeze(['outer', 'inner']);
export const CEILING_ROD_MAX_BRACKET_MM = 250; // a longer bracket from the slab's side to a rod — ASSUMPTION

// The nearest point of a closed polygon's edges to p.
function nearestOnOutline(p, outline) {
  let best = null;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { point: q, d };
  }
  return best;
}

const finite = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

function sideLine(planTread, side) {
  const line = side === 'outer' ? planTread.outerSide || planTread.outerChain : planTread.innerSide || planTread.innerChain;
  if (line && line.length >= 2) return line;
  const k = side === 'outer' ? 1 : 0;
  return [planTread.frontEdge[k], planTread.backEdge[k]];
}

// The polyline's point and direction at plan distance s.
function along(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    if (s <= acc + len || i === points.length - 1) {
      const t = Math.min(1, Math.max(0, (s - acc) / len));
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    }
    acc += len;
  }
  return null;
}

const lengthOf = (points) => points.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0), 0);

/**
 * @returns {{enabled:boolean, side:string|null, diameterMm:number, rods:{id, treadIndex, k, position:{x,y}, bottomZ, topZ,
 *   lengthMm, hung:'opening'|'soffit'}[], maxClearMm:number|null, diagnostics:object[]}}
 */
export function buildCeilingRods({ planLayout, treadModels, openingOutline = null }, config) {
  const empty = { enabled: false, side: null, diameterMm: 0, rods: [], maxClearMm: null, diagnostics: [] };
  if (!config?.ceilingRodsEnabled || !planLayout?.treads?.length) return empty;
  const side = CEILING_ROD_SIDES.includes(config.ceilingRodsSide) ? config.ceilingRodsSide : 'inner';
  const count = planLayout.treads.length;
  const from = Math.min(count - 1, Math.max(0, Math.round(finite(config.ceilingRodsFromTread, 1)) - 1));
  const to = Math.min(count - 1, Math.max(from, Math.round(finite(config.ceilingRodsToTread, count)) - 1));
  const perTread = Math.max(1, Math.round(finite(config.ceilingRodsPerTread, 2)));
  const diameterMm = Math.max(4, finite(config.ceilingRodDiameterMm, 12));
  const inset = Math.max(0, finite(config.ceilingRodsInsetMm, 40));
  const upperCeilingZ = (Number(config.totalRise) || 0) + Math.max(0, finite(config.ceilingRodsTopAboveFloorMm, 2600));
  const soffitZ = slabSoffitZ(config);
  const slabTopZ = rawSlabTopZ(config);
  const toSlab = config.ceilingRodsTop !== 'ceiling';
  const handedness = planLayout.handedness ?? 1;
  const going = Number(config.treadGoing) > 0 ? Number(config.treadGoing) : 250;
  const rods = [];
  for (let i = from; i <= to; i++) {
    const planTread = planLayout.treads[i];
    const tread = treadModels?.[i];
    // (a tread on the concrete flight lies on concrete — no rod through it)
    if (!tread || planTread.onConcrete) continue;
    let line = sideLine(planTread, side);
    // front to back
    const front = planTread.frontEdge[side === 'outer' ? 1 : 0];
    const d0 = Math.hypot(line[0].x - front.x, line[0].y - front.y);
    const d1 = Math.hypot(line[line.length - 1].x - front.x, line[line.length - 1].y - front.y);
    if (d1 < d0) line = [...line].reverse();
    const total = lengthOf(line);
    if (total < 1) continue;
    const n = planTread.type === 'landing' ? Math.max(perTread, Math.round(total / (going / perTread))) : perTread;
    for (let k = 0; k < n; k++) {
      const at = along(line, (total * (k + 0.5)) / n);
      if (!at) continue;
      const into = inwardNormal(at.dir, side, handedness);
      const position = { x: at.point.x + into.x * inset, y: at.point.y + into.y * inset };
      const inOpening = openingOutline?.length >= 3 && pointInPolygon(position, openingOutline);
      const hung = !inOpening ? 'soffit' : toSlab ? 'slab-edge' : 'opening';
      const topZ = hung === 'soffit' ? soffitZ : hung === 'slab-edge' ? slabTopZ : upperCeilingZ;
      const bottomZ = tread.elevation.bottom;
      if (!(topZ > tread.elevation.top)) continue;
      // the bracket to the slab's side face: from the rod square to the opening's nearest edge, mid-thickness
      const edge = hung === 'slab-edge' ? nearestOnOutline(position, openingOutline) : null;
      const bracket = edge ? { at: edge.point, z: (soffitZ + slabTopZ) / 2, reachMm: edge.d } : null;
      rods.push({ id: `rod-${i}-${k}`, treadIndex: i, k, position, bottomZ, topZ, lengthMm: topZ - bottomZ, hung, bracket });
    }
  }
  const diagnostics = [];
  let maxClear = null;
  for (let r = 1; r < rods.length; r++) {
    const a = rods[r - 1].position;
    const b = rods[r].position;
    const clear = Math.hypot(b.x - a.x, b.y - a.y) - diameterMm;
    if (maxClear === null || clear > maxClear) maxClear = clear;
  }
  const far = rods.filter((r) => r.bracket && r.bracket.reachMm > CEILING_ROD_MAX_BRACKET_MM);
  if (far.length) {
    const worst = Math.max(...far.map((r) => r.bracket.reachMm));
    diagnostics.push(
      createDiagnostic({
        ruleId: 'CEILING-RODS-BRACKET',
        severity: 'WARNING',
        elementType: 'railing',
        elementId: 'ceiling-rods',
        parameter: 'ceilingRodsTop',
        value: Math.round(worst),
        expected: `<= ${CEILING_ROD_MAX_BRACKET_MM}`,
        unit: 'mm',
        message: `Pręty od sufitu: ${far.length} pręt(ów) stoi do ${Math.round(worst)} mm od krawędzi otworu — wspornik do boku stropu dłuższy niż ${CEILING_ROD_MAX_BRACKET_MM} mm. Dosuń otwór do schodów albo zawieś pręty pod sufitem piętra.`,
      })
    );
  }
  const limit = Number(config.railingMaxClearMm) || 120;
  if (maxClear !== null && maxClear > limit + 0.5) {
    diagnostics.push(
      createDiagnostic({
        ruleId: 'CEILING-RODS-GAP',
        severity: 'WARNING',
        elementType: 'railing',
        elementId: 'ceiling-rods',
        parameter: 'ceilingRodsPerTread',
        value: Math.round(maxClear),
        expected: `<= ${limit}`,
        unit: 'mm',
        message: `Pręty od sufitu: prześwit między sąsiednimi prętami do ${Math.round(maxClear)} mm — więcej niż ${limit} mm (jak między tralkami, § 298). Dodaj pręt na stopień albo zmniejsz głębokość stopnia.`,
      })
    );
  }
  return { enabled: rods.length > 0, side, diameterMm, rods, maxClearMm: maxClear, diagnostics };
}
