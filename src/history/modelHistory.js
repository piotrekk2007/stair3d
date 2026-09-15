// Undo/redo at the MODEL level — a stack of plain-data `config` snapshots (deep-cloned), never
// of rendered/view state (camera pan/zoom, selection, panel visibility). This is deliberate:
// requirement 12 ("Undo/Redo na poziomie zmian modelu, nie tylko zmian wizualnych") means the
// history entries must be the same data buildStaircase()/buildPlanLayout() consume, so undoing
// re-runs the FULL 2D solver -> stringers -> risers -> 3D pipeline from a real prior model
// state, not a cosmetic snapshot of what was drawn.
//
// No DOM, no Three.js, no knowledge of config's field names — this module only knows how to
// clone, push, and step through a stack of opaque snapshots.

const MAX_HISTORY_ENTRIES = 100; // named constant per .claude/RULES.md rule 11/12

function cloneSnapshot(value) {
  // structuredClone is available in every environment this project targets (Vite dev/build,
  // modern browsers, Node >= 17 for tests) and correctly deep-clones plain objects/arrays/
  // Maps — config is exactly that shape (see config/schema.js), never containing functions,
  // DOM nodes, or class instances.
  return structuredClone(value);
}

export function createHistory(initialSnapshot) {
  return {
    undoStack: [],
    redoStack: [],
    current: cloneSnapshot(initialSnapshot),
  };
}

// Call BEFORE applying a model-changing edit, passing the state as it is RIGHT NOW (i.e.
// still the pre-edit state) — history.current becomes the new post-edit snapshot the caller
// provides via commit(). Pushing clears the redo stack, per standard undo/redo semantics: a
// fresh edit after an undo abandons the redone-away future.
export function commit(history, newSnapshot) {
  history.undoStack.push(history.current);
  if (history.undoStack.length > MAX_HISTORY_ENTRIES) history.undoStack.shift();
  history.redoStack = [];
  history.current = cloneSnapshot(newSnapshot);
  return history;
}

export function canUndo(history) {
  return history.undoStack.length > 0;
}

export function canRedo(history) {
  return history.redoStack.length > 0;
}

// Returns the snapshot to restore, or null if there was nothing to undo. Mutates `history`.
export function undo(history) {
  if (!canUndo(history)) return null;
  history.redoStack.push(history.current);
  history.current = history.undoStack.pop();
  return cloneSnapshot(history.current);
}

export function redo(history) {
  if (!canRedo(history)) return null;
  history.undoStack.push(history.current);
  history.current = history.redoStack.pop();
  return cloneSnapshot(history.current);
}
