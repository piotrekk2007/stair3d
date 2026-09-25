// "Konstrukcja" tab (right sidebar): renders the result of structural/index.js buildStructuralReport() — nothing is
// computed here beyond formatting. The disclaimer and the UK-load warning are always shown.

import { GRAVITY_M_S2 as GRAVITY } from '../structural/timberClasses.js';

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const num = (v, digits) => v.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// `onSelectStep(stepId)` — a click on a tread row selects that tread everywhere (2D, 3D, Inspektor).
export function createStructuralPanel(container, { onSelectStep, onSelectStringer, onSelectPost } = {}) {
  const panel = document.createElement('div');
  panel.id = 'structural-panel';
  container.appendChild(panel);
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('[data-step-id]');
    if (row && onSelectStep) onSelectStep(row.dataset.stepId);
    const stringerRow = e.target.closest('[data-stringer-side]');
    if (stringerRow && onSelectStringer) onSelectStringer(stringerRow.dataset.stringerSide);
    const postRow = e.target.closest('[data-post-id]');
    if (postRow && onSelectPost) onSelectPost(postRow.dataset.postId);
  });
  return panel;
}

const pct = (u) => `${Math.round(u * 100)}%`;
const utilCell = (u) => `<td class="num${u > 1 ? ' st-over' : ''}">${pct(u)}</td>`;
const TYPE_LABEL = { straight: 'prosty', winder: 'zabieg.' };

function treadTableHTML(treads) {
  if (!treads || (treads.checks.length === 0 && treads.skipped.length === 0)) return '<div class="st-note">Brak stopni do sprawdzenia.</div>';
  const worst = treads.checks.reduce((m, c) => Math.max(m, c.maxUtil), 0);
  const rows = treads.checks
    .map(
      (c) => `<tr class="st-row" data-step-id="${esc(c.stepId)}" title="Kliknij, aby zaznaczyć stopień">
        <td>${c.stepNumber} <span class="st-muted">${TYPE_LABEL[c.type] || ''}</span></td>
        <td class="num">${Math.round(c.spanMm)}</td>
        <td class="num">${Math.round(c.bMm)}×${c.hMm}</td>
        ${utilCell(c.bendingUtil)}
        ${utilCell(c.shearUtil)}
        <td class="num${c.deflectionInstMm > c.deflectionInstLimitMm ? ' st-over' : ''}" title="limit ${num(c.deflectionInstLimitMm, 1)} mm">${num(c.deflectionInstMm, 1)}</td>
        <td class="num${c.deflectionFinMm > c.deflectionFinLimitMm ? ' st-over' : ''}" title="limit ${num(c.deflectionFinLimitMm, 1)} mm">${num(c.deflectionFinMm, 1)}</td>
        ${utilCell(c.maxUtil)}
      </tr>`
    )
    .join('');
  const skipped = treads.skipped.length
    ? `<div class="st-note">Nie sprawdzane: ${treads.skipped.map((s) => `nr ${Number(String(s.stepId).replace('step-', '')) + 1} (${esc(s.reason)})`).join('; ')}.</div>`
    : '';
  return `
    <div class="st-note ${worst > 1 ? 'warn' : ''}">Najbardziej wytężony stopień: ${pct(worst)}${worst > 1 ? ' — przekroczenie (ostrzeżenie w Walidacji)' : ''}.</div>
    <table class="st-table">
      <thead><tr><th>Stopień</th><th>L [mm]</th><th>b×h</th><th>M</th><th>V</th><th title="ugięcie chwilowe od obc. użytkowego">w_inst</th><th title="ugięcie końcowe z pełzaniem">w_fin</th><th>max</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="st-note">M — zginanie, V — ścinanie (% nośności obliczeniowej); ugięcia w mm (najedź, by zobaczyć limit); max — najgorszy z czterech warunków.</div>
    ${skipped}`;
}

function stringerTableHTML(stringers) {
  if (!stringers || (stringers.checks.length === 0 && stringers.skipped.length === 0)) return '<div class="st-note">Brak desek wang do sprawdzenia.</div>';
  const worst = stringers.checks.reduce((m, c) => Math.max(m, c.maxUtil), 0);
  const sideLabel = (s) => (s === 'outer' ? 'zewn.' : 'wewn.');
  const rows = stringers.checks
    .map(
      (c) => `<tr class="st-row" data-stringer-side="${esc(c.side)}" title="G ${num(c.permanentKn, 2)} kN (w tym balustrada ${num(c.railingKn, 2)} kN: poręcz ${num(c.railingDetailKn.handrail, 2)}, tralki ${num(c.railingDetailKn.balusters, 2)}, słupki ${num(c.railingDetailKn.posts, 2)}), Q ${num(c.imposedKn, 2)} kN — kliknij, aby zaznaczyć wangę">
        <td>${sideLabel(c.side)} <span class="st-muted">${esc(c.segmentId.replace(/^(outer|inner)-seg-/, 'deska '))}</span></td>
        <td class="num">${Math.round(c.spanMm)}</td>
        <td class="num">${Math.round(c.angleDeg)}°</td>
        <td class="num">${Math.round(c.bMm)}×${Math.round(c.hMm)}</td>
        <td class="num">${c.railingKn > 0 ? num((c.railingKn * 1000) / GRAVITY, 1) : '—'}</td>
        ${utilCell(c.bendingUtil)}
        ${utilCell(c.shearUtil)}
        <td class="num${c.deflectionInstMm > c.deflectionInstLimitMm ? ' st-over' : ''}" title="limit ${num(c.deflectionInstLimitMm, 1)} mm">${num(c.deflectionInstMm, 1)}</td>
        <td class="num${c.deflectionFinMm > c.deflectionFinLimitMm ? ' st-over' : ''}" title="limit ${num(c.deflectionFinLimitMm, 1)} mm">${num(c.deflectionFinMm, 1)}</td>
        ${utilCell(c.maxUtil)}
      </tr>`
    )
    .join('');
  const skipped = stringers.skipped.length
    ? `<div class="st-note">Nie sprawdzane: ${stringers.skipped.map((s) => `${sideLabel(s.side)} ${esc(s.segmentId)} (${esc(s.reason)})`).join('; ')}.</div>`
    : '';
  return `
    <div class="st-note ${worst > 1 ? 'warn' : ''}">Najbardziej wytężona deska wangi: ${pct(worst)}${worst > 1 ? ' — przekroczenie (ostrzeżenie w Walidacji)' : ''}.</div>
    <table class="st-table">
      <thead><tr><th>Wanga</th><th>L [mm]</th><th>kąt</th><th>b×h</th><th title="ciężar balustrady na tej desce">bal. [kg]</th><th>M</th><th>V</th><th>w_inst</th><th>w_fin</th><th>max</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="st-note">L — długość pochyła między końcami deski; b×h — przekrój obliczeniowy (wpuszczana: grubość − wpust; nakładana: gardziel pod wcięciem). bal. — ciężar balustrady na tej desce (tralki i słupki tam, gdzie stoją; poręcz po długości); najedź na wiersz, by zobaczyć obciążenia.</div>
    ${skipped}`;
}

function railingTableHTML(railing) {
  if (!railing || (railing.rails.length === 0 && railing.posts.length === 0)) return '<div class="st-note">Brak balustrady (albo odcinków) do sprawdzenia.</div>';
  const sideLabel = (s) => (s === 'outer' ? 'zewn.' : 'wewn.');
  const worst = [...railing.rails, ...railing.posts].reduce((m, c) => Math.max(m, c.maxUtil), 0);
  const railRows = railing.rails
    .map(
      (c) => `<tr>
        <td>poręcz ${sideLabel(c.side)} <span class="st-muted">${esc(c.sectionId)}, bieg ${c.runIndex + 1}</span></td>
        <td class="num">${Math.round(c.spanMm)}</td>
        <td class="num">${esc(c.section)}</td>
        ${utilCell(c.bendingUtil)}
        <td class="num${c.deflectionMm > c.deflectionLimitMm ? ' st-over' : ''}" title="limit ${c.deflectionLimitMm} mm">${num(c.deflectionMm, 1)}</td>
        ${utilCell(c.maxUtil)}
      </tr>`
    )
    .join('');
  const postRows = railing.posts
    .map(
      (c) => `<tr class="st-row" data-post-id="${esc(c.postId)}" title="siła ${num(c.forceKn, 2)} kN na ramieniu ${Math.round(c.leverMm)} mm — kliknij, aby zaznaczyć słupek">
        <td>słupek <span class="st-muted">${esc(c.postId)}</span></td>
        <td class="num">${Math.round(c.leverMm)}</td>
        <td class="num">${c.sizeMm}×${c.sizeMm}</td>
        ${utilCell(c.bendingUtil)}
        <td class="num${c.deflectionMm > c.deflectionLimitMm ? ' st-over' : ''}" title="limit ${c.deflectionLimitMm} mm">${num(c.deflectionMm, 1)}</td>
        ${utilCell(c.maxUtil)}
      </tr>`
    )
    .join('');
  const skipped = railing.skipped.length ? `<div class="st-note">Nie sprawdzane: ${railing.skipped.map((s) => `${esc(s.id)} (${esc(s.reason)})`).join('; ')}.</div>` : '';
  return `
    <div class="st-note ${worst > 1 ? 'warn' : ''}">Najbardziej wytężony element balustrady: ${pct(worst)}${worst > 1 ? ' — przekroczenie (ostrzeżenie w Walidacji)' : ''}.</div>
    <table class="st-table">
      <thead><tr><th>Element</th><th title="poręcz: rozpiętość między słupkami; słupek: wysokość poręczy nad podstawą">L / H</th><th>przekrój</th><th>M</th><th>w [mm]</th><th>max</th></tr></thead>
      <tbody>${railRows}${postRows}</tbody>
    </table>
    <div class="st-note">Poziome obciążenie poręczy; w — ugięcie poręczy w poziomie / wychylenie słupka na wysokości poręczy. Tralki nie są liczone jako podpory poręczy.</div>
    ${skipped}`;
}

export function updateStructuralPanel(panel, report) {
  if (!report) {
    panel.innerHTML = '';
    return;
  }
  const w = report.selfWeight;
  const rows = w.categories
    .map(
      (c) => `<tr>
        <td>${esc(c.label)}${c.count > 1 ? ` <span class="st-muted">(${c.count} szt.)</span>` : ''}</td>
        <td class="num">${num(c.volumeM3, 4)}</td>
        <td class="num" title="${esc(c.densityLabel)}">${num(c.densityKgM3, 0)}</td>
        <td class="num">${num(c.massKg, 1)}</td>
        <td class="num">${num(c.weightKn, 2)}</td>
      </tr>`
    )
    .join('');
  const missing = w.missing.length
    ? `<div class="st-note warn">Pominięto ${w.missing.length} element(ów) bez wyliczonej objętości — ciężar jest niepełny (sprawdź Walidację).</div>`
    : '';
  const assumptions = report.assumptions
    .map((a) => `<li><span class="st-status">${esc(a.status)}</span> ${esc(a.text)}${a.source ? `<div class="st-source">${esc(a.source)}</div>` : ''}</li>`)
    .join('');

  panel.innerHTML = `
    <div class="st-disclaimer">⚠ ${esc(report.disclaimer)}</div>
    <div class="st-note warn">${esc(report.loadWarning)}</div>
    <h4>Ciężar własny</h4>
    <table class="st-table">
      <thead><tr><th>Element</th><th>V [m³]</th><th>ρ [kg/m³]</th><th>Masa [kg]</th><th>G [kN]</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Razem</th><td></td><td></td><th class="num">${num(w.totalMassKg, 1)}</th><th class="num">${num(w.totalWeightKn, 2)}</th></tr></tfoot>
    </table>
    ${missing}
    <div class="st-note">Objętości netto z modelu (te same co w kosztorysie; wanga bez materiału wybranego na wręgi). Gęstość: ρmean klasy ${esc(report.materialClass)}.</div>
    <h4>Stopnie — belka między wangami</h4>
    ${treadTableHTML(report.treads)}
    <h4>Wangi — belka pochyła</h4>
    ${stringerTableHTML(report.stringers)}
    <h4>Balustrada — poręcz i słupki (obciążenie poziome)</h4>
    ${railingTableHTML(report.railing)}
    <div class="st-note">Nośność tralek nie jest liczona — ich ciężar (z poręczą i słupkami) obciąża wangę, na której stoją (kolumna „bal." w tabeli wang).</div>
    <h4>Założenia i źródła</h4>
    <ul class="st-assumptions">${assumptions}</ul>`;
}
