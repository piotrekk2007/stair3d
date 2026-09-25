// Tests for src/geometry/edgeOverrides.js's `applyTreadOverhangs` — a per-tread lateral edge
// shift, deliberately independent of the SHARED-corner `applyManualEdgeOverrides` mechanism
// (see that function's own tests via manualEdgeConsistency.test.js / riserModel.test.js). The
// defining property under test here: editing one tread's own outer/inner edge must NEVER move
// a neighboring tread's corner, even though the two treads may have started with an identical
// (shared) corner point.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { pointsEqual } from '../pathUtils.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  return buildPlanLayout(fullConfig);
}

test('a tread overhang shifts ONLY that tread\'s own outline, never the neighboring treads\'', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualTreadOverhangs: { 2: { side: 'outer', offsetMm: 30 } } });

  assert.deepEqual(edited.treads[1].outline, base.treads[1].outline, 'the PREVIOUS tread must be byte-identical');
  assert.deepEqual(edited.treads[3].outline, base.treads[3].outline, 'the NEXT tread must be byte-identical');
  assert.notDeepEqual(edited.treads[2].outline, base.treads[2].outline, 'the EDITED tread must actually change');
});

test('overhang moves the outline outward on the requested side only, by exactly offsetMm', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualTreadOverhangs: { 2: { side: 'outer', offsetMm: 30 } } });

  const baseFront = base.treads[2].frontEdge;
  const editedFront = edited.treads[2].frontEdge;
  // Inner corner (index 0) must be untouched; outer corner (index 1) must move by exactly 30mm
  // along the edge's own inner->outer direction.
  assert.ok(pointsEqual(baseFront[0], editedFront[0]), 'inner corner must not move for an outer-side overhang');
  const moved = Math.hypot(editedFront[1].x - baseFront[1].x, editedFront[1].y - baseFront[1].y);
  assert.ok(Math.abs(moved - 30) < 1e-6, `expected exactly 30mm of movement, got ${moved}`);
});

test('a negative offset pulls the edge INWARD (a recessed tread), not just positive overhangs', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualTreadOverhangs: { 2: { side: 'outer', offsetMm: -20 } } });
  const baseFront = base.treads[2].frontEdge;
  const editedFront = edited.treads[2].frontEdge;
  const moved = Math.hypot(editedFront[1].x - baseFront[1].x, editedFront[1].y - baseFront[1].y);
  assert.ok(Math.abs(moved - 20) < 1e-6);
});

test('the inner side can be overhung independently of the outer side', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const edited = build({ stairType: 'straight', treadsLegA: 6, manualTreadOverhangs: { 2: { side: 'inner', offsetMm: 15 } } });
  const baseFront = base.treads[2].frontEdge;
  const editedFront = edited.treads[2].frontEdge;
  assert.ok(pointsEqual(baseFront[1], editedFront[1]), 'outer corner must not move for an inner-side overhang');
  assert.notDeepEqual(baseFront[0], editedFront[0]);
});

test('the stringer reference geometry (innerChain/outerChain) is completely unaffected — the tread can genuinely overhang past the wanga', () => {
  const baseConfig = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 6 };
  const derived = deriveStairData(baseConfig);
  const fullBase = { ...baseConfig, riserHeight: derived.riserHeight };
  const editedConfig = { ...fullBase, manualTreadOverhangs: { 2: { side: 'outer', offsetMm: 50 } } };

  const baseLayout = buildPlanLayout(fullBase);
  const editedLayout = buildPlanLayout(editedConfig);

  const outerModelBase = buildStringerModelsForFlight(baseLayout, fullBase).outer;
  const outerModelEdited = buildStringerModelsForFlight(editedLayout, editedConfig).outer;
  assert.deepEqual(outerModelEdited.segments[0].referenceLine, outerModelBase.segments[0].referenceLine, 'the wanga must stay exactly on its nominal line regardless of the tread overhang');
});

test('an overhang large enough to invert the tread\'s own winding is rejected (reverted), not silently applied', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6, stairWidth: 200 });
  // stairWidth 200mm: an inward offset of 500mm on the outer side would push it past the inner
  // edge, inverting (or degenerating) the tread's own polygon.
  const edited = build({ stairType: 'straight', treadsLegA: 6, stairWidth: 200, manualTreadOverhangs: { 2: { side: 'outer', offsetMm: -500 } } });
  assert.deepEqual(edited.treads[2].outline, base.treads[2].outline, 'a degenerate result must be reverted, leaving the tread at its nominal shape');
});

test('an overhang on a boundary index that no longer exists is silently ignored (config not yet in sync after a tread-count change)', () => {
  const layout = build({ stairType: 'straight', treadsLegA: 3, manualTreadOverhangs: { 99: { side: 'outer', offsetMm: 30 } } });
  assert.equal(layout.treads.length, 3); // did not throw, did not do anything odd
});

test('manualEdgeOverrides and manualTreadOverhangs can be combined without interfering with each other', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const outerPoint = base.treads[1].backEdge[1];
  const edited = build({
    stairType: 'straight',
    treadsLegA: 6,
    manualEdgeOverrides: { 2: { movedEndpoint: 'outer', point: { x: outerPoint.x, y: outerPoint.y + 20 } } },
    manualTreadOverhangs: { 4: { side: 'outer', offsetMm: 30 } },
  });
  // Boundary-2 edit affects treads 1 and 2 (shared corner); overhang on tread 4 must still be
  // fully independent of both.
  assert.notDeepEqual(edited.treads[1].outline, base.treads[1].outline);
  assert.notDeepEqual(edited.treads[2].outline, base.treads[2].outline);
  assert.notDeepEqual(edited.treads[4].outline, base.treads[4].outline);
  assert.deepEqual(edited.treads[3].outline, base.treads[3].outline, 'tread 3 is untouched by either edit');
  assert.deepEqual(edited.treads[5].outline, base.treads[5].outline, 'tread 5 is untouched by either edit');
});

test('an intentional overhang is NOT reported as a topology/walkline discontinuity, but is reported as a manual edit', async () => {
  const { validateStaircase } = await import('../../validator/StaircaseValidator.js');
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, openingLength: 6000, manualTreadOverhangs: { 4: { side: 'inner', offsetMm: 85 } } };
  const { diagnostics } = validateStaircase(config);
  const ids = diagnostics.map((d) => d.ruleId);
  assert.ok(!ids.includes('CONSTRAINT-TOPOLOGY-CONTINUITY'), 'overhang must not read as a broken boundary');
  assert.ok(!ids.includes('VALIDATOR-WALKLINE-CONTINUITY'), 'overhang must not read as a broken walkline');
  assert.ok(ids.includes('VALIDATOR-MANUAL-OVERRIDE'), 'the edit must still be announced as a manual change');
});

test('a genuinely broken shared boundary (no overhang involved) is still reported', async () => {
  const { checkTopologicalContinuity } = await import('../../constraints/geometricConstraints.js');
  const mk = (id, back, front) => ({ stepId: id, overhang: null, frontEdge: { final: front }, backEdge: { final: back } });
  const a = mk('step-0', [{ x: 0, y: 1 }, { x: 9, y: 1 }], [{ x: 0, y: 0 }, { x: 9, y: 0 }]);
  const b = mk('step-1', [{ x: 0, y: 2 }, { x: 9, y: 2 }], [{ x: 5, y: 1 }, { x: 9, y: 1 }]);
  assert.equal(checkTopologicalContinuity([a, b]).length, 1);
});

// --- applyHousingRecess: a housed wanga takes a bite out of the tread, an overlay one does not ---
//
// On the 'closed' (wpuszczana) side, the tread's edge sits at the BOTTOM of a pocket routed
// housingDepth mm into the wanga's own inner face — its finished edge is narrower than the nominal
// stairWidth boundary by exactly that much, on that side only. On the 'cut' (nakładana) side the
// tread rests ON the wanga, unchanged. This is a geometric CONSEQUENCE of the construction type
// choice — never a manual edit — so it applies automatically, to every tread, on both sides
// independently (each wanga has its own construction type — see stringerModel.js
// constructionTypeForSide).

import { housingDepthMm } from '../stringerModel.js';

test('both wangi housed: every tread ends at the housing bottom (t − d from the chain) on BOTH sides, front and back', () => {
  const cut = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const closed = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  // The tread ends at the BOTTOM of the housing: the wanga occupies [0, t] in from its chain line and the housing is
  // routed d into its inner face, so the tread end sits t − d from the chain (regression: it used to be d, i.e. 8 mm
  // into solid wood at t = 40, d = 16).
  const depth = createDefaultConfig().stringerThickness - housingDepthMm(createDefaultConfig());
  assert.ok(depth > 0);

  for (const i of [0, 2, 5]) {
    for (const edgeKey of ['frontEdge', 'backEdge']) {
      const [cutInner, cutOuter] = cut.treads[i][edgeKey];
      const [closedInner, closedOuter] = closed.treads[i][edgeKey];
      assert.ok(Math.abs(Math.hypot(closedInner.x - cutInner.x, closedInner.y - cutInner.y) - depth) < 1e-6, `${edgeKey} inner corner of tread ${i} did not recess by exactly the housing depth`);
      assert.ok(Math.abs(Math.hypot(closedOuter.x - cutOuter.x, closedOuter.y - cutOuter.y) - depth) < 1e-6, `${edgeKey} outer corner of tread ${i} did not recess by exactly the housing depth`);
    }
    const cutWidth = Math.hypot(cut.treads[i].frontEdge[1].x - cut.treads[i].frontEdge[0].x, cut.treads[i].frontEdge[1].y - cut.treads[i].frontEdge[0].y);
    const closedWidth = Math.hypot(closed.treads[i].frontEdge[1].x - closed.treads[i].frontEdge[0].x, closed.treads[i].frontEdge[1].y - closed.treads[i].frontEdge[0].y);
    assert.ok(Math.abs(cutWidth - closedWidth - 2 * depth) < 1e-6, 'width shrinks by depth on EACH side, i.e. 2x depth total');
  }
});

test('mixed construction: only the HOUSED side recesses, the OVERLAY side stays at its nominal position', () => {
  const cut = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const mixed = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'cut' });
  // The tread ends at the BOTTOM of the housing: the wanga occupies [0, t] in from its chain line and the housing is
  // routed d into its inner face, so the tread end sits t − d from the chain (regression: it used to be d, i.e. 8 mm
  // into solid wood at t = 40, d = 16).
  const depth = createDefaultConfig().stringerThickness - housingDepthMm(createDefaultConfig());

  const [cutInner, cutOuter] = cut.treads[2].frontEdge;
  const [mixedInner, mixedOuter] = mixed.treads[2].frontEdge;
  assert.ok(pointsEqual(cutInner, mixedInner), 'inner (overlay) side must not move');
  assert.ok(Math.abs(Math.hypot(mixedOuter.x - cutOuter.x, mixedOuter.y - cutOuter.y) - depth) < 1e-6, 'outer (housed) side must recess by exactly the housing depth');
});

test('the wanga reference geometry is completely unaffected by housing recess — routing a pocket never moves the board', () => {
  const closedConfig = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' };
  const cutConfig = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' };
  const derived = deriveStairData(closedConfig);
  const fullClosed = { ...closedConfig, riserHeight: derived.riserHeight };
  const fullCut = { ...cutConfig, riserHeight: derived.riserHeight };

  const outerClosed = buildStringerModelsForFlight(buildPlanLayout(fullClosed), fullClosed).outer;
  const outerCut = buildStringerModelsForFlight(buildPlanLayout(fullCut), fullCut).outer;
  assert.deepEqual(outerClosed.segments[0].referenceLine, outerCut.segments[0].referenceLine, 'the wanga stays on its nominal line regardless of construction type');
});

test('housing recess composes with a manual overhang: the overhang is measured from the ALREADY-recessed edge', () => {
  const recessedOnly = build({ stairType: 'straight', treadsLegA: 6, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const withOverhang = build({
    stairType: 'straight',
    treadsLegA: 6,
    stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed',
    manualTreadOverhangs: { 2: { side: 'outer', offsetMm: 30 } },
  });
  const a = recessedOnly.treads[2].frontEdge[1];
  const b = withOverhang.treads[2].frontEdge[1];
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 30) < 1e-6, 'the overhang moves exactly 30mm further from the already-recessed position');
});

test('a housing depth that would collapse the tread (absurdly narrow stairWidth) is safely reverted, not silently applied', () => {
  const cut = build({ stairType: 'straight', treadsLegA: 4, stairWidth: 20, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut' });
  const closed = build({ stairType: 'straight', treadsLegA: 4, stairWidth: 20, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  // 2x recess (2 x 24 mm) against a 20mm-wide stair would invert (or, shifted corner by corner, slide) the tread — reverted to nominal.
  assert.deepEqual(closed.treads[2].outline, cut.treads[2].outline);
});

test('a landing tread (turn type "landing") is handled without error under a housed construction', () => {
  assert.doesNotThrow(() => build({ stairType: 'L', turn1Type: 'landing', treadsLegA: 3, treadsLegB: 3, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' }));
});
