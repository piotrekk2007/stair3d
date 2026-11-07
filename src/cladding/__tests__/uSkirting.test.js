import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { boardPolygons } from '../finishModel.js';
import { pointInPolygon } from '../../geometry/polygonClip.js';

// user report 2026-11-06: on a U stair the skirting did not run along the landing's long (back) edge, and where it
// met that wall it ran into it
const steps = (n) => ({ kind: 'steps', count: n, riseMm: 180, goingMm: 270, widthMm: 1000 });
const build = (turn, style) => {
  const outer = turn === 'u-left' ? 'right' : 'left';
  return buildCladdingStair(
    sanitizeCladdingConfig({
      ...createDefaultCladdingConfig(),
      sequence: [steps(4), { kind: 'landing', riseMm: 180, depthMm: 1000, turn, gapMm: 200 }, steps(4)],
      wallList: [0, 1].map((flight) => ({ id: `w${flight}`, flight, side: outer, type: 'full', from: null, to: null })),
      skirtingEnabled: true,
      skirtingStyle: style,
    }),
  );
};
const faceLine = (k) => {
  const ss = boardPolygons(k).flat().map((p) => p.s);
  const at = (s) => ({ x: k.origin.x + k.dir.x * s, y: k.origin.y + k.dir.y * s });
  return [at(Math.min(...ss)), at(Math.max(...ss))];
};

for (const turn of ['u-left', 'u-right'])
  for (const style of ['raked', 'stepped'])
    test(`a U stair (${turn}, ${style}): skirting along the landing's back edge, corner to corner, none in a wall`, () => {
      const b = build(turn, style);
      const landing = b.concrete.elements.find((e) => e.kind === 'landing');
      const back = landing.edges.find((e) => e.role === 'back');
      const endBoard = b.finish.skirting.find((k) => /-end$/.test(k.id));
      assert.ok(endBoard, 'a skirting board on the back edge');
      // on the back wall's face, from one corner to the other, its thickness into the stair (toward the landing)
      const [p, q] = faceLine(endBoard);
      for (const pt of [p, q]) assert.ok(Math.abs(pt.y - back.a.y) < 1e-6, `on the back edge's line: ${pt.y}`);
      assert.ok(Math.abs(Math.abs(q.x - p.x) - Math.abs(back.b.x - back.a.x)) < 1e-6, 'corner to corner');
      assert.ok(endBoard.normal.y < -0.99, 'into the stair');
      assert.ok(endBoard.corners?.start && endBoard.corners?.end, 'cut at both corners (it meets both flights’ boards)');
      // the return flight's board starts at the back corner (the landing's side on its line is skirted too)
      const returnBoard = b.finish.skirting.find((k) => k.key.flight === 1 && !/-end/.test(k.id));
      assert.ok(faceLine(returnBoard).some((pt) => Math.abs(pt.y - back.a.y) < 1e-6), 'the return flight’s board from the back corner');
      // no part of any board inside a wall
      for (const k of b.finish.skirting)
        for (const poly of boardPolygons(k))
          for (const pt of poly)
            for (const depth of [1, k.thicknessMm / 2, k.thicknessMm - 1]) {
              let s = pt.s;
              for (const c of [k.corners?.start, k.corners?.end].filter(Boolean)) if (Math.abs(pt.s - c.s) < 0.5) s += c.k * depth;
              const x = { x: k.origin.x + k.dir.x * s + k.normal.x * depth, y: k.origin.y + k.dir.y * s + k.normal.y * depth };
              for (const w of b.walls) assert.ok(!pointInPolygon(x, w.outline), `${k.id} at s ${Math.round(pt.s)} in the wall`);
            }
    });
