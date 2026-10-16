import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { edgeLayoutKey, withEdgeOverride, effectiveEdgeOverrides, getBoundaryPoints } from '../edgeOverrides.js';
import { runTakeoffValidationGate } from '../../takeoff/index.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';

const base = { stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2800 };
const layoutOf = (c) => buildPlanLayout({ ...c, riserHeight: deriveStairData(c).riserHeight });
const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
};

test('regression (user report 2026-10-16): edge edits made on another tread layout are not applied after the counts change, and are reported', () => {
  const c0 = { ...createDefaultConfig(), ...base };
  const plain = layoutOf(c0);
  const [inner, outer] = getBoundaryPoints(plain.treads, 2).current;
  // the user moves edge 2's outer end on THIS layout
  const edited = { ...c0, ...withEdgeOverride(c0, 2, { inner, outer: { x: outer.x, y: outer.y + 60 } }) };
  assert.equal(edited.manualEdgeOverridesLayout, edgeLayoutKey(c0));
  const on = layoutOf(edited);
  assert.deepEqual(on.edgeOverrideStatus.applied, [2]);
  assert.ok(Math.abs(getBoundaryPoints(on.treads, 2).current[1].y - (outer.y + 60)) < 1e-6);

  // then changes the number of treads: boundary 2 is another edge now — the old point must not be put on it
  const changed = { ...edited, treadsLegA: 2 };
  const after = layoutOf(changed);
  assert.deepEqual(after.edgeOverrideStatus.stale, [2]);
  assert.deepEqual(after.edgeOverrideStatus.applied, []);
  assert.deepEqual(after.treads.map((t) => t.frontEdge), layoutOf({ ...changed, manualEdgeOverrides: {} }).treads.map((t) => t.frontEdge), 'exactly the unedited layout');
  const m = quiet(() => buildStaircase(changed));
  const stale = runTakeoffValidationGate(m).diagnostics.find((d) => d.ruleId === 'EDGE-OVERRIDES-OUT-OF-DATE');
  assert.ok(stale && stale.severity === 'WARNING' && stale.value === 1);
  // they are kept (never silently deleted) until the first edit on the new layout replaces them
  assert.ok(changed.manualEdgeOverrides[2]);
  const next = withEdgeOverride(changed, 5, { inner, outer });
  assert.deepEqual(Object.keys(next.manualEdgeOverrides), ['5']);
  assert.equal(next.manualEdgeOverridesLayout, edgeLayoutKey(changed));
  // the same layout keeps adding to the existing edits
  assert.deepEqual(Object.keys(withEdgeOverride(edited, 3, { inner, outer }).manualEdgeOverrides).sort(), ['2', '3']);
});

test('regression: an edge edit the layout rejects is not drawn as edited, does not count for dragging, and is reported', () => {
  const c0 = { ...createDefaultConfig(), ...base };
  const plain = layoutOf(c0);
  const [inner] = getBoundaryPoints(plain.treads, 3).current;
  // edge 3's outer end thrown far past the next edges: the tread would fold — rejected
  const bad = { ...c0, manualEdgeOverrides: { 3: { inner, outer: { x: 0, y: 5000 } } } };
  const pl = quiet(() => layoutOf(bad));
  assert.deepEqual(pl.edgeOverrideStatus.skipped, [3]);
  assert.deepEqual(effectiveEdgeOverrides(pl, bad.manualEdgeOverrides), {}, 'neither drawn nor used as a drag anchor');
  const svg = renderPlan2DSVG(pl, bad, deriveStairData(bad), { viewport: { x: -500, y: -5500, width: 6000, height: 6000 }, layers: { stepBoundaries: true } });
  assert.ok(!/data-boundary="3"[^>]*stroke="#e08214"/.test(svg), 'not orange (edited) in the plan');
  const m = quiet(() => buildStaircase(bad));
  assert.ok(runTakeoffValidationGate(m).diagnostics.some((d) => d.ruleId === 'EDGE-OVERRIDE-SKIPPED' && d.value === 3));
});
