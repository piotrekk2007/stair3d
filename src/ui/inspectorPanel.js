// Panel INSPEKTORA (zakładka prawego panelu) — jedno miejsce opisujące "to, co jest zaznaczone"
// (dawne #step-info-panel + #element-inspector-panel). Czysto prezentacyjny: renderuje dane z
// już-rozwiązanych modeli (TreadModel/StringerModel/PostModel/Diagnostic) — nie liczy geometrii
// (jedyna arytmetyka to różnica dwóch punktów modelu do wyświetlenia przesunięcia ręcznej edycji).
import { stateBadgeHTML } from './valueState.js';
import { escapeHtml } from '../util/format.js';
import { CONSTRUCTION_TYPE_LABELS_PL } from '../geometry/stringerModel.js';
import { stepIndexFromElementId } from './selection.js';
import { MIN_POST_HEIGHT_MM } from '../geometry/postSolver.js';
import { railingEndKey, MAX_RAILING_END_OFFSET_MM } from '../geometry/railingSolver.js';
import { sideShort, sideAdjective, wangaName } from '../util/sideNames.js';
import { wallRailAllowed } from '../geometry/stairwell.js';

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

// Ustawianie krańców odcinków balustrady ze stopnia zaznaczonego w planie (obsługa w main.js applyRailingEdit).
function railingBlockHTML(config, stepIndex) {
  if (!config.railingEnabled) return '';
  const sideLabel = { outer: sideShort('outer', config), inner: sideShort('inner', config) };
  const sections = config.railingSections || [];
  const rows = sections.map((s) => {
    const range = `${s.fromStep + 1}–${s.toStep === null ? 'koniec' : s.toStep + 1}`;
    const btn = (action, label) => `<button type="button" class="insp-btn" data-railing-action="${action}" data-section-id="${s.id}">${label}</button>`;
    return `<div class="insp-railing"><div class="insp-railing-title">Odcinek ${sideLabel[s.side]} · stopnie ${range}</div><div class="insp-actions">${btn('from', `Początek: stopień ${stepIndex + 1}`)}${btn('to', `Koniec: stopień ${stepIndex + 1}`)}${s.toStep === null ? '' : btn('to-end', 'Do końca')}${btn('remove', 'Usuń')}</div></div>`;
  });
  const add = ['outer', 'inner'].map((side) => `<button type="button" class="insp-btn" data-railing-action="new" data-side="${side}">Nowy odcinek ${sideLabel[side]} od stopnia ${stepIndex + 1}</button>`).join('');
  return section('Balustrada') + rows.join('') + `<div class="insp-actions">${add}</div>`;
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
    rows.push(row(`${label} — ${config.stairType === 'S' ? `${sideShort('inner', config)} / ${sideShort('outer', config)}` : 'dusza / zewn.'}`, `${pt(edge.final[0])} / ${pt(edge.final[1])}${shift}${source}`, state));
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

  rows.push(starterHTML(t, config));
  rows.push(railingBlockHTML(config, idx));
  rows.push(`<div class="insp-actions"><button type="button" class="insp-btn" data-tread-dxf="${t.stepId}" title="Rzeczywisty (skala 1:1) rysunek DXF tego stopnia — gotowy kontur z noskiem, do wycięcia w warsztacie">Eksportuj stopień (DXF 1:1)</button></div>`);

  rows.push(section('Walidacja'));
  rows.push(diagnosticsHTML(diagnostics));
  rows.push(`<div class="insp-source">ID źródła: <code>tread:${t.stepId}</code></div>`);
  return rows.join('');
}

// Starter step (geometry/starterSteps.js): a straight tread marked as one, widened left / right (walking up), its
// widened end rounded, its front bowed, with or without its own riser.
function starterHTML(t, config) {
  if (t.type !== 'straight' || t.winderInfo) return '';
  const spec = config.manualStarterTreads?.[t.index];
  const rows = [section('Stopień zapraszający')];
  rows.push(`<label class="insp-field" title="Szerszy stopień z zaoblonym końcem / wygiętym czołem i własnym podstopniem"><span class="insp-label">Stopień zapraszający</span><input type="checkbox" ${spec ? 'checked' : ''} data-starter-toggle="${t.index}"></label>`);
  if (spec) {
    const field = (key, label, title, max) =>
      `<label class="insp-field" title="${title}"><span class="insp-label">${label}</span><input type="number" min="0" max="${max}" step="5" value="${Math.round(Number(spec[key]) || 0)}" data-starter-field="${t.index}|${key}"> mm</label>`;
    rows.push(field('leftMm', 'Poszerzenie w lewo', 'Patrząc w kierunku wchodzenia — od linii schodów (lica wangi) po lewej', 1000));
    rows.push(field('rightMm', 'Poszerzenie w prawo', 'Patrząc w kierunku wchodzenia — od linii schodów (lica wangi) po prawej', 1000));
    rows.push(field('radiusMm', 'Zaoblenie boku (promień)', 'Promień zaokrąglenia poszerzonego końca — maks. półkole na głębokość stopnia', 500));
    rows.push(field('bowMm', 'Wygięcie czoła (strzałka łuku)', 'Czoło jako łuk na całej szerokości stopnia: o ile wysunięty jest środek; 0 = proste', 300));
    rows.push(`<label class="insp-field" title="Podstopień gięty wzdłuż czoła i zaoblenia — niezależnie od podstopni reszty schodów"><span class="insp-label">Z podstopniem</span><input type="checkbox" ${spec.riser ? 'checked' : ''} data-starter-field="${t.index}|riser"></label>`);
    rows.push(`<div class="insp-hint">Po poszerzonej stronie stopień leży NA wandze (wanga wpuszczana ścięta pod nim do spodu stopnicy, bez gniazda). Poszerzony na stronę duszy na początku schodów — słup startowy stoi na nim.</div>`);
  }
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
  rows.push(`<div class="insp-title">${wangaName(selection.stringerId, config)}${segment ? ` <small>${segment.id}</small>` : ''}</div>`);
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
  // Only a balustrade post has its own thickness (the structural posts share config.postSize).
  const thickness =
    post.kind === 'railing'
      ? `<label class="insp-field"><span class="insp-label">Grubość słupka (kwadrat)</span><input type="number" step="5" min="20" max="300" value="${post.size}" data-post-edit="sizeMm"> mm</label>`
      : '';
  return (
    section('Edycja słupa') +
    thickness +
    field('Wydłuż (+) / skróć (−) od GÓRY', 'topDeltaMm', o.topDeltaMm || 0) +
    field('Wydłuż (+) / skróć (−) od DOŁU', 'bottomDeltaMm', o.bottomDeltaMm || 0) +
    `<div class="insp-actions"><button type="button" class="insp-btn" data-post-action="reset">Resetuj długość i grubość</button>${post.manual ? '' : '<button type="button" class="insp-btn danger" data-post-action="remove">Usuń słup</button>'}</div>`
  );
}

// The handrail ends at this post (geometry/railingSolver.js): each one's height can be corrected by hand —
// config.railingEndOffsets, keyed by railingEndKey. The handrail always ends on the post's face; this only moves that
// point up or down (e.g. to shorten an arc that rises too high before the post).
function railingEndsHTML(railingModel, postId) {
  const fields = [];
  for (const s of railingModel?.sections || []) {
    if (!s.valid || s.kind === 'opening') continue; // a level balustrade on the floor has no end heights to correct
    s.runs.forEach((run) => {
      if (run.endPostId === postId) fields.push(['Poręcz dochodząca do słupa', railingEndKey(s.id, postId, 'end'), run.endOffsetMm || 0, s.id]);
      if (run.startPostId === postId) fields.push(['Poręcz odchodząca od słupa', railingEndKey(s.id, postId, 'start'), run.startOffsetMm || 0, s.id]);
    });
  }
  if (fields.length === 0) return '';
  return (
    section('Poręcz przy słupie') +
    fields
      .map(
        ([label, key, value, sectionId]) =>
          `<label class="insp-field" title="Wysokość końca poręczy na licu tego słupa: + w górę, − w dół (odcinek ${sectionId})"><span class="insp-label">${label}: wyżej (+) / niżej (−)</span><input type="number" step="10" min="${-MAX_RAILING_END_OFFSET_MM}" max="${MAX_RAILING_END_OFFSET_MM}" value="${value}" data-railing-end="${key}"> mm</label>`
      )
      .join('') +
    `<div class="insp-hint">Poręcz zawsze kończy się na licu słupa. Tu przesuwasz ten punkt w pionie — prosty odcinek poręczy przy słupie zmienia pochylenie, tralki się dopasowują.</div>`
  );
}

// Where a balustrade post stands along its section (geometry/railingPostEdits.js): a hand-placed one — its distance
// from the section's start, editable, and "Usuń"; an automatic corner one — "Wyłącz" (the handrail goes on through
// the corner). Nothing for a structural post.
// The runs of a section meeting this post: "sama poręcz" (no infill) toggles (railingPostEdits.js `bare`).
function railingRunsAtPostHTML(s, postId) {
  return s.runs
    .filter((r) => !r.wallRail && (r.startPostId === postId || r.endPostId === postId))
    .map((r) => {
      const other = r.startPostId === postId ? r.endPostId : r.startPostId;
      return `<label class="insp-field" title="Bieg poręczy ${r.key}: bez tralek / szkła — sama poręcz na słupkach"><span class="insp-label">Bieg do ${escapeHtml(other)}: sama poręcz</span><input type="checkbox" ${r.bare ? 'checked' : ''} data-railing-bare-run="${s.id}|${escapeHtml(r.key)}"></label>`;
    })
    .join('');
}

function railingPostPlaceHTML(railingModel, post, config) {
  const out = [];
  for (const s of railingModel?.sections || []) {
    const spot = (s.postSpots || []).find((x) => x.postId === post.postId);
    if (!spot) continue;
    const parts = [];
    if (spot.kind === 'manual') {
      parts.push(
        `<label class="insp-field" title="Odległość w rzucie wzdłuż linii balustrady od początku odcinka ${s.id}"><span class="insp-label">Od początku odcinka</span><input type="number" step="10" min="0" value="${Math.round(spot.s)}" data-railing-post-s="${s.id}|${spot.manualId}"> mm</label>` +
          `<div class="insp-actions"><button type="button" class="insp-btn danger" data-railing-post-action="remove" data-section-id="${s.id}" data-manual-id="${spot.manualId}">Usuń słupek</button></div>` +
          `<div class="insp-hint">Na planie (tryb „▮ Słupki”): przeciągnij słupek wzdłuż balustrady, prawy klik — usuń.</div>`
      );
    } else if (spot.movable && spot.spotKey) {
      // an automatic post moved by hand (railingPostEdits.js `moved`)
      parts.push(
        `<label class="insp-field" title="Odległość w rzucie wzdłuż linii balustrady od początku odcinka ${s.id}"><span class="insp-label">Od początku odcinka</span><input type="number" step="10" min="0" value="${Math.round(spot.s ?? 0)}" data-railing-auto-s="${s.id}|${spot.spotKey}"> mm ${stateBadgeHTML(spot.moved ? 'manual' : 'auto')}</label>` +
          (spot.moved ? `<div class="insp-actions"><button type="button" class="insp-btn" data-railing-post-action="reset-auto" data-section-id="${s.id}" data-key="${spot.spotKey}">Przywróć położenie AUTO</button></div>` : '')
      );
      // past a moved end: the handrail on along the wall (on a side with a stairwell wall)
      if ((spot.kind === 'start' || spot.kind === 'end') && wallRailAllowed(config, s.side)) {
        const end = spot.kind;
        const on = !!s.wallRailEnds?.[end];
        const label = end === 'start' ? 'Przed słupkiem: poręcz przyścienna' : 'Za słupkiem: poręcz przyścienna';
        parts.push(`<label class="insp-field" title="Od tego słupka do ${end === 'start' ? 'początku' : 'końca'} odcinka: sama poręcz na wspornikach ściennych (bez słupków i tralek). Słupek nieprzesunięty przesuwa się sam na koniec ściany klatki wzdłuż balustrady."><span class="insp-label">${label}</span><input type="checkbox" ${on ? 'checked' : ''} data-railing-wall-rail="${s.id}|${end}"></label>`);
      }
    }
    if (spot.suppressible) {
      parts.push(`<div class="insp-actions"><button type="button" class="insp-btn" data-railing-post-action="suppress" data-section-id="${s.id}" data-s="${spot.s}">Wyłącz słupek (poręcz ciągła przez narożnik)</button></div>`);
    }
    parts.push(railingRunsAtPostHTML(s, post.postId));
    const manualCount = (s.postSpots || []).filter((x) => x.kind === 'manual').length;
    if (manualCount > 1) parts.push(`<div class="insp-actions"><button type="button" class="insp-btn danger" data-railing-post-action="remove-all-manual" data-section-id="${s.id}">Usuń wszystkie ręczne słupki odcinka (${manualCount})</button></div>`);
    const body = parts.join('');
    if (body) out.push(section(`Balustrada ${escapeHtml(s.id)} — słupek`) + body);
  }
  return out.join('');
}

function postHTML(ctx) {
  const { selection, config, postModels, diagnostics } = ctx;
  const post = postModels?.find((p) => p.postId === selection.postId) ?? null;
  const rows = [];
  rows.push(`<div class="insp-title">Słup <small>${selection.postId ?? ''}</small></div>`);
  if (post) {
    rows.push(row('Rodzaj', post.kind === 'railing' ? 'słupek balustrady' : post.kind, 'auto'));
    rows.push(row('Przekrój', `${post.size} × ${post.size} mm`, post.kind === 'railing' ? (post.overridden && post.nominalSize !== undefined ? 'manual' : 'auto') : config.lockedFields?.includes('postSize') ? 'user' : 'auto'));
    rows.push(row('Pozycja w rzucie', pt(post.position), 'auto'));
    if (post.removed) {
      rows.push(row('Stan', 'usunięty — nie ma go w modelu 3D, wycenie ani walidacji', 'manual'));
    } else {
      rows.push(row('Wysokość (od–do)', `${post.elevation.bottom.toFixed(0)}–${post.elevation.top.toFixed(0)} mm (${(post.elevation.top - post.elevation.bottom).toFixed(0)} mm)`, post.overridden ? 'manual' : 'auto'));
      if (post.overridden) rows.push(row('Wysokość nominalna', `${post.nominalElevation.bottom.toFixed(0)}–${post.nominalElevation.top.toFixed(0)} mm`, 'auto'));
      if (post.overrideRejected) rows.push(`<div class="insp-diag warning"><b>UWAGA</b><div>Ta zmiana długości została zignorowana — słup byłby krótszy niż ${MIN_POST_HEIGHT_MM} mm.</div></div>`);
      rows.push(`<div class="insp-actions"><button type="button" class="insp-btn" data-post-dxf="${post.postId}" title="Rzeczywisty (skala 1:1) rysunek DXF tego słupa — prosty prostokąt przekrój × długość, do wycięcia w warsztacie">Eksportuj słup (DXF 1:1)</button></div>`);
    }
    rows.push(railingPostPlaceHTML(ctx.railingModel, post, config));
    rows.push(postEditFormHTML(post, config.manualPostOverrides?.[post.postId] || {}));
    if (!post.removed) rows.push(railingEndsHTML(ctx.railingModel, post.postId));
  }
  rows.push(section('Walidacja'));
  rows.push(diagnosticsHTML(diagnostics));
  rows.push(`<div class="insp-source">ID źródła: <code>post:${selection.postId}</code></div>`);
  return rows.join('');
}

function summaryHTML(ctx) {
  const { config, derived, planLayout, manualCount } = ctx;
  if (!derived || !planLayout) return '';
  const typeLabel = { straight: 'Proste', L: 'Zabiegowe/kątowe L', U: 'Zabiegowe/kątowe U', S: 'Zabiegowe/kątowe S (drugi zakręt w przeciwną stronę)' }[config.stairType] || config.stairType;
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
  if (config.stairConstruction === 'cantilever') {
    rows.push(row('Konstrukcja', 'wspornikowa (profile w ścianie, okładziny)', 'user'));
  } else if (config.stairConstruction === 'metal-profile') {
    rows.push(row('Konstrukcja', `metalowa — wanga na profilu (${Number(config.metalBeamCount) >= 2 ? '2 belki' : '1 belka centralna'}, podpory pod stopniami)`, 'user'));
  } else if (config.stairConstruction === 'metal-flat') {
    rows.push(row('Konstrukcja', 'metalowa — dwa płaskowniki wycinane w zęby', 'user'));
  } else {
    rows.push(row('Typ wangi', outerType === innerType ? outerType : `${sideShort('outer', config)}: ${outerType} · ${sideShort('inner', config)}: ${innerType}`, 'user'));
  }
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
export function selectionLabel(selection, config = null) {
  if (!selection) return 'Nic nie zaznaczono';
  switch (selection.elementType) {
    case 'tread':
    case 'riser':
      return `Zaznaczono: stopień ${selection.stepIndex + 1}`;
    case 'stringer':
      return `Zaznaczono: wanga ${sideAdjective(selection.stringerId, config)}${selection.segmentId ? ` (${selection.segmentId})` : ''}`;
    case 'post':
      return `Zaznaczono: słup ${selection.postId ?? ''}`;
    default:
      return 'Zaznaczono element';
  }
}
