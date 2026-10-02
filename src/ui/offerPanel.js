// "Oferta" tab (right sidebar): the offer settings (project data — client, number, CNC + projekt lump sum,
// installation, VAT, categories shown separately, notes), the company data (a company setting, kept in the browser)
// and a live preview of the offer's lines and totals. Computes nothing itself: the lines come from offer/offerModel.js
// buildOffer, the PDF from offer/offerDocument.js (printed by main.js).

import { OFFER_VAT_RATES } from '../offer/offerModel.js';
import { money } from '../offer/offerDocument.js';
import { escapeHtml as esc } from '../util/format.js';


/**
 * @param {HTMLElement} container
 * @param {{onSettings: (patch: Object) => void, onCompany: (patch: Object) => void, onGenerate: () => void,
 *   onSuggestNumber: () => void}} handlers
 */
export function createOfferPanel(container, handlers) {
  const panel = document.createElement('div');
  panel.id = 'offer-panel';
  panel.innerHTML = `
    <div class="of-actions">
      <button type="button" data-of="generate" class="of-primary" title="Otwiera okno drukowania — wybierz „Zapisz jako PDF”">📄 Generuj ofertę (PDF)</button>
    </div>
    <div class="of-warnings" data-of="warnings"></div>
    <h4>Podgląd wyceny</h4>
    <div data-of="preview"></div>

    <h4>Koszty</h4>
    <label class="of-row">CNC + projekt (ryczałt, netto) [zł]<input type="number" min="0" step="10" data-set="cncProjectCostNet"></label>
    <div class="of-hint">Nie jest widoczny w PDF — rozkłada się proporcjonalnie na pozycje materiału („materiał wraz z przygotowaniem”).</div>
    <label class="of-row">Montaż (netto) [zł]<input type="number" min="0" step="10" data-set="installationCostNet"></label>
    <label class="of-row">Stawka VAT
      <select data-set="vatRatePct">${OFFER_VAT_RATES.map((r) => `<option value="${r}">${r}%</option>`).join('')}</select>
    </label>
    <div class="of-sub">Pokaż osobno (z udziałem w przygotowaniu):</div>
    <div data-of="categories" class="of-cats"></div>
    <div class="of-hint">Pozycje dodatkowe (np. lakierowanie wang na biało) dodajesz w zakładce Kosztorys → „Pozycje dodatkowe”; w ofercie są osobnymi pozycjami.</div>

    <h4>Klient i oferta</h4>
    <label class="of-row">Klient<input type="text" data-client="name"></label>
    <label class="of-row">Adres<input type="text" data-client="address"></label>
    <label class="of-row">Telefon<input type="text" data-client="phone"></label>
    <label class="of-row">E-mail<input type="text" data-client="email"></label>
    <label class="of-row">Numer oferty<span class="of-inline"><input type="text" data-set="offerNumber"><button type="button" data-of="suggest" title="Nadaj numer z bieżącej daty">Nadaj</button></span></label>
    <label class="of-row">Ważna (dni)<input type="number" min="1" step="1" data-set="validityDays"></label>
    <label class="of-check"><input type="checkbox" data-set="showComfort"> Pokaż sekcję „Wygoda i zgodność z przepisami”</label>
    <label class="of-row of-col">Uwagi (drukowane w ofercie)<textarea rows="3" data-set="notes"></textarea></label>

    <details class="of-company">
      <summary>Dane firmy (w nagłówku oferty — zapamiętane w tej przeglądarce)</summary>
      <label class="of-row">Nazwa<input type="text" data-company="name"></label>
      <label class="of-row">Adres<input type="text" data-company="address"></label>
      <label class="of-row">NIP<input type="text" data-company="nip"></label>
      <label class="of-row">Telefon<input type="text" data-company="phone"></label>
      <label class="of-row">E-mail<input type="text" data-company="email"></label>
      <label class="of-row">WWW<input type="text" data-company="www"></label>
      <div class="of-hint">Logo w nagłówku to to samo logo co w trybie Prezentacji (Widok 3D → Prezentacja → „Wczytaj logo…”).</div>
    </details>
  `;
  container.appendChild(panel);

  const value = (el) => (el.type === 'number' ? Number(el.value) || 0 : el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? Number(el.value) : el.value);
  panel.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.set) handlers.onSettings({ [el.dataset.set]: value(el) });
    else if (el.dataset.client) handlers.onSettings({ client: { [el.dataset.client]: el.value } });
    else if (el.dataset.company) handlers.onCompany({ [el.dataset.company]: el.value });
  });
  panel.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.set && (el.type === 'checkbox' || el.tagName === 'SELECT')) handlers.onSettings({ [el.dataset.set]: value(el) });
    if (el.dataset.cat !== undefined) {
      const picked = [...panel.querySelectorAll('[data-cat]')].filter((c) => c.checked).map((c) => c.dataset.cat);
      handlers.onSettings({ separateCategories: picked });
    }
  });
  panel.querySelector('[data-of="generate"]').addEventListener('click', () => handlers.onGenerate());
  panel.querySelector('[data-of="suggest"]').addEventListener('click', () => handlers.onSuggestNumber());
  return panel;
}

/** Puts the stored values into the form fields (on start, after loading a project, after "Nadaj"). */
export function fillOfferForm(panel, settings, company) {
  for (const el of panel.querySelectorAll('[data-set]')) {
    const v = settings[el.dataset.set];
    if (el.type === 'checkbox') el.checked = v !== false;
    else el.value = v ?? '';
  }
  for (const el of panel.querySelectorAll('[data-client]')) el.value = settings.client?.[el.dataset.client] ?? '';
  for (const el of panel.querySelectorAll('[data-company]')) el.value = company?.[el.dataset.company] ?? '';
}

/** Refreshes the preview part only (lines, totals, warnings, category checkboxes). */
export function updateOfferPanel(panel, { offer, categories, settings }) {
  panel.querySelector('[data-of="warnings"]').innerHTML = offer.warnings.map((w) => `<div class="of-warn">⚠ ${esc(w)}</div>`).join('');
  const rows = offer.lines
    .map((l) => `<tr><td>${esc(l.label)}${l.detail ? `<div class="of-detail">${esc(l.detail)}</div>` : ''}</td><td class="num">${money(l.net)}</td></tr>`)
    .join('');
  panel.querySelector('[data-of="preview"]').innerHTML = offer.lines.length
    ? `<table class="of-table"><tbody>${rows}</tbody></table>
       <table class="of-table of-totals"><tbody>
         <tr><td>Razem netto</td><td class="num">${money(offer.totals.net)}</td></tr>
         <tr><td>VAT ${offer.totals.vatRatePct}%</td><td class="num">${money(offer.totals.vat)}</td></tr>
         <tr class="of-gross"><td>Razem brutto</td><td class="num">${money(offer.totals.gross)}</td></tr>
       </tbody></table>
       <div class="of-hint">Wewnętrznie: materiał ${money(offer.materialNet)} + CNC i projekt ${money(offer.cncProjectNet)} (niewidoczne dla Klienta).</div>`
    : '<div class="of-hint">Brak pozycji do wyceny.</div>';
  const cats = panel.querySelector('[data-of="categories"]');
  const key = categories.join('|');
  if (cats.dataset.key !== key) {
    cats.dataset.key = key;
    cats.innerHTML = categories.length
      ? categories.map((c) => `<label class="of-check"><input type="checkbox" data-cat="${esc(c)}"> ${esc(c.replace(' (z modelu)', ''))}</label>`).join('')
      : '<div class="of-hint">Brak wycenionych kategorii materiału.</div>';
  }
  for (const c of cats.querySelectorAll('[data-cat]')) c.checked = settings.separateCategories.includes(c.dataset.cat);
}
