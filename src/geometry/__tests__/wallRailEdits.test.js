// A wall handrail's own edits (user request 2026-11-17 — „do I have any control over the handrails drawn on the walls?”:
// none but the section's steps): cut back from either end along its path, its own height, its ends turned to the wall;
// the plan's end handles (plan2dRenderer.js railingPostEditXML) read `wallEdit`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { sanitizeRailingSections, WALL_RAIL_MIN_MM } from '../railingSolver.js';
import { railingPostEditXML } from '../../plan2d/plan2dRenderer.js';

const build = (patch) => {
  const config = { ...createDefaultConfig(), stairType: 'straight', treadsLegA: 12, railingEnabled: true, stairPending: false, railingSections: [{ id: 'w', side: 'outer', fromStep: 0, toStep: null, mount: 'wall', ...patch }] };
  return buildStaircase(config).railingModel.sections.find((s) => s.id === 'w');
};
const planLen = (pieces) => pieces.reduce((n, p) => n + Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y), 0);

test('a wall handrail cut back from its start and end along its path; brackets only on what is left', () => {
  const full = build({});
  const cut = build({ wallFromMm: 400, wallToMm: 600 });
  assert.equal(full.wallEdit.fromMm, 0);
  assert.ok(Math.abs(planLen(full.runs[0].pieces) - full.wallEdit.totalMm) < 1);
  assert.ok(Math.abs(planLen(cut.runs[0].pieces) - (full.wallEdit.totalMm - 1000)) < 1, 'the plan length 1000 mm shorter');
  assert.equal(cut.wallEdit.startS, 400);
  assert.ok(Math.abs(cut.wallEdit.endS - (full.wallEdit.totalMm - 600)) < 1e-6);
  assert.ok(cut.runs[0].brackets.length < full.runs[0].brackets.length);
  // never shorter than WALL_RAIL_MIN_MM
  const over = build({ wallFromMm: 99999, wallToMm: 99999 });
  assert.ok(Math.abs(planLen(over.runs[0].pieces) - WALL_RAIL_MIN_MM) < 1);
});

test('a wall handrail\'s own height over the nosing line, and its ends turned back into the wall', () => {
  const full = build({});
  const high = build({ wallHeightMm: 1000 });
  const dz = high.runs[0].pieces[0].start.z - full.runs[0].pieces[0].start.z;
  assert.ok(Math.abs(dz - (1000 - full.wallEdit.heightMm)) < 1e-6);
  assert.deepEqual(high.heightAboveNosing, { minMm: 1000, maxMm: 1000 });
  const ret = build({ wallEnds: 'return' });
  const pieces = ret.runs[0].pieces;
  assert.equal(pieces[0].wallReturn, 'start');
  assert.equal(pieces.at(-1).wallReturn, 'end');
  for (const p of [pieces[0], pieces.at(-1)]) {
    assert.equal(p.start.z, p.end.z, 'level');
    assert.ok(Math.abs(Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y) - p.lengthMm) < 1e-6);
  }
  // they reach the wall: as far out as the brackets' wall points
  const wallOff = Math.hypot(ret.runs[0].brackets[0].wall.x - ret.runs[0].brackets[0].position.x, ret.runs[0].brackets[0].wall.y - ret.runs[0].brackets[0].position.y);
  assert.ok(Math.abs(pieces[0].lengthMm - wallOff) < 1e-6);
  assert.ok(ret.handrail.totalLengthMm > full.handrail.totalLengthMm);
});

test('the edits are kept by the sanitizer only on a wall handrail; the plan draws its two end handles', () => {
  const raw = [{ id: 'a', side: 'outer', fromStep: 0, toStep: null, mount: 'wall', wallFromMm: 300.4, wallToMm: -5, wallHeightMm: 950, wallEnds: 'return' }, { id: 'b', side: 'inner', fromStep: 0, toStep: null, wallFromMm: 300 }];
  assert.deepEqual(sanitizeRailingSections(raw), [
    { id: 'a', side: 'outer', fromStep: 0, toStep: null, mount: 'wall', wallFromMm: 300, wallHeightMm: 950, wallEnds: 'return' },
    { id: 'b', side: 'inner', fromStep: 0, toStep: null },
  ]);
  const section = build({ wallFromMm: 300 });
  const xml = railingPostEditXML({ enabled: true, sections: [section], openingEdges: [] });
  assert.equal((xml.match(/class="railing-post-handle wall-rail-end"/g) || []).length, 2);
  assert.match(xml, /data-spot-key="wall-start" data-movable="1" data-moved="1"/);
  assert.match(xml, /data-spot-key="wall-end" data-movable="1" data-moved="0"/);
  assert.doesNotMatch(xml, /railing-path-hit/, 'no posts to add on a wall handrail');
});
