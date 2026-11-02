import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';

// user report 2026-11-02: a U turning on landings — the housed wangi came out "mega wide": the profile's reference had
// only the landing's FRONT corner as a knot, so the line ran straight from there up to the next flight over the whole
// landing and the board's top rose across it
const uLanding = (patch) => ({
  ...createDefaultConfig(),
  stairType: 'U',
  turn1Type: 'landing',
  turn2Type: 'landing',
  treadsLegA: 5,
  treadsLegB: 0,
  treadsLegC: 5,
  stringerConstructionTypeOuter: 'closed',
  stringerConstructionTypeInner: 'closed',
  ...patch,
});

test('regression (user, 2026-11-02): along a big landing the housed outer wanga is level — its top the landing’s top + the margin, its depth the minimum — not rising across the landing', () => {
  const b = buildStaircase(uLanding({ mergeLandings: true }));
  const landing = b.treadModels.find((t) => t.type === 'landing');
  const seg = b.stringerModels.outer.segments.find((s) => s.treadBearings.length === 1 && s.treadBearings[0].treadIndex === landing.index);
  assert.ok(seg, 'the board along the landing’s far side');
  const g = b.stringerConstruction.outer.find((x) => x.segmentId === seg.id);
  const top = g.topProfile.map((p) => p.v);
  const expectedTop = landing.elevation.top + b.fullConfig.stringerTopMarginMm;
  assert.ok(top.every((v) => Math.abs(v - expectedTop) < 1), `top ${top.map(Math.round)} vs ${expectedTop}`);
  const bottom = g.bottomProfile.map((p) => p.v);
  assert.ok(bottom.every((v) => Math.abs(expectedTop - v - b.fullConfig.minimumStringerDepthMm) < 1), `bottom ${bottom.map(Math.round)}`);
});

test('two half landings / a big landing: no board of either wanga deeper than the minimum + one riser anywhere (it reached over 1100 mm)', () => {
  for (const patch of [{ mergeLandings: true }, { mergeLandings: false }, { mergeLandings: false, treadsLegB: 2 }, { mergeLandings: true, landingDepthMm: 1100 }]) {
    const b = buildStaircase(uLanding(patch));
    const limit = b.fullConfig.minimumStringerDepthMm + b.derived.riserHeight + b.fullConfig.stringerTopMarginMm + 1;
    for (const side of ['outer', 'inner']) {
      for (const g of b.stringerConstruction[side]) {
        const c = g.outerContour;
        const us = c.map((p) => p.u);
        for (let k = 1; k < 40; k++) {
          const u = Math.min(...us) + ((Math.max(...us) - Math.min(...us)) * k) / 40;
          const vs = [];
          c.forEach((a, i) => {
            const q = c[(i + 1) % c.length];
            if ((a.u - u) * (q.u - u) <= 0 && a.u !== q.u) vs.push(a.v + ((q.v - a.v) * (u - a.u)) / (q.u - a.u));
          });
          if (vs.length >= 2) assert.ok(Math.max(...vs) - Math.min(...vs) <= limit, `${JSON.stringify(patch)} ${side} ${g.segmentId} at u=${Math.round(u)}: ${Math.round(Math.max(...vs) - Math.min(...vs))} > ${Math.round(limit)}`);
        }
      }
    }
  }
});
