import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { insetExposed, profileRings } from '../starterProfile.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { buildCladdingQuote } from '../quote/claddingQuote.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';

// stage 5 part 2 (user request 2026-11-04): starter steps and the treads' edge profiles
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 5, riseMm: 180, goingMm: 270, widthMm: 1000 }], nosingFrontMm: 30, riserThicknessMm: 20, sideNosingRight: false, sideNosingLeft: false, ...patch });
const xs = (o) => o.map((p) => p.x);
const ys = (o) => o.map((p) => p.y);
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

test('a starter step: widened past the concrete, its widened corner rounded, the rest as before', () => {
  const b = buildCladdingStair(straight({ stepOverrides: { 0: { starter: { leftMm: 300, rightMm: 0, radiusMm: 200, bowMm: 0 } } } }));
  const t = b.cladding.treads[0];
  near(Math.min(...xs(t.outline)), -300, 'widened 300 on the left');
  near(Math.max(...xs(t.outline)), 1000, 'the right side as the concrete');
  near(Math.min(...ys(t.outline)), -50, 'the front: nosing + riser');
  // the rounded corner: no point near the sharp corner (−300, −50), the arc's middle 200·(1 − cos 45°) in from it
  assert.ok(t.outline.every((p) => Math.hypot(p.x + 300, p.y + 50) > 200 * (Math.SQRT2 - 1) - 1), 'the corner rounded');
  // its riser bent round the front and the widened side, its support block inside the riser
  const r = b.cladding.risers.find((x) => x.index === 0);
  assert.equal(r.bent, true);
  assert.ok(r.lengthMm > 1000 + 250, `developed ${r.lengthMm}`);
  const [block] = b.cladding.starterBlocks;
  near(Math.min(...xs(block.outline)), -300 + 50, 'the block inside the riser');
  assert.equal(block.bottomZ, 0);
  assert.equal(block.topZ, 180);
  // the next steps untouched
  near(Math.min(...xs(b.cladding.treads[1].outline)), 0, 'tread 2 as before');
});

test('a starter step with a bowed front: the bow sticks out by its sagitta in the middle', () => {
  const b = buildCladdingStair(straight({ stepOverrides: { 0: { starter: { leftMm: 200, rightMm: 200, radiusMm: 150, bowMm: 60 } } } }));
  const t = b.cladding.treads[0];
  near(Math.min(...ys(t.outline)), -50 - 60, 'the bow 60 forward', 0.5);
  near(Math.min(...xs(t.outline)), -200, 'left');
  near(Math.max(...xs(t.outline)), 1200, 'right');
  // the quote: its own labour, the bent riser named
  const s = createDefaultQuoteSettings();
  s.labour.forEach((x) => (x.rate = 10));
  const q = buildCladdingQuote(b, s);
  const line = q.lines.find((l) => l.id === 'step-0');
  assert.equal(line.group, 'Stopnie zapraszające');
  assert.equal(line.labour.id, 'tread-starter');
  assert.match(q.lines.find((l) => l.id === 'riser-0').name, /gięta/);
});

test('edge profiles: the rings (chamfer, round R, bullnose), the inset only on the exposed edges', () => {
  assert.deepEqual(profileRings('chamfer', 5, 40), [{ inset: 0, z: 0 }, { inset: 0, z: 35 }, { inset: 5, z: 40 }]);
  const round = profileRings('round', 5, 40);
  near(round.at(-1).inset, 5, 'round: R in at the top');
  near(round.at(-1).z, 40, 'round: at the top');
  const bull = profileRings('bullnose', 0, 40);
  near(bull[0].inset, 20, 'bullnose: R = t/2 in at the bottom');
  near(bull[5].inset, 0, 'bullnose: flush in the middle');
  near(bull.at(-1).z, 40, 'bullnose: up to the top');
  assert.deepEqual(profileRings('square', 5, 40), [{ inset: 0, z: 0 }, { inset: 0, z: 40 }]);
  // a 1000 × 300 rectangle (CCW from the front-left), only its front (the first edge) exposed
  const rect = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 300 }, { x: 0, y: 300 }];
  const inset = insetExposed(rect, [true, false, false, false], 5);
  assert.deepEqual(inset.map((p) => [Math.round(p.x), Math.round(p.y)]), [[0, 5], [1000, 5], [1000, 300], [0, 300]]);
});

test('the treads carry their profile: the front (and a nosed side) exposed, per-step own profile, priced per mb', () => {
  const b = buildCladdingStair(straight({ edgeProfile: 'round', edgeProfileMm: 5, sideNosingRight: true, sideNosingMm: 30, stepOverrides: { 2: { profile: 'chamfer' } } }));
  const t = b.cladding.treads[1];
  assert.equal(t.profile.kind, 'round');
  near(t.profiledLengthMm, 1030 + 320, 'the front (1030) + the nosed right side (320)', 1e-6);
  assert.equal(b.cladding.treads[2].profile.kind, 'chamfer');
  const s = createDefaultQuoteSettings();
  s.labour.forEach((x) => (x.rate = 10));
  const q = buildCladdingQuote(b, s);
  const p = q.lines.find((l) => l.id === 'edge-profile');
  near(p.qty, Math.round((b.cladding.treads.reduce((sum, x) => sum + x.profiledLengthMm, 0) / 1000) * 100) / 100, 'mb');
  assert.equal(p.labour.id, 'edge-profile');
  // a square edge: nothing to mill, no line
  const square = buildCladdingStair(straight({ edgeProfile: 'square' }));
  assert.equal(buildCladdingQuote(square, s).lines.some((l) => l.id === 'edge-profile'), false);
});

test('3D: a profiled tread is lofted — at its top the front is set back by the profile, below it is not', () => {
  const b = buildCladdingStair(straight({ edgeProfile: 'chamfer', edgeProfileMm: 6 }));
  const root = renderCladdingStair(b, { room: false });
  const mesh = root.getObjectByName('Tread-1');
  const pos = mesh.geometry.getAttribute('position');
  const t = b.cladding.treads[1];
  let frontTop = Infinity;
  let frontLow = Infinity;
  for (let k = 0; k < pos.count; k++) {
    const y = -pos.getZ(k); // plan y
    const z = pos.getY(k);
    if (Math.abs(z - t.topZ) < 1e-6) frontTop = Math.min(frontTop, y);
    if (Math.abs(z - t.bottomZ) < 1e-6) frontLow = Math.min(frontLow, y);
  }
  near(frontLow, Math.min(...ys(t.outline)), 'the bottom at the nose');
  near(frontTop, Math.min(...ys(t.outline)) + 6, 'the top 6 back (the chamfer)', 1e-3);
});
