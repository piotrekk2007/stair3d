// The quotation of the module "Schody na beton" (stage 4 — docs/architecture/CONCRETE_CLADDING_MODULE.md): one line
// per installed element, each with its MATERIAL (the board price list — the same DREWEX table as the self-supporting
// takeoff, read through takeoff/boardPricing.js — or a price per m²) and its LABOUR (the module's labour list,
// quote/labour.js), then the totals and VAT (8 % with installation, 23 % material only). Pure. A missing price is never
// invented: the line says what is missing and counts in `unpriced`.

import { createDefaultBoardPricing, lookupBoardPricePerMb } from '../../takeoff/boardPricing.js';
import { riserOn } from '../claddingModel.js';
import { UNIT_LABELS } from './labour.js';

const round2 = (n) => Math.round(n * 100) / 100;
const area = (o) => Math.abs(o.reduce((s, p, k) => s + p.x * o[(k + 1) % o.length].y - o[(k + 1) % o.length].x * p.y, 0) / 2);
// the board round an outline: along `grain` × across it
function blankOf(outline, grain) {
  const n = { x: -grain.y, y: grain.x };
  const us = outline.map((p) => p.x * grain.x + p.y * grain.y);
  const vs = outline.map((p) => p.x * n.x + p.y * n.y);
  return { lengthMm: Math.max(...us) - Math.min(...us), depthMm: Math.max(...vs) - Math.min(...vs) };
}

/**
 * @param {object} built     buildCladdingStair's result
 * @param {object} settings  quote/labour.js sanitizeQuoteSettings
 * @returns {{lines, totals: {materialNet, labourNet, net, vatPct, vat, gross}, unpriced: number}}
 */
export function buildCladdingQuote(built, settings) {
  const { config, concrete, cladding } = built;
  const pricing = settings.boardPricing || createDefaultBoardPricing();
  const rate = new Map(settings.labour.map((r) => [r.id, r]));
  const lines = [];
  const board = ({ lengthMm, depthMm, thicknessMm }) => {
    const r = lookupBoardPricePerMb(pricing.table, { species: pricing.species, cls: pricing.cls, thicknessMm, depthMm, lengthMm });
    return r.ok ? { value: round2((r.pricePerMb * lengthMm) / 1000), note: `${pricing.species} ${pricing.cls}, ${round2(r.pricePerMb)} zł/mb` } : { value: null, note: r.reason };
  };
  const labour = (id, qty = 1) => {
    const r = rate.get(id);
    if (!r) return null;
    return { id, label: r.label, qty, unit: r.unit, value: r.rate > 0 ? round2(r.rate * qty) : null, note: r.rate > 0 ? `${round2(r.rate)} zł/${UNIT_LABELS[r.unit]}` : 'brak stawki robocizny' };
  };
  const byIndex = new Map(concrete.elements.map((e) => [e.index, e]));
  const dims = (b, t) => `${Math.round(b.lengthMm)} × ${Math.round(b.depthMm)} × ${Math.round(t)} mm`;

  for (const t of cladding.treads) {
    const e = byIndex.get(t.index);
    const no = t.index + 1;
    if (t.kind === 'landing') {
      const half = e.turn === 'left' || e.turn === 'right';
      if (t.parts) {
        // a floor-board landing: the nosing piece (a board), the boards and the OSB per m², the labour per m²
        const m2 = area(t.outline) / 1e6;
        const nb = t.parts.nosing ? blankOf(t.parts.nosing.outline, t.grain) : null;
        const floorM2 = t.parts.boards ? area(t.parts.boards.outline) / 1e6 : 0;
        lines.push({ id: `${t.id}`, group: 'Podesty', name: `${half ? 'Półpodest' : 'Podest'} ${no} — deska podłogowa na OSB`, qty: round2(m2), unit: 'm²', dims: `${round2(m2)} m²`, material: null, labour: labour('landing-floorboard', round2(m2)) });
        if (nb) lines.push({ id: `${t.id}-nosing`, group: 'Podesty', name: `Nosek podestu ${no}`, qty: 1, unit: 'szt.', dims: dims(nb, config.osbThicknessMm + config.floorboardThicknessMm), material: board({ ...nb, thicknessMm: config.osbThicknessMm + config.floorboardThicknessMm }), labour: null });
        lines.push({ id: `${t.id}-boards`, group: 'Podesty', name: `Deska podłogowa — podest ${no}`, qty: round2(floorM2), unit: 'm²', dims: `${round2(floorM2)} m²`, material: settings.floorboardPerM2 > 0 ? { value: round2(floorM2 * settings.floorboardPerM2), note: `${round2(settings.floorboardPerM2)} zł/m²` } : { value: null, note: 'brak ceny deski za m²' }, labour: null });
        lines.push({ id: `${t.id}-osb`, group: 'Podesty', name: `Płyta OSB ${config.osbThicknessMm} mm — podest ${no}`, qty: round2(floorM2), unit: 'm²', dims: `${round2(floorM2)} m²`, material: settings.osbPerM2 > 0 ? { value: round2(floorM2 * settings.osbPerM2), note: `${round2(settings.osbPerM2)} zł/m²` } : { value: null, note: 'brak ceny OSB za m²' }, labour: null });
        continue;
      }
      lines.push({ id: t.id, group: 'Podesty', name: `${half ? 'Półpodest' : 'Podest'} ${no} (drewno)`, qty: 1, unit: 'szt.', dims: dims(t, t.thicknessMm), material: board({ lengthMm: t.lengthMm, depthMm: t.depthMm, thicknessMm: t.thicknessMm }), labour: labour(half ? 'landing-half' : 'landing-wood') });
      continue;
    }
    const winder = t.kind === 'winder';
    const withRiser = riserOn(e, config);
    lines.push({ id: t.id, group: winder ? 'Stopnie zabiegowe' : 'Stopnie proste', name: `${winder ? 'Stopień zabiegowy' : 'Stopień'} ${no}`, qty: 1, unit: 'szt.', dims: dims(t, t.thicknessMm), material: board({ lengthMm: t.lengthMm, depthMm: t.depthMm, thicknessMm: t.thicknessMm }), labour: labour(`${winder ? 'tread-winder' : 'tread-straight'}${withRiser ? '-riser' : ''}`) });
  }
  // the risers: their material (their fitting is in the tread's labour "z podstopnicą")
  for (const r of cladding.risers) {
    if (!(r.heightMm > 0)) continue;
    const blank = { lengthMm: r.lengthMm, depthMm: r.heightMm, thicknessMm: r.thicknessMm };
    lines.push({ id: r.id, group: 'Podstopnice', name: r.id.startsWith('riser-top') ? 'Podstopnica pod antresolą' : `Podstopnica ${r.index + 1}`, qty: 1, unit: 'szt.', dims: dims(blank, r.thicknessMm), material: board(blank), labour: null });
  }
  for (const n of cladding.exitNosing || []) {
    const blank = { lengthMm: n.lengthMm, depthMm: n.depthMm, thicknessMm: n.thicknessMm };
    lines.push({ id: n.id, group: 'Noski', name: 'Nosek antresoli', qty: 1, unit: 'szt.', dims: dims(blank, n.thicknessMm), material: board(blank), labour: labour('nosing') });
  }
  // lump sums and the user's own extra lines
  for (const id of ['measure', 'transport']) {
    if (settings.lumps?.[id] === false) continue;
    const l = labour(id);
    if (l) lines.push({ id: `lump-${id}`, group: 'Usługi', name: l.label, qty: 1, unit: 'ryczałt', dims: '', material: null, labour: l });
  }
  for (const r of settings.labour.filter((x) => x.id.startsWith('own-'))) {
    const l = labour(r.id, r.qty ?? 1);
    lines.push({ id: r.id, group: 'Pozycje własne', name: r.label, qty: r.qty ?? 1, unit: UNIT_LABELS[r.unit] || r.unit, dims: '', material: null, labour: l });
  }
  // one block per group (walking order within it)
  const GROUPS = ['Stopnie proste', 'Stopnie zabiegowe', 'Podesty', 'Podstopnice', 'Noski', 'Usługi', 'Pozycje własne'];
  lines.sort((x, y) => GROUPS.indexOf(x.group) - GROUPS.indexOf(y.group));
  for (const l of lines) l.total = round2((l.material?.value ?? 0) + (l.labour?.value ?? 0));
  const materialNet = round2(lines.reduce((s, l) => s + (l.material?.value ?? 0), 0));
  const labourNet = round2(lines.reduce((s, l) => s + (l.labour?.value ?? 0), 0));
  const net = round2(materialNet + labourNet);
  const vatPct = settings.withInstallation ? 8 : 23;
  const vat = round2((net * vatPct) / 100);
  const unpriced = lines.filter((l) => (l.material && l.material.value === null) || (l.labour && l.labour.value === null)).length;
  return { lines, totals: { materialNet, labourNet, net, vatPct, vat, gross: round2(net + vat) }, unpriced };
}
