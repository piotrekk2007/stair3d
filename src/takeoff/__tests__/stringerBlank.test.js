import test from 'node:test';
import assert from 'node:assert/strict';

import { minAreaRectUV } from '../stockGeometry.js';
import { computeMaterialTakeoff } from '../materialTakeoff.js';
import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';
import { buildTreadModels } from '../../geometry/treadSolver.js';
import { buildRiserModels } from '../../geometry/riserSolver.js';
import { buildStringerModelsForFlight } from '../../geometry/stringerSolver.js';
import { buildStringerConstructionGeometry } from '../../geometry/stringerConstructionGeometry.js';
import { buildPostModels } from '../../geometry/postSolver.js';

test('minAreaRectUV: an axis-aligned rectangle is itself, in any point order', () => {
  const r = minAreaRectUV([{ u: 0, v: 0 }, { u: 400, v: 0 }, { u: 400, v: 100 }, { u: 0, v: 100 }]);
  assert.equal(r.lengthMm, 400);
  assert.equal(r.widthMm, 100);
});

test('minAreaRectUV: a rotated rectangle is found in its own frame (not its axis-aligned bounding box)', () => {
  const a = (30 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot = ([x, y]) => ({ u: x * c - y * s, v: x * s + y * c });
  const r = minAreaRectUV([[0, 0], [1000, 0], [1000, 350], [0, 350]].map(rot));
  assert.ok(Math.abs(r.lengthMm - 1000) < 0.01 && Math.abs(r.widthMm - 350) < 0.01, `${r.lengthMm} x ${r.widthMm}`);
});

test('minAreaRectUV: never smaller than the shape (covers every point) and deterministic', () => {
  const pts = [{ u: 0, v: 0 }, { u: 900, v: 400 }, { u: 950, v: 700 }, { u: 100, v: 380 }, { u: 500, v: 600 }];
  const a = minAreaRectUV(pts);
  assert.deepEqual(a, minAreaRectUV(pts));
  assert.ok(a.lengthMm * a.widthMm >= 0.5 * Math.abs(pts.reduce((s, p, i) => s + p.u * pts[(i + 1) % pts.length].v - pts[(i + 1) % pts.length].u * p.v, 0)));
});

function stringerItems(patch) {
  const config = { ...createDefaultConfig(), ...patch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  const models = {
    fullConfig,
    derived,
    planLayout,
    treadModels: buildTreadModels(planLayout, fullConfig),
    riserModels: buildRiserModels(planLayout, fullConfig),
    stringerModels,
    stringerConstruction: { outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig), inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig) },
    postModels: buildPostModels(planLayout, fullConfig),
  };
  return computeMaterialTakeoff(models, fullConfig).filter((i) => i.elementType === 'STRINGER');
}

test('straight flight: the stringer blank is exactly the design depth wide (nothing hidden in the comb or the slanted ends)', () => {
  for (const type of ['cut', 'closed']) {
    for (const item of stringerItems({ stairType: 'straight', treadsLegA: 14, totalRise: 2600, treadGoing: 280, stringerConstructionType: type })) {
      assert.equal(item.calculatedDimensions.boardWidthMm, 350, type);
      assert.equal(item.nominalDimensions.boardWidthMm, 350, 'the nominal (design) depth is kept separately');
      assert.ok(item.notes.some((n) => /Formatka wangi/.test(n)));
    }
  }
});

test('winder: the stringer blank is deeper than the design depth — the real board that must be bought', () => {
  const items = stringerItems({ stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 5, totalRise: 2700, treadGoing: 280, stringerConstructionType: 'cut' });
  assert.ok(items.length >= 2);
  assert.ok(items.every((i) => i.calculatedDimensions.boardWidthMm >= 350 - 0.01));
  assert.ok(items.some((i) => i.calculatedDimensions.boardWidthMm > 400), 'at least one winder board needs a wider blank than the design depth');
  for (const i of items) assert.ok(i.stockArea * 1e6 >= i.netArea * 1e6 - 1, 'STOCK never below NET');
});
