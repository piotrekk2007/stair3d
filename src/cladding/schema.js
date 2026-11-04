// The concrete cladding module's own config ("Schody na beton", docs/architecture/CONCRETE_CLADDING_MODULE.md).
// Separate from the self-supporting config/schema.js on purpose (user decision 2026-11-04: the two never share a
// model). Plain data only — every size is the MEASURED RAW CONCRETE unless the name says otherwise.

export const SEQUENCE_KINDS = Object.freeze(['steps', 'landing', 'winders']);
export const WINDER_TURN_LABELS = Object.freeze({ left: 'w lewo 90°', right: 'w prawo 90°' });
// a landing either continues the flight straight, turns it 90° (L) or back 180° (U, the return flight beside it)
export const LANDING_TURNS = Object.freeze(['none', 'left', 'right', 'u-left', 'u-right']);
export const LANDING_TURN_LABELS = Object.freeze({
  none: 'prosto (bez skrętu)',
  left: 'w lewo 90°',
  right: 'w prawo 90°',
  'u-left': 'zawrót w lewo 180°',
  'u-right': 'zawrót w prawo 180°',
});

export function createDefaultCladdingConfig() {
  return {
    // walking order; a group of equal concrete steps or a landing (user, 2026-11-04: "3 proste 180 × 270 × 1000, potem
    // 4 proste 185 × 265 × 1000…")
    sequence: [
      { kind: 'steps', count: 3, riseMm: 180, goingMm: 270, widthMm: 1000 },
      { kind: 'steps', count: 4, riseMm: 185, goingMm: 265, widthMm: 1000 },
      { kind: 'landing', riseMm: 185, depthMm: 1000, turn: 'right', gapMm: 0 },
      { kind: 'steps', count: 7, riseMm: 185, goingMm: 265, widthMm: 1000 },
    ],
    // the last concrete rise, from the last step up to the raw slab; null = the last step's rise
    exitRiseMm: null,
    // one step's own values, by its index in walking order: {riseMm, goingMm, widthMm, nosingLeft, nosingRight, riser}
    stepOverrides: {},
    // the finish (wood on the concrete)
    treadThicknessMm: 40,
    nosingFrontMm: 30, // past the riser board (or the concrete riser without one)
    sideNosingMm: 30, // past the concrete's side, on an open side (user: "nosek boczny wystaje poza beton")
    sideNosingLeft: false, // walking up
    sideNosingRight: true,
    riserBoards: true,
    riserThicknessMm: 20,
    floorFinishBottomMm: 15, // finished floor above the raw floor at the foot
    floorFinishTopMm: 15, // finished floor above the raw slab at the exit
    concreteSlabThicknessMm: 150, // the concrete flight's slab, square to the pitch — drawing only (ASSUMPTION)
    riseToleranceMm: 5, // finished rises differing by more than this → WARNING (ASSUMPTION, to be agreed with the user)
  };
}

const nullableNum = (v, min, max) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.min(max, Math.max(min, Number(v))));
const num = (v, d, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(max, Math.max(min, n)) : d;
};

/** A clean copy: unknown kinds dropped, numbers clamped, defaults filled in. */
export function sanitizeCladdingConfig(raw) {
  const d = createDefaultCladdingConfig();
  const c = { ...d, ...(raw && typeof raw === 'object' ? raw : {}) };
  const sequence = (Array.isArray(c.sequence) ? c.sequence : d.sequence)
    .filter((g) => g && SEQUENCE_KINDS.includes(g.kind))
    .map((g) => {
      if (g.kind === 'steps') return { kind: 'steps', count: Math.round(num(g.count, 1, 1, 40)), riseMm: num(g.riseMm, 180, 50, 300), goingMm: num(g.goingMm, 270, 100, 500), widthMm: num(g.widthMm, 1000, 300, 3000) };
      if (g.kind === 'landing') return { kind: 'landing', riseMm: num(g.riseMm, 180, 50, 300), depthMm: nullableNum(g.depthMm, 300, 5000), turn: LANDING_TURNS.includes(g.turn) ? g.turn : 'none', gapMm: num(g.gapMm, 0, 0, 3000) };
      // a 90° winder zone (concreteModel.js winderZone): its sizes A / B along the walls (null = automatic), the edges
      // between the winders as measured from the corners (null / a missing number = generated)
      const count = Math.round(num(g.count, 3, 2, 8));
      const edges = Array.from({ length: count - 1 }, (_, k) => {
        const e = Array.isArray(g.edges) ? g.edges[k] : null;
        const outerMm = nullableNum(e?.outerMm, -6000, 6000);
        const innerMm = nullableNum(e?.innerMm, -6000, 6000);
        return outerMm === null && innerMm === null ? null : { ...(outerMm !== null ? { outerMm } : {}), ...(innerMm !== null ? { innerMm } : {}) };
      });
      return { kind: 'winders', count, riseMm: num(g.riseMm, 180, 50, 300), turn: g.turn === 'left' ? 'left' : 'right', spaceAMm: nullableNum(g.spaceAMm, 300, 6000), spaceBMm: nullableNum(g.spaceBMm, 300, 6000), walklineOffsetMm: nullableNum(g.walklineOffsetMm, 50, 3000), edges };
    });
  const stepOverrides = {};
  for (const [k, v] of Object.entries(c.stepOverrides && typeof c.stepOverrides === 'object' ? c.stepOverrides : {})) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
    const o = {};
    for (const f of ['riseMm', 'goingMm', 'widthMm']) if (Number.isFinite(Number(v[f])) && v[f] !== null && v[f] !== '') o[f] = Number(v[f]);
    for (const f of ['nosingLeft', 'nosingRight', 'riser']) if (typeof v[f] === 'boolean') o[f] = v[f];
    if (Object.keys(o).length) stepOverrides[k] = o;
  }
  return {
    ...c,
    sequence,
    stepOverrides,
    exitRiseMm: c.exitRiseMm === null || c.exitRiseMm === undefined || c.exitRiseMm === '' ? null : num(c.exitRiseMm, 180, 0, 400),
    treadThicknessMm: num(c.treadThicknessMm, d.treadThicknessMm, 10, 100),
    nosingFrontMm: num(c.nosingFrontMm, d.nosingFrontMm, 0, 100),
    sideNosingMm: num(c.sideNosingMm, d.sideNosingMm, 0, 100),
    sideNosingLeft: !!c.sideNosingLeft,
    sideNosingRight: !!c.sideNosingRight,
    riserBoards: !!c.riserBoards,
    riserThicknessMm: num(c.riserThicknessMm, d.riserThicknessMm, 5, 60),
    floorFinishBottomMm: num(c.floorFinishBottomMm, d.floorFinishBottomMm, 0, 200),
    floorFinishTopMm: num(c.floorFinishTopMm, d.floorFinishTopMm, 0, 200),
    concreteSlabThicknessMm: num(c.concreteSlabThicknessMm, d.concreteSlabThicknessMm, 50, 500),
    riseToleranceMm: num(c.riseToleranceMm, d.riseToleranceMm, 0, 50),
  };
}
