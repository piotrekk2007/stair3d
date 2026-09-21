// POZYCJE RĘCZNE kosztorysu — to, czego model nie wylicza z geometrii, a co sprzedawca chce
// wpisać sam: tralki (ilość × cena za sztukę), poręcze (metry bieżące × cena za mb) i dowolne
// inne. To dane WEJŚCIOWE użytkownika (zapisywane w pliku projektu razem z ustawieniami wyceny),
// nie wynik obliczeń: nic tu nie jest wyliczane z geometrii ani zgadywane.
import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';

export const MANUAL_UNITS = Object.freeze(['szt', 'mb']);
export const MANUAL_PRICING_SOURCE = 'manual';

const round2 = (v) => Math.round(v * 100) / 100;

/** Świeża, mutowalna lista domyślnych pozycji: tralki i poręcze (puste, więc bez wpływu na sumę). */
export function createDefaultManualItems() {
  return [
    { name: 'Tralki', qty: 0, unit: 'szt', price: 0 },
    { name: 'Poręcze', qty: 0, unit: 'mb', price: 0 },
  ];
}

/** Odporny odczyt z pliku projektu: odrzuca wpisy bez nazwy, poprawia jednostkę i wartości ujemne. */
export function sanitizeManualItems(value) {
  if (!Array.isArray(value)) return createDefaultManualItems();
  return value
    .filter((r) => r && typeof r.name === 'string' && r.name.trim().length > 0)
    .map((r) => ({
      name: r.name.trim(),
      qty: Number.isFinite(r.qty) && r.qty > 0 ? r.qty : 0,
      unit: MANUAL_UNITS.includes(r.unit) ? r.unit : 'szt',
      price: Number.isFinite(r.price) && r.price > 0 ? r.price : 0,
    }));
}

/** Koszt jednej pozycji ręcznej (ilość × cena jednostkowa). */
export function manualRowCost(row) {
  return round2((Number(row.qty) || 0) * (Number(row.price) || 0));
}

/**
 * Pozycje ręczne → MaterialTakeoffItem[] (żeby trafiły do listy, sum i eksportów tak samo jak
 * reszta). Pomija wiersze bez ilości albo bez ceny — puste domyślne wiersze niczego nie dodają.
 */
export function manualItemsToTakeoffItems(rows) {
  const items = [];
  rows.forEach((row, i) => {
    if (!(row.qty > 0) || !(row.price > 0)) return;
    const item = createTakeoffItem({
      itemId: `manual-${i}`,
      elementType: ELEMENT_TYPES.OTHER,
      sourceElementId: `manual:${i}`,
      material: row.name,
      materialId: 'manual',
      quantity: row.qty,
      unit: row.unit,
      nominalDimensions: {},
      calculatedDimensions: {},
      wasteFactor: 0,
      optional: false,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: ['Pozycja wpisana ręcznie (ilość i cena podane przez użytkownika).'],
    });
    items.push({
      ...item,
      pricingSource: MANUAL_PRICING_SOURCE,
      unitPrice: row.price,
      priceUnit: row.unit,
      currency: 'PLN',
      calculatedCost: manualRowCost(row),
    });
  });
  return items;
}

/**
 * Dokłada pozycje ręczne do wyniku takeoffu. Zablokowany takeoff (BLOCKED) zostaje nietknięty —
 * nie pokazujemy żadnej sumy z niepoprawnej geometrii, także częściowej.
 */
export function applyManualItems(takeoff, rows) {
  if (takeoff.status === 'BLOCKED') return takeoff;
  const manual = manualItemsToTakeoffItems(rows);
  if (manual.length === 0) return takeoff;
  const manualTotal = manual.reduce((sum, i) => sum + i.calculatedCost, 0);
  return { ...takeoff, items: [...takeoff.items, ...manual], totalCost: round2((takeoff.totalCost || 0) + manualTotal) };
}
