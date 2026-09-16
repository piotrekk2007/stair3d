// JSON export — the most direct serialization of MaterialTakeoffItem[]; no transformation,
// since the shape (src/takeoff/takeoffTypes.js) is already meant to be consumed
// programmatically.

/**
 * @param {import('../takeoffTypes.js').MaterialTakeoffItem[]} items
 * @param {{pretty?: boolean}} [options]
 * @returns {string}
 */
export function takeoffToJSON(items, options = {}) {
  const pretty = options.pretty !== false;
  return JSON.stringify(items, null, pretty ? 2 : 0);
}
