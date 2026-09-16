// Plain-text report — the human-readable rendering of MaterialTakeoffItem[], grouped into one
// block per item. This is the intended PDF export point: a PDF layer would take these same
// lines (or the same items, laid out in a table) and paginate/typeset them — no PDF library is
// wired in here (this project adds no new dependency without a concrete need — see
// .claude/RULES.md rule 11), but the content this function produces is exactly what a PDF
// renderer would consume, so adding one later is a rendering choice, not a re-design of the
// takeoff data.

/**
 * @param {import('../takeoffTypes.js').MaterialTakeoffItem[]} items
 * @param {{title?: string}} [options]
 * @returns {string}
 */
export function takeoffToTextReport(items, options = {}) {
  const title = options.title || 'Zestawienie materiałowe (Material Takeoff)';
  const lines = [title, '='.repeat(title.length), ''];

  for (const item of items) {
    lines.push(`${item.itemId} — ${item.elementType}${item.optional ? ' (opcjonalny)' : ''} [${item.status}]`);
    lines.push(`  Źródło: ${item.sourceElementId}`);
    lines.push(`  Ilość: ${item.quantity} ${item.unit}`);

    if (item.status !== 'OK') {
      lines.push(`  BRAK WYLICZONEJ ILOŚCI — patrz diagnostics.`);
      for (const d of item.diagnostics) lines.push(`    [${d.severity}] ${d.message}`);
    } else {
      if (item.netArea) lines.push(`  Powierzchnia (NET): ${item.netArea.toFixed(3)} m²${item.stockArea ? ` — STOCK: ${item.stockArea.toFixed(3)} m²` : ''}`);
      if (item.netVolume) lines.push(`  Objętość (NET): ${item.netVolume.toFixed(4)} m³${item.stockVolume ? ` — STOCK: ${item.stockVolume.toFixed(4)} m³` : ''}`);
      lines.push(`  Materiał: ${item.material}`);
      lines.push(`  Współczynnik odpadu: ${(item.wasteFactor * 100).toFixed(0)}%`);
      if (item.wasteAdjustedQuantity !== null) {
        lines.push(`  Do zakupu (z odpadem): ${item.wasteAdjustedQuantity.toFixed(4)} ${item.wasteAdjustedUnit}`);
      }
      if (item.calculatedCost !== null) {
        lines.push(`  Koszt: ${item.calculatedCost.toFixed(2)} ${item.currency}`);
      }
      for (const d of item.diagnostics) lines.push(`  [${d.severity}] ${d.message}`);
    }
    for (const note of item.notes) lines.push(`  Uwaga: ${note}`);
    lines.push('');
  }

  const priced = items.filter((i) => i.calculatedCost !== null);
  if (priced.length > 0) {
    const total = priced.reduce((sum, i) => sum + i.calculatedCost, 0);
    const currency = priced[0].currency;
    lines.push(`RAZEM (${priced.length}/${items.length} pozycji wycenionych): ${total.toFixed(2)} ${currency}`);
  }

  const unsupported = items.filter((i) => i.status !== 'OK');
  if (unsupported.length > 0) {
    lines.push(`UWAGA: ${unsupported.length} pozycji bez wyliczonej ilości (status != OK) — patrz szczegóły powyżej.`);
  }

  return lines.join('\n');
}
