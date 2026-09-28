// Joint connectors (stair bolts, joints stage 4) -> MaterialTakeoffItem[]. Derived ONLY from the joint model's
// `connectors` (geometry/jointConnectors.js) — the same bolts the DXF drills holes for. One item per joint, `quantity`
// = its bolts (they all have the joint's one length). Deliberately UNPRICED ("bez ceny", user decision 2026-09-28):
// no price entry exists for `joint-connector`, so pricing.js leaves the cost null and the summary flags it — never a
// guessed price. No timber volume (hardware), so the self-weight ignores it.

import { createTakeoffItem, ELEMENT_TYPES, TAKEOFF_ITEM_STATUS } from './takeoffTypes.js';
import { wasteFactorFor } from './wasteFactors.js';

export const JOINT_CONNECTOR_MATERIAL_ID = 'joint-connector';

export function buildConnectorItems(jointModel, config, wasteFactors = {}) {
  const byJoint = new Map();
  for (const c of jointModel?.connectors || []) {
    if (!byJoint.has(c.jointId)) byJoint.set(c.jointId, []);
    byJoint.get(c.jointId).push(c);
  }
  return [...byJoint].map(([jointId, bolts]) => {
    const { diameterMm, lengthMm, kind } = bolts[0];
    const len = Math.round(lengthMm);
    const where =
      kind === 'stringer-post'
        ? `wanga ${bolts[0].segmentId} w słupie ${bolts[0].postId} — ${bolts[0].throughPost ? 'przez cały słup (podkładka/zaślepka po drugiej stronie)' : 'ślepo w słup'}`
        : `wanga ${bolts[0].segmentId} doczołowo do wangi ${bolts[0].intoSegmentId} — przez wangę ${bolts[0].intoSegmentId}`;
    return createTakeoffItem({
      itemId: `connector-${jointId.replace(/[^A-Za-z0-9-]+/g, '-')}`,
      elementType: ELEMENT_TYPES.CONNECTOR,
      sourceElementId: `connector:${jointId}`,
      material: `Śruba schodowa M${diameterMm} × ${len}`,
      materialId: JOINT_CONNECTOR_MATERIAL_ID,
      quantity: bolts.length,
      unit: 'szt',
      nominalDimensions: { lengthMm: len, diameterMm },
      calculatedDimensions: { lengthMm: len, diameterMm },
      catalogStock: null,
      netVolume: 0,
      netArea: 0,
      stockVolume: 0,
      stockArea: 0,
      wasteFactor: wasteFactorFor(ELEMENT_TYPES.CONNECTOR, JOINT_CONNECTOR_MATERIAL_ID, wasteFactors),
      optional: true,
      status: TAKEOFF_ITEM_STATUS.OK,
      notes: [`Łącznik złącza: ${where}; długość = cała oś otworu do gniazda nakrętki. Bez ceny — wymiary i typ śruby do weryfikacji (CO-MFG-J-CONNECTORS).`],
    });
  });
}
