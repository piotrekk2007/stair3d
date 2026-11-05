import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { buildCladdingDXF, claddingPieces } from '../export/claddingDxf.js';
import { buildCutList } from '../export/cutList.js';

// the riser boards (user request 2026-11-05, the self-supporting mechanism): behind the tread below and into a groove
// in the tread above; or "dywanowe" — between the treads, as thick as a tread, on loose tongues top and bottom
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const ys = (o) => o.map((p) => p.y);
// 4 steps 180 / 270 / 1000, treads 40, risers 20, nosing 30
const cfg = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], treadThicknessMm: 40, riserThicknessMm: 20, nosingFrontMm: 30, riserTopOverlapMm: 10, floorFinishBottomMm: 15, ...patch });

test('behind the tread: the tread below ends at the riser\'s face, the riser down to its underside and up into the groove', () => {
  const b = buildCladdingStair(cfg());
  const [t0, t1] = b.cladding.treads;
  near(Math.max(...ys(t0.outline)), 270 - 20, 'tread 1 ends at riser 2\'s face');
  const r1 = b.cladding.risers.find((r) => r.id === 'riser-1');
  near(r1.bottomZ, 180, 'riser 2 down to tread 1\'s underside (the concrete)');
  near(r1.topZ, 360 + 10, 'up 10 into tread 2');
  near(Math.min(...ys(r1.outline)), 250, 'in front of the concrete face');
  // tread 2 grooved from below over riser 2's footprint, 10 deep (its nosing in front stays full)
  assert.deepEqual(t1.grooves.map((g) => g.depthMm), [10]);
  near(Math.min(...ys(t1.grooves[0].strip)), 250, 'the groove over the riser');
  near(Math.min(...ys(t1.outline)), 220, 'the nosing past it');
  // the first riser from the raw floor (the floor finish laid against it)
  near(b.cladding.risers[0].bottomZ, 0, 'first on the raw floor');
  // the DXF draws the groove on its own layer, notes it
  const dxf = buildCladdingDXF(b);
  assert.ok((dxf.match(/LINE\n8\nNOTCH\n/g) || []).length >= 4 * 4, 'a groove per tread with a riser');
  assert.ok(claddingPieces(b).find((p) => p.code === 'ST-02').notes.includes('wpust pod podstopnice 10 mm (spod)'));
  // no overlap set → no groove, the riser butts under the tread
  const flat = buildCladdingStair(cfg({ riserTopOverlapMm: 0 }));
  assert.equal(flat.cladding.treads[1].grooves, undefined);
  near(flat.cladding.risers[1].topZ, 360, 'butts under it');
});

test('a carpet riser (dywanowa): between the treads, as thick as a tread, on the tread below up to the one above; two loose tongues', () => {
  const b = buildCladdingStair(cfg({ riserMount: 'carpet' }));
  const [t0, t1] = b.cladding.treads;
  const r1 = b.cladding.risers.find((r) => r.id === 'riser-1');
  assert.equal(r1.thicknessMm, 40, 'the tread\'s thickness');
  near(r1.bottomZ, 220, 'on the tread below (its top)');
  near(r1.topZ, 360, 'up to the tread above\'s underside');
  assert.equal(r1.tongues, 2);
  near(Math.max(...ys(t0.outline)), 270, 'the tread below runs on under it');
  near(Math.min(...ys(t1.outline)), 270 - 40 - 30, 'the tread above: its nosing past the 40 riser');
  assert.equal(t1.grooves, undefined, 'no groove — a loose tongue');
  const notes = claddingPieces(b).find((p) => p.code === 'ST-02').notes;
  assert.ok(notes.includes('rowek na obce pioro - spod (podstopnica dywanowa)') && notes.includes('rowek na obce pioro - gora (podstopnica dywanowa)'));
  // the cut list: two tongues per riser, as long as it
  const op = buildCutList(b).filter((r) => r.code.startsWith('OP-'));
  assert.equal(op.length, b.cladding.risers.filter((r) => r.heightMm > 0).length);
  assert.ok(op.every((r) => r.qty === 2));
});

test('the quote: the loose tongue per mb (15 zł), "kanały i obróbka krawędzi" an option at 25 zł per tread', () => {
  const s = createDefaultQuoteSettings();
  assert.equal(s.looseTonguePerMb, 15);
  assert.equal(s.edgeChannelsPerTread, 25);
  assert.equal(s.edgeChannels, false);
  const carpet = buildCladdingStair(cfg({ riserMount: 'carpet' }));
  const tongue = buildCladdingQuote(carpet, s).lines.find((l) => l.id === 'loose-tongue');
  const mm = carpet.cladding.risers.filter((r) => r.heightMm > 0).reduce((t, r) => t + 2 * r.lengthMm, 0);
  near(tongue.qty, Math.round(mm / 10) / 100, 'top + bottom of every riser');
  near(tongue.material.value, Math.round(tongue.qty * 15 * 100) / 100, '15 zł/mb', 0.011);
  assert.equal(buildCladdingQuote(buildCladdingStair(cfg()), s).lines.some((l) => l.id === 'loose-tongue'), false, 'none behind the tread');
  assert.equal(buildCladdingQuote(carpet, s).lines.some((l) => l.id === 'edge-channels'), false, 'off by default');
  const ch = buildCladdingQuote(carpet, { ...s, edgeChannels: true }).lines.find((l) => l.id === 'edge-channels');
  assert.equal(ch.qty, 4);
  assert.equal(ch.material.value, 100, '4 treads × 25 zł');
});
