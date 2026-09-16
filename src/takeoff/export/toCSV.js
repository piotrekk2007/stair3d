// CSV export — one row per MaterialTakeoffItem, per the suggested column set: Element, ID,
// Material, Quantity, Unit, Length, Width, Thickness, Net volume, Stock length, Stock width,
// Waste %, Cost, Notes. Length/Width/Thickness/Stock length/Stock width are read from
// `calculatedDimensions` (STOCK) — the shape varies slightly by elementType (see
// materialTakeoff.js), so this file only reads the keys that are actually present rather than
// assuming one fixed dimension shape for every element type.

const HEADER = ['Element', 'ID', 'Material', 'Quantity', 'Unit', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Net volume (m3)', 'Net area (m2)', 'Stock length (mm)', 'Stock width (mm)', 'Waste %', 'Status', 'Cost', 'Currency', 'Notes'];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dim(dims, key) {
  return dims && dims[key] !== undefined ? dims[key] : '';
}

function rowFor(item) {
  const nominal = item.nominalDimensions || {};
  const stock = item.calculatedDimensions || {};
  return [
    item.elementType,
    item.itemId,
    item.material,
    item.quantity,
    item.unit,
    dim(nominal, 'lengthMm'),
    dim(nominal, 'widthMm') || dim(nominal, 'boardWidthMm'),
    dim(nominal, 'thicknessMm'),
    item.netVolume,
    item.netArea,
    dim(stock, 'lengthMm'),
    dim(stock, 'widthMm') || dim(stock, 'boardWidthMm'),
    Math.round(item.wasteFactor * 1000) / 10,
    item.status,
    item.calculatedCost,
    item.currency,
    item.notes.join(' | '),
  ];
}

/**
 * @param {import('../takeoffTypes.js').MaterialTakeoffItem[]} items
 * @returns {string}
 */
export function takeoffToCSV(items) {
  const rows = items.map((item) => rowFor(item).map(csvEscape).join(','));
  return [HEADER.join(','), ...rows].join('\n');
}
