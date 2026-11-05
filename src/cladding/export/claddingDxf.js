// The module "Schody na beton" as a 1:1 DXF (user request 2026-11-04 — docs/architecture/CONCRETE_CLADDING_MODULE.md):
// every cladding piece flat on one sheet, in rows — the treads (each in its own frame: its grain along x, the front at
// the bottom), the landings, the risers (a bent one developed), the antresola nosing, the skirting boards and cover
// stringers (in their own plane), the glass panes — each outlined (layer OUTLINE; a profiled tread's milled edges on
// PROFILE) with its code, size and notes (layer TEXT). ASCII R12, mm, no diacritics. The module's own small writer (the self-supporting dxfExport.js is built round
// that engine's models). Pure.

const ROW_GAP = 250;
const PIECE_GAP = 120;
const TEXT_H = 25;

const ASCII = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z', '×': 'x', '–': '-', '—': '-', '·': '-', '°': ' st.' };
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, (c) => ASCII[c] ?? '');
const f = (n) => (Math.round(n * 1000) / 1000).toString();

function line(a, b, layer) {
  return ['0', 'LINE', '8', layer, '10', f(a.u), '20', f(a.v), '30', '0', '11', f(b.u), '21', f(b.v), '31', '0'].join('\n');
}
function text(t, at, layer = 'TEXT', h = TEXT_H) {
  return ['0', 'TEXT', '8', layer, '10', f(at.u), '20', f(at.v), '30', '0', '40', f(h), '1', ascii(t)].join('\n');
}
// a closed outline; `edgeLayers[k]` (optional) puts edge k → k+1 on its own layer (a profiled edge on PROFILE)
function closed(pts, edgeLayers = null) {
  return pts.map((p, k) => line(p, pts[(k + 1) % pts.length], edgeLayers?.[k] || 'OUTLINE')).join('\n');
}

// a plan outline in the piece's own frame: its grain along +u, its front (the smaller v) at the bottom, at the origin
function toLocal(outline, grain) {
  const n = { x: -grain.y, y: grain.x };
  const pts = outline.map((p) => ({ u: p.x * grain.x + p.y * grain.y, v: p.x * n.x + p.y * n.y }));
  const u0 = Math.min(...pts.map((p) => p.u));
  const v0 = Math.min(...pts.map((p) => p.v));
  return pts.map((p) => ({ u: p.u - u0, v: p.v - v0 }));
}
// a polygon in (s, z) (a board, a pane) at the origin
const planeLocal = (poly) => {
  const s0 = Math.min(...poly.map((p) => p.s));
  const z0 = Math.min(...poly.map((p) => p.z));
  return poly.map((p) => ({ u: p.s - s0, v: p.z - z0 }));
};
const size = (pts) => ({ w: Math.max(...pts.map((p) => p.u)), h: Math.max(...pts.map((p) => p.v)) });

/** The pieces with their codes and Polish names (the DXF writes them in ASCII; the cut list as they are). */
export function claddingPieces(built) {
  const { cladding, concrete } = built;
  const kindOf = new Map(concrete.elements.map((e) => [e.index, e.kind]));
  const pieces = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (const t of cladding.treads) {
    const landing = t.kind === 'landing';
    const code = `${landing ? 'PD' : 'ST'}-${pad(t.index + 1)}`;
    const notes = [`${t.thicknessMm} mm`, t.profile?.kind && t.profile.kind !== 'square' ? `profil: ${{ chamfer: `fazka ${t.profile.sizeMm}`, round: `R${t.profile.sizeMm}`, bullnose: 'półwałek' }[t.profile.kind]}` : '', t.starter ? 'zapraszający' : '', kindOf.get(t.index) === 'winder' ? 'zabiegowy' : ''].filter(Boolean);
    if (t.parts) {
      if (t.parts.nosing) pieces.push({ row: 'treads', code: `${code}N`, name: `Nosek podestu ${t.index + 1}`, pts: toLocal(t.parts.nosing.outline, t.grain), notes: [`${t.parts.nosing.topZ - t.parts.nosing.bottomZ} mm`] });
      continue;
    }
    // the milled edges (front, nosed sides) on their own layer when the tread is profiled
    const edgeLayers = t.profile?.kind && t.profile.kind !== 'square' ? (t.exposed || []).map((x) => (x ? 'PROFILE' : null)) : null;
    pieces.push({ row: landing ? 'landings' : 'treads', code, name: `${landing ? 'Podest' : 'Stopień'} ${t.index + 1}`, pts: toLocal(t.outline, t.grain), edgeLayers, notes });
  }
  for (const r of cladding.risers) {
    if (!(r.heightMm > 0)) continue;
    // `riser-<i>` / a winder's panel `riser-<i>-<k>` (a, b, …) / the exit riser `riser-top[-k]`
    const panel = r.id.match(/^riser-\d+-(\d+)$/);
    const top = r.id.match(/^riser-top(?:-(\d+))?$/);
    const code = top ? `PS-G${top[1] ? String.fromCharCode(97 + Number(top[1])) : ''}` : `PS-${pad(r.index + 1)}${panel ? String.fromCharCode(97 + Number(panel[1])) : ''}`;
    // a riser = a rectangle: its (developed) length × its height
    const pts = [{ u: 0, v: 0 }, { u: r.lengthMm, v: 0 }, { u: r.lengthMm, v: r.heightMm }, { u: 0, v: r.heightMm }];
    pieces.push({ row: 'risers', code, name: r.bent ? 'Podstopnica gięta (rozwinięcie)' : 'Podstopnica', pts, notes: [`${r.thicknessMm} mm`] });
  }
  for (const n of cladding.exitNosing || []) pieces.push({ row: 'treads', code: 'NA', name: 'Nosek antresoli', pts: toLocal(n.outline, n.grain), notes: [`${n.thicknessMm} mm`] });
  for (const b of built.finish?.skirting || []) pieces.push({ row: 'boards', code: `LS-${b.key.flight + 1}${b.key.side === 'left' ? 'L' : 'P'}`, name: `Listwa przyścienna bieg ${b.key.flight + 1}`, pts: planeLocal(b.polygon), notes: [`${b.thicknessMm} mm`, b.style === 'stepped' ? 'schodkowa' : 'pochyła'] });
  for (const b of built.finish?.coverStringers || []) pieces.push({ row: 'boards', code: `WO-${b.key.flight + 1}${b.key.side === 'left' ? 'L' : 'P'}`, name: `Wanga obiciowa bieg ${b.key.flight + 1}`, pts: planeLocal(b.polygon), notes: [`${b.thicknessMm} mm`] });
  let g = 0;
  for (const s of built.balustrade?.sections || []) for (const p of s.panes || []) pieces.push({ row: 'glass', code: `SZ-${++g}`, name: `Szyba (${s.infill === 'glass-side' ? 'na boku, rotule' : 'między słupami'})`, pts: planeLocal(p.polygon), notes: [`${p.thicknessMm} mm`, `${Math.round(p.widthMm)} x ${Math.round(p.heightMm)}`] });
  return pieces;
}

const ROWS = [
  ['treads', 'STOPNIE I NOSKI'],
  ['landings', 'PODESTY'],
  ['risers', 'PODSTOPNICE'],
  ['boards', 'LISTWY I WANGI OBICIOWE'],
  ['glass', 'SZYBY'],
];

/** @returns {string|null} the DXF text, null when there is nothing to draw */
export function buildCladdingDXF(built, { projectName = '' } = {}) {
  const pieces = claddingPieces(built);
  if (!pieces.length) return null;
  const entities = [];
  let v = 0;
  if (projectName) entities.push(text(`Projekt: ${projectName}`, { u: 0, v: -TEXT_H * 3 }, 'TEXT', TEXT_H * 1.4));
  for (const [row, title] of ROWS) {
    const items = pieces.filter((p) => p.row === row);
    if (!items.length) continue;
    let u = 0;
    let rowH = 0;
    const base = v;
    for (const p of items) {
      const { w, h } = size(p.pts);
      const at = p.pts.map((q) => ({ u: q.u + u, v: q.v + base + TEXT_H * 4 }));
      entities.push(closed(at, p.edgeLayers));
      entities.push(text(`${p.code} ${p.name}`, { u, v: base + TEXT_H * 2.2 }));
      entities.push(text(`${Math.round(w)} x ${Math.round(h)} mm${p.notes.length ? ` · ${p.notes.join(', ')}` : ''}`, { u, v: base + TEXT_H * 0.6 }, 'TEXT', TEXT_H * 0.8));
      u += w + PIECE_GAP;
      rowH = Math.max(rowH, h);
    }
    entities.push(text(title, { u: 0, v: base + TEXT_H * 5 + rowH + 20 }, 'TEXT', TEXT_H * 1.4));
    v = base + rowH + TEXT_H * 8 + ROW_GAP;
  }
  const layer = (name, colour) => ['0', 'LAYER', '2', name, '70', '0', '62', String(colour), '6', 'CONTINUOUS'];
  const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '3', ...layer('OUTLINE', 7), ...layer('PROFILE', 1), ...layer('TEXT', 3), '0', 'ENDTAB', '0', 'ENDSEC'];
  const header = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'];
  return [...header, ...tables, '0', 'SECTION', '2', 'ENTITIES', entities.join('\n'), '0', 'ENDSEC', '0', 'EOF'].join('\n') + '\n';
}
