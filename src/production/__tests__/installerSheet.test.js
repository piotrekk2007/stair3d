// The installer's sheet (user request 2026-11-19): the plan with the codes and quantities, the wangi from the side with
// the treads' bearings, identical treads grouped, winders / landings, risers and posts — the same codes as the labels.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../config/schema.js';
import { buildStaircase } from '../../geometry/buildStaircase.js';
import { buildPartList } from '../partCodes.js';
import { installerSheetHTML, treadGroups, codeRanges } from '../installerSheet.js';

const build = (patch = {}) => buildStaircase({ ...createDefaultConfig(), stairPending: false, hasRiserBoards: true, ...patch });

test('codes as compact ranges (and plain tread numbers)', () => {
  assert.equal(codeRanges(['ST-01', 'ST-02', 'ST-03', 'ST-05', 'ST-06']), 'ST-01–ST-03, ST-05, ST-06');
  assert.equal(codeRanges(['WZ-1', 'WW-1']), 'WZ-1, WW-1');
  assert.equal(codeRanges(['1', '2', '3', '4', '7']), '1–4, 7');
});

test('identical treads in one group × n, winders one each, every tread in exactly one group', () => {
  const b = build({ stairType: 'L', turn1Type: 'winder' });
  const groups = treadGroups(b);
  const all = groups.flatMap((g) => g.codes);
  const treadParts = buildPartList(b).parts.filter((p) => /^(tread|landing):/.test(p.sourceElementId));
  assert.deepEqual([...all].sort(), treadParts.map((p) => p.code).sort(), 'each tread once');
  const straight = groups.filter((g) => g.kind === 'straight');
  assert.ok(straight.some((g) => g.codes.length > 3), 'the repeated straight treads grouped');
  assert.ok(groups.filter((g) => g.kind === 'winder').length >= 3, 'winders on their own');
  for (const g of groups) assert.ok(g.width > 100 && g.depth > 100);
  // a landing stair: its landing a group of its own kind
  const land = treadGroups(build({ stairType: 'L', turn1Type: 'landing' }));
  assert.ok(land.some((g) => g.kind === 'landing'));
});

test('the sheet: the plan with the codes, every board from the side with its treads, the treads, risers and posts', () => {
  const b = build({ stairType: 'L', turn1Type: 'winder' });
  const parts = buildPartList(b).parts;
  const html = installerSheetHTML(b, { projectName: 'Dom <Kowalskich>', date: '19.11.2026', warning: 'Uwaga test' });
  assert.match(html, /<title>Karta dla montażysty — Dom &lt;Kowalskich&gt;<\/title>/);
  assert.match(html, /Uwaga test/);
  // every part code that the sheet covers is on it (the plan's labels and the cards)
  for (const p of parts.filter((x) => ['TREAD', 'LANDING', 'STRINGER'].includes(x.elementType) || x.code.startsWith('SL'))) assert.ok(html.includes(p.code), `${p.code} on the sheet`);
  const boards = parts.filter((p) => p.elementType === 'STRINGER');
  assert.equal((html.match(/class="card wide"/g) || []).length, boards.length, 'one side view per board');
  // the boards' bearings: a number per tread bearing on it
  const bearings = ['outer', 'inner'].flatMap((s) => b.stringerModels[s].segments.filter((seg) => seg.treadBearings.length).flatMap((seg) => seg.treadBearings));
  assert.ok(bearings.length > 10);
  assert.match(html, /Stopnie proste — rzut z góry/);
  assert.match(html, /Stopnie zabiegowe — rzut z góry/);
  assert.match(html, /<th class="tt" colspan="3">Podstopnice<\/th>/);
  assert.match(html, /<th class="tt" colspan="4">Słupy konstrukcyjne<\/th>/);
  // the risers grouped by size: the counts add up to every riser part
  const riserTable = html.split('>Podstopnice</th>')[1].split('</table>')[0];
  const counted = [...riserTable.matchAll(/<td class="n"><b>(\d+)<\/b>/g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(counted, parts.filter((p) => p.elementType === 'RISER').length);
  assert.doesNotMatch(html, /\bNaN\b|undefined/);
  // the quantities table: the treads' count
  const straightCount = treadGroups(b).filter((g) => g.kind === 'straight').reduce((n, g) => n + g.codes.length, 0);
  assert.match(html, new RegExp(`Stopnie proste</td><td class="n"><b>${straightCount}</b>`));
});

// user report 2026-11-19: in print a section's heading stayed alone at a page's foot, and a table went on to the next
// page without its heading — each heading is kept with its first row, a table's title and column heads are its <thead>
test('print layout: a heading kept with its first row of cards; a table\'s title in its repeated head', () => {
  const html = installerSheetHTML(build({ stairType: 'L', turn1Type: 'winder' }), {});
  for (const title of ['Wangi — widok z boku', 'Stopnie proste — rzut z góry', 'Stopnie zabiegowe — rzut z góry']) {
    const at = html.indexOf(title);
    const keep = html.lastIndexOf('<div class="keep"><h2>', at);
    assert.ok(keep >= 0 && at - keep < 40, `${title}: the heading opens a kept block`);
    assert.match(html.slice(at, at + 400), /<\/h2>(<div class="grid">)?<div class="card/, `${title}: its first card in the same block`);
  }
  assert.match(html, /\.keep \{ break-inside: avoid; \}/);
  assert.match(html, /thead \{ display: table-header-group; \}/);
  for (const title of ['Ilości', 'Podstopnice', 'Słupy konstrukcyjne']) assert.match(html, new RegExp(`<table class="[^"]*"><thead><tr><th class="tt" colspan="\\d">${title}</th>`), `${title}: in the table's head`);
  assert.doesNotMatch(html, /<h2>(Ilości|Podstopnice|Słupy konstrukcyjne)<\/h2>/, 'no loose heading before a table');
});

test('a stair without wangi (metal) still gets its sheet — no wangi section', () => {
  const html = installerSheetHTML(build({ stairType: 'straight', stairConstruction: 'metal-profile' }), {});
  assert.doesNotMatch(html, /Wangi — widok z boku/);
  assert.match(html, /Stopnie proste — rzut z góry/);
});
