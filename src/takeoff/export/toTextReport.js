// Plain-text report — the human-readable rendering of TakeoffItem[], grouped into one block per
// item. This is the intended PDF export point: a PDF layer would take these same lines (or the
// same items, laid out in a table) and paginate/typeset them — no PDF library is wired in here
// (this project adds no new dependency without a concrete need — see .claude/RULES.md rule 11),
// but the content this function produces is exactly what a PDF renderer would consume, so
// adding one later is a rendering choice, not a re-design of the takeoff data.

/**
 * @param {import('../takeoffTypes.js').TakeoffItem[]} items
 * @param {{title?: string}} [options]
 * @returns {string}
 */
export function takeoffToTextReport(items, options = {}) {
  const title = options.title || 'Zestawienie materiałowe (Material Takeoff)';
  const lines = [title, '='.repeat(title.length), ''];

  for (const item of items) {
    lines.push(`${item.label}${item.optional ? ' (opcjonalny)' : ''}`);
    lines.push(`  Ilość: ${item.quantity} ${item.quantityUnit}`);
    if (item.netArea > 0) {
      lines.push(`  Powierzchnia: ${item.netArea.toFixed(2)} m² (z zapasem: ${item.grossArea.toFixed(2)} m², odpad: ${item.wasteArea.toFixed(2)} m²)`);
    }
    if (item.netVolume > 0) {
      lines.push(`  Objętość: ${item.netVolume.toFixed(3)} m³ (z zapasem: ${item.grossVolume.toFixed(3)} m³, odpad: ${item.wasteVolume.toFixed(3)} m³)`);
    }
    lines.push(`  Materiał: ${item.material}`);
    lines.push(`  Współczynnik zapasu/odpadu: ${(item.wasteFactor * 100).toFixed(0)}%`);
    if (item.calculatedCost !== null) {
      lines.push(`  Koszt: ${item.calculatedCost.toFixed(2)} ${item.currency}`);
    }
    lines.push('');
  }

  const priced = items.filter((i) => i.calculatedCost !== null);
  if (priced.length > 0) {
    const total = priced.reduce((sum, i) => sum + i.calculatedCost, 0);
    const currency = priced[0].currency;
    lines.push(`RAZEM (${priced.length}/${items.length} pozycji wycenionych): ${total.toFixed(2)} ${currency}`);
  }

  return lines.join('\n');
}
