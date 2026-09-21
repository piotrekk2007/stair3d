// EDYTOR POZYCJI RĘCZNYCH kosztorysu (tralki, poręcze, dowolne inne): wiersze "nazwa | ilość |
// jednostka | cena | koszt". Czysto interakcyjny — edytuje `settings.manualItems` i woła
// onChange(); koszt wiersza liczy manualItems.js, doliczenie do sumy robi main.js.
import { MANUAL_UNITS, manualRowCost } from '../takeoff/manualItems.js';

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const fmt = (v) => v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param {HTMLElement} container
 * @param {{settings: {manualItems: {name:string, qty:number, unit:string, price:number}[]}, onChange: () => void}} opts
 * @returns {{render: () => void}}
 */
export function createManualItemsEditor(container, { settings, onChange }) {
  const root = document.createElement('div');
  root.className = 'tk-manual';
  container.appendChild(root);

  function costCell(row) {
    return `${fmt(manualRowCost(row))} zł`;
  }

  function render() {
    const rows = settings.manualItems
      .map(
        (r, i) => `
        <tr>
          <td><input type="text" value="${esc(r.name)}" data-i="${i}" data-field="name" /></td>
          <td><input type="number" step="any" min="0" value="${r.qty}" data-i="${i}" data-field="qty" /></td>
          <td><select data-i="${i}" data-field="unit">${MANUAL_UNITS.map((u) => `<option value="${u}" ${u === r.unit ? 'selected' : ''}>${u === 'mb' ? 'mb' : 'szt.'}</option>`).join('')}</select></td>
          <td><input type="number" step="any" min="0" value="${r.price}" data-i="${i}" data-field="price" /></td>
          <td class="tkm-cost" data-cost="${i}">${costCell(r)}</td>
          <td><button type="button" class="tk-x" data-action="del" data-i="${i}" title="Usuń pozycję">✕</button></td>
        </tr>`
      )
      .join('');
    root.innerHTML = `
      <div class="tkp-title">Pozycje ręczne <span class="tk-hint">— tralki, poręcze i inne (ilość i cena wpisywane przez Ciebie)</span></div>
      <table class="tkp-table">
        <thead><tr><th>Pozycja</th><th>Ilość</th><th>Jedn.</th><th>Cena zł/jedn.</th><th>Koszt</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tkp-actions"><button type="button" data-action="add">+ Dodaj pozycję</button></div>`;
  }

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.i === undefined || !el.dataset.field) return;
    const row = settings.manualItems[Number(el.dataset.i)];
    const field = el.dataset.field;
    if (field === 'name') row.name = el.value.trim() || row.name;
    else if (field === 'unit') row.unit = el.value;
    else row[field] = Math.max(0, Number(el.value) || 0);
    const cell = root.querySelector(`[data-cost="${el.dataset.i}"]`);
    if (cell) cell.textContent = costCell(row);
    onChange();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'add') settings.manualItems.push({ name: 'Nowa pozycja', qty: 0, unit: 'szt', price: 0 });
    else if (btn.dataset.action === 'del') settings.manualItems.splice(Number(btn.dataset.i), 1);
    render();
    onChange();
  });

  render();
  return { render };
}
