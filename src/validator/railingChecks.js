// Validation of the balustrade — pure functions over an already-solved RailingModel + config, returning
// Diagnostics (src/diagnostics/diagnostic.js). Nothing here computes geometry or touches Three.js; the
// measurements are read straight off the model the 3D view draws.
//
// The rule numbers come from the rules catalogue (src/rules/sets/), never from this file:
//  * PL-LEGAL-H-01 (Warunki techniczne § 298): balustrade height >= 1.1 m and a clear opening in the filling
//    <= 0.2 m (in general) / <= 0.12 m (multi-family, collective, education, health care).
//    The catalogue marks the rule severity ERROR / blocksGeneration, but the app models a HANDRAIL measured
//    from the nosing line (default 900 mm), which is a different quantity from the height of a balustrade at
//    a free edge — so a shortfall here is a WARNING ("check it for this building"), never a blocking error.
//  * BWF-GUID-B-02 (BWF Timber Stair Design Guide, reference only): handrail >= 68 x 45 mm, baluster >= 27 mm
//    square / 35 mm turned, newel >= 82 x 82 mm — INFO.

import { createDiagnostic } from '../diagnostics/diagnostic.js';

export const PL_BALUSTRADE_MIN_HEIGHT_MM = 1100;
export const PL_CLEAR_OPENING_GENERAL_MM = 200;
export const PL_CLEAR_OPENING_STRICT_MM = 120;
const STRICT_BUILDING_TYPES = ['multi_family', 'public', 'healthcare', 'preschool'];
const BWF_MIN_HANDRAIL = { width: 68, height: 45 };
const BWF_MIN_BALUSTER = { square: 27, round: 35 };
const BWF_MIN_NEWEL_MM = 82;
const ON_PATH_TOLERANCE_MM = 1;

/** The legal clear-opening limit for this project's building type. */
export function legalClearOpeningMm(config) {
  return STRICT_BUILDING_TYPES.includes(config.buildingType) ? PL_CLEAR_OPENING_STRICT_MM : PL_CLEAR_OPENING_GENERAL_MM;
}

function distanceToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

// The widest clear opening along one handrail run: between neighbouring balusters and between the end
// balusters and the posts (post half-widths from `postHalf`, balusters by their own width).
function widestOpening(run, section, config, postHalf) {
  const pts = [run.pieces[0].start, ...run.pieces.map((p) => p.end)];
  const arc = (p) => {
    // plan distance from the run start along the polyline
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      if (Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) < ON_PATH_TOLERANCE_MM) return s + Math.sqrt(len2) * t;
      s += Math.sqrt(len2);
    }
    return null;
  };
  const total = pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  const onRun = section.balusters
    .filter((b) => distanceToPolyline(b.position, pts) < ON_PATH_TOLERANCE_MM)
    .map((b) => arc(b.position))
    .filter((s) => s !== null)
    .sort((a, b) => a - b);
  const half = config.railingBalusterSizeMm / 2;
  const edges = [postHalf.start, ...onRun.flatMap((s) => [s - half, s + half]), total - postHalf.end];
  let widest = 0;
  for (let i = 0; i + 1 < edges.length; i += 2) widest = Math.max(widest, edges[i + 1] - edges[i]);
  return widest;
}

/**
 * @param {import('../geometry/railingSolver.js').RailingModel} railingModel
 * @param {Object} config  full config
 * @param {{position:{x:number,y:number}, size:number}[]} [postModels]  every existing post (sizes for reused posts)
 * @returns {import('../diagnostics/diagnostic.js').Diagnostic[]}
 */
export function evaluateRailingChecks(railingModel, config, postModels = []) {
  if (!railingModel?.enabled) return [];
  const diagnostics = [];
  const validSections = railingModel.sections.filter((s) => s.valid);
  if (validSections.length === 0) return diagnostics;

  const legalOpening = legalClearOpeningMm(config);
  const anySection = validSections[0].id;

  if (config.railingHeightMm < PL_BALUSTRADE_MIN_HEIGHT_MM) {
    diagnostics.push(
      createDiagnostic({
        ruleId: 'PL-LEGAL-H-01',
        severity: 'WARNING',
        elementType: 'railing',
        elementId: anySection,
        parameter: 'railingHeightMm',
        value: config.railingHeightMm,
        expected: `>= ${PL_BALUSTRADE_MIN_HEIGHT_MM}`,
        unit: 'mm',
        message: `Poręcz jest ${config.railingHeightMm} mm nad linią nosków — reguła katalogu wymaga wysokości balustrady >= ${PL_BALUSTRADE_MIN_HEIGHT_MM} mm (Warunki techniczne § 298; dotyczy zwłaszcza wolnej krawędzi, np. podestu). Sprawdź wymaganie dla tego budynku.`,
      })
    );
  }
  if (config.railingMaxClearMm > legalOpening) {
    diagnostics.push(
      createDiagnostic({
        ruleId: 'PL-LEGAL-H-01',
        severity: 'WARNING',
        elementType: 'railing',
        elementId: anySection,
        parameter: 'railingMaxClearMm',
        value: config.railingMaxClearMm,
        expected: `<= ${legalOpening}`,
        unit: 'mm',
        message: `Ustawiony maksymalny prześwit między tralkami (${config.railingMaxClearMm} mm) jest większy niż ${legalOpening} mm dopuszczone w tym typie budynku (§ 298).`,
      })
    );
  }

  const sizeOf = (id, position) => {
    const railingPost = railingModel.posts.find((p) => p.postId === id);
    if (railingPost) return railingPost.removed ? 0 : railingPost.size;
    const existing = postModels.find((p) => Math.hypot(p.position.x - position.x, p.position.y - position.y) < config.postSize);
    return existing ? existing.size : config.postSize;
  };
  for (const section of validSections) {
    let widest = 0;
    section.runs.forEach((run) => {
      const first = run.pieces[0].start;
      const last = run.pieces[run.pieces.length - 1].end;
      const postHalf = { start: sizeOf(run.startPostId, first) / 2, end: sizeOf(run.endPostId, last) / 2 };
      widest = Math.max(widest, widestOpening(run, section, config, postHalf));
    });
    if (widest > legalOpening + 1e-6) {
      diagnostics.push(
        createDiagnostic({
          ruleId: 'PL-LEGAL-H-01',
          severity: 'WARNING',
          elementType: 'railing',
          elementId: section.id,
          parameter: 'clearOpening',
          value: Math.round(widest),
          expected: `<= ${legalOpening}`,
          unit: 'mm',
          message: `Balustrada ${section.id}: największy prześwit w wypełnieniu ma ${Math.round(widest)} mm — więcej niż ${legalOpening} mm (§ 298). Dodaj tralkę albo zmniejsz maksymalny prześwit.`,
        })
      );
    }
  }

  // BWF reference minimums (INFO)
  const belowHandrail = config.railingHandrailShape === 'round' ? Math.min(config.railingHandrailWidthMm, config.railingHandrailHeightMm) < BWF_MIN_HANDRAIL.height : config.railingHandrailWidthMm < BWF_MIN_HANDRAIL.width || config.railingHandrailHeightMm < BWF_MIN_HANDRAIL.height;
  if (belowHandrail) {
    diagnostics.push(
      createDiagnostic({ ruleId: 'BWF-GUID-B-02', severity: 'INFO', elementType: 'railing', elementId: anySection, parameter: 'handrailSection', message: `Przekrój poręczy jest mniejszy niż ${BWF_MIN_HANDRAIL.width} × ${BWF_MIN_HANDRAIL.height} mm z wytycznych BWF (tylko orientacyjnie).` })
    );
  }
  if (config.railingBalusterSizeMm < BWF_MIN_BALUSTER[config.railingBalusterShape === 'round' ? 'round' : 'square']) {
    diagnostics.push(
      createDiagnostic({ ruleId: 'BWF-GUID-B-02', severity: 'INFO', elementType: 'railing', elementId: anySection, parameter: 'balusterSize', message: `Tralka jest cieńsza niż ${config.railingBalusterShape === 'round' ? BWF_MIN_BALUSTER.round : BWF_MIN_BALUSTER.square} mm z wytycznych BWF (tylko orientacyjnie).` })
    );
  }
  if (railingModel.posts.some((p) => !p.removed && p.size < BWF_MIN_NEWEL_MM)) {
    diagnostics.push(
      createDiagnostic({ ruleId: 'BWF-GUID-B-02', severity: 'INFO', elementType: 'railing', elementId: anySection, parameter: 'newelSize', message: `Słupek balustrady jest mniejszy niż ${BWF_MIN_NEWEL_MM} × ${BWF_MIN_NEWEL_MM} mm z wytycznych BWF (tylko orientacyjnie).` })
    );
  }
  return diagnostics;
}
