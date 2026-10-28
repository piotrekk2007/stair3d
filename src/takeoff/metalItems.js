// Steel of a metal stair (geometry/metalStructureModel.js) -> MaterialTakeoffItem[]. Derived ONLY from the model's
// members — the same beams, supports and toothed flat bars the 3D view and the DXF draw. Priced per kg from the
// accessories (user decision 2026-10-28, pricing.js `steel-structure`; `calculatedDimensions.massKg` = the item's WHOLE
// mass; 0 = unpriced and flagged). No timber volume, so the self-weight ignores it.

import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';
import { wasteFactorFor } from './wasteFactors.js';

export const STEEL_MATERIAL_ID = 'steel-structure';
const ROW_LABELS = { outer: 'strona zewn.', inner: 'strona wewn.', centre: 'środek biegu' };
const kg = (v) => `${v.toFixed(1).replace('.', ',')} kg`;
const UNVERIFIED = 'Przekroje i masa orientacyjne, do weryfikacji (CO-MFG-J-METAL).';

function item(fields, wasteFactors) {
  return createTakeoffItem({
    elementType: ELEMENT_TYPES.STEEL,
    materialId: STEEL_MATERIAL_ID,
    unit: 'szt',
    catalogStock: null,
    netVolume: 0,
    netArea: 0,
    stockVolume: 0,
    stockArea: 0,
    wasteFactor: wasteFactorFor(ELEMENT_TYPES.STEEL, STEEL_MATERIAL_ID, wasteFactors),
    optional: true,
    status: TAKEOFF_ITEM_STATUS.OK,
    ...fields,
  });
}

export function buildMetalItems(metalStructure, config, wasteFactors = {}) {
  if (!metalStructure) return [];
  const out = [];
  for (const m of metalStructure.members) {
    if (m.kind === 'beam') {
      const { widthMm, heightMm, wallMm } = m.section;
      const dims = { lengthMm: Math.round(m.lengthMm), widthMm, heightMm, massKg: m.massKg };
      out.push(
        item(
          {
            itemId: m.id,
            sourceElementId: `metal:${m.id}`,
            material: `Profil stalowy zamknięty ${heightMm} × ${widthMm} × ${wallMm}`,
            quantity: 1,
            nominalDimensions: dims,
            calculatedDimensions: dims,
            notes: [`Belka (${ROW_LABELS[m.side] || m.side}), odcinek ${m.pieceIndex + 1}: długość ${Math.round(m.lengthMm)} mm, nachylenie ${m.slopeDeg.toFixed(1).replace('.', ',')}°, ok. ${kg(m.massKg)}. ${UNVERIFIED}`],
          },
          wasteFactors
        )
      );
    } else if (m.kind === 'plate') {
      const dims = { lengthMm: Math.round(m.blank.lengthMm), widthMm: Math.round(m.blank.heightMm), thicknessMm: m.thicknessMm, massKg: m.massKg };
      out.push(
        item(
          {
            itemId: m.id,
            sourceElementId: `metal:${m.id}`,
            material: `Blacha stalowa ${m.thicknessMm} mm — płaskownik wycinany w zęby`,
            quantity: 1,
            nominalDimensions: dims,
            calculatedDimensions: dims,
            notes: [`Płaskownik (${ROW_LABELS[m.side] || m.side}), odcinek ${m.pieceIndex + 1}: arkusz ${dims.lengthMm} × ${dims.widthMm} mm, powierzchnia wycięta ${(m.areaMm2 / 1e6).toFixed(3).replace('.', ',')} m², ok. ${kg(m.massKg)}. ${UNVERIFIED}`],
          },
          wasteFactors
        )
      );
    }
  }
  // the supports of one beam row: one line, quantity = supports (each: a plate under the tread + its web)
  for (const row of metalStructure.rows) {
    const plates = metalStructure.members.filter((m) => m.rowId === row.id && m.kind === 'support-plate');
    if (plates.length === 0) continue;
    const webs = metalStructure.members.filter((m) => m.rowId === row.id && m.kind === 'support-web');
    const massKg = [...plates, ...webs].reduce((s, m) => s + m.massKg, 0);
    const p = metalStructure.params;
    const dims = { widthMm: p.supportPlateWidthMm, thicknessMm: p.supportPlateThicknessMm, massKg };
    out.push(
      item(
        {
          itemId: `${row.id}-supports`,
          sourceElementId: `metal:${row.id}-supports`,
          material: `Podpora stopnia: blacha ${p.supportPlateThicknessMm} mm + wspornik z profilu`,
          quantity: plates.length,
          nominalDimensions: dims,
          calculatedDimensions: dims,
          notes: [`Podpory stopni na belce (${ROW_LABELS[row.side] || row.side}): ${plates.length} szt, blachy ${Math.round(Math.min(...plates.map((x) => x.lengthMm)))}–${Math.round(Math.max(...plates.map((x) => x.lengthMm)))} × ${p.supportPlateWidthMm} mm, wsporniki do ${Math.round(Math.max(0, ...webs.map((x) => x.heightMm)))} mm wysokości, razem ok. ${kg(massKg)}. ${UNVERIFIED}`],
        },
        wasteFactors
      )
    );
  }
  return out;
}
