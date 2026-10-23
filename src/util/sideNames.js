// The names of the stair's two sides (the plan's `inner` / `outer` lines) in the UI, takeoff, DXF and offer — the one
// place that decides them (user decision 2026-10-23).
//
// An L / U keeps "zewn. / wewn." (outer / inner = dusza). An S has a dusza on EACH line (the first turn's on the inner
// line, the second's on the outer one — geometry/planLayout.js `duszaSide`), so there its sides are LEFT / RIGHT as
// seen walking up flight A: the inner line is on the side the first turn goes to.

const isS = (config) => config?.stairType === 'S';

/** 'left' | 'right' for an S's side, null for every other stair. */
export function sideHand(side, config) {
  if (!isS(config)) return null;
  const innerLeft = config.turnDirection === 'left';
  return (side === 'inner') === innerLeft ? 'left' : 'right';
}

/** The short adjective: "zewn." / "wewn." — an S: "lewa" / "prawa"; no side (the ceiling opening's balustrade): "przy otworze". */
export function sideShort(side, config) {
  if (side !== 'inner' && side !== 'outer') return 'przy otworze';
  const hand = sideHand(side, config);
  if (hand) return hand === 'left' ? 'lewa' : 'prawa';
  return side === 'outer' ? 'zewn.' : 'wewn.';
}

/** The full adjective: "zewnętrzna" / "wewnętrzna" — an S: "lewa" / "prawa". */
export function sideAdjective(side, config) {
  const hand = sideHand(side, config);
  if (hand) return hand === 'left' ? 'lewa' : 'prawa';
  return side === 'outer' ? 'zewnętrzna' : 'wewnętrzna';
}

/** "Wanga zewnętrzna" / "Wanga wewnętrzna (dusza)" — an S: "Wanga lewa" / "Wanga prawa". */
export function wangaName(side, config) {
  if (isS(config)) return `Wanga ${sideAdjective(side, config)}`;
  return side === 'outer' ? 'Wanga zewnętrzna' : 'Wanga wewnętrzna (dusza)';
}

/** "Wanga zewn." / "Wanga wewn." — an S: "Wanga lewa" / "Wanga prawa" (short labels: HUD layers, lists). */
export function wangaShortName(side, config) {
  return `Wanga ${sideShort(side, config)}`;
}

/** The genitive for "po stronie …": "zewnętrznej" / "wewnętrznej" — an S: "lewej" / "prawej". */
export function sideGenitive(side, config) {
  const hand = sideHand(side, config);
  if (hand) return hand === 'left' ? 'lewej' : 'prawej';
  return side === 'outer' ? 'zewnętrznej' : 'wewnętrznej';
}
