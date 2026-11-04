// The module "Schody na beton" in plan: the concrete (grey, dashed), the cladding treads with their nosings, the
// riser boards, the step numbers and the walking line. Pure SVG from the built model + a viewport ({x, y, width,
// height} in SVG user units = mm, plan y flipped).

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

export function renderCladdingPlanSVG(built, { viewport, selectedIndex = null } = {}) {
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
  const riserXML = cladding.risers.map((r) => `<polygon class="clad-riser" points="${pts(r.outline)}" fill="#bfa77a" stroke="#6d4b2a" stroke-width="0.8" pointer-events="none" ${HAIR}/>`).join('');
  const labels = concrete.elements
    .map((e) => {
      const c = centre(e.outline);
      const text = e.kind === 'landing' ? `P${e.index + 1}` : String(e.index + 1);
      return `<text x="${fmt(c.x)}" y="${fmt(-c.y)}" font-size="90" text-anchor="middle" dominant-baseline="middle" fill="#3b2a1a" pointer-events="none">${escapeHtml(text)}</text>`;
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
  return `<svg xmlns="http://www.w3.org/2000/svg" class="clad-plan-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">${concreteXML}${riserXML}${treadXML}${walkXML}${labels}</svg>`;
}
