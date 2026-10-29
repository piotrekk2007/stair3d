import test from 'node:test';
import assert from 'node:assert/strict';

import { guardWheel, setupAccordion, makeCollapsible, ACCORDION_KEY } from '../panelBehaviour.js';

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

// a lil-gui stand-in: folders with open / close and the root's onOpenClose
function fakeGui(titles, nested = {}) {
  const gui = { folders: [], _cb: null };
  const mk = (title, parent) => {
    const f = {
      _title: title,
      parent,
      _closed: false,
      domElement: { scrolled: 0, scrollIntoView() { this.scrolled += 1; } },
      open() { this._closed = false; },
      close() { this._closed = true; },
      // a click on the title, as lil-gui does: change, then tell the root
      click() { this._closed = !this._closed; gui._cb?.(this); },
    };
    return f;
  };
  const all = [];
  for (const t of titles) {
    const f = mk(t, gui);
    gui.folders.push(f);
    all.push(f);
    for (const n of nested[t] || []) all.push(mk(n, f));
  }
  gui.foldersRecursive = () => all;
  gui.onOpenClose = (cb) => { gui._cb = cb; };
  return { gui, all };
}

test('regression (user, 2026-10-29): the mouse wheel over a slider / number field only scrolls the panel — it used to change the value (and the stair)', () => {
  let listener = null;
  let options = null;
  const container = { addEventListener: (type, fn, opts) => { if (type === 'wheel') { listener = fn; options = opts; } } };
  guardWheel(container);
  assert.ok(listener && options?.capture, 'caught on the way down, before lil-gui’s own wheel handler');
  const event = (overField) => ({
    stopped: false,
    prevented: false,
    target: { closest: (sel) => (overField && sel.includes('lil-number') ? {} : null) },
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.prevented = true; },
  });
  const over = event(true);
  listener(over);
  assert.equal(over.stopped, true, 'never reaches the field');
  assert.equal(over.prevented, false, 'the panel still scrolls');
  const elsewhere = event(false);
  listener(elsewhere);
  assert.equal(elsewhere.stopped, false);
});

test('the parameter panel is an accordion: one numbered folder open, remembered; nested folders start closed', () => {
  const storage = memoryStorage();
  const { gui, all } = fakeGui(['1. Schody', '2. Budynek', '3. Klatka'], { '2. Budynek': ['Bieg na sąsiednim piętrze'] });
  setupAccordion(gui, { storage, defaultTitle: '1. Schody' });
  const [a, b, c] = gui.folders;
  assert.deepEqual(gui.folders.map((f) => f._closed), [false, true, true], 'only the default open');
  assert.equal(all.find((f) => f._title.startsWith('Bieg'))._closed, true);
  b.click();
  assert.deepEqual(gui.folders.map((f) => f._closed), [true, false, true], 'opening one closes the other');
  assert.equal(b.domElement.scrolled, 1, 'scrolled to the top of the panel');
  assert.equal(storage.getItem(ACCORDION_KEY), '2. Budynek');
  // nested folders do not close their parent's siblings
  all.find((f) => f._title.startsWith('Bieg')).click();
  assert.equal(b._closed, false);
  // next start: the remembered one
  const again = fakeGui(['1. Schody', '2. Budynek', '3. Klatka']);
  setupAccordion(again.gui, { storage, defaultTitle: '1. Schody' });
  assert.deepEqual(again.gui.folders.map((f) => f._closed), [true, false, true]);
  // closing the open one remembers "none"
  again.gui.folders[1].click();
  assert.equal(storage.getItem(ACCORDION_KEY), '');
  const third = fakeGui(['1. Schody', '2. Budynek']);
  setupAccordion(third.gui, { storage });
  assert.deepEqual(third.gui.folders.map((f) => f._closed), [true, true]);
  void a; void c;
});

test('a foldable box (3D HUD group, plan legend, summary): a click on its title folds / unfolds it, remembered; works without storage', () => {
  const el = () => {
    const classes = new Set();
    const attrs = {};
    let onClick = null;
    return {
      classList: { add: (c) => classes.add(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
      setAttribute: (k, v) => { attrs[k] = v; },
      addEventListener: (t, fn) => { if (t === 'click') onClick = fn; },
      click: () => onClick?.(),
      attrs,
      title: '',
    };
  };
  const storage = memoryStorage();
  const box = el();
  const title = el();
  makeCollapsible(box, title, 'hud3d-Warstwy', { storage, defaultCollapsed: true });
  assert.equal(box.classList.contains('collapsed'), true, 'the default when nothing is remembered');
  title.click();
  assert.equal(box.classList.contains('collapsed'), false);
  assert.equal(title.attrs['aria-expanded'], 'true');
  const box2 = el();
  makeCollapsible(box2, el(), 'hud3d-Warstwy', { storage, defaultCollapsed: true });
  assert.equal(box2.classList.contains('collapsed'), false, 'remembered over the default');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const box3 = el();
  const t3 = el();
  assert.doesNotThrow(() => { makeCollapsible(box3, t3, 'x', { storage: broken }); t3.click(); });
  assert.equal(box3.classList.contains('collapsed'), true);
});
