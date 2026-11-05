import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultCladdingConfig } from '../schema.js';
import { buildCladdingStair } from '../buildCladdingStair.js';
import { buildCutList, cutListToCSV } from '../export/cutList.js';
import { claddingPieces } from '../export/claddingDxf.js';

// the workshop's cut list (user request 2026-11-05)
const straight = (patch = {}) => ({ ...createDefaultCladdingConfig(), sequence: [{ kind: 'steps', count: 4, riseMm: 180, goingMm: 270, widthMm: 1000 }], ...patch });

test('cut list: every DXF piece at its blank size and thickness, the wood species, the same codes', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, skirtingEnabled: true }));
  const rows = buildCutList(b, { species: 'Dąb', cls: 'Klasa Natura' });
  assert.deepEqual(rows.filter((r) => !/^(PR|TR|SL)-/.test(r.code)).map((r) => r.code), claddingPieces(b).map((p) => p.code));
  for (const [k, t] of b.cladding.treads.entries()) {
    const r = rows.find((x) => x.code === `ST-0${k + 1}`);
    assert.equal(r.lengthMm, Math.round(t.lengthMm));
    assert.equal(r.widthMm, Math.round(t.depthMm));
    assert.equal(r.thicknessMm, t.thicknessMm);
    assert.equal(r.material, 'Dąb Klasa Natura');
  }
  const riser = rows.find((r) => r.code === 'PS-02');
  assert.equal(riser.lengthMm, Math.round(b.cladding.risers[1].lengthMm));
  assert.equal(riser.widthMm, Math.round(b.cladding.risers[1].heightMm));
  assert.ok(rows.some((r) => /^LS-/.test(r.code) && r.name.startsWith('Listwa przyścienna')), 'Polish names');
  assert.equal(rows[0].name, 'Stopień 1 P', 'with its type');
});

test('cut list: the balustrade\'s wood — the handrail, balusters and posts per section, the wall handrail', () => {
  const b = buildCladdingStair(straight({ walls: { 0: { left: true } }, wallRails: { 0: { left: true } }, railingSides: { 0: { right: true } } }));
  const rows = buildCutList(b);
  const s = b.balustrade.sections[0];
  const rail = rows.find((r) => r.name.startsWith('Poręcz — bieg 1'));
  assert.equal(rail.lengthMm, Math.round(s.lengthMm));
  const bal = rows.find((r) => r.name.startsWith('Tralki'));
  assert.equal(bal.qty, s.balusters.length);
  assert.equal(rows.find((r) => r.name.startsWith('Słupy')).qty, s.posts.length);
  const wall = rows.find((r) => r.name.startsWith('Poręcz przyścienna'));
  assert.equal(wall.lengthMm, Math.round(b.balustrade.wallRails[0].lengthMm));
  assert.match(wall.notes, /uchwyty: \d+ szt/);
});

test('cut list CSV: a BOM, `;`, a decimal comma, quoted cells, the Polish header', () => {
  const csv = cutListToCSV([{ code: 'PD-01-OSB', name: 'Płyta; OSB', qty: 1.25, lengthMm: '', widthMm: '', thicknessMm: 18, material: 'OSB', notes: 'm²' }], { projectName: 'Kowalski' });
  assert.ok(csv.startsWith('﻿Projekt: Kowalski\r\nKod;Element;Ilość;Długość [mm];Szerokość [mm];Grubość [mm];Materiał;Uwagi\r\n'));
  assert.match(csv, /PD-01-OSB;"Płyta; OSB";1,25;;;18;OSB;m²\r\n$/);
});

test('cut list: a floor-board landing gives its nosing plus the OSB and the boards by area', () => {
  const b = buildCladdingStair({
    ...createDefaultCladdingConfig(),
    sequence: [
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'landing', riseMm: 180, goingMm: 1000, widthMm: 1000, turn: 'right', finish: 'floorboard' },
      { kind: 'steps', count: 2, riseMm: 180, goingMm: 270, widthMm: 1000 },
    ],
  });
  const rows = buildCutList(b);
  const osb = rows.find((r) => /-OSB$/.test(r.code));
  assert.ok(osb && osb.qty > 0.5 && osb.qty < 1.1, `OSB m²: ${osb?.qty}`);
  assert.ok(rows.some((r) => /-DP$/.test(r.code)));
  assert.ok(rows.some((r) => /^PD-\d+N$/.test(r.code)), 'the nosing piece');
});
