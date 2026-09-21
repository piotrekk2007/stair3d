// EDYTOR CENNIKA (sekcja na górze zakładki Kosztorys). Czysto interakcyjny: edytuje obiekt
// `settings` (patrz main.js `takeoffSettings`) i woła onChange() — przeliczenie kosztu robi
// warstwa takeoffu (boardPricing.js/pricing.js), tu nie ma żadnej wyceny.
//
//   settings.boardPricing  — cennik desek (metr bieżący wg głębokości i długości formatki) +
//                            gatunek/klasa + materiał podstopni
//                            + dopłata do wang + tabela cen słupów
//   settings.priceList     — już tylko podstopnie z płyty MDF (cena za m²)
//   settings.wasteFactors  — odpad płyty MDF (pozycje z cenników desek/słupów mają odpad w cenie)
import { createDefaultBoardPricing, parseBoardsCSV, boardsToCSV, RISER_MATERIALS, BOARD_THICKNESS_CLASSES_MM } from '../takeoff/boardPricing.js';
import { DEFAULT_PRICE_LIST } from '../takeoff/pricing.js';
import { DEFAULT_WASTE_FACTORS } from '../takeoff/wasteFactors.js';
import { DEFAULT_MATERIAL_CATALOG } from '../takeoff/materialCatalog.js';
import { downloadTextFile } from '../export/downloadTextFile.js';
import { elementLabelPl } from './takeoffView.js';

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const numInput = (attrs, value, extra = '') => `<input type="number" step="any" min="0" value="${value}" ${attrs} ${extra} />`;

/**
 * @param {HTMLElement} container
 * @param {{settings: object, onChange: () => void}} opts
 * @returns {{render: () => void}}
 */
export function createPricingEditor(container, { settings, onChange }) {
  const root = document.createElement('details');
  root.className = 'tk-pricing';
  container.appendChild(root);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,text/csv';
  fileInput.hidden = true;
  container.appendChild(fileInput);

  const bp = () => settings.boardPricing;

  function speciesList() {
    return [...new Set(bp().table.speciesMultipliers.map((m) => m.species))];
  }
  function classesFor(species) {
    return bp()
      .table.speciesMultipliers.filter((m) => m.species === species)
      .map((m) => m.cls);
  }

  function render() {
    const open = root.open;
    const p = bp();
    const species = speciesList();
    const classes = classesFor(p.species);
    const mult = p.table.speciesMultipliers.find((m) => m.species === p.species && m.cls === p.cls)?.multiplierPct;

    const boardRows = p.table.boards
      .map(
        (r, i) => `
        <tr>
          <td><select data-kind="board" data-i="${i}" data-field="thickness">${BOARD_THICKNESS_CLASSES_MM.map((t) => `<option value="${t}" ${t === r.thickness ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td>${numInput(`data-kind="board" data-i="${i}" data-field="depthMin"`, r.depthMin)}</td>
          <td>${numInput(`data-kind="board" data-i="${i}" data-field="depthMax"`, r.depthMax)}</td>
          <td>${numInput(`data-kind="board" data-i="${i}" data-field="priceTo1500"`, r.priceTo1500)}</td>
          <td>${numInput(`data-kind="board" data-i="${i}" data-field="price1501to2000"`, r.price1501to2000)}</td>
          <td>${numInput(`data-kind="board" data-i="${i}" data-field="priceOver2000"`, r.priceOver2000)}</td>
          <td><button type="button" class="tk-x" data-action="del-board" data-i="${i}" title="Usuń wiersz">✕</button></td>
        </tr>`
      )
      .join('');

    const multRows = p.table.speciesMultipliers
      .map(
        (m, i) => `
        <tr>
          <td><input type="text" value="${esc(m.species)}" data-kind="mult" data-i="${i}" data-field="species" /></td>
          <td><input type="text" value="${esc(m.cls)}" data-kind="mult" data-i="${i}" data-field="cls" /></td>
          <td>${numInput(`data-kind="mult" data-i="${i}" data-field="multiplierPct"`, m.multiplierPct)}</td>
          <td><button type="button" class="tk-x" data-action="del-mult" data-i="${i}" title="Usuń">✕</button></td>
        </tr>`
      )
      .join('');

    // Ogólny cennik dotyczy już tylko podstopni z płyty MDF (wangi i słupy mają własne cenniki).
    const postRows = (p.postPrices || [])
      .map(
        (r, i) => `
        <tr>
          <td>${numInput(`data-kind="post" data-i="${i}" data-field="sectionMm"`, r.sectionMm)}</td>
          <td>${numInput(`data-kind="post" data-i="${i}" data-field="price"`, r.price)}</td>
          <td><select data-kind="post" data-i="${i}" data-field="unit"><option value="szt" ${r.unit === 'szt' ? 'selected' : ''}>szt.</option><option value="mb" ${r.unit === 'mb' ? 'selected' : ''}>mb</option></select></td>
          <td><button type="button" class="tk-x" data-action="del-post" data-i="${i}" title="Usuń">✕</button></td>
        </tr>`
      )
      .join('');

    // Ogólny cennik dotyczy już tylko podstopni z płyty MDF (wangi i słupy mają własne cenniki).
    const priceRows = settings.priceList
      .filter((price) => price.materialId === 'sheet-plywood-mdf')
      .map((price) => {
        const label = DEFAULT_MATERIAL_CATALOG[price.materialId]?.label ?? price.materialId;
        const unit = price.unit === 'volume' ? 'zł/m³' : price.unit === 'area' ? 'zł/m²' : 'zł/szt.';
        return `<tr><td>${esc(label)}</td><td>${numInput(`data-kind="price" data-material="${esc(price.materialId)}"`, price.price)}</td><td>${unit}</td></tr>`;
      })
      .join('');

    const wasteRows = Object.keys(settings.wasteFactors)
      .filter((type) => type === 'RISER')
      .map((type) => `<tr><td>${esc(elementLabelPl(type))}</td><td>${numInput(`data-kind="waste" data-type="${esc(type)}"`, Math.round(settings.wasteFactors[type] * 1000) / 10)}</td><td>%</td></tr>`)
      .join('');

    root.innerHTML = `
      <summary>⚙ Cennik i materiały <span class="tk-hint">— gatunek: <b>${esc(p.species)} ${esc(p.cls)}</b>${mult !== undefined ? ` (${mult}% ceny bazowej)` : ''}</span></summary>
      <div class="tk-pricing-body">
        <div class="tkp-block">
          <div class="tkp-title">Materiał główny</div>
          <label>Gatunek <select data-kind="species">${species.map((s) => `<option ${s === p.species ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label>Klasa <select data-kind="cls">${classes.map((c) => `<option ${c === p.cls ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>Podstopnie <select data-kind="riser">
            <option value="${RISER_MATERIALS.OAK}" ${p.riserMaterial === RISER_MATERIALS.OAK ? 'selected' : ''}>z drewna (deska 20 mm z cennika)</option>
            <option value="${RISER_MATERIALS.MDF}" ${p.riserMaterial === RISER_MATERIALS.MDF ? 'selected' : ''}>z płyty MDF/sklejki (cena za m²)</option>
          </select></label>
        </div>

        <div class="tkp-block">
          <div class="tkp-title">Cennik desek — stopnie, podesty, podstopnie z drewna <span class="tk-hint">(zł za metr bieżący dla dębu klasy Natura)</span></div>
          <table class="tkp-table">
            <thead><tr><th>Grub. mm</th><th>Głęb. od</th><th>Głęb. do</th><th>dł. ≤1500</th><th>1501–2000</th><th>&gt;2000</th><th></th></tr></thead>
            <tbody>${boardRows}</tbody>
          </table>
          <div class="tkp-actions">
            <button type="button" data-action="add-board">+ Dodaj wiersz</button>
            <button type="button" data-action="csv-import" title="Format eksportu kalkulatora DREWEX: cennik-stopni-*.csv">Wczytaj CSV</button>
            <button type="button" data-action="csv-export">Pobierz CSV</button>
            <button type="button" data-action="reset-boards">Przywróć domyślne</button>
          </div>
          <div class="tk-hint">Grubość 20 = materiał 10–20 mm, 40 = 21–40 mm, 60 = 41–65 mm. Głębokość (przedział od–do) to szerokość deski/formatki; kolumna ceny zależy od jej długości. Wartości domyślne pochodzą z kalkulatora DREWEX i mogą różnić się od aktualnych cen — wczytaj aktualny cennik z pliku CSV.</div>
        </div>

        <div class="tkp-block">
          <div class="tkp-title">Wangi nośne <span class="tk-hint">(deska z cennika desek: grubość × szerokość wangi z parametrów × rzeczywista długość)</span></div>
          <label>Dopłata do ceny wangi [%] ${numInput('data-kind="surcharge"', p.stringerSurchargePct ?? 0)}</label>
        </div>

        <div class="tkp-block">
          <div class="tkp-title">Słupy <span class="tk-hint">(najmniejszy przekrój z tabeli, który jest ≥ przekroju słupa)</span></div>
          <table class="tkp-table">
            <thead><tr><th>Przekrój mm</th><th>Cena zł</th><th>za</th><th></th></tr></thead>
            <tbody>${postRows}</tbody>
          </table>
          <div class="tkp-actions"><button type="button" data-action="add-post">+ Dodaj przekrój</button></div>
        </div>

        <div class="tkp-block">
          <div class="tkp-title">Mnożniki gatunku i klasy <span class="tk-hint">(% ceny bazowej; brak wpisu = 100%)</span></div>
          <table class="tkp-table">
            <thead><tr><th>Gatunek</th><th>Klasa</th><th>%</th><th></th></tr></thead>
            <tbody>${multRows}</tbody>
          </table>
          <div class="tkp-actions"><button type="button" data-action="add-mult">+ Dodaj gatunek/klasę</button></div>
        </div>

        <div class="tkp-block">
          <div class="tkp-title">Podstopnie z płyty MDF/sklejki <span class="tk-hint">(tylko gdy wybrano płytę; cena ilustracyjna)</span></div>
          <table class="tkp-table"><tbody>${priceRows}</tbody></table>
        </div>

        <div class="tkp-block">
          <div class="tkp-title">Odpad płyty MDF <span class="tk-hint">(pozycje z cennika desek i słupów mają odpad w cenie)</span></div>
          <table class="tkp-table"><tbody>${wasteRows}</tbody></table>
        </div>
        <div class="tkp-actions"><button type="button" data-action="reset-all">Przywróć wszystkie domyślne ceny</button></div>
      </div>`;
    root.open = open;
  }

  // Zmiana wartości w polu (zdarzenie `change` — po zatwierdzeniu, nie przy każdym znaku).
  root.addEventListener('change', (e) => {
    const el = e.target;
    const kind = el.dataset.kind;
    if (!kind) return;
    const p = bp();
    if (kind === 'board') {
      const row = p.table.boards[Number(el.dataset.i)];
      const value = el.dataset.field === 'thickness' ? Number(el.value) : Math.max(0, Number(el.value) || 0);
      row[el.dataset.field] = value;
    } else if (kind === 'mult') {
      const row = p.table.speciesMultipliers[Number(el.dataset.i)];
      row[el.dataset.field] = el.dataset.field === 'multiplierPct' ? Math.max(0, Number(el.value) || 0) : el.value.trim();
      // Zmiana nazwy gatunku/klasy może rozjechać wybór — utrzymaj poprawny wybór.
      if (!p.table.speciesMultipliers.some((m) => m.species === p.species && m.cls === p.cls) && p.table.speciesMultipliers.length > 0) {
        p.species = p.table.speciesMultipliers[0].species;
        p.cls = p.table.speciesMultipliers[0].cls;
      }
      render();
    } else if (kind === 'species') {
      p.species = el.value;
      if (!classesFor(p.species).includes(p.cls)) p.cls = classesFor(p.species)[0] ?? p.cls;
      render();
    } else if (kind === 'cls') {
      p.cls = el.value;
      render();
    } else if (kind === 'riser') {
      p.riserMaterial = el.value;
    } else if (kind === 'surcharge') {
      p.stringerSurchargePct = Math.max(0, Number(el.value) || 0);
    } else if (kind === 'post') {
      const row = p.postPrices[Number(el.dataset.i)];
      row[el.dataset.field] = el.dataset.field === 'unit' ? el.value : Math.max(0, Number(el.value) || 0);
    } else if (kind === 'price') {
      const price = settings.priceList.find((x) => x.materialId === el.dataset.material);
      if (price) price.price = Math.max(0, Number(el.value) || 0);
    } else if (kind === 'waste') {
      settings.wasteFactors[el.dataset.type] = Math.min(1, Math.max(0, (Number(el.value) || 0) / 100));
    }
    onChange();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const p = bp();
    const action = btn.dataset.action;
    if (action === 'add-board') {
      const last = p.table.boards[p.table.boards.length - 1];
      p.table.boards.push(last ? { ...last, depthMin: last.depthMax, depthMax: last.depthMax + 60 } : { thickness: 40, depthMin: 240, depthMax: 300, priceTo1500: 0, price1501to2000: 0, priceOver2000: 0 });
    } else if (action === 'del-board') {
      p.table.boards.splice(Number(btn.dataset.i), 1);
    } else if (action === 'add-post') {
      const last = p.postPrices[p.postPrices.length - 1];
      p.postPrices.push({ sectionMm: last ? last.sectionMm + 20 : 100, price: 0, unit: last ? last.unit : 'szt' });
    } else if (action === 'del-post') {
      p.postPrices.splice(Number(btn.dataset.i), 1);
    } else if (action === 'add-mult') {
      p.table.speciesMultipliers.push({ species: 'Nowy gatunek', cls: 'Klasa Natura', multiplierPct: 100 });
    } else if (action === 'del-mult') {
      p.table.speciesMultipliers.splice(Number(btn.dataset.i), 1);
      if (!p.table.speciesMultipliers.some((m) => m.species === p.species && m.cls === p.cls) && p.table.speciesMultipliers.length > 0) {
        p.species = p.table.speciesMultipliers[0].species;
        p.cls = p.table.speciesMultipliers[0].cls;
      }
    } else if (action === 'csv-import') {
      fileInput.click();
      return;
    } else if (action === 'csv-export') {
      downloadTextFile(boardsToCSV(p.table.boards), 'cennik-desek.csv', 'text/csv');
      return;
    } else if (action === 'reset-boards') {
      if (!window.confirm('Przywrócić domyślny cennik desek z kalkulatora DREWEX? Twoje zmiany w tabeli zostaną utracone.')) return;
      p.table.boards = createDefaultBoardPricing().table.boards;
    } else if (action === 'reset-all') {
      if (!window.confirm('Przywrócić wszystkie domyślne ceny, mnożniki i odpady?')) return;
      settings.boardPricing = createDefaultBoardPricing();
      for (const price of settings.priceList) {
        const def = DEFAULT_PRICE_LIST.find((x) => x.materialId === price.materialId);
        if (def) Object.assign(price, def);
      }
      Object.assign(settings.wasteFactors, DEFAULT_WASTE_FACTORS);
    }
    render();
    onChange();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { boards, skipped } = parseBoardsCSV(reader.result);
      if (boards.length === 0) {
        window.alert('Nie znaleziono w pliku żadnych poprawnych wierszy cennika. Oczekiwany format: grubość_mm;głębokość_od_mm;głębokość_do_mm;cena_do_1500mb;cena_1501_2000mb;cena_pow_2000mb');
        return;
      }
      bp().table.boards = boards;
      render();
      onChange();
      if (skipped > 0) window.alert(`Wczytano ${boards.length} wierszy; pominięto ${skipped} niepoprawnych.`);
    };
    reader.readAsText(file, 'utf-8');
  });

  render();
  return { render };
}
