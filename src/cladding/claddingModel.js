// The wooden cladding laid on the measured concrete (module "Schody na beton", stage 1 —
// docs/architecture/CONCRETE_CLADDING_MODULE.md): per concrete step its tread (the step's top + the front nosing past
// the riser board + a side nosing past the concrete on every open side), its riser board, the exit riser up to the
// slab, and the FINISHED heights — what the installer checks before ordering. Pure, no Three.js.

import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { planPoint } from './concreteModel.js';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Does this element get a side nosing on `side` (walking up)? A step's own override wins; a turning landing never on
 *  the side the next flight leaves from. */
export function sideNosingOn(element, side, config) {
  if (element.exitSide === side) return false;
  const o = config.stepOverrides?.[element.index] || {};
  const own = side === 'left' ? o.nosingLeft : o.nosingRight;
  if (typeof own === 'boolean') return own;
  return side === 'left' ? !!config.sideNosingLeft : !!config.sideNosingRight;
}

export function riserOn(element, config) {
  const own = config.stepOverrides?.[element.index]?.riser;
  return typeof own === 'boolean' ? own : !!config.riserBoards;
}

// "left" / "right" walking up are the u0 / u1 edges of a frame whose r points right
const sideU = (e) => ({ left: e.u0, right: e.u1 });

/**
 * @param {object} concrete  buildConcreteModel's result
 * @returns {{treads, risers, heights, diagnostics}}
 */
export function buildCladdingModel(concrete, config) {
  const t = config.treadThicknessMm;
  const r = config.riserThicknessMm;
  const els = concrete.elements;
  const treads = [];
  const risers = [];
  els.forEach((e, i) => {
    const riser = riserOn(e, config);
    const front = config.nosingFrontMm + (riser ? r : 0);
    const left = sideNosingOn(e, 'left', config) ? config.sideNosingMm : 0;
    const right = sideNosingOn(e, 'right', config) ? config.sideNosingMm : 0;
    const { left: uL, right: uR } = sideU(e);
    let local;
    if (e.kind === 'landing' && (e.turn === 'u-left' || e.turn === 'u-right')) {
      // a U landing: the front nosing only where the incoming flight arrives and over the gap — the return flight's
      // first riser stands on the rest of that line
      const prev = els[i - 1];
      const incoming = prev ? prev.u1 - prev.u0 : e.widthMm;
      const gap = els[i].widthMm - incoming - (els[i + 1] ? els[i + 1].u1 - els[i + 1].u0 : 0);
      if (e.turn === 'u-right') {
        const cut = uL + incoming + Math.max(0, gap);
        local = [
          [uL - left, e.v0 - front],
          [cut, e.v0 - front],
          [cut, e.v0],
          [uR, e.v0],
          [uR, e.v1],
          [uL - left, e.v1],
        ];
      } else {
        const cut = uR - incoming - Math.max(0, gap);
        local = [
          [uL, e.v0],
          [cut, e.v0],
          [cut, e.v0 - front],
          [uR + right, e.v0 - front],
          [uR + right, e.v1],
          [uL, e.v1],
        ];
      }
    } else {
      local = [
        [uL - left, e.v0 - front],
        [uR + right, e.v0 - front],
        [uR + right, e.v1],
        [uL - left, e.v1],
      ];
    }
    let outline = local.map(([u, v]) => planPoint(e.frame, u, v));
    const area = outline.reduce((s, p, k) => s + p.x * outline[(k + 1) % outline.length].y - outline[(k + 1) % outline.length].x * p.y, 0);
    if (area < 0) outline = outline.reverse();
    treads.push({
      id: `${e.kind}-${e.index}`,
      index: e.index,
      kind: e.kind,
      outline,
      bottomZ: e.topZ,
      topZ: e.topZ + t,
      thicknessMm: t,
      nosing: { frontMm: config.nosingFrontMm, leftMm: left, rightMm: right },
      // the board's size: along the walking direction × across (the production blank, stage 4 prices it)
      depthMm: e.v1 - e.v0 + front,
      lengthMm: uR - uL + left + right,
      grain: e.frame.r,
    });
    if (riser) {
      const below = i === 0 ? config.floorFinishBottomMm : els[i - 1].topZ + t;
      risers.push({
        id: `riser-${e.index}`,
        index: e.index,
        outline: [planPoint(e.frame, uL, e.v0 - r), planPoint(e.frame, uR, e.v0 - r), planPoint(e.frame, uR, e.v0), planPoint(e.frame, uL, e.v0)],
        bottomZ: below,
        topZ: e.topZ,
        heightMm: e.topZ - below,
        lengthMm: uR - uL,
        thicknessMm: r,
        grain: e.frame.r,
      });
    }
  });
  // the exit riser: on the last tread, in front of the slab's edge, up to the finished floor above
  const last = els.at(-1);
  if (last && config.riserBoards) {
    const { left: uL, right: uR } = sideU(last);
    const topZ = concrete.exit.rawSlabTopZ + config.floorFinishTopMm;
    risers.push({
      id: 'riser-top',
      index: els.length,
      outline: [planPoint(last.frame, uL, last.v1 - r), planPoint(last.frame, uR, last.v1 - r), planPoint(last.frame, uR, last.v1), planPoint(last.frame, uL, last.v1)],
      bottomZ: last.topZ + t,
      topZ,
      heightMm: topZ - last.topZ - t,
      lengthMm: uR - uL,
      thicknessMm: r,
      grain: last.frame.r,
    });
  }
  const heights = finishedHeights(concrete, config);
  return { treads, risers, heights, diagnostics: heightDiagnostics(heights, config) };
}

/** The finished rise of every step (floor → first tread … last tread → floor above) and its concrete one. */
export function finishedHeights(concrete, config) {
  const t = config.treadThicknessMm;
  const els = concrete.elements;
  const rows = els.map((e, i) => {
    const below = i === 0 ? config.floorFinishBottomMm : els[i - 1].topZ + t;
    return { index: e.index, kind: e.kind, label: `${e.kind === 'landing' ? 'Podest' : 'Stopień'} ${e.index + 1}`, concreteRiseMm: e.riseMm, finishedRiseMm: e.topZ + t - below, goingMm: e.kind === 'step' ? e.goingMm : null, finishedTopZ: e.topZ + t };
  });
  if (els.length) {
    const lastTop = els.at(-1).topZ + t;
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
