import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { housingDepthMm } from '../stringerModel.js';
import { unionRectangles } from '../rectUnion.js';
import { renderPlan2DSVG } from '../../plan2d/plan2dRenderer.js';

const built = (patch = {}) => buildStaircase({ ...createDefaultConfig(), ...patch });

function distToPath(p, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const c = path[i];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

test('housing depth is a parameter (default 20 mm): the tread enters a housed wanga by exactly that much', () => {
  const r = built();
  assert.equal(r.fullConfig.stringerHousingDepthMm, 20);
  assert.equal(housingDepthMm(r.fullConfig), 20);
  assert.equal(housingDepthMm({ ...r.fullConfig, stringerHousingDepthMm: 60 }), r.fullConfig.stringerThickness - 1, 'never right through the board');
});

// Regression: the recess moved each corner `depth` ALONG the tread's own edge; on a winder (diagonal edges) that gave
// a different distance from the wanga for every tread — a wavy stair edge — and the tread vertex in the outer corner
// did not move at all.
for (const patch of [{}, { turnDirection: 'left' }, { stairType: 'U' }, { stringerHousingDepthMm: 15 }]) {
  test(`every tread end on a housed side lies on the line parallel to its wanga (${JSON.stringify(patch)})`, () => {
    const r = built(patch);
    const recess = r.fullConfig.stringerThickness - housingDepthMm(r.fullConfig);
    for (const t of r.planLayout.treads) {
      for (const p of [t.frontEdge[1], t.backEdge[1]]) {
        assert.ok(Math.abs(distToPath(p, r.planLayout.outerFullPath) - recess) < 1e-6, `tread ${t.index + 1}: outer end ${distToPath(p, r.planLayout.outerFullPath).toFixed(2)} mm from the outer wanga line, expected ${recess}`);
      }
      const nearestOutline = Math.min(...t.outline.map((p) => distToPath(p, r.planLayout.outerFullPath)));
      assert.ok(nearestOutline >= recess - 1e-6, `tread ${t.index + 1}: a vertex (the outer corner) still reaches into the wanga (${nearestOutline.toFixed(2)} mm)`);
    }
    assert.equal(r.treadModels.filter((t) => t.frontEdge.overridden || t.backEdge.overridden).length, 0, 'the recess is never reported as a manual edit');
  });
}

test('rectangle union: overlapping -> one outline of the union area, disjoint -> two, touching -> merged', () => {
  const area = (poly) => Math.abs(poly.reduce((s, p, i) => s + p.u * poly[(i + 1) % poly.length].v - poly[(i + 1) % poly.length].u * p.v, 0)) / 2;
  const l = unionRectangles([{ uStart: 0, uEnd: 10, vBottom: 0, vTop: 2 }, { uStart: 0, uEnd: 2, vBottom: -5, vTop: 1 }]);
  assert.equal(l.length, 1);
  assert.equal(l[0].length, 6);
  assert.ok(Math.abs(area(l[0]) - (20 + 12 - 2)) < 1e-9); // 10x2 + 2x6 - the 2x1 overlap
  assert.equal(unionRectangles([{ uStart: 0, uEnd: 1, vBottom: 0, vTop: 1 }, { uStart: 3, uEnd: 4, vBottom: 0, vTop: 1 }]).length, 2);
  const touching = unionRectangles([{ uStart: 0, uEnd: 1, vBottom: 0, vTop: 1 }, { uStart: 1, uEnd: 2, vBottom: 0, vTop: 1 }]);
  assert.equal(touching.length, 1);
  assert.equal(touching[0].length, 4);
});

// Regression: a housed wanga's housings were drawn as boxes stuck ONTO its inner face (protrusions); they are real
// pockets cut into the board now — nothing of a wanga reaches past its own thickness.
for (const patch of [{}, { hasRiserBoards: true }, { turnDirection: 'left' }]) {
  test(`3D: a housed wanga has real pockets and nothing sticks out of its thickness (${JSON.stringify(patch)})`, () => {
    const r = built(patch);
    const t = r.fullConfig.stringerThickness;
    const pocketFloor = t - housingDepthMm(r.fullConfig);
    let meshes = 0;
    r.root.traverse((o) => {
      if (!o.isMesh || o.userData?.elementType !== 'stringer') return;
      meshes += 1;
      const side = o.userData.stringerId;
      const segId = o.userData.geometrySourceId.split(':')[2];
      const seg = r.stringerModels[side].segments.find((x) => x.id === segId);
      assert.ok(seg, `${o.userData.geometrySourceId} is a board, not a stuck-on box`);
      const pos = o.geometry.getAttribute('position');
      let floorVertices = 0;
      for (let i = 0; i < pos.count; i++) {
        const w = (pos.getX(i) - seg.referenceLine.start.x) * seg.inwardNormal.x + (-pos.getZ(i) - seg.referenceLine.start.y) * seg.inwardNormal.y;
        assert.ok(w > -1e-3 && w < t + 1e-3, `${segId}: a vertex ${w.toFixed(2)} mm across, outside the board's 0..${t}`);
        if (Math.abs(w - pocketFloor) < 1e-3) floorVertices += 1;
      }
      assert.ok(floorVertices > 0, `${segId}: no pocket floor`);
    });
    assert.equal(meshes, r.stringerModels.outer.segments.length + r.stringerModels.inner.segments.length);
    for (const side of ['outer', 'inner']) for (const g of r.stringerConstruction[side]) assert.ok(g.housingPockets.length > 0);
  });
}

test('plan 2D: each wanga board is drawn as its real footprint (one polygon per board), not a line on the chain', () => {
  const r = built();
  const svg = renderPlan2DSVG(r.planLayout, r.fullConfig, r.derived, {
    viewport: { centerX: 0, centerY: 0, scale: 1 },
    stringerModels: r.stringerModels,
    stringerConstruction: r.stringerConstruction,
  });
  for (const side of ['outer', 'inner']) {
    const group = svg.match(new RegExp(`<g class="stringer-path[^"]*" data-side="${side}">([\\s\\S]*?)</g>`))[1];
    assert.equal((group.match(/<polygon /g) || []).length, r.stringerModels[side].segments.length);
  }
});
