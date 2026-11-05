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
    // how a riser board is fitted (user request 2026-11-05, the self-supporting mechanism): 'behind' — behind the
    // tread below (that tread ends at the riser's face, the riser down to its underside = the concrete) and up into a
    // groove in the tread above `riserTopOverlapMm` deep; 'carpet' (dywanowa) — between the treads (on the tread below
    // up to the tread above's underside), as thick as a tread, on loose tongues ("obce pióro") top and bottom
    riserMount: 'behind',
    riserTopOverlapMm: 10, // the groove in the tread above (as the self-supporting riserTopOverlapMm)
    floorFinishBottomMm: 15, // finished floor above the raw floor at the foot
    floorFinishTopMm: 15, // finished floor above the raw slab at the exit
    concreteSlabThicknessMm: 150, // the concrete flight's slab, square to the pitch — drawing only (ASSUMPTION)
    riseToleranceMm: 5, // finished rises differing by more than this → WARNING (user, 2026-11-04: 5 mm)
    // winders (stage 2 warnings): PL-LEGAL-C-01 (§ 69 ust. 5 — a winder at least 0.25 m deep 0.4 m from the dusza),
    // CO-MFG-J-04 (the narrowest dusza end a solid tread can have — company placeholder 80–100 mm), the goings on the
    // walkline compared with the straight steps' (ASSUMPTION)
    winderLegalOffsetMm: 400,
    winderLegalMinGoingMm: 250,
    winderMinDuszaMm: 100,
    winderGoingToleranceMm: 20,
    // stage 3 — the surroundings
    // walls along the stair: per flight (0 = the first) and side walking up; a wall side gets no side nosing
    // (a side set to null / missing = no wall)
    // per flight and side: true / {type: 'full'} = beside the stair, floor to slab (the concrete cast against it);
    // {type: 'low', heightAboveMm} = beside the stair up to that height over the noses (ściana nad stopniami / murek);
    // {type: 'under'} = under the flight's edge, floor to its soffit (the side above stays open). A walled side ('full',
    // 'low', the wall between flights set apart) gets no side nosing; 'under' does not count as walled.
    walls: {},
    // the walls as a LIST (user request 2026-11-05 — a wall on some steps of a side only): null = the per-flight
    // `walls` above; else [{id, flight, side, type, heightAboveMm?, from, to}] — `from` / `to` element indices (walking
    // order, 0-based; null = from the side's start / to its end), a later entry wins where two overlap
    wallList: null,
    wallThicknessMm: 120, // drawing only (ASSUMPTION)
    // a landing finished with floor boards: OSB + boards, the front edge a solid nosing piece hiding the OSB (user,
    // 2026-11-04) — sizes ASSUMPTION
    osbThicknessMm: 18,
    floorboardThicknessMm: 15,
    landingNosingDepthMm: 120,
    // the antresola nosing at the exit: a solid piece on the slab's edge, its top flush with the finished floor above
    exitNosing: true,
    // the opening's trim — „fajka” (openingTrimModel.js, user request 2026-11-05): per opening edge (null = on), sizes as
    // the self-supporting defaults (ASSUMPTION)
    openingTrimEnabled: false,
    openingTrimEdges: {},
    openingTrimNoseWidthMm: null, // into the opening (null = as the antresola nosing: the front nosing + the riser board — user decision 2026-11-05, so the two meet at exactly 45°)
    openingTrimNoseHeightMm: null, // null = the tread's thickness
    openingTrimBoardThicknessMm: null, // null = the top floor finish (else 15)
    openingTrimBoardDepthMm: null, // onto the floor (null = as the antresola nosing's `exitNosingDepthMm`)
    exitNosingDepthMm: 120, // onto the slab, past the last back edge (ASSUMPTION)
    // the slab above and its opening (drawing): the opening = the treads that need it for the headroom
    showSlab: true,
    slabThicknessMm: 220, // the raw slab (ASSUMPTION)
    minHeadroomMm: 2000, // headroom over the treads (WT § 68 — DO WERYFIKACJI, as the self-supporting minHeadroom)
    // the stair on the next floor (stage 3 part 2): {name, level 'above' | 'below', file (its project file — a
    // self-supporting or a concrete one), dxMm, dyMm, rotationDeg 0/90/180/270, mirror} — placed and checked by the
    // shared reference check (main.js hook → geometry/referenceStair.js)
    referenceFloor: null,
    // stage 5 — finishing elements (sizes ASSUMPTION, DO WERYFIKACJI with the workshop)
    // the treads' exposed top edge (starterProfile.js): square / chamfer / round (R) / bullnose; a step may have its own
    edgeProfile: 'round',
    edgeProfileMm: 5,
    // the skirting board on every walled side: its bottom cut to the treads, its top raked (parallel to the noses) or
    // stepped
    skirtingEnabled: false,
    skirtingStyle: 'raked', // 'raked' | 'stepped'
    skirtingHeightMm: 80, // above the noses (vertical)
    skirtingThicknessMm: 15,
    // the cover stringer (wanga obiciowa) on the concrete's open side face: per flight and side
    coverStringers: {},
    coverStringerTop: 'stepped', // 'stepped' (under the treads, the side nosing over it) | 'raked' (above the noses)
    coverStringerAboveMm: 60, // raked: above the noses
    coverStringerThicknessMm: 20,
    // the balustrade: per flight and open side; the antresola round the opening
    railingSides: {},
    // the wall handrail on brackets along a walled side (balustradeModel.js wallRail, user request 2026-11-05):
    // per flight and walled side; clearance and bracket spacing as the self-supporting railingWallRail* (ASSUMPTION)
    wallRails: {},
    wallRailHeightMm: 900, // its top above the noses (DO WERYFIKACJI)
    wallRailClearanceMm: 50, // free space between the wall and the handrail
    wallRailBracketSpacingMm: 1000, // at most between brackets
    wallRailBracketEndMm: 150, // the outer brackets in from the ends
    wallRailReturn: false, // both ends turned into the wall
    railingAntresola: false,
    railingHeightMm: 900, // the handrail's top above the noses (PL-LEGAL-H-01 0.9 m — DO WERYFIKACJI)
    railingAntresolaHeightMm: 1100, // above the floor (WT § 298 — DO WERYFIKACJI)
    railingInsetMm: 50, // the posts' / balusters' axis in from the tread's end
    antresolaSetbackMm: 60, // the antresola's axis back from the opening's edge
    balustersPerTread: 2,
    balusterSizeMm: 40,
    railingMaxClearMm: 120, // between balusters (§ 298 — DO WERYFIKACJI)
    handrailWidthMm: 60,
    handrailHeightMm: 50,
    // the infill (user request 2026-11-04 — the self-supporting types): balusters (square / round), glass between posts,
    // glass on the concrete's side (point fixings, the handrail on the glass); glass sizes ASSUMPTION / DO WERYFIKACJI
    railingInfill: 'balusters', // 'balusters' | 'glass-posts' | 'glass-side'
    balusterShape: 'square', // 'square' | 'round'
    glassThicknessMm: 17,
    glassMaxWidthMm: 1200,
    glassGapMm: 20,
    glassTopGapMm: 20,
    glassBottomGapMm: 50,
    glassStandoffMm: 20,
    glassOverlapMm: 120,
    glassFixingsPerPane: 2,
    glassClampsPerSide: 2,
    glassTint: 'clear',
    // posts by hand: {[section id]: {added: [{id, s}], removed: [post id]}}; the antresola per opening edge {[k]: false}
    railingPostEdits: {},
    railingAntresolaEdges: {},
    // the ceiling opening drawn by hand (plan points) — null = the one the headroom needs (surroundingsModel.js)
    openingManual: null,
    // LED lighting (ledModel.js, user request 2026-11-04): under the noses, in the skirting, under the handrail — the
    // self-supporting LED names and defaults (ASSUMPTION)
    ledTreadEnabled: false,
    ledSkirtingEnabled: false,
    ledHandrailEnabled: false,
    ledSkirtingAboveMm: 40, // the strip's centre over the noses in the skirting board
    ledProfileWidthMm: 17,
    ledProfileDepthMm: 8,
    ledTreadSetbackMm: 4,
    ledEndMarginMm: 30,
    ledPowerWPerM: 9.6,
    ledSupplyReservePct: 20,
    // decorative posts (user request 2026-11-04: "ozdobne słupy z czapkami i frezowaniami")
    postSizeMm: 90,
    postAboveHandrailMm: 120,
    postCap: 'pyramid', // 'flat' | 'pyramid' | 'ball' | 'round' (a turned, rounded top) | 'none' (the shaft square to its top)
    postCapHeightMm: 60,
    postGrooves: 2, // milled rings round the post under its cap
  };
}

function sanitizeReferenceFloor(ref) {
  if (!ref || typeof ref !== 'object' || !ref.file || typeof ref.file !== 'object') return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const rot = (((Math.round(n(ref.rotationDeg) / 90) * 90) % 360) + 360) % 360;
  return { name: String(ref.name ?? ''), level: ref.level === 'below' ? 'below' : 'above', file: ref.file, dxMm: n(ref.dxMm), dyMm: n(ref.dyMm), rotationDeg: rot, mirror: !!ref.mirror };
}

// {[flight]: {left, right}} — booleans only
function sanitizePostEdits(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!v || typeof v !== 'object') continue;
    const added = (Array.isArray(v.added) ? v.added : []).filter((m) => m && Number.isFinite(Number(m.s))).map((m, i) => ({ id: String(m.id ?? i), s: Number(m.s) }));
    const removed = (Array.isArray(v.removed) ? v.removed : []).filter((x) => typeof x === 'string');
    if (added.length || removed.length) out[k] = { added, removed };
  }
  return out;
}

// the walls: {[flight]: {left, right}} — each true (= full), or {type: full | low | under | above, heightAboveMm}
//   full: beside the stair, floor to slab; low: beside the stair, floor to a height over the noses (0 = the slab);
//   above: beside the stair, from the stair's concrete (its soffit) up to the slab / a height over the noses — nothing
//   under the flight (user request 2026-11-05); under: under the flight's edge, floor to the soffit (the side above open)
// the decorative posts' tops (user request 2026-11-05: also rounded / turned, or none)
export const POST_CAPS = Object.freeze(['flat', 'pyramid', 'ball', 'round', 'none']);
export const POST_CAP_LABELS = Object.freeze({ flat: 'płaska', pyramid: 'piramidka', ball: 'kula', round: 'zaoblona (toczona)', none: 'bez czapki' });
export const WALL_TYPES = Object.freeze(['full', 'low', 'above', 'under']);
export const WALL_TYPE_LABELS = Object.freeze({ full: 'pełna (od podłogi do stropu)', low: 'od podłogi do wysokości nad noskami', above: 'od płyty schodów w górę (pod biegiem otwarte)', under: 'pod biegiem (do spodu betonu)' });
// (low / above: the height over the noses, 0 = up to the slab)
const heightOf = (x) => Math.max(0, Math.min(3000, Number.isFinite(Number(x.heightAboveMm)) && x.heightAboveMm !== null && x.heightAboveMm !== '' ? Number(x.heightAboveMm) : x.type === 'above' ? 0 : 900));
// a wall's end moved part-way along its first / last step (mm, + = on up the flight) — only when set
const offsets = (w) => {
  const o = {};
  for (const f of ['fromOffsetMm', 'toOffsetMm']) if (Number.isFinite(Number(w[f])) && w[f] !== null && w[f] !== '' && Number(w[f]) !== 0) o[f] = Math.max(-5000, Math.min(5000, Math.round(Number(w[f]))));
  return o;
};
function sanitizeWallList(raw) {
  if (!Array.isArray(raw)) return null;
  const idx = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
  return raw
    .filter((w) => w && typeof w === 'object' && WALL_TYPES.includes(w.type) && (w.side === 'left' || w.side === 'right') && Number.isFinite(Number(w.flight)))
    .map((w, k) => ({ id: String(w.id ?? `w${k}`), flight: Math.max(0, Math.round(Number(w.flight))), side: w.side, type: w.type, ...(w.type === 'low' || w.type === 'above' ? { heightAboveMm: heightOf(w) } : {}), from: idx(w.from), to: idx(w.to), ...offsets(w) }));
}
function sanitizeWallTypes(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
    const w = {};
    for (const side of ['left', 'right']) {
      const x = v[side];
      if (x === true) w[side] = { type: 'full' };
      else if (x && typeof x === 'object' && WALL_TYPES.includes(x.type)) w[side] = { type: x.type, ...(x.type === 'low' || x.type === 'above' ? { heightAboveMm: heightOf(x) } : {}) };
    }
    if (w.left || w.right) out[k] = w;
  }
  return out;
}

function sanitizeWalls(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
    const w = { left: v.left === true, right: v.right === true };
    if (w.left || w.right) out[k] = w;
  }
  return out;
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
  // (every group measured on the concrete — default — or as FINISHED elements: `measured: 'finished'`, the concrete
  // derived from them — buildCladdingStair.js concreteFromFinished; user request 2026-11-05)
  const rawGroups = (Array.isArray(c.sequence) ? c.sequence : d.sequence).filter((g) => g && SEQUENCE_KINDS.includes(g.kind));
  const sequence = rawGroups
    .map((g) => {
      if (g.kind === 'steps') return { kind: 'steps', count: Math.round(num(g.count, 1, 1, 40)), riseMm: num(g.riseMm, 180, 50, 300), goingMm: num(g.goingMm, 270, 100, 500), widthMm: num(g.widthMm, 1000, 300, 3000) };
      // (a U landing's flights set apart may have a wall between them: up to the slab or `gapWallAboveMm` over the higher
      // flight's noses — sideWallsModel.js)
      if (g.kind === 'landing') return { kind: 'landing', riseMm: num(g.riseMm, 180, 50, 300), depthMm: nullableNum(g.depthMm, 300, 5000), turn: LANDING_TURNS.includes(g.turn) ? g.turn : 'none', gapMm: num(g.gapMm, 0, 0, 3000), finish: g.finish === 'floorboard' ? 'floorboard' : 'wood', gapWall: g.gapWall === true, gapWallTop: g.gapWallTop === 'nose' ? 'nose' : 'slab', gapWallAboveMm: num(g.gapWallAboveMm, 900, 0, 3000) };
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
    })
    .map((x, k) => (rawGroups[k].measured === 'finished' ? { ...x, measured: 'finished' } : x));
  const stepOverrides = {};
  for (const [k, v] of Object.entries(c.stepOverrides && typeof c.stepOverrides === 'object' ? c.stepOverrides : {})) {
    if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
    const o = {};
    for (const f of ['riseMm', 'goingMm', 'widthMm']) if (Number.isFinite(Number(v[f])) && v[f] !== null && v[f] !== '') o[f] = Number(v[f]);
    for (const f of ['nosingLeft', 'nosingRight', 'riser']) if (typeof v[f] === 'boolean') o[f] = v[f];
    if (['square', 'chamfer', 'round', 'bullnose'].includes(v.profile)) o.profile = v.profile;
    // a starter step: widened past the concrete on its sides, rounded, bowed (starterProfile.js)
    if (v.starter && typeof v.starter === 'object') {
      const s = {};
      for (const f of ['leftMm', 'rightMm', 'radiusMm', 'bowMm']) s[f] = Math.max(0, Math.min(2000, Number(v.starter[f]) || 0));
      o.starter = s;
    }
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
    riserMount: c.riserMount === 'carpet' ? 'carpet' : 'behind',
    riserTopOverlapMm: num(c.riserTopOverlapMm, d.riserTopOverlapMm, 0, 30),
    floorFinishBottomMm: num(c.floorFinishBottomMm, d.floorFinishBottomMm, 0, 200),
    floorFinishTopMm: num(c.floorFinishTopMm, d.floorFinishTopMm, 0, 200),
    concreteSlabThicknessMm: num(c.concreteSlabThicknessMm, d.concreteSlabThicknessMm, 50, 500),
    riseToleranceMm: num(c.riseToleranceMm, d.riseToleranceMm, 0, 50),
    winderLegalOffsetMm: num(c.winderLegalOffsetMm, d.winderLegalOffsetMm, 100, 1000),
    winderLegalMinGoingMm: num(c.winderLegalMinGoingMm, d.winderLegalMinGoingMm, 0, 500),
    winderMinDuszaMm: num(c.winderMinDuszaMm, d.winderMinDuszaMm, 0, 500),
    winderGoingToleranceMm: num(c.winderGoingToleranceMm, d.winderGoingToleranceMm, 0, 200),
    walls: sanitizeWallTypes(c.walls),
    wallList: sanitizeWallList(c.wallList),
    wallThicknessMm: num(c.wallThicknessMm, d.wallThicknessMm, 50, 600),
    osbThicknessMm: num(c.osbThicknessMm, d.osbThicknessMm, 0, 60),
    floorboardThicknessMm: num(c.floorboardThicknessMm, d.floorboardThicknessMm, 5, 40),
    landingNosingDepthMm: num(c.landingNosingDepthMm, d.landingNosingDepthMm, 30, 500),
    exitNosing: c.exitNosing !== false,
    openingTrimEnabled: !!c.openingTrimEnabled,
    openingTrimEdges: Object.fromEntries(Object.entries(c.openingTrimEdges && typeof c.openingTrimEdges === 'object' ? c.openingTrimEdges : {}).filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'boolean')),
    openingTrimNoseWidthMm: c.openingTrimNoseWidthMm === null || c.openingTrimNoseWidthMm === undefined || c.openingTrimNoseWidthMm === '' ? null : num(c.openingTrimNoseWidthMm, 20, 0, 200),
    openingTrimNoseHeightMm: c.openingTrimNoseHeightMm === null || c.openingTrimNoseHeightMm === undefined || c.openingTrimNoseHeightMm === '' ? null : num(c.openingTrimNoseHeightMm, 40, 5, 300),
    openingTrimBoardThicknessMm: c.openingTrimBoardThicknessMm === null || c.openingTrimBoardThicknessMm === undefined || c.openingTrimBoardThicknessMm === '' ? null : num(c.openingTrimBoardThicknessMm, 15, 3, 100),
    openingTrimBoardDepthMm: c.openingTrimBoardDepthMm === null || c.openingTrimBoardDepthMm === undefined || c.openingTrimBoardDepthMm === '' ? null : num(c.openingTrimBoardDepthMm, 100, 0, 600),
    exitNosingDepthMm: num(c.exitNosingDepthMm, d.exitNosingDepthMm, 20, 500),
    showSlab: c.showSlab !== false,
    slabThicknessMm: num(c.slabThicknessMm, d.slabThicknessMm, 80, 600),
    minHeadroomMm: num(c.minHeadroomMm, d.minHeadroomMm, 1500, 3000),
    referenceFloor: sanitizeReferenceFloor(c.referenceFloor),
    edgeProfile: ['square', 'chamfer', 'round', 'bullnose'].includes(c.edgeProfile) ? c.edgeProfile : 'round',
    edgeProfileMm: num(c.edgeProfileMm, d.edgeProfileMm, 0, 30),
    skirtingEnabled: !!c.skirtingEnabled,
    skirtingStyle: c.skirtingStyle === 'stepped' ? 'stepped' : 'raked',
    skirtingHeightMm: num(c.skirtingHeightMm, d.skirtingHeightMm, 20, 300),
    skirtingThicknessMm: num(c.skirtingThicknessMm, d.skirtingThicknessMm, 5, 60),
    coverStringers: sanitizeWalls(c.coverStringers),
    coverStringerTop: c.coverStringerTop === 'raked' ? 'raked' : 'stepped',
    coverStringerAboveMm: num(c.coverStringerAboveMm, d.coverStringerAboveMm, 0, 300),
    coverStringerThicknessMm: num(c.coverStringerThicknessMm, d.coverStringerThicknessMm, 10, 80),
    railingSides: sanitizeWalls(c.railingSides),
    wallRails: sanitizeWalls(c.wallRails),
    wallRailHeightMm: num(c.wallRailHeightMm, d.wallRailHeightMm, 600, 1500),
    wallRailClearanceMm: num(c.wallRailClearanceMm, d.wallRailClearanceMm, 20, 200),
    wallRailBracketSpacingMm: num(c.wallRailBracketSpacingMm, d.wallRailBracketSpacingMm, 300, 2000),
    wallRailBracketEndMm: num(c.wallRailBracketEndMm, d.wallRailBracketEndMm, 0, 500),
    wallRailReturn: !!c.wallRailReturn,
    railingAntresola: !!c.railingAntresola,
    railingHeightMm: num(c.railingHeightMm, d.railingHeightMm, 600, 1500),
    railingAntresolaHeightMm: num(c.railingAntresolaHeightMm, d.railingAntresolaHeightMm, 600, 1500),
    railingInsetMm: num(c.railingInsetMm, d.railingInsetMm, 0, 300),
    antresolaSetbackMm: num(c.antresolaSetbackMm, d.antresolaSetbackMm, 0, 300),
    balustersPerTread: Math.round(num(c.balustersPerTread, d.balustersPerTread, 0, 6)),
    balusterSizeMm: num(c.balusterSizeMm, d.balusterSizeMm, 10, 120),
    railingMaxClearMm: num(c.railingMaxClearMm, d.railingMaxClearMm, 50, 300),
    handrailWidthMm: num(c.handrailWidthMm, d.handrailWidthMm, 20, 150),
    handrailHeightMm: num(c.handrailHeightMm, d.handrailHeightMm, 20, 150),
    postSizeMm: num(c.postSizeMm, d.postSizeMm, 40, 250),
    postAboveHandrailMm: num(c.postAboveHandrailMm, d.postAboveHandrailMm, 0, 500),
    postCap: POST_CAPS.includes(c.postCap) ? c.postCap : 'pyramid',
    postCapHeightMm: num(c.postCapHeightMm, d.postCapHeightMm, 0, 300),
    postGrooves: Math.round(num(c.postGrooves, d.postGrooves, 0, 6)),
    ledTreadEnabled: !!c.ledTreadEnabled,
    ledSkirtingEnabled: !!c.ledSkirtingEnabled,
    ledHandrailEnabled: !!c.ledHandrailEnabled,
    ledSkirtingAboveMm: num(c.ledSkirtingAboveMm, d.ledSkirtingAboveMm, 0, 300),
    ledProfileWidthMm: num(c.ledProfileWidthMm, d.ledProfileWidthMm, 5, 60),
    ledProfileDepthMm: num(c.ledProfileDepthMm, d.ledProfileDepthMm, 2, 40),
    ledTreadSetbackMm: num(c.ledTreadSetbackMm, d.ledTreadSetbackMm, 0, 50),
    ledEndMarginMm: num(c.ledEndMarginMm, d.ledEndMarginMm, 0, 300),
    ledPowerWPerM: num(c.ledPowerWPerM, d.ledPowerWPerM, 0, 60),
    ledSupplyReservePct: num(c.ledSupplyReservePct, d.ledSupplyReservePct, 0, 100),
    railingInfill: ['balusters', 'glass-posts', 'glass-side'].includes(c.railingInfill) ? c.railingInfill : 'balusters',
    balusterShape: c.balusterShape === 'round' ? 'round' : 'square',
    glassThicknessMm: num(c.glassThicknessMm, d.glassThicknessMm, 6, 40),
    glassMaxWidthMm: num(c.glassMaxWidthMm, d.glassMaxWidthMm, 300, 3000),
    glassGapMm: num(c.glassGapMm, d.glassGapMm, 0, 100),
    glassTopGapMm: num(c.glassTopGapMm, d.glassTopGapMm, 0, 300),
    glassBottomGapMm: num(c.glassBottomGapMm, d.glassBottomGapMm, 0, 300),
    glassStandoffMm: num(c.glassStandoffMm, d.glassStandoffMm, 0, 100),
    glassOverlapMm: num(c.glassOverlapMm, d.glassOverlapMm, 0, 500),
    glassFixingsPerPane: Math.round(num(c.glassFixingsPerPane, d.glassFixingsPerPane, 1, 8)),
    glassClampsPerSide: Math.round(num(c.glassClampsPerSide, d.glassClampsPerSide, 1, 4)),
    glassTint: ['clear', 'optiwhite', 'grey', 'bronze'].includes(c.glassTint) ? c.glassTint : 'clear',
    railingPostEdits: sanitizePostEdits(c.railingPostEdits),
    railingAntresolaEdges: Object.fromEntries(Object.entries(c.railingAntresolaEdges && typeof c.railingAntresolaEdges === 'object' ? c.railingAntresolaEdges : {}).filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'boolean')),
    openingManual: Array.isArray(c.openingManual) && c.openingManual.length >= 3 && c.openingManual.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) ? c.openingManual.map((p) => ({ x: p.x, y: p.y })) : null,
  };
}
