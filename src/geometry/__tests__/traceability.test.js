// Every rendered mesh must carry traceability userData (elementType/stepId/stringerId/
// geometrySourceId — src/scene/traceability.js) so a 3D element can be traced back to its 2D
// model source (see src/scene/elementInspector.js for the reverse lookup). These tests build
// real geometry and inspect the resulting THREE.Object3D tree — the one place in this test
// suite that legitimately touches Three.js, since userData tagging is a renderer-level
// concern by definition.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { buildRiserModels } from '../riserSolver.js';
import { buildStringerModelsForFlight } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { buildPostModels } from '../postSolver.js';
import { renderTreads } from '../treadRenderer.js';
import { renderRisers } from '../riserRenderer.js';
import { renderStringers } from '../stringerRenderer.js';
import { renderPosts } from '../postRenderer.js';

const MATERIAL = {}; // renderers only assign it, never read it — a plain stand-in is fine

function build(configPatch) {
  const config = { ...createDefaultConfig(), hasRiserBoards: true, hasCornerPost: true, ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  const stringerModels = buildStringerModelsForFlight(planLayout, fullConfig);
  return {
    config: fullConfig,
    planLayout,
    treadModels: buildTreadModels(planLayout, fullConfig),
    riserModels: buildRiserModels(planLayout, fullConfig),
    stringerModels,
    stringerConstruction: {
      outer: buildStringerConstructionGeometry(stringerModels.outer, fullConfig),
      inner: buildStringerConstructionGeometry(stringerModels.inner, fullConfig),
    },
    postModels: buildPostModels(planLayout, fullConfig),
  };
}

test('every tread mesh carries elementType/stepId/geometrySourceId matching its TreadModel', () => {
  const { treadModels } = build({ stairType: 'straight', treadsLegA: 5 });
  const group = renderTreads(treadModels, MATERIAL);
  assert.equal(group.children.length, treadModels.length);
  group.children.forEach((mesh, i) => {
    assert.equal(mesh.userData.elementType, 'tread');
    assert.equal(mesh.userData.stepId, treadModels[i].stepId);
    assert.equal(mesh.userData.stringerId, null);
    assert.equal(mesh.userData.geometrySourceId, `tread:${treadModels[i].stepId}`);
  });
});

test('every riser panel mesh carries stepId + a panel-indexed geometrySourceId', () => {
  const { riserModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5 });
  const group = renderRisers(riserModels, MATERIAL);
  assert.ok(group.children.length > 0);
  for (const mesh of group.children) {
    assert.equal(mesh.userData.elementType, 'riser');
    assert.match(mesh.userData.stepId, /^step-\d+$/);
    assert.match(mesh.userData.geometrySourceId, /^riser:step-\d+:panel-\d+$/);
  }
  // geometrySourceId must be unique per mesh — no two panels collapse onto the same source id.
  const ids = group.children.map((m) => m.userData.geometrySourceId);
  assert.equal(new Set(ids).size, ids.length);
});

test('every stringer board mesh carries the correct side as stringerId, and every cleat/housing sub-mesh carries its own supported tread as stepId', () => {
  const { stringerModels, stringerConstruction } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, stringerConstructionType: 'cut' });
  for (const side of ['outer', 'inner']) {
    const group = renderStringers(stringerModels[side], stringerConstruction[side], MATERIAL, `Stringer${side}`);
    assert.ok(group.children.length > 0);
    for (const mesh of group.children) {
      assert.equal(mesh.userData.elementType, 'stringer');
      assert.equal(mesh.userData.stringerId, side);
      if (mesh.name.endsWith('_board')) {
        // The board mesh spans many treads — it has no single stepId.
        assert.equal(mesh.userData.stepId, null);
        assert.match(mesh.userData.geometrySourceId, new RegExp(`^stringer:${side}:${side}-seg-\\d+$`));
      } else {
        // A cleat (or, for 'closed', a housing indicator) supports exactly one tread.
        assert.match(mesh.userData.stepId, /^step-\d+$/);
      }
    }
  }
});

test('every post mesh carries elementType + geometrySourceId, and stepId is null (posts are not tread-specific)', () => {
  const { postModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 2, treadsLegB: 2, windersPerTurn: 5, hasCornerPost: true });
  const group = renderPosts(postModels, MATERIAL);
  assert.ok(group.children.length > 0);
  for (const mesh of group.children) {
    assert.equal(mesh.userData.elementType, 'post');
    assert.equal(mesh.userData.stepId, null);
    assert.equal(mesh.userData.stringerId, null);
    assert.ok(mesh.userData.geometrySourceId.startsWith('post:'));
  }
});

test('geometrySourceId is globally unique across every element in a full winder scenario', () => {
  const { treadModels, riserModels, stringerModels, stringerConstruction, postModels } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 });
  const allIds = [
    ...renderTreads(treadModels, MATERIAL).children,
    ...renderRisers(riserModels, MATERIAL).children,
    ...renderStringers(stringerModels.outer, stringerConstruction.outer, MATERIAL, 'StringerOuter').children,
    ...renderStringers(stringerModels.inner, stringerConstruction.inner, MATERIAL, 'StringerInner').children,
    ...renderPosts(postModels, MATERIAL).children,
  ].map((m) => m.userData.geometrySourceId);
  assert.equal(new Set(allIds).size, allIds.length, 'every element must have a globally unique geometrySourceId');
});
