import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { claddingProjectToFile } from '../projectFile.js';
import { claddingAsFloor, buildCladdingFloorFromFile, CLADDING_PROJECT_TYPE } from '../floorStair.js';
import { registerReferenceBuilder, buildReferenceModel } from '../../geometry/referenceStair.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { createDefaultConfig } from '../../config/schema.js';
import { buildProjectPayload } from '../../project/projectIO.js';

// stage 3 part 2 (user decision 2026-11-04): a concrete project below / above a self-supporting one and vice versa,
// through the shared reference check (the app shell registers the module's builder — main.js)
registerReferenceBuilder(CLADDING_PROJECT_TYPE, buildCladdingFloorFromFile);

const claddingFile = (patch = {}) => claddingProjectToFile({ config: { ...createDefaultCladdingConfig(), ...patch }, projectName: 'Parter' });

test('the concrete stair as a floor: heights from the finished floor, the concrete underside, its opening', () => {
  const b = buildCladdingStair({ ...createDefaultCladdingConfig(), floorFinishBottomMm: 15 });
  const f = claddingAsFloor(b);
  assert.equal(f.fullConfig.totalRise, b.totalRise);
  assert.equal(f.treadModels.length, b.cladding.treads.length);
  const t0 = f.treadModels[0];
  assert.equal(t0.elevation.top, b.cladding.treads[0].topZ - 15, 'from the finished floor');
  assert.ok(t0.elevation.bottom < t0.elevation.top - 40, 'the concrete under it');
  assert.equal(f.ceilingFit.openingOutline, b.slab.opening);
  assert.equal(f.root, null);
  const withRoot = buildCladdingFloorFromFile(claddingFile());
  assert.ok(withRoot.root?.isObject3D);
  assert.equal(withRoot.root.getObjectByName('Room'), undefined, 'no walls / slab of its own in the other project');
});

test('a self-supporting project with the concrete stair below it: built by the module, placed, checked', () => {
  const lower = claddingFile();
  const built = buildStaircase({ ...createDefaultConfig(), stairPending: false, referenceStair: { name: 'Parter', level: 'below', file: lower, dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } });
  const ref = built.reference;
  assert.equal(ref.error, undefined);
  assert.equal(ref.other.kind, 'cladding');
  // below: its heights shifted down by its own rise
  assert.equal(ref.transform.dz, -ref.other.fullConfig.totalRise);
  assert.equal(ref.planDrawing.treads.length, ref.other.treadModels.length);
  assert.ok(built.referenceMesh?.isObject3D);
  assert.ok(Array.isArray(ref.clearances));
});

test('the concrete stair with a self-supporting floor above: the shared check from the module side', () => {
  // the self-supporting project file as saved
  const upper = JSON.parse(JSON.stringify(buildProjectPayload({ ...createDefaultConfig(), stairPending: false })));
  const own = claddingAsFloor(buildCladdingStair({ ...createDefaultCladdingConfig(), referenceFloor: { name: 'Piętro', level: 'above', file: upper, dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } }));
  const ref = buildReferenceModel(own, buildStaircase);
  assert.equal(ref.error, undefined);
  assert.equal(ref.level, 'above');
  assert.equal(ref.transform.dz, own.fullConfig.totalRise, 'above: it starts on our upper floor');
  // (placed over our opening: the clearances measured there, any clash reported by the shared rule)
  assert.ok(ref.clearances.length > 0, 'clearances measured inside our opening');
  assert.ok(ref.diagnostics.every((d) => d.ruleId === 'REFERENCE-STAIR-HEADROOM'));
});

// user request 2026-11-06: the linked floor showed only its stair — its slab (the upper floor's ceiling) and its walls
// as their own groups the view switches on / off
test('a linked floor brings its slab and walls along (ReferenceSlab / ReferenceWalls), the stair root without them', async () => {
  const { renderReferenceStair } = await import('../../geometry/referenceStairRenderer.js');
  registerReferenceBuilder(CLADDING_PROJECT_TYPE, buildCladdingFloorFromFile);
  // a concrete floor with walls (its slab off in its own view — still shown as the linked floor's ceiling)
  const walled = { ...createDefaultCladdingConfig(), showSlab: false, wallList: [{ id: 'a', flight: 0, side: 'left', type: 'full', from: null, to: null }] };
  const floor = buildCladdingFloorFromFile(claddingProjectToFile({ config: walled }));
  assert.ok(floor.slabMesh?.isObject3D, 'its slab');
  assert.ok(floor.wallsMesh?.isObject3D, 'its walls');
  assert.equal(floor.root.getObjectByName('Room'), undefined, 'not inside the stair root');
  // a self-supporting project linked to a concrete floor above: the 3D carries both groups
  const own = buildStaircase({ ...createDefaultConfig(), stairPending: false, referenceStair: { name: 'Piętro', level: 'above', file: claddingProjectToFile({ config: walled }), dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } });
  assert.ok(own.referenceMesh.getObjectByName('ReferenceSlab'), 'the slab group');
  assert.ok(own.referenceMesh.getObjectByName('ReferenceWalls'), 'the walls group');
  // a self-supporting floor (its ceilingMesh) linked from the concrete module
  const upper = JSON.parse(JSON.stringify(buildProjectPayload({ ...createDefaultConfig(), stairPending: false })));
  const fromModule = claddingAsFloor(buildCladdingStair({ ...createDefaultCladdingConfig(), referenceFloor: { name: 'Piętro', level: 'above', file: upper, dxMm: 0, dyMm: 0, rotationDeg: 0, mirror: false } }));
  const group = renderReferenceStair(buildReferenceModel(fromModule, buildStaircase));
  assert.ok(group.getObjectByName('ReferenceSlab'), 'a self-supporting floor’s ceiling');
});
