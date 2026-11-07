// The wooden cladding laid on the measured concrete (module "Schody na beton", stage 1 —
// docs/architecture/CONCRETE_CLADDING_MODULE.md): per concrete step its tread (the step's top + the front nosing past
// the riser board + a side nosing past the concrete on every open side), its riser board, the exit riser up to the
// slab, and the FINISHED heights — what the installer checks before ordering. Pure, no Three.js.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { clipToConvex } from '../geometry/polygonClip.js';
import { edgeHasWall, edgeHasRakedCover, edgeHasSideGlass, splitEdgesByWalls } from './surroundingsModel.js';
import { isStarter, starterEdges, starterRiserStrip, EDGE_PROFILES } from './starterProfile.js';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Does this element get a side nosing on `side` (walking up)? A step's own override wins; a turning landing never on
 *  the side the next flight leaves from; along a wall (stage 3, surroundingsModel.js) none — pass the edge. */
export function sideNosingOn(element, side, config, edge = null) {
  if (element.exitSide === side) return false;
  const o = config.stepOverrides?.[element.index] || {};
  const own = side === 'left' ? o.nosingLeft : o.nosingRight;
  if (typeof own === 'boolean') return own;
  if (edge && (edgeHasWall(element, edge, config) || edgeHasRakedCover(element, edge, config) || edgeHasSideGlass(element, edge, config))) return false;
  return side === 'left' ? !!config.sideNosingLeft : !!config.sideNosingRight;
}

/** The finish's thickness on this element: a floor-board landing = OSB + boards, else the tread's. */
export function finishThicknessMm(element, config) {
  return element.kind === 'landing' && element.finish === 'floorboard' ? config.osbThicknessMm + config.floorboardThicknessMm : config.treadThicknessMm;
}

// a tread's type by its side nosings (user request 2026-11-05): L = nosed on the left (walking up), P = on the right,
// CZ (czołowy) = between walls — no side nosing, PL = both sides free
export const TREAD_SIDE_TYPES = Object.freeze({
  L: 'lewy — nosek boczny z lewej',
  P: 'prawy — nosek boczny z prawej',
  CZ: 'czołowy — między ścianami, bez noska bocznego',
  PL: 'obustronny — nosek boczny z obu stron',
});
export const treadSideType = (nosing) => (nosing.leftMm > 0 && nosing.rightMm > 0 ? 'PL' : nosing.leftMm > 0 ? 'L' : nosing.rightMm > 0 ? 'P' : 'CZ');

/** The riser board's thickness: a carpet riser (between the treads) is as thick as a tread. */
export const riserThicknessOf = (config) => (config.riserMount === 'carpet' ? config.treadThicknessMm : config.riserThicknessMm);

export function riserOn(element, config) {
  const own = config.stepOverrides?.[element.index]?.riser;
  return typeof own === 'boolean' ? own : !!config.riserBoards;
}

const unit = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
// out of a CCW polygon: the edge direction turned clockwise
const outward = (e) => {
  const t = unit(e.a, e.b);
  return { x: t.y, y: -t.x };
};
const add = (p, n, d) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

/** A CCW polygon given as edges, each moved outward by its own distance; neighbours meet at their lines' crossing, two
 *  collinear neighbours with different distances step from one to the other. */
export function offsetEdges(edges, distOf) {
  return offsetEdgesDetailed(edges, distOf).points;
}

/** offsetEdges with, per output point, the edge that STARTS there (null for the step between two collinear edges). */
export function offsetEdgesDetailed(edges, distOf) {
  const lines = edges.map((e) => {
    const n = outward(e);
    const d = distOf(e);
    return { a: add(e.a, n, d), b: add(e.b, n, d), n, d, t: unit(e.a, e.b), from: e.a, edge: e };
  });
  const points = [];
  const starts = [];
  lines.forEach((L, j) => {
    const P = lines[(j - 1 + lines.length) % lines.length];
    const cross = P.t.x * L.t.y - P.t.y * L.t.x;
    if (Math.abs(cross) < 1e-9) {
      if (Math.abs(P.d - L.d) < 1e-9) {
        points.push(L.a);
        starts.push(L.edge);
      } else {
        points.push(add(L.from, P.n, P.d), L.a);
        starts.push(null, L.edge);
      }
      return;
    }
    // P.a + s·P.t = L.a + u·L.t
    const w = { x: L.a.x - P.a.x, y: L.a.y - P.a.y };
    const sParam = (w.x * L.t.y - w.y * L.t.x) / cross;
    points.push({ x: P.a.x + P.t.x * sParam, y: P.a.y + P.t.y * sParam });
    starts.push(L.edge);
  });
  return { points, starts };
}

// the board's size: along the grain (the front edge) × across it
function boardSize(outline, grain) {
  const n = { x: -grain.y, y: grain.x };
  const us = outline.map((p) => p.x * grain.x + p.y * grain.y);
  const vs = outline.map((p) => p.x * n.x + p.y * n.y);
  return { lengthMm: Math.max(...us) - Math.min(...us), depthMm: Math.max(...vs) - Math.min(...vs) };
}

/**
 * @param {object} concrete  buildConcreteModel's result
 * @returns {{treads, risers, heights, diagnostics}}
 */
export function buildCladdingModel(concrete, config) {
  const r = riserThicknessOf(config);
  const carpet = config.riserMount === 'carpet';
  // (behind the tread: up into the tread above's groove; a carpet riser butts on its loose tongue)
  const overlap = carpet ? 0 : config.riserTopOverlapMm;
  const els = concrete.elements;
  // an edge of an element lying on a front edge of the next one (the riser there stands on / behind it) — on its line
  // AND overlapping it (user report 2026-11-06: a U landing's front lies on the line of the return flight's first front
  // edge without touching it, and lost its nosing to a riser that is not there)
  const onFrontOf = (edge, next) =>
    !!next &&
    next.edges.some((f) => {
      if (f.role !== 'front') return false;
      const t = unit(f.a, f.b);
      const off = (p) => Math.abs((p.x - f.a.x) * t.y - (p.y - f.a.y) * t.x);
      if (!(off(edge.a) < 0.5 && off(edge.b) < 0.5)) return false;
      const along = (p) => (p.x - f.a.x) * t.x + (p.y - f.a.y) * t.y;
      const fl = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
      const lo = Math.max(0, Math.min(along(edge.a), along(edge.b)));
      const hi = Math.min(fl, Math.max(along(edge.a), along(edge.b)));
      return hi - lo > 1;
    });
  const treads = [];
  const risers = [];
  const starterBlocks = [];
  const thick = (e) => finishThicknessMm(e, config);
  els.forEach((e, i) => {
    const t = thick(e);
    const riser = riserOn(e, config);
    const front = config.nosingFrontMm + (riser ? r : 0);
    // behind the tread: this tread ends at the face of the riser standing on its back edge (the next step's, or the
    // exit riser at the slab's edge)
    const next = els[i + 1];
    const behindAtBack = (edge) => !carpet && ((next && riserOn(next, config) && onFrontOf(edge, next)) || (!next && edge.role === 'back' && config.riserBoards));
    const distOf = (edge) => {
      if (behindAtBack(edge)) return -r;
      if (edge.role === 'front') return front;
      if (edge.role === 'left' || edge.role === 'right') return sideNosingOn(e, edge.role, config, edge) ? config.sideNosingMm : 0;
      return 0;
    };
    // (a side edge split where a wall ends part-way along it: the side nosing on its free part only — a jog at the wall's
    // end)
    const edges = splitEdgesByWalls(e, config);
    const nosing = { left: edges.some((x) => x.role === 'left' && distOf(x) > 0) ? config.sideNosingMm : 0, right: edges.some((x) => x.role === 'right' && distOf(x) > 0) ? config.sideNosingMm : 0 };
    const own = config.stepOverrides?.[e.index] || {};
    // a starter step (stage 5 part 2, starterProfile.js): its own widened / rounded / bowed outline
    const starter = e.kind === 'step' && isStarter(own.starter) ? own.starter : null;
    let outline;
    let exposed;
    if (starter) {
      const reach = { front, left: nosing.left, right: nosing.right };
      const { edges } = starterEdges(e, starter, reach, 0);
      outline = edges.map((x) => x.a);
      exposed = edges.map((x) => x.role === 'front' || (x.role === 'left' && (starter.leftMm > 0 || nosing.left > 0)) || (x.role === 'right' && (starter.rightMm > 0 || nosing.right > 0)));
    } else {
      const d = offsetEdgesDetailed(edges, distOf);
      outline = d.points;
      // the edges a profile is milled on: the front and every nosed side
      exposed = d.starts.map((x) => !!x && (x.role === 'front' || ((x.role === 'left' || x.role === 'right') && distOf(x) > 0)));
    }
    const profileKind = EDGE_PROFILES.includes(own.profile) ? own.profile : config.edgeProfile;
    const profiledLengthMm = outline.reduce((sum, p, k) => (exposed[k] ? sum + Math.hypot(outline[(k + 1) % outline.length].x - p.x, outline[(k + 1) % outline.length].y - p.y) : sum), 0);
    const fronts = e.edges.filter((edge) => edge.role === 'front');
    const longest = fronts.reduce((best, edge) => (!best || Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) > Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y) ? edge : best), null);
    // the grain: along the front (as the joiners lay a tread); a landing deeper than it is wide along the front — its
    // boards along the longer side (user report 2026-11-06: boards ~2.5 m long go lengthwise on most landings)
    const frontDir = longest ? unit(longest.a, longest.b) : { x: 1, y: 0 };
    let grain = frontDir;
    if (e.kind === 'landing') {
      const across = { x: 0 - frontDir.y, y: frontDir.x + 0 }; // (no −0)
      const extent = (d) => Math.max(...outline.map((p) => p.x * d.x + p.y * d.y)) - Math.min(...outline.map((p) => p.x * d.x + p.y * d.y));
      if (extent(across) > 1.1 * extent(frontDir)) grain = across; // (clearly deeper — a near-square one stays as a tread)
    }
    treads.push({
      id: `${e.kind}-${e.index}`,
      index: e.index,
      kind: e.kind,
      outline,
      bottomZ: e.topZ,
      topZ: e.topZ + t,
      thicknessMm: t,
      nosing: { frontMm: config.nosingFrontMm, leftMm: nosing.left, rightMm: nosing.right },
      sideType: treadSideType({ leftMm: nosing.left, rightMm: nosing.right }),
      // the production blank (stage 4 prices it): along the grain × across
      ...boardSize(outline, grain),
      grain,
      // (a floor-board landing's nosing piece: a strip along the front — its grain along it)
      nosingGrain: frontDir,
      finish: e.kind === 'landing' ? e.finish || 'wood' : 'wood',
      // a floor-board landing (user, 2026-11-04): a solid nosing piece along its front hiding the OSB, the rest OSB +
      // floor boards, all flush on top
      parts: e.kind === 'landing' && e.finish === 'floorboard' ? floorboardParts(e, outline, config) : null,
      exposed,
      profile: { kind: profileKind, sizeMm: config.edgeProfileMm },
      profiledLengthMm: profileKind === 'square' ? 0 : profiledLengthMm,
      starter: starter ? { ...starter } : null,
    });
    const below = i === 0 ? config.floorFinishBottomMm : els[i - 1].topZ + thick(els[i - 1]);
    // the riser's bottom: behind the tread below = its underside (the concrete; the first one on the raw floor, the
    // floor finish laid against it); a carpet riser stands on the tread below
    const riserBottom = carpet ? below : i === 0 ? 0 : els[i - 1].topZ;
    const riserTop = e.topZ + overlap;
    const fit = { mount: config.riserMount, overlapMm: overlap, tongues: carpet ? 2 : 0 };
    if (starter) {
      // the bent riser round its front, the support block under the widening (inside the riser)
      const reach = { front, left: nosing.left, right: nosing.right };
      if (riser) {
        const strip = starterRiserStrip(e, starter, reach, config.nosingFrontMm, r);
        if (strip) risers.push({ id: `riser-${e.index}`, index: e.index, outline: strip.outline, bottomZ: riserBottom, topZ: riserTop, heightMm: riserTop - riserBottom, lengthMm: strip.lengthMm, thicknessMm: r, grain: unit(fronts[0].a, fronts[0].b), bent: true, ...fit });
      }
      const inner = starterEdges(e, starter, reach, config.nosingFrontMm + (riser ? r : 0)).edges.map((x) => x.a);
      starterBlocks.push({ id: `starter-block-${e.index}`, index: e.index, outline: inner, bottomZ: e.bottomZ, topZ: e.topZ });
      return;
    }
    if (riser) {
      fronts.forEach((edge, k) => {
        const n = outward(edge);
        risers.push({
          id: fronts.length > 1 ? `riser-${e.index}-${k}` : `riser-${e.index}`,
          index: e.index,
          outline: [edge.a, edge.b, add(edge.b, n, r), add(edge.a, n, r)].reverse(),
          bottomZ: riserBottom,
          topZ: riserTop,
          heightMm: riserTop - riserBottom,
          ...fit,
          lengthMm: Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y),
          thicknessMm: r,
          grain: unit(edge.a, edge.b),
        });
      });
    }
  });
  // the antresola nosing (stage 3): a solid piece on the slab's edge along the last back edge — over the exit riser by
  // the front nosing, `exitNosingDepthMm` onto the slab, its top flush with the finished floor above
  const last = els.at(-1);
  const floorAbove = concrete.exit.rawSlabTopZ + config.floorFinishTopMm;
  const exitNosing = [];
  if (last && config.exitNosing) {
    const over = config.nosingFrontMm + (config.riserBoards ? r : 0);
    last.edges
      .filter((edge) => edge.role === 'back')
      .forEach((edge, k) => {
        const n = outward(edge);
        exitNosing.push({
          id: k ? `exit-nosing-${k}` : 'exit-nosing',
          outline: [add(edge.a, n, -over), add(edge.b, n, -over), add(edge.b, n, config.exitNosingDepthMm), add(edge.a, n, config.exitNosingDepthMm)].reverse(),
          topZ: floorAbove,
          bottomZ: floorAbove - config.treadThicknessMm,
          thicknessMm: config.treadThicknessMm,
          lengthMm: Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y),
          depthMm: over + config.exitNosingDepthMm,
          grain: unit(edge.a, edge.b),
          // (its edge and offsets — the opening's trim („fajka”) beside it is mitred into it, openingTrimModel.js)
          edge: { a: edge.a, b: edge.b },
          overMm: over,
          onSlabMm: config.exitNosingDepthMm,
        });
      });
  }
  // the exit riser: on the last tread, in front of the slab's edge, up to the finished floor above (under the
  // antresola nosing when there is one)
  if (last && config.riserBoards) {
    const t = thick(last);
    // (behind the last tread: from its underside; up into the antresola nosing's groove when there is one)
    const topZ = exitNosing.length ? floorAbove - config.treadThicknessMm + overlap : floorAbove;
    const bottomZ = carpet ? last.topZ + t : last.topZ;
    last.edges
      .filter((edge) => edge.role === 'back')
      .forEach((edge, k) => {
        const n = outward(edge);
        risers.push({
          id: k ? `riser-top-${k}` : 'riser-top',
          index: els.length,
          outline: [edge.a, edge.b, add(edge.b, n, -r), add(edge.a, n, -r)],
          bottomZ,
          topZ,
          heightMm: topZ - bottomZ,
          mount: config.riserMount,
          overlapMm: exitNosing.length ? overlap : 0,
          tongues: carpet ? 2 : 0,
          lengthMm: Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y),
          thicknessMm: r,
          grain: unit(edge.a, edge.b),
        });
      });
  }
  // the grooves the risers go into (behind the tread): in the tread above's underside — the riser's own footprint,
  // `overlap` deep (the DXF draws it; the nosing in front keeps its full thickness)
  if (overlap > 0) {
    for (const rz of risers) {
      const host = rz.id.startsWith('riser-top') ? exitNosing[0] : treads.find((t) => t.index === rz.index);
      if (host && rz.topZ > rz.bottomZ) (host.grooves ||= []).push({ depthMm: overlap, strip: rz.outline });
    }
  }
  const heights = finishedHeights(concrete, config);
  return { treads, risers, exitNosing, starterBlocks, heights, diagnostics: [...heightDiagnostics(heights, config), ...zoneDiagnostics(concrete), ...winderDiagnostics(concrete, config)] };
}

function floorboardParts(e, outline, config) {
  // the nosing piece: from the front of the tread outline to `landingNosingDepthMm` past the concrete's front line
  const front = e.edges.find((x) => x.role === 'front');
  if (!front) return null;
  const n = outward(front);
  const t = unit(front.a, front.b);
  const FAR = 1e5;
  const cut = add(front.a, n, -config.landingNosingDepthMm);
  const half = (sign) => [add(add(cut, t, -FAR), n, 0), add(add(cut, t, FAR), n, 0), add(add(cut, t, FAR), n, sign * FAR), add(add(cut, t, -FAR), n, sign * FAR)];
  const total = config.osbThicknessMm + config.floorboardThicknessMm;
  const top = e.topZ + total;
  const nosing = clipToConvex(outline, half(1));
  const floor = clipToConvex(outline, half(-1));
  return {
    nosing: nosing.length >= 3 ? { outline: nosing, bottomZ: e.topZ, topZ: top } : null,
    osb: floor.length >= 3 ? { outline: floor, bottomZ: e.topZ, topZ: e.topZ + config.osbThicknessMm } : null,
    boards: floor.length >= 3 ? { outline: floor, bottomZ: e.topZ + config.osbThicknessMm, topZ: top } : null,
  };
}

// winders (user request 2026-11-04): PL-LEGAL-C-01 — at least `winderLegalMinGoingMm` deep `winderLegalOffsetMm` from
// the dusza (§ 69 ust. 5); CO-MFG-J-04 — the dusza end not narrower than `winderMinDuszaMm`; the going on the walkline
// like the straight steps' (within `winderGoingToleranceMm`). WARNINGs: the concrete is already there — the findings
// tell the installer what to expect, nothing is changed.
function winderDiagnostics(concrete, config) {
  const out = [];
  const straight = concrete.elements.filter((e) => e.kind === 'step').map((e) => e.goingMm);
  const ref = straight.length ? median(straight) : null;
  for (const z of concrete.zones || []) {
    const winders = concrete.elements.filter((e) => e.kind === 'winder' && e.zone === concrete.zones.indexOf(z));
    winders.forEach((w, k) => {
      const legal = z.legalGoingsMm[k];
      const label = `Zabieg ${w.index + 1}`;
      if (legal !== null && legal < config.winderLegalMinGoingMm - 0.5) {
        out.push(createDiagnostic({ ruleId: 'PL-LEGAL-C-01', severity: 'WARNING', elementType: 'tread', elementId: `winder-${w.index}`, parameter: 'goingMm', value: Math.round(legal), expected: `>= ${config.winderLegalMinGoingMm}`, unit: 'mm', message: `${label}: ${Math.round(z.legalOffsetMm)} mm od duszy ma tylko ${Math.round(legal)} mm głębokości — przepis wymaga min. ${config.winderLegalMinGoingMm} mm (WT § 69 ust. 5).` }));
      }
      const dusza = z.duszaWidthsMm[k];
      if (dusza < config.winderMinDuszaMm - 0.5) {
        out.push(createDiagnostic({ ruleId: 'CO-MFG-J-04', severity: 'WARNING', elementType: 'tread', elementId: `winder-${w.index}`, parameter: 'duszaWidthMm', value: Math.round(dusza), expected: `>= ${config.winderMinDuszaMm}`, unit: 'mm', message: `${label}: przy duszy tylko ${Math.round(dusza)} mm szerokości (min. ${config.winderMinDuszaMm} mm) — wąski koniec stopnia jest słaby i trudny do wykonania.` }));
      }
      const walk = z.walkGoingsMm[k];
      if (ref !== null && walk !== null && Math.abs(walk - ref) > config.winderGoingToleranceMm + 0.5) {
        out.push(createDiagnostic({ ruleId: 'CLAD-WINDER-GOING', severity: 'WARNING', elementType: 'tread', elementId: `winder-${w.index}`, parameter: 'goingMm', value: Math.round(walk), expected: `${Math.round(ref)} ± ${config.winderGoingToleranceMm}`, unit: 'mm', message: `${label}: na linii biegu ${Math.round(walk)} mm głębokości — inaczej niż stopnie proste (${Math.round(ref)} mm, różnica ${Math.round(walk - ref)} mm). Krok na zabiegu będzie nierówny.` }));
      }
    });
  }
  return out;
}

// a winder zone whose edges are out of order (crossing, or a wall end not further on than the previous one) cannot
// be laid — an ERROR naming the zone
function zoneDiagnostics(concrete) {
  return (concrete.zones || [])
    .filter((z) => !z.orderOk)
    .map((z) =>
      createDiagnostic({
        ruleId: 'CLAD-WINDER-ORDER',
        severity: 'ERROR',
        elementType: 'tread',
        elementId: `zone-${z.groupIndex}`,
        parameter: 'edges',
        message: `Zabiegi (grupa ${z.groupIndex + 1}): krawędzie są w złej kolejności — każda kolejna musi leżeć dalej od początku zabiegu i na ścianie, i przy duszy (krawędzie się krzyżują). Popraw pomiar.`,
      })
    );
}

/** The finished rise of every step (floor → first tread … last tread → floor above) and its concrete one. */
export function finishedHeights(concrete, config) {
  const th = (e) => finishThicknessMm(e, config);
  const els = concrete.elements;
  const rows = els.map((e, i) => {
    const below = i === 0 ? config.floorFinishBottomMm : els[i - 1].topZ + th(els[i - 1]);
    return { index: e.index, kind: e.kind, label: `${e.kind === 'landing' ? 'Podest' : e.kind === 'winder' ? 'Zabieg' : 'Stopień'} ${e.index + 1}`, concreteRiseMm: e.riseMm, finishedRiseMm: e.topZ + th(e) - below, goingMm: e.kind === 'step' ? e.goingMm : e.kind === 'winder' ? e.walkGoingMm : null, finishedTopZ: e.topZ + th(e) };
  });
  if (els.length) {
    const lastTop = els.at(-1).topZ + th(els.at(-1));
    const floor = concrete.exit.rawSlabTopZ + config.floorFinishTopMm;
    rows.push({ index: els.length, kind: 'exit', label: 'Wyjście (strop)', concreteRiseMm: concrete.exit.riseMm, finishedRiseMm: floor - lastTop, goingMm: null, finishedTopZ: floor });
  }
  return rows;
}

function heightDiagnostics(rows, config) {
  if (rows.length < 2) return [];
  const m = median(rows.map((r) => r.finishedRiseMm));
  const off = rows.filter((r) => Math.abs(r.finishedRiseMm - m) > config.riseToleranceMm + 1e-9);
  return off.map((r) =>
    createDiagnostic({
      ruleId: 'CLAD-RISE-UNEVEN',
      severity: 'WARNING',
      elementType: 'tread',
      elementId: r.kind === 'exit' ? 'exit' : `${r.kind}-${r.index}`,
      parameter: 'riseMm',
      value: Math.round(r.finishedRiseMm),
      expected: `${Math.round(m)} ± ${config.riseToleranceMm}`,
      unit: 'mm',
      message: `${r.label}: po wykończeniu ${Math.round(r.finishedRiseMm)} mm wysokości — inaczej niż reszta (${Math.round(m)} mm, różnica ${Math.round(r.finishedRiseMm - m)} mm). Wyrównaj beton albo grubość okładziny / posadzki.`,
    })
  );
}
