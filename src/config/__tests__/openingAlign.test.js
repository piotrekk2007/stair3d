import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData, deriveCeilingFit, alignedOpeningOffsets, OPENING_ALIGN_TARGETS } from '../schema.js';
import { buildPlanLayout } from '../../geometry/planLayout.js';

function stair(patch = {}) {
  const config = { ...createDefaultConfig(), ...patch };
  const derived = deriveStairData(config);
  const full = { ...config, riserHeight: derived.riserHeight };
  return { config: full, layout: buildPlanLayout(full), riserHeight: derived.riserHeight };
}

test('aligning the opening to a corner puts the opening’s matching corner exactly on the stair’s plan corner', () => {
  for (const patch of [{}, { stairType: 'straight' }, { stairType: 'L', turnDirection: 'left' }]) {
    const { config, layout, riserHeight } = stair({ ...patch, openingWidth: 4000, openingLength: 4200, openingOffsetX: 123, openingOffsetY: -77 });
    const b = layout.bounds;
    for (const t of OPENING_ALIGN_TARGETS.filter((x) => x.id.startsWith('corner'))) {
      const fit = deriveCeilingFit({ ...config, ...alignedOpeningOffsets(config, b, t.id) }, layout, riserHeight);
      const x = t.x === 'min' ? fit.openMinX - b.minX : fit.openMaxX - b.maxX;
      const y = t.y === 'min' ? fit.openMinY - b.minY : fit.openMaxY - b.maxY;
      assert.ok(Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5, `${JSON.stringify(patch)} ${t.id}: ${x}, ${y}`);
    }
  }
});

test('aligning to a side moves only the offset across that side', () => {
  const { config, layout } = stair({ openingOffsetX: 123, openingOffsetY: -77 });
  assert.deepEqual(alignedOpeningOffsets(config, layout.bounds, 'side-xmin'), { openingOffsetX: 0, openingOffsetY: -77 });
  assert.deepEqual(alignedOpeningOffsets(config, layout.bounds, 'side-ymin'), { openingOffsetX: 123, openingOffsetY: 0 });
  const ymax = alignedOpeningOffsets(config, layout.bounds, 'side-ymax');
  assert.equal(ymax.openingOffsetX, 123);
  assert.equal(ymax.openingOffsetY, Math.round(layout.bounds.maxY - layout.bounds.minY - config.openingLength));
  assert.deepEqual(alignedOpeningOffsets(config, layout.bounds, 'nope'), { openingOffsetX: 123, openingOffsetY: -77 });
});
