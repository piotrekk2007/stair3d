// Central, canonical geometric tolerances for the whole geometry layer (src/geometry/*).
// Every epsilon used anywhere in this layer must come from here. Before adding a new local
// epsilon constant, check whether one of these already means what you need — if it doesn't,
// add it HERE (with the same three things every entry below has: what it's for, its unit,
// and why that specific value), never as a private constant buried in one file.
//
// Consolidated from what were previously four independent, undocumented-relationship
// epsilons scattered across nosingUtils.js, planLayout.js, stringerGeometry.js (now removed)
// and stringerModel.js — see docs/architecture/ARCHITECTURE_CHECKPOINT notes on duplicated
// tolerances. They collapse into exactly three, because there are exactly three distinct
// mathematical criteria in play (see each constant below) — not because "fewer is better".

// GEOMETRY_EPS — mm. The default "are these two points/lengths effectively identical"
// tolerance (point equality, near-zero-length checks). This model's coordinates are on the
// order of 10^2-10^4 mm; double-precision floating point carries ~15-16 significant digits,
// so accumulated error after the handful of additions/rotations this codebase ever performs
// on one point is around 10^-10 mm at worst. 1e-6 mm is therefore always many orders of
// magnitude above real floating-point noise and many orders below any physically meaningful
// distance — it only ever fires for "these two values are the same number", never for a
// genuine near-miss.
export const GEOMETRY_EPS = 1e-6;

// COLLINEAR_EPS — mm² (NOT mm — it bounds a 2D cross product, i.e. twice a triangle's
// signed area, which scales with the SQUARE of the coordinate magnitudes involved). Used to
// decide whether three points lie on one straight line ("is this a real corner, or just
// floating-point noise from a chain of rotations/mirroring"). Coordinates here are on the
// order of 10^2-10^3 mm, so the cross product of two such vectors is naturally order
// 10^4-10^6 for a genuine corner. 1e-2 comfortably absorbs the ~1e-4-level noise this
// model's transforms can accumulate while staying many orders of magnitude below any real
// corner's cross product.
export const COLLINEAR_EPS = 1e-2;

// INTERSECTION_EPS — dimensionless. Compared against the cross product of two direction
// vectors that are either exactly axis-aligned or already unit-normalized before this check
// runs (see nosingUtils.js lineIntersect) — i.e. it approximates sin(angle between them).
// Used only to detect true parallel-line degeneracy. 1e-9 means only floating-point-level
// parallelism trips it; two lines that are merely "very nearly" parallel by design (not a
// case that occurs in this model — chains never intersect two nearly-parallel construction
// lines on purpose) are unaffected.
export const INTERSECTION_EPS = 1e-9;
