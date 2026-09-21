// Panel KOSZTORYSU (zakładka prawego panelu): renderuje wynik buildPricedMaterialTakeoff() —
// nic tu nie jest liczone poza agregacją z takeoffView.js. NET (gotowy element) i STOCK/
// ZAMÓWIENIE (surowiec do kupienia) są jawnie rozdzielone wizualnie. Koszt jest ZAWSZE
// oznaczony jako orientacyjny (ceny domyślne to placeholdery, patrz src/takeoff/pricing.js).
import { GROUP_BY, groupTakeoffItems, summarizeTakeoff, summarizeByCategory, describeDimensions, elementLabelPl } from './takeoffView.js';
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
  if (item.pricingSource === 'manual') {
    return `
      <div class="tk-item manual${selected}" data-item-index="${index}">
        <div class="tk-item-head"><b>${esc(item.material)}</b> <span class="tk-tag">wpisane ręcznie</span><span class="tk-qty">${item.quantity} ${esc(item.unit)} × ${money(item.unitPrice, item.currency)}</span></div>
        <div class="tk-foot"><span>${esc(item.unit === 'mb' ? 'cena za metr bieżący' : 'cena za sztukę')}</span><span class="tk-cost">${money(item.calculatedCost, item.currency)}</span></div>
      </div>`;
  }
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
  const cost = item.pricingSource === 'excluded' ? '<span class="tk-muted">poza kosztorysem</span>' : item.calculatedCost === null ? '<span class="tk-warn">niewyceniona</span>' : money(item.calculatedCost, item.currency);
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
        <span>${item.pricingSource === 'board-table' ? 'cena z cennika desek (odpad w cenie)' : item.pricingSource === 'post-table' ? 'cena z cennika słupów' : item.pricingSource === 'excluded' ? 'nie liczone w kosztorysie' : `odpad ${(item.wasteFactor * 100).toFixed(0)}% → ${measure(item.wasteAdjustedQuantity, unit)}`}</span>
        <span class="tk-cost">${cost}</span>
      </div>
      ${notes}
    </div>`;
}

function summaryHTML(summary, takeoff, settings) {
  const currency = takeoff.items.find((i) => i.currency)?.currency ?? 'PLN';
  const categories = summarizeByCategory(takeoff.items, { winderStepIds: settings.winderStepIds });

  const lines = categories.lines
    .map((l) => {
      const count = l.manual ? '' : ` <span class="tk-muted">(${l.count} szt.)</span>`;
      const warn = l.unpriced > 0 ? ` <span class="tk-warn" title="Pozycje bez ceny nie wchodzą do sumy">⚠ ${l.unpriced} bez ceny</span>` : '';
      return `<div class="tk-cat"><span>${esc(l.label)}${count}${warn}</span><b>${money(l.cost, currency)}</b></div>`;
    })
    .join('');

  const prices = (settings.priceList || [])
    .filter((p) => p.materialId === 'sheet-plywood-mdf')
    .map((p) => `${esc(p.materialId)}: ${p.price} ${esc(p.currency)}/m²`)
    .join('; ');
  const waste = Object.entries(settings.wasteFactors || {})
    .filter(([type]) => type === 'RISER')
    .map(([type, f]) => `${esc(elementLabelPl(type))} ${(f * 100).toFixed(0)}%`)
    .join(', ');

  const bp = settings.boardPricing;
  const boardLine = bp
    ? `<div>Stopnie, stopnie zabiegowe (wg formatek produkcyjnych, z noskiem), podesty${bp.riserMaterial === 'oak' ? ', podstopnie' : ''} i wangi: <b>cennik desek ${esc(bp.species)} ${esc(bp.cls)}</b> — zł za metr bieżący wg głębokości i długości formatki (metoda kalkulatora DREWEX); odpad jest w cenie. Wangi z dopłatą <b>+${bp.stringerSurchargePct ?? 0}%</b>.</div>
        <div>Słupy: cennik słupów wg przekroju. Klocki i wpusty wangi nie są liczone. Tralki i poręcze — wyłącznie pozycje wpisane ręcznie.</div>`
    : '';

  const caveats = [];
  const waivedCount = takeoff.waivedDiagnostics?.length ?? 0;
  if (waivedCount > 0) caveats.push(`Kosztorys policzony mimo ${waivedCount} zaakceptowanych wyjątków walidacji — nie oznacza to, że geometria jest poprawna.`);
  if (categories.unpricedCount > 0) caveats.push(`${categories.unpricedCount} pozycji bez ceny — nie wliczone do sumy (szczegóły przy pozycjach poniżej).`);
  if (summary.invalidCount > 0) caveats.push(`${summary.invalidCount} pozycji bez wyliczonej ilości (INVALID/UNSUPPORTED) — nie wliczone do sumy.`);

  return `
    <div class="tk-summary">
      <div class="tk-summary-title">Podsumowanie kosztu ${stateBadgeHTML('auto')}</div>
      <div class="tk-cats">${lines || '<div class="tk-muted">Brak pozycji do wyceny.</div>'}</div>
      <div class="tk-total">
        <span>Szacowany koszt materiału (orientacyjny)</span>
        <b>≈ ${money(categories.total, currency)}</b>
      </div>
      <div class="tk-assumptions">
        <b>Założenia (nie jest to oferta handlowa):</b>
        ${boardLine}
        ${bp && bp.riserMaterial === 'mdf' ? `<div>Podstopnie z płyty MDF — cena za m² (${prices || 'brak'}); odpad: ${waste || 'domyślny'}.</div>` : ''}
        <div>Koszt liczony od ilości STOCK (nie od NET). Kosztorys obejmuje wyłącznie materiał: stopnie, stopnie zabiegowe, podesty, podstopnie, wangi i słupy (plus pozycje ręczne) — bez robocizny, montażu, wykończenia i transportu.</div>
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
    <div id="takeoff-manual"></div>
    <div id="takeoff-pricing"></div>
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
    const errors = (takeoff.activeDiagnostics ?? takeoff.diagnostics).filter((d) => d.severity === 'ERROR');
    banner.innerHTML = `<b>Kosztorys zablokowany</b> — geometria ma ${errors.length} błędów walidacji, więc ilości nie są liczone (żeby nie pokazać mylącej liczby). Popraw je w zakładce Walidacja albo — jeśli świadomie je akceptujesz — użyj tam przycisku „Dodaj wyjątek".`;
    body.innerHTML = '';
    return;
  }

  const active = takeoff.activeDiagnostics ?? takeoff.diagnostics;
  const warnings = active.filter((d) => d.severity === 'WARNING');
  const waivedCount = takeoff.waivedDiagnostics?.length ?? 0;
  const messages = [];
  if (takeoff.status === 'WARNING') messages.push(`<b>Uwaga:</b> ${warnings.length} ostrzeżeń walidatora — ilości policzone, ale sprawdź zakładkę Walidacja przed użyciem w ofercie.`);
  if (waivedCount > 0) messages.push(`<b>Wyjątki:</b> kosztorys policzony mimo ${waivedCount} zaakceptowanych problemów walidacji (lista w zakładce Walidacja). Elementy z niepoprawną geometrią nadal są oznaczone jako niewyliczone.`);
  if (messages.length > 0) {
    banner.hidden = false;
    banner.className = 'warning';
    banner.innerHTML = messages.join('<br>');
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
