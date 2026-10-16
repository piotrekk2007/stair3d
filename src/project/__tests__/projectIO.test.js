import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProjectPayload, parseProjectJSON, parseProjectFile, CURRENT_PROJECT_VERSION } from '../projectIO.js';
import { createDefaultConfig } from '../../config/schema.js';

test('buildProjectPayload: edgeOverrides live at the top level, not inside config', () => {
  const config = { ...createDefaultConfig(), stairWidth: 950, manualEdgeOverrides: { 3: { movedEndpoint: 'outer', point: { x: 1, y: 2 } } } };
  const payload = buildProjectPayload(config);

  assert.equal(payload._version, CURRENT_PROJECT_VERSION);
  assert.equal(payload._type, 'schody3d-project');
  assert.equal(payload.config.stairWidth, 950);
  assert.equal(payload.config.manualEdgeOverrides, undefined, 'manualEdgeOverrides must not be nested inside config in the file format');
  assert.deepEqual(payload.edgeOverrides, { 3: { movedEndpoint: 'outer', point: { x: 1, y: 2 } } });
});

test('parseProjectJSON: reads back a v2 payload unchanged (round trip)', () => {
  const config = { ...createDefaultConfig(), treadGoing: 260, manualEdgeOverrides: { 1: { movedEndpoint: 'inner', point: { x: 5, y: 6 } } } };
  const payload = buildProjectPayload(config);
  const restored = parseProjectJSON(JSON.stringify(payload));

  assert.equal(restored.treadGoing, 260);
  assert.deepEqual(restored.manualEdgeOverrides, { 1: { movedEndpoint: 'inner', point: { x: 5, y: 6 } } });
});

test('parseProjectJSON: migrates a legacy v1 file (edgeOverrides nested in config)', () => {
  const v1Payload = {
    _type: 'schody3d-project',
    _version: 1,
    savedAt: '2020-01-01T00:00:00.000Z',
    config: {
      ...createDefaultConfig(),
      stairWidth: 800,
      manualEdgeOverrides: { 2: { movedEndpoint: 'outer', point: { x: 10, y: 20 } } },
    },
  };

  const restored = parseProjectJSON(JSON.stringify(v1Payload));
  assert.equal(restored.stairWidth, 800);
  assert.deepEqual(restored.manualEdgeOverrides, { 2: { movedEndpoint: 'outer', point: { x: 10, y: 20 } } });
});

test('parseProjectJSON: a v1 file with no manual overrides at all migrates to an empty edgeOverrides map', () => {
  const v1Payload = {
    _type: 'schody3d-project',
    _version: 1,
    config: { ...createDefaultConfig() },
  };
  delete v1Payload.config.manualEdgeOverrides;

  const restored = parseProjectJSON(JSON.stringify(v1Payload));
  assert.deepEqual(restored.manualEdgeOverrides, {});
});

test('parseProjectJSON: a file with no _version at all is treated as v1 and migrated', () => {
  const legacyPayload = {
    _type: 'schody3d-project',
    config: { ...createDefaultConfig(), manualEdgeOverrides: { 0: { movedEndpoint: 'inner', point: { x: 1, y: 1 } } } },
  };
  const restored = parseProjectJSON(JSON.stringify(legacyPayload));
  assert.deepEqual(restored.manualEdgeOverrides, { 0: { movedEndpoint: 'inner', point: { x: 1, y: 1 } } });
});

test('parseProjectJSON: rejects a file that is not a schody3d project', () => {
  assert.throws(() => parseProjectJSON(JSON.stringify({ hello: 'world' })), /nie jest plikiem projektu|_type/i);
});

test('parseProjectJSON: rejects invalid JSON', () => {
  assert.throws(() => parseProjectJSON('{not json'), /JSON/i);
});

test('CURRENT_PROJECT_VERSION is 6', () => {
  assert.equal(CURRENT_PROJECT_VERSION, 6);
});

test('migration v3 -> v4: one shared stringerConstructionType becomes the same value on both sides', () => {
  const v3 = {
    _type: 'schody3d-project',
    _version: 3,
    config: { ...createDefaultConfig(), stringerConstructionType: 'cut', lockedFields: ['stringerConstructionType', 'nosing'] },
    edgeOverrides: {},
  };
  delete v3.config.stringerConstructionTypeOuter;
  delete v3.config.stringerConstructionTypeInner;
  const { config, meta } = parseProjectFile(JSON.stringify(v3));
  assert.equal(config.stringerConstructionTypeOuter, 'cut');
  assert.equal(config.stringerConstructionTypeInner, 'cut');
  assert.equal(config.stringerConstructionType, undefined, 'the old shared name is gone, no alias is kept');
  assert.deepEqual(config.lockedFields, ['stringerConstructionTypeOuter', 'stringerConstructionTypeInner', 'nosing']);
  assert.equal(meta.schemaVersion, 6);
});

test('migration v1 -> v4 chains through v2 and v3', () => {
  const v1 = { _type: 'schody3d-project', _version: 1, config: { ...createDefaultConfig(), stringerConstructionType: 'closed', manualEdgeOverrides: { 2: { movedEndpoint: 'outer', point: { x: 1, y: 1 } } } } };
  delete v1.config.stringerConstructionTypeOuter;
  delete v1.config.stringerConstructionTypeInner;
  const config = parseProjectJSON(JSON.stringify(v1));
  assert.equal(config.stringerConstructionTypeOuter, 'closed');
  assert.equal(config.stringerConstructionTypeInner, 'closed');
  assert.deepEqual(config.manualEdgeOverrides, { 2: { movedEndpoint: 'outer', point: { x: 1, y: 1 } } });
});

test('v3: manual stringer PROFILE overrides live at the top level, outside config, and round-trip', () => {
  const overrides = { outer: { mode: 'MANUAL', lower: { 'support:step-3': { dn: 20, radiusMm: 60 } }, upper: {}, inserted: [] } };
  const config = { ...createDefaultConfig(), manualStringerProfileOverrides: overrides };
  const payload = buildProjectPayload(config);
  assert.equal(payload.config.manualStringerProfileOverrides, undefined, 'the override layer is not a solver input parameter');
  assert.deepEqual(payload.stringerProfileOverrides, overrides);
  assert.deepEqual(parseProjectJSON(JSON.stringify(payload)).manualStringerProfileOverrides, overrides);
});

test('v3: garbage in the profile override layer is repaired, never propagated', () => {
  const payload = buildProjectPayload(createDefaultConfig());
  payload.stringerProfileOverrides = { outer: { lower: { 'support:step-1': { dn: 'x', ds: 5 } }, inserted: [{ id: 1 }] }, middle: {} };
  assert.deepEqual(parseProjectJSON(JSON.stringify(payload)).manualStringerProfileOverrides, {
    outer: { mode: 'MANUAL', lower: { 'support:step-1': { ds: 5 } }, upper: {}, inserted: [] },
  });
});

test('migration v2 -> v3: stringerHeight becomes minimumStringerDepthMm (value and lock follow), overrides start empty', () => {
  const v2 = {
    _type: 'schody3d-project',
    _version: 2,
    config: { ...createDefaultConfig(), stringerHeight: 330, lockedFields: ['stringerHeight', 'nosing'] },
    edgeOverrides: {},
  };
  delete v2.config.minimumStringerDepthMm;
  const { config, meta } = parseProjectFile(JSON.stringify(v2));
  assert.equal(config.minimumStringerDepthMm, 330);
  assert.equal(config.stringerHeight, undefined, 'the old name is gone, no alias is kept');
  assert.deepEqual(config.lockedFields, ['minimumStringerDepthMm', 'nosing']);
  assert.deepEqual(config.manualStringerProfileOverrides, {});
  assert.equal(meta.schemaVersion, CURRENT_PROJECT_VERSION);
});

test('migration v1 -> v3 chains through v2', () => {
  const v1 = { _type: 'schody3d-project', _version: 1, config: { ...createDefaultConfig(), stringerHeight: 310, manualEdgeOverrides: { 2: { movedEndpoint: 'outer', point: { x: 1, y: 1 } } } } };
  delete v1.config.minimumStringerDepthMm;
  const config = parseProjectJSON(JSON.stringify(v1));
  assert.equal(config.minimumStringerDepthMm, 310);
  assert.deepEqual(config.manualEdgeOverrides, { 2: { movedEndpoint: 'outer', point: { x: 1, y: 1 } } });
});

test('project metadata (name, notes, takeoff settings) round-trips at the top level, outside config', () => {
  const meta = { projectName: 'Dom Kowalskich', notes: 'Klient chce dąb', takeoffSettings: { priceList: [{ materialId: 'timber-c24', price: 5000, currency: 'PLN', unit: 'volume' }], wasteFactors: { TREAD: 0.12 } } };
  const payload = buildProjectPayload(createDefaultConfig(), meta);
  assert.equal(payload.config.projectName, undefined, 'metadata must never leak into config (it is not a solver input)');
  assert.equal(payload._version, CURRENT_PROJECT_VERSION, 'adding optional metadata must not bump the schema version');

  const { config, meta: restored } = parseProjectFile(JSON.stringify(payload));
  assert.equal(config.stairType, createDefaultConfig().stairType);
  assert.equal(restored.projectName, 'Dom Kowalskich');
  assert.equal(restored.notes, 'Klient chce dąb');
  assert.equal(restored.takeoffSettings.wasteFactors.TREAD, 0.12);
  assert.equal(restored.schemaVersion, CURRENT_PROJECT_VERSION);
});

test('an older v2 file without metadata still loads, with empty metadata', () => {
  const payload = buildProjectPayload(createDefaultConfig());
  const { meta } = parseProjectFile(JSON.stringify(payload));
  assert.equal(meta.projectName, '');
  assert.equal(meta.notes, '');
  assert.equal(meta.takeoffSettings, null);
});

test('accepted validation waivers round-trip at the top level, outside config; older files load with none', () => {
  const waivers = [{ ruleId: 'PL-LEGAL-C-01', elementId: 'step-7', message: 'm', acceptedAt: '2026-01-01T00:00:00.000Z' }];
  const payload = buildProjectPayload(createDefaultConfig(), { waivers });
  assert.equal(payload.config.waivers, undefined);
  assert.deepEqual(parseProjectFile(JSON.stringify(payload)).meta.waivers, waivers);
  assert.deepEqual(parseProjectFile(JSON.stringify(buildProjectPayload(createDefaultConfig()))).meta.waivers, []);
});

test('migration v4 -> v6: the side-length fit ends as fixed / free sides (U: B and C fixed, A free)', () => {
  const v4 = {
    _type: 'schody3d-project',
    _version: 4,
    config: { ...createDefaultConfig(), stairType: 'U', stairwellFitEnabled: true, stairwellSideAMm: 2083, stairwellSideBMm: 1890, stairwellSideCMm: 2350, stairwellKeySide: 'C', stairwellManualCounts: true },
    edgeOverrides: {},
  };
  const { config, meta } = parseProjectFile(JSON.stringify(v4));
  assert.equal(meta.schemaVersion, 6);
  assert.equal(config.stairwellFitEnabled, false);
  assert.equal(config.stairwellRoomEnabled, true);
  assert.deepEqual([config.stairwellSideAMm, config.stairwellSideAFixed], [2083, false]);
  assert.deepEqual([config.stairwellSideBMm, config.stairwellSideBFixed], [1890, true]);
  assert.deepEqual([config.stairwellSideCMm, config.stairwellSideCFixed], [2350, true]);
  for (const k of ['stairwellRoomWidthMm', 'stairwellRoomLengthMm', 'stairwellEntrySide', 'stairwellEntryOffsetMm', 'stairwellExitSide']) assert.equal(config[k], undefined, k);
  // a project that did not use the fit gets no stairwell
  const plain = parseProjectFile(JSON.stringify({ ...v4, config: { ...createDefaultConfig(), stairwellFitEnabled: false } })).config;
  assert.equal(plain.stairwellRoomEnabled, false);
});

test('migration v5 -> v6: a room becomes sides; its opening moves to the wall frame (x from wall A, y from the far wall)', () => {
  const v5 = {
    _type: 'schody3d-project',
    _version: 5,
    config: { ...createDefaultConfig(), stairType: 'U', turnDirection: 'right', stairwellRoomEnabled: true, stairwellRoomWidthMm: 1888, stairwellRoomLengthMm: 2350, stairwellEntrySide: 'S', stairwellEntryOffsetMm: 300, openingOffsetX: 100, openingOffsetY: 200, openingWidth: 1000, openingLength: 1500, openingPolygon: [{ x: 0, y: 0 }, { x: 10, y: 50 }] },
    edgeOverrides: {},
  };
  const { config } = parseProjectFile(JSON.stringify(v5));
  assert.deepEqual([config.stairwellSideAMm, config.stairwellSideAFixed, config.stairwellSideBMm, config.stairwellSideBFixed, config.stairwellSideCMm, config.stairwellSideCFixed], [2050, false, 1888, true, 2350, true]);
  assert.equal(config.openingOffsetX, 100);
  assert.equal(config.openingOffsetY, 2350 - (200 + 1500));
  assert.deepEqual(config.openingPolygon, [{ x: 0, y: 2350 }, { x: 10, y: 2300 }]);
  // a left turn: wall A is the room's right wall
  const left = parseProjectFile(JSON.stringify({ ...v5, config: { ...v5.config, turnDirection: 'left' } })).config;
  assert.equal(left.openingOffsetX, 1888 - (100 + 1000));
});
