// A concrete floor counted into an offer (user request 2026-11-07): the other floor's own project FILE rebuilt and
// quoted with the given prices (the project the offer is made in — user decision: its price list; the labour from
// the floor's own file when the offering project has none, i.e. a self-supporting one), its facts and plan for the
// offer's technical page. Pure (the module's own pieces only).

import { parseCladdingProjectFile } from './projectFile.js';
import { buildCladdingStair } from './buildCladdingStair.js';
import { buildCladdingQuote } from './quote/claddingQuote.js';
import { buildCladdingOffer, claddingFacts, createDefaultCladdingOffer } from './quote/claddingOffer.js';
import { renderCladdingPlanSVG } from './claddingPlanRenderer.js';

/**
 * @param {Object} file  the floor's project file (as saved)
 * @param {{quoteSettings?: Object, priceList?: Array, boardPricing?: Object}} prices  the whole quote settings (a
 *   concrete project offering), or only the price list / board pricing (a self-supporting one — the labour then the file's)
 * @returns {{built, quote, facts, planSvg, lines}}  lines = the offer's „groups” lines (no discount, no extras)
 */
export function claddingFloorOfferPart(file, { quoteSettings = null, priceList = null, boardPricing = null } = {}) {
  const parsed = parseCladdingProjectFile(file);
  const built = buildCladdingStair({ ...parsed.config, referenceFloor: null });
  const qs = quoteSettings || { ...parsed.quote, ...(priceList ? { priceList } : {}), ...(boardPricing ? { boardPricing } : {}) };
  const quote = buildCladdingQuote(built, qs);
  const lines = buildCladdingOffer(quote, { ...createDefaultCladdingOffer(), mode: 'groups' }).lines.map((l) => ({ kind: 'extra', label: l.label, detail: l.detail || '', qty: null, unit: '', net: l.net }));
  return { built, quote, facts: claddingFacts(built, qs), planSvg: renderCladdingPlanSVG(built, { clientView: true }), lines };
}
