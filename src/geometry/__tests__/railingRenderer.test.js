import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { renderRailing } from '../railingRenderer.js';
import { runTakeoffValidationGate } from '../../takeoff/validationGate.js';

function stair(patch = {}) {
  const config = {
    ...createDefaultConfig(),
    stairType: 'straight',
    treadsLegA: 8,
    totalRise: 2000,
    railingEnabled: true,
    railingSections: [{ id: 's', side: 'outer', fromStep: 0, toStep: null }],
    ...patch,
  };
  return { config, result: buildStaircase(config) };
}

const bounds = (mesh) => new THREE.Box3().setFromObject(mesh);

test('no balustrade group when it is switched off or has no sections', () => {
  assert.equal(stair({ railingEnabled: false }).result.root.getObjectByName('Railing'), undefined);
  const { result } = stair({ railingSections: [] });
  assert.equal(result.railingModel.sections.length, 0);
  assert.equal(result.root.getObjectByName('Railing').children.length, 0);
});

test('one handrail mesh and one balusters mesh per section (traceable); the end posts are ordinary posts in the Posts group', () => {
  const { result } = stair();
  const group = result.root.getObjectByName('Railing');
  const names = group.children.map((c) => c.name);
  assert.deepEqual(names.sort(), ['Railing_s_balusters', 'Railing_s_handrail']);
  for (const child of group.children) {
    assert.equal(child.userData.elementType, 'railing');
    assert.ok(child.userData.geometrySourceId.startsWith('railing:'));
  }
  const railingPosts = result.railingModel.sections[0].posts;
  assert.ok(railingPosts.length > 0);
  const postNames = result.root.getObjectByName('Posts').children.map((c) => c.name);
  for (const post of railingPosts) assert.ok(postNames.includes(`Post_Railing_${post.postId}`), post.postId);
  assert.ok(result.postModels.some((p) => p.kind === 'railing') && result.allPostModels.some((p) => p.kind === 'railing'));
});

test('the balusters mesh spans exactly the solver\'s heights; the handrail top sits railingHeightMm above the nosing line at its start', () => {
  const { config, result } = stair();
  const section = result.railingModel.sections[0];
  const group = result.root.getObjectByName('Railing');
  const balusters = bounds(group.getObjectByName('Railing_s_balusters'));
  assert.ok(Math.abs(balusters.min.y - Math.min(...section.balusters.map((b) => b.zBottom))) < 1e-2);
  assert.ok(Math.abs(balusters.max.y - Math.max(...section.balusters.map((b) => b.zTop))) < 1e-2);
  const handrail = bounds(group.getObjectByName('Railing_s_handrail'));
  const riserHeight = deriveStairData(config).riserHeight;
  const topAtEnd = 9 * riserHeight + config.railingHeightMm; // the nosing line ends at the back of tread 8: (8+1) risers up
  assert.ok(handrail.max.y > riserHeight + config.railingHeightMm);
  assert.ok(handrail.max.y <= topAtEnd + config.railingHandrailHeightMm, 'never above the end of the nosing line plus the profile');
});

test('the balusters mesh uses its own material, separate from the handrail\'s', () => {
  const { result } = stair();
  const group = result.root.getObjectByName('Railing');
  const handrail = group.getObjectByName('Railing_s_handrail');
  const balusters = group.getObjectByName('Railing_s_balusters');
  assert.notEqual(handrail.material, balusters.material);
  balusters.material.color.set('#1a1a1a');
  assert.notEqual(handrail.material.color.getHexString(), balusters.material.color.getHexString());
});

test('round profiles build too (round handrail + round balusters)', () => {
  const { result } = stair({ railingHandrailShape: 'round', railingBalusterShape: 'round' });
  const group = result.root.getObjectByName('Railing');
  assert.ok(group.getObjectByName('Railing_s_balusters').geometry.getAttribute('position').count > 0);
  assert.ok(group.getObjectByName('Railing_s_handrail').geometry.getAttribute('position').count > 0);
});

test('an invalid section renders nothing and does not throw', () => {
  const { result } = stair({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 6, toStep: 2 }] });
  assert.equal(result.root.getObjectByName('Railing').children.length, 0);
  assert.equal(result.railingModel.diagnostics.length, 1);
  assert.equal(typeof renderRailing, 'function');
});

test('a stale/invalid balustrade section shows up in the validation gate (Walidacja), as a WARNING that does not block the takeoff', () => {
  const { result } = stair({ railingSections: [{ id: 'bad', side: 'outer', fromStep: 6, toStep: 2 }] });
  const gate = runTakeoffValidationGate(result);
  const finding = gate.diagnostics.find((d) => d.ruleId === 'RAILING-SECTION-INVALID');
  assert.ok(finding);
  assert.equal(finding.severity, 'WARNING');
  const baseline = runTakeoffValidationGate(stair({ railingSections: [] }).result);
  assert.equal(gate.errors.length, baseline.errors.length, 'the railing warning adds no ERROR, so it can never block the takeoff');
});

// ---- reported: "after I move the handrail's end it no longer reaches the post" ----
test('a post a handrail ends at always reaches the handrail\'s top — structural newels too, and after the end is moved by hand', () => {
  const base = { stairType: 'L', treadsLegA: 4, treadsLegB: 4, windersPerTurn: 4, totalRise: 2600 };
  for (const side of ['inner', 'outer']) {
    for (const off of [0, 150, -150]) {
      const sections = [{ id: 's', side, fromStep: 0, toStep: null }];
      const plain = stair({ ...base, railingSections: sections }).result;
      const railingEndOffsets = {};
      for (const r of plain.railingModel.sections[0].runs) {
        railingEndOffsets[`s|${r.endPostId}|end`] = off;
        railingEndOffsets[`s|${r.startPostId}|start`] = off;
      }
      const m = stair({ ...base, railingSections: sections, railingEndOffsets }).result;
      const half = m.fullConfig.railingHandrailHeightMm / 2;
      for (const run of m.railingModel.sections[0].runs) {
        for (const [pt, postId] of [[run.pieces[0].start, run.startPostId], [run.pieces[run.pieces.length - 1].end, run.endPostId]]) {
          const post = m.postModels.find((p) => p.postId === postId);
          assert.ok(post, `${side} ${off}: ${postId} exists`);
          assert.ok(post.elevation.top >= pt.z + half - 1e-6, `${side} ${off}: ${postId} top ${post.elevation.top.toFixed(0)} below the handrail top ${(pt.z + half).toFixed(0)}`);
          assert.ok(post.elevation.bottom <= pt.z - half + 1e-6, `${side} ${off}: ${postId} starts above the handrail's underside`);
        }
      }
    }
  }
  // the start newel of a plain inner balustrade is taller than its own nominal 1000 mm: raised to the handrail
  const m = stair({ ...base, railingSections: [{ id: 's', side: 'inner', fromStep: 0, toStep: null }] }).result;
  assert.equal(m.postModels.find((p) => p.postId === 'post-start').raisedForHandrail, true);
  // a manual length correction still applies on top of the raised height
  const cut = stair({ ...base, railingSections: [{ id: 's', side: 'inner', fromStep: 0, toStep: null }], manualPostOverrides: { 'post-start': { topDeltaMm: 80 } } }).result;
  const a = m.postModels.find((p) => p.postId === 'post-start');
  const b = cut.postModels.find((p) => p.postId === 'post-start');
  assert.ok(Math.abs(b.elevation.top - (a.elevation.top + 80)) < 1e-6);
});

test('a handrail piece is cut PLUMB at its ends: its mesh stops exactly on the post faces (no wedge gap, nothing inside the post) and keeps the profile height', () => {
  const { result } = stair({ stringerConstructionTypeOuter: 'closed', stringerConstructionTypeInner: 'closed' });
  const section = result.railingModel.sections[0];
  assert.equal(section.handrail.pieces.length, 1);
  const piece = section.handrail.pieces[0];
  const mesh = result.root.getObjectByName('Railing_s_handrail');
  const pos = mesh.geometry.getAttribute('position');
  // plan (x, y) -> world (x, -z); the run goes along plan +y
  let minY = Infinity;
  let maxY = -Infinity;
  const tops = [];
  for (let i = 0; i < pos.count; i++) {
    const planY = -pos.getZ(i);
    minY = Math.min(minY, planY);
    maxY = Math.max(maxY, planY);
  }
  assert.ok(Math.abs(minY - piece.start.y) < 0.01 && Math.abs(maxY - piece.end.y) < 0.01, `mesh spans ${minY.toFixed(1)}..${maxY.toFixed(1)}, the piece ${piece.start.y.toFixed(1)}..${piece.end.y.toFixed(1)}`);
  // at the start face: the profile's vertical size is height / cos(pitch), centred on the piece's start
  for (let i = 0; i < pos.count; i++) if (Math.abs(-pos.getZ(i) - piece.start.y) < 0.01) tops.push(pos.getY(i)); // (float32 vertices)
  const slope = (piece.end.z - piece.start.z) / (piece.end.y - piece.start.y);
  const vertical = section.handrail.heightMm * Math.hypot(1, slope);
  assert.ok(Math.abs(Math.max(...tops) - (piece.start.z + vertical / 2)) < 0.01 && Math.abs(Math.min(...tops) - (piece.start.z - vertical / 2)) < 0.01);
});
