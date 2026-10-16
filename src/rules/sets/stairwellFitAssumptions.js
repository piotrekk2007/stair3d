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
    condition: 'side(key) == target(key) ; 150 <= s <= 320 ; prefer in this order: every other side within one going of its target ; minRiser <= h <= maxRiser ; (riser in range) min sum|side_i - target_i| then |2h+s - 625| ; (riser out of range: reported as WARNING) |2h+s - 625| then the deviation ; stairwellManualCounts: counts are set by the user, only s is solved',
    configRefs: ['stairwellFitEnabled', 'stairwellSideAMm', 'stairwellSideBMm', 'stairwellSideCMm', 'stairwellKeySide', 'stairwellManualCounts', 'minRiser', 'maxRiser'],
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
  {
    ruleId: 'STAIR3D-WELL-01',
    category: 'A',
    description:
      "Stairwell designer (room first, src/designer/stairwellVariants.js): a SHORT variant list decided by rules - the PROJECT's stair type and turn; the FIXED sides as targets (key = the fixed exit side, else the first fixed), the FREE sides' counts chosen for the riser; the user's width, narrowed only when the room or the exit edge needs it (10 mm steps; to the exact width a two-turn U needs for its wall-to-wall side), below 800 mm (PL-LEGAL-A-05*) only a WARNING, below 500 mm dropped; winders n-1, n, n+1 around n = round(walkline arc / going) + 1, at least 3 per 90 degree turn; one landing variant; a U as one 180 degree zone when its axis gap is 0..300 mm, else two turns. Sorted: fitting the room and exit, riser in range, distinct rules in error, ceiling collisions, |2h+s - 625|.",
    condition: 'key fixed side exact ; other fixed sides as close as the counts allow (U: B exact by the axis gap / the width) ; free sides: counts for the riser ; width in [500, stairWidth], < 800 warned ; U one zone when 0 <= axisGap <= 300 (and as one more variant above)',
    configRefs: ['stairwellRoomEnabled', 'stairwellSideAMm', 'stairwellSideBMm', 'stairwellSideCMm', 'stairwellSideAFixed', 'stairwellSideBFixed', 'stairwellSideCFixed', 'stairWidth', 'walklineOffset', 'treadGoing'],
    ruleType: 'SOFTWARE_DESIGN_CHOICE',
    jurisdiction: 'COMPANY',
    source: "Stair3D software choice (user decisions 2026-10-16: few variants, own width reduced only when needed, winders around a computed count plus one landing, U as one zone when it fits). 800 mm is PL-LEGAL-A-05*; 500 mm, 300 mm, the +1 and the minimum of 3 winders are this software's own choices.",
    severity: 'INFO',
    blocksGeneration: false,
    status: 'ASSUMPTION',
    notes: 'The variants are proposals only; applying one writes ordinary config fields, judged by the validator as always.',
  },
]);
