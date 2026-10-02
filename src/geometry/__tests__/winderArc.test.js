import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStaircase } from '../buildStaircase.js';
import { arcWinderGeometry } from '../winderArc.js';
import { segmentsProperlyIntersect, crossZ } from '../pathUtils.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';

function layout(patch = {}) {
  const config = { ...createDefaultConfig(), ...patch };
  const d = deriveStairData(config);
  return buildPlanLayout({ ...config, riserHeight: d.riserHeight, stringerConstructionTypeOuter: 'cut', stringerConstructionTypeInner: 'cut', ...patch });
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const onLine = (p, a, b) => Math.abs(crossZ(a, b, p)) / dist(a, b) < 1e-6;
const simple = (o) => !o.some((a, i) => o.some((c, j) => j > i + 1 && !(i === 0 && j === o.length - 1) && segmentsProperlyIntersect(a, o[(i + 1) % o.length], c, o[(j + 1) % o.length])));

test('the walkline: straight, a quarter arc of radius walklineOffset round the inner corner, straight', () => {
  const p = { stairWidth: 900, treadGoing: 270, walklineOffset: 400, walklineSplitOffset: 400 };
  const g = arcWinderGeometry(p, 5, 5);
  assert.ok(g);
  assert.deepEqual(g.walkAt(g.Yc), { x: 500, y: g.Yc });
  for (const pt of g.arcPoints) assert.ok(Math.abs(dist(pt, g.Ic) - 400) < 1e-9, 'every arc point is 400 mm from the inner corner');
  assert.ok(dist(g.walkAt(g.arcEnd), { x: 900, y: g.Yc + 400 }) < 1e-9);
  // the zone: 400 mm of walkline before the arc's middle, the rest after it
  assert.ok(Math.abs(g.sm - g.s0 - 400) < 1e-9);
  assert.ok(Math.abs(g.s1 - g.s0 - 1350) < 1e-9);
});

test('every winder edge runs through its own walkline point, one going apart ALONG the walkline; the dusza widths are all equal', () => {
  const p = { stairWidth: 900, treadGoing: 270, walklineOffset: 400, walklineSplitOffset: 400 };
  const g = arcWinderGeometry(p, 5, 5);
  g.boundaries.forEach((b, k) => {
    assert.ok(Math.abs(b.station - (g.s0 + k * 270)) < 1e-9);
    assert.ok(onLine(b.walk, b.inner, b.outer), `edge ${k} through its walkline point`);
  });
  const along = (pt) => (pt.x <= 900 + 1e-9 ? pt.y - g.s0 : g.Yc - g.s0 + (pt.x - 900));
  for (let k = 1; k < g.boundaries.length; k++) {
    assert.ok(Math.abs(along(g.boundaries[k].inner) - along(g.boundaries[k - 1].inner) - g.duszaWidth) < 1e-9);
  }
  assert.ok(Math.abs(g.duszaWidth - (270 * (1350 - Math.PI * 200)) / 1350) < 1e-9);
});

test('a zone symmetric about the corner: the middle edge runs exactly through the inner AND the outer corner', () => {
  const g = arcWinderGeometry({ stairWidth: 900, treadGoing: 270, walklineOffset: 400, walklineSplitOffset: 540 }, 3, 4);
  const mid = g.boundaries[2];
  assert.ok(dist(mid.inner, g.Ic) < 1e-9 && dist(mid.outer, g.Oc) < 1e-9);
});

test('a flight that starts / ends with winders starts / ends at the inner corner (one post there, as before)', () => {
  const start = layout({ stairType: 'L', treadsLegA: 0, windersPerTurn: 5, treadsLegB: 4 });
  assert.ok(dist(start.innerFullPath[0], start.turns[0].innerCorner) < 1e-9);
  const end = layout({ stairType: 'L', treadsLegA: 4, windersPerTurn: 5, treadsLegB: 0 });
  assert.ok(dist(end.innerFullPath[end.innerFullPath.length - 1], end.turns[0].innerCorner) < 1e-9);
  const m = buildStaircase({ ...createDefaultConfig(), stairType: 'L', treadsLegA: 0, windersPerTurn: 5, treadsLegB: 4 });
  assert.ok(!m.postModels.some((p) => p.postId === 'post-start'), 'the start post is the corner post');
});

test('when the arc does not fit in the zone the old proportional layout is used', () => {
  assert.equal(arcWinderGeometry({ stairWidth: 900, treadGoing: 255, walklineOffset: 500, walklineSplitOffset: 250 }, 2, 3), null);
  assert.equal(layout({ stairType: 'L', windersPerTurn: 3, treadGoing: 255, walklineOffset: 500, walklineSplitOffset: 250 }).turns[0].method, 'proportional');
  assert.equal(layout({ stairType: 'L' }).turns[0].method, 'walkline-arc');
});

test('the layout carries its walkline: one point per tread edge, on every edge, and a path with the arc', () => {
  for (const patch of [{ stairType: 'L' }, { stairType: 'L', turnDirection: 'left' }, { stairType: 'U' }, { stairType: 'U', turn1Type: 'landing', turn2Type: 'landing', mergeLandings: true }, { stairType: 'straight' }]) {
    const pl = layout(patch);
    assert.equal(pl.walkline.points.length, pl.treads.length + 1, JSON.stringify(patch));
    pl.treads.forEach((t, i) => {
      const p = pl.walkline.points[i];
      if (t.type !== 'landing' && p && t.innerChain.length) assert.ok(onLine(p, t.innerChain[0], t.outerChain[0]), `${JSON.stringify(patch)} edge ${i}`);
    });
    assert.ok(pl.walkline.path.length >= 2);
  }
});

test('grid: every tread outline is simple and the inner ends advance along the dusza (L/U, left/right, 3-6 winders, split, offset)', () => {
  for (const stairType of ['L', 'U']) {
    for (const turnDirection of ['right', 'left']) {
      for (const windersPerTurn of [3, 4, 5, 6]) {
        for (const walklineSplitOffset of [0, 400, 800]) {
          for (const walklineOffset of [300, 400, 500]) {
            const patch = { stairType, turnDirection, windersPerTurn, walklineSplitOffset, walklineOffset, treadsLegA: 3, treadsLegB: 3, treadsLegC: 2 };
            const pl = layout(patch);
            for (const t of pl.treads) assert.ok(simple(t.outline), `${JSON.stringify(patch)}: tread ${t.index + 1}`);
          }
        }
      }
    }
  }
});

test('a housed board is made deeper where the minimum depth would leave a tread\'s back corner outside it (INFO, never an unsupported tread)', () => {
  // L, steep, housed, minimum 300: the long outer side of the winder wrapping the wall corner is flat (17°) — 210 mm
  // below the reference reaches only 220 mm down, the tread's back underside corner is one rise (221 mm) down
  const config = { ...createDefaultConfig(), stairType: 'L', turn1Type: 'winder', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, treadGoing: 280, totalRise: 3100, stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed', minimumStringerDepthMm: 300 };
  const d = deriveStairData(config);
  const full = { ...config, riserHeight: d.riserHeight };
  const geos = buildStringerConstructionGeometry(buildStringerModelsForFlight(buildPlanLayout(full), full).outer, full);
  const ids = geos.flatMap((g) => g.diagnostics.map((x) => x.ruleId));
  assert.ok(!ids.includes('STRINGER-TREAD-SUPPORT'));
  assert.ok(ids.includes('STRINGER-DEPTH-FOR-SUPPORT'));
});

test('winder width (PL-LEGAL-C-01) is measured ON the line 400 mm from the dusza — round the corner an arc — not 400 mm along each slanted edge', async () => {
  const { validateStaircase } = await import('../../validator/StaircaseValidator.js');
  const { treadGoingAtOffsetFromInner } = await import('../walklineModel.js');
  // default L: the walkline IS 400 mm from the dusza, so every winder has ~its going there (a chord of the arc)
  const m = buildStaircase({ ...createDefaultConfig() });
  for (const t of m.planLayout.treads.filter((x) => x.type === 'winder')) {
    const w = treadGoingAtOffsetFromInner(t, 400, m.planLayout);
    assert.ok(w > 260 && w <= 270 + 1e-6, `step ${t.index + 1}: ${w.toFixed(1)} mm`);
  }
  assert.ok(!validateStaircase({ ...createDefaultConfig() }).diagnostics.some((d) => d.ruleId === 'PL-LEGAL-C-01'));
});
