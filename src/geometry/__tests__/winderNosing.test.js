import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { parseProjectFile } from '../../project/projectIO.js';
import { buildStaircase } from '../buildStaircase.js';

// Reported 2026-09-28 (project "Schody_Kartka"): the FRONT of a winder tread next to the corner post was not straight
// — it broke part-way. The nosing extends the front edge forward and slides its corners along the tread's SIDES; the
// side direction was taken from the raw wanga chain (innerChain[0] -> innerChain[1]), but the front corner had already
// been moved (the tread recessed to the bottom of the housing in a housed wanga, or edited by hand), so that line was
// not the tread's side. On a winder whose dusza side is only 18-30 mm long it pointed anywhere: the nosed corner landed
// up to ~250 mm off and the outline closed with an extra slanted edge. (Straight treads were off by ~2 mm the same way.)
const USER_PROJECT = JSON.stringify({
  _type: 'schody3d-project',
  _version: 4,
  config: {
    stairType: 'U', turnDirection: 'left', totalRise: 2800, stairWidth: 950, treadGoing: 230, treadsLegA: 0,
    windersPerTurn: 3, treadsLegB: 7, treadsLegC: 2, turn1Type: 'winder', turn2Type: 'winder', mergeLandings: true,
    walklineOffset: 400, walklineSplitOffset: 270, minInnerWidth: 100,
    manualTreadOverhangs: { 11: { side: 'inner', offsetMm: 40 }, 12: { side: 'inner', offsetMm: 20 } },
    treadThickness: 40, nosing: 20, stringerThickness: 40, stringerConstructionTypeOuter: 'closed',
    stringerConstructionTypeInner: 'closed', stringerHousingDepthMm: 20, hasRiserBoards: true, riserBoardThickness: 15,
    riserTopOverlapMm: 0, postSize: 80, hasCornerPost: true,
  },
  edgeOverrides: {
    1: { movedEndpoint: 'outer', point: { x: -20, y: 545 } },
    2: { movedEndpoint: 'outer', point: { x: -445, y: 930 } },
    11: { movedEndpoint: 'inner', point: { x: -2580, y: 20 } },
    12: { movedEndpoint: 'outer', point: { x: -3510, y: 480 } },
  },
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distToLine = (p, a, b) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / dist(a, b);

// Every corner the nosing moved must stay on the line of its own side (the neighbour that is not the other front
// corner), and the moved corners must lie on ONE line parallel to the structural front, `nosing` in front of it.
function checkStraightNosedFronts(m, label) {
  const nosing = m.fullConfig.nosing;
  let checked = 0;
  m.treadModels.forEach((t, i) => {
    if (t.type === 'landing' || !(nosing > 0)) return;
    const raw = m.planLayout.treads[i].outline;
    const [f0, f1] = t.frontEdge.final;
    const n = raw.length;
    const moved = [];
    raw.forEach((p, k) => {
      const q = t.outline[k];
      if (dist(p, q) < 1e-9) return;
      moved.push(q);
      const side = [raw[(k + 1) % n], raw[(k - 1 + n) % n]].find((r) => dist(r, f0) > 1e-6 && dist(r, f1) > 1e-6 && dist(r, p) > 1e-6);
      assert.ok(side, `${label} ${t.stepId}: side neighbour`);
      // a side lying along the front line itself (a winder starting exactly at the inner corner: a few-mm stub) has
      // nothing to extend along — the corner moves square to the front instead (still on the straight nosed front)
      if (distToLine(side, f0, f1) < 1e-6) return;
      assert.ok(distToLine(q, p, side) < 1e-6, `${label} ${t.stepId}: nosed corner off its side by ${distToLine(q, p, side).toFixed(2)} mm`);
    });
    assert.equal(moved.length, 2, `${label} ${t.stepId}: both front corners moved`);
    for (const q of moved) assert.ok(Math.abs(distToLine(q, f0, f1) - nosing) < 1e-6, `${label} ${t.stepId}: nosed front not parallel, ${nosing} mm ahead`);
    checked++;
  });
  assert.ok(checked > 0);
}

test("the user's U stair: every winder's nosed front is straight (treads 2 and 3 at the corner post broke)", () => {
  const { config } = parseProjectFile(USER_PROJECT);
  const m = buildStaircase({ ...createDefaultConfig(), ...config });
  checkStraightNosedFronts(m, 'user');
  // the concrete reported tread: its nosed front corner at the dusza lies on the dusza side (y = 20), ~40 mm from
  // the structural corner — not ~250 mm away up the front line as before
  const t = m.treadModels[1];
  const inner = t.outline.find((p) => Math.abs(p.y - 20) < 1e-6 && p.x > -930);
  assert.ok(inner && dist(inner, t.frontEdge.final[0]) < 60, JSON.stringify(t.outline));
});

test('nosed fronts stay straight across winder layouts, housed/overlay wangi, risers and the riser groove', () => {
  for (const stairType of ['L', 'U']) {
    for (const turnDirection of ['right', 'left']) {
      for (const windersPerTurn of [3, 4, 5]) {
        for (const inner of ['closed', 'cut']) {
          for (const treadsLegA of [0, 3]) {
            const patch = { stairType, turnDirection, windersPerTurn, stringerConstructionTypeInner: inner, treadsLegA, hasRiserBoards: true, riserTopOverlapMm: 10, nosing: 25 };
            const m = buildStaircase({ ...createDefaultConfig(), ...patch });
            checkStraightNosedFronts(m, JSON.stringify(patch));
            // the riser groove recedes the front the same way: its receded corners on the sides too
            m.treadModels.forEach((t, i) => {
              if (!t.notch) return;
              const [s0, s1, s2, s3] = t.notch.strip;
              assert.ok(Math.abs(distToLine(s2, s0, s1) - m.fullConfig.riserBoardThickness) < 1e-6 && Math.abs(distToLine(s3, s0, s1) - m.fullConfig.riserBoardThickness) < 1e-6, `${JSON.stringify(patch)} ${t.stepId}: groove`);
              const raw = m.planLayout.treads[i];
              assert.ok(raw.outline.some((p) => dist(p, s0) < 1e-9) && raw.outline.some((p) => dist(p, s1) < 1e-9));
            });
          }
        }
      }
    }
  }
});
