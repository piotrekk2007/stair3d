// The balustrade of the module "Schody na beton" (stage 5 — docs/architecture/CONCRETE_CLADDING_MODULE.md): its own,
// simple solver (the self-supporting railingSolver.js stays untouched — the isolation rule): on every open side chosen
// per flight a section — a decorative post at its start and end, the handrail `railingHeightMm` above the noses (level
// over a landing), balusters standing on the treads (`balustersPerTread`, on a landing at most `railingMaxClearMm`
// apart) — and the antresola balustrade round the ceiling opening (not on its exit edge) on the floor above. Pure.

import { buildSideRuns, runPoint } from './sideRuns.js';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function post(id, at, bottomZ, handrailTopZ, config) {
  return { id, at, bottomZ, topZ: handrailTopZ + config.postAboveHandrailMm, size: config.postSizeMm, cap: config.postCap, capHeightMm: config.postCapHeightMm, grooves: config.postGrooves };
}
// the handrail's z at s along a polyline of {s, z}
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

function stairSection(run, config) {
  const { pieces } = run;
  const H = config.railingHeightMm;
  const inset = config.railingInsetMm;
  // the handrail's top through the noses (+ H), level along a landing
  const line = [];
  for (const p of pieces) {
    line.push({ s: p.s0, z: p.top + H });
    if (p.flat) line.push({ s: p.s1, z: p.top + H });
  }
  line.push({ s: pieces[pieces.length - 1].s1, z: pieces[pieces.length - 1].top + H });
  const s0 = pieces[0].s0 + config.postSizeMm / 2;
  const s1 = pieces[pieces.length - 1].s1 - config.postSizeMm / 2;
  const at = (s) => runPoint(run, s, -inset);
  const posts = [post(`post-${run.key.flight}-${run.key.side}-start`, at(s0), pieces[0].top, zAt(line, s0), config), post(`post-${run.key.flight}-${run.key.side}-end`, at(s1), pieces[pieces.length - 1].top, zAt(line, s1), config)];
  const clearOfPosts = (s) => Math.abs(s - s0) > (config.postSizeMm + config.balusterSizeMm) / 2 && Math.abs(s - s1) > (config.postSizeMm + config.balusterSizeMm) / 2;
  const balusters = [];
  for (const p of pieces) {
    const len = p.s1 - p.s0;
    const n = p.flat ? Math.max(1, Math.ceil(len / (config.railingMaxClearMm + config.balusterSizeMm)) - 1) : config.balustersPerTread;
    for (let j = 0; j < n; j++) {
      const s = p.s0 + ((j + (p.flat ? 1 : 0.5)) * len) / (p.flat ? n + 1 : n);
      if (!clearOfPosts(s) || s < s0 || s > s1) continue;
      balusters.push({ at: at(s), bottomZ: p.top, topZ: zAt(line, s) - config.handrailHeightMm, size: config.balusterSizeMm });
    }
  }
  const handrail = line.filter((q) => q.s >= s0 - 1e-6 && q.s <= s1 + 1e-6);
  const rail = [{ s: s0, z: zAt(line, s0) }, ...handrail.filter((q) => q.s > s0 + 1e-6 && q.s < s1 - 1e-6), { s: s1, z: zAt(line, s1) }].map((q) => ({ ...at(q.s), z: q.z - config.handrailHeightMm / 2 }));
  return { id: `railing-${run.key.flight}-${run.key.side}`, kind: 'stairs', key: run.key, handrail: rail, posts, balusters, treadCount: pieces.filter((p) => !p.flat).length, lengthMm: length3d(rail) };
}

function length3d(pts) {
  let l = 0;
  for (let k = 1; k < pts.length; k++) l += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z);
  return l;
}

// the antresola: round the opening on the floor above, `antresolaSetbackMm` back from its edge, not on the edge the stair
// arrives at (the last back edge's line)
function antresolaSection(built, config) {
  const opening = built.slab?.opening;
  if (!opening?.length) return null;
  const last = built.concrete.elements.at(-1);
  const exitEdges = last.edges.filter((e) => e.role === 'back');
  const onExit = (a, b) => exitEdges.some((e) => [a, b].every((p) => Math.abs((e.b.x - e.a.x) * (p.y - e.a.y) - (e.b.y - e.a.y) * (p.x - e.a.x)) / (dist(e.a, e.b) || 1) < 1));
  const floorZ = built.concrete.exit.rawSlabTopZ + config.floorFinishTopMm;
  const n = opening.length;
  // the opening's edges in order, starting just after the exit edge, so the free ones form one open chain
  const exitAt = [...Array(n).keys()].find((k) => onExit(opening[k], opening[(k + 1) % n]));
  const start = exitAt === undefined ? 0 : exitAt + 1;
  const chain = [];
  for (let j = 0; j < n; j++) {
    const k = (start + j) % n;
    const a = opening[k];
    const b = opening[(k + 1) % n];
    if (onExit(a, b)) continue;
    chain.push({ a, b });
  }
  if (!chain.length) return null;
  // moved back onto the slab (out of the CCW opening: the edge turned clockwise), corners meeting
  const off = (e) => {
    const l = dist(e.a, e.b) || 1;
    const nrm = { x: (e.b.y - e.a.y) / l, y: -(e.b.x - e.a.x) / l };
    const d = config.antresolaSetbackMm;
    return { a: { x: e.a.x + nrm.x * d, y: e.a.y + nrm.y * d }, b: { x: e.b.x + nrm.x * d, y: e.b.y + nrm.y * d } };
  };
  const lines = chain.map(off);
  const path = [lines[0].a];
  for (let k = 1; k < lines.length; k++) path.push(crossing(lines[k - 1], lines[k]) ?? lines[k].a);
  path.push(lines[lines.length - 1].b);
  const top = floorZ + config.railingAntresolaHeightMm;
  const posts = path.map((p, k) => post(`post-antresola-${k}`, p, floorZ, top, config));
  const balusters = [];
  const pitch = config.railingMaxClearMm + config.balusterSizeMm;
  for (let k = 1; k < path.length; k++) {
    const len = dist(path[k - 1], path[k]);
    const free = len - config.postSizeMm;
    const count = Math.max(0, Math.ceil(free / pitch) - 1);
    for (let j = 1; j <= count; j++) balusters.push({ at: lerp(path[k - 1], path[k], j / (count + 1)), bottomZ: floorZ, topZ: top - config.handrailHeightMm, size: config.balusterSizeMm });
  }
  const rail = path.map((p) => ({ ...p, z: top - config.handrailHeightMm / 2 }));
  return { id: 'railing-antresola', kind: 'antresola', key: null, handrail: rail, posts, balusters, treadCount: 0, lengthMm: length3d(rail) };
}

function crossing(l1, l2) {
  const r = { x: l1.b.x - l1.a.x, y: l1.b.y - l1.a.y };
  const s = { x: l2.b.x - l2.a.x, y: l2.b.y - l2.a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.a.x - l1.a.x) * s.y - (l2.a.y - l1.a.y) * s.x) / den;
  return { x: l1.a.x + r.x * t, y: l1.a.y + r.y * t };
}

/** @returns {{sections: object[]}} */
export function buildBalustrade(built, config) {
  const sections = [];
  for (const run of buildSideRuns(built.concrete, config)) {
    if (run.walled || !config.railingSides?.[run.key.flight]?.[run.key.side] || !run.pieces.length) continue;
    sections.push(stairSection(run, config));
  }
  if (config.railingAntresola) {
    const a = antresolaSection(built, config);
    if (a) sections.push(a);
  }
  return { sections };
}
