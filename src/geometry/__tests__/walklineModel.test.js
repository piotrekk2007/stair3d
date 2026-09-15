import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildWalklineModel, treadGoingAtOffsetFromInner } from '../walklineModel.js';

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

test('buildWalklineModel: straight flight has one walkline point per tread, offset from the inner edge', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 5 });
  const walkline = buildWalklineModel(planLayout, config);

  assert.equal(walkline.offset, config.walklineOffset);
  assert.equal(walkline.points.length, 5);
  assert.ok(walkline.origin);

  const tread0 = planLayout.treads[0];
  const expectedFrontX = tread0.frontEdge[0].x + (config.walklineOffset / config.stairWidth) * (tread0.frontEdge[1].x - tread0.frontEdge[0].x);
  assert.ok(Math.abs(walkline.points[0].front.x - expectedFrontX) < 1e-6);
});

test('buildWalklineModel: winder tread walkline point lies strictly between inner and outer edge', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const walkline = buildWalklineModel(planLayout, config);
  const winderTread = planLayout.treads.find((t) => t.type === 'winder');
  const point = walkline.points[winderTread.index];

  const [inner, outer] = winderTread.frontEdge;
  const totalWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  const distFromInner = Math.hypot(point.front.x - inner.x, point.front.y - inner.y);
  assert.ok(distFromInner > 0 && distFromInner < totalWidth, `expected walkline point strictly inside the tread width, got ${distFromInner}mm of ${totalWidth}mm`);
});

test('treadGoingAtOffsetFromInner: for a straight tread equals treadGoing regardless of offset', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 4 });
  const tread = planLayout.treads[1];
  const goingAt200 = treadGoingAtOffsetFromInner(tread, 200);
  const goingAt700 = treadGoingAtOffsetFromInner(tread, 700);
  assert.ok(Math.abs(goingAt200 - config.treadGoing) < 1e-6);
  assert.ok(Math.abs(goingAt700 - config.treadGoing) < 1e-6);
});

test('treadGoingAtOffsetFromInner: for a winder tread varies with offset (narrower near the inner edge)', () => {
  const { planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const winderTread = planLayout.treads.find((t) => t.type === 'winder');
  const goingNearInner = treadGoingAtOffsetFromInner(winderTread, 50);
  const goingNearOuter = treadGoingAtOffsetFromInner(winderTread, 800);
  assert.notEqual(Math.round(goingNearInner), Math.round(goingNearOuter));
});

test('treadGoingAtOffsetFromInner: clamps to the tread edge when offset exceeds tread width', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 3 });
  const tread = planLayout.treads[0];
  const going = treadGoingAtOffsetFromInner(tread, config.stairWidth + 5000);
  assert.ok(Math.abs(going - config.treadGoing) < 1e-6);
});
