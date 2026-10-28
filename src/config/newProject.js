// What a NEW project starts with (the app's start and "Nowy"), on top of createDefaultConfig(): no stair yet (user
// decision 2026-10-23 — the stairwell's walls and the opening first, then "Generuj"), the stairwell's walls on, and the
// ceiling opening DERIVED from the stair (user decision 2026-10-28), so the generated stair starts without ceiling
// collisions. Older projects keep their own opening (the schema's default stays 'given').

export const NEW_PROJECT_START = Object.freeze({ stairPending: true, stairwellRoomEnabled: true, openingMode: 'derived' });
