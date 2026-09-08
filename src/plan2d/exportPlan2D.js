import { downloadTextFile } from '../export/downloadTextFile.js';

export function exportPlan2DSVG(svgText, filename = 'schody_plan_2d.svg') {
  downloadTextFile(svgText, filename, 'image/svg+xml');
}
