import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig, deriveStairData, deriveCeilingFit } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildTreadModels } from '../treadSolver.js';
import { checkCollisions } from '../../validator/checks.js';
import {
  resolveOpening,
  sanitizeOpeningPolygon,
  openingPolygonIssue,
  polygonContainsPolygon,
  moveOpeningVertex,
  insertOpeningVertex,
  removeOpeningVertex,
  alignedOpeningPolygon,
  rectangleOpeningPolygon,
} from '../ceilingOpening.js';
import { openingXML, openingDraftXML, planSvgBounds } from '../../plan2d/plan2dRenderer.js';
import { openingDrawClick } from '../../plan2d/planInteractions.js';
import { buildProjectPayload, parseProjectJSON } from '../../project/projectIO.js';
import { buildCeiling } from '../ceilingGeometry.js';

function stair(patch = {}) {
  const config = { ...createDefaultConfig(), ...patch };
  const derived = deriveStairData(config);
  const full = { ...config, riserHeight: derived.riserHeight };
  const layout = buildPlanLayout(full);
  return { config: full, layout, riserHeight: derived.riserHeight, treadModels: buildTreadModels(layout, full) };
}

// The previous rectangle-only check, kept here verbatim as the reference the rectangle mode must still match.
function oldViolating(config, planLayout, riserHeight) {
  const b = planLayout.bounds;
  const x0 = b.minX + config.openingOffsetX;
  const y0 = b.minY + config.openingOffsetY;
  const x1 = x0 + config.openingWidth;
  const y1 = y0 + config.openingLength;
  const danger = config.totalRise - config.ceilingThickness - config.minHeadroom;
  return planLayout.treads
    .filter((t) => (t.index + 1) * riserHeight > danger)
    .filter((t) => t.outline.some((p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1))
    .map((t) => t.index);
}

test('rectangle mode: the headroom check gives exactly what the old rectangle check gave', () => {
  for (const patch of [{}, { stairType: 'straight' }, { stairType: 'L', turnDirection: 'left' }]) {
    for (const [w, l, ox, oy] of [[1000, 2400, 0, 0], [900, 1800, 200, 600], [3000, 4000, -500, -300], [700, 800, 100, 2000]]) {
      const { config, layout, riserHeight } = stair({ ...patch, openingWidth: w, openingLength: l, openingOffsetX: ox, openingOffsetY: oy });
      const fit = deriveCeilingFit(config, layout, riserHeight);
      assert.deepEqual(fit.violatingTreads, oldViolating(config, layout, riserHeight), `${JSON.stringify(patch)} ${w}x${l}@${ox},${oy}`);
      assert.equal(fit.openingShape, 'rect');
    }
  }
});

test('a drawn polygon is used for the headroom check, the 3D hole outline and the bounding box', () => {
  const { config, layout, riserHeight } = stair({ stairType: 'straight' });
  const b = layout.bounds;
  const spanX = b.maxX - b.minX;
  const spanY = b.maxY - b.minY;
  // big enough to hold the whole stair: no collision
  const big = [{ x: -100, y: -100 }, { x: spanX + 100, y: -100 }, { x: spanX + 100, y: spanY + 100 }, { x: -100, y: spanY + 100 }];
  const fit = deriveCeilingFit({ ...config, openingShape: 'polygon', openingPolygon: big }, layout, riserHeight);
  assert.equal(fit.openingShape, 'polygon');
  assert.equal(fit.fits, true);
  assert.equal(fit.openingOutline.length, 4);
  assert.equal(fit.openMinX, b.minX - 100);
  assert.equal(fit.openMaxY, b.maxY + 100);
});

// A concave (L-shaped) opening: a tread whose corners are all inside can still cross the notch — vertices alone
// are not enough, the edges are checked too.
test('concave opening: a tread crossing the notch collides even with all its corners inside', () => {
  const outer = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 600, y: 1000 }, { x: 600, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 1000 }, { x: 0, y: 1000 }];
  const corners = [{ x: 100, y: 700 }, { x: 900, y: 700 }, { x: 900, y: 900 }, { x: 100, y: 900 }];
  assert.equal(polygonContainsPolygon(outer, corners), false, 'the tread spans the notch between the two arms');
  assert.equal(polygonContainsPolygon(outer, [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 300 }, { x: 100, y: 300 }]), true, 'wholly in the base of the U');
  assert.equal(polygonContainsPolygon(outer, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }]), true, 'touching the boundary counts as inside');
});

test('an invalid drawn polygon falls back to the rectangle and is reported, never silently fixed', () => {
  const { config, layout, riserHeight, treadModels } = stair({ stairType: 'straight' });
  const bowtie = [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
  assert.equal(openingPolygonIssue(bowtie), 'self-intersecting');
  const cfg = { ...config, openingShape: 'polygon', openingPolygon: bowtie };
  const fit = deriveCeilingFit(cfg, layout, riserHeight);
  assert.equal(fit.openingShape, 'rect');
  assert.equal(fit.openingInvalidReason, 'self-intersecting');
  assert.deepEqual(fit.violatingTreads, oldViolating(config, layout, riserHeight));
  const diags = checkCollisions(cfg, layout, riserHeight, treadModels);
  const invalid = diags.filter((d) => d.ruleId === 'CEILING-OPENING-INVALID');
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].severity, 'WARNING');
  assert.equal(openingPolygonIssue([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'too-few');
  assert.equal(openingPolygonIssue([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]), 'zero-area');
});

test('sanitize drops invalid and repeated points (a double-click adds no second point)', () => {
  assert.deepEqual(sanitizeOpeningPolygon([{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: NaN, y: 1 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 0.5 }]), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
  assert.deepEqual(sanitizeOpeningPolygon('nope'), []);
});

test('vertex edits: move, insert, remove (never below 3), align to a plan corner', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.deepEqual(moveOpeningVertex(sq, 2, { x: 150, y: 120 })[2], { x: 150, y: 120 });
  const ins = insertOpeningVertex(sq, 0, { x: 50, y: -20 });
  assert.equal(ins.length, 5);
  assert.deepEqual(ins[1], { x: 50, y: -20 });
  assert.equal(removeOpeningVertex(ins, 1).length, 4);
  const tri = sq.slice(0, 3);
  assert.equal(removeOpeningVertex(tri, 0), tri);
  const bounds = { minX: 1000, minY: 2000, maxX: 1900, maxY: 5000 };
  const aligned = alignedOpeningPolygon([{ x: 10, y: 10 }, { x: 310, y: 10 }, { x: 310, y: 210 }], bounds, { x: 'max', y: 'max' });
  assert.equal(Math.max(...aligned.map((p) => p.x)), 900);
  assert.equal(Math.max(...aligned.map((p) => p.y)), 3000);
});

test('resolveOpening: the rectangle as a polygon lands where the sliders put it', () => {
  const cfg = { ...createDefaultConfig(), openingOffsetX: 100, openingOffsetY: 200, openingWidth: 1000, openingLength: 2000 };
  const r = resolveOpening(cfg, { minX: 50, minY: -30, maxX: 0, maxY: 0 });
  assert.deepEqual([r.minX, r.minY, r.maxX, r.maxY], [150, 170, 1150, 2170]);
  assert.equal(rectangleOpeningPolygon(cfg).length, 4);
});

test('plan 2D: the opening layer, its edit handles, the drawing draft and the fit bounds', () => {
  const opening = { outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }], shape: 'polygon', invalidReason: null };
  const plain = openingXML(opening, false);
  assert.match(plain, /opening-body/);
  assert.match(plain, /pointer-events="none"/, 'not editing: does not block clicks on treads');
  assert.equal((plain.match(/opening-vertex/g) || []).length, 0);
  const edit = openingXML(opening, true);
  assert.equal((edit.match(/class="opening-vertex"/g) || []).length, 4);
  assert.equal((edit.match(/class="opening-mid"/g) || []).length, 4);
  assert.equal(openingXML(null), '');
  assert.equal(openingDraftXML([], null), '');
  assert.match(openingDraftXML([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { x: 0, y: 12 }), /stroke-dasharray/, 'closing hint once 3 points exist');
  const { layout } = stair({ stairType: 'straight' });
  const fb = planSvgBounds(layout, [{ x: layout.bounds.maxX + 500, y: layout.bounds.maxY + 700 }]);
  assert.equal(fb.maxX, layout.bounds.maxX + 500);
  assert.equal(fb.minY, -(layout.bounds.maxY + 700));
});

test('drawing: a click near the first point closes (3+ points), a repeated click adds nothing', () => {
  let s = openingDrawClick([], { x: 0, y: 0 }, 50);
  s = openingDrawClick(s.points, { x: 1000, y: 0 }, 50);
  s = openingDrawClick(s.points, { x: 1000, y: 0 }, 50);
  assert.equal(s.points.length, 2, 'double click on the same spot');
  s = openingDrawClick(s.points, { x: 30, y: 20 }, 50);
  assert.equal(s.closed, false, 'only 2 points so far — this one is a new point, not a close');
  s = openingDrawClick(s.points, { x: 1000, y: 800 }, 50);
  const closed = openingDrawClick(s.points, { x: 20, y: -10 }, 50);
  assert.equal(closed.closed, true);
  assert.equal(closed.points.length, 4);
});

test('the drawn opening survives a save/load of the project file; an older file without it stays a rectangle', () => {
  const poly = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 400, y: 600 }, { x: 400, y: 1500 }, { x: 0, y: 1500 }];
  const cfg = { ...createDefaultConfig(), openingShape: 'polygon', openingPolygon: poly };
  const loaded = parseProjectJSON(JSON.stringify(buildProjectPayload(cfg)));
  assert.equal(loaded.openingShape, 'polygon');
  assert.deepEqual(loaded.openingPolygon, poly);
  const old = buildProjectPayload(createDefaultConfig());
  delete old.config.openingShape;
  delete old.config.openingPolygon;
  const oldLoaded = parseProjectJSON(JSON.stringify(old));
  assert.equal(resolveOpening(oldLoaded, { minX: 0, minY: 0 }).shape, 'rect');
});

test('3D ceiling: the slab gets a hole with the drawn polygon\u2019s corners (an L gives 6)', () => {
  const { config, layout, riserHeight } = stair({ stairType: 'straight' });
  const poly = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 400, y: 600 }, { x: 400, y: 1500 }, { x: 0, y: 1500 }];
  const fit = deriveCeilingFit({ ...config, openingShape: 'polygon', openingPolygon: poly }, layout, riserHeight);
  const mesh = buildCeiling(fit, config);
  const hole = mesh.geometry.parameters.shapes.holes[0];
  const pts = hole.getPoints();
  const distinct = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6);
  const closedDup = distinct.length > 1 && Math.hypot(distinct[0].x - distinct[distinct.length - 1].x, distinct[0].y - distinct[distinct.length - 1].y) < 1e-6;
  assert.equal(distinct.length - (closedDup ? 1 : 0), 6);
});
