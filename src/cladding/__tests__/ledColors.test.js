import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair, setCladdingAppearance } from '../claddingRenderer.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { claddingProjectToFile, parseCladdingProjectFile } from '../projectFile.js';
import { defaultAppearance } from '../../scene/appearance.js';

// LED lighting and colours (user request 2026-11-04)
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 6, riseMm: 180, goingMm: 270, widthMm: 1000 }], nosingFrontMm: 30, riserThicknessMm: 20, ...patch });

test('LED under the noses: one strip per tread along its front, under the overhang, short of the ends', () => {
  const b = buildCladdingStair(straight({ ledTreadEnabled: true, ledTreadSetbackMm: 4, ledProfileWidthMm: 17, ledEndMarginMm: 30 }));
  const strips = b.led.strips.filter((s) => s.kind === 'tread');
  assert.equal(strips.length, 6);
  const s = strips[1];
  // in front of the riser board (20) by the nosing (30) less 4 and half the profile: y = 270 − (20 + 30 − 4 − 8.5)
  near(s.points[0].y, 270 - (20 + 30 - 4 - 8.5), 'under the overhang');
  near(s.points[0].z, 360, 'on the tread underside (the concrete top)');
  near(s.lengthMm, 1000 - 60, 'short of both ends');
});

test('LED in the skirting and under the handrail; power and the supply with its reserve', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true, ledSkirtingEnabled: true, ledSkirtingAboveMm: 40, railingSides: { 0: { right: true } }, ledHandrailEnabled: true, ledPowerWPerM: 10, ledSupplyReservePct: 20 }));
  const sk = b.led.strips.find((s) => s.kind === 'skirting');
  assert.ok(sk, 'in the skirting');
  // 40 over the third nose, on the skirting's face (15 mm off the wall at x = 0, + 1)
  const third = sk.points.find((p) => Math.abs(p.y - 540) < 1);
  assert.ok(third && Math.abs(third.z - (540 + 40 + 40)) < 1e-6, 'parallel to the noses');
  near(sk.points[0].x, 16, 'on the face toward the stair');
  const hr = b.led.strips.find((s) => s.kind === 'handrail');
  assert.ok(hr, 'under the handrail');
  near(b.led.powerW, (b.led.totals.all / 1000) * 10, 'power');
  near(b.led.supplyW, b.led.powerW * 1.2, 'supply with the reserve');
});

test('the LED quote: strip and profile per mb (the shared list), the supply from the table by power, the fitting', () => {
  const b = buildCladdingStair(straight({ ledTreadEnabled: true, ledPowerWPerM: 10 }));
  const s = createDefaultQuoteSettings();
  s.priceList.find((p) => p.materialId === 'led-strip').price = 25;
  s.priceList.find((p) => p.materialId === 'led-profile').price = 40;
  s.boardPricing.ledSupplyPrices = [{ powerW: 30, price: 90 }, { powerW: 100, price: 150 }];
  s.labour.find((r) => r.id === 'led').rate = 20;
  const q = buildCladdingQuote(b, s);
  const strip = q.lines.find((l) => l.id === 'led-strip');
  near(strip.qty, Math.round(b.led.totals.all / 10) / 100, 'mb');
  near(strip.material.value, Math.round(25 * strip.qty * 100) / 100, 'strip', 0.02);
  near(strip.labour.value, Math.round(20 * strip.qty * 100) / 100, 'fitting', 0.02);
  // 5.64 m × 10 W × 1.2 = 67.7 W → the 100 W supply
  assert.match(q.lines.find((l) => l.id === 'led-supply').name, /100 W/);
  near(q.lines.find((l) => l.id === 'led-supply').material.value, 150, 'supply');
  assert.equal(buildCladdingQuote(buildCladdingStair(straight()), s).lines.some((l) => l.group === 'Oświetlenie LED'), false, 'none without LED');
});

test('colours: one material per element group, set from the shared appearance; saved in the project file', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true, railingSides: { 0: { right: true } } }));
  const a = { ...defaultAppearance(), tread: '#8a5a34', riser: '#f4f4f2', baluster: '#1a1a1a', treadFinish: 'solid', riserFinish: 'solid', balusterFinish: 'solid' };
  setCladdingAppearance(a);
  const root = renderCladdingStair(b);
  const hex = (name) => `#${root.getObjectByName(name).material.color.getHexString()}`;
  assert.equal(hex('Tread-1'), '#8a5a34');
  assert.equal(hex('Riser-1'), '#f4f4f2');
  assert.equal(hex('Baluster'), '#1a1a1a');
  assert.notEqual(root.getObjectByName('Tread-1').material, root.getObjectByName('Baluster').material, 'own materials');
  const back = parseCladdingProjectFile(JSON.stringify(claddingProjectToFile({ config: createDefaultCladdingConfig(), appearance: a })));
  assert.equal(back.appearance.tread, '#8a5a34');
  assert.equal(back.appearance.treadFinish, 'solid');
  setCladdingAppearance(defaultAppearance());
});
