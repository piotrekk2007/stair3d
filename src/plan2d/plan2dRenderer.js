// Rzut 2D z góry (SVG), budowany bezpośrednio z planLayout — niezależny od widoku 3D.
// Współrzędne SVG = współrzędne planu (mm) wprost, z paddingiem i odwróconym Y (SVG rośnie w dół,
// co dla rzutu "od wejścia w górę ekranu" jest wygodniejsze niż matematyczny układ).

import { computeWinderBlank } from '../geometry/winderBlank.js';

const PAD = 600; // mm, margines wokół rzutu
const DIM_OFFSET = 350; // mm, odsunięcie linii wymiarowych od rzutu

function fmt(n) {
  return Math.round(n);
}

function polygonPoints(outline) {
  return outline.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
}

function dimensionLine(x1, y1, x2, y2, label, strokeWidth) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return `
    <g class="dim">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1a5fb4" stroke-width="${strokeWidth}"/>
      <line x1="${x1}" y1="${y1 - 40}" x2="${x1}" y2="${y1 + 40}" stroke="#1a5fb4" stroke-width="${strokeWidth}"/>
      <line x1="${x2}" y1="${y2 - 40}" x2="${x2}" y2="${y2 + 40}" stroke="#1a5fb4" stroke-width="${strokeWidth}"/>
      <text x="${midX}" y="${midY}" font-size="130" fill="#1a5fb4" text-anchor="middle"
            transform="rotate(${angle} ${midX} ${midY})" dy="-20">${label}</text>
    </g>`;
}

export function renderPlan2DSVG(planLayout, config, derived, showWinderBlanks = true) {
  const b = planLayout.bounds;
  const minX = b.minX - PAD - DIM_OFFSET * 2;
  const maxX = b.maxX + PAD + DIM_OFFSET * 2;
  const minY = -b.maxY - PAD - DIM_OFFSET * 2;
  const maxY = -b.minY + PAD + DIM_OFFSET * 2;
  const width = maxX - minX;
  const height = maxY - minY;

  const treadsXML = planLayout.treads
    .map((t) => {
      const isLanding = t.type === 'landing';
      const fill = isLanding ? '#e8d9b5' : t.type === 'winder' ? '#f0e6c8' : '#f5efdc';
      const cx = t.outline.reduce((s, p) => s + p.x, 0) / t.outline.length;
      const cy = t.outline.reduce((s, p) => s - p.y, 0) / t.outline.length;
      return `
      <polygon points="${polygonPoints(t.outline)}" fill="${fill}" stroke="#333" stroke-width="12"/>
      <text x="${fmt(cx)}" y="${fmt(cy)}" font-size="110" fill="#333" text-anchor="middle" dy="35">${t.index + 1}</text>`;
    })
    .join('');

  const winderBlanksXML = !showWinderBlanks
    ? ''
    : planLayout.treads
        .filter((t) => t.type === 'winder')
        .map((t) => {
          const blank = computeWinderBlank(t);
          const cx = blank.corners.reduce((s, p) => s + p.x, 0) / 4;
          const cy = blank.corners.reduce((s, p) => s - p.y, 0) / 4;
          return `
      <polygon points="${polygonPoints(blank.corners)}" fill="none" stroke="#8f3fd1" stroke-width="14" stroke-dasharray="40,25"/>
      <text x="${fmt(cx)}" y="${fmt(cy)}" font-size="90" fill="#8f3fd1" text-anchor="middle" dy="-70">${fmt(blank.length)} × ${fmt(blank.depth)} mm</text>`;
        })
        .join('');

  const outerXML = `<polyline points="${polygonPoints(planLayout.outerFullPath)}" fill="none" stroke="#8a5a34" stroke-width="30"/>`;
  const innerXML = `<polyline points="${polygonPoints(planLayout.innerFullPath)}" fill="none" stroke="#8a5a34" stroke-width="30"/>`;

  const postsXML = planLayout.turns
    .map((t) => {
      const s = config.postSize;
      const x = t.innerCorner.x - s / 2;
      const y = -t.innerCorner.y - s / 2;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(s)}" height="${fmt(s)}" fill="#5a3d24"/>`;
    })
    .join('');

  const startPost = planLayout.innerFullPath[0];
  const endPost = planLayout.innerFullPath[planLayout.innerFullPath.length - 1];
  const startEndPostsXML = [startPost, endPost]
    .map((p) => {
      const s = config.postSize;
      return `<rect x="${fmt(p.x - s / 2)}" y="${fmt(-p.y - s / 2)}" width="${fmt(s)}" height="${fmt(s)}" fill="#5a3d24"/>`;
    })
    .join('');

  const footprintX = b.maxX - b.minX;
  const footprintY = b.maxY - b.minY;
  const dimTop = dimensionLine(fmt(b.minX), fmt(-b.maxY) - DIM_OFFSET, fmt(b.maxX), fmt(-b.maxY) - DIM_OFFSET, `${fmt(footprintX)} mm`, 12);
  const dimSide = dimensionLine(fmt(b.minX) - DIM_OFFSET, fmt(-b.maxY), fmt(b.minX) - DIM_OFFSET, fmt(-b.minY), `${fmt(footprintY)} mm`, 12);

  const arrowStart = planLayout.innerFullPath[0];
  const arrowXML = `
    <g stroke="#c0392b" stroke-width="20" fill="#c0392b">
      <line x1="${fmt(arrowStart.x + config.stairWidth / 2)}" y1="${fmt(-arrowStart.y + 200)}"
            x2="${fmt(arrowStart.x + config.stairWidth / 2)}" y2="${fmt(-arrowStart.y - 400)}"/>
      <polygon points="${fmt(arrowStart.x + config.stairWidth / 2 - 60)},${fmt(-arrowStart.y - 300)}
                        ${fmt(arrowStart.x + config.stairWidth / 2 + 60)},${fmt(-arrowStart.y - 300)}
                        ${fmt(arrowStart.x + config.stairWidth / 2)},${fmt(-arrowStart.y - 460)}"/>
    </g>`;

  const legendXML = `
    <g font-size="110" fill="#222">
      <text x="${fmt(minX + 100)}" y="${fmt(minY + 150)}">Stopni: ${derived.numTreads} | głębokość ${config.treadGoing}mm | podstopień ${derived.riserHeight.toFixed(0)}mm | szer. biegu ${config.stairWidth}mm</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}" width="100%" height="100%">
    <rect x="${fmt(minX)}" y="${fmt(minY)}" width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff"/>
    ${treadsXML}
    ${winderBlanksXML}
    ${outerXML}
    ${innerXML}
    ${postsXML}
    ${startEndPostsXML}
    ${arrowXML}
    ${dimTop}
    ${dimSide}
    ${legendXML}
  </svg>`;
}
