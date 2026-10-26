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
