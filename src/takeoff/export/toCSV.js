// CSV export — one row per TakeoffItem, a fixed, documented column set (so a spreadsheet/ERP
// import mapping stays stable across app versions even if TakeoffItem gains new fields later).

const DEFAULT_COLUMNS = Object.freeze([
  'itemId',
  'type',
  'subtype',
  'label',
  'quantity',
  'quantityUnit',
  'netArea',
  'grossArea',
  'wasteArea',
  'netVolume',
  'grossVolume',
  'wasteVolume',
  'wasteFactor',
  'material',
  'optional',
  'unitPrice',
  'priceUnit',
  'currency',
  'calculatedCost',
]);

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {import('../takeoffTypes.js').TakeoffItem[]} items
 * @param {string[]} [columns]  Defaults to DEFAULT_COLUMNS.
 * @returns {string}
 */
export function takeoffToCSV(items, columns = DEFAULT_COLUMNS) {
  const header = columns.join(',');
  const rows = items.map((item) => columns.map((c) => csvEscape(item[c])).join(','));
  return [header, ...rows].join('\n');
}
