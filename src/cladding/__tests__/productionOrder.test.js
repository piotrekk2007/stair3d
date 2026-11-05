import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { createDefaultQuoteSettings } from '../quote/labour.js';
import { buildProductionOrder, productionOrderHTML } from '../export/productionOrder.js';

// the production order (user request 2026-11-05): "Stopnie proste kr. R6 + kanał na LED" / "40x310x1100 - P - 3 szt."
const cfg = (patch = {}) => ({
  ...createDefaultCladdingConfig(),
  sequence: [{ kind: 'steps', count: 5, riseMm: 180, goingMm: 270, widthMm: 1000 }],
  treadThicknessMm: 40,
  riserThicknessMm: 16,
  nosingFrontMm: 30,
  edgeProfile: 'round',
  edgeProfileMm: 6,
  sideNosingRight: true,
  sideNosingLeft: false,
  ...patch,
});

test('the treads: a heading with the edges, identical pieces counted on one line "t x w x l - type - n szt."', () => {
  const b = buildCladdingStair(cfg({ ledTreadEnabled: true }));
  const o = buildProductionOrder(b, createDefaultQuoteSettings());
  const g = o.groups.find((x) => x.title.startsWith('Stopnie proste'));
  assert.equal(g.title, 'Stopnie proste kr. R6 + kanał na LED + wpust pod podstopnicę 10 mm');
  // 5 treads 1030 long (+30 side nosing), 270 + 30 + 16 − 16 = 300 deep, all P
  assert.deepEqual(g.lines.map((l) => [l.dims, l.type, l.qty]), [['40x300x1030', 'P', 5]]);
  assert.deepEqual(g.lines[0].codes, ['ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05']);
  assert.deepEqual(g.drawing.cuts.map((c) => c.label), ['LED 17x8', 'wpust 16x10']);
  // the risers: their type = their tread's, the mounting in the heading
  const r = o.groups.find((x) => x.title.startsWith('Podstopnie'));
  assert.match(r.title, /^Podstopnie dąb — za stopnicą, wpust 10 mm w stopnicę$/);
  assert.ok(r.lines.every((l) => l.type === 'P' && /^16x\d+x1000$/.test(l.dims)));
  assert.equal(r.lines.reduce((s, l) => s + l.qty, 0), b.cladding.risers.filter((x) => x.heightMm > 0).length);
});

test('the other groups: noses, the trim with its drawing, skirting, posts, balusters, handrails; a CZ tread on its own line', () => {
  const b = buildCladdingStair(cfg({ walls: { 0: { left: true } }, skirtingEnabled: true, railingSides: { 0: { right: true } }, openingTrimEnabled: true, stepOverrides: { 2: { nosingLeft: false, nosingRight: false } } }));
  const o = buildProductionOrder(b, createDefaultQuoteSettings());
  const titles = o.groups.map((g) => g.title.split(' ')[0]);
  for (const t of ['Stopnie', 'Podstopnie', 'Noski', 'Listwy', 'Słupy', 'Tralki', 'Poręcze']) assert.ok(titles.includes(t), t);
  const st = o.groups.find((x) => x.title.startsWith('Stopnie proste'));
  assert.deepEqual(st.lines.map((l) => [l.type, l.qty]).sort(), [['CZ', 1], ['P', 4]]);
  // the trim under the workshop's name „Nosek wyk.” (user request 2026-11-05), its profile drawn
  const nw = o.groups.find((g) => g.title.startsWith('Noski wyk.'));
  assert.equal(nw.drawing.kind, 'trim');
  assert.ok(nw.lines.every((l) => l.codes.every((c) => /^NW-\d+$/.test(c))));
  assert.ok(!JSON.stringify(o).includes('Fajk'), 'no „fajka” on the workshop\'s paper');
  const html = productionOrderHTML(o, { projectName: 'Kowalski' });
  assert.match(html, /<h1>Zamówienie na produkcję<\/h1>/);
  assert.match(html, /<b>40x300x1030<\/b> - <b>P<\/b> - <b>4 szt\.<\/b>/);
  assert.ok((html.match(/<svg class="draw"/g) || []).length >= 2, 'the tread and the trim profiles drawn');
  assert.match(html, /.l { font-size: 15pt/, 'the sizes in the largest type');
  assert.match(html, /column-count: 2/, 'two columns — at most two pages');
});

test('carpet risers: the heading says so, the tongues as their own group', () => {
  const o = buildProductionOrder(buildCladdingStair(cfg({ riserMount: 'carpet' })), createDefaultQuoteSettings());
  assert.match(o.groups.find((x) => x.title.startsWith('Podstopnie')).title, /dywanowe, na obce pióro/);
  assert.ok(o.groups.some((g) => g.title.startsWith('Obce pióro')));
  assert.ok(o.groups.find((x) => x.title.startsWith('Stopnie proste')).title.includes('rowki na obce pióro'));
});

// user report 2026-11-05 (a screenshot): the profile drawing crossed itself (the profile taken top → bottom)
test('the section drawings are simple polygons — the tread\'s and the trim\'s outlines never cross themselves', () => {
  const b = buildCladdingStair(cfg({ ledTreadEnabled: true, openingTrimEnabled: true }));
  const html = productionOrderHTML(buildProductionOrder(b, createDefaultQuoteSettings()));
  const polys = [...html.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1].split(' ').map((p) => p.split(',').map(Number)));
  assert.equal(polys.length, 2, 'the tread and the trim');
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (const pts of polys) {
    const n = pts.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        assert.ok(!cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]), `edges ${i} and ${j} cross`);
      }
  }
});

// user request 2026-11-05: "w zamówieniu produkcyjnym kratka na odznaczenie, czy już wykonane"
test('winders noted „kształt wg szablonów”; every line of the order has a box to tick off', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'winders', count: 3, riseMm: 180, turn: 'right' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
  });
  const o = buildProductionOrder(b, createDefaultQuoteSettings());
  const g = o.groups.find((x) => x.title.startsWith('Stopnie zabiegowe'));
  assert.equal(g.note, 'kształt wg szablonów');
  assert.ok(g.lines.every((l) => !l.note));
  const html = productionOrderHTML(o);
  const lines = o.groups.reduce((n, x) => n + x.lines.length, 0);
  assert.equal((html.match(/<div class="l"><span class="box"><\/span>/g) || []).length, lines, 'a box per line');
});
