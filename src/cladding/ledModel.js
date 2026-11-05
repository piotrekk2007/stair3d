// LED lighting of the module "Schody na beton" (user request 2026-11-04 — docs/architecture/CONCRETE_CLADDING_MODULE.md):
// strips in an aluminium profile UNDER THE NOSE of every tread (along its front, in front of the riser board), IN THE
// SKIRTING BOARD (parallel to the noses, `ledSkirtingAboveMm` over them, on its stair-side face) and UNDER THE HANDRAIL of
// every balustrade section; their total length, power (`ledPowerWPerM`) and the power supply (+ `ledSupplyReservePct`).
// Its own model (the self-supporting geometry/ledModel.js reads that engine's models) — the same config names and
// defaults (ASSUMPTION). Pure.

import { rakedTop } from './finishModel.js';

const unit = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const len3 = (pts) => pts.reduce((s, p, k) => (k ? s + Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y, p.z - pts[k - 1].z) : 0), 0);
// a polyline shortened by `m` at both ends (along its own length)
function trim(pts, m) {
  const total = len3(pts);
  if (total <= 2 * m + 10) return null;
  const at = (d) => {
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const l = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z);
      if (acc + l >= d - 1e-9) {
        const t = (d - acc) / (l || 1);
        return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t, z: pts[k - 1].z + (pts[k].z - pts[k - 1].z) * t };
      }
      acc += l;
    }
    return pts[pts.length - 1];
  };
  let acc = 0;
  const out = [at(m)];
  for (let k = 1; k < pts.length - 1; k++) {
    acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z);
    if (acc > m && acc < total - m) out.push(pts[k]);
  }
  out.push(at(total - m));
  return out;
}

/** @returns {{enabled, strips: {id, kind: 'tread' | 'skirting' | 'handrail', points: {x,y,z}[], lengthMm}[], totals, powerW, supplyW}} */
export function buildCladdingLed(built, config) {
  const strips = [];
  const m = config.ledEndMarginMm;
  const r = config.riserThicknessMm;
  if (config.ledTreadEnabled) {
    // under the nose: the concrete's front line moved forward by the riser board + the nosing, back by the setback and
    // half the profile — on the tread's underside
    for (const e of built.concrete.elements) {
      const riser = config.stepOverrides?.[e.index]?.riser ?? config.riserBoards;
      const forward = (riser ? r : 0) + config.nosingFrontMm - config.ledTreadSetbackMm - config.ledProfileWidthMm / 2;
      for (const edge of e.edges.filter((x) => x.role === 'front')) {
        const t = unit(edge.a, edge.b);
        const n = { x: t.y, y: -t.x };
        const z = e.topZ;
        const pts = trim([edge.a, edge.b].map((p) => ({ x: p.x + n.x * forward, y: p.y + n.y * forward, z })), m);
        if (pts) strips.push({ id: `led-tread-${e.index}`, kind: 'tread', points: pts, lengthMm: len3(pts) });
      }
    }
  }
  if (config.ledSkirtingEnabled) {
    // in every skirting board: parallel to the noses, on the face toward the stair
    for (const b of built.finish?.skirting || []) {
      const line = rakedLine(b, config);
      if (!line) continue;
      const off = b.thicknessMm + 1;
      const pts = trim(line.map((q) => ({ x: b.origin.x + b.dir.x * q.s + b.normal.x * off, y: b.origin.y + b.dir.y * q.s + b.normal.y * off, z: q.z })), m);
      if (pts) strips.push({ id: `led-${b.id}`, kind: 'skirting', points: pts, lengthMm: len3(pts) });
    }
  }
  if (config.ledHandrailEnabled) {
    for (const s of built.balustrade?.sections || []) {
      const pts = trim(s.handrail.map((p) => ({ x: p.x, y: p.y, z: p.z - config.handrailHeightMm / 2 - 1 })), m);
      if (pts) strips.push({ id: `led-${s.id}`, kind: 'handrail', points: pts, lengthMm: len3(pts) });
    }
  }
  const sum = (k) => strips.filter((s) => !k || s.kind === k).reduce((t, s) => t + s.lengthMm, 0);
  const totals = { tread: sum('tread'), skirting: sum('skirting'), handrail: sum('handrail'), all: sum() };
  const powerW = (totals.all / 1000) * config.ledPowerWPerM;
  return { enabled: strips.length > 0, profile: { widthMm: config.ledProfileWidthMm, depthMm: config.ledProfileDepthMm }, strips, totals, powerW, supplyW: powerW * (1 + config.ledSupplyReservePct / 100) };
}

// the skirting's nose line + the LED height, in its plane — from its own polygon's run (finishModel.js keeps the
// pieces off the board; the board's cut bottom points at each tread's front are the noses)
function rakedLine(board, config) {
  // the bottom cut: (s0, below) (s0, top) (s1, top) per piece — every vertical step's top is a nose
  const poly = board.polygon;
  const sMax = Math.max(...poly.map((p) => p.s));
  const noses = [];
  // (the bottom only — up to its far end; the closing vertical there is the board's end, not a nose)
  for (let k = 1; k < poly.length && poly[k - 1].s < sMax - 1e-6; k++) {
    const a = poly[k - 1];
    const b = poly[k];
    if (Math.abs(a.s - b.s) < 1e-6 && b.z > a.z + 1e-6) noses.push({ s: b.s, top: b.z, flat: false });
  }
  if (!noses.length) return null;
  const pieces = noses.map((n, k) => ({ s0: n.s, s1: noses[k + 1]?.s ?? sMax, top: n.top, flat: false }));
  return rakedTop(pieces, config.ledSkirtingAboveMm, (p) => p.top);
}
