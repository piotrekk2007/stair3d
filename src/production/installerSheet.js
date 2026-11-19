// THE INSTALLER'S SHEET („Karta dla montażysty”, user request 2026-11-19) — pure, no DOM / Three.js: one printable HTML
// document (A4, printed like the labels through app/printHtml.js) for the fitter to check the number and the shape of
// the parts before fitting them. User decisions 2026-11-19:
//   - page 1: the plan with every part's code (production/partCodes.js — the same codes as the labels) and the
//     quantities;
//   - the wangi: each board from the side — its outline, its overall length × height, thickness, the blank, the tread
//     numbers where the treads bear on it (coloured), housings and post faces marked; no chain of dimensions;
//   - the treads: identical ones (the same outline to the millimetre, the same kind) ONE drawing „× n” with their codes,
//     winders mostly one each; the outline as cut (round a post too), the front edge marked, the overall width × depth and,
//     for a shape that is not a rectangle, every edge's length;
//   - the landings likewise;
//   - the risers (grouped by size) and the structural posts as tables.
// Read only from the built models (buildStaircase) — no geometry of its own.

import { buildPartList } from './partCodes.js';
import { escapeHtml as esc } from '../util/format.js';
import { wangaName } from '../util/sideNames.js';
import { treadJointsByStep } from '../geometry/jointSolver.js';

const r0 = (n) => Math.round(n);
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Colours of the part kinds (the plan, the cards, the legend). */
export const SHEET_COLORS = Object.freeze({
  straight: '#F2C46D',
  winder: '#F08A5D',
  landing: '#7CC6C9',
  outer: '#5B8DEF',
  inner: '#4CB37A',
  post: '#6D4C41',
  bearing: '#D62828',
  housing: '#9B5DE5',
});
const KIND_PL = { straight: 'Stopień prosty', winder: 'Stopień zabiegowy', landing: 'Podest' };

/** Codes as compact ranges: ST-01, ST-02, ST-03, ST-05 → „ST-01–ST-03, ST-05”. */
export function codeRanges(codes) {
  // (plain numbers — tread numbers — run on like codes without a prefix)
  const parsed = codes.map((c) => {
    const m = /^(?:([A-Z]+)-)?(\d+)$/.exec(c);
    return m ? { prefix: m[1] ?? '#', n: Number(m[2]), code: c } : { code: c };
  });
  const out = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    out.push(run.length > 2 ? `${run[0].code}–${run[run.length - 1].code}` : run.map((p) => p.code).join(', '));
    run = null;
  };
  for (const p of parsed) {
    const last = run?.[run.length - 1];
    if (p.prefix && last && last.prefix === p.prefix && p.n === last.n + 1) run.push(p);
    else {
      flush();
      run = [p];
      if (!p.prefix) flush();
    }
  }
  flush();
  return out.join(', ');
}

// --- the treads --------------------------------------------------------------------------------------------------

// a tread's outline in its OWN frame: x along its front edge (inner → outer), y into the tread (front = y 0)
function localOutline(tread, outline) {
  const [a, b] = tread.frontEdge.final;
  const L = dist(a, b) || 1;
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  let n = { x: -d.y, y: d.x };
  const c = outline.reduce((s, p) => ({ x: s.x + p.x / outline.length, y: s.y + p.y / outline.length }), { x: 0, y: 0 });
  if ((c.x - a.x) * n.x + (c.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const pts = outline.map((p) => ({ x: (p.x - a.x) * d.x + (p.y - a.y) * d.y, y: (p.x - a.x) * n.x + (p.y - a.y) * n.y }));
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  // the front edge's own ends in this frame (it lies on y = 0 before the shift)
  return { pts: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })), front: [{ x: -minX, y: -minY }, { x: L - minX, y: -minY }] };
}

const isRectangle = (pts) => pts.length === 4 && pts.every((p, k) => {
  const a = pts[(k + pts.length - 1) % pts.length];
  const b = pts[(k + 1) % pts.length];
  const u = { x: a.x - p.x, y: a.y - p.y };
  const v = { x: b.x - p.x, y: b.y - p.y };
  return Math.abs(u.x * v.x + u.y * v.y) < 1e-3 * (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1);
});

/**
 * The treads and landings grouped by shape: one group per identical outline (rounded to 1 mm, the same kind, with or
 * without the riser groove), in walking order of their first member.
 */
export function treadGroups(models, partList = buildPartList(models)) {
  const codeOf = new Map(partList.parts.filter((p) => /^(tread|landing):step-\d+$/.test(p.sourceElementId)).map((p) => [p.sourceElementId.split(':')[1], p]));
  const cuts = treadJointsByStep(models.joints, models.postModels);
  const groups = new Map();
  for (const t of models.treadModels || []) {
    if (t.cantilever) continue; // a cantilever's boxes are their cladding boards — not drawn here
    const part = codeOf.get(t.stepId);
    if (!part || !(t.outline?.length >= 3)) continue;
    const outline = cuts[t.stepId]?.cut?.outline || t.outline;
    const local = localOutline(t, outline);
    const kind = t.type === 'landing' ? 'landing' : t.type === 'winder' ? 'winder' : 'straight';
    const key = `${kind}|${t.notch ? 'n' : ''}|${local.pts.map((p) => `${r0(p.x)},${r0(p.y)}`).sort().join(';')}`;
    if (!groups.has(key)) groups.set(key, { kind, local, codes: [], indices: [], width: Math.max(...local.pts.map((p) => p.x)), depth: Math.max(...local.pts.map((p) => p.y)), thicknessMm: t.thickness, cutRoundPost: !!cuts[t.stepId]?.cut, notch: !!t.notch });
    const g = groups.get(key);
    g.codes.push(part.code);
    g.indices.push(t.index);
  }
  return [...groups.values()];
}

// --- SVG helpers ---------------------------------------------------------------------------------------------------

// a drawing box: mm → px, y up (the model's y / v) to SVG's y down
function frame(bounds, widthPx, maxHeightPx, pad = 34) {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.min((widthPx - 2 * pad) / w, (maxHeightPx - 2 * pad) / h);
  const heightPx = h * k + 2 * pad;
  return { k, widthPx, heightPx, X: (x) => pad + (x - bounds.minX) * k + (widthPx - 2 * pad - w * k) / 2, Y: (y) => heightPx - pad - (y - bounds.minY) * k };
}
const boundsOf = (pts) => ({ minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) });
const poly = (F, pts) => pts.map((p) => `${f1(F.X(p.x))},${f1(F.Y(p.y))}`).join(' ');
const text = (x, y, s, { size = 11, anchor = 'middle', weight = 400, color = '#222', rotate = 0, halo = true } = {}) =>
  `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" fill="${color}"${rotate ? ` transform="rotate(${rotate} ${f1(x)} ${f1(y)})"` : ''}${halo ? ' paint-order="stroke" stroke="#fff" stroke-width="3"' : ''}>${esc(s)}</text>`;
// a dimension line between two SVG points, the value beside it (offset along the normal)
function dimLine(a, b, label, off) {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  const A = { x: a.x + n.x * off, y: a.y + n.y * off };
  const B = { x: b.x + n.x * off, y: b.y + n.y * off };
  const ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI;
  const up = ang > 90 || ang < -90 ? ang + 180 : ang;
  const tick = (P) => `<line x1="${f1(P.x - n.x * 4)}" y1="${f1(P.y - n.y * 4)}" x2="${f1(P.x + n.x * 4)}" y2="${f1(P.y + n.y * 4)}" stroke="#444" stroke-width="1"/>`;
  return `<g class="dim"><line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(A.x)}" y2="${f1(A.y)}" stroke="#999" stroke-width="0.6"/><line x1="${f1(b.x)}" y1="${f1(b.y)}" x2="${f1(B.x)}" y2="${f1(B.y)}" stroke="#999" stroke-width="0.6"/><line x1="${f1(A.x)}" y1="${f1(A.y)}" x2="${f1(B.x)}" y2="${f1(B.y)}" stroke="#444" stroke-width="1"/>${tick(A)}${tick(B)}${text((A.x + B.x) / 2 + n.x * 9, (A.y + B.y) / 2 + n.y * 9 + 4, label, { size: 11, weight: 600, rotate: up })}</g>`;
}

// --- the cards -------------------------------------------------------------------------------------------------------

function treadCard(g) {
  const pts = g.local.pts;
  const F = frame({ minX: 0, maxX: g.width, minY: 0, maxY: g.depth }, 340, 260, 40);
  const color = SHEET_COLORS[g.kind];
  const rect = isRectangle(pts);
  let svg = `<polygon points="${poly(F, pts)}" fill="${color}" fill-opacity="0.55" stroke="#333" stroke-width="1.4"/>`;
  // the front (czoło, with its nosing) — walking up you meet it first: the outline's edges on its front line, red
  const frontY = Math.min(...pts.map((p) => p.y));
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length];
    if (Math.abs(p.y - frontY) < 0.5 && Math.abs(q.y - frontY) < 0.5) svg += `<line x1="${f1(F.X(p.x))}" y1="${f1(F.Y(p.y))}" x2="${f1(F.X(q.x))}" y2="${f1(F.Y(q.y))}" stroke="${SHEET_COLORS.bearing}" stroke-width="3.5"/>`;
  });
  // the overall width (along the front) and depth
  svg += dimLine({ x: F.X(0), y: F.Y(0) }, { x: F.X(g.width), y: F.Y(0) }, `${r0(g.width)}`, 18);
  svg += dimLine({ x: F.X(g.width), y: F.Y(0) }, { x: F.X(g.width), y: F.Y(g.depth) }, `${r0(g.depth)}`, 18);
  // a shape that is not a rectangle: every edge's length on it (not the short ones, not one the overall dimension says)
  if (!rect) {
    const c = { x: g.width / 2, y: g.depth / 2 };
    pts.forEach((p, k) => {
      const q = pts[(k + 1) % pts.length];
      const L = dist(p, q);
      if (L < 30) return;
      if ((Math.abs(p.y - q.y) < 0.5 && Math.abs(L - g.width) < 1) || (Math.abs(p.x - q.x) < 0.5 && Math.abs(L - g.depth) < 1)) return;
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const toC = { x: c.x - m.x, y: c.y - m.y };
      const l = Math.hypot(toC.x, toC.y) || 1;
      svg += text(F.X(m.x + (toC.x / l) * (14 / F.k)), F.Y(m.y + (toC.y / l) * (14 / F.k)) + 4, `${r0(L)}`, { size: 10, color: '#333' });
    });
  }
  const notes = [`grubość ${r0(g.thicknessMm)} mm`, 'czoło (przód) = czerwona krawędź', g.notch ? 'rowek pod podstopień od spodu' : null, g.cutRoundPost ? 'wycięcie na słup' : null].filter(Boolean).join(' · ');
  return `<div class="card"><div class="card-h"><span class="sw" style="background:${color}"></span><b>${esc(codeRanges(g.codes))}</b><span class="qty">× ${g.codes.length}</span></div><div class="card-sub">${KIND_PL[g.kind]} — ${r0(g.width)} × ${r0(g.depth)} mm${notes ? ` · ${esc(notes)}` : ''}</div><svg viewBox="0 0 ${F.widthPx} ${f1(F.heightPx)}" width="100%">${svg}</svg></div>`;
}

function stringerCard(board) {
  const { geo, segment, code, side, name, dims } = board;
  const contour = geo.outerContour.map((p) => ({ x: p.u, y: p.v }));
  const b = boundsOf(contour);
  const F = frame(b, 720, 300, 44);
  const color = SHEET_COLORS[side];
  let svg = `<polygon points="${poly(F, contour)}" fill="${color}" fill-opacity="0.35" stroke="#333" stroke-width="1.4"/>`;
  // housings (a housed board): where the treads / risers go in
  for (const h of geo.housings || []) {
    const r = [{ x: h.uStart, y: h.bottomV }, { x: h.uEnd, y: h.bottomV }, { x: h.uEnd, y: h.topV }, { x: h.uStart, y: h.topV }];
    svg += `<polygon points="${poly(F, r)}" fill="${SHEET_COLORS.housing}" fill-opacity="0.35" stroke="${SHEET_COLORS.housing}" stroke-width="0.8"/>`;
  }
  // where each tread bears on the board: a red line with its number
  for (const t of segment.treadBearings || []) {
    const y = F.Y(t.bearingElevation);
    svg += `<line x1="${f1(F.X(t.finalUStart))}" y1="${f1(y)}" x2="${f1(F.X(t.finalUEnd))}" y2="${f1(y)}" stroke="${SHEET_COLORS.bearing}" stroke-width="2.4"/>`;
    svg += text((F.X(t.finalUStart) + F.X(t.finalUEnd)) / 2, y - 6, `${t.treadIndex + 1}`, { size: 11, weight: 700, color: SHEET_COLORS.bearing });
  }
  // the post faces it goes into
  for (const end of ['start', 'end']) {
    const into = geo.ends?.[end]?.intoPost;
    if (!into) continue;
    const x = F.X(into.faceU);
    svg += `<line x1="${f1(x)}" y1="${f1(F.Y(b.minY))}" x2="${f1(x)}" y2="${f1(F.Y(b.maxY))}" stroke="${SHEET_COLORS.post}" stroke-width="1.4" stroke-dasharray="5,3"/>`;
    svg += text(x + (end === 'start' ? 4 : -4), F.Y(b.maxY) - 6, `lico słupa (wręb ${r0(into.depthMm)} mm)`, { size: 10, anchor: end === 'start' ? 'start' : 'end', color: SHEET_COLORS.post });
  }
  svg += dimLine({ x: F.X(b.minX), y: F.Y(b.minY) }, { x: F.X(b.maxX), y: F.Y(b.minY) }, `${r0(b.maxX - b.minX)}`, 20);
  svg += dimLine({ x: F.X(b.maxX), y: F.Y(b.minY) }, { x: F.X(b.maxX), y: F.Y(b.maxY) }, `${r0(b.maxY - b.minY)}`, 20);
  const type = geo.constructionType === 'closed' ? 'wpuszczana (stopnie we wrębach)' : 'nakładana (stopnie na grzebieniu)';
  const steps = (segment.treadBearings || []).map((t) => t.treadIndex + 1);
  return `<div class="card wide"><div class="card-h"><span class="sw" style="background:${color}"></span><b>${esc(code)}</b><span class="name">${esc(name)}</span></div><div class="card-sub">${esc(type)} · grubość ${r0(geo.thicknessMm)} mm · w widoku z boku ${r0(b.maxX - b.minX)} × ${r0(b.maxY - b.minY)} mm · formatka ${esc(dims)}${steps.length ? ` · stopnie ${esc(codeRanges(steps.map(String)))}` : ''}</div><svg viewBox="0 0 ${F.widthPx} ${f1(F.heightPx)}" width="100%">${svg}</svg></div>`;
}

// the plan with every part's code
function planOverview(models, partList) {
  const codeBy = new Map(partList.parts.map((p) => [p.sourceElementId, p.code]));
  const treads = (models.treadModels || []).filter((t) => t.outline?.length >= 3);
  const boards = [];
  for (const side of ['outer', 'inner']) {
    const model = models.stringerModels?.[side];
    if (!model || model.absent) continue;
    for (const s of model.segments || []) {
      const code = codeBy.get(`stringer:${side}:${s.id}`);
      if (!code) continue;
      const { start, end } = s.referenceLine;
      const n = s.inwardNormal || { x: 0, y: 0 };
      const t = s.thickness || 40;
      boards.push({ side, code, pts: [start, end, { x: end.x + n.x * t, y: end.y + n.y * t }, { x: start.x + n.x * t, y: start.y + n.y * t }], mid: { x: (start.x + end.x) / 2 - n.x * 60, y: (start.y + end.y) / 2 - n.y * 60 } });
    }
  }
  const posts = (models.postModels || []).filter((p) => p.kind !== 'railing' && codeBy.get(`post:${p.postId}`));
  const all = [...treads.flatMap((t) => t.outline), ...boards.flatMap((b) => [...b.pts, b.mid]), ...posts.map((p) => p.position)];
  if (!all.length) return '';
  const F = frame(boundsOf(all), 720, 620, 30);
  let svg = '';
  for (const t of treads) {
    const kind = t.type === 'landing' ? 'landing' : t.type === 'winder' ? 'winder' : 'straight';
    svg += `<polygon points="${poly(F, t.outline)}" fill="${SHEET_COLORS[kind]}" fill-opacity="0.55" stroke="#333" stroke-width="1"/>`;
  }
  for (const b of boards) svg += `<polygon points="${poly(F, b.pts)}" fill="${SHEET_COLORS[b.side]}" stroke="#222" stroke-width="0.6"/>`;
  for (const p of posts) {
    const h = (p.size / 2) * F.k;
    svg += `<rect x="${f1(F.X(p.position.x) - h)}" y="${f1(F.Y(p.position.y) - h)}" width="${f1(2 * h)}" height="${f1(2 * h)}" fill="${SHEET_COLORS.post}"/>`;
  }
  for (const t of treads) {
    const code = codeBy.get(`${t.type === 'landing' ? 'landing' : 'tread'}:${t.stepId}`);
    if (!code) continue;
    const c = t.outline.reduce((s, p) => ({ x: s.x + p.x / t.outline.length, y: s.y + p.y / t.outline.length }), { x: 0, y: 0 });
    svg += text(F.X(c.x), F.Y(c.y) + 4, code, { size: 10, weight: 700 });
  }
  for (const b of boards) svg += text(F.X(b.mid.x), F.Y(b.mid.y) + 4, b.code, { size: 10, weight: 700, color: SHEET_COLORS[b.side] });
  // (a post's code beside it — on its left when it stands at the drawing's right edge)
  for (const p of posts) {
    const right = F.X(p.position.x) > F.widthPx - 60;
    const dx = (p.size / 2) * F.k + 3;
    svg += text(F.X(p.position.x) + (right ? -dx : dx), F.Y(p.position.y) - (p.size / 2) * F.k - 3, codeBy.get(`post:${p.postId}`), { size: 10, weight: 700, anchor: right ? 'end' : 'start', color: SHEET_COLORS.post });
  }
  return `<svg viewBox="0 0 ${F.widthPx} ${f1(F.heightPx)}" width="100%" class="plan">${svg}</svg>`;
}

const CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; color: #222; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #333; padding-bottom: 2mm; margin-bottom: 4mm; }
  header h1 { margin: 0; font-size: 16pt; }
  header .meta { text-align: right; color: #555; }
  h2 { font-size: 13pt; margin: 6mm 0 2mm; padding: 1.5mm 3mm; background: #2B2A29; color: #fff; border-radius: 1.5mm; break-after: avoid; }
  .warn { background: #fdecea; color: #b3261e; padding: 2mm 3mm; border-radius: 1.5mm; margin-bottom: 3mm; }
  .legend { display: flex; flex-wrap: wrap; gap: 3mm 6mm; margin: 2mm 0; }
  .legend span { display: inline-flex; align-items: center; gap: 1.5mm; }
  .sw { display: inline-block; width: 4mm; height: 4mm; border-radius: 0.8mm; border: 1px solid #0003; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
  .card { border: 1px solid #ccc; border-radius: 2mm; padding: 2mm 3mm; break-inside: avoid; }
  .card.wide { grid-column: 1 / -1; margin-bottom: 3mm; }
  .card-h { display: flex; align-items: center; gap: 2mm; font-size: 11pt; }
  .card-h .qty { margin-left: auto; font-weight: 700; font-size: 12pt; }
  .card-h .name { color: #555; }
  .card-sub { color: #555; font-size: 9pt; margin: 0.5mm 0 1mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 1mm; }
  th, td { text-align: left; padding: 1.2mm 2mm; border-bottom: 1px solid #ddd; }
  th { background: #f2f2f2; }
  td.n, th.n { text-align: right; }
  .plan { border: 1px solid #ddd; border-radius: 2mm; }
  .page { break-after: page; }
`;

/**
 * @param {object} models  buildStaircase's result
 * @param {{projectName?: string, date?: string, warning?: string|null}} [opts]
 * @returns {string} the HTML document
 */
export function installerSheetHTML(models, { projectName = '', date = '', warning = null } = {}) {
  const config = models?.fullConfig ?? models?.config;
  const partList = buildPartList(models);
  const groups = treadGroups(models, partList);
  const codeBy = new Map(partList.parts.map((p) => [p.sourceElementId, p]));
  // the wangi's boards (with a contour and a code), each side in its order
  const boards = [];
  for (const side of ['outer', 'inner']) {
    const model = models.stringerModels?.[side];
    const geos = models.stringerConstruction?.[side] || [];
    if (!model || model.absent) continue;
    model.segments.forEach((segment, i) => {
      const part = codeBy.get(`stringer:${side}:${segment.id}`);
      const geo = geos[i];
      if (part && geo?.outerContour?.length >= 3) boards.push({ geo, segment, side, code: part.code, name: wangaName(side, config), dims: part.dimensions });
    });
  }
  const risers = partList.parts.filter((p) => p.elementType === 'RISER');
  const posts = partList.parts.filter((p) => p.elementType === 'POST' && p.code.startsWith('SL'));
  const postById = new Map((models.postModels || []).map((p) => [p.postId, p]));
  const count = (kind) => groups.filter((g) => g.kind === kind).reduce((n, g) => n + g.codes.length, 0);
  const summary = [
    ['straight', 'Stopnie proste', count('straight'), groups.filter((g) => g.kind === 'straight').flatMap((g) => g.codes)],
    ['winder', 'Stopnie zabiegowe', count('winder'), groups.filter((g) => g.kind === 'winder').flatMap((g) => g.codes)],
    ['landing', 'Podesty', count('landing'), groups.filter((g) => g.kind === 'landing').flatMap((g) => g.codes)],
    ['outer', 'Wangi — deski', boards.length, boards.map((b) => b.code)],
    [null, 'Podstopnice', risers.length, risers.map((r) => r.code)],
    ['post', 'Słupy konstrukcyjne', posts.length, posts.map((p) => p.code)],
  ].filter((r) => r[2] > 0);
  const sortCodes = (codes) => [...codes].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
  const legend = [['straight', 'stopień prosty'], ['winder', 'stopień zabiegowy'], ['landing', 'podest'], ['outer', 'wanga zewnętrzna'], ['inner', 'wanga wewnętrzna'], ['post', 'słup']]
    .map(([k, l]) => `<span><span class="sw" style="background:${SHEET_COLORS[k]}"></span>${esc(l)}</span>`)
    .join('');
  const head = `<header><div><h1>Karta dla montażysty</h1><div>${esc(projectName || 'Schody')}</div></div><div class="meta">${esc(date)}<br>kody jak na etykietach elementów</div></header>`;
  const page1 = `<section class="page">${head}${warning ? `<div class="warn">${esc(warning)}</div>` : ''}<h2>Rzut schodów z kodami elementów</h2><div class="legend">${legend}</div>${planOverview(models, partList)}<h2>Ilości</h2><table><tr><th>Element</th><th class="n">Ilość</th><th>Kody</th></tr>${summary.map(([k, l, n, codes]) => `<tr><td>${k ? `<span class="sw" style="background:${SHEET_COLORS[k]}"></span> ` : ''}${esc(l)}</td><td class="n"><b>${n}</b></td><td>${esc(codeRanges(sortCodes(codes)))}</td></tr>`).join('')}</table></section>`;
  const wangi = boards.length ? `<section><h2>Wangi — widok z boku (czerwone kreski: oparcie stopni, numer stopnia)</h2>${boards.map(stringerCard).join('')}</section>` : '';
  const treadSection = (kind, title) => {
    const gs = groups.filter((g) => g.kind === kind);
    return gs.length ? `<section><h2>${title}</h2><div class="grid">${gs.map(treadCard).join('')}</div></section>` : '';
  };
  // the risers grouped by size, the posts one by one
  const riserRows = [...risers.reduce((m, r) => m.set(r.dimensions, [...(m.get(r.dimensions) || []), r.code]), new Map())];
  const riserTable = risers.length ? `<section><h2>Podstopnice</h2><table><tr><th>Kody</th><th class="n">Ilość</th><th>Wymiary (dł. × wys. × gr.)</th></tr>${riserRows.map(([d, codes]) => `<tr><td>${esc(codeRanges(codes))}</td><td class="n"><b>${codes.length}</b></td><td>${esc(d)}</td></tr>`).join('')}</table></section>` : '';
  const postTable = posts.length
    ? `<section><h2>Słupy konstrukcyjne</h2><table><tr><th>Kod</th><th>Słup</th><th>Przekrój</th><th class="n">Wysokość</th></tr>${posts
        .map((p) => {
          const post = postById.get(p.sourceElementId.split(':')[1]);
          return `<tr><td><b>${esc(p.code)}</b></td><td>${esc(p.name)}</td><td>${post ? `${r0(post.size)} × ${r0(post.size)} mm` : '—'}</td><td class="n">${post ? `${r0(post.elevation.top - post.elevation.bottom)} mm` : esc(p.dimensions)}</td></tr>`;
        })
        .join('')}</table></section>`
    : '';
  const title = `Karta dla montażysty${projectName ? ` — ${projectName}` : ''}`;
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${page1}${wangi}${treadSection('straight', 'Stopnie proste — rzut z góry')}${treadSection('winder', 'Stopnie zabiegowe — rzut z góry')}${treadSection('landing', 'Podesty — rzut z góry')}${riserTable}${postTable}</body></html>`;
}
