// The parts' LABELS on an A4 sheet of stickers (user decisions 2026-10-28) — pure, returns an HTML document printed
// through the browser (like the offer). One label per piece (a part of quantity n gets n labels), except the parts
// counted by the piece in bulk (balusters, glass fixings, wall brackets) — one label "× n". Each label: the code (big),
// the part's name, its sizes (the takeoff's calculated dimensions), the material, the project and the date. No QR.

import { escapeHtml } from '../util/format.js';

/** Sticker sheets: columns × rows, the label's size in mm (edge to edge on A4 210 × 297). */
export const LABEL_LAYOUTS = Object.freeze({
  '3x8': { cols: 3, rows: 8, widthMm: 70, heightMm: 37, codePt: 20 },
  '2x7': { cols: 2, rows: 7, widthMm: 105, heightMm: 42.4, codePt: 26 },
});
const BULK = new Set(['BALUSTER', 'GLASS_FIXING']);

/** The labels to print: one per piece, bulk parts once with their quantity. */
export function labelsFor(parts) {
  const out = [];
  for (const p of parts || []) {
    const bulk = BULK.has(p.elementType) || p.code.startsWith('UP-');
    const n = bulk ? 1 : Math.max(1, Math.round(p.quantity || 1));
    for (let i = 0; i < n; i++) out.push({ ...p, count: bulk && p.quantity > 1 ? p.quantity : null, copy: n > 1 ? `${i + 1}/${n}` : null });
  }
  return out;
}

/**
 * @param {{parts: object[], projectName?: string, layout?: '3x8'|'2x7', date?: string, warning?: string|null}} opts
 * @returns {string} the HTML document (A4 pages of labels)
 */
export function labelSheetHTML({ parts, projectName = '', layout = '3x8', date = '', warning = null }) {
  const L = LABEL_LAYOUTS[layout] || LABEL_LAYOUTS['3x8'];
  const labels = labelsFor(parts);
  const perPage = L.cols * L.rows;
  const pages = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  const one = (l) => `<div class="label">
    <div class="code">${escapeHtml(l.code)}${l.count ? ` <span class="count">× ${l.count}</span>` : ''}${l.copy ? ` <span class="copy">${l.copy}</span>` : ''}</div>
    <div class="name">${escapeHtml(l.name)}</div>
    <div class="dims">${escapeHtml(l.dimensions || '')}</div>
    <div class="foot"><span>${escapeHtml(l.material || '')}</span><span>${escapeHtml([projectName, date].filter(Boolean).join(' · '))}</span></div>
  </div>`;
  const css = `@page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .page { width: 210mm; height: 297mm; display: grid; grid-template-columns: repeat(${L.cols}, ${L.widthMm}mm); grid-auto-rows: ${L.heightMm}mm; align-content: start; page-break-after: always; break-after: page; overflow: hidden; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .label { padding: 2.5mm 3.5mm; overflow: hidden; display: flex; flex-direction: column; gap: 0.6mm; border: 0.1mm dashed #ccc; }
  .code { font-size: ${L.codePt}pt; font-weight: 700; line-height: 1; letter-spacing: 0.5pt; }
  .count, .copy { font-size: ${Math.round(L.codePt * 0.5)}pt; font-weight: 400; }
  .name { font-size: 9pt; font-weight: 600; }
  .dims { font-size: 8pt; }
  .foot { margin-top: auto; font-size: 6.5pt; display: flex; justify-content: space-between; gap: 2mm; color: #333; }
  .warning { font: 10pt Arial, sans-serif; padding: 4mm; color: #a00; }
  @media print { .label { border-color: transparent; } .warning { display: none; } }`;
  const body = pages.length ? pages.map((pg) => `<div class="page">${pg.map(one).join('')}</div>`).join('') : '<p class="warning">Brak elementów do oznaczenia.</p>';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${escapeHtml(`Etykiety ${projectName}`.trim())}</title><style>${css}</style></head><body>${warning ? `<div class="warning">${escapeHtml(warning)}</div>` : ''}${body}</body></html>`;
}
