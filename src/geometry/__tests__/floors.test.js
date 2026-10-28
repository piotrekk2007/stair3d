import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { stairRiseFromRaw, rawSlabTopZ, slabSoffitZ, floorDrivenFields } from '../floors.js';

const base = (patch = {}) => ({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 13, ...patch });

test('floors raw / finished (user decisions 2026-10-28): the stair rise = the raw height − the bottom finish + the top finish; the raw slab one top finish below the finished floor', () => {
  const c = base({ rawStoreyHeightMm: 2900, floorFinishBottomMm: 80, floorFinishTopMm: 60, ceilingThickness: 250 });
  assert.equal(stairRiseFromRaw(c), 2880);
  assert.deepEqual(floorDrivenFields(c), ['totalRise']);
  const b = buildStaircase(c);
  assert.equal(b.fullConfig.totalRise, 2880);
  assert.equal(rawSlabTopZ(b.fullConfig), 2820);
  assert.equal(slabSoffitZ(b.fullConfig), 2570);
  // the ceiling check and the headroom measure to the RAW slab's underside
  assert.equal(b.ceilingFit.soffitZ, 2570);
  assert.equal(b.headroom.soffitZ, 2570);
  // older projects (no raw height): totalRise as given
  assert.equal(stairRiseFromRaw(base()), null);
  assert.deepEqual(floorDrivenFields(base()), []);
  assert.equal(buildStaircase(base({ totalRise: 2750 })).fullConfig.totalRise, 2750);
});

test('the opening trim lies on the RAW slab, its board by default as thick as the top floor finish — its top flush with the finished floor', () => {
  const b = buildStaircase(base({ rawStoreyHeightMm: 2900, floorFinishBottomMm: 0, floorFinishTopMm: 25, openingTrimEnabled: true }));
  const board = b.openingTrim.pieces[0].solids.find((s) => s.kind === 'board');
  assert.equal(board.zBottom, 2900, 'on the raw slab');
  assert.equal(board.zTop, 2925, 'flush with the finished floor (2900 + 25)');
  // a board thickness given by hand is kept
  const own = buildStaircase(base({ rawStoreyHeightMm: 2900, floorFinishTopMm: 25, openingTrimEnabled: true, openingTrimBoardThicknessMm: 15 }));
  assert.equal(own.openingTrim.pieces[0].solids.find((s) => s.kind === 'board').zTop, 2915);
});

test('the 3D slab: the raw slab and the top floor finish on it as its own layer, up to the finished floor', () => {
  const b = buildStaircase(base({ rawStoreyHeightMm: 2900, floorFinishTopMm: 40 }));
  const finish = b.ceilingMesh.getObjectByName('CeilingFloorFinish');
  assert.ok(finish, 'the finish layer');
  finish.geometry.computeBoundingBox();
  assert.equal(Math.round(finish.geometry.boundingBox.max.y), 2940);
  assert.equal(Math.round(finish.geometry.boundingBox.min.y), 2900);
});
