// Czyste funkcje widoku kosztorysu: grupowanie i sumowanie JUŻ POLICZONYCH pozycji Material
// Takeoff (src/takeoff/index.js). Żadnej geometrii ani wyceny — tylko agregacja tego, co
// buildPricedMaterialTakeoff() zwróciło. Zero DOM, testowalne przez node:test.

export const GROUP_BY = Object.freeze({ ELEMENT: 'element', MATERIAL: 'material', CONSTRUCTION: 'construction' });

const ELEMENT_LABEL_PL = {
  TREAD: 'Stopnie',
  LANDING: 'Podesty',
  RISER: 'Podstopnie',
  STRINGER: 'Wangi',
  STRINGER_HOUSING: 'Wpusty wangi (informacyjnie)',
  POST: 'Słupy',
  SUPPORT: 'Podpory',
  OTHER: 'Inne',
};
const CONSTRUCTION_LABEL_PL = { cut: 'Wanga nakładana (cut)', closed: 'Wanga wpuszczana (closed)' };

export function elementLabelPl(elementType) {
  return ELEMENT_LABEL_PL[elementType] || elementType;
}

function groupKey(item, groupBy) {
  if (groupBy === GROUP_BY.MATERIAL) return item.material || '(bez materiału)';
  if (groupBy === GROUP_BY.CONSTRUCTION) return CONSTRUCTION_LABEL_PL[item.constructionType] || 'Konstrukcja wspólna / nie dotyczy';
  return elementLabelPl(item.elementType);
}

/**
 * @returns {{key:string, items:object[]}[]}  grupy w kolejności pierwszego wystąpienia
 */
export function groupTakeoffItems(items, groupBy = GROUP_BY.ELEMENT) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(item, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([key, groupItems]) => ({ key, items: groupItems }));
}

// Pozycje "nie do kupienia" (wpusty — materiał USUWANY, nie kupowany) nie wchodzą do sum
// zamówienia; INVALID/UNSUPPORTED są liczone osobno jako "bez wyliczenia".
function isPurchasable(item) {
  // pricingSource 'excluded' = poza zakresem kosztorysu (klocki, wpusty) — nie wchodzi do sum.
  return item.status === 'OK' && item.pricingSource !== 'excluded' && item.materialId !== null && item.wasteAdjustedQuantity !== null;
}

/**
 * Podsumowanie zbiorcze (sekcja 12 specyfikacji). Sumy per (materiał, jednostka):
 * netto (NET), zapotrzebowanie surowca (STOCK), z odpadem, koszt — plus liczniki pozycji, których
 * nie da się wycenić/wyliczyć, żeby suma nigdy nie udawała pełnej.
 */
export function summarizeTakeoff(items) {
  const byMaterial = new Map();
  let unpricedCount = 0;
  let invalidCount = 0;
  let optionalCount = 0;

  for (const item of items) {
    if (item.status !== 'OK') {
      invalidCount++;
      continue;
    }
    if (!isPurchasable(item)) continue;
    if (item.optional) optionalCount++;
    if (item.calculatedCost === null) unpricedCount++;

    const unit = item.wasteAdjustedUnit; // 'm3' | 'm2'
    const key = `${item.materialId}|${unit}`;
    if (!byMaterial.has(key)) {
      byMaterial.set(key, { materialId: item.materialId, material: item.material, unit, net: 0, stock: 0, withWaste: 0, cost: 0, count: 0 });
    }
    const row = byMaterial.get(key);
    const netMeasure = unit === 'm3' ? item.netVolume : item.netArea;
    const stockMeasure = unit === 'm3' ? item.stockVolume : item.stockArea;
    row.net += (netMeasure || 0) * item.quantity;
    row.stock += (stockMeasure || 0) * item.quantity;
    row.withWaste += item.wasteAdjustedQuantity * item.quantity;
    row.cost += item.calculatedCost || 0;
    row.count += item.quantity;
  }

  const rows = [...byMaterial.values()];
  const totalCost = Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  return { rows, totalCost, unpricedCount, invalidCount, optionalCount };
}

/** Skrócony opis wymiarów NET/STOCK — klucze zależą od typu elementu (patrz materialTakeoff.js). */
export function describeDimensions(d) {
  if (!d) return '';
  const parts = [];
  const mm = (v) => `${Math.round(v)}`;
  if (d.lengthMm !== undefined) parts.push(`dł. ${mm(d.lengthMm)}`);
  if (d.widthMm !== undefined) parts.push(`szer. ${mm(d.widthMm)}`);
  if (d.boardWidthMm !== undefined) parts.push(`szer. ${mm(d.boardWidthMm)}`);
  if (d.heightMm !== undefined) parts.push(`wys. ${mm(d.heightMm)}`);
  if (d.depthMm !== undefined) parts.push(`gł. ${mm(d.depthMm)}`);
  if (d.crossSectionMm !== undefined) parts.push(`przekrój ${mm(d.crossSectionMm)}×${mm(d.crossSectionMm)}`);
  if (d.thicknessMm !== undefined) parts.push(`grub. ${mm(d.thicknessMm)}`);
  if (d.panelCount !== undefined && d.panelCount > 1) parts.push(`${d.panelCount} panele`);
  const text = parts.join(' × ');
  const areaMm2 = d.footprintAreaMm2 ?? d.netAreaMm2;
  const area = areaMm2 !== undefined ? `pow. ${(areaMm2 / 1e6).toFixed(3)} m²` : '';
  if (!text) return area;
  return `${text} mm${area ? ` · ${area}` : ''}`;
}

const CATEGORY_ORDER = ['Stopnie', 'Stopnie zabiegowe', 'Podesty', 'Podstopnie', 'Wangi', 'Słupy'];

function categoryOf(item, winderStepIds) {
  if (item.pricingSource === 'manual') return item.material; // nazwa wpisana przez użytkownika
  switch (item.elementType) {
    case 'TREAD':
      return winderStepIds?.has(item.sourceElementId.replace(/^tread:/, '')) ? 'Stopnie zabiegowe' : 'Stopnie';
    case 'LANDING':
      return 'Podesty';
    case 'RISER':
      return 'Podstopnie';
    case 'STRINGER':
      return 'Wangi';
    case 'POST':
      return 'Słupy';
    default:
      return null; // wpusty — poza kosztorysem
  }
}

/**
 * Podsumowanie kosztu wg kategorii: "Stopnie: … zł; Podstopnie: … zł; Wangi: … zł; …". Kategorie
 * w stałej kolejności (stopnie, zabiegowe, podesty, podstopnie, wangi, słupy), potem pozycje ręczne
 * w kolejności wpisania; pusta kategoria się nie pokazuje. Pozycje poza kosztorysem (klocki,
 * wpusty) są pomijane. Pozycja bez ceny nie wchodzi do sumy, ale jest liczona w `unpriced`, żeby
 * suma nigdy nie udawała pełnej.
 *
 * @param {object[]} items
 * @param {{winderStepIds?: Set<string>}} [options]  ID stopni zabiegowych ('step-7'), żeby je wydzielić
 * @returns {{lines: {label:string, count:number, cost:number, unpriced:number, manual:boolean}[], total:number, unpricedCount:number}}
 */
export function summarizeByCategory(items, { winderStepIds } = {}) {
  const byLabel = new Map();
  for (const item of items) {
    if (item.status !== 'OK' || item.pricingSource === 'excluded') continue;
    const label = categoryOf(item, winderStepIds);
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, { label, count: 0, cost: 0, unpriced: 0, manual: item.pricingSource === 'manual' });
    const line = byLabel.get(label);
    line.count += item.quantity;
    if (item.calculatedCost === null) line.unpriced += 1;
    else line.cost += item.calculatedCost;
  }
  const known = CATEGORY_ORDER.filter((l) => byLabel.has(l)).map((l) => byLabel.get(l));
  const manual = [...byLabel.values()].filter((l) => !CATEGORY_ORDER.includes(l.label));
  const lines = [...known, ...manual].map((l) => ({ ...l, cost: Math.round(l.cost * 100) / 100 }));
  const total = Math.round(lines.reduce((s, l) => s + l.cost, 0) * 100) / 100;
  return { lines, total, unpricedCount: lines.reduce((s, l) => s + l.unpriced, 0) };
}
