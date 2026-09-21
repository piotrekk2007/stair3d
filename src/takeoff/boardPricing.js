// CENNIK DESEK (metr bieżący wg głębokości i długości) — port metody wyceny elementów prostych
// z kalkulatora DREWEX (WordPress: staircost-calculator, includes/class-calculator.php,
// board_price_for_depth / find_board_price / pick_length_tier). To WARSTWA CENOWA takeoffu:
// czyta gotowe pozycje (STOCK = formatka do zakupu) i tylko dolicza koszt z tabeli cennikowej —
// nic tu nie liczy geometrii i nie zmienia ilości.
//
// Jak wycenia się element prosty (stopień, podest, podstopień z drewna):
//   1. Formatka ma DŁUGOŚĆ (bieg deski — dla stopnia jego szerokość w poprzek biegu) i GŁĘBOKOŚĆ
//      (szerokość deski — dla stopnia głębokość + nosek).
//   2. Grubość → klasa cennika: 20 mm (materiał 10–20), 40 mm (21–40), 60 mm (41–65).
//   3. GŁĘBOKOŚĆ wybiera wiersz tabeli (przedziały np. 240–300, 300–360, 360–420 mm; przedział
//      dolnie włącznie, górnie wyłącznie; poza przedziałami — najbliższy wg środka przedziału).
//   4. DŁUGOŚĆ wybiera kolumnę ceny: do 1500 / 1501–2000 / powyżej 2000 mm.
//   5. Cena wiersza jest ZA METR BIEŻĄCY, dla Dębu klasy Natura (baza 100%); inny gatunek/klasa =
//      mnożnik procentowy. Koszt elementu = cena/mb × długość[m].
//   6. Głębokość większa niż największy przedział = element sklejany z kilku desek: liczy się
//      sumę PEŁNYCH cen/mb każdego kawałka (kawałek węższy niż najmniejszy przedział, np. reszta,
//      jest liczony jak najwyższy przedział — tak samo jak w kalkulatorze DREWEX).
// Cena z tabeli dotyczy formatki (surowca do zakupu), więc odpad jest już w cenniku — dla pozycji
// wycenionych tą metodą współczynnik odpadu NIE jest doliczany drugi raz.
//
// ZAKRES KOSZTORYSU (decyzja użytkownika): liczony jest wyłącznie MATERIAŁ elementów nośnych i
// wykończeniowych — stopnie, stopnie zabiegowe, podesty, podstopnie (jeśli są), wangi nośne i
// słupy. Nic więcej (klocki, wpusty, montaż, wykończenie, okucia) nie wchodzi do kosztu.
//   - WANGA = deska z TEGO SAMEGO cennika (np. 40 × 330 × 2660 mm: grubość, głębokość = szerokość
//     deski z parametrów, długość = jej rzeczywista długość) + stała dopłata procentowa (domyślnie
//     +20%).
//   - STOPIEŃ ZABIEGOWY = jego formatka produkcyjna (TreadModel.winderBlank — ta sama, którą
//     pokazuje plan 2D), cena jak każdej deski z cennika.
//   - SŁUP = osobna tabela cen wg przekroju (cena za sztukę albo za metr bieżący) — nie ma go w
//     cenniku desek.

import { ELEMENT_TYPES } from './takeoffTypes.js';

export const BOARD_THICKNESS_CLASSES_MM = Object.freeze([20, 40, 60]);
export const BOARD_PRICING_SOURCE = 'board-table';
export const RISER_MATERIALS = Object.freeze({ OAK: 'oak', MDF: 'mdf' });

const DEFAULT_BOARDS = [
  // Grubość 20 mm (materiał 10–20 mm)
  { thickness: 20, depthMin: 240, depthMax: 300, priceTo1500: 220, price1501to2000: 300, priceOver2000: 420 },
  { thickness: 20, depthMin: 300, depthMax: 360, priceTo1500: 260, price1501to2000: 360, priceOver2000: 500 },
  { thickness: 20, depthMin: 360, depthMax: 420, priceTo1500: 300, price1501to2000: 415, priceOver2000: 580 },
  // Grubość 40 mm (materiał 21–40 mm)
  { thickness: 40, depthMin: 240, depthMax: 300, priceTo1500: 320, price1501to2000: 440, priceOver2000: 600 },
  { thickness: 40, depthMin: 300, depthMax: 360, priceTo1500: 380, price1501to2000: 520, priceOver2000: 720 },
  { thickness: 40, depthMin: 360, depthMax: 420, priceTo1500: 440, price1501to2000: 600, priceOver2000: 840 },
  // Grubość 60 mm (materiał 41–65 mm)
  { thickness: 60, depthMin: 240, depthMax: 300, priceTo1500: 440, price1501to2000: 610, priceOver2000: 850 },
  { thickness: 60, depthMin: 300, depthMax: 360, priceTo1500: 520, price1501to2000: 720, priceOver2000: 1000 },
  { thickness: 60, depthMin: 360, depthMax: 420, priceTo1500: 600, price1501to2000: 830, priceOver2000: 1160 },
];

// % ceny bazowej (Dąb, Klasa Natura = 100).
const DEFAULT_MULTIPLIERS = [
  { species: 'Dąb', cls: 'Klasa Natura', multiplierPct: 100 },
  { species: 'Dąb', cls: 'Klasa Loft', multiplierPct: 85 },
  { species: 'Jesion', cls: 'Klasa Natura', multiplierPct: 90 },
  { species: 'Jesion', cls: 'Klasa Loft', multiplierPct: 78 },
];

/**
 * Świeża, MUTOWALNA kopia domyślnego cennika + wyborów (dąb, Klasa Natura, podstopnie z dębu).
 * Wartości domyślne pochodzą z kalkulatora DREWEX (class-installer.php) i mogą różnić się od cen
 * faktycznie obowiązujących — prawdziwy cennik wczytuje się z pliku CSV (parseBoardsCSV).
 */
export function createDefaultBoardPricing() {
  return {
    species: 'Dąb',
    cls: 'Klasa Natura',
    riserMaterial: RISER_MATERIALS.OAK,
    stringerSurchargePct: 20, // dopłata do ceny wangi względem ceny deski z cennika
    // Słupy: najmniejszy przekrój z tabeli, który jest >= przekroju słupa. Wartości domyślne to
    // pozycje "Drewniany 80×80/100×100" z cennika DREWEX (cena za sztukę) + 110×110 = 200 zł/mb;
    // słup o większym przekroju zostaje niewyceniony, dopóki nie dopiszesz dla niego wiersza.
    postPrices: [
      { sectionMm: 80, price: 120, unit: 'szt' },
      { sectionMm: 100, price: 160, unit: 'szt' },
      { sectionMm: 110, price: 200, unit: 'mb' }, // słup 110×110 — cena podana przez użytkownika
    ],
    table: {
      boards: DEFAULT_BOARDS.map((r) => ({ ...r })),
      speciesMultipliers: DEFAULT_MULTIPLIERS.map((r) => ({ ...r })),
    },
  };
}

// --- Klasyfikacja i kolumny ---------------------------------------------------------------------

/** Grubość materiału (mm) → klasa cennika 20/40/60; null gdy grubsze niż 65 mm. */
export function thicknessClassFor(thicknessMm) {
  if (!(thicknessMm > 0)) return null;
  if (thicknessMm <= 20) return 20;
  if (thicknessMm <= 40) return 40;
  if (thicknessMm <= 65) return 60;
  return null;
}

export function lengthTierFor(lengthMm) {
  if (lengthMm <= 1500) return { key: 'priceTo1500', label: 'do 1500 mm' };
  if (lengthMm <= 2000) return { key: 'price1501to2000', label: '1501–2000 mm' };
  return { key: 'priceOver2000', label: 'powyżej 2000 mm' };
}

function multiplierPct(table, species, cls) {
  const row = (table.speciesMultipliers || []).find((r) => r.species === species && r.cls === cls);
  return row ? Number(row.multiplierPct) : 100; // brak wpisu = cena bazowa (jak w DREWEX)
}

const round4 = (v) => Math.round(v * 10000) / 10000;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Cena za metr bieżący deski o zadanej głębokości i długości.
 * @returns {{ok:true, pricePerMb:number, thicknessClass:number, multiplierPct:number, tier:{key,label},
 *   chunks:{depthMm:number, rangeLabel:string, basePerMb:number}[], viaNearestRange:boolean}
 *   | {ok:false, reason:string}}
 */
export function lookupBoardPricePerMb(table, { species, cls, thicknessMm, depthMm, lengthMm }) {
  const thicknessClass = thicknessClassFor(thicknessMm);
  if (thicknessClass === null) {
    return { ok: false, reason: `Grubość ${Math.round(thicknessMm)} mm jest poza zakresem cennika desek (do 65 mm).` };
  }
  const rows = (table.boards || []).filter((r) => r.thickness === thicknessClass);
  if (rows.length === 0) return { ok: false, reason: `W cenniku nie ma wierszy dla grubości ${thicknessClass} mm.` };
  if (!(depthMm > 0) || !(lengthMm > 0)) return { ok: false, reason: 'Brak poprawnych wymiarów formatki (głębokość/długość).' };

  const tier = lengthTierFor(lengthMm);
  const pct = multiplierPct(table, species, cls);
  const sorted = [...rows].sort((a, b) => a.depthMin - b.depthMin);
  const maxDepth = Math.max(...sorted.map((r) => r.depthMax));
  const label = (r) => `${r.depthMin}–${r.depthMax} mm`;

  if (depthMm <= maxDepth) {
    let row = rows.find((r) => depthMm >= r.depthMin && depthMm < r.depthMax);
    let viaNearestRange = false;
    if (!row) {
      // Poza przedziałami (np. podstopień węższy niż najmniejszy przedział albo dokładnie górna
      // granica) — najbliższy wg środka przedziału, jak w kalkulatorze DREWEX.
      viaNearestRange = true;
      let best = Infinity;
      for (const r of rows) {
        const diff = Math.abs(depthMm - (r.depthMin + r.depthMax) / 2);
        if (diff < best) {
          best = diff;
          row = r;
        }
      }
    }
    const base = Number(row[tier.key]) || 0;
    return { ok: true, pricePerMb: round4((base * pct) / 100), thicknessClass, multiplierPct: pct, tier, chunks: [{ depthMm, rangeLabel: label(row), basePerMb: base }], viaNearestRange };
  }

  // Głębokość większa niż największy przedział: element sklejany z kilku desek.
  const chunks = [];
  let remaining = depthMm;
  let total = 0;
  const top = sorted[sorted.length - 1];
  while (remaining > 1e-9) {
    const chunkDepth = Math.min(remaining, maxDepth);
    const row = sorted.find((r) => chunkDepth >= r.depthMin && chunkDepth < r.depthMax) ?? top;
    const base = Number(row[tier.key]) || 0;
    total += base;
    chunks.push({ depthMm: chunkDepth, rangeLabel: label(row), basePerMb: base });
    remaining -= chunkDepth;
  }
  return { ok: true, pricePerMb: round4((total * pct) / 100), thicknessClass, multiplierPct: pct, tier, chunks, viaNearestRange: false };
}

// --- Wycena pozycji takeoffu -------------------------------------------------------------------------

export function boardMaterialId(species, cls) {
  const slug = (s) =>
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `board-${slug(species)}-${slug(cls)}`;
}

const fmtPln = (v) => v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Formatka elementu → { lengthMm, depthMm, thicknessMm } albo null, gdy element nie jest deską z cennika.
function boardBlankOf(item, riserMaterial) {
  const c = item.calculatedDimensions || {};
  if (item.elementType === ELEMENT_TYPES.TREAD || item.elementType === ELEMENT_TYPES.LANDING) {
    if (!(c.lengthMm > 0) || !(c.widthMm > 0)) return null;
    // Deska biegnie wzdłuż dłuższego boku formatki (stopień prosty: szerokość biegu; stopień
    // zabiegowy: dłuższy bok jego formatki produkcyjnej), głębokość to krótszy bok.
    return { lengthMm: Math.max(c.lengthMm, c.widthMm), depthMm: Math.min(c.lengthMm, c.widthMm), thicknessMm: c.thicknessMm };
  }
  if (item.elementType === ELEMENT_TYPES.STRINGER) {
    // Wanga: deska o zadanej szerokości (parametr wangi, np. 330 mm) i rzeczywistej długości.
    if (!(c.lengthMm > 0) || !(c.boardWidthMm > 0)) return null;
    return { lengthMm: c.lengthMm, depthMm: c.boardWidthMm, thicknessMm: c.thicknessMm };
  }
  if (item.elementType === ELEMENT_TYPES.RISER && riserMaterial === RISER_MATERIALS.OAK) {
    if (!(c.totalWidthMm > 0) || !(c.heightMm > 0)) return null;
    return { lengthMm: c.totalWidthMm, depthMm: c.heightMm, thicknessMm: c.thicknessMm };
  }
  return null;
}

function describeBreakdown(pricing, blank, lookup, cost, quantity, surchargePct) {
  const parts = [`${pricing.species} ${pricing.cls} (${lookup.multiplierPct}% ceny bazowej)`];
  parts.push(`grubość ${Math.round(blank.thicknessMm)} mm → klasa ${lookup.thicknessClass} mm`);
  parts.push(`formatka dł. ${Math.round(blank.lengthMm)} × głęb. ${Math.round(blank.depthMm)} mm`);
  if (lookup.chunks.length > 1) {
    parts.push(`głębokość przekracza największy przedział — sklejane z ${lookup.chunks.length} desek (${lookup.chunks.map((c) => Math.round(c.depthMm)).join(' + ')} mm)`);
  } else {
    parts.push(`przedział głęb. ${lookup.chunks[0].rangeLabel}${lookup.viaNearestRange ? ' (najbliższy)' : ''}`);
  }
  parts.push(`dł. ${lookup.tier.label}`);
  if (surchargePct) parts.push(`dopłata wangi +${surchargePct}%`);
  const qty = quantity > 1 ? ` × ${quantity} szt.` : '';
  const factor = surchargePct ? ` × ${(1 + surchargePct / 100).toFixed(2).replace('.', ',')}` : '';
  parts.push(`${fmtPln(lookup.pricePerMb)} zł/mb × ${(blank.lengthMm / 1000).toFixed(3).replace('.', ',')} m${qty}${factor} = ${fmtPln(cost)} zł`);
  return `Cennik desek: ${parts.join(' · ')}`;
}

export const EXCLUDED_PRICING_SOURCE = 'excluded';
export const POST_PRICING_SOURCE = 'post-table';

function excludedItem(item) {
  return {
    ...item,
    pricingSource: EXCLUDED_PRICING_SOURCE,
    calculatedCost: null,
    notes: [...item.notes, 'Poza zakresem kosztorysu — liczony jest tylko materiał: stopnie, stopnie zabiegowe, podesty, podstopnie, wangi i słupy.'],
  };
}

function pricePost(item, pricing) {
  const c = item.calculatedDimensions || {};
  const size = c.crossSectionMm;
  const rows = [...(pricing.postPrices || [])].sort((a, b) => a.sectionMm - b.sectionMm);
  const row = rows.find((r) => r.sectionMm >= size - 1e-6);
  // catalogStock: null — katalog rozmiarów (C24, ilustracyjny) nie dotyczy pozycji wycenianych z cennika.
  const base = { ...item, material: 'Słup · cennik słupów', materialId: 'post-table', pricingSource: POST_PRICING_SOURCE, wasteFactor: 0, catalogStock: null };
  if (!row) {
    return { ...base, notes: [...item.notes, `Brak ceny słupa ${Math.round(size)}×${Math.round(size)} mm — w cenniku słupów nie ma przekroju >= ${Math.round(size)} mm; dopisz wiersz w „Cennik i materiały".`] };
  }
  const perMb = row.unit === 'mb';
  const cost = round2(perMb ? row.price * (c.heightMm / 1000) * item.quantity : row.price * item.quantity);
  const how = perMb ? `${fmtPln(row.price)} zł/mb × ${(c.heightMm / 1000).toFixed(3).replace('.', ',')} m` : `${fmtPln(row.price)} zł/szt.`;
  return {
    ...base,
    wasteAdjustedQuantity: item.wasteAdjustedUnit === 'm3' ? item.stockVolume : item.stockArea,
    unitPrice: row.price,
    priceUnit: perMb ? 'mb' : 'szt',
    currency: 'PLN',
    calculatedCost: cost,
    priceBreakdown: { sectionMm: row.sectionMm, price: row.price, unit: row.unit },
    notes: [...item.notes, `Cennik słupów: przekrój słupa ${Math.round(size)}×${Math.round(size)} mm → wiersz ${row.sectionMm}×${row.sectionMm} mm · ${how}${item.quantity > 1 ? ` × ${item.quantity} szt.` : ''} = ${fmtPln(cost)} zł`],
  };
}

/**
 * Wycenia MATERIAŁ: stopnie, stopnie zabiegowe, podesty, podstopnie z drewna, wangi (z cennika desek
 * + dopłata) i słupy (z tabeli słupów). Klocki i wpusty wangi są poza zakresem (oznaczone
 * `pricingSource: 'excluded'`, bez kosztu). Pozostałe pozycje zwraca bez zmian (np. podstopnie z
 * płyty — wycenia je dopiero applyPricing()). Zwraca NOWE pozycje. Pozycji, której nie da się
 * wycenić (np. grubość > 65 mm, brak wiersza dla słupa), NIE wycenia się "na oko" — zostaje
 * niewyceniona z wyjaśnieniem w notatkach.
 *
 * @param {import('./takeoffTypes.js').MaterialTakeoffItem[]} items
 * @param {ReturnType<typeof createDefaultBoardPricing>} pricing
 */
export function applyBoardPricing(items, pricing) {
  return items.map((item) => {
    if (item.elementType === ELEMENT_TYPES.STRINGER_CLEAT || item.elementType === ELEMENT_TYPES.STRINGER_HOUSING) return excludedItem(item);
    if (item.status !== 'OK') return item;
    if (item.elementType === ELEMENT_TYPES.POST) return pricePost(item, pricing);
    const blank = boardBlankOf(item, pricing.riserMaterial);
    if (!blank) return item;

    const material = `${pricing.species} · ${pricing.cls}`;
    const base = { ...item, material, materialId: boardMaterialId(pricing.species, pricing.cls), pricingSource: BOARD_PRICING_SOURCE, catalogStock: null };
    const lookup = lookupBoardPricePerMb(pricing.table, { species: pricing.species, cls: pricing.cls, thicknessMm: blank.thicknessMm, depthMm: blank.depthMm, lengthMm: blank.lengthMm });
    if (!lookup.ok) {
      return { ...base, priceBreakdown: null, notes: [...item.notes, `Brak ceny z cennika desek: ${lookup.reason}`] };
    }

    const surchargePct = item.elementType === ELEMENT_TYPES.STRINGER ? Number(pricing.stringerSurchargePct) || 0 : 0;
    const factor = 1 + surchargePct / 100;
    const cost = round2(lookup.pricePerMb * (blank.lengthMm / 1000) * item.quantity * factor);
    const stockMeasure = item.wasteAdjustedUnit === 'm3' ? item.stockVolume : item.stockArea;
    return {
      ...base,
      // Cena dotyczy formatki (surowca), odpad jest w cenniku — bez drugiego doliczania.
      wasteFactor: 0,
      wasteAdjustedQuantity: stockMeasure,
      unitPrice: round4(lookup.pricePerMb * factor),
      priceUnit: 'mb',
      currency: 'PLN',
      calculatedCost: cost,
      priceBreakdown: { pricePerMb: lookup.pricePerMb, surchargePct, lengthMm: blank.lengthMm, depthMm: blank.depthMm, thicknessClass: lookup.thicknessClass, chunks: lookup.chunks },
      notes: [...item.notes, describeBreakdown(pricing, blank, lookup, cost, item.quantity, surchargePct)],
    };
  });
}

// --- CSV (format eksportu kalkulatora DREWEX: cennik-stopni-*.csv) ------------------------------------------

const CSV_HEADER = 'grubość_mm;głębokość_od_mm;głębokość_do_mm;cena_do_1500mb;cena_1501_2000mb;cena_pow_2000mb';

const num = (s) => Number(String(s).trim().replace(',', '.'));

/**
 * Wczytuje wiersze cennika z CSV tak jak import w kalkulatorze DREWEX: separator ; lub ,
 * (wykrywany), nagłówek pomijany, przecinek dziesiętny dozwolony, grubość spoza 20/40/60 → 40.
 * @returns {{boards: object[], skipped: number}}
 */
export function parseBoardsCSV(text) {
  const boards = [];
  let skipped = 0;
  let headerHandled = false;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const delim = line.includes(';') ? ';' : ',';
    const cols = line.split(delim);
    if (!headerHandled) {
      headerHandled = true;
      if (Number.isNaN(num(cols[0]))) continue; // nagłówek
    }
    if (cols.length < 6) {
      skipped++;
      continue;
    }
    const values = cols.slice(0, 6).map(num);
    if (values.some((v) => Number.isNaN(v))) {
      skipped++;
      continue;
    }
    const thickness = BOARD_THICKNESS_CLASSES_MM.includes(Math.trunc(values[0])) ? Math.trunc(values[0]) : 40;
    boards.push({
      thickness,
      depthMin: Math.max(0, Math.trunc(values[1])),
      depthMax: Math.max(1, Math.trunc(values[2])),
      priceTo1500: Math.max(0, values[3]),
      price1501to2000: Math.max(0, values[4]),
      priceOver2000: Math.max(0, values[5]),
    });
  }
  return { boards, skipped };
}

export function boardsToCSV(boards) {
  const rows = boards.map((r) => [r.thickness, r.depthMin, r.depthMax, r.priceTo1500, r.price1501to2000, r.priceOver2000].map((v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v)).join(';'));
  return `﻿${CSV_HEADER}\n${rows.join('\n')}\n`;
}

// --- Odczyt z pliku projektu -----------------------------------------------------------------------------

/** Odporny odczyt ustawień z pliku (ręcznie edytowany plik nie może wywrócić aplikacji). */
export function sanitizeBoardPricing(value) {
  const fresh = createDefaultBoardPricing();
  if (!value || typeof value !== 'object') return fresh;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const boards = Array.isArray(value.table?.boards)
    ? value.table.boards
        .filter((r) => r && BOARD_THICKNESS_CLASSES_MM.includes(r.thickness) && isNum(r.depthMin) && isNum(r.depthMax) && isNum(r.priceTo1500) && isNum(r.price1501to2000) && isNum(r.priceOver2000))
        .map((r) => ({ thickness: r.thickness, depthMin: r.depthMin, depthMax: r.depthMax, priceTo1500: r.priceTo1500, price1501to2000: r.price1501to2000, priceOver2000: r.priceOver2000 }))
    : [];
  const multipliers = Array.isArray(value.table?.speciesMultipliers)
    ? value.table.speciesMultipliers.filter((r) => r && typeof r.species === 'string' && typeof r.cls === 'string' && isNum(r.multiplierPct)).map((r) => ({ species: r.species, cls: r.cls, multiplierPct: r.multiplierPct }))
    : [];
  const postPrices = Array.isArray(value.postPrices)
    ? value.postPrices.filter((r) => r && isNum(r.sectionMm) && r.sectionMm > 0 && isNum(r.price) && r.price >= 0 && (r.unit === 'szt' || r.unit === 'mb')).map((r) => ({ sectionMm: r.sectionMm, price: r.price, unit: r.unit }))
    : null;
  return {
    stringerSurchargePct: isNum(value.stringerSurchargePct) && value.stringerSurchargePct >= 0 ? value.stringerSurchargePct : fresh.stringerSurchargePct,
    postPrices: postPrices ?? fresh.postPrices,
    species: typeof value.species === 'string' ? value.species : fresh.species,
    cls: typeof value.cls === 'string' ? value.cls : fresh.cls,
    riserMaterial: Object.values(RISER_MATERIALS).includes(value.riserMaterial) ? value.riserMaterial : fresh.riserMaterial,
    table: {
      boards: boards.length > 0 ? boards : fresh.table.boards,
      speciesMultipliers: multipliers.length > 0 ? multipliers : fresh.table.speciesMultipliers,
    },
  };
}
