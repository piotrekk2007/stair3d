// The production order of the module "Schody na beton" (user request 2026-11-05 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): the cut list as the workshop writes it, printed to PDF (the blanks are glued up from
// it). Per group a heading = the element and its edges ("Stopnie proste kr. R5 + kanał na LED") — with a section
// drawing of the profile where the edges need one (treads, the trim „fajka”) —, then its lines
// "grubość x szerokość x długość - typ - n szt." (identical pieces counted together; the type L / P / CZ / PL = which side
// has a side nosing / an exposed end), the codes of the pieces under each line. Large type — read at the bench.
// `buildProductionOrder` (pure data) + `productionOrderHTML` (a printable page).

import { profileRings } from '../starterProfile.js';
import { escapeHtml as esc } from '../../util/format.js';

const r0 = (n) => Math.round(n);
const pad = (n) => String(n).padStart(2, '0');
const side = (s) => (s === 'left' ? 'L' : 'P');

// the edges in the workshop's words
function edgeWords(kind, size) {
  return { round: `kr. R${size}`, chamfer: `fazka ${size}`, bullnose: 'półwałek', square: 'kr. proste' }[kind] || 'kr. proste';
}

// identical pieces → one line: {dims, type, qty, codes, note}
function grouped(items) {
  const out = new Map();
  for (const it of items) {
    const key = `${it.dims}|${it.type || ''}|${it.note || ''}`;
    if (!out.has(key)) out.set(key, { dims: it.dims, type: it.type || '', note: it.note || '', qty: 0, codes: [] });
    const g = out.get(key);
    g.qty += it.qty ?? 1;
    if (it.code) g.codes.push(it.code);
  }
  return [...out.values()];
}
const dims3 = (t, w, l) => `${r0(t)}x${r0(w)}x${r0(l)}`;

// a tread's grooves from below, measured from its front (the nose): the LED channel, the riser's groove, a carpet
// riser's loose-tongue groove
function treadCuts(t, config) {
  const cuts = [];
  const riserT = config.riserMount === 'carpet' ? config.treadThicknessMm : config.riserThicknessMm;
  if (config.ledTreadEnabled) cuts.push({ x: config.ledTreadSetbackMm, w: config.ledProfileWidthMm, h: config.ledProfileDepthMm, label: `LED ${r0(config.ledProfileWidthMm)}x${r0(config.ledProfileDepthMm)}` });
  if (t.grooves?.length) cuts.push({ x: config.nosingFrontMm, w: riserT, h: t.grooves[0].depthMm, label: `wpust ${r0(riserT)}x${r0(t.grooves[0].depthMm)}` });
  if (config.riserMount === 'carpet' && config.riserBoards) cuts.push({ x: config.nosingFrontMm + riserT / 2 - 3, w: 6, h: 12, label: 'rowek na pióro' });
  return cuts;
}

/**
 * @returns {{groups: {title, note?, drawing?: {kind: 'tread' | 'trim', …}, lines: {dims, type, qty, codes, note}[]}[], wood}}
 */
export function buildProductionOrder(built, quoteSettings = {}) {
  const { config, cladding } = built;
  const bp = quoteSettings.boardPricing || {};
  const wood = [bp.species, bp.cls].filter(Boolean).join(', ');
  const woodName = (bp.species || 'drewno').toLowerCase();
  const groups = [];
  const carpet = config.riserMount === 'carpet';
  const behind = !carpet && config.riserBoards && config.riserTopOverlapMm > 0;
  // --- the treads: by kind and edges
  const kindName = (t) => (t.kind === 'winder' ? 'Stopnie zabiegowe' : t.starter ? 'Stopnie zapraszające' : 'Stopnie proste');
  const byHead = new Map();
  for (const t of cladding.treads.filter((x) => x.kind !== 'landing')) {
    const prof = t.profile?.kind || 'square';
    const extras = [config.ledTreadEnabled ? 'kanał na LED' : '', t.grooves?.length ? `wpust pod podstopnicę ${t.grooves[0].depthMm} mm` : '', carpet && config.riserBoards ? 'rowki na obce pióro' : ''].filter(Boolean);
    const title = `${kindName(t)} ${edgeWords(prof, t.profile?.sizeMm)}${extras.length ? ` + ${extras.join(' + ')}` : ''}`;
    if (!byHead.has(title)) byHead.set(title, { title, items: [], drawing: { kind: 'tread', profile: prof, sizeMm: t.profile?.sizeMm, thicknessMm: t.thicknessMm, cuts: treadCuts(t, config) } });
    byHead.get(title).items.push({ dims: dims3(t.thicknessMm, t.depthMm, t.lengthMm), type: t.sideType, code: `ST-${pad(t.index + 1)}` });
    // (winders and starter steps: their shape from the workshop's templates — user request 2026-11-05)
    if (t.kind === 'winder' || t.starter) byHead.get(title).note = 'kształt wg szablonów';
  }
  for (const g of byHead.values()) groups.push({ title: g.title, ...(g.note ? { note: g.note } : {}), drawing: g.drawing, lines: grouped(g.items) });
  // --- the landings
  const landings = cladding.treads.filter((x) => x.kind === 'landing' && !x.parts);
  if (landings.length) groups.push({ title: `Podesty ${edgeWords(landings[0].profile?.kind, landings[0].profile?.sizeMm)}`, lines: grouped(landings.map((t) => ({ dims: dims3(t.thicknessMm, t.depthMm, t.lengthMm), type: t.sideType, code: `PD-${pad(t.index + 1)}` }))) });
  // --- the risers: their type = their tread's (which end is exposed)
  const typeOf = new Map(cladding.treads.map((t) => [t.index, t.sideType]));
  const lastType = cladding.treads.at(-1)?.sideType || 'CZ';
  const risers = cladding.risers.filter((r) => r.heightMm > 0);
  if (risers.length) {
    groups.push({
      title: `Podstopnie ${woodName}${carpet ? ' — dywanowe, na obce pióro (góra i dół)' : behind ? ` — za stopnicą, wpust ${config.riserTopOverlapMm} mm w stopnicę` : ''}`,
      lines: grouped(risers.map((r) => ({ dims: dims3(r.thicknessMm, r.heightMm, r.lengthMm), type: r.id.startsWith('riser-top') ? lastType : typeOf.get(r.index) || 'CZ', code: r.id.startsWith('riser-top') ? 'PS-G' : `PS-${pad(r.index + 1)}`, note: r.bent ? 'gięta — długość po rozwinięciu' : '' }))),
    });
  }
  // --- the noses: the antresola nosing, a floor-board landing's nosing
  const noses = [
    ...(cladding.exitNosing || []).map((n) => ({ dims: dims3(n.thicknessMm, n.depthMm, n.lengthMm), code: 'NA', note: 'nosek antresoli' + (n.grooves?.length ? `, wpust ${n.grooves[0].depthMm} mm pod podstopnicę` : '') })),
    ...cladding.treads.filter((t) => t.parts?.nosing).map((t) => {
      const o = t.parts.nosing.outline;
      const g = t.grain;
      const us = o.map((p) => p.x * g.x + p.y * g.y);
      const vs = o.map((p) => -p.x * g.y + p.y * g.x);
      return { dims: dims3(t.parts.nosing.topZ - t.parts.nosing.bottomZ, Math.max(...vs) - Math.min(...vs), Math.max(...us) - Math.min(...us)), code: `PD-${pad(t.index + 1)}N`, note: 'nosek podestu' };
    }),
  ];
  if (noses.length) groups.push({ title: `Noski ${edgeWords(config.edgeProfile, config.edgeProfileMm)}`, lines: grouped(noses) });
  // --- the trim „fajka”: its profile drawn
  const trim = built.openingTrim;
  if (trim?.pieces?.length) {
    groups.push({
      // (the workshop's name — user request 2026-11-05: „Nosek wyk.”, nosek wykończeniowy)
      title: `Noski wyk. — obróbka otworu ${edgeWords(config.edgeProfile, config.edgeProfileMm)}`,
      note: 'końce przy sąsiednim nosku (i nosku antresoli) cięte na 45°',
      drawing: { kind: 'trim', noseWidthMm: trim.noseWidthMm, noseHeightMm: trim.noseHeightMm, boardThicknessMm: trim.boardThicknessMm, boardDepthMm: trim.boardDepthMm, profile: config.edgeProfile, sizeMm: config.edgeProfileMm },
      lines: grouped(trim.pieces.map((t) => ({ dims: dims3(t.thicknessMm, t.depthMm, t.lengthMm), code: `NW-${t.edge + 1}` }))),
    });
  }
  // --- the skirting and the cover stringers
  const boards = [];
  for (const b of built.finish?.skirting || []) {
    const base = `LS-${b.key.flight + 1}${side(b.key.side)}`;
    if (b.parts) b.parts.forEach((p, k) => boards.push({ dims: dims3(b.thicknessMm, p.depthMm, p.lengthMm), type: side(b.key.side), code: `${base}-${pad(k + 1)}`, note: p.part === 'horizontal' ? 'schodkowa, poziomy, końce 45°' : `schodkowa, pionowy, 45°${p.notch ? `, wycięcie ${r0(p.notch.widthMm)}x${r0(p.notch.heightMm)}` : ''}` }));
    else boards.push({ dims: dims3(b.thicknessMm, b.depthMm, b.lengthMm), type: side(b.key.side), code: base, note: 'pochyła, dół wycięty pod stopnie (wg DXF)' });
  }
  if (boards.length) groups.push({ title: `Listwy przyścienne ${woodName}`, lines: grouped(boards) });
  const covers = (built.finish?.coverStringers || []).map((b) => ({ dims: dims3(b.thicknessMm, b.depthMm, b.lengthMm), type: side(b.key.side), code: `WO-${b.key.flight + 1}${side(b.key.side)}`, note: 'kształt wg DXF' }));
  if (covers.length) groups.push({ title: `Wangi obiciowe ${woodName}`, lines: grouped(covers) });
  // --- the balustrade: posts, balusters, handrails
  const sections = built.balustrade?.sections || [];
  const posts = sections.flatMap((s) => s.posts.map((p) => ({ dims: dims3(p.size, p.size, p.topZ - p.bottomZ), note: `czapka: ${{ flat: 'płaska', pyramid: 'piramidka', ball: 'kula', round: 'zaoblona (toczona)', none: 'bez czapki' }[p.cap]}, frezy: ${p.grooves}` })));
  if (posts.length) groups.push({ title: `Słupy ${woodName}`, lines: grouped(posts) });
  const balusters = sections.flatMap((s) => s.balusters.map((b) => ({ dims: b.shape === 'round' ? `Ø${r0(b.size)}x${r0(Math.ceil((b.topZ - b.bottomZ) / 10) * 10)}` : dims3(b.size, b.size, Math.ceil((b.topZ - b.bottomZ) / 10) * 10), note: b.shape === 'round' ? 'toczone' : 'kwadratowe' })));
  if (balusters.length) groups.push({ title: `Tralki ${woodName}`, note: 'długości zaokrąglone w górę do 10 mm — docinane na miejscu', lines: grouped(balusters) });
  const rails = [
    ...sections.map((s) => ({ dims: dims3(config.handrailHeightMm, config.handrailWidthMm, s.lengthMm), note: s.kind === 'antresola' ? 'antresola' : `bieg ${s.key.flight + 1}, ${side(s.key.side)}` })),
    ...(built.balustrade?.wallRails || []).map((w) => ({ dims: dims3(config.handrailHeightMm, config.handrailWidthMm, w.lengthMm), note: `przyścienna, bieg ${w.key.flight + 1}, ${side(w.key.side)}, uchwyty ${w.brackets.length} szt.${config.wallRailReturn ? ', końce do ściany' : ''}` })),
  ];
  if (rails.length) groups.push({ title: `Poręcze ${woodName}`, lines: grouped(rails) });
  // --- the loose tongues
  const tongues = risers.filter((r) => r.tongues > 0).map((r) => ({ dims: `${r0(r.lengthMm)}`, qty: r.tongues, note: 'obce pióro — długość' }));
  if (tongues.length) groups.push({ title: 'Obce pióro (podstopnie dywanowe)', lines: grouped(tongues) });
  return { groups, wood };
}

// --- the section drawings ---------------------------------------------------------------------------------------------
const S = 1.5; // px per mm (half the first size — user request 2026-11-05: max two pages)
const PAD = 14;
// a tread's section through its front: the profile bottom → top, the top on to L, down at L, the underside back to the
// front with its grooves (user report 2026-11-05: the outline crossed itself — the profile was taken top → bottom)
function treadSVG(d) {
  const t = d.thicknessMm;
  const L = 150; // the front part of the tread drawn
  const rings = profileRings(d.profile, d.sizeMm || 0, t); // {inset from the front, z from the bottom}, bottom → top
  const X = (x) => PAD + x * S;
  const Y = (z) => PAD + 12 + (t - z) * S; // z up → y down
  const cuts = [...(d.cuts || [])].sort((a, b) => b.x - a.x);
  const pts = [...rings.map((p) => [p.inset, p.z]), [L, t], [L, 0]];
  for (const c of cuts) pts.push([c.x + c.w, 0], [c.x + c.w, c.h], [c.x, c.h], [c.x, 0]);
  const poly = pts.map(([x, z]) => `${X(x).toFixed(1)},${Y(z).toFixed(1)}`).join(' ');
  // (the labels under the section, one per line, each with its distance from the front)
  const labels = [...cuts].sort((a, b) => a.x - b.x).map((c, k) => `<text x="${X(0)}" y="${Y(0) + 16 + k * 15}">${esc(c.label)} — ${r0(c.x)} od czoła</text>`).join('');
  const w = X(L) + 34;
  const h = Y(0) + 8 + cuts.length * 15 + 4;
  return `<svg class="draw" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><polygon points="${poly}" fill="#f1dfc2" stroke="#3b2a1a" stroke-width="1.5"/><text x="${X(L) + 4}" y="${Y(t / 2) + 5}">${r0(t)}</text><text x="${X(0)}" y="${PAD + 4}">czoło</text>${labels}</svg>`;
}
// the trim's section: the nose into the opening (its profile bottom → top) and the board on the slab
function trimSVG(d) {
  const W = d.noseWidthMm;
  const H = d.noseHeightMm;
  const T = d.boardThicknessMm;
  const D = Math.min(d.boardDepthMm, 140);
  const rings = profileRings(d.profile, d.sizeMm || 0, H);
  const X = (v) => PAD + 6 + (v + W) * S;
  const Y = (z) => PAD + 12 + (H - z) * S; // z up from the nose's bottom
  const pts = [...rings.map((p) => [-W + p.inset, p.z]), [D, H], [D, H - T], [0, H - T], [0, 0]];
  const poly = pts.map(([x, z]) => `${X(x).toFixed(1)},${Y(z).toFixed(1)}`).join(' ');
  const w = X(D) + 30;
  const h = Y(0) + 22;
  return `<svg class="draw" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><polygon points="${poly}" fill="#f1dfc2" stroke="#3b2a1a" stroke-width="1.5"/><text x="${X(-W)}" y="${PAD + 4}">otwór</text><text x="${X(-W) - 3}" y="${Y(H / 2) + 5}" text-anchor="end">${r0(H)}</text><text x="${X(D) + 4}" y="${Y(H - T / 2) + 5}">${r0(T)}</text><text x="${X(-W)}" y="${Y(0) + 16}">nosek ${r0(W)} · deska ${r0(d.boardDepthMm)}</text></svg>`;
}

/** The order as a printable page (A4, two columns, the sizes in the largest type). */
export function productionOrderHTML(order, { projectName = '', date = new Date(), thicknessNote = '' } = {}) {
  const d = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  const body = order.groups
    .map((g) => {
      const draw = g.drawing ? (g.drawing.kind === 'trim' ? trimSVG(g.drawing) : treadSVG(g.drawing)) : '';
      // (a box per line to tick off when it is made — user request 2026-11-05)
      const lines = g.lines.map((l) => `<div class="l"><span class="box"></span><b>${esc(l.dims)}</b>${l.type ? ` - <b>${esc(l.type)}</b>` : ''} - <b>${l.qty} szt.</b>${l.note ? ` <span class="nt">(${esc(l.note)})</span>` : ''}${l.codes.length ? `<div class="c">${esc(l.codes.join(', '))}</div>` : ''}</div>`).join('');
      return `<section><h2>${esc(g.title)}</h2>${g.note ? `<div class="gn">${esc(g.note)}</div>` : ''}${draw}${lines}</section>`;
    })
    .join('');
  // (two columns, compact — the whole order on one or two A4 pages; the sizes still the largest type)
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Zamówienie na produkcję${projectName ? ` — ${esc(projectName)}` : ''}</title><style>
  @page { size: A4; margin: 8mm; } body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 11pt; color: #000; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 1mm; } .meta { font-size: 10.5pt; margin-bottom: 3mm; }
  .cols { column-count: 2; column-gap: 7mm; }
  section { break-inside: avoid; border-top: 1.5px solid #000; padding: 1.5mm 0 2mm; }
  h2 { font-size: 13pt; margin: 0 0 1mm; } .gn { font-size: 10pt; margin-bottom: 1mm; }
  .l { font-size: 15pt; margin: 1mm 0 1mm 2mm; line-height: 1.15; padding-left: 8mm; text-indent: -8mm; }
  .box { display: inline-block; width: 5mm; height: 5mm; border: 1.6px solid #000; margin-right: 3mm; vertical-align: -0.6mm; text-indent: 0; } .nt { font-size: 10pt; font-weight: normal; } .c { font-size: 7.5pt; color: #555; margin-left: 1mm; line-height: 1.1; }
  svg.draw { display: block; margin: 1mm 0 1.5mm 2mm; font-size: 12px; font-family: Arial, sans-serif; }
  </style></head><body><h1>Zamówienie na produkcję</h1><div class="meta">${projectName ? `<b>${esc(projectName)}</b> · ` : ''}${d}${order.wood ? ` · ${esc(order.wood)}` : ''}${thicknessNote ? ` · ${esc(thicknessNote)}` : ''}<br>Wymiary: grubość x szerokość x długość [mm]. Typ: L — nosek / koniec widoczny z lewej, P — z prawej, CZ — czołowy (między ścianami), PL — z obu stron.</div><div class="cols">${body}</div></body></html>`;
}
