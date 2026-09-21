import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProjectPayloadV2, parseProjectJSON, parseProjectFile, CURRENT_PROJECT_VERSION } from '../projectIO.js';
import { createDefaultConfig } from '../../config/schema.js';

test('buildProjectPayloadV2: edgeOverrides live at the top level, not inside config', () => {
  const config = { ...createDefaultConfig(), stairWidth: 950, manualEdgeOverrides: { 3: { movedEndpoint: 'outer', point: { x: 1, y: 2 } } } };
  const payload = buildProjectPayloadV2(config);

  assert.equal(payload._version, 2);
  assert.equal(payload._type, 'schody3d-project');
  assert.equal(payload.config.stairWidth, 950);
  assert.equal(payload.config.manualEdgeOverrides, undefined, 'manualEdgeOverrides must not be nested inside config in the v2 file format');
  assert.deepEqual(payload.edgeOverrides, { 3: { movedEndpoint: 'outer', point: { x: 1, y: 2 } } });
});

test('parseProjectJSON: reads back a v2 payload unchanged (round trip)', () => {
  const config = { ...createDefaultConfig(), treadGoing: 260, manualEdgeOverrides: { 1: { movedEndpoint: 'inner', point: { x: 5, y: 6 } } } };
  const payload = buildProjectPayloadV2(config);
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

test('CURRENT_PROJECT_VERSION is 2', () => {
  assert.equal(CURRENT_PROJECT_VERSION, 2);
});

test('project metadata (name, notes, takeoff settings) round-trips at the top level, outside config', () => {
  const meta = { projectName: 'Dom Kowalskich', notes: 'Klient chce dąb', takeoffSettings: { priceList: [{ materialId: 'timber-c24', price: 5000, currency: 'PLN', unit: 'volume' }], wasteFactors: { TREAD: 0.12 } } };
  const payload = buildProjectPayloadV2(createDefaultConfig(), meta);
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
  const payload = buildProjectPayloadV2(createDefaultConfig());
  const { meta } = parseProjectFile(JSON.stringify(payload));
  assert.equal(meta.projectName, '');
  assert.equal(meta.notes, '');
  assert.equal(meta.takeoffSettings, null);
});

test('accepted validation waivers round-trip at the top level, outside config; older files load with none', () => {
  const waivers = [{ ruleId: 'PL-LEGAL-C-01', elementId: 'step-7', message: 'm', acceptedAt: '2026-01-01T00:00:00.000Z' }];
  const payload = buildProjectPayloadV2(createDefaultConfig(), { waivers });
  assert.equal(payload.config.waivers, undefined);
  assert.deepEqual(parseProjectFile(JSON.stringify(payload)).meta.waivers, waivers);
  assert.deepEqual(parseProjectFile(JSON.stringify(buildProjectPayloadV2(createDefaultConfig()))).meta.waivers, []);
});
