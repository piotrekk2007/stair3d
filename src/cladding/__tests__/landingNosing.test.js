import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig, sanitizeCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { renderCladdingStair } from '../claddingRenderer.js';

// user report 2026-11-06: (1) a U landing got no front nosing (as the steps have), (2) nor did its floor-board
// nosing piece; (3) the grain on a landing ran the wrong way — boards ~2.5 m long go lengthwise
const steps = (n) => ({ kind: 'steps', count: n, riseMm: 180, goingMm: 270, widthMm: 1000 });
const landing = (o) => ({ kind: 'landing', riseMm: 180, depthMm: 1000, turn: 'right', gapMm: 0, ...o });
const build = (L, extra = {}) => buildCladdingStair(sanitizeCladdingConfig({ ...createDefaultCladdingConfig(), sequence: [steps(4), landing(L), steps(4)], ...extra }));
/** How far the landing's cladding (or its nosing piece) reaches past the concrete's front edge. */
function reach(b, part = null) {
  const e = b.concrete.elements.find((x) => x.kind === 'landing');
  const t = b.cladding.treads.find((x) => x.index === e.index);
  const f = e.edges.find((x) => x.role === 'front');
  const l = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
  const n = { x: (f.b.y - f.a.y) / l, y: -(f.b.x - f.a.x) / l };
  const outline = part ? t.parts[part].outline : t.outline;
  return { t, mm: Math.max(...outline.map((p) => (p.x - f.a.x) * n.x + (p.y - f.a.y) * n.y)) };
}

test('a U landing has its front nosing past the riser, as a step (it lies on the return flight’s front line, not on its edge)', () => {
  const cfg = createDefaultCladdingConfig();
  const nose = cfg.nosingFrontMm + cfg.riserThicknessMm; // 30 + 20: past the concrete = the nosing in front of the riser
  for (const L of [{ turn: 'u-left', gapMm: 200 }, { turn: 'u-right', gapMm: 0 }, { turn: 'u-left', gapMm: 100, measured: 'finished' }]) {
    assert.equal(Math.round(reach(build(L)).mm), nose, JSON.stringify(L));
    assert.equal(Math.round(reach(build({ ...L, finish: 'floorboard' }), 'nosing').mm), nose, `floor boards: the nosing piece — ${JSON.stringify(L)}`);
  }
  // an L landing as before
  assert.equal(Math.round(reach(build({})).mm), nose);
});

test('the grain on a landing: along the front, lengthwise on a clearly deeper one; the floor boards with it, the nosing piece along the front', () => {
  assert.deepEqual(reach(build({})).t.grain, { x: 1, y: 0 }, 'a near-square L landing: along the front (as a tread)');
  assert.deepEqual(reach(build({ turn: 'u-left', gapMm: 200 })).t.grain, { x: 1, y: 0 }, 'a U landing: along its long side');
  const deep = reach(build({ depthMm: 1600 })).t;
  assert.deepEqual(deep.grain, { x: 0, y: 1 }, 'a deep landing: along its depth');
  assert.ok(deep.lengthMm > deep.depthMm, 'the production blank along the grain');
  // 3D: the floor boards' grain = the landing's (not turned across), the nosing piece's along the front
  const b = build({ depthMm: 1600, finish: 'floorboard' });
  const t = reach(b).t;
  const meshes = {};
  renderCladdingStair(b).traverse((o) => o.name && (meshes[o.name] = o));
  assert.deepEqual(meshes[`LandingBoards-${t.index}`].userData.grainDirection, [t.grain.x, 0, -t.grain.y]);
  assert.deepEqual(meshes[`LandingNosing-${t.index}`].userData.grainDirection, [t.nosingGrain.x, 0, -t.nosingGrain.y]);
  assert.deepEqual(t.nosingGrain, { x: 1, y: 0 });
});

// user report 2026-11-06: a wall along the return flight of a U stopped at the landing — the landing's side on that
// line was the incoming flight's other (inner) side
test('a U landing: its side on the return flight’s line walls with the return flight’s outer side', async () => {
  const { edgeWallKey } = await import('../surroundingsModel.js');
  for (const [turn, role, side] of [['u-left', 'left', 'right'], ['u-right', 'right', 'left']]) {
    const b = build({ turn, gapMm: 200 }, { wallList: [{ id: 'c', flight: 1, side, type: 'full', from: null, to: null }] });
    const e = b.concrete.elements.find((x) => x.kind === 'landing');
    const edge = e.edges.find((x) => x.role === role);
    assert.deepEqual(edgeWallKey(e, edge), { flight: 1, side }, turn);
    // one wall from the return flight on along the landing's side; the landing has no side nosing there
    assert.equal(b.walls.length, 1, turn);
    const xs = b.walls[0].segments.flatMap((s) => [s.a.x, s.b.x]);
    assert.ok(xs.every((x) => Math.abs(x - edge.a.x) < 1e-6), `${turn}: on the landing's outer line`);
    assert.ok(b.walls[0].segments.some((s) => Math.abs(s.a.y - edge.a.y) < 1e-6 || Math.abs(s.b.y - edge.a.y) < 1e-6), `${turn}: along the landing`);
    assert.equal(b.cladding.treads.find((t) => t.index === e.index).nosing[role === 'left' ? 'leftMm' : 'rightMm'], 0);
    // the incoming flight's inner side (by the gap) does NOT wall the landing's far side any more
    const inner = build({ turn, gapMm: 200 }, { wallList: [{ id: 'a', flight: 0, side: role, type: 'full', from: null, to: null }] });
    assert.ok(inner.walls.flatMap((w) => w.segments).every((s) => Math.abs(s.a.x - edge.a.x) > 1), `${turn}: no wall on the far side from flight A's inner side`);
  }
});
