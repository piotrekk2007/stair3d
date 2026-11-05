// The module "Schody na beton" in plan: the concrete (grey, dashed), the cladding treads with their nosings, the
// riser boards, the step numbers and the walking line. Pure SVG from the built model + a viewport ({x, y, width,
// height} in SVG user units = mm, plan y flipped).

import { planMeasureText } from '../plan2d/planMeasure.js';
import { boardPolygons } from './finishModel.js';
import { wallCells, wallEnds, wallListOf } from './wallEdits.js';
import { trimEdges } from './openingTrimModel.js';
import { wallOn } from './surroundingsModel.js';
import { WALL_TYPE_LABELS } from './schema.js';
import { escapeHtml } from '../util/format.js';

const HAIR = 'vector-effect="non-scaling-stroke"';
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const pts = (outline) => outline.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
const centre = (outline) => ({ x: outline.reduce((s, p) => s + p.x, 0) / outline.length, y: outline.reduce((s, p) => s + p.y, 0) / outline.length });

/** The plan's extent in SVG user space (y flipped). */
export function claddingPlanBounds(built) {
  const b = built.concrete.bounds;
  return { minX: b.minX, maxX: b.maxX, minY: -b.maxY, maxY: -b.minY };
}

// `mode` (the plan's edit mode — claddingApp.js): 'posts' shows every balustrade line and its posts to click (add /
// remove), 'opening' the opening's vertices / edge middles to drag / click and its edges to switch the antresola on / off
export function renderCladdingPlanSVG(built, { viewport, selectedIndex = null, otherFloor = null, clientView = false, mode = 'select', measures = [], measureDraft = null, mmPerPx = null } = {}) {
  const { concrete, cladding } = built;
  const vb = viewport ? `${fmt(viewport.x)} ${fmt(viewport.y)} ${fmt(viewport.width)} ${fmt(viewport.height)}` : (() => {
    const b = claddingPlanBounds(built);
    return `${b.minX - 300} ${b.minY - 300} ${b.maxX - b.minX + 600} ${b.maxY - b.minY + 600}`;
  })();
  const concreteXML = concrete.elements
    .map((e) => `<polygon class="clad-concrete" data-index="${e.index}" points="${pts(e.outline)}" fill="#d6d3cd" stroke="#8d8a84" stroke-width="1" stroke-dasharray="6,4" ${HAIR}/>`)
    .join('');
  const treadXML = cladding.treads
    .map((t) => {
      const sel = t.index === selectedIndex;
      return `<polygon class="clad-tread${sel ? ' selected' : ''}" data-index="${t.index}" points="${pts(t.outline)}" fill="${sel ? '#f3c97a' : '#e6c99a'}" fill-opacity="0.85" stroke="${sel ? '#1f6feb' : '#8a5a34'}" stroke-width="${sel ? 2.5 : 1.2}" ${HAIR}/>`;
    })
    .join('');
  // stage 3: the walls (dark), the ceiling opening (dashed blue), the antresola nosing, a floor-board landing's parts
  const wallsXML = (built.walls || []).map((w) => `<polygon class="clad-wall" points="${pts(w.outline)}" fill="#6f6a62" stroke="#4d4943" stroke-width="0.8" pointer-events="none" ${HAIR}/>`).join('');
  let openingXML = built.slab ? `<polygon class="clad-opening" points="${pts(built.slab.opening)}" fill="none" stroke="#1f6feb" stroke-width="1.5" stroke-dasharray="8,5" pointer-events="none" ${HAIR}/>` : '';
  // the opening editor: every edge clickable (the antresola on / off — green on, grey off), its vertices to drag, a
  // middle handle to add a vertex
  if (mode === 'opening' && built.slab?.opening?.length) {
    const o = built.slab.opening;
    const hr = Math.max(18, (viewport?.width ?? 4000) / 160);
    const off = built.config.railingAntresolaEdges || {};
    const edges = o.map((a, k) => {
      const b = o[(k + 1) % o.length];
      const on = off[k] !== false;
      return `<line class="clad-opening-edge" data-edge="${k}" x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="${on ? '#2e7d32' : '#9aa0a6'}" stroke-width="10" stroke-opacity="0.6" ${HAIR}><title>Balustrada antresoli na tej krawędzi: ${on ? 'tak' : 'nie'} — kliknij, żeby zmienić</title></line>`;
    }).join('');
    const vertices = o.map((p, k) => `<circle class="clad-opening-vertex" data-vertex="${k}" cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="${fmt(hr)}" fill="#fff" stroke="#1f6feb" stroke-width="2" ${HAIR}><title>Przeciągnij narożnik (prawy klik — usuń)</title></circle>`).join('');
    const mids = o.map((a, k) => {
      const b = o[(k + 1) % o.length];
      return `<rect class="clad-opening-mid" data-mid="${k}" x="${fmt((a.x + b.x) / 2 - hr * 0.6)}" y="${fmt(-(a.y + b.y) / 2 - hr * 0.6)}" width="${fmt(hr * 1.2)}" height="${fmt(hr * 1.2)}" fill="#1f6feb" ${HAIR}><title>Kliknij, żeby dodać narożnik</title></rect>`;
    }).join('');
    openingXML += edges + mids + vertices;
  }
  // the opening's trim („fajka”); in its mode („▬ Fajka”) every opening edge to click (green = trimmed, grey = not,
  // orange the stair's exit — the antresola nosing there)
  const trimXML = (built.openingTrim?.pieces || []).map((t) => `<polygon class="clad-trim" points="${pts(t.outline)}" fill="#c99d62" stroke="#8a5a34" stroke-width="1" pointer-events="none" ${HAIR}/>`).join('');
  const trimModeXML =
    mode === 'trim'
      ? trimEdges(built, built.config)
          .map((e) => `<line class="${e.exit ? '' : 'clad-trim-edge'}" data-trim-edge="${e.k}" x1="${fmt(e.a.x)}" y1="${fmt(-e.a.y)}" x2="${fmt(e.b.x)}" y2="${fmt(-e.b.y)}" stroke="${e.exit ? '#d35400' : e.on ? '#2e7d32' : '#9aa0a6'}" stroke-width="10" stroke-opacity="0.65" ${e.exit || e.on ? '' : 'stroke-dasharray="10,6"'} ${e.exit ? 'pointer-events="none"' : ''} ${HAIR}><title>${e.exit ? 'Wyjście ze schodów — tu nosek antresoli' : `Fajka na tej krawędzi: ${e.on ? 'tak' : 'nie'} — kliknij, żeby zmienić`}</title></line>`)
          .join('')
      : '';
  const exitXML = (cladding.exitNosing || []).map((n) => `<polygon class="clad-exit-nosing" points="${pts(n.outline)}" fill="#c99d62" stroke="#8a5a34" stroke-width="1" pointer-events="none" ${HAIR}/>`).join('');
  const partsXML = cladding.treads
    .filter((t) => t.parts)
    .map((t) => [t.parts.nosing, t.parts.boards].filter(Boolean).map((p, k) => `<polygon points="${pts(p.outline)}" fill="${k ? '#d9bc8c' : '#c99d62'}" stroke="#8a5a34" stroke-width="0.8" ${k ? 'stroke-dasharray="3,3"' : ''} pointer-events="none" ${HAIR}/>`).join(''))
    .join('');
  // the stair on the next floor (linked — its treads in this plan's frame, dashed purple)
  const otherXML = (otherFloor?.treads || []).map((t) => `<polygon class="clad-other-floor" points="${pts(t.outline)}" fill="#7b4ab3" fill-opacity="0.06" stroke="#7b4ab3" stroke-width="1" stroke-dasharray="6,4" pointer-events="none" ${HAIR}/>`).join('');
  // stage 5: the finishing boards (a thick line on their side), the balustrade (handrail, balusters, posts)
  const boardLine = (b, colour) => {
    const all = boardPolygons(b).flat();
    const s0 = Math.min(...all.map((p) => p.s));
    const s1 = Math.max(...all.map((p) => p.s));
    const at = (s, off) => ({ x: b.origin.x + b.dir.x * s + b.normal.x * off, y: b.origin.y + b.dir.y * s + b.normal.y * off });
    const k0 = b.corners?.start?.k ?? 0;
    const k1 = b.corners?.end?.k ?? 0;
    return `<polygon class="clad-board" points="${pts([at(s0, 0), at(s1, 0), at(s1 + k1 * b.thicknessMm, b.thicknessMm), at(s0 + k0 * b.thicknessMm, b.thicknessMm)])}" fill="${colour}" stroke="#5a3d24" stroke-width="0.8" pointer-events="none" ${HAIR}/>`;
  };
  // the walls following the stair (sideWallsModel.js): their footprint — above the steps / between flights dark, under
  // the flight dashed (it is below)
  const sideWallsXML = (built.sideWalls || [])
    .map((w) => {
      const s0 = Math.min(...w.polygon.map((p) => p.s));
      const s1 = Math.max(...w.polygon.map((p) => p.s));
      const at = (s, off) => ({ x: w.origin.x + w.dir.x * s + w.normal.x * off, y: w.origin.y + w.dir.y * s + w.normal.y * off });
      const under = w.kind === 'wall-under';
      return `<polygon class="clad-side-wall" points="${pts([at(s0, 0), at(s1, 0), at(s1, w.thicknessMm), at(s0, w.thicknessMm)])}" fill="${under ? 'none' : '#6f6a62'}" stroke="#4d4943" stroke-width="${under ? 1.2 : 0.8}" ${under ? 'stroke-dasharray="6,4"' : ''} pointer-events="none" ${HAIR}/>`;
    })
    .join('');
  const finishXML = [...(built.finish?.skirting || []).map((b) => boardLine(b, '#b07a3a')), ...(built.finish?.coverStringers || []).map((b) => boardLine(b, '#8a5a34'))].join('');
  const railingXML = (built.balustrade?.sections || [])
    .map((s) => {
      const rail = `<polyline class="clad-handrail" points="${pts(s.handrail)}" fill="none" stroke="#7a4b22" stroke-width="3" pointer-events="none" ${HAIR}/>`;
      const bal = s.balusters.map((b) => `<rect x="${fmt(b.at.x - b.size / 2)}" y="${fmt(-b.at.y - b.size / 2)}" width="${fmt(b.size)}" height="${fmt(b.size)}" fill="#7a4b22" pointer-events="none"/>`).join('');
      const editing = mode === 'posts';
      const posts = s.posts.map((p) => `<rect class="clad-post" data-section="${escapeHtml(s.id)}" data-post="${escapeHtml(p.id)}" x="${fmt(p.at.x - p.size / 2)}" y="${fmt(-p.at.y - p.size / 2)}" width="${fmt(p.size)}" height="${fmt(p.size)}" fill="${p.manual ? '#b5651d' : '#5a3d24'}" stroke="#2b1a0c" stroke-width="1" ${editing ? '' : 'pointer-events="none"'} ${HAIR}><title>Słup — kliknij, żeby usunąć</title></rect>`).join('');
      // the post editor: the line to click (a post added there), removed posts as ghosts (a click restores)
      const line = editing ? `<polyline class="clad-rail-line" data-section="${escapeHtml(s.id)}" points="${pts(s.path)}" fill="none" stroke="#d35400" stroke-opacity="0.35" stroke-width="14" ${HAIR}><title>Kliknij, żeby dodać słup</title></polyline>` : '';
      const ghosts = editing ? (s.removedPosts || []).map((p) => `<rect class="clad-post-ghost" data-section="${escapeHtml(s.id)}" data-ghost="${escapeHtml(p.id)}" x="${fmt(p.at.x - 45)}" y="${fmt(-p.at.y - 45)}" width="90" height="90" fill="none" stroke="#5a3d24" stroke-width="1" stroke-dasharray="4,3" ${HAIR}><title>Usunięty słup — kliknij, żeby przywrócić</title></rect>`).join('') : '';
      const glass = (s.panes || []).map((pane) => {
        const s0 = Math.min(...pane.polygon.map((p) => p.s));
        const s1 = Math.max(...pane.polygon.map((p) => p.s));
        const at = (sv) => ({ x: pane.origin.x + pane.dir.x * sv + pane.normal.x * pane.thicknessMm / 2, y: pane.origin.y + pane.dir.y * sv + pane.normal.y * pane.thicknessMm / 2 });
        return `<line x1="${fmt(at(s0).x)}" y1="${fmt(-at(s0).y)}" x2="${fmt(at(s1).x)}" y2="${fmt(-at(s1).y)}" stroke="#3aa6a0" stroke-width="3" pointer-events="none" ${HAIR}/>`;
      }).join('');
      return line + rail + bal + glass + posts + ghosts;
    })
    .join('');
  // the wall handrails: the handrail line and a tick per bracket to the wall
  const wallRailXML = (built.balustrade?.wallRails || [])
    .map((w) => `<polyline class="clad-wall-rail" points="${pts(w.handrail)}" fill="none" stroke="#7a4b22" stroke-width="3" pointer-events="none" ${HAIR}/>` + w.brackets.map((b) => `<line x1="${fmt(b.wall.x)}" y1="${fmt(-b.wall.y)}" x2="${fmt(b.rail.x)}" y2="${fmt(-b.rail.y)}" stroke="#6b7177" stroke-width="2.5" pointer-events="none" ${HAIR}/>`).join(''))
    .join('');
  // the LED strips (ledModel.js): a warm line
  const ledXML = (built.led?.strips || []).map((s) => `<polyline class="clad-led" points="${pts(s.points)}" fill="none" stroke="#f0b400" stroke-width="2.5" pointer-events="none" ${HAIR}/>`).join('');
  const riserXML = cladding.risers.map((r) => `<polygon class="clad-riser" points="${pts(r.outline)}" fill="#bfa77a" stroke="#6d4b2a" stroke-width="0.8" pointer-events="none" ${HAIR}/>`).join('');
  const typeOf = new Map(cladding.treads.map((t) => [t.index, t.sideType]));
  const labels = concrete.elements
    .map((e) => {
      const c = centre(e.outline);
      const text = e.kind === 'landing' ? `P${e.index + 1}` : e.kind === 'winder' ? `Z${e.index + 1}` : String(e.index + 1);
      // (its type by the side nosings — L / P / CZ / PL — under the number)
      const type = typeOf.get(e.index);
      return `<text x="${fmt(c.x)}" y="${fmt(-c.y)}" font-size="90" text-anchor="middle" dominant-baseline="middle" fill="#3b2a1a" pointer-events="none">${escapeHtml(text)}</text>${type ? `<text class="clad-type-label" x="${fmt(c.x)}" y="${fmt(-c.y + 85)}" font-size="60" text-anchor="middle" dominant-baseline="middle" fill="#8a5a34" font-weight="600" pointer-events="none">${type}</text>` : ''}`;
    })
    .join('');
  // the walking line: through the middle of every element, an arrow at its end
  const walk = concrete.elements.map((e) => centre(e.outline));
  let walkXML = '';
  if (walk.length >= 2) {
    const a = walk.at(-2);
    const b = walk.at(-1);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -d.y, y: d.x };
    const head = [
      { x: b.x + d.x * 60, y: b.y + d.y * 60 },
      { x: b.x - d.x * 60 + n.x * 50, y: b.y - d.y * 60 + n.y * 50 },
      { x: b.x - d.x * 60 - n.x * 50, y: b.y - d.y * 60 - n.y * 50 },
    ];
    walkXML = `<polyline points="${pts(walk)}" fill="none" stroke="#c0392b" stroke-width="1.5" pointer-events="none" ${HAIR}/><polygon points="${pts(head)}" fill="#c0392b" pointer-events="none"/>`;
  }
  // the winder zones (stage 2): their walkline (dashed), the wall and dusza corners, a handle on both ends of every
  // edge between two winders — dragged along the wall / the dusza line (claddingApp.js); a measured end is filled
  const r = Math.max(18, (viewport?.width ?? 4000) / 160);
  // (the client's offer: no editing aids)
  const zonesXML = (clientView ? [] : concrete.zones || [])
    .map((z, zi) => {
      const walkline = `<polyline points="${pts(z.walkline)}" fill="none" stroke="#c0392b" stroke-width="1" stroke-dasharray="4,4" pointer-events="none" ${HAIR}/>`;
      const corners = [z.wallCorner, z.duszaCorner].map((c) => `<circle cx="${fmt(c.x)}" cy="${fmt(-c.y)}" r="${fmt(r * 0.45)}" fill="#555" pointer-events="none"/>`).join('');
      const handles = z.edges
        .map((e, k) => {
          if (e.boundary) return '';
          const line = `<line x1="${fmt(e.outer.x)}" y1="${fmt(-e.outer.y)}" x2="${fmt(e.inner.x)}" y2="${fmt(-e.inner.y)}" stroke="#d35400" stroke-width="1.5" pointer-events="none" ${HAIR}/>`;
          const h = (which, p, measured) =>
            `<circle class="clad-edge-handle" data-zone="${zi}" data-edge="${k}" data-end="${which}" cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="${fmt(r)}" fill="${measured ? '#d35400' : '#fff'}" stroke="#d35400" stroke-width="2" ${HAIR}><title>${which === 'outer' ? 'Koniec przy ścianie' : 'Koniec przy duszy'} — przeciągnij</title></circle>`;
          return line + h('outer', e.outer, e.measuredOuter) + h('inner', e.inner, e.measuredInner);
        })
        .join('');
      return walkline + corners + handles;
    })
    .join('');
  // the tape measure (plan mode „📏 Miarka”, claddingApp.js): a red line, its end dots and its label (planMeasureText —
  // the shared plan2d/planMeasure.js); the one being drawn dashed to the cursor
  // (screen-constant: 13 px text, 3.5 px dots — `mmPerPx` from the app, else from the viewport's width on ~1000 px)
  const px = mmPerPx || (viewport?.width ?? 4000) / 1000;
  const measureOne = (a, b, draft) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // (the one being drawn: no label until the cursor moves off its start)
    if (draft && Math.hypot(b.x - a.x, b.y - a.y) < 1) return `<circle cx="${fmt(a.x)}" cy="${fmt(-a.y)}" r="${fmt(px * 3.5)}" fill="#c0392b"/>`;
    return `<line x1="${fmt(a.x)}" y1="${fmt(-a.y)}" x2="${fmt(b.x)}" y2="${fmt(-b.y)}" stroke="#c0392b" stroke-width="2" ${draft ? 'stroke-dasharray="6,4"' : ''} ${HAIR}/>` + [a, b].map((p) => `<circle cx="${fmt(p.x)}" cy="${fmt(-p.y)}" r="${fmt(px * 3.5)}" fill="#c0392b"/>`).join('') + `<text x="${fmt(mid.x)}" y="${fmt(-mid.y - px * 6)}" font-size="${fmt(px * 13)}" text-anchor="middle" fill="#c0392b" stroke="#fff" stroke-width="${fmt(px * 3)}" paint-order="stroke" font-family="sans-serif" font-weight="600">${planMeasureText(a, b)}</text>`;
  };
  const measuresXML = measures.length || measureDraft ? `<g class="clad-measures" pointer-events="none">${measures.map((m) => measureOne(m.a, m.b, false)).join('')}${measureDraft ? measureOne(measureDraft.a, measureDraft.cursor, true) : ''}</g>` : '';
  // the wall mode („▥ Ściany”, claddingApp.js): every step's side that can carry a wall — a click = a wall there or not;
  // its colour = the wall's type, open dashed
  const WALL_COLOURS = { full: '#3e3a35', low: '#8d6e63', above: '#1f6feb', under: '#7b4ab3', gap: '#6f6a62' };
  const wallModeXML =
    mode === 'walls'
      ? wallCells(concrete)
          .map((c) => {
            const w = wallOn(c, { ...built.config, gapWalls: built.gapWalls || [] }, c.index);
            const colour = w ? WALL_COLOURS[w.type] || '#3e3a35' : '#9aa0a6';
            const title = w ? `${WALL_TYPE_LABELS[w.type] || 'ściana między biegami'} — kliknij, żeby usunąć przy tym stopniu; prawy klik = inny typ` : 'Bez ściany — kliknij, żeby dodać';
            return `<line class="clad-wall-cell" data-cell="${c.index}:${c.flight}:${c.side}" x1="${fmt(c.a.x)}" y1="${fmt(-c.a.y)}" x2="${fmt(c.b.x)}" y2="${fmt(-c.b.y)}" stroke="${colour}" stroke-width="${w ? 9 : 6}" stroke-opacity="${w ? 0.9 : 0.6}" ${w?.type === 'under' || !w ? 'stroke-dasharray="10,6"' : ''} stroke-linecap="butt" ${HAIR}><title>${escapeHtml(title)}</title></line>`;
          })
          .join('') + wallEndsXML()
      : '';
  // the user's walls' ends to drag along their side (claddingApp.js — snapped to the steps' edges / 10 mm)
  function wallEndsXML() {
    const cells = wallCells(concrete);
    const resolved = built.config && (built.wallEntries || []);
    return wallListOf(built.config)
      .map((w, k) => {
        const ends = wallEnds(w, cells, resolved.find((x) => x.id === w.id));
        return ['start', 'end']
          .filter((e) => ends[e])
          .map((e) => `<circle class="clad-wall-end" data-wall-end="${k}:${e}" cx="${fmt(ends[e].p.x)}" cy="${fmt(-ends[e].p.y)}" r="${fmt(r * 0.8)}" fill="#fff" stroke="${WALL_COLOURS[w.type] || '#3e3a35'}" stroke-width="3" ${HAIR}><title>${e === 'start' ? 'Początek' : 'Koniec'} ściany — przeciągnij wzdłuż boku (przyciąga do krawędzi stopni, co 10 mm)</title></circle>`)
          .join('');
      })
      .join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="clad-plan-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">${otherXML}${wallsXML}${sideWallsXML}${concreteXML}${riserXML}${treadXML}${partsXML}${exitXML}${trimXML}${finishXML}${railingXML}${wallRailXML}${ledXML}${openingXML}${walkXML}${labels}${zonesXML}${wallModeXML}${trimModeXML}${measuresXML}</svg>`;
}

/**
 * The points the plan's tape measure snaps to (plan2d/planMeasure.js snapMeasurePoint): the concrete's and the
 * cladding's corners, the risers, the walls, the finishing boards' ends, the opening's corners, the posts, the
 * handrails' points, the winder zones' corners. Pure.
 */
export function claddingMeasureRefs(built) {
  const out = [];
  const add = (list) => {
    for (const p of list || []) if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push(p);
  };
  for (const e of built.concrete.elements) add(e.outline);
  for (const t of built.cladding.treads) add(t.outline);
  for (const r of built.cladding.risers) add(r.outline);
  for (const n of built.cladding.exitNosing || []) add(n.outline);
  for (const w of built.walls || []) add(w.outline);
  add(built.slab?.opening);
  const planeEnds = (b) => {
    const s = boardPolygons(b).flat().map((p) => p.s);
    return [Math.min(...s), Math.max(...s)].map((v) => ({ x: b.origin.x + b.dir.x * v, y: b.origin.y + b.dir.y * v }));
  };
  for (const b of [...(built.finish?.skirting || []), ...(built.finish?.coverStringers || []), ...(built.sideWalls || [])]) add(planeEnds(b));
  for (const s of built.balustrade?.sections || []) {
    add(s.posts.map((p) => p.at));
    add(s.handrail);
  }
  for (const w of built.balustrade?.wallRails || []) add(w.handrail);
  for (const z of built.concrete.zones || []) add([z.wallCorner, z.duszaCorner]);
  return out;
}
