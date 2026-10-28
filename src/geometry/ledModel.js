// LED LIGHTING (user decisions 2026-10-28) — pure, no Three.js.
//
// LED strips in aluminium profiles set in a routed groove (`ledProfileWidthMm` × `ledProfileDepthMm`, default 17 × 8 —
// a typical recessed profile for a 10–12 mm strip, ASSUMPTION), in three places:
//  - UNDER A TREAD'S NOSE (`ledTreadEnabled`): on the tread's underside along its FINAL front edge, the groove
//    `ledTreadSetbackMm` behind the nosed front face, the strip `ledEndMarginMm` short of each end; lights the riser /
//    the tread below. With riser boards the groove must stay in front of the riser (nosing ≥ setback + width), else
//    WARNING `LED-TREAD-NOSING`; a groove deeper than half the tread → WARNING `LED-GROOVE-DEEP`.
//  - IN THE WANGA (`ledStringerEnabled`, `ledStringerSide` both / outer / inner): on the board's face toward the stair,
//    a line parallel to its top edge `ledStringerFromTopMm` below it (centre of the groove), along every housed board
//    (a cut board has no straight top edge over the treads — skipped, INFO `LED-STRINGER-CUT`); crossing a tread /
//    riser housing → WARNING `LED-STRINGER-HOUSING`.
//  - UNDER THE HANDRAIL (`ledHandrailEnabled`): along every handrail piece's underside; a profile wider than the
//    handrail less 10 mm → WARNING `LED-HANDRAIL-NARROW`.
// Output: strips (centre line in plan coordinates + z, the face normal they light from, `roomMm` = the face's room either
// side of the centre line, the groove), totals, the power
// (`ledPowerWPerM`, a supply with `ledSupplyReservePct` reserve — ASSUMPTION), diagnostics. Read by the 3D renderer
// (ledRenderer.js), the plan, the DXF (grooves), the takeoff (unpriced) and the gate.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { valueAtU } from './polylineProfile.js';

export const LED_DEFAULTS = Object.freeze({
  ledProfileWidthMm: 17,
  ledProfileDepthMm: 8,
  ledTreadSetbackMm: 4,
  ledEndMarginMm: 30,
  ledStringerFromTopMm: 25,
  ledPowerWPerM: 9.6,
  ledSupplyReservePct: 20,
});

const num = (config, key) => {
  const v = Number(config?.[key]);
  return Number.isFinite(v) && v >= 0 ? v : LED_DEFAULTS[key];
};
const len3 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + len3(pts[i], p), 0);
const diag = (ruleId, severity, elementType, elementId, message, extra = {}) => createDiagnostic({ ruleId, severity, elementType, elementId, parameter: null, message, ...extra });

export function ledEnabled(config) {
  return !!(config?.ledTreadEnabled || config?.ledStringerEnabled || config?.ledHandrailEnabled);
}

// --- under the tread's nose -----------------------------------------------------------------------------------------
function treadStrips(treadModels, config, P, diagnostics) {
  const out = [];
  const nosing = Number(config.nosing) || 0;
  if (config.hasRiserBoards && nosing < P.setback + P.width) {
    diagnostics.push(diag('LED-TREAD-NOSING', 'WARNING', 'led', 'tread', `Frez LED pod noskiem (${P.setback} + ${P.width} mm) nie mieści się w nosku ${nosing} mm przed podstopniem — zwiększ nosek albo zmniejsz profil / odsunięcie.`, { value: nosing, expected: `≥ ${P.setback + P.width}`, unit: 'mm' }));
  }
  for (const t of treadModels || []) {
    if (t.type === 'landing' || t.cantilever) continue;
    const [p, q] = t.frontEdge?.final || [];
    if (!p || !q) continue;
    const L = Math.hypot(q.x - p.x, q.y - p.y);
    if (L < 2 * P.margin + 50) continue;
    const d = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
    // forward = out of the tread (against its walking direction)
    let f = { x: -d.y, y: d.x };
    if (f.x * t.direction.x + f.y * t.direction.y > 0) f = { x: -f.x, y: -f.y };
    const off = nosing - P.setback - P.width / 2; // the groove's centre, forward of the front edge
    const at = (s) => ({ x: p.x + d.x * s + f.x * off, y: p.y + d.y * s + f.y * off, z: t.elevation.bottom });
    if (P.depth > t.thickness / 2) diagnostics.push(diag('LED-GROOVE-DEEP', 'WARNING', 'tread', t.stepId, `Frez LED ${P.depth} mm w stopniu ${t.index + 1} grubości ${t.thickness} mm — głębszy niż połowa stopnia.`, { value: P.depth, unit: 'mm' }));
    const points = [at(P.margin), at(L - P.margin)];
    out.push({ id: `led-tread-${t.stepId}`, kind: 'tread', elementId: t.stepId, points, faceNormal: { x: 0, y: 0, z: -1 }, roomMm: P.setback + P.width / 2, lengthMm: pathLength(points), groove: { a: points[0], b: points[1], forward: f, offsetFromFrontEdgeMm: off } });
  }
  return out;
}

// --- in the wanga -----------------------------------------------------------------------------------------------------
function stringerStrips(stringerModels, stringerConstruction, config, P, diagnostics) {
  const out = [];
  const which = config.ledStringerSide === 'outer' ? ['outer'] : config.ledStringerSide === 'inner' ? ['inner'] : ['outer', 'inner'];
  const fromTop = num(config, 'ledStringerFromTopMm');
  for (const side of which) {
    const model = stringerModels?.[side];
    if (!model || model.absent) continue;
    const type = side === 'outer' ? config.stringerConstructionTypeOuter : config.stringerConstructionTypeInner;
    if (type === 'cut') {
      diagnostics.push(diag('LED-STRINGER-CUT', 'INFO', 'stringer', side, `LED w wandze ${side === 'outer' ? 'zewn.' : 'wewn.'}: wanga nakładana (grzebień) nie ma ciągłej górnej krawędzi nad stopniami — pominięta.`));
      continue;
    }
    for (const seg of model.segments || []) {
      const geo = (stringerConstruction?.[side] || []).find((g) => g.segmentId === seg.id);
      if (!geo?.topProfile?.length || !geo.ends) continue;
      const u0 = geo.ends.start.u + P.margin;
      const u1 = geo.ends.end.u - P.margin;
      if (!(u1 - u0 > 100)) continue;
      const { start, direction } = seg.referenceLine;
      const n = seg.inwardNormal || { x: 0, y: 0 };
      const t = seg.thickness;
      const us = [u0, ...geo.topProfile.map((p) => p.u).filter((u) => u > u0 + 1 && u < u1 - 1), u1].sort((a, b) => a - b);
      const vAt = (u) => valueAtU(geo.topProfile, u) - fromTop;
      const uv = us.map((u) => ({ u, v: vAt(u) }));
      const points = uv.map(({ u, v }) => ({ x: start.x + direction.x * u + n.x * t, y: start.y + direction.y * u + n.y * t, z: v }));
      // crossing a housing (a tread / riser routed into the same face)?
      const hits = [];
      for (const h of geo.housings || []) {
        if (h.kind === 'butt') continue;
        const a = Math.max(u0, h.uStart);
        const b = Math.min(u1, h.uEnd);
        if (b <= a) continue;
        for (let k = 0; k <= 4; k++) {
          const v = vAt(a + ((b - a) * k) / 4);
          if (v + P.width / 2 > h.bottomV && v - P.width / 2 < h.topV) {
            hits.push(h.treadIndex);
            break;
          }
        }
      }
      if (hits.length) diagnostics.push(diag('LED-STRINGER-HOUSING', 'WARNING', 'stringer', seg.id, `Frez LED w wandze ${seg.id} przecina wpusty stopni ${[...new Set(hits)].map((i) => i + 1).join(', ')} — zwiększ odległość od góry wangi / zmniejsz profil albo podnieś wangę („Naddatek nad stopniem”).`));
      out.push({ id: `led-stringer-${side}-${seg.id}`, kind: 'stringer', elementId: `${side}:${seg.id}`, side, segmentId: seg.id, points, faceNormal: { x: n.x, y: n.y, z: 0 }, roomMm: fromTop, lengthMm: pathLength(points), groove: { side, segmentId: seg.id, path: uv } });
    }
  }
  return out;
}

// --- under the handrail -----------------------------------------------------------------------------------------------
function handrailStrips(railingModel, config, P, diagnostics) {
  const out = [];
  if (!railingModel?.enabled) return out;
  let narrow = false;
  for (const s of railingModel.sections || []) {
    const h = s.handrail;
    if (!h?.pieces?.length) continue;
    if (P.width > (h.widthMm || 0) - 10) narrow = true;
    h.pieces.forEach((piece, k) => {
      const a = piece.start;
      const b = piece.end;
      const L = len3(a, b);
      if (L < 2 * P.margin + 50) return;
      const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L, z: (b.z - a.z) / L };
      // the profile's up (the vertical tilted into the axis' plane — like railingRenderer.js), down to the underside
      let up = { x: -d.x * d.z, y: -d.y * d.z, z: 1 - d.z * d.z };
      const ul = Math.hypot(up.x, up.y, up.z) || 1;
      up = { x: up.x / ul, y: up.y / ul, z: up.z / ul };
      const half = (h.heightMm || 0) / 2;
      const at = (s2) => ({ x: a.x + d.x * s2 - up.x * half, y: a.y + d.y * s2 - up.y * half, z: a.z + d.z * s2 - up.z * half });
      const points = [at(P.margin), at(L - P.margin)];
      out.push({ id: `led-handrail-${s.id}-${k}`, kind: 'handrail', elementId: `${s.id}:${k}`, sectionId: s.id, pieceIndex: k, points, faceNormal: { x: -up.x, y: -up.y, z: -up.z }, roomMm: (h.widthMm || 0) / 2, lengthMm: pathLength(points), groove: { sectionId: s.id, pieceIndex: k, lengthMm: L - 2 * P.margin } });
    });
  }
  if (narrow) diagnostics.push(diag('LED-HANDRAIL-NARROW', 'WARNING', 'led', 'handrail', `Profil LED ${P.width} mm za szeroki na spód poręczy (min. 10 mm zapasu).`, { value: P.width, unit: 'mm' }));
  return out;
}

/**
 * @param {{treadModels, stringerModels, stringerConstruction, railingModel}} models
 * @returns {{enabled:boolean, profile:{widthMm:number, depthMm:number}, strips:object[], totals:{tread:number,
 *   stringer:number, handrail:number, all:number}, powerW:number, supplyW:number, diagnostics:object[]}}
 */
export function buildLedModel({ treadModels, stringerModels, stringerConstruction, railingModel }, config) {
  const P = { width: num(config, 'ledProfileWidthMm'), depth: num(config, 'ledProfileDepthMm'), setback: num(config, 'ledTreadSetbackMm'), margin: num(config, 'ledEndMarginMm') };
  const diagnostics = [];
  const strips = [];
  if (config?.ledTreadEnabled) strips.push(...treadStrips(treadModels, config, P, diagnostics));
  if (config?.ledStringerEnabled) strips.push(...stringerStrips(stringerModels, stringerConstruction, config, P, diagnostics));
  if (config?.ledHandrailEnabled) strips.push(...handrailStrips(railingModel, config, P, diagnostics));
  const sum = (kind) => strips.filter((s) => s.kind === kind).reduce((a, s) => a + s.lengthMm, 0);
  const totals = { tread: sum('tread'), stringer: sum('stringer'), handrail: sum('handrail') };
  totals.all = totals.tread + totals.stringer + totals.handrail;
  const powerW = (totals.all / 1000) * num(config, 'ledPowerWPerM');
  const supplyW = powerW * (1 + num(config, 'ledSupplyReservePct') / 100);
  return { enabled: ledEnabled(config), profile: { widthMm: P.width, depthMm: P.depth }, strips, totals, powerW, supplyW, diagnostics };
}
