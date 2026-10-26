import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { openingTrimXML } from '../../plan2d/plan2dRenderer.js';
import { signedPolygonArea } from '../pathUtils.js';

// a straight stair under a rectangular opening (no stairwell walls): every edge but the stair's own stretch is free
const stair = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairType: 'straight', treadsLegA: 12, totalRise: 2600, treadThickness: 40, openingTrimEnabled: true, ...patch });

test('the opening trim ("fajka", user request 2026-10-26): a nose as thick as a tread standing out into the opening, a thin board LYING ON the slab behind it (regression: it was sunk into the slab), their tops flush', () => {
  const b = stair();
  const trim = b.openingTrim;
  assert.ok(trim.enabled && trim.pieces.length > 0);
  for (const p of trim.pieces) {
    const nose = p.solids.find((s) => s.kind === 'nose');
    const board = p.solids.find((s) => s.kind === 'board');
    assert.equal(board.zBottom, 2600, 'the board on the slab');
    assert.equal(board.zTop, 2615, 'the board: 15 mm');
    assert.equal(nose.zTop, 2615);
    assert.equal(nose.zBottom, 2575, 'the nose: the tread thickness');
    // the nose lies on the opening's side of the edge (inside the opening outline), the board on the slab's
    const inside = (pt) => {
      const o = b.ceilingFit.openingOutline;
      let c = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) if ((o[i].y > pt.y) !== (o[j].y > pt.y) && pt.x < ((o[j].x - o[i].x) * (pt.y - o[i].y)) / (o[j].y - o[i].y) + o[i].x) c = !c;
      return c;
    };
    const mid = (s) => ({ x: s.outline.reduce((a, q) => a + q.x, 0) / 4, y: s.outline.reduce((a, q) => a + q.y, 0) / 4 });
    assert.ok(inside(mid(nose)), `${p.id}: the nose in the opening`);
    assert.ok(!inside(mid(board)), `${p.id}: the board on the slab`);
    assert.ok(Math.abs(Math.abs(signedPolygonArea(nose.outline)) / Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) - 20) < 1.5, 'a 20 mm wide nose (mitres aside)');
  }
  // the nose can be made taller — down to covering the slab's edge
  const tall = stair({ openingTrimNoseHeightMm: 250 });
  assert.equal(tall.openingTrim.pieces[0].solids[0].zBottom, 2365);
});

test('trim pieces meeting at a corner of the opening are mitred: the two bands share their corner points', () => {
  const trim = stair().openingTrim;
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  let mitres = 0;
  for (const p of trim.pieces) {
    const next = trim.pieces.find((q) => q !== p && near(q.a, p.b));
    if (!next) continue;
    const [pn, qn] = [p, next].map((x) => x.solids.find((s) => s.kind === 'nose').outline);
    // p's end corners (outline[1], outline[2]) are next's start corners (outline[0], outline[3])
    assert.ok(near(pn[1], qn[0]) && near(pn[2], qn[3]), `${p.id} -> ${next.id}`);
    mitres++;
  }
  assert.ok(mitres >= 2);
});

test('an edge switched off by hand has no trim; the takeoff has one item per piece, priced as a board of the nose height', () => {
  const b = stair();
  const edge = b.openingTrim.pieces[0].edge;
  const off = stair({ openingTrimEdges: { [edge]: false } });
  assert.ok(!off.openingTrim.pieces.some((p) => p.edge === edge));
  assert.equal(off.openingTrim.edges.find((e) => e.index === edge).enabled, false);
  const items = computeMaterialTakeoff(b, b.fullConfig).filter((i) => i.elementType === 'OPENING_TRIM');
  assert.equal(items.length, b.openingTrim.pieces.length);
  assert.equal(items[0].calculatedDimensions.thicknessMm, 40);
  assert.equal(items[0].calculatedDimensions.widthMm, 120);
  // switched off: no element at all
  assert.equal(stair({ openingTrimEnabled: false }).openingTrim.enabled, false);
});

test('the plan draws the trim, and in the "▬ Fajka" mode every opening edge is clickable', () => {
  const trim = stair().openingTrim;
  const xml = openingTrimXML(trim, true);
  assert.equal((xml.match(/class="opening-trim"/g) || []).length, trim.pieces.length * 2);
  assert.equal((xml.match(/class="trim-opening-edge"/g) || []).length, trim.edges.length);
  assert.equal((openingTrimXML(trim, false).match(/trim-opening-edge/g) || []).length, 0);
});

test('regression (user, 2026-10-26): an opening edge along a stairwell wall is off by default, but switched on it gets the trim along its whole length — the wall does not cut it out as it does the balustrade', () => {
  const cfg = { ...createDefaultConfig(), stairType: 'L', turnDirection: 'left', treadsLegA: 5, treadsLegB: 4, windersPerTurn: 3, totalRise: 2800, stairwellRoomEnabled: true, openingTrimEnabled: true, openingMode: 'derived' };
  const b = buildStaircase(cfg);
  const wallEdge = b.openingTrim.edges.find((e) => e.wall);
  assert.ok(wallEdge, 'an edge along a wall');
  assert.equal(wallEdge.enabled, false);
  assert.ok(!b.openingTrim.pieces.some((p) => p.edge === wallEdge.index));
  const on = buildStaircase({ ...cfg, openingTrimEdges: { [wallEdge.index]: true } });
  const pieces = on.openingTrim.pieces.filter((p) => p.edge === wallEdge.index);
  assert.equal(pieces.length, 1);
  assert.ok(Math.abs(Math.hypot(pieces[0].b.x - pieces[0].a.x, pieces[0].b.y - pieces[0].a.y) - Math.hypot(wallEdge.b.x - wallEdge.a.x, wallEdge.b.y - wallEdge.a.y)) < 0.5, 'the whole edge');
});

test('regression (user, 2026-10-26): the opening balustrade stands in the trim — posts and balusters through it, the handrail measured from its top; without the trim on the floor as before', () => {
  const on = stair({ railingOpeningEnabled: true, railingOpeningHeightMm: 1000 });
  const sec = on.railingModel.sections.find((s) => s.kind === 'opening');
  assert.ok(sec && sec.balusters.length > 0);
  // (set in holes through the trim, down to the slab — the handrail measured from the trim's top)
  assert.ok(sec.balusters.every((b) => b.zBottom === 2600), 'in its hole, on the slab');
  assert.ok(sec.posts.every((p) => p.elevation.bottom === 2600));
  assert.equal(sec.handrail.pieces[0].start.z, 2615 + 1000 - on.fullConfig.railingHandrailHeightMm / 2);
  const off = stair({ railingOpeningEnabled: true, railingOpeningHeightMm: 1000, openingTrimEnabled: false });
  assert.ok(off.railingModel.sections.find((s) => s.kind === 'opening').balusters.every((b) => b.zBottom === 2600));
});

test('the trim DXF: one sheet, every piece in plan with its end cuts and the profile', async () => {
  const { buildOpeningTrimDXF } = await import('../../export/dxfExport.js');
  const b = stair();
  const dxf = buildOpeningTrimDXF(b.openingTrim);
  assert.ok(dxf.startsWith('0\nSECTION') || dxf.includes('ENTITIES'));
  for (const p of b.openingTrim.pieces) assert.ok(dxf.includes(p.id), p.id);
  assert.ok(/ciecie na koncach: 45\.0 st\./.test(dxf), 'a mitred end');
  assert.ok(dxf.includes('przekroj'));
  assert.equal(buildOpeningTrimDXF(stair({ openingTrimEnabled: false }).openingTrim), null);
});

test('regression (user, 2026-10-26): the trim has a hole for every post and baluster of the opening balustrade standing on it, through the trim — in the model, the 3D mesh and the DXF', async () => {
  const b = stair({ railingOpeningEnabled: true });
  const sec = b.railingModel.sections.find((s) => s.kind === 'opening');
  const holes = b.openingTrim.pieces.flatMap((p) => p.holes);
  assert.equal(holes.filter((h) => h.kind === 'baluster').length, sec.balusters.length);
  assert.equal(holes.filter((h) => h.kind === 'post').length, sec.posts.filter((p) => !p.removed).length);
  assert.ok(holes.every((h) => h.depthMm === 15), 'through the board');
  // 3D: the board with holes has more triangles than without
  const plain = stair().root.getObjectByName('OpeningTrim').children.find((m) => m.name.endsWith('_board'));
  const holed = b.root.getObjectByName('OpeningTrim').children.find((m) => m.name === plain.name);
  assert.ok(holed.geometry.getAttribute('position').count > plain.geometry.getAttribute('position').count);
  const { buildOpeningTrimDXF } = await import('../../export/dxfExport.js');
  assert.ok(/otwory na wylot: \d+ x slupek \d+ x \d+, \d+ x tralka/.test(buildOpeningTrimDXF(b.openingTrim)));
});

test('regression (user, 2026-10-26): the trim at the stair EXIT — its own piece between the wangi, on by default, its own switch; the top riser ends under its nose', () => {
  // (the opening derived from the stair: its exit edge where the stair arrives)
  const b = stair({ hasRiserBoards: true, riserBoardThickness: 16, openingMode: 'derived' });
  const exit = b.openingTrim.pieces.find((p) => p.exit);
  assert.ok(exit, 'the exit piece');
  assert.equal(exit.id, 'opening-trim-exit');
  // between the wangi's inner faces: the stair's width less two boards
  const t = b.fullConfig.stringerThickness;
  assert.ok(Math.abs(Math.hypot(exit.b.x - exit.a.x, exit.b.y - exit.a.y) - (b.fullConfig.stairWidth - 2 * t)) < 0.5);
  const top = b.riserModels.find((r) => r.riserId === 'riser-top');
  assert.equal(top.elevation.top, 2615 - 40 + b.fullConfig.riserTopOverlapMm, 'under the nose (+ the overlap into it)');
  const off = stair({ hasRiserBoards: true, riserBoardThickness: 16, openingMode: 'derived', openingTrimExit: false });
  assert.ok(!off.openingTrim.pieces.some((p) => p.exit));
  assert.equal(off.openingTrim.exit.enabled, false);
  assert.equal(off.riserModels.find((r) => r.riserId === 'riser-top').elevation.top, 2600 - off.fullConfig.topNosingThicknessMm + off.fullConfig.riserTopOverlapMm);
  assert.ok(/class="trim-exit-edge"/.test(openingTrimXML(b.openingTrim, true)));
});
