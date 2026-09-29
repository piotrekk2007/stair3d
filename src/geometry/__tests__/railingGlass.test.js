import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../buildStaircase.js';
import { GLASS_TYPES, MIN_PANE_HEIGHT_MM } from '../railingGlass.js';
import { computeMaterialTakeoff } from '../../takeoff/materialTakeoff.js';
import { evaluateRailingChecks } from '../../validator/railingChecks.js';
import { checkRailing } from '../../structural/railingCheck.js';
import { buildRailingDXF } from '../../export/dxfExport.js';
import { stairFacts } from '../../offer/offerModel.js';

const build = (patch = {}, side = 'outer') => buildStaircase({ ...createDefaultConfig(), railingEnabled: true, railingSections: [{ id: 'r1', side, fromStep: 0, toStep: null }], ...patch });
const section = (m) => m.railingModel.sections[0];

test('VSG notation: two panes + 2 PVB foils of 0.38 mm', () => {
  assert.ok(Math.abs(GLASS_TYPES['4.4.2'].thicknessMm - 8.76) < 1e-9);
  assert.ok(Math.abs(GLASS_TYPES['5.5.2'].thicknessMm - 10.76) < 1e-9);
});

// Glass is flat: a pane lies on one straight stretch of the path — every path point between its ends is on its line.
function assertStraight(s, pane, label) {
  for (const p of s.path) {
    const along = (p.x - pane.start.x) * pane.dir.x + (p.y - pane.start.y) * pane.dir.y;
    if (along <= 1 || along >= pane.widthMm - 1) continue;
    const off = Math.abs(-(p.x - pane.start.x) * pane.dir.y + (p.y - pane.start.y) * pane.dir.x);
    if (off < 50) assert.ok(off < 1e-6, `${label} ${pane.id}: a plan corner inside the pane (${off})`);
  }
}

test('glass on the wanga side: panes <= 1800 mm, never round a corner, outside the wanga, top under the handrail, no posts or balusters', () => {
  for (const patch of [{}, { stairType: 'U' }, { stairType: 'straight', treadsLegA: 14 }, { turnDirection: 'left' }, { railingGlassType: '5.5.2', railingGlassMaxWidthMm: 1200 }]) {
    for (const side of ['outer', 'inner']) {
      const m = build({ railingInfill: 'glass-side', ...patch }, side);
      const s = section(m);
      const c = m.fullConfig;
      const label = `${JSON.stringify(patch)} ${side}`;
      assert.equal(s.infill, 'glass-side');
      assert.ok(s.glassPanes.length > 0, label);
      assert.equal(s.balusters.length, 0);
      assert.equal(s.posts.length, 0, 'the handrail sits on the glass — no posts of its own');
      const t = GLASS_TYPES[c.railingGlassType].thicknessMm;
      for (const pane of s.glassPanes) {
        assert.ok(pane.widthMm <= c.railingGlassMaxWidthMm + 1e-6, `${label}: ${pane.widthMm}`);
        assert.ok(Math.abs(pane.thicknessMm - t) < 1e-9);
        assertStraight(s, pane, label);
        assert.equal(pane.fixings.length, c.railingGlassFixingsPerPane);
        assert.ok(pane.fixings.every((f) => f.kind === 'rotule' && f.t > 0 && f.t < pane.widthMm));
        // outline: top first (left->right) at the handrail's underside
        const heights = pane.outline.slice(0, pane.outline.length / 2).map((q, i) => q.z - pane.outline[pane.outline.length - 1 - i].z);
        assert.ok(Math.min(...heights) >= MIN_PANE_HEIGHT_MM);
      }
      // the glass plane lies outside the wanga: stand-off + half the glass from the chain line, away from the stair
      const segs = m.stringerModels[side].segments;
      for (const pane of s.glassPanes) {
        const mid = { x: (pane.start.x + pane.end.x) / 2, y: (pane.start.y + pane.end.y) / 2 };
        const d = Math.min(
          ...segs.map((g) => {
            const u = (mid.x - g.referenceLine.start.x) * g.referenceLine.direction.x + (mid.y - g.referenceLine.start.y) * g.referenceLine.direction.y;
            if (u < -1 || u > g.referenceLine.length + 1) return Infinity;
            return Math.abs((mid.x - g.referenceLine.start.x) * g.inwardNormal.x + (mid.y - g.referenceLine.start.y) * g.inwardNormal.y + (c.railingGlassStandoffMm + t / 2));
          })
        );
        assert.ok(d < 1e-6, `${label} ${pane.id}: glass plane off by ${d}`);
      }
    }
  }
});

test('glass between posts: every span holds one pane width, a post at every corner (even with a bent handrail), clamps at both edges', () => {
  for (const patch of [{}, { railingBent: true }, { stairType: 'straight', treadsLegA: 16 }, { stairType: 'U' }]) {
    const m = build({ railingInfill: 'glass-posts', ...patch });
    const s = section(m);
    const c = m.fullConfig;
    const label = JSON.stringify(patch);
    const maxSpan = c.railingGlassMaxWidthMm + c.railingPostSizeMm + 2 * c.railingGlassGapMm;
    assert.equal(s.balusters.length, 0);
    for (const run of s.runs) {
      const pts = [run.pieces[0].start, ...run.pieces.map((p) => p.end)];
      const plan = pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
      assert.ok(plan <= maxSpan + 1e-6, `${label}: run of ${plan} mm between posts`);
      // no plan corner above 10° inside a span: a pane cannot turn it, so a post stands there (bent handrail too)
      for (let i = 1; i < pts.length - 1; i++) {
        const a = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y };
        const b = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
        const la = Math.hypot(a.x, a.y);
        const lb = Math.hypot(b.x, b.y);
        if (la < 1 || lb < 1) continue;
        assert.ok((a.x * b.x + a.y * b.y) / (la * lb) > Math.cos((10 * Math.PI) / 180) - 1e-9, `${label}: a corner inside a span between posts`);
      }
    }
    for (const pane of s.glassPanes) {
      assert.ok(pane.widthMm <= c.railingGlassMaxWidthMm + 1e-6);
      assertStraight(s, pane, label);
      const edges = new Set(pane.fixings.map((f) => Math.round(f.t)));
      assert.deepEqual([...edges].sort((a, b) => a - b), [0, Math.round(pane.widthMm)], 'clamps at the two edges');
      assert.equal(pane.fixings.length, 2 * c.railingGlassClampsPerSide);
    }
  }
  // a long straight flight gets intermediate posts
  const long = build({ railingInfill: 'glass-posts', stairType: 'straight', treadsLegA: 16 });
  assert.ok(section(long).posts.length >= 4, `${section(long).posts.length} posts`);
  assert.ok(section(long).glassPanes.length >= 3);
});

test('takeoff: one glass item per pane (ordered by its rectangle, net = the pane), fixings counted; no false clear-opening warning; glass-side not checked as a beam', () => {
  const m = build({ railingInfill: 'glass-side' });
  const s = section(m);
  const items = computeMaterialTakeoff(m, m.fullConfig);
  const glass = items.filter((i) => i.elementType === 'GLASS_PANE');
  assert.equal(glass.length, s.glassPanes.length);
  s.glassPanes.forEach((pane, k) => {
    assert.ok(Math.abs(glass[k].stockArea - (pane.blank.widthMm * pane.blank.heightMm) / 1e6) < 1e-9);
    assert.ok(Math.abs(glass[k].netArea - pane.areaMm2 / 1e6) < 1e-9);
    assert.ok(glass[k].netArea < glass[k].stockArea, 'a raked pane is smaller than its rectangle');
    assert.equal(glass[k].materialId, 'railing-glass');
  });
  const fixings = items.filter((i) => i.elementType === 'GLASS_FIXING');
  assert.equal(fixings.reduce((n, i) => n + i.quantity, 0), s.glassPanes.reduce((n, p) => n + p.fixings.length, 0));
  // no balusters, but the glass fills the opening: no clear-opening finding
  const diags = evaluateRailingChecks(m.railingModel, m.fullConfig, m.postModels);
  assert.ok(!diags.some((d) => d.parameter === 'clearOpening' || d.parameter === 'railingMaxClearMm'), JSON.stringify(diags.map((d) => d.parameter)));
  const structural = checkRailing(m);
  assert.equal(structural.rails.length, 0);
  assert.ok(structural.skipped.some((x) => x.id === 'r1'));
});

test('DXF lists every pane with its rectangle and fixings; the offer names the glass', () => {
  const m = build({ railingInfill: 'glass-side', railingGlassType: '5.5.2' });
  const dxf = buildRailingDXF(m.railingModel, { balusterSizeMm: m.fullConfig.railingBalusterSizeMm });
  const s = section(m);
  assert.equal((dxf.match(/Tafla \d+ r1/g) || []).length, s.glassPanes.length);
  assert.match(dxf, /VSG 5\.5\.2, prostokat \d+ x \d+ mm/);
  assert.equal((dxf.match(/\nCIRCLE\n8\nJOINTS/g) || []).length, s.glassPanes.reduce((n, p) => n + p.fixings.length, 0), 'one hole per rotule');
  const facts = stairFacts(m.fullConfig, m.derived);
  assert.ok(facts.rows.some(([k, v]) => k === 'Balustrada' && /szkło VSG 5\.5\.2 na rotulach/.test(v)));
  // the balusters mode is unchanged
  const plain = build({});
  assert.ok(section(plain).balusters.length > 0);
  assert.equal(section(plain).glassPanes.length, 0);
});
