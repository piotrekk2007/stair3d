// Behaviour of the workspace's panels (user report 2026-10-29: the left panel was one 5000 px list with every folder
// open, the mouse wheel scrolling over it moved sliders and wrecked the stair, the 3D HUD covered the view on small
// screens). Pure DOM wiring — no geometry, no config:
// - guardWheel: over a number field / slider the wheel only scrolls the panel (lil-gui changed the value),
// - setupAccordion: one top-level folder of the parameter panel open at a time (remembered), sub-folders closed,
// - makeCollapsible: a box (3D HUD group, plan legend, summary) folded to its title by a click on it (remembered).
// The open / folded state is a per-browser convenience in localStorage, never part of the project.

export const ACCORDION_KEY = 'stair3d.panel.openFolder';
const COLLAPSE_KEY_PREFIX = 'stair3d.panel.collapsed.';

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function readKey(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}
function writeKey(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // private window / blocked storage: the panel still works, it only forgets
  }
}

// lil-gui's number controller (slider + text field) — the only one that reacts to the wheel
const WHEEL_FIELDS = '.lil-controller.lil-number';

/** Stops the wheel before it reaches a number field inside `container` (capture phase, no preventDefault: the
 *  panel scrolls as anywhere else). */
export function guardWheel(container) {
  const onWheel = (event) => {
    if (event.target?.closest?.(WHEEL_FIELDS)) event.stopPropagation();
  };
  container.addEventListener('wheel', onWheel, { capture: true });
  return onWheel;
}

/**
 * One top-level folder of `gui` open at a time. The folder opened last is remembered (`storage`); none remembered →
 * `defaultTitle` (else the first). Nested folders start closed. Opening a folder scrolls it to the panel's top.
 */
export function setupAccordion(gui, { storage = defaultStorage(), key = ACCORDION_KEY, defaultTitle = null } = {}) {
  const top = gui.folders;
  const saved = readKey(storage, key);
  const initial = saved === '' ? null : top.find((f) => f._title === saved) || top.find((f) => f._title === defaultTitle) || top[0];
  for (const f of top) {
    if (f === initial) f.open();
    else f.close();
  }
  for (const f of gui.foldersRecursive()) if (f.parent !== gui) f.close();
  gui.onOpenClose((changed) => {
    if (changed.parent !== gui) return;
    if (changed._closed) {
      if (readKey(storage, key) === changed._title) writeKey(storage, key, '');
      return;
    }
    for (const f of top) if (f !== changed && !f._closed) f.close();
    writeKey(storage, key, changed._title);
    changed.domElement.scrollIntoView?.({ block: 'start' });
  });
  return { initial };
}

/**
 * Folds `box` to `title` (class `collapsed`) on a click on the title; the state is remembered under `id`.
 * `defaultCollapsed` applies when nothing is remembered.
 */
export function makeCollapsible(box, title, id, { storage = defaultStorage(), defaultCollapsed = false } = {}) {
  const key = COLLAPSE_KEY_PREFIX + id;
  const saved = readKey(storage, key);
  const set = (collapsed) => {
    box.classList.toggle('collapsed', collapsed);
    title.setAttribute('aria-expanded', String(!collapsed));
  };
  box.classList.add('collapsible');
  title.classList.add('collapsible-title');
  title.setAttribute('role', 'button');
  title.title = title.title || 'Kliknij, żeby zwinąć / rozwinąć';
  set(saved === null ? defaultCollapsed : saved === '1');
  title.addEventListener('click', () => {
    const collapsed = !box.classList.contains('collapsed');
    set(collapsed);
    writeKey(storage, key, collapsed ? '1' : '0');
  });
}
