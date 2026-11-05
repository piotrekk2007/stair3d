// The balustrade of the module "Schody na beton" (stage 5, extended 2026-11-05 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): its own solver (the self-supporting railingSolver.js stays untouched — the isolation
// rule). A SECTION is a line along the stair (an open side chosen per flight — `railingSides`) or round the ceiling
// opening on the floor above (the antresola — `railingAntresola`, per edge `railingAntresolaEdges`, never the exit
// edge), described by its straight plan pieces, its ground (the treads / the floor) and its handrail top
// (`railingHeightMm` over the noses, level over a landing / `railingAntresolaHeightMm` over the floor). On it:
//   - POSTS (decorative): at the ends (stairs) / at every corner and end (antresola), between them where glass panes
//     need it, the user's own (`railingPostEdits[section].added`, s along the line) less the removed ones (`.removed`,
//     by id) — none of their own with glass on the concrete's side;
//   - the INFILL (`railingInfill`): `balusters` (square / round — `balusterShape`; per tread on the stairs, evenly
//     ≤ `railingMaxClearMm` elsewhere), `glass-posts` (one pane per span between posts, clamps on the posts) or
//     `glass-side` (panes on the concrete's / slab's side face on point fixings, the handrail on the glass);
//   - the HANDRAIL from end to end.
// A WALL HANDRAIL (`wallRails`, on a walled side) is no section: a handrail on brackets off the wall (`wallRails[]`).
// Glass sizes ASSUMPTION / DO WERYFIKACJI (as the self-supporting railingGlass.js numbers). Pure.

import { buildSideRuns, runPoint, runOutward } from './sideRuns.js';
import { wallOn } from './surroundingsModel.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const RAILING_INFILLS = Object.freeze({ balusters: 'tralki', 'glass-posts': 'szkło między słupami', 'glass-side': 'szkło na boku betonu (rotule)' });
export const GLASS_TINTS = Object.freeze({ clear: { label: 'bezbarwne', color: 0xcfe7e2, opacity: 0.3 }, optiwhite: { label: 'optiwhite', color: 0xf2f7f7, opacity: 0.22 }, grey: { label: 'grafit', color: 0x4b5258, opacity: 0.5 }, bronze: { label: 'brąz', color: 0x8a6a46, opacity: 0.45 } });

// a polyline of {s, z} → z at s (clamped to its ends)
function zAt(line, s) {
  if (s <= line[0].s) return line[0].z;
  for (let k = 1; k < line.length; k++) {
    if (s <= line[k].s) {
      const t = (s - line[k - 1].s) / (line[k].s - line[k - 1].s || 1);
      return line[k - 1].z + (line[k].z - line[k - 1].z) * t;
    }
  }
  return line[line.length - 1].z;
}

// --- the sections' lines ---------------------------------------------------------------------------------------

// a side's handrail top along s: `H` over every nose (a tread's front), level over a landing
function topOver(pieces, H) {
  const top = [];
  for (const p of pieces) {
    top.push({ s: p.s0, z: p.top + H });
    if (p.flat) top.push({ s: p.s1, z: p.top + H });
  }
  top.push({ s: pieces[pieces.length - 1].s1, z: pieces[pieces.length - 1].top + H });
  return top;
}

// a stair side: one straight piece along the flight (s = the run's s), the ground = the tread under s
function stairLine(run, config) {
  const { pieces } = run;
  const top = topOver(pieces, config.railingHeightMm);
  const s0 = pieces[0].s0;
  const s1 = pieces[pieces.length - 1].s1;
  const glassSide = config.railingInfill === 'glass-side';
  // the line: on the treads `railingInsetMm` in from their ends, or (glass on the side) outside the concrete face
  const off = glassSide ? config.glassStandoffMm + config.glassThicknessMm / 2 : -config.railingInsetMm;
  const piece = (s) => pieces.find((p) => s >= p.s0 - 1e-6 && s <= p.s1 + 1e-6) ?? (s < s0 ? pieces[0] : pieces[pieces.length - 1]);
  return {
    id: `railing-${run.key.flight}-${run.key.side}`,
    kind: 'stairs',
    key: run.key,
    s0,
    s1,
    at: (s) => runPoint(run, s, off),
    dirAt: () => run.frame.f,
    corners: [],
    top,
    groundAt: (s) => piece(s).top,
    // glass on the side: fixed to the concrete's side face under the treads
    baseAt: (s) => piece(s).concreteTop,
    treads: pieces.filter((p) => !p.flat),
    flats: pieces.filter((p) => p.flat),
    outward: runOutward(run),
  };
}

// the antresola: the free edges of the opening, `antresolaSetbackMm` back onto the slab (glass on the side: at the edge)
function antresolaLines(built, config) {
  const opening = built.slab?.opening;
  if (!opening?.length) return [];
  const last = built.concrete.elements.at(-1);
  const exitEdges = last.edges.filter((e) => e.role === 'back');
  const onExit = (a, b) => exitEdges.some((e) => [a, b].every((p) => Math.abs((e.b.x - e.a.x) * (p.y - e.a.y) - (e.b.y - e.a.y) * (p.x - e.a.x)) / (dist(e.a, e.b) || 1) < 1));
  const n = opening.length;
  const free = (k) => !onExit(opening[k], opening[(k + 1) % n]) && config.railingAntresolaEdges?.[k] !== false;
  // chains of consecutive free edges (a closed loop when every edge is free)
  const chains = [];
  const allFree = [...Array(n).keys()].every(free);
  if (allFree) chains.push([...Array(n).keys()]);
  else {
    const start = [...Array(n).keys()].find((k) => !free(k));
    let cur = null;
    for (let j = 1; j <= n; j++) {
      const k = (start + j) % n;
      if (free(k)) (cur ||= []).push(k);
      else if (cur) {
        chains.push(cur);
        cur = null;
      }
    }
    if (cur) chains.push(cur);
  }
  const floorZ = built.concrete.exit.rawSlabTopZ + config.floorFinishTopMm;
  const glassSide = config.railingInfill === 'glass-side';
  const d = glassSide ? -(config.glassStandoffMm + config.glassThicknessMm / 2) : config.antresolaSetbackMm;
  const top = floorZ + config.railingAntresolaHeightMm;
  return chains.map((edges) => {
    const closed = edges.length === n;
    // each edge moved onto the slab (out of the CCW opening: the edge turned clockwise), corners meeting
    const lines = edges.map((k) => {
      const a = opening[k];
      const b = opening[(k + 1) % n];
      const l = dist(a, b) || 1;
      const nrm = { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
      return { a: { x: a.x + nrm.x * d, y: a.y + nrm.y * d }, b: { x: b.x + nrm.x * d, y: b.y + nrm.y * d }, nrm };
    });
    const path = closed ? [] : [lines[0].a];
    for (let k = closed ? 0 : 1; k < lines.length; k++) {
      const prev = lines[(k - 1 + lines.length) % lines.length];
      path.push(crossing(prev, lines[k]) ?? lines[k].a);
    }
    if (closed) path.push(path[0]);
    else path.push(lines[lines.length - 1].b);
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + dist(path[k - 1], path[k]));
    const segAt = (s) => {
      for (let k = 1; k < path.length; k++) if (s <= cum[k] + 1e-6) return k;
      return path.length - 1;
    };
    return {
      id: `railing-antresola-e${edges[0]}`,
      kind: 'antresola',
      key: null,
      s0: 0,
      s1: cum[cum.length - 1],
      at: (s) => {
        const k = segAt(s);
        return lerp(path[k - 1], path[k], (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1));
      },
      dirAt: (s) => {
        const k = segAt(s);
        const l = dist(path[k - 1], path[k]) || 1;
        return { x: (path[k].x - path[k - 1].x) / l, y: (path[k].y - path[k - 1].y) / l };
      },
      // corners = the path's inner vertices (a closed loop: every vertex but the repeated end)
      corners: cum.slice(1, -1),
      cornerVertices: path.slice(1, -1),
      top: [{ s: 0, z: top }, { s: cum[cum.length - 1], z: top }],
      groundAt: () => floorZ,
      baseAt: () => built.concrete.exit.rawSlabTopZ,
      treads: [],
      flats: [{ s0: 0, s1: cum[cum.length - 1], top: floorZ }],
      // glass on the slab's edge hangs into the opening (the edge's outward normal reversed)
      outwardAt: (s) => {
        const t = (() => {
          const k = segAt(s);
          const l = dist(path[k - 1], path[k]) || 1;
          return { x: (path[k].x - path[k - 1].x) / l, y: (path[k].y - path[k - 1].y) / l };
        })();
        return { x: -t.y, y: t.x };
      },
      closed,
      floorZ,
    };
  });
}

function crossing(l1, l2) {
  const r = { x: l1.b.x - l1.a.x, y: l1.b.y - l1.a.y };
  const s = { x: l2.b.x - l2.a.x, y: l2.b.y - l2.a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.a.x - l1.a.x) * s.y - (l2.a.y - l1.a.y) * s.x) / den;
  return { x: l1.a.x + r.x * t, y: l1.a.y + r.y * t };
}

// --- posts, infill, handrail on a line -------------------------------------------------------------------------

function section(line, config) {
  const edits = config.railingPostEdits?.[line.id] || {};
  const removed = new Set(edits.removed || []);
  const size = config.postSizeMm;
  const glassSide = config.railingInfill === 'glass-side';
  const glassPosts = config.railingInfill === 'glass-posts';
  // the posts' spots: ends + corners (none of their own for glass on the side), the user's
  const spots = [];
  if (!glassSide) {
    if (line.kind === 'stairs') spots.push({ id: `${line.id}:start`, s: line.s0 + size / 2 }, { id: `${line.id}:end`, s: line.s1 - size / 2 });
    else {
      if (!line.closed) spots.push({ id: `${line.id}:start`, s: line.s0 }, { id: `${line.id}:end`, s: line.s1 });
      line.corners.forEach((s, k) => spots.push({ id: `${line.id}:c${k}`, s }));
    }
  }
  for (const m of edits.added || []) if (Number.isFinite(m.s) && m.s >= line.s0 && m.s <= line.s1) spots.push({ id: `${line.id}:m-${m.id}`, s: m.s, manual: true });
  let posts = spots.filter((p) => !removed.has(p.id)).sort((a, b) => a.s - b.s);
  // glass between posts: a post wherever a span is wider than a pane allows
  if (glassPosts) {
    const out = [];
    const stops = [line.s0, ...posts.map((p) => p.s), line.s1];
    posts.forEach((p) => out.push(p));
    for (let k = 1; k < stops.length; k++) {
      const span = stops[k] - stops[k - 1];
      const parts = Math.ceil(span / (config.glassMaxWidthMm + size));
      for (let j = 1; j < parts; j++) {
        const id = `${line.id}:g${k}-${j}`;
        if (!removed.has(id)) out.push({ id, s: stops[k - 1] + (span * j) / parts });
      }
    }
    posts = out.sort((a, b) => a.s - b.s);
  }
  const topAt = (s) => zAt(line.top, s);
  const postModels = posts.map((p) => ({ id: p.id, s: p.s, manual: !!p.manual, at: line.at(p.s), bottomZ: line.groundAt(p.s), topZ: topAt(p.s) + config.postAboveHandrailMm, size, cap: config.postCap, capHeightMm: config.postCapHeightMm, grooves: config.postGrooves }));
  const clear = (s, w) => posts.every((p) => Math.abs(s - p.s) > (size + w) / 2 + 1);
  // the infill
  const balusters = [];
  const panes = [];
  let fixings = 0;
  if (config.railingInfill === 'balusters') {
    const w = config.balusterSizeMm;
    const at = (s) => ({ at: line.at(s), bottomZ: line.groundAt(s), topZ: topAt(s) - config.handrailHeightMm, size: w, shape: config.balusterShape });
    for (const p of line.treads) {
      const n = config.balustersPerTread;
      for (let j = 0; j < n; j++) {
        const s = p.s0 + ((j + 0.5) * (p.s1 - p.s0)) / n;
        if (s > line.s0 && s < line.s1 && clear(s, w)) balusters.push(at(s));
      }
    }
    // a landing / the antresola: evenly between the stops (posts, the piece's ends) ≤ the clear gap
    for (const f of line.flats) {
      const stops = [f.s0, ...posts.map((p) => p.s).filter((s) => s > f.s0 && s < f.s1), f.s1];
      for (let k = 1; k < stops.length; k++) {
        const a = stops[k - 1] + (posts.some((p) => Math.abs(p.s - stops[k - 1]) < 1e-6) ? size / 2 : 0);
        const b = stops[k] - (posts.some((p) => Math.abs(p.s - stops[k]) < 1e-6) ? size / 2 : 0);
        const count = Math.max(0, Math.ceil((b - a) / (config.railingMaxClearMm + w)) - 1);
        for (let j = 1; j <= count; j++) balusters.push(at(a + ((b - a) * j) / (count + 1)));
      }
    }
  } else {
    // glass: panes along the line, each a polygon in its own vertical plane (straight pieces only — a pane never turns
    // a corner)
    const cuts = [line.s0, ...(glassSide ? [] : posts.map((p) => p.s)), ...line.corners, line.s1].sort((a, b) => a - b).filter((s, k, all) => k === 0 || s - all[k - 1] > 1);
    for (let k = 1; k < cuts.length; k++) {
      let a = cuts[k - 1];
      let b = cuts[k];
      if (!glassSide) {
        if (posts.some((p) => Math.abs(p.s - a) < 1e-6)) a += size / 2;
        if (posts.some((p) => Math.abs(p.s - b) < 1e-6)) b -= size / 2;
        a += config.glassGapMm;
        b -= config.glassGapMm;
      }
      // glass on the side: the stretch split into equal panes ≤ the pane width, a gap between them
      const parts = glassSide ? Math.max(1, Math.ceil((b - a) / config.glassMaxWidthMm)) : 1;
      for (let j = 0; j < parts; j++) {
        const pa = a + ((b - a) * j) / parts + (glassSide && j > 0 ? config.glassGapMm / 2 : 0);
        const pb = a + ((b - a) * (j + 1)) / parts - (glassSide && j < parts - 1 ? config.glassGapMm / 2 : 0);
        if (pb - pa < 50) continue;
        // the pane's top under the handrail, its bottom over the noses (between posts) or down the concrete's side
        const ss = [pa, ...line.top.map((q) => q.s).filter((s) => s > pa && s < pb), pb];
        const topLine = ss.map((s) => ({ s, z: topAt(s) - config.handrailHeightMm - (glassSide ? 0 : config.glassTopGapMm) }));
        const bottomLine = ss.map((s) => ({ s, z: glassSide ? line.baseAt(s) - config.glassOverlapMm : topAt(s) - (line.kind === 'stairs' ? config.railingHeightMm : config.railingAntresolaHeightMm) + config.glassBottomGapMm }));
        const mid = (pa + pb) / 2;
        const dir = line.dirAt(mid);
        // the plane: through the line at s = 0 of this pane's straight piece
        const origin = { x: line.at(pa).x - dir.x * pa, y: line.at(pa).y - dir.y * pa };
        const nrm = { x: -dir.y, y: dir.x };
        const zs = [...topLine, ...bottomLine].map((q) => q.z);
        panes.push({
          polygon: [...bottomLine, ...[...topLine].reverse()],
          origin: { x: origin.x - nrm.x * (config.glassThicknessMm / 2), y: origin.y - nrm.y * (config.glassThicknessMm / 2) },
          dir,
          normal: nrm,
          thicknessMm: config.glassThicknessMm,
          widthMm: pb - pa,
          heightMm: Math.max(...zs) - Math.min(...zs),
          // the rectangle it is cut from (priced per m²)
          blankAreaM2: ((pb - pa) * (Math.max(...zs) - Math.min(...zs))) / 1e6,
        });
        fixings += glassSide ? config.glassFixingsPerPane : 2 * config.glassClampsPerSide;
      }
    }
  }
  // the handrail: end to end at its top, its centre line half its height lower; on the glass with glass on the side
  const ss = [line.s0, ...line.top.map((q) => q.s).filter((s) => s > line.s0 && s < line.s1), ...line.corners, line.s1].sort((a, b) => a - b).filter((s, k, all) => k === 0 || s - all[k - 1] > 1e-6);
  const handrail = ss.map((s) => ({ ...line.at(s), z: topAt(s) - config.handrailHeightMm / 2 }));
  let length = 0;
  for (let k = 1; k < handrail.length; k++) length += Math.hypot(handrail[k].x - handrail[k - 1].x, handrail[k].y - handrail[k - 1].y, handrail[k].z - handrail[k - 1].z);
  return {
    id: line.id,
    kind: line.kind,
    key: line.key,
    infill: config.railingInfill,
    s0: line.s0,
    s1: line.s1,
    // the plan line for the editor (posts added / removed by s along it)
    path: ss.map((s) => ({ s, ...line.at(s) })),
    handrail,
    posts: postModels,
    removedPosts: spots.filter((p) => removed.has(p.id)).map((p) => ({ id: p.id, s: p.s, at: line.at(p.s) })),
    balusters,
    panes,
    fixings,
    treadCount: line.treads.length,
    lengthMm: length,
  };
}

// --- the wall handrail (user request 2026-11-05) ----------------------------------------------------------------

/**
 * A handrail on brackets along a walled side (`wallRails[flight][side]`): its top `wallRailHeightMm` over the noses
 * (level over a landing), its axis `wallRailClearanceMm` + half its width off the wall's face (= the concrete's side
 * edge), over the side's whole length; optionally returned into the wall at both ends (`wallRailReturn`). Brackets
 * evenly ≤ `wallRailBracketSpacingMm` apart, the outer ones `wallRailBracketEndMm` in from the ends (at least two).
 * A wall "above the steps" lower than the handrail (+ 50 mm for the bracket) carries none — WARNING CLAD-WALL-RAIL-LOW.
 */
function wallRail(run, config) {
  const { pieces } = run;
  const id = `wall-rail-${run.key.flight}-${run.key.side}`;
  const top = topOver(pieces, config.wallRailHeightMm);
  const off = -(config.wallRailClearanceMm + config.handrailWidthMm / 2);
  const s0 = pieces[0].s0;
  const s1 = pieces[pieces.length - 1].s1;
  const zc = (s) => zAt(top, s) - config.handrailHeightMm / 2;
  const ss = [s0, ...top.map((q) => q.s).filter((s) => s > s0 + 1e-6 && s < s1 - 1e-6), s1];
  let handrail = ss.map((s) => ({ ...runPoint(run, s, off), z: zc(s) }));
  if (config.wallRailReturn) handrail = [{ ...runPoint(run, s0, 0), z: zc(s0) }, ...handrail, { ...runPoint(run, s1, 0), z: zc(s1) }];
  const a = s0 + config.wallRailBracketEndMm;
  const b = s1 - config.wallRailBracketEndMm;
  const count = Math.max(2, Math.ceil((b - a) / config.wallRailBracketSpacingMm - 1e-9) + 1);
  const spots = b - a <= 1 ? [(s0 + s1) / 2] : Array.from({ length: count }, (_, k) => a + ((b - a) * k) / (count - 1));
  const brackets = spots.map((s) => ({ s, wall: runPoint(run, s, 0), rail: runPoint(run, s, off), z: zc(s) - config.handrailHeightMm / 2 }));
  let lengthMm = 0;
  for (let k = 1; k < handrail.length; k++) lengthMm += Math.hypot(handrail[k].x - handrail[k - 1].x, handrail[k].y - handrail[k - 1].y, handrail[k].z - handrail[k - 1].z);
  return { id, kind: 'wall', key: run.key, handrail, brackets, lengthMm, treadCount: pieces.filter((p) => !p.flat).length, outward: runOutward(run) };
}

/** @returns {{sections: object[], wallRails: object[], diagnostics: object[]}} */
export function buildBalustrade(built, config) {
  const lines = [];
  const wallRails = [];
  const diagnostics = [];
  for (const run of buildSideRuns(built.concrete, config)) {
    if (!run.pieces.length) continue;
    if (run.walled) {
      if (!config.wallRails?.[run.key.flight]?.[run.key.side]) continue;
      const w = wallOn(run.key, config);
      const need = config.wallRailHeightMm + 50;
      if (w?.type === 'low' && w.heightAboveMm > 0 && w.heightAboveMm < need) {
        diagnostics.push(createDiagnostic({ ruleId: 'CLAD-WALL-RAIL-LOW', severity: 'WARNING', elementType: 'railing', elementId: `wall-rail-${run.key.flight}-${run.key.side}`, parameter: 'heightAboveMm', value: w.heightAboveMm, expected: `>= ${need}`, unit: 'mm', message: `Bieg ${run.key.flight + 1}, strona ${run.key.side === 'left' ? 'lewa' : 'prawa'}: ściana ma tylko ${w.heightAboveMm} mm nad noskami — poręcz przyścienna (${config.wallRailHeightMm} mm + uchwyt) się na niej nie zmieści. Podnieś ścianę albo daj balustradę.` }));
        continue;
      }
      wallRails.push(wallRail(run, config));
      continue;
    }
    if (!config.railingSides?.[run.key.flight]?.[run.key.side]) continue;
    lines.push(stairLine(run, config));
  }
  if (config.railingAntresola) lines.push(...antresolaLines(built, config));
  return { sections: lines.map((l) => section(l, config)), wallRails, diagnostics };
}

/** The nearest point of a section's line to a plan point → its s (for adding a post on the plan). */
export function sNearest(section, p) {
  let best = null;
  for (let k = 1; k < section.path.length; k++) {
    const a = section.path[k - 1];
    const b = section.path[k];
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { d, s: a.s + (b.s - a.s) * t };
  }
  return best;
}
