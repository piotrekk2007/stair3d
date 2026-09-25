// "Konstrukcja" tab (right sidebar): renders the result of structural/index.js buildStructuralReport() — nothing is
// computed here beyond formatting. The disclaimer and the UK-load warning are always shown.

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const num = (v, digits) => v.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function createStructuralPanel(container) {
  const panel = document.createElement('div');
  panel.id = 'structural-panel';
  container.appendChild(panel);
  return panel;
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
    <h4>Kontrole nośności</h4>
    <div class="st-note">Jeszcze nie liczone — kolejne etapy: stopień, wanga, poręcz ze słupkiem, tralka (docs/architecture/STRUCTURAL_CHECKS.md).</div>
    <h4>Założenia i źródła</h4>
    <ul class="st-assumptions">${assumptions}</ul>`;
}
