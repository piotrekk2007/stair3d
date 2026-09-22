// Panel INSPEKTORA (zakładka prawego panelu) — jedno miejsce opisujące "to, co jest zaznaczone"
// (dawne #step-info-panel + #element-inspector-panel). Czysto prezentacyjny: renderuje dane z
// już-rozwiązanych modeli (TreadModel/StringerModel/PostModel/Diagnostic) — nie liczy geometrii
// (jedyna arytmetyka to różnica dwóch punktów modelu do wyświetlenia przesunięcia ręcznej edycji).
import { stateBadgeHTML } from './valueState.js';
import { CONSTRUCTION_TYPE_LABELS_PL } from '../geometry/stringerModel.js';
import { stepIndexFromElementId } from './selection.js';
import { MIN_POST_HEIGHT_MM } from '../geometry/postSolver.js';

const TYPE_LABEL_PL = { straight: 'prosty', winder: 'zabiegowy', landing: 'podest' };
const SEVERITY_LABEL_PL = { ERROR: 'BŁĄD', WARNING: 'UWAGA', INFO: 'INFO' };

const mm = (v, digits = 0) => `${Number(v).toFixed(digits)} mm`;
const pt = (p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`;

function row(label, valueHtml, badgeState) {
  const badge = badgeState ? stateBadgeHTML(badgeState) : '';
  return `<div class="insp-row"><span class="insp-label">${label}</span><span class="insp-value">${valueHtml}${badge}</span></div>`;
}

function section(title) {
  return `<div class="insp-section">${title}</div>`;
}

function diagnosticsHTML(diagnostics) {
  if (diagnostics.length === 0) return `<div class="insp-ok">Brak uwag walidatora dla tego elementu.</div>`;
  return diagnostics
    .map(
      (d) => `
      <div class="insp-diag ${d.severity.toLowerCase()}">
        <b>${SEVERITY_LABEL_PL[d.severity]}</b> <code>${d.ruleId}</code>
        <div>${d.message}</div>
      </div>`
    )
    .join('');
}

function offsetOfPoints(nominal, final) {
  // przesunięcie każdego końca krawędzi względem nominału — wyłącznie do wyświetlenia
  return nominal.map((p, i) => Math.hypot(final[i].x - p.x, final[i].y - p.y));
}

function treadHTML(ctx) {
  const { treadModel: t, config, overrides, overhangs, diagnostics } = ctx;
  const idx = t.index;
  const lockedGoing = config.lockedFields?.includes('treadGoing');
  const rows = [];
  rows.push(`<div class="insp-title">Stopień nr ${idx + 1} <small>${TYPE_LABEL_PL[t.type] || t.type}</small></div>`);
  rows.push(row('Wysokość góry (elewacja)', mm(t.elevation.top, 1), 'auto'));
  rows.push(row('Szerokość — czoło / tył', `${mm(t.widths.atFront)} / ${mm(t.widths.atBack)}`, 'auto'));
  if (t.winderInfo) {
    rows.push(row('Pozycja na linii biegu', `${t.winderInfo.stationStart.toFixed(0)}–${t.winderInfo.stationEnd.toFixed(0)} mm`, 'auto'));
  } else {
    rows.push(row('Głębokość (czoło→tył)', mm(config.treadGoing), lockedGoing ? 'user' : 'auto'));
  }

  rows.push(section('Krawędzie (frontEdge / backEdge)'));
  for (const [label, edge, boundary] of [
    ['Czoło', t.frontEdge, idx],
    ['Tył', t.backEdge, idx + 1],
  ]) {
    const manualEdge = !!overrides?.[boundary];
    const state = edge.overridden ? 'manual' : 'auto';
    const [dIn, dOut] = offsetOfPoints(edge.nominal, edge.final);
    const shift = edge.overridden ? ` <small>(Δ dusza ${dIn.toFixed(0)}, wanga ${dOut.toFixed(0)} mm)</small>` : '';
    const source = edge.overridden && !manualEdge ? ' <small>(z wysunięcia stopnia)</small>' : '';
    rows.push(row(`${label} — dusza / zewn.`, `${pt(edge.final[0])} / ${pt(edge.final[1])}${shift}${source}`, state));
  }

  const overhang = overhangs?.[idx];
  rows.push(section('Wysunięcie krawędzi bocznej'));
  if (overhang) {
    const sideLabel = overhang.side === 'inner' ? 'od strony duszy' : 'od strony wangi';
    const sign = overhang.offsetMm > 0 ? '+' : '';
    rows.push(row(`Krawędź ${sideLabel}`, `${sign}${overhang.offsetMm.toFixed(0)} mm`, 'manual'));
  } else {
    rows.push(row('Krawędzie boczne', 'brak wysunięcia', 'auto'));
  }

  rows.push(section('Walidacja'));
  rows.push(diagnosticsHTML(diagnostics));
  rows.push(`<div class="insp-source">ID źródła: <code>tread:${t.stepId}</code></div>`);
  return rows.join('');
}

function stringerHTML(ctx) {
  const { selection, config, stringerModels, diagnostics } = ctx;
  const model = stringerModels?.[selection.stringerId];
  const segment = model?.segments.find((s) => s.id === selection.segmentId) ?? null;
  const typeField = selection.stringerId === 'outer' ? 'stringerConstructionTypeOuter' : 'stringerConstructionTypeInner';
  const typeLabel = CONSTRUCTION_TYPE_LABELS_PL[config[typeField]] || config[typeField];
  const locked = (f) => (config.lockedFields?.includes(f) ? 'user' : 'auto');
  const rows = [];
  rows.push(`<div class="insp-title">Wanga ${selection.stringerId === 'outer' ? 'zewnętrzna' : 'wewnętrzna (dusza)'}${segment ? ` <small>${segment.id}</small>` : ''}</div>`);
  rows.push(row('Typ wangi', typeLabel, 'user'));
  rows.push(row('Min. głębokość wangi', mm(config.minimumStringerDepthMm), locked('minimumStringerDepthMm')));
  rows.push(row('Grubość deski', mm(config.stringerThickness), locked('stringerThickness')));
  rows.push(row('Min. grubość drewna (próg)', mm(config.stringerMinRemainingSectionMm), locked('stringerMinRemainingSectionMm')));
  if (model) rows.push(row('Liczba segmentów', String(model.segments.length), 'auto'));
  if (segment) {
    rows.push(row('Podparcia stopni w segmencie', String(segment.treadBearings.length), 'auto'));
    const ref = segment.referenceLine;
    rows.push(row('Oś odniesienia', `${pt(ref.start)} → ${pt(ref.end)}`, 'auto'));
  }
  rows.push(section('Walidacja'));
  rows.push(diagnosticsHTML(diagnostics));
  const id = selection.segmentId ? `stringer:${selection.stringerId}:${selection.segmentId}` : `stringer:${selection.stringerId}`;
  rows.push(`<div class="insp-source">ID źródła: <code>${id}</code></div>`);
  return rows.join('');
}

// Formularz edycji pojedynczego słupa. Czysty HTML z atrybutami data-* — zdarzenia obsługuje main.js
// (deleguje na panelu), który zmienia WYŁĄCZNIE config.manualPostOverrides i woła rebuild().
function postEditFormHTML(post, o) {
  if (post.removed) {
    return section('Edycja słupa') + `<button type="button" class="insp-btn" data-post-action="restore">Przywróć słup</button>`;
  }
  const field = (label, key, value) =>
    `<label class="insp-field"><span class="insp-label">${label}</span><input type="number" step="10" value="${value}" data-post-edit="${key}"> mm</label>`;
  return (
    section('Edycja słupa') +
    field('Wydłuż (+) / skróć (−) od GÓRY', 'topDeltaMm', o.topDeltaMm || 0) +
    field('Wydłuż (+) / skróć (−) od DOŁU', 'bottomDeltaMm', o.bottomDeltaMm || 0) +
    `<div class="insp-actions"><button type="button" class="insp-btn" data-post-action="reset">Resetuj długość</button><button type="button" class="insp-btn danger" data-post-action="remove">Usuń słup</button></div>`
  );
}

function postHTML(ctx) {
  const { selection, config, postModels, diagnostics } = ctx;
  const post = postModels?.find((p) => p.postId === selection.postId) ?? null;
  const rows = [];
  rows.push(`<div class="insp-title">Słup <small>${selection.postId ?? ''}</small></div>`);
  if (post) {
    rows.push(row('Rodzaj', post.kind, 'auto'));
    rows.push(row('Przekrój', `${post.size} × ${post.size} mm`, config.lockedFields?.includes('postSize') ? 'user' : 'auto'));
    rows.push(row('Pozycja w rzucie', pt(post.position), 'auto'));
    if (post.removed) {
      rows.push(row('Stan', 'usunięty — nie ma go w modelu 3D, wycenie ani walidacji', 'manual'));
    } else {
      rows.push(row('Wysokość (od–do)', `${post.elevation.bottom.toFixed(0)}–${post.elevation.top.toFixed(0)} mm (${(post.elevation.top - post.elevation.bottom).toFixed(0)} mm)`, post.overridden ? 'manual' : 'auto'));
      if (post.overridden) rows.push(row('Wysokość nominalna', `${post.nominalElevation.bottom.toFixed(0)}–${post.nominalElevation.top.toFixed(0)} mm`, 'auto'));
      if (post.overrideRejected) rows.push(`<div class="insp-diag warning"><b>UWAGA</b><div>Ta zmiana długości została zignorowana — słup byłby krótszy niż ${MIN_POST_HEIGHT_MM} mm.</div></div>`);
    }
    rows.push(postEditFormHTML(post, config.manualPostOverrides?.[post.postId] || {}));
  }
  rows.push(section('Walidacja'));
  rows.push(diagnosticsHTML(diagnostics));
  rows.push(`<div class="insp-source">ID źródła: <code>post:${selection.postId}</code></div>`);
  return rows.join('');
}

function summaryHTML(ctx) {
  const { config, derived, planLayout, manualCount } = ctx;
  if (!derived || !planLayout) return '';
  const typeLabel = { straight: 'Proste', L: 'Zabiegowe/kątowe L', U: 'Zabiegowe/kątowe U' }[config.stairType] || config.stairType;
  const w = planLayout.bounds.maxX - planLayout.bounds.minX;
  const l = planLayout.bounds.maxY - planLayout.bounds.minY;
  const rows = [];
  rows.push(`<div class="insp-title">Projektowane schody</div>`);
  rows.push(row('Konfiguracja', `${typeLabel}${config.stairType !== 'straight' ? `, skręt ${config.turnDirection === 'right' ? 'w prawo' : 'w lewo'}` : ''}`, 'user'));
  rows.push(row('Liczba stopni', String(derived.numTreads), 'auto'));
  rows.push(row('Wysokość podstopnia', mm(derived.riserHeight, 1), 'auto'));
  rows.push(row('Rzut klatki (dł. × szer.)', `${l.toFixed(0)} × ${w.toFixed(0)} mm`, 'auto'));
  const outerType = CONSTRUCTION_TYPE_LABELS_PL[config.stringerConstructionTypeOuter] || config.stringerConstructionTypeOuter;
  const innerType = CONSTRUCTION_TYPE_LABELS_PL[config.stringerConstructionTypeInner] || config.stringerConstructionTypeInner;
  rows.push(row('Typ wangi', outerType === innerType ? outerType : `zewn.: ${outerType} · wewn.: ${innerType}`, 'user'));
  rows.push(row('Ręczne zmiany geometrii', manualCount === 0 ? 'brak (wszystko wyliczone)' : `${manualCount}`, manualCount === 0 ? 'auto' : 'manual'));
  rows.push(`<div class="insp-hint">Zaznacz stopień, wangę lub słup w Planie 2D (albo element w widoku 3D), żeby zobaczyć jego szczegóły, stan AUTO/RĘCZNA i uwagi walidatora.</div>`);
  return rows.join('');
}

export function createInspectorPanel(container) {
  const panel = document.createElement('div');
  panel.id = 'inspector-panel';
  container.appendChild(panel);
  return panel;
}

/**
 * @param {HTMLElement} panel
 * @param {Object} ctx
 * @param {object|null} ctx.selection   kształt z ui/selection.js (albo null = podsumowanie projektu)
 * @param {object[]} ctx.diagnostics    wszystkie Diagnostic[] z ostatniej walidacji
 * plus: config, derived, planLayout, treadModels, stringerModels, postModels, manualCount
 */
export function updateInspectorPanel(panel, ctx) {
  const { selection, diagnostics = [] } = ctx;
  if (!selection) {
    panel.innerHTML = summaryHTML(ctx);
    return;
  }
  if (selection.elementType === 'tread' || selection.elementType === 'riser') {
    const treadModel = ctx.treadModels?.find((t) => t.index === selection.stepIndex);
    if (!treadModel) {
      panel.innerHTML = summaryHTML(ctx);
      return;
    }
    const own = diagnostics.filter((d) => stepIndexFromElementId(d.elementId) === selection.stepIndex);
    panel.innerHTML = treadHTML({ ...ctx, treadModel, overrides: ctx.config.manualEdgeOverrides, overhangs: ctx.config.manualTreadOverhangs, diagnostics: own });
    return;
  }
  if (selection.elementType === 'stringer') {
    const own = diagnostics.filter((d) => d.elementType === 'stringer' && (!d.elementId || d.elementId.includes(selection.stringerId)));
    panel.innerHTML = stringerHTML({ ...ctx, diagnostics: own });
    return;
  }
  if (selection.elementType === 'post') {
    const own = diagnostics.filter((d) => d.elementType === 'post' && (!selection.postId || !d.elementId || d.elementId === selection.postId));
    panel.innerHTML = postHTML({ ...ctx, diagnostics: own });
    return;
  }
  panel.innerHTML = summaryHTML(ctx);
}

/** Krótka etykieta zaznaczenia dla paska statusu. */
export function selectionLabel(selection) {
  if (!selection) return 'Nic nie zaznaczono';
  switch (selection.elementType) {
    case 'tread':
    case 'riser':
      return `Zaznaczono: stopień ${selection.stepIndex + 1}`;
    case 'stringer':
      return `Zaznaczono: wanga ${selection.stringerId === 'outer' ? 'zewnętrzna' : 'wewnętrzna'}${selection.segmentId ? ` (${selection.segmentId})` : ''}`;
    case 'post':
      return `Zaznaczono: słup ${selection.postId ?? ''}`;
    default:
      return 'Zaznaczono element';
  }
}
