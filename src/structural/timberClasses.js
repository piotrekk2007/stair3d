// Material data for the ORIENTATIVE structural check (docs/architecture/STRUCTURAL_CHECKS.md) — plain data, no
// geometry, no Three.js. Every number carries its source and a verification status; nothing here is presented as
// a design value confirmed for Poland.

// Standard gravity, to turn a mass into a weight (kg -> N).
export const GRAVITY_M_S2 = 9.81;

const EN338_SOURCE =
  'EN 338 strength classes as reproduced in RoyMech, "Timber" (roymech.org/Related/Construction/Timber, table cited as "BS EN 338 table 1", edition not stated; the values match EN 338:2003). Later editions (2009, 2016) changed some values — verify against the standard text.';

/**
 * Characteristic values per strength class. Strengths in N/mm², moduli in N/mm², densities in kg/m³.
 * @type {Object<string, {label:string, fmk:number, fvk:number, e0mean:number, e005:number, rhok:number, rhomean:number, source:string, needsVerification:boolean}>}
 */
export const TIMBER_STRENGTH_CLASSES = Object.freeze({
  C24: { label: 'C24 (iglaste)', fmk: 24, fvk: 2.5, e0mean: 11000, e005: 7400, rhok: 350, rhomean: 420, source: EN338_SOURCE, needsVerification: true },
  D30: { label: 'D30 (liściaste, np. dąb)', fmk: 30, fvk: 3.0, e0mean: 10000, e005: 8000, rhok: 530, rhomean: 640, source: EN338_SOURCE, needsVerification: true },
  D40: { label: 'D40 (liściaste)', fmk: 40, fvk: 3.8, e0mean: 11000, e005: 9400, rhok: 590, rhomean: 700, source: EN338_SOURCE, needsVerification: true },
});

export const DEFAULT_STRUCTURAL_CLASS = 'D30';

export function timberClass(id) {
  return TIMBER_STRENGTH_CLASSES[id] || TIMBER_STRENGTH_CLASSES[DEFAULT_STRUCTURAL_CLASS];
}

// MDF riser boards (when "Cennik i materiały" says MDF): not a strength-class material and never treated as
// load-bearing — only its weight counts.
export const MDF_DENSITY = Object.freeze({
  rhomean: 750,
  source: 'Typical manufacturer data sheets for MDF (roughly 700–800 kg/m³); no standard value — to be verified for the board actually used.',
  needsVerification: true,
});

// EN 1995-1-1 (Eurocode 5) factors for solid timber, service class 1 (heated interior) — EC5-STRUCT-I-03.
export const EC5_FACTORS = Object.freeze({
  kmod: Object.freeze({ permanent: 0.6, longTerm: 0.7, mediumTerm: 0.8, shortTerm: 0.9, instantaneous: 1.1 }),
  kmodSource: 'EN 1995-1-1 Table 3.1, solid timber, service class 1',
  gammaM: 1.3,
  gammaMSource: 'EN 1995-1-1 Table 2.3, solid timber (recommended value; Polish National Annex to be verified)',
  kdef: 0.6,
  kdefSource: 'EN 1995-1-1 Table 3.2, solid timber, service class 1',
  // Crack factor for shear: effective width b_ef = k_cr · b.
  kcr: 0.67,
  kcrSource: 'EN 1995-1-1:2004+A1:2008 §6.1.7(2), solid timber (recommended value)',
  needsVerification: true,
});

// EN 1990 ultimate limit state partial factors (recommended values; Polish National Annex to be verified).
export const LOAD_COMBINATION = Object.freeze({
  gammaG: 1.35,
  gammaQ: 1.5,
  // Quasi-permanent factor of the imposed load, category A (domestic) — used for creep of the final deflection.
  psi2CategoryA: 0.3,
  source: 'EN 1990, recommended partial factors for permanent (G) and variable (Q) actions, and Table A1.1 psi2 = 0.3 for category A; Polish National Annex to be verified',
  needsVerification: true,
});

/** Design strength X_d = k_mod · X_k / γ_M (EC5-STRUCT-I-03). */
export function designValue(characteristic, kmod, gammaM = EC5_FACTORS.gammaM) {
  return (kmod * characteristic) / gammaM;
}
