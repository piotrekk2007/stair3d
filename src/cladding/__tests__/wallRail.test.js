import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { renderCladdingPlanSVG } from '../claddingPlanRenderer.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';

// the wall handrail on brackets (user request 2026-11-05)
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
// a straight flight of 6 (270 going, 1000 wide, 40 mm treads): the left side at x = 0 walled
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 6, riseMm: 180, goingMm: 270, widthMm: 1000 }], walls: { 0: { left: true } }, wallRails: { 0: { left: true } }, ...patch });

test('the wall handrail: off the wall by the clearance + half its width, its top over the noses, the whole side long', () => {
  const b = buildCladdingStair(straight({ wallRailClearanceMm: 50, handrailWidthMm: 60, handrailHeightMm: 50, wallRailHeightMm: 900 }));
  assert.equal(b.balustrade.wallRails.length, 1);
  assert.equal(b.balustrade.sections.length, 0, 'no balustrade section on the wall');
  const w = b.balustrade.wallRails[0];
  for (const p of w.handrail) near(p.x, 80, 'axis 50 + 30 off the wall');
  near(w.handrail[0].y, 0, 'from the first front');
  near(w.handrail.at(-1).y, 6 * 270, 'to the last back edge');
  // over the 3rd nose (y = 540): the finished tread top 3 × 180 + 40 (+ the floor finish) + 900 − half the height
  const t = b.cladding.treads[2];
  const at = w.handrail.find((p) => Math.abs(p.y - 540) < 1e-6);
  near(at.z, t.topZ + 900 - 25, 'the top 900 over the nose');
});

test('brackets: evenly at most the spacing apart, the outer ones in from the ends; the ends turned into the wall', () => {
  const b = buildCladdingStair(straight({ wallRailBracketSpacingMm: 1000, wallRailBracketEndMm: 150 }));
  const w = b.balustrade.wallRails[0];
  const s = w.brackets.map((x) => x.s);
  near(s[0], 150, 'first');
  near(s.at(-1), 1620 - 150, 'last');
  assert.equal(s.length, 3, '1320 mm → 2 gaps ≤ 1000');
  for (let k = 1; k < s.length; k++) assert.ok(s[k] - s[k - 1] <= 1000 + 1e-6);
  for (const x of w.brackets) {
    near(x.wall.x, 0, 'on the wall');
    near(x.rail.x, 50 + 30, 'under the handrail');
  }
  const r = buildCladdingStair(straight({ wallRailReturn: true })).balustrade.wallRails[0];
  near(r.handrail[0].x, 0, 'returned at the start');
  near(r.handrail.at(-1).x, 0, 'returned at the end');
  near(r.lengthMm, w.lengthMm + 2 * 80, 'two returns longer');
});

test('only on a walled side; a wall lower than the handrail carries none (WARNING); open sides keep the balustrade', () => {
  assert.equal(buildCladdingStair(straight({ walls: {} })).balustrade.wallRails.length, 0, 'no wall');
  const low = buildCladdingStair(straight({ walls: { 0: { left: { type: 'low', heightAboveMm: 600 } } } }));
  assert.equal(low.balustrade.wallRails.length, 0);
  assert.ok(low.diagnostics.some((d) => d.ruleId === 'CLAD-WALL-RAIL-LOW' && d.severity === 'WARNING'));
  const tall = buildCladdingStair(straight({ walls: { 0: { left: { type: 'low', heightAboveMm: 1200 } } } }));
  assert.equal(tall.balustrade.wallRails.length, 1, 'a wall high enough');
  const both = buildCladdingStair(straight({ railingSides: { 0: { right: true } } }));
  assert.equal(both.balustrade.wallRails.length, 1);
  assert.equal(both.balustrade.sections.length, 1, 'the balustrade on the open side');
});

test('the wall handrail in 3D, on the plan, under the LED and in the quote (handrail per mb, brackets per piece, fitting)', () => {
  const b = buildCladdingStair(straight({ ledHandrailEnabled: true }));
  const root = renderCladdingStair(b);
  const names = [];
  root.traverse((o) => o.isMesh && names.push(o.name));
  assert.ok(names.some((n) => n.startsWith('WallRail-')));
  assert.equal(names.filter((n) => n === 'WallRailBracket').length, 3 * b.balustrade.wallRails[0].brackets.length);
  assert.match(renderCladdingPlanSVG(b, {}), /clad-wall-rail/);
  assert.ok(b.led.strips.some((s) => s.kind === 'handrail' && s.id === 'led-wall-rail-0-left'));
  const s = createDefaultQuoteSettings();
  s.priceList.find((p) => p.materialId === 'railing-handrail').price = 100;
  s.priceList.find((p) => p.materialId === 'railing-wall-bracket').price = 30;
  s.labour.find((r) => r.id === 'wall-rail').rate = 50;
  const q = buildCladdingQuote(b, s);
  const w = b.balustrade.wallRails[0];
  const rail = q.lines.find((l) => l.id === 'wall-rail-0-left-handrail');
  near(rail.qty, Math.round(w.lengthMm / 10) / 100, 'mb');
  near(rail.material.value, Math.round(100 * rail.qty * 100) / 100, 'handrail', 0.02);
  near(rail.labour.value, Math.round(50 * rail.qty * 100) / 100, 'fitting', 0.02);
  const br = q.lines.find((l) => l.id === 'wall-rail-0-left-brackets');
  assert.equal(br.qty, w.brackets.length);
  near(br.material.value, 30 * w.brackets.length, 'brackets');
});
