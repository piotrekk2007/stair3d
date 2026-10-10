// The "Profil poręczy" side view as an SVG string — pure (no DOM): it draws the view model of ONE handrail run
// (geometry/railingProfileView.js) and decides nothing. SVG x = u (mm along the run), SVG y = −v (elevation up).
// Strokes are non-scaling; handles and labels are sized in screen pixels through `mmPerPx`.

const HAIR = 'vector-effect="non-scaling-stroke"';
const HANDLE_PX = 9;
const VIEW_SIDE_MARGIN_MM = 120;
const RULER_STEPS_MM = [50, 100, 200, 250, 500, 1000];

const fmt = (n) => Math.round(n * 100) / 100;
const pts = (line) => line.map((p) => `${fmt(p.u)},${fmt(-p.v)}`).join(' ');

/** The SVG viewBox showing the whole run. */
export function railingViewBox(view) {
  const b = view.bounds;
  return { x: b.uMin - VIEW_SIDE_MARGIN_MM, y: -b.vMax, width: b.uMax - b.uMin + 2 * VIEW_SIDE_MARGIN_MM, height: b.vMax - b.vMin };
}

function rulerStep(lengthMm) {
  return RULER_STEPS_MM.find((s) => lengthMm / s <= 12) ?? RULER_STEPS_MM[RULER_STEPS_MM.length - 1];
}

/**
 * @param {Object} view  buildRailingProfileView()
 * @param {{selectedId?: string|null, mmPerPx?: number, viewBox?: {x,y,width,height}}} [options]  `viewBox`: draw in
 *   this frame instead of the run's own (the editor keeps the frame still while a handle is dragged)
 */
export function renderRailingProfileSVG(view, { selectedId = null, mmPerPx = 2, viewBox = null } = {}) {
  const vb = viewBox || railingViewBox(view);
  const px = (n) => fmt(n * mmPerPx);
  const posts = view.posts
    .map((p) => {
      const v0 = Math.max(p.v0, -(vb.y + vb.height));
      return `<rect class="re-post" x="${fmt(p.u0)}" y="${fmt(-p.v1)}" width="${fmt(p.u1 - p.u0)}" height="${fmt(p.v1 - v0)}" fill="#8a6a45" stroke="#5a3d24" stroke-width="1" ${HAIR}/>
        <text x="${fmt((p.u0 + p.u1) / 2)}" y="${fmt(-p.v1 - px(6))}" font-size="${px(10)}" text-anchor="middle" fill="#5a3d24">${p.postId}</text>`;
    })
    .join('');
  const nosing = `<polyline class="re-nosing" points="${pts(view.nosing)}" fill="none" stroke="#7d8a96" stroke-width="1" stroke-dasharray="5,4" ${HAIR}/>
    ${view.nosing.map((p) => `<circle cx="${fmt(p.u)}" cy="${fmt(-p.v)}" r="${px(2)}" fill="#7d8a96"/>`).join('')}`;
  const balusters = view.balusters.map((q) => `<line class="re-baluster" x1="${fmt(q.u)}" y1="${fmt(-q.v0)}" x2="${fmt(q.u)}" y2="${fmt(-q.v1)}" stroke="#3d4852" stroke-width="2" ${HAIR}/>`).join('');
  const band = `<polygon class="re-rail" points="${pts([...view.railTop, ...[...view.railBottom].reverse()])}" fill="#d9b88a" stroke="#5a3d24" stroke-width="1.2" ${HAIR}/>`;
  const auto = view.edited ? `<polyline class="re-auto" points="${pts(view.autoTop)}" fill="none" stroke="#1a5fb4" stroke-width="1" stroke-dasharray="7,4" ${HAIR}/>` : '';
  const h = (HANDLE_PX / 2) * mmPerPx;
  const controls = view.controls
    .map((c) => {
      const cls = `re-cp${c.kind === 'end' ? ' re-cp-end' : ''}${c.edited ? ' edited' : ''}${c.id === selectedId ? ' selected' : ''}`;
      const fill = c.id === selectedId ? '#1a5fb4' : c.edited ? '#e08214' : '#fff';
      const stroke = c.edited ? '#e08214' : '#1a5fb4';
      const title = c.kind === 'end' ? 'Koniec poręczy na licu słupa — przeciągnij w górę/w dół' : 'Punkt poręczy — przeciągnij w górę/w dół; prawy klik: usuń';
      return c.kind === 'end'
        ? `<rect class="${cls}" data-point-id="${c.id}" x="${fmt(c.u - h)}" y="${fmt(-c.v - h)}" width="${fmt(2 * h)}" height="${fmt(2 * h)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${HAIR}><title>${title}</title></rect>`
        : `<circle class="${cls}" data-point-id="${c.id}" cx="${fmt(c.u)}" cy="${fmt(-c.v)}" r="${fmt(h)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${HAIR}><title>${title}</title></circle>`;
    })
    .join('');
  // a ruler along the run, under the nosing line
  const step = rulerStep(view.lengthMm);
  const rulerY = vb.y + vb.height - px(18);
  let ruler = `<line x1="0" y1="${fmt(rulerY)}" x2="${fmt(view.lengthMm)}" y2="${fmt(rulerY)}" stroke="#9aa4ae" stroke-width="1" ${HAIR}/>`;
  for (let u = 0; u <= view.lengthMm + 1e-6; u += step) {
    ruler += `<line x1="${fmt(u)}" y1="${fmt(rulerY - px(4))}" x2="${fmt(u)}" y2="${fmt(rulerY + px(4))}" stroke="#9aa4ae" stroke-width="1" ${HAIR}/><text x="${fmt(u)}" y="${fmt(rulerY + px(15))}" font-size="${px(10)}" text-anchor="middle" fill="#6b7684">${Math.round(u)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="re-svg" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.width)} ${fmt(vb.height)}" preserveAspectRatio="xMidYMid meet">
    <rect x="${fmt(vb.x)}" y="${fmt(vb.y)}" width="${fmt(vb.width)}" height="${fmt(vb.height)}" fill="#fff"/>
    ${ruler}
    ${posts}
    ${nosing}
    ${balusters}
    ${band}
    ${auto}
    ${controls}
  </svg>`;
}
