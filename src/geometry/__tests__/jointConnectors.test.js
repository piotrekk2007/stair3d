import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { vRangeWithin } from '../jointSolver.js';
import { segmentDistance3, connectorParams, CONNECTOR_EDGE_DISTANCE_FACTOR } from '../jointConnectors.js';
import { applyPricing, DEFAULT_PRICE_LIST } from '../../takeoff/index.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { summarizeByCategory } from '../../ui/takeoffView.js';
import { buildPostDXF, buildStringerBoardDXF } from '../../export/dxfExport.js';

const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...patch });
const connectorFindings = (m) => m.joints.diagnostics.filter((d) => d.ruleId.startsWith('JOINT-CONNECTOR') || d.ruleId === 'JOINT-POST-WEAKENED');
const NORMALS = { E: { x: 1, y: 0 }, N: { x: 0, y: 1 }, W: { x: -1, y: 0 }, S: { x: 0, y: -1 } };
function axis3(post, h) {
  const n = NORMALS[h.faceId];
  const a = { x: -n.y, y: n.x };
  const at = (k) => ({ x: post.position.x + n.x * k + a.x * h.s, y: post.position.y + n.y * k + a.y * h.s, z: h.z });
  return [at(post.size / 2), at(post.size / 2 - Math.min(h.depthMm, post.size))];
}

test('segmentDistance3: crossing, parallel and skew segments', () => {
  const o = (x, y, z) => ({ x, y, z });
  assert.equal(segmentDistance3(o(-1, 0, 0), o(1, 0, 0), o(0, -1, 0), o(0, 1, 0)), 0);
  assert.equal(segmentDistance3(o(-1, 0, 0), o(1, 0, 0), o(0, -1, 7), o(0, 1, 7)), 7);
  assert.equal(segmentDistance3(o(0, 0, 0), o(1, 0, 0), o(0, 3, 0), o(1, 3, 0)), 3);
  assert.ok(Math.abs(segmentDistance3(o(0, 0, 0), o(1, 0, 0), o(3, 4, 0), o(3, 5, 0)) - Math.hypot(2, 4)) < 1e-9);
});

test('every stringer joint gets its bolts: holes in the post (through, exit on the opposite face) and along the board to the nut bore', () => {
  const m = build({});
  const p = connectorParams(m.fullConfig);
  assert.equal(p.count, 2);
  const postJoints = m.joints.joints.filter((j) => j.type === 'STRINGER_POST_HOUSING');
  const buttJoints = m.joints.joints.filter((j) => j.type === 'STRINGER_STRINGER_BUTT');
  assert.ok(postJoints.length >= 3 && buttJoints.length >= 1);
  assert.equal(m.joints.connectors.length, p.count * (postJoints.length + buttJoints.length));
  for (const j of postJoints) {
    const bolts = m.joints.connectors.filter((c) => c.jointId === j.id);
    const post = m.postModels.find((x) => x.postId === j.postId);
    const g = m.stringerConstruction.inner.find((x) => x.segmentId === j.segmentId);
    const sec = vRangeWithin(g.outerContour, j.faceU, j.faceU);
    const zs = bolts.map((b) => b.z).sort((a, b) => a - b);
    assert.ok(Math.abs(zs[1] - zs[0] - p.spacingMm) < 1e-6, `${j.id}: spacing`);
    assert.ok(Math.abs((zs[0] + zs[1]) / 2 - bolts[0].shiftMm - (sec.min + sec.max) / 2) < 1e-6, `${j.id}: centred on the section (+ its recorded shift)`);
    for (const b of bolts) assert.equal(b.lengthMm, post.size + p.boardDepthMm, 'through the whole post + into the board to the nut');
    const holes = m.joints.holesByPost[j.postId].filter((h) => h.jointId === j.id);
    assert.equal(holes.filter((h) => !h.exit).length, p.count);
    for (const h of holes.filter((x) => !x.exit)) {
      assert.equal(h.faceId, j.pocket.faceId);
      const exit = holes.find((x) => x.exit && x.id === h.id);
      assert.ok(exit && exit.s === -h.s && exit.z === h.z, `${h.id}: exit hole on the opposite face`);
    }
    const into = j.end === 'end' ? -1 : 1;
    for (const h of m.joints.holesBySegment[j.segmentId].filter((x) => x.id.startsWith(j.id))) {
      assert.equal(h.kind, 'axial');
      assert.ok(Math.abs(h.u0 - (j.faceU - into * j.depthMm)) < 1e-6, 'starts at the board end (the pocket bottom)');
      assert.ok(Math.abs(h.u1 - (j.faceU + into * p.boardDepthMm)) < 1e-6, 'ends at the nut bore');
    }
  }
  for (const j of buttJoints) {
    const holesA = m.joints.holesBySegment[j.intoSegmentId].filter((h) => h.id.startsWith(j.id));
    const holesB = m.joints.holesBySegment[j.segmentId].filter((h) => h.id.startsWith(j.id));
    assert.equal(holesA.length, p.count);
    assert.ok(holesA.every((h) => h.kind === 'cross'), 'through board A');
    assert.ok(holesB.every((h) => h.kind === 'axial'), 'along board B');
  }
  assert.deepEqual(connectorFindings(m), []);
  // without connectors: nothing at all
  const none = build({ jointConnectorCount: 0 });
  assert.equal(none.joints.connectors.length, 0);
  assert.deepEqual(none.joints.holesBySegment, {});
});

// With risers the two inner boards enter the corner post's adjacent faces at almost the same height: centred, their
// through-holes cross inside the post. The solver moves the later group (as little as possible) so they clear.
test('holes of different joints never cross inside a post; a group is moved only as far as needed', () => {
  for (const patch of [{}, { hasRiserBoards: true }, { hasRiserBoards: true, turnDirection: 'left' }, { stairType: 'U', hasRiserBoards: true }, { windersPerTurn: 3 }]) {
    const m = build(patch);
    for (const [postId, holes] of Object.entries(m.joints.holesByPost)) {
      const post = m.postModels.find((x) => x.postId === postId);
      const drilled = holes.filter((h) => !h.exit);
      for (let a = 0; a < drilled.length; a++) {
        for (let b = a + 1; b < drilled.length; b++) {
          if (drilled[a].jointId === drilled[b].jointId) continue;
          const [p0, p1] = axis3(post, drilled[a]);
          const [q0, q1] = axis3(post, drilled[b]);
          assert.ok(segmentDistance3(p0, p1, q0, q1) >= (drilled[a].diameterMm + drilled[b].diameterMm) / 2 - 1e-6, `${JSON.stringify(patch)} ${drilled[a].id} x ${drilled[b].id}`);
        }
      }
    }
    for (const c of m.joints.connectors) assert.ok(Math.abs(c.shiftMm || 0) <= Math.max(connectorParams(m.fullConfig).spacingMm, 20));
    assert.deepEqual(connectorFindings(m), [], JSON.stringify(patch));
  }
  assert.ok(build({ hasRiserBoards: true }).joints.connectors.some((c) => c.shiftMm), 'the risers case really needed a shift');
});

test('findings: too shallow a section, unavoidable crossing, a weakened post, a blind bolt short of the pocket, nut bores overlapping', () => {
  // a cut board is only ~135 mm deep at the start newel: 2 bolts 120 mm apart cannot keep 3d from its edges
  const cut = build({ stringerConstructionTypeInner: 'cut' });
  const edge = connectorFindings(cut).filter((d) => d.ruleId === 'JOINT-CONNECTOR-EDGE');
  assert.equal(edge.length, 1);
  assert.equal(edge[0].elementId, 'post-start');
  assert.ok(edge[0].message.includes(`${CONNECTOR_EDGE_DISTANCE_FACTOR}d`));
  // many bolts close together on a thin post: crossings cannot be avoided, and the post loses most of its section
  const bad = build({ jointConnectorSpacingMm: 20, jointConnectorCount: 4, postSize: 80 });
  const ids = connectorFindings(bad).map((d) => d.ruleId);
  assert.ok(ids.includes('JOINT-CONNECTOR-CLASH'));
  assert.ok(ids.includes('JOINT-POST-WEAKENED'));
  assert.ok(ids.includes('JOINT-CONNECTOR-SPACING'), 'nut bores (O30) 20 mm apart overlap');
  // blind, not deeper than the housing: it does not hold in the post
  const short = build({ jointConnectorPostMode: 'blind', jointConnectorPostDepthMm: 20 });
  assert.ok(connectorFindings(short).some((d) => d.ruleId === 'JOINT-CONNECTOR-SHORT'));
  assert.ok(Object.values(short.joints.holesByPost).flat().every((h) => !h.exit), 'a blind hole has no exit');
  // every post with pockets or holes gets its weakest net section
  const m = build({});
  for (const w of Object.values(m.joints.postWeakening)) assert.ok(w.netFraction > 0.5 && w.netFraction < 1);
});

test('takeoff: one unpriced CONNECTOR item per joint, quantity = its bolts; its own summary line', () => {
  const m = build({});
  // (ungated: the default stair's takeoff is blocked by unrelated findings — the connectors don't depend on the gate)
  const priced = applyPricing(computeMaterialTakeoff(m, m.fullConfig), DEFAULT_PRICE_LIST);
  const items = priced.filter((i) => i.elementType === 'CONNECTOR');
  const joints = new Set(m.joints.connectors.map((c) => c.jointId));
  assert.equal(items.length, joints.size);
  for (const it of items) {
    assert.equal(it.quantity, 2);
    assert.equal(it.calculatedCost, null, 'bez ceny');
    assert.match(it.material, /^Śruba schodowa M10 × \d+$/);
  }
  const line = summarizeByCategory(priced).lines.find((l) => l.label === 'Łączniki (bez ceny)');
  assert.ok(line && line.unpriced === items.length && line.cost === 0);
  const none = build({ jointConnectorCount: 0 });
  assert.equal(computeMaterialTakeoff(none, none.fullConfig).filter((i) => i.elementType === 'CONNECTOR').length, 0);
});

test('DXF: the post shows a circle per hole (both faces when through), the board its bolt axes and nut bores', () => {
  const m = build({});
  const post = m.postModels.find((p) => p.postId === 'post-corner-0');
  const holes = m.joints.holesByPost[post.postId];
  const dxf = buildPostDXF(post, m.joints.pocketsByPost[post.postId], { holes, weakening: m.joints.postWeakening[post.postId] });
  assert.equal((dxf.match(/0\nCIRCLE\n8\nJOINTS\n/g) || []).length, holes.length);
  assert.match(dxf, /Otwory na laczniki: 4 \(przelotowe/);
  assert.match(dxf, /Najslabszy przekroj netto: \d+ %/);
  const g = m.stringerConstruction.inner[0];
  const segHoles = m.joints.holesBySegment[g.segmentId];
  const board = buildStringerBoardDXF(g, { config: m.fullConfig, holes: segHoles });
  assert.equal((board.match(/0\nCIRCLE\n8\nJOINTS\n/g) || []).length, segHoles.length, 'one nut bore per axial hole');
  assert.match(board, /gniazda nakretki O30/);
  assert.match(board, /Otwory na laczniki: 4/);
  // without holes the drawings are as before
  assert.ok(!buildStringerBoardDXF(g, { config: m.fullConfig }).includes('CIRCLE'));
});
