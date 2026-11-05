// The workshop's cut list for the module "Schody na beton" (user request 2026-11-05 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): one row per piece to cut — the same pieces and codes as the 1:1 DXF (claddingPieces:
// treads, landings, noses, risers, skirting boards, cover stringers, glass panes) at their blank size (the smallest
// rectangle along the grain), plus the balustrade's wood (handrails per run, balusters and posts per section) and a
// floor-board landing's OSB / boards in m². CSV for Excel in Polish: `;` separated, UTF-8 with a BOM, whole mm.
// (The self-supporting takeoff CSV is built round that engine's takeoff items and has English headers — not used.)
// Pure.

import { claddingPieces } from './claddingDxf.js';

const HEADER = ['Kod', 'Element', 'Ilość', 'Długość [mm]', 'Szerokość [mm]', 'Grubość [mm]', 'Materiał', 'Uwagi'];

const r0 = (n) => (Number.isFinite(n) ? Math.round(n) : '');
const sizeOf = (pts) => ({ w: Math.max(...pts.map((p) => p.u)) - Math.min(...pts.map((p) => p.u)), h: Math.max(...pts.map((p) => p.v)) - Math.min(...pts.map((p) => p.v)) });
const side = (s) => (s === 'left' ? 'lewa' : 'prawa');

/**
 * @param {object} built  buildCladdingStair's result
 * @param {{species?: string, cls?: string}} [wood]  the board price list's species / class (the quote settings)
 * @returns {{code, name, qty, lengthMm, widthMm, thicknessMm, material, notes}[]}
 */
export function buildCutList(built, { species = '', cls = '' } = {}) {
  const { config } = built;
  const wood = [species, cls].filter(Boolean).join(' ') || 'drewno';
  const rows = [];
  for (const p of claddingPieces(built)) {
    const { w, h } = sizeOf(p.pts);
    const glass = p.row === 'glass';
    const thick = Number.parseFloat(p.notes[0]);
    rows.push({ code: p.code, name: p.name, qty: 1, lengthMm: r0(w), widthMm: r0(h), thicknessMm: r0(thick), material: glass ? `szkło VSG ${r0(thick)} mm` : wood, notes: p.notes.slice(1).join(', ') });
  }
  // the carpet risers' loose tongues ("obce pióro"): top and bottom of each, as long as the riser
  for (const r of built.cladding.risers) {
    if (!(r.tongues > 0) || !(r.heightMm > 0)) continue;
    const code = r.id.startsWith('riser-top') ? 'OP-G' : `OP-${String(r.index + 1).padStart(2, '0')}`;
    rows.push({ code, name: `Obce pióro — podstopnica ${r.id.startsWith('riser-top') ? 'pod antresolą' : r.index + 1}`, qty: r.tongues, lengthMm: r0(r.lengthMm), widthMm: '', thicknessMm: '', material: 'obce pióro', notes: 'góra i dół podstopnicy dywanowej' });
  }
  // a floor-board landing: the OSB and the floor boards by area (laid on site, not cut to one blank)
  for (const t of built.cladding.treads) {
    if (!t.parts) continue;
    const area = (o) => Math.abs(o.reduce((s, p, k) => s + p.x * o[(k + 1) % o.length].y - o[(k + 1) % o.length].x * p.y, 0)) / 2e6;
    const no = String(t.index + 1).padStart(2, '0');
    if (t.parts.osb) rows.push({ code: `PD-${no}-OSB`, name: `Płyta OSB — podest ${t.index + 1}`, qty: Math.round(area(t.parts.osb.outline) * 100) / 100, lengthMm: '', widthMm: '', thicknessMm: r0(config.osbThicknessMm), material: 'OSB', notes: 'm²' });
    if (t.parts.boards) rows.push({ code: `PD-${no}-DP`, name: `Deski podłogowe — podest ${t.index + 1}`, qty: Math.round(area(t.parts.boards.outline) * 100) / 100, lengthMm: '', widthMm: '', thicknessMm: r0(config.floorboardThicknessMm), material: wood, notes: 'm²' });
  }
  // the balustrade's wood: the handrail per run (its developed length), balusters and posts per section
  const handrailSize = `${r0(config.handrailWidthMm)} × ${r0(config.handrailHeightMm)} mm`;
  let n = 0;
  for (const s of built.balustrade?.sections || []) {
    const where = s.kind === 'antresola' ? 'antresola' : `bieg ${s.key.flight + 1}, ${side(s.key.side)}`;
    n += 1;
    rows.push({ code: `PR-${n}`, name: `Poręcz — ${where}`, qty: 1, lengthMm: r0(s.lengthMm), widthMm: r0(config.handrailWidthMm), thicknessMm: r0(config.handrailHeightMm), material: wood, notes: `przekrój ${handrailSize}` });
    if (s.balusters.length) {
      const len = Math.max(...s.balusters.map((b) => b.topZ - b.bottomZ));
      rows.push({ code: `TR-${n}`, name: `Tralki — ${where}`, qty: s.balusters.length, lengthMm: r0(len), widthMm: r0(config.balusterSizeMm), thicknessMm: r0(config.balusterSizeMm), material: wood, notes: `${config.balusterShape === 'round' ? 'okrągłe Ø' : 'kwadratowe '}${r0(config.balusterSizeMm)} mm; długość najdłuższej, docinane na miejscu` });
    }
    if (s.posts.length) {
      const len = Math.max(...s.posts.map((p) => p.topZ - p.bottomZ)) + (config.postCapHeightMm || 0);
      rows.push({ code: `SL-${n}`, name: `Słupy ozdobne — ${where}`, qty: s.posts.length, lengthMm: r0(len), widthMm: r0(config.postSizeMm), thicknessMm: r0(config.postSizeMm), material: wood, notes: `z czapką; najwyższy; frezy: ${config.postGrooves}` });
    }
  }
  for (const w of built.balustrade?.wallRails || []) {
    n += 1;
    rows.push({ code: `PR-${n}`, name: `Poręcz przyścienna — bieg ${w.key.flight + 1}, ${side(w.key.side)}`, qty: 1, lengthMm: r0(w.lengthMm), widthMm: r0(config.handrailWidthMm), thicknessMm: r0(config.handrailHeightMm), material: wood, notes: `przekrój ${handrailSize}; uchwyty: ${w.brackets.length} szt.${config.wallRailReturn ? '; końce zawinięte do ściany' : ''}` });
  }
  return rows;
}

const cell = (v) => {
  const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The rows as a CSV for Excel (Polish): `;`, a decimal comma, UTF-8 with a BOM, CRLF. */
export function cutListToCSV(rows, { projectName = '' } = {}) {
  const lines = [];
  if (projectName) lines.push(cell(`Projekt: ${projectName}`));
  lines.push(HEADER.map(cell).join(';'));
  for (const r of rows) lines.push([r.code, r.name, r.qty, r.lengthMm, r.widthMm, r.thicknessMm, r.material, r.notes].map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
