// CANTILEVER STAIR ("schody wspornikowe") — pure model, no Three.js. User description / decisions (2026-09-29):
//  * steel profiles (e.g. 40 × 60, full section) stick out of the wall — the company finds them on site; the steel
//    stringer in the wall is invisible;
//  * every tread is a wooden CLADDING BOX slid onto its profiles (glued or screwed): the TOP and the FRONT 40 mm, the
//    BOTTOM, BACK and SIDE (at the free end) 20 mm; the top is full (with the nosing), the front sits under the top,
//    the bottom lies between the front and the back, the back under the top, the side at the free end between the top
//    and the bottom; the wall end is open (the profiles enter there);
//  * box height = profile height + top + bottom + a slide-on clearance;
//  * at least 2 profiles per tread; the side away from the wall is free (no stringer, no posts);
//  * winder treads get the same box in their own (triangle / kite) shape; a box at most ~1800 mm wide.
// Numbers the user did not give (clearance, wall gap, how far the profiles stick out) are parameters DO WERYFIKACJI
// (CO-MFG-J-CANTILEVER).
//
// The wall is the stair's OUTER side (the outer chain line); the box ends `cantileverWallGapMm` from it
// (edgeOverrides.js housingRecessMm). Everything here is read off the solved tread (TreadModel + its plan tread).

import { clipToConvex, subtractConvex, polygonArea, pointInPolygon } from './polygonClip.js';

export const STAIR_CONSTRUCTIONS = Object.freeze({ STRINGERS: 'stringers', CANTILEVER: 'cantilever' });
const BAND_EXTEND_MM = 20000; // a band is extended far along its edge so it covers the whole tread
const MIN_PART_AREA_MM2 = 100;

export function isCantilever(config) {
  return config?.stairConstruction === STAIR_CONSTRUCTIONS.CANTILEVER;
}

const pos = (v, def) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : def);

export function cantileverParams(config = {}) {
  return {
    profileWidthMm: pos(config.cantileverProfileWidthMm, 40),
    profileHeightMm: pos(config.cantileverProfileHeightMm, 60),
    profileCount: Math.max(2, Math.round(pos(config.cantileverProfileCount, 2))),
    profileProjectionMm: pos(config.cantileverProfileProjectionMm, 700),
    clearanceMm: pos(config.cantileverClearanceMm, 2),
    topMm: pos(config.cantileverTopThicknessMm, 40),
    frontMm: pos(config.cantileverFrontThicknessMm, 40),
    shellMm: pos(config.cantileverShellThicknessMm, 20),
    wallGapMm: pos(config.cantileverWallGapMm, 5),
    maxWidthMm: pos(config.cantileverMaxWidthMm, 1800),
  };
}

/** Box height: the profile + the top + the bottom + the slide-on clearance. */
export function cantileverBoxHeightMm(config) {
  const p = cantileverParams(config);
  return p.profileHeightMm + p.clearanceMm + p.topMm + p.shellMm;
}

/**
 * The config every solver sees for a cantilever stair: the tread is the whole box (its thickness = the box height),
 * no risers (open stair), and the free side is treated like an overlay stringer side by the balustrade (balusters
 * stand on the treads). The wangi and structural posts are not built at all (buildStaircase.js).
 */
export function cantileverConfig(fullConfig) {
  if (!isCantilever(fullConfig)) return fullConfig;
  return {
    ...fullConfig,
    treadThickness: cantileverBoxHeightMm(fullConfig),
    hasRiserBoards: false,
    stringerConstructionTypeOuter: 'cut',
    stringerConstructionTypeInner: 'cut',
  };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const unit = (v) => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};
const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

// The strip of width `w` along edge a-b on the side of `inside`, as a convex quad extended far along the edge.
function band(a, b, w, inside) {
  const d = unit(sub(b, a));
  let n = { x: -d.y, y: d.x };
  if ((inside.x - a.x) * n.x + (inside.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const A = { x: a.x - d.x * BAND_EXTEND_MM, y: a.y - d.y * BAND_EXTEND_MM };
  const B = { x: b.x + d.x * BAND_EXTEND_MM, y: b.y + d.y * BAND_EXTEND_MM };
  return [A, B, { x: B.x + n.x * w, y: B.y + n.y * w }, { x: A.x + n.x * w, y: A.y + n.y * w }];
}

function largest(pieces) {
  return pieces.slice().sort((p, q) => polygonArea(q.outer) - polygonArea(p.outer))[0]?.outer ?? null;
}

function minus(poly, ...quads) {
  let cur = poly;
  for (const q of quads) {
    if (!cur) return null;
    cur = largest(subtractConvex(cur, q));
  }
  return cur;
}


// Extent of a polygon along direction d (and across it): the rectangle it is cut from.
function extentAlong(poly, d) {
  const n = { x: -d.y, y: d.x };
  const us = poly.map((p) => p.x * d.x + p.y * d.y);
  const vs = poly.map((p) => p.x * n.x + p.y * n.y);
  return { lengthMm: Math.max(...us) - Math.min(...us), widthMm: Math.max(...vs) - Math.min(...vs) };
}

// A point `off` into the tread (toward its centroid `c`) from the line through `a` along `d`.
function intoTread(a, d, off, c) {
  let n = { x: -d.y, y: d.x };
  if ((c.x - a.x) * n.x + (c.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  return { x: a.x + n.x * off, y: a.y + n.y * off };
}

// The wall line (a tread's outer chain) as arc length: where a line crosses it, a point at a given arc length, and the
// arc length of a point on it. A crossing may lie a little past the chain's ends (the line is extended there).
function wallLine(wall) {
  const cum = [0];
  for (let i = 1; i < wall.length; i++) cum.push(cum[i - 1] + len(sub(wall[i], wall[i - 1])));
  const pointAt = (s) => {
    let i = 0;
    while (i < wall.length - 2 && s > cum[i + 1]) i++;
    const segLen = cum[i + 1] - cum[i] || 1;
    const t = (s - cum[i]) / segLen;
    return { x: wall[i].x + (wall[i + 1].x - wall[i].x) * t, y: wall[i].y + (wall[i + 1].y - wall[i].y) * t };
  };
  const along = (q) => {
    let best = null;
    for (let i = 1; i < wall.length; i++) {
      const ab = sub(wall[i], wall[i - 1]);
      const l2 = ab.x * ab.x + ab.y * ab.y || 1;
      const t = Math.min(1, Math.max(0, ((q.x - wall[i - 1].x) * ab.x + (q.y - wall[i - 1].y) * ab.y) / l2));
      const d = Math.hypot(wall[i - 1].x + ab.x * t - q.x, wall[i - 1].y + ab.y * t - q.y);
      if (!best || d < best.d) best = { d, s: cum[i - 1] + Math.sqrt(l2) * t };
    }
    return best.s;
  };
  const crossing = (through, dir) => {
    let best = null;
    for (let i = 1; i < wall.length; i++) {
      const a = wall[i - 1];
      const e = sub(wall[i], a);
      const den = dir.x * e.y - dir.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const ap = sub(a, through);
      const r = (ap.x * e.y - ap.y * e.x) / den; // along the line
      const u = (ap.x * dir.y - ap.y * dir.x) / den; // along the wall segment
      const lo = i === 1 ? -WALL_EXTEND : 0;
      const hi = i === wall.length - 1 ? 1 + WALL_EXTEND : 1;
      if (u < lo - 1e-9 || u > hi + 1e-9) continue;
      if (!best || Math.abs(r) < Math.abs(best.r)) best = { r, s: cum[i - 1] + len(e) * u };
    }
    return best ? best.s : null;
  };
  return { pointAt, along, crossing };
}
const WALL_EXTEND = 0.5; // a profile's line may meet the wall up to half a segment past the tread's own wall stretch

// How far along `a` (from its start) it comes within `gap` (centre line to centre line) of profile line `b`; Infinity
// when the two do not converge.
function touchDistance(a, b, gap) {
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const f0 = cross(b.dir, sub(a.start, b.start));
  const slope = cross(b.dir, a.dir);
  const side = Math.sign(f0) || 1;
  if (side * slope >= -1e-12) return Infinity;
  return Math.max(0, (gap - side * f0) / (side * slope));
}

/**
 * @param {Object} tread   TreadModel (outline = nosed top, frontEdge/backEdge.final, elevation, direction)
 * @param {Object} planTread  the same tread in planLayout (outline = structural, un-nosed; outerChain = the wall line)
 * @param {Object} config  full (cantilever) config
 * @returns {{heightMm, parts: Array<{kind, outline, zBottom, zTop, thicknessMm, blank:{lengthMm, widthMm}}>,
 *   profiles: Array<{start, dir, lengthMm, widthMm, heightMm, zBottom}>, warnings: string[]}}
 */
export function buildCantileverBox(tread, planTread, config) {
  const p = cantileverParams(config);
  const warnings = [];
  const top = tread.elevation.top;
  const bottom = tread.elevation.bottom;
  const P = planTread.outline;
  const c = centroid(P);
  const [fInner, fOuter] = tread.frontEdge.final;
  const [bInner, bOuter] = tread.backEdge.final;
  const frontBand = band(fInner, fOuter, p.frontMm, c);
  const backBand = band(bInner, bOuter, p.shellMm, c);
  const underTop = top - p.topMm;
  const parts = [];
  const add = (kind, outline, zBottom, zTop, thicknessMm, blank) => {
    if (outline && outline.length >= 3 && polygonArea(outline) > MIN_PART_AREA_MM2 && zTop > zBottom) parts.push({ kind, outline, zBottom, zTop, thicknessMm, blank });
  };
  const alongFront = unit(sub(fOuter, fInner));
  const alongBack = unit(sub(bOuter, bInner));

  // top: the whole nosed outline, cut like the tread's own blank
  add('top', tread.outline, underTop, top, p.topMm, tread.winderBlank ? { lengthMm: tread.winderBlank.length, widthMm: tread.winderBlank.depth } : extentAlong(tread.outline, unit({ x: -tread.direction.y, y: tread.direction.x })));
  // front and back: vertical boards under the top, along their edges
  const front = clipToConvex(P, frontBand);
  add('front', front, bottom, underTop, p.frontMm, { lengthMm: extentAlong(front, alongFront).lengthMm, widthMm: underTop - bottom });
  const back = clipToConvex(P, backBand);
  add('back', back, bottom, underTop, p.shellMm, { lengthMm: extentAlong(back, alongBack).lengthMm, widthMm: underTop - bottom });
  // bottom: between the front and the back, from the wall end to the free end
  const bottomPlan = minus(P, frontBand, backBand);
  if (bottomPlan) add('bottom', bottomPlan, bottom, bottom + p.shellMm, p.shellMm, extentAlong(bottomPlan, unit({ x: -tread.direction.y, y: tread.direction.x })));
  // side: at the free end (the inner line), between the top and the bottom, between the front and the back
  const freeLen = len(sub(bInner, fInner));
  if (freeLen > p.shellMm) {
    const sideBand = band(fInner, bInner, p.shellMm, c);
    const side = minus(clipToConvex(P, sideBand), frontBand, backBand);
    if (side) add('side', side, bottom + p.shellMm, underTop, p.shellMm, { lengthMm: extentAlong(side, unit(sub(bInner, fInner))).lengthMm, widthMm: underTop - bottom - p.shellMm });
  }

  // the room inside the box for the profiles: the structural outline minus every board around it
  const sideQuad = freeLen > p.shellMm ? band(fInner, bInner, p.shellMm, c) : null;
  const inner = minus(P, frontBand, backBand, ...(sideQuad ? [sideQuad] : []));

  // profiles: they run the way the cladding does — the first one parallel to the front board (just inside it), the
  // last one parallel to the back board, any others in between — from the wall line into the box. On a straight tread
  // both boards are parallel, so the profiles come square out of the wall; on a winder the boards converge toward the
  // free end and so do the profiles: each ends at its projection or where it would touch its neighbour, whichever
  // comes first (user decision 2026-10-02).
  const profiles = [];
  const wall = planTread.outerChain || [];
  if (wall.length >= 2 && inner) {
    const w = p.profileWidthMm;
    const dF = unit(sub(fInner, fOuter)); // along the front board, from the wall toward the free end
    const dB = unit(sub(bInner, bOuter));
    const first = { through: intoTread(fOuter, dF, p.frontMm + p.clearanceMm + w / 2, c), dir: dF };
    const last = { through: intoTread(bOuter, dB, p.shellMm + p.clearanceMm + w / 2, c), dir: dB };
    const wallPath = wallLine(wall);
    const s0 = wallPath.crossing(first.through, first.dir);
    const s1 = wallPath.crossing(last.through, last.dir);
    if (s0 === null || s1 === null || (s1 - s0) * Math.sign(wallPath.along(bOuter) - wallPath.along(fOuter)) <= 0) {
      warnings.push(`stopień ${tread.index + 1}: przy ścianie nie ma miejsca na profil ${w} mm między frontem a tyłem okładziny.`);
    } else {
      if (Math.abs(s1 - s0) < (p.profileCount - 1) * (w + 2 * p.clearanceMm)) {
        warnings.push(`stopień ${tread.index + 1}: przy ścianie mieści się mniej niż ${p.profileCount} profile ${w} mm — za wąski stopień (np. zabiegowy przy narożniku).`);
      }
      const lines = [];
      for (let k = 0; k < p.profileCount; k++) {
        const t = p.profileCount === 1 ? 0.5 : k / (p.profileCount - 1);
        lines.push({ start: wallPath.pointAt(s0 + (s1 - s0) * t), dir: unit({ x: dF.x + (dB.x - dF.x) * t, y: dF.y + (dB.y - dF.y) * t }) });
      }
      lines.forEach((line, k) => {
        const touches = [lines[k - 1], lines[k + 1]].filter(Boolean).map((other) => touchDistance(line, other, w + p.clearanceMm));
        const lengthMm = Math.min(p.profileProjectionMm, ...touches);
        const end = { x: line.start.x + line.dir.x * lengthMm, y: line.start.y + line.dir.y * lengthMm };
        if (!pointInPolygon(end, inner)) {
          // how long a profile may be here: along its line, until it would leave the box's inside
          let fit = 0;
          for (let r = p.wallGapMm + 1; r <= lengthMm; r += 5) {
            if (!pointInPolygon({ x: line.start.x + line.dir.x * r, y: line.start.y + line.dir.y * r }, inner)) break;
            fit = r;
          }
          warnings.push(`stopień ${tread.index + 1}: profil ${k + 1} (wysięg ${Math.round(lengthMm)} mm) wychodzi poza wnętrze okładziny — w tym miejscu mieści się profil do ok. ${Math.floor(fit / 5) * 5} mm.`);
        }
        profiles.push({ start: line.start, dir: line.dir, lengthMm, shortenedToNeighbour: lengthMm < p.profileProjectionMm - 1e-6, widthMm: w, heightMm: p.profileHeightMm, zBottom: bottom + p.shellMm + p.clearanceMm / 2 });
      });
    }
  }
  return { heightMm: top - bottom, parts, profiles, warnings };
}
