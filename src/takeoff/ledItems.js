// LED lighting (geometry/ledModel.js) -> MaterialTakeoffItem[]: per place (under the noses / in the wangi / under the
// handrail) the strip in its aluminium profile in running metres with the cut list (every piece's length), and the
// power supply (the strips' power + the reserve). UNPRICED like the connectors — no price entry exists for these
// material ids, so the cost stays null and the summary / offer flag it; a price can be added as a manual row.

import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';

export const LED_STRIP_MATERIAL_ID = 'led-strip-profile';
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
    items.push(
      createTakeoffItem({
        itemId: `led-${kind}`,
        elementType: ELEMENT_TYPES.LED,
        sourceElementId: `led:${kind}`,
        material: `Taśma LED w profilu alu ${widthMm}×${depthMm} mm — ${PLACE_PL[kind]}`,
        materialId: LED_STRIP_MATERIAL_ID,
        quantity: Math.round(total / 10) / 100,
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
        notes: [`${strips.length} odc.: ${cuts.join(', ')} mm (frez ${widthMm} × ${depthMm} mm). Bez ceny — typ taśmy, profil i moc do weryfikacji (ASSUMPTION).`],
      })
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
      nominalDimensions: { powerW: led.powerW },
      calculatedDimensions: {},
      catalogStock: null,
      netVolume: 0,
      netArea: 0,
      stockVolume: 0,
      stockArea: 0,
      wasteFactor: 0,
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: [`Taśmy razem ${(led.totals.all / 1000).toFixed(2)} m, ${Math.round(led.powerW)} W + zapas. Bez ceny (ASSUMPTION: moc na metr z ustawień).`],
    })
  );
  return items;
}
