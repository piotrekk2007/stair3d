// OFFER DOCUMENT — the client's offer as one printable HTML page (A4), turned into a PDF by the browser's own print
// dialog ("Zapisz jako PDF") — user decision 2026-09-28: no PDF library, Polish characters and images just work.
// Pure: builds a string from already-computed data (offerModel.js buildOffer / stairFacts) and images passed in by
// the caller (a 3D view as a data URL, the plan as SVG markup). Never shows the CNC + projekt amount: it is already
// inside the material lines.

import { escapeHtml as esc } from '../util/format.js';

const moneyFmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v) => `${moneyFmt.format(v || 0).replace(/ /g, ' ')} zł`;
const qtyFmt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
const dateFmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

const CSS = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #222; font-size: 10.5pt; line-height: 1.4; margin: 0; }
  .page { max-width: 182mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; border-bottom: 2px solid #8a5a34; padding-bottom: 4mm; }
  header img { max-height: 22mm; max-width: 70mm; object-fit: contain; }
  .company { text-align: right; font-size: 9pt; color: #444; }
  .company strong { font-size: 11pt; color: #222; }
  h1 { font-size: 17pt; margin: 6mm 0 1mm; color: #5a3d24; }
  h2 { font-size: 11.5pt; margin: 6mm 0 2mm; color: #5a3d24; border-bottom: 1px solid #e3d6c6; padding-bottom: 1mm; }
  .meta { display: flex; justify-content: space-between; gap: 10mm; font-size: 9.5pt; }
  .meta .box { flex: 1; }
  .muted { color: #777; }
  .images { display: flex; gap: 4mm; margin-top: 4mm; break-inside: avoid; }
  .images figure { flex: 1; margin: 0; border: 1px solid #e3d6c6; border-radius: 2mm; padding: 2mm; text-align: center; }
  .images img { width: 100%; height: auto; max-height: 80mm; object-fit: contain; }
  .images svg { width: 100%; height: 78mm; display: block; }
  .images figcaption { font-size: 8.5pt; color: #777; }
  table { width: 100%; border-collapse: collapse; break-inside: avoid; }
  td, th { padding: 1.4mm 2mm; vertical-align: top; }
  .params td { border-bottom: 1px solid #f0e8de; }
  .params td:first-child { color: #555; width: 50%; }
  .comfort th, .comfort td { border-bottom: 1px solid #f0e8de; text-align: left; font-size: 9.5pt; }
  .ok { color: #2e7d32; font-weight: 600; }
  .warn { color: #c62828; font-weight: 600; }
  .price th { background: #f5ede3; text-align: left; font-size: 9pt; color: #5a3d24; }
  .price td { border-bottom: 1px solid #efe6da; }
  .price .num { text-align: right; white-space: nowrap; }
  .detail { display: block; font-size: 8.5pt; color: #777; }
  .totals { margin-top: 2mm; margin-left: auto; width: 80mm; }
  .totals td { padding: 1mm 2mm; }
  .totals .num { text-align: right; }
  .totals .gross td { font-size: 12.5pt; font-weight: 700; color: #5a3d24; border-top: 2px solid #8a5a34; }
  .notes { white-space: pre-wrap; font-size: 9.5pt; }
  footer { margin-top: 8mm; font-size: 8pt; color: #888; border-top: 1px solid #e3d6c6; padding-top: 2mm; }
`;

/**
 * @param {{offer: ReturnType<import('./offerModel.js').buildOffer>, facts: ReturnType<import('./offerModel.js').stairFacts>,
 *   settings: Object, company: Object, logoDataUrl?: string, image3d?: string, planSvg?: string, projectName?: string,
 *   date?: Date}} input
 * @returns {string} a complete HTML document
 */
export function buildOfferHTML({ offer, facts, settings, company = {}, logoDataUrl = null, image3d = null, planSvg = null, projectName = '', date = new Date() }) {
  // calendar days (not 24 h steps — a DST change would move the date by a day)
  const valid = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (settings.validityDays || 30));
  const companyLines = [company.address, company.nip ? `NIP: ${company.nip}` : '', [company.phone, company.email].filter(Boolean).join(' · '), company.www].filter(Boolean);
  const client = settings.client || {};
  const clientLines = [client.name, client.address, [client.phone, client.email].filter(Boolean).join(' · ')].filter(Boolean);
  const title = `Oferta${settings.offerNumber ? ` nr ${esc(settings.offerNumber)}` : ''}`;

  const priceRows = offer.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${esc(l.label)}${l.detail ? `<span class="detail">${esc(l.detail)}</span>` : ''}</td>
        <td class="num">${l.qty != null ? `${qtyFmt.format(l.qty)} ${esc(l.unit || '')}` : '1 kpl.'}</td>
        <td class="num">${money(l.unitNet != null ? l.unitNet : l.net)}</td><td class="num">${money(l.net)}</td></tr>`
    )
    .join('');
  const comfortRows = facts.comfort
    .map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.value)}</td><td>${esc(c.requirement)} <span class="muted">(${esc(c.source)})</span></td><td class="${c.ok ? 'ok' : 'warn'}">${c.ok ? '✓ spełnia' : '! poza zakresem'}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><title>${title}${projectName ? ` — ${esc(projectName)}` : ''}</title><style>${CSS}</style></head>
<body><div class="page">
  <header>
    <div>${logoDataUrl ? `<img src="${esc(logoDataUrl)}" alt="logo">` : `<strong>${esc(company.name)}</strong>`}</div>
    <div class="company">${company.name && logoDataUrl ? `<strong>${esc(company.name)}</strong><br>` : ''}${companyLines.map(esc).join('<br>')}</div>
  </header>
  <h1>${title}</h1>
  <div class="meta">
    <div class="box">${clientLines.length ? `<div class="muted">Dla:</div>${clientLines.map(esc).join('<br>')}` : ''}</div>
    <div class="box" style="text-align:right">Data: ${dateFmt(date)}<br>Ważna do: ${dateFmt(valid)}${projectName ? `<br>Projekt: ${esc(projectName)}` : ''}</div>
  </div>
  ${image3d || planSvg ? `<div class="images">
    ${image3d ? `<figure><img src="${esc(image3d)}" alt="wizualizacja"><figcaption>Wizualizacja</figcaption></figure>` : ''}
    ${planSvg ? `<figure>${planSvg}<figcaption>Rzut z góry (wymiary w mm)</figcaption></figure>` : ''}
  </div>` : ''}
  <h2>Parametry schodów</h2>
  <table class="params">${facts.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
  ${settings.showComfort !== false ? `<h2>Wygoda i zgodność z przepisami</h2>
  <table class="comfort"><tr><th>Parametr</th><th>Wartość</th><th>Wymaganie</th><th></th></tr>${comfortRows}</table>` : ''}
  <h2>Wycena</h2>
  <table class="price"><tr><th>Lp.</th><th>Pozycja</th><th class="num">Ilość</th><th class="num">Cena netto</th><th class="num">Wartość netto</th></tr>${priceRows}</table>
  <table class="totals">
    <tr><td>Razem netto</td><td class="num">${money(offer.totals.net)}</td></tr>
    <tr><td>VAT ${offer.totals.vatRatePct}%</td><td class="num">${money(offer.totals.vat)}</td></tr>
    <tr class="gross"><td>Razem brutto</td><td class="num">${money(offer.totals.gross)}</td></tr>
  </table>
  ${settings.notes ? `<h2>Uwagi</h2><div class="notes">${esc(settings.notes)}</div>` : ''}
  <footer>Cena materiału obejmuje jego przygotowanie (projekt i obróbkę).</footer>
</div></body></html>`;
}
