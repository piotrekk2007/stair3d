// Panel KOSZTORYSU (zakładka prawego panelu): renderuje wynik buildPricedMaterialTakeoff() —
// nic tu nie jest liczone poza agregacją z takeoffView.js. NET (gotowy element) i STOCK/
// ZAMÓWIENIE (surowiec do kupienia) są jawnie rozdzielone wizualnie. Koszt jest ZAWSZE
// oznaczony jako orientacyjny (ceny domyślne to placeholdery, patrz src/takeoff/pricing.js).
import { GROUP_BY, groupTakeoffItems, summarizeTakeoff, describeDimensions, elementLabelPl } from './takeoffView.js';
import { stateBadgeHTML } from './valueState.js';

const UNIT_LABEL = { m3: 'm³', m2: 'm²' };
const MEASURE_DIGITS = { m3: 4, m2: 3 };

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function measure(value, unit) {
  if (value === null || value === undefined || !unit) return '—';
  return `${value.toFixed(MEASURE_DIGITS[unit] ?? 3)} ${UNIT_LABEL[unit] ?? unit}`;
}

function money(value, currency) {
  return `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function shortId(item) {
  return item.sourceElementId;
}

function orderText(item) {
  const c = item.catalogStock;
  if (!c) return '<span class="tk-muted">— (bez rozmiaru katalogowego)</span>';
  if (c.unsupported) return `<span class="tk-warn">BRAK w katalogu — wymaga łączenia</span>`;
  const dims = [c.lengthMm && `dł. ${c.lengthMm}`, c.widthMm && `szer. ${c.widthMm}`, c.thicknessMm && `grub. ${c.thicknessMm}`].filter(Boolean).join(' × ');
  return `${dims} mm${c.exact ? '' : ' <span class="tk-muted">(zaokrąglone w górę)</span>'}`;
}

function itemHTML(item, index, selectedItemId) {
  const selected = item.itemId === selectedItemId ? ' selected' : '';
  const optional = item.optional ? ' <span class="tk-tag">opcjonalny</span>' : '';
  if (item.status !== 'OK') {
    return `
      <div class="tk-item invalid${selected}" data-item-index="${index}">
        <div class="tk-item-head"><code>${esc(shortId(item))}</code>${optional}<span class="tk-status">${esc(item.status)}</span></div>
        <div class="tk-warn">BRAK WYLICZONEJ ILOŚCI — ${esc((item.diagnostics[0]?.message) || 'geometria niepoprawna')}</div>
      </div>`;
  }
  const unit = item.wasteAdjustedUnit;
  const netMeasure = unit === 'm3' ? item.netVolume : item.netArea;
  const stockMeasure = unit === 'm3' ? item.stockVolume : item.stockArea;
  const cost = item.calculatedCost === null ? '<span class="tk-muted">niewyceniona</span>' : money(item.calculatedCost, item.currency);
  const notes = item.notes.length ? `<div class="tk-notes">${item.notes.map((n) => `<div>• ${esc(n)}</div>`).join('')}</div>` : '';
  return `
    <div class="tk-item${selected}" data-item-index="${index}">
      <div class="tk-item-head">
        <code>${esc(shortId(item))}</code>${optional}
        <span class="tk-qty">${item.quantity} ${esc(item.unit)}</span>
      </div>
      <div class="tk-material">${esc(item.material ?? '—')}</div>
      <div class="tk-cols">
        <div class="tk-col net">
          <div class="tk-col-title">NET — gotowy element</div>
          <div>${esc(describeDimensions(item.nominalDimensions)) || '—'}</div>
          <div>${measure(netMeasure, unit)}</div>
        </div>
        <div class="tk-col stock">
          <div class="tk-col-title">STOCK — surowiec do zakupu</div>
          <div>${esc(describeDimensions(item.calculatedDimensions)) || '—'}</div>
          <div>${measure(stockMeasure, unit)}</div>
          <div class="tk-order">Zamów: ${orderText(item)}</div>
        </div>
      </div>
      <div class="tk-foot">
        <span>odpad ${(item.wasteFactor * 100).toFixed(0)}% → ${measure(item.wasteAdjustedQuantity, unit)}</span>
        <span class="tk-cost">${cost}</span>
      </div>
      ${notes}
    </div>`;
}

function summaryHTML(summary, takeoff, settings) {
  const currency = takeoff.items.find((i) => i.currency)?.currency ?? 'PLN';
  const rows = summary.rows
    .map(
      (r) => `
      <tr>
        <td>${esc(r.material)}</td>
        <td>${measure(r.net, r.unit)}</td>
        <td>${measure(r.stock, r.unit)}</td>
        <td>${measure(r.withWaste, r.unit)}</td>
        <td>${money(r.cost, currency)}</td>
      </tr>`
    )
    .join('');

  const prices = (settings.priceList || []).map((p) => `${esc(p.materialId)}: ${p.price} ${esc(p.currency)}/${p.unit === 'volume' ? 'm³' : p.unit === 'area' ? 'm²' : 'szt.'}`).join('; ');
  const waste = Object.entries(settings.wasteFactors || {})
    .map(([type, f]) => `${esc(elementLabelPl(type))} ${(f * 100).toFixed(0)}%`)
    .join(', ');

  const caveats = [];
  if (summary.unpricedCount > 0) caveats.push(`${summary.unpricedCount} pozycji bez ceny w cenniku — nie wliczone do sumy.`);
  if (summary.invalidCount > 0) caveats.push(`${summary.invalidCount} pozycji bez wyliczonej ilości (INVALID/UNSUPPORTED) — nie wliczone do sumy.`);
  if (summary.optionalCount > 0) caveats.push(`Suma zawiera ${summary.optionalCount} pozycji opcjonalnych (np. klocki wangi nakładanej).`);

  return `
    <div class="tk-summary">
      <div class="tk-summary-title">Podsumowanie materiału ${stateBadgeHTML('auto')}</div>
      <table class="tk-summary-table">
        <thead><tr><th>Materiał</th><th>NET</th><th>STOCK</th><th>z odpadem</th><th>Koszt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tk-total">
        <span>Szacowany koszt materiału (orientacyjny)</span>
        <b>≈ ${money(summary.totalCost, currency)}</b>
      </div>
      <div class="tk-assumptions">
        <b>Założenia (nie jest to oferta handlowa):</b>
        <div>Ceny jednostkowe — ilustracyjne, do edycji w Parametry → Materiały: ${prices || 'brak'}.</div>
        <div>Współczynniki odpadu wg typu elementu: ${waste || 'domyślne'}.</div>
        <div>Koszt liczony od ilości STOCK z odpadem (nie od NET); bez robocizny, okuć, wykończenia i transportu.</div>
        ${caveats.map((c) => `<div class="tk-warn">${esc(c)}</div>`).join('')}
      </div>
    </div>`;
}

export function createTakeoffPanel(container, { onSelectItem, onGroupChange, onExportCSV, onExportTXT }) {
  const panel = document.createElement('div');
  panel.id = 'takeoff-panel';
  panel.innerHTML = `
    <div class="tk-toolbar">
      <label>Grupuj wg
        <select id="takeoff-group-by">
          <option value="${GROUP_BY.ELEMENT}">typu elementu</option>
          <option value="${GROUP_BY.MATERIAL}">materiału</option>
          <option value="${GROUP_BY.CONSTRUCTION}">typu konstrukcji</option>
        </select>
      </label>
      <button type="button" data-action="csv" title="Pobierz zestawienie jako CSV">CSV</button>
      <button type="button" data-action="txt" title="Pobierz raport tekstowy">Raport TXT</button>
    </div>
    <div id="takeoff-banner" hidden></div>
    <div id="takeoff-body"></div>
  `;
  container.appendChild(panel);

  panel._items = [];
  panel.querySelector('#takeoff-group-by').addEventListener('change', (e) => onGroupChange(e.target.value));
  panel.querySelector('[data-action="csv"]').addEventListener('click', () => onExportCSV());
  panel.querySelector('[data-action="txt"]').addEventListener('click', () => onExportTXT());
  panel.querySelector('#takeoff-body').addEventListener('click', (e) => {
    const el = e.target.closest('[data-item-index]');
    if (!el) return;
    const item = panel._items[Number(el.dataset.itemIndex)];
    if (item) onSelectItem(item);
  });
  return panel;
}

/**
 * @param {HTMLElement} panel
 * @param {import('../takeoff/index.js').MaterialTakeoffResult & {totalCost:number}} takeoff
 * @param {{groupBy?:string, selectedItemId?:string|null, priceList?:object[], wasteFactors?:object}} settings
 */
export function updateTakeoffPanel(panel, takeoff, settings = {}) {
  const { groupBy = GROUP_BY.ELEMENT, selectedItemId = null } = settings;
  const banner = panel.querySelector('#takeoff-banner');
  const body = panel.querySelector('#takeoff-body');
  panel.querySelector('#takeoff-group-by').value = groupBy;

  const csvBtn = panel.querySelector('[data-action="csv"]');
  const txtBtn = panel.querySelector('[data-action="txt"]');
  const blocked = takeoff.status === 'BLOCKED';
  csvBtn.disabled = blocked;
  txtBtn.disabled = blocked;

  if (blocked) {
    panel._items = [];
    banner.hidden = false;
    banner.className = 'error';
    const errors = takeoff.diagnostics.filter((d) => d.severity === 'ERROR');
    banner.innerHTML = `<b>Kosztorys zablokowany</b> — geometria ma ${errors.length} błędów walidacji, więc ilości nie są liczone (żeby nie pokazać mylącej liczby). Popraw błędy w zakładce Walidacja.`;
    body.innerHTML = '';
    return;
  }

  const warnings = takeoff.diagnostics.filter((d) => d.severity === 'WARNING');
  if (takeoff.status === 'WARNING') {
    banner.hidden = false;
    banner.className = 'warning';
    banner.innerHTML = `<b>Uwaga:</b> ${warnings.length} ostrzeżeń walidatora — ilości policzone, ale sprawdź zakładkę Walidacja przed użyciem w ofercie.`;
  } else {
    banner.hidden = true;
  }

  const summary = summarizeTakeoff(takeoff.items);
  const groups = groupTakeoffItems(takeoff.items, groupBy);
  const items = [];
  const groupsHTML = groups
    .map((g) => {
      const itemsHTML = g.items
        .map((item) => {
          items.push(item);
          return itemHTML(item, items.length - 1, selectedItemId);
        })
        .join('');
      return `<details class="tk-group" open><summary>${esc(g.key)} <span class="tk-count">${g.items.length}</span></summary>${itemsHTML}</details>`;
    })
    .join('');
  panel._items = items;
  body.innerHTML = summaryHTML(summary, takeoff, settings) + groupsHTML;
}

/** Przełącza .selected na wierszach kosztorysu bez przebudowy panelu (zachowuje scroll/<details>). */
export function markTakeoffSelection(panel, selectedItemId) {
  for (const el of panel.querySelectorAll('[data-item-index]')) {
    const item = panel._items[Number(el.dataset.itemIndex)];
    el.classList.toggle('selected', !!item && selectedItemId !== null && item.itemId === selectedItemId);
  }
}
