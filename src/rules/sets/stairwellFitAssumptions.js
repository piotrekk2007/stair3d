// STAIRWELL FIT — the software choices behind src/geometry/stairwellFit.js ("Dopasuj do klatki"): how the
// tread going and the straight-tread counts are derived from the stairwell's side lengths. Labelled honestly as
// SOFTWARE_DESIGN_CHOICE — no published method prescribes this search; the only legal figure it leans on is the
// PL-LEGAL-A-01 2h+s band, referenced (not restated) below.

import { defineRuleSet } from '../schema.js';

export const stairwellFitAssumptions = defineRuleSet([
  {
    ruleId: 'STAIR3D-FIT-01',
    category: 'A',
    description:
      'Stairwell fit: the KEY side of the stair\'s outer line is met exactly by solving the (single) tread going; the other given sides are met as closely as the straight-tread counts allow. Among feasible variants the one with the smallest total deviation of the non-key sides is taken; 2h+s (PL-LEGAL-A-01) is informational only and merely breaks a tie between equally good variants (closest to 625 mm, the middle of the band).',
    condition: 'side(key) == target(key) ; minimise [sum|side_i - target_i|, |2h+s - 625| (tie-break only)] ; minRiser <= h <= maxRiser ; 180 <= s <= 320',
    configRefs: ['stairwellFitEnabled', 'stairwellSideAMm', 'stairwellSideBMm', 'stairwellSideCMm', 'stairwellKeySide', 'minRiser', 'maxRiser'],
    ruleType: 'SOFTWARE_DESIGN_CHOICE',
    jurisdiction: 'COMPANY',
    source:
      'Stair3D software choice. The 600–650 mm band is PL-LEGAL-A-01; its midpoint as a tie-break and the 180–320 mm going range (the UI slider range) are this software\'s own choices, not published figures.',
    severity: 'WARNING',
    blocksGeneration: false,
    status: 'ASSUMPTION',
    notes:
      'A side is measured on the outer line (outer face of the outer wanga = the wall line) from the first tread\'s front edge WITHOUT its nosing, which projects config.nosing further. The going must be constant in a flight, so with several given sides only the key one can be exact in general; a non-key side is reported (WARNING) with its deviation. The winder count, stair width and every other parameter stay the user\'s.',
  },
]);
