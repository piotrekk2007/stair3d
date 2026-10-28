// LED lighting (geometry/ledModel.js) -> MaterialTakeoffItem[]: per place (under the noses / in the wangi / under the
// handrail) the strip and its aluminium profile, each in running metres with the cut list (every piece's length), and
// the power supply (the strips' power + the reserve). Priced from the accessories (user decisions 2026-10-28): the strip
// and the profile per running metre (pricing.js `led-strip` / `led-profile`), the supply from the table by power
// (boardPricing.js ledSupplyPrices); a price of 0 leaves the item unpriced and flagged.

import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';

export const LED_STRIP_MATERIAL_ID = 'led-strip';
export const LED_PROFILE_MATERIAL_ID = 'led-profile';
export const LED_SUPPLY_MATERIAL_ID = 'led-power-supply';
const PLACE_PL = { tread: 'pod noskami stopni', stringer: 'w wangach', handrail: 'pod poręczą' };

export function buildLedItems(led) {
  if (!led?.strips?.length) return [];
  const { widthMm, depthMm } = led.profile;
  const items = [];
  for (const kind of ['tread', 'stringer', 'handrail']) {
    const strips = led.strips.filter((s) => s.kind === kind);
    if (!strips.length) continue;
    const total = strips.reduce((a, s) => a + s.lengthMm, 0);
    const cuts = strips.map((s) => Math.round(s.lengthMm));
    const metres = Math.round(total / 10) / 100;
    const line = (what, materialId, material, note) =>
      createTakeoffItem({
        itemId: `led-${kind}-${what}`,
        elementType: ELEMENT_TYPES.LED,
        sourceElementId: `led:${kind}:${what}`,
        material,
        materialId,
        quantity: metres,
        unit: 'mb',
        nominalDimensions: { lengthMm: total },
        calculatedDimensions: { lengthMm: total, widthMm, depthMm },
        catalogStock: null,
        netVolume: 0,
        netArea: 0,
        stockVolume: 0,
        stockArea: 0,
        wasteFactor: 0,
        optional: true,
        status: TAKEOFF_ITEM_STATUS.OK,
        notes: [note],
      });
    items.push(
      line('strip', LED_STRIP_MATERIAL_ID, `Taśma LED — ${PLACE_PL[kind]}`, `${strips.length} odc.: ${cuts.join(', ')} mm. Typ taśmy i moc do weryfikacji (ASSUMPTION).`),
      line('profile', LED_PROFILE_MATERIAL_ID, `Profil alu ${widthMm}×${depthMm} mm — ${PLACE_PL[kind]}`, `${strips.length} odc.: ${cuts.join(', ')} mm (frez ${widthMm} × ${depthMm} mm).`)
    );
  }
  items.push(
    createTakeoffItem({
      itemId: 'led-supply',
      elementType: ELEMENT_TYPES.LED,
      sourceElementId: 'led:supply',
      material: `Zasilacz LED ≥ ${Math.ceil(led.supplyW)} W`,
      materialId: LED_SUPPLY_MATERIAL_ID,
      quantity: 1,
      unit: 'szt',
      nominalDimensions: { powerW: led.powerW, supplyW: led.supplyW },
      calculatedDimensions: {},
      catalogStock: null,
      netVolume: 0,
      netArea: 0,
      stockVolume: 0,
      stockArea: 0,
      wasteFactor: 0,
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: [`Taśmy razem ${(led.totals.all / 1000).toFixed(2)} m, ${Math.round(led.powerW)} W + zapas = ${Math.ceil(led.supplyW)} W (ASSUMPTION: moc na metr z ustawień).`],
    })
  );
  return items;
}
