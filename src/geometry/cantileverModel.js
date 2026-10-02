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

  // profiles: square to the wall, spread along the wall line between the front and the back boards
  const profiles = [];
  const wall = planTread.outerChain || [];
  const cum = [0];
  for (let i = 1; i < wall.length; i++) cum.push(cum[i - 1] + len(sub(wall[i], wall[i - 1])));
  const L = cum[cum.length - 1] || 0;
  const at = (s) => {
    for (let i = 0; i < wall.length - 1; i++) {
      if (s <= cum[i + 1] + 1e-9 || i === wall.length - 2) {
        const segLen = cum[i + 1] - cum[i] || 1;
        const t = Math.min(1, Math.max(0, (s - cum[i]) / segLen));
        const d = unit(sub(wall[i + 1], wall[i]));
        let n = { x: -d.y, y: d.x };
        const pt = { x: wall[i].x + (wall[i + 1].x - wall[i].x) * t, y: wall[i].y + (wall[i + 1].y - wall[i].y) * t };
        if ((c.x - pt.x) * n.x + (c.y - pt.y) * n.y < 0) n = { x: -n.x, y: -n.y };
        return { pt, dir: n, along: d };
      }
    }
    return null;
  };
  if (L > 0 && inner) {
    // the usable stretch of the wall: where a profile's whole width lies inside the box (trimmed at the boards)
    const half = p.profileWidthMm / 2 + p.clearanceMm;
    const inside = (s) => {
      const g = at(s);
      if (!g) return false;
      const probe = (k) => ({ x: g.pt.x + g.dir.x * (p.wallGapMm + 1) + g.along.x * k, y: g.pt.y + g.dir.y * (p.wallGapMm + 1) + g.along.y * k });
      return pointInPolygon(probe(-half), inner) && pointInPolygon(probe(half), inner);
    };
    const steps = Math.max(40, Math.ceil(L / 5));
    const ok = [];
    for (let k = 0; k <= steps; k++) if (inside((L * k) / steps)) ok.push((L * k) / steps);
    if (ok.length === 0) {
      warnings.push(`stopień ${tread.index + 1}: przy ścianie nie ma miejsca na profil ${p.profileWidthMm} mm między frontem a tyłem okładziny.`);
    } else {
      const s0 = ok[0];
      const s1 = ok[ok.length - 1];
      if (s1 - s0 < (p.profileCount - 1) * (p.profileWidthMm + 2 * p.clearanceMm)) {
        warnings.push(`stopień ${tread.index + 1}: przy ścianie mieści się mniej niż ${p.profileCount} profile ${p.profileWidthMm} mm — za wąski stopień (np. zabiegowy przy narożniku).`);
      }
      for (let k = 0; k < p.profileCount; k++) {
        const s = p.profileCount === 1 ? (s0 + s1) / 2 : s0 + ((s1 - s0) * k) / (p.profileCount - 1);
        const g = at(s);
        const end = { x: g.pt.x + g.dir.x * p.profileProjectionMm, y: g.pt.y + g.dir.y * p.profileProjectionMm };
        if (!pointInPolygon(end, inner)) {
          // how long a profile may be here: along its line, until it would leave the box's inside
          let fit = 0;
          for (let r = p.wallGapMm + 1; r <= p.profileProjectionMm; r += 5) {
            if (!pointInPolygon({ x: g.pt.x + g.dir.x * r, y: g.pt.y + g.dir.y * r }, inner)) break;
            fit = r;
          }
          warnings.push(`stopień ${tread.index + 1}: profil ${k + 1} (wysięg ${p.profileProjectionMm} mm) wychodzi poza wnętrze okładziny — w tym miejscu mieści się profil do ok. ${Math.floor(fit / 5) * 5} mm.`);
        }
        profiles.push({ start: g.pt, dir: g.dir, lengthMm: p.profileProjectionMm, widthMm: p.profileWidthMm, heightMm: p.profileHeightMm, zBottom: bottom + p.shellMm + p.clearanceMm / 2 });
      }
    }
  }
  return { heightMm: top - bottom, parts, profiles, warnings };
}
