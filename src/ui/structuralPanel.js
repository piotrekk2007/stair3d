// "Konstrukcja" tab (right sidebar): renders the result of structural/index.js buildStructuralReport() — nothing is
// computed here beyond formatting. The disclaimer and the UK-load warning are always shown.

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const num = (v, digits) => v.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// `onSelectStep(stepId)` — a click on a tread row selects that tread everywhere (2D, 3D, Inspektor).
export function createStructuralPanel(container, { onSelectStep, onSelectStringer } = {}) {
  const panel = document.createElement('div');
  panel.id = 'structural-panel';
  container.appendChild(panel);
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('[data-step-id]');
    if (row && onSelectStep) onSelectStep(row.dataset.stepId);
    const stringerRow = e.target.closest('[data-stringer-side]');
    if (stringerRow && onSelectStringer) onSelectStringer(stringerRow.dataset.stringerSide);
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
      (c) => `<tr class="st-row" data-stringer-side="${esc(c.side)}" title="G ${num(c.permanentKn, 2)} kN (w tym balustrada ${num(c.railingKn, 2)} kN), Q ${num(c.imposedKn, 2)} kN — kliknij, aby zaznaczyć wangę">
        <td>${sideLabel(c.side)} <span class="st-muted">${esc(c.segmentId.replace(/^(outer|inner)-seg-/, 'deska '))}</span></td>
        <td class="num">${Math.round(c.spanMm)}</td>
        <td class="num">${Math.round(c.angleDeg)}°</td>
        <td class="num">${Math.round(c.bMm)}×${Math.round(c.hMm)}</td>
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
      <thead><tr><th>Wanga</th><th>L [mm]</th><th>kąt</th><th>b×h</th><th>M</th><th>V</th><th>w_inst</th><th>w_fin</th><th>max</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="st-note">L — długość pochyła między końcami deski; b×h — przekrój obliczeniowy (wpuszczana: grubość − wpust; nakładana: gardziel pod wcięciem). Najedź na wiersz, by zobaczyć obciążenia (z balustradą).</div>
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
    <div class="st-note">Jeszcze nie liczone: poręcz ze słupkiem, tralka (kolejne etapy, docs/architecture/STRUCTURAL_CHECKS.md).</div>
    <h4>Założenia i źródła</h4>
    <ul class="st-assumptions">${assumptions}</ul>`;
}
