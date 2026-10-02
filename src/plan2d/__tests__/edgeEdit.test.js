import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { edgeOverrideEndpoints, getBoundaryPoints } from '../../geometry/edgeOverrides.js';
import { crossZ } from '../../geometry/pathUtils.js';
import { boundaryEditPoints, pivotEdgeDrag, freeEdgeDrag, closestOnPolyline } from '../edgeEdit.js';
import { renderPlan2DSVG } from '../plan2dRenderer.js';

const L = { stairType: 'L', treadsLegA: 5, windersPerTurn: 5, treadsLegB: 5 };

function build(patch = {}) {
  return buildStaircase({ ...createDefaultConfig(), ...L, ...patch });
}

// a winder edge of the default L (boundary 7 = between the 2nd and 3rd winder)
const WINDER_BOUNDARY = 7;

function dragInner(built, boundary, raw) {
  const e = boundaryEditPoints(built.planLayout.treads, boundary, built.fullConfig.manualEdgeOverrides, built.fullConfig);
  const neighbours = {
    before: boundaryEditPoints(built.planLayout.treads, boundary - 1, built.fullConfig.manualEdgeOverrides, built.fullConfig),
    after: boundaryEditPoints(built.planLayout.treads, boundary + 1, built.fullConfig.manualEdgeOverrides, built.fullConfig),
  };
  return { e, turned: pivotEdgeDrag({ endpoint: 'inner', raw, pivot: e.pivot, innerPath: built.planLayout.innerFullPath, outerPath: built.planLayout.outerFullPath, nominal: e.nominal, neighbours }) };
}

test('an edge override is read in both shapes: {inner, outer} and the older {movedEndpoint, point}', () => {
  assert.deepEqual(edgeOverrideEndpoints({ inner: { x: 1, y: 2 }, outer: { x: 3, y: 4 } }), { inner: { x: 1, y: 2 }, outer: { x: 3, y: 4 } });
  assert.deepEqual(edgeOverrideEndpoints({ movedEndpoint: 'outer', point: { x: 5, y: 6 } }), { outer: { x: 5, y: 6 } });
  assert.deepEqual(edgeOverrideEndpoints(null), {});
  assert.deepEqual(edgeOverrideEndpoints({ inner: { x: NaN, y: 0 } }), {});
});

test('dragging the dusza end turns the edge about its walkline point: both ends move, each on its own stringer line', () => {
  const built = build();
  const { e, turned } = dragInner(built, WINDER_BOUNDARY, { x: e0(built).inner.x + 60, y: e0(built).inner.y + 40 });
  assert.ok(turned, 'the edge can be turned there');
  assert.ok(closestOnPolyline(built.planLayout.innerFullPath, turned.inner).distance < 1e-6, 'inner end on the inner line');
  assert.ok(closestOnPolyline(built.planLayout.outerFullPath, turned.outer).distance < 1e-6, 'outer end on the outer line');
  assert.ok(Math.abs(crossZ(turned.inner, e.pivot, turned.outer)) / Math.hypot(turned.outer.x - turned.inner.x, turned.outer.y - turned.inner.y) < 1e-6, 'the pivot stays on the edge');
  assert.ok(Math.hypot(turned.outer.x - e.nominal[1].x, turned.outer.y - e.nominal[1].y) > 5, 'the outer end follows');
});

function e0(built) {
  return boundaryEditPoints(built.planLayout.treads, WINDER_BOUNDARY, {}, built.fullConfig);
}

test('the turned edge is applied to BOTH treads, and the edge still crosses the walkline at the same point', () => {
  const base = build();
  const { e, turned } = dragInner(base, WINDER_BOUNDARY, { x: e0(base).inner.x + 60, y: e0(base).inner.y + 40 });
  const edited = build({ manualEdgeOverrides: { [WINDER_BOUNDARY]: turned } });
  const ed = boundaryEditPoints(edited.planLayout.treads, WINDER_BOUNDARY, edited.fullConfig.manualEdgeOverrides, edited.fullConfig);
  assert.deepEqual(ed.inner, turned.inner);
  assert.deepEqual(ed.outer, turned.outer);
  // the walkline point of the edge is the same (nominal) pivot — the going on the walkline is unchanged
  assert.deepEqual(ed.pivot, e.pivot);
  // and the treads actually moved on both sides (the stored override moves both ends; the old one-end shape could not)
  const before = getBoundaryPoints(base.planLayout.treads, WINDER_BOUNDARY).current;
  const after = getBoundaryPoints(edited.planLayout.treads, WINDER_BOUNDARY).current;
  assert.ok(Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y) > 5, 'inner corner moved');
  assert.ok(Math.hypot(after[1].x - before[1].x, after[1].y - before[1].y) > 5, 'outer corner moved');
});

test('a free (Alt) move of one end keeps the other end\'s own edit', () => {
  const manual = { outer: { x: 10, y: 20 } };
  assert.deepEqual(freeEdgeDrag('inner', { x: 1, y: 2 }, manual), { outer: { x: 10, y: 20 }, inner: { x: 1, y: 2 } });
  assert.deepEqual(freeEdgeDrag('outer', { x: 1, y: 2 }, {}), { outer: { x: 1, y: 2 } });
});

test('the pointer on the pivot itself gives no turn (the edge stays as it was)', () => {
  const built = build();
  const e = e0(built);
  // a point of the inner line closest to the pivot is far from the pivot itself, so instead check the degenerate
  // case directly: an inner line passing through the pivot
  assert.equal(pivotEdgeDrag({ endpoint: 'inner', raw: e.pivot, pivot: e.pivot, innerPath: [e.pivot, { x: e.pivot.x + 1000, y: e.pivot.y }], outerPath: built.planLayout.outerFullPath, nominal: e.nominal }), null);
});

test('edit-mode handles are small squares of a fixed size on screen, on the stringer lines', () => {
  const built = build();
  const render = (mmPerPx) => renderPlan2DSVG(built.planLayout, built.fullConfig, built.derived, { viewport: { x: -500, y: -4000, width: 4000, height: 4000 }, editMode: true, mmPerPx });
  const width = (svg) => Number(/class="edge-handle"[^>]*? width="([\d.]+)"/.exec(svg)[1]);
  assert.equal(width(render(1)), 8);
  assert.equal(width(render(4)), 32, '4 mm per pixel: still 8 px on screen');
  // the handle of the winder edge sits on the nominal chain point (the stringer line), not on the recessed tread corner
  const svg = render(1);
  const e = e0(built);
  const m = new RegExp(`data-boundary="${WINDER_BOUNDARY}" data-endpoint="inner" x="([-\\d.]+)" y="([-\\d.]+)"`).exec(svg);
  assert.ok(m, 'inner square of the winder edge is drawn');
  assert.ok(Math.abs(Number(m[1]) + 4 - e.inner.x) < 0.02 && Math.abs(-(Number(m[2]) + 4) - e.inner.y) < 0.02);
});

test('a turned edge never carries an end past a corner of the stringer line (no self-crossing treads)', async () => {
  const { segmentsProperlyIntersect } = await import('../../geometry/pathUtils.js');
  const simple = (outline) => {
    for (let i = 0; i < outline.length; i++) {
      for (let j = i + 2; j < outline.length; j++) {
        if (i === 0 && j === outline.length - 1) continue;
        if (segmentsProperlyIntersect(outline[i], outline[(i + 1) % outline.length], outline[j], outline[(j + 1) % outline.length])) return false;
      }
    }
    return true;
  };
  for (const boundary of [6, 7, 8, 9]) {
    for (const shift of [-400, -150, 150, 400]) {
      const base = build();
      const e = e0b(base, boundary);
      const { turned } = dragInner(base, boundary, { x: e.inner.x + shift, y: e.inner.y + shift });
      if (!turned) continue;
      const edited = build({ manualEdgeOverrides: { [boundary]: turned } });
      for (const t of edited.planLayout.treads) assert.ok(simple(t.outline), `boundary ${boundary}, shift ${shift}: tread ${t.index + 1} crosses itself`);
    }
  }
});

function e0b(built, boundary) {
  return boundaryEditPoints(built.planLayout.treads, boundary, {}, built.fullConfig);
}

test('grid: turning any edge from either end never folds a tread (L/U, left/right, 3-5 winders)', async () => {
  const { segmentsProperlyIntersect } = await import('../../geometry/pathUtils.js');
  const crosses = (o) => o.some((a, i) => o.some((c, j) => j > i + 1 && !(i === 0 && j === o.length - 1) && segmentsProperlyIntersect(a, o[(i + 1) % o.length], c, o[(j + 1) % o.length])));
  for (const stairType of ['L', 'U']) {
    for (const turnDirection of ['right', 'left']) {
      for (const windersPerTurn of [3, 4, 5]) {
        const patch = { stairType, turnDirection, windersPerTurn, treadsLegA: 3, treadsLegB: stairType === 'U' ? 2 : 4, treadsLegC: 3 };
        const base = build(patch);
        const n = base.planLayout.treads.length;
        const at = (i) => boundaryEditPoints(base.planLayout.treads, i, {}, base.fullConfig);
        for (let i = 0; i <= n; i++) {
          const e = at(i);
          if (!e?.pivot) continue;
          for (const endpoint of ['inner', 'outer']) {
            for (const [dx, dy] of [[300, 0], [-300, 0], [0, 300], [0, -300], [120, 120]]) {
              const p = e[endpoint];
              const turned = pivotEdgeDrag({ endpoint, raw: { x: p.x + dx, y: p.y + dy }, pivot: e.pivot, innerPath: base.planLayout.innerFullPath, outerPath: base.planLayout.outerFullPath, nominal: e.nominal, neighbours: { before: at(i - 1), after: at(i + 1) } });
              if (!turned) continue;
              const edited = build({ ...patch, manualEdgeOverrides: { [i]: turned } });
              for (const t of edited.planLayout.treads) assert.ok(!crosses(t.outline), `${stairType} ${turnDirection} ${windersPerTurn}w, edge ${i} ${endpoint} (${dx},${dy}): tread ${t.index + 1} folds`);
            }
          }
        }
      }
    }
  }
});
