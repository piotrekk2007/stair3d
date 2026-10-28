// PART CODES (user decisions 2026-10-28) — pure, no DOM / Three.js.
//
// Every physical component of the project gets a short code by its type, numbered in the walking direction:
// ST-01 (tread; the same number as on the plan), PD-03 (landing), PS-01 (riser of tread 1, PS-G the top riser; a winder's
// fan riser one code per panel, PS-06a / PS-06b),
// WZ-1 / WW-1 (wanga outer / inner — an S: WL / WP, left / right), SL-1 (structural post), SB-1 (balustrade post),
// PR-1 (handrail piece), UP-1 (wall handrail brackets), PP-1 (base rail), TR-1 (balusters of one length), SZ-1 (glass
// pane), MS-1 (glass fixings), FJ-1 (opening trim piece), KS-1 (steel member). A cantilever tread's cladding boards are
// ST-01.1, ST-01.2, …
//
// The components are the takeoff's items (materialTakeoff.js — "one item per physical component") computed WITHOUT
// the validation gate, so a project with design errors still has its codes; connectors (hardware) and the housings
// (a feature of the board) get none. Read by the Inspektor and the label sheet (labelSheet.js).

import { computeMaterialTakeoff } from '../takeoff/materialTakeoff.js';
import { sideHand, wangaName } from '../util/sideNames.js';
import { describeDimensions } from '../ui/takeoffView.js';

const pad2 = (n) => String(n).padStart(2, '0');
const stepNumber = (stepId) => {
  const m = /^step-(\d+)$/.exec(stepId || '');
  return m ? Number(m[1]) + 1 : null;
};
const POST_KIND_PL = { start: 'Słup startowy', end: 'Słup końcowy', corner: 'Słup narożny', railing: 'Słupek balustrady' };
const CANTILEVER_PART_PL = { top: 'góra', front: 'front', back: 'tył', bottom: 'spód', side: 'bok' };

function stringerPrefix(side, config) {
  const hand = sideHand(side, config);
  if (hand) return hand === 'left' ? 'WL' : 'WP';
  return side === 'outer' ? 'WZ' : 'WW';
}

/**
 * The project's parts with their codes, in the order of the takeoff (treads walking up, risers, wangi, posts,
 * balustrade, trim, steel).
 * @param {object} models  what buildStaircase returned
 * @returns {{parts: {code, itemId, sourceElementId, elementType, name, dimensions, material, quantity, unit}[]}}
 */
export function buildPartList(models) {
  const config = models?.fullConfig ?? models?.config;
  if (!models?.treadModels || !config) return { parts: [] };
  const items = computeMaterialTakeoff(models, config);
  const treadById = new Map(models.treadModels.map((t) => [t.stepId, t]));
  const postById = new Map((models.postModels || []).map((p) => [p.postId, p]));
  const riserById = new Map((models.riserModels || []).map((r) => [r.stepId, r]));
  const part = (item, code, name, dimensions = describeDimensions(item.calculatedDimensions)) => ({
    code,
    itemId: item.itemId,
    sourceElementId: item.sourceElementId,
    elementType: item.elementType,
    name,
    dimensions,
    material: item.material,
    quantity: item.quantity,
    unit: item.unit,
  });
  const counters = new Map();
  const next = (prefix) => {
    const n = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, n);
    return n;
  };
  const parts = [];
  for (const item of items) {
    const src = item.sourceElementId.split(':');
    let code = null;
    let name = null;
    switch (item.elementType) {
      case 'TREAD':
      case 'LANDING': {
        const n = stepNumber(src[1]);
        const t = treadById.get(src[1]);
        const prefix = item.elementType === 'LANDING' ? 'PD' : 'ST';
        code = `${prefix}-${pad2(n)}`;
        name = `${item.elementType === 'LANDING' ? 'Podest' : t?.type === 'winder' ? 'Stopień zabiegowy' : 'Stopień'} ${n}`;
        if (src[2]) {
          // a cantilever tread's cladding boards: ST-01.1, ST-01.2, … in their order
          const k = next(`${code}.`);
          code = `${code}.${k}`;
          name += ` — ${CANTILEVER_PART_PL[src[2]] || src[2]}`;
        }
        break;
      }
      case 'RISER': {
        const n = stepNumber(src[1]);
        code = n === null ? 'PS-G' : `PS-${pad2(n)}`;
        name = n === null ? 'Podstopień górny (pod stopniem fajkowym)' : `Podstopień ${n}`;
        // a winder's fan riser is several flat panels — each its own piece: PS-06a, PS-06b, …
        const riser = riserById.get(src[1]);
        const d = item.calculatedDimensions;
        const panels = riser?.panels?.length > 1 && !riser.starter ? riser.panels : null;
        (panels || [{ width: d.totalWidthMm }]).forEach((panel, k) => {
          parts.push(part(item, panels ? `${code}${String.fromCharCode(97 + k)}` : code, panels ? `${name}, panel ${k + 1}/${panels.length}` : name, describeDimensions({ lengthMm: panel.width, heightMm: d.heightMm, thicknessMm: d.thicknessMm })));
        });
        continue;
      }
      case 'STRINGER': {
        const prefix = stringerPrefix(src[1], config);
        const k = next(prefix);
        code = `${prefix}-${k}`;
        name = `${wangaName(src[1], config)}, deska ${k}`;
        break;
      }
      case 'POST': {
        const post = postById.get(src[1]);
        const prefix = post?.kind === 'railing' ? 'SB' : 'SL';
        code = `${prefix}-${next(prefix)}`;
        name = POST_KIND_PL[post?.kind] || 'Słup';
        break;
      }
      case 'HANDRAIL': {
        const brackets = item.itemId.endsWith('-wall-brackets');
        const prefix = brackets ? 'UP' : 'PR';
        code = `${prefix}-${next(prefix)}`;
        name = brackets ? 'Uchwyty poręczy przyściennej' : 'Poręcz';
        break;
      }
      case 'BASERAIL':
        code = `PP-${next('PP')}`;
        name = 'Podporęcz';
        break;
      case 'BALUSTER':
        code = `TR-${next('TR')}`;
        name = 'Tralki';
        break;
      case 'GLASS_PANE':
        code = `SZ-${next('SZ')}`;
        name = 'Szyba balustrady';
        break;
      case 'GLASS_FIXING':
        code = `MS-${next('MS')}`;
        name = 'Mocowania szkła';
        break;
      case 'OPENING_TRIM':
        code = `FJ-${next('FJ')}`;
        name = 'Obróbka otworu (fajka)';
        break;
      case 'STEEL':
        code = `KS-${next('KS')}`;
        name = 'Element stalowy';
        break;
      default:
        break; // connectors, housings: no code
    }
    if (!code) continue;
    parts.push(part(item, code, name));
  }
  return { parts };
}

/**
 * The parts of a selected element (ui/selection.js shape): a tread → its tread (or its cladding boards) and its riser;
 * a wanga → its board (or every board of that side); a post → the post.
 */
export function partsForSelection(partList, selection) {
  if (!partList || !selection) return [];
  const { parts } = partList;
  switch (selection.elementType) {
    case 'tread':
    case 'riser': {
      const id = `step-${selection.stepIndex}`;
      return parts.filter((p) => {
        const [kind, step] = p.sourceElementId.split(':');
        return (kind === 'tread' || kind === 'landing' || kind === 'riser') && step === id;
      });
    }
    case 'stringer':
      return parts.filter((p) => {
        const [kind, side, seg] = p.sourceElementId.split(':');
        return kind === 'stringer' && side === selection.stringerId && (!selection.segmentId || seg === selection.segmentId);
      });
    case 'post':
      return parts.filter((p) => p.sourceElementId === `post:${selection.postId}`);
    default:
      return [];
  }
}
