// The stairwell variant list (designer/stairwellVariants.js) in the left panel: one card per variant with its
// numbers and problems, "Zastosuj" writes its patch into config (main.js). View state only — not in the project file.

import { escapeHtml } from '../util/format.js';

const fmt0 = (v) => (Number.isFinite(v) ? Math.round(v).toString() : '—');
const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '—');

function card(v, applied) {
  const m = v.metrics;
  const cls = ['sv-card', v.ok ? 'ok' : 'bad', applied ? 'applied' : ''].filter(Boolean).join(' ');
  let body = '';
  if (m) {
    const legs = [m.treadsLegA, m.treadsLegB, m.treadsLegC].filter((n) => n !== null && n !== undefined).join(' / ');
    body += `<div class="sv-row"><span>stopnie</span><b>${m.numTreads} (proste ${legs}${m.winders ? `, zabiegowe ${m.winders}` : ''})</b></div>`;
    body += `<div class="sv-row"><span>podstopień / stopień</span><b class="${m.riserOk ? '' : 'warn'}">${fmt1(m.riserHeight)} / ${fmt1(m.treadGoing)} mm</b></div>`;
    body += `<div class="sv-row"><span>2h+s</span><b class="${m.blondelOk ? '' : 'warn'}">${fmt0(m.blondel)} mm</b></div>`;
    if (m.winderGoingAt400 !== null) body += `<div class="sv-row"><span>zabieg 400 mm od duszy</span><b class="${m.winderGoingAt400 >= 250 ? '' : 'warn'}">${fmt0(m.winderGoingAt400)} mm</b></div>`;
    const width = v.patch?.stairWidth ?? v.width;
    const reduced = width < v.userWidth - 0.05;
    body += `<div class="sv-row"><span>szerokość biegu</span><b class="${reduced ? 'warn' : ''}">${fmt1(width)} mm${reduced ? ' (zmniejszona)' : ''}</b></div>`;
    if (m.uAxisGapMm !== null) body += `<div class="sv-row"><span>odstęp osi wang A–C</span><b>${fmt0(m.uAxisGapMm)} mm</b></div>`;
    if (m.openingSize) body += `<div class="sv-row"><span>potrzebny otwór</span><b>${fmt0(m.openingSize.x)} × ${fmt0(m.openingSize.y)} mm${m.openingSize.corners > 4 ? ` (${m.openingSize.corners} narożn.)` : ''}</b></div>`;
    body += `<div class="sv-row"><span>błędy / ostrzeżenia</span><b class="${m.errors ? 'warn' : ''}">${m.errors} / ${m.warnings}${m.ceilingCollisions ? ` (strop: ${m.ceilingCollisions})` : ''}</b></div>`;
  }
  const problems = v.problems.map((p) => `<div class="sv-problem">${escapeHtml(p)}</div>`).join('');
  const button = v.patch ? `<button type="button" data-variant-apply="${escapeHtml(v.id)}">${applied ? '✓ Zastosowany' : 'Zastosuj'}</button>` : '';
  return `<div class="${cls}"><div class="sv-head"><b>${escapeHtml(v.label)}</b>${button}</div>${body}${problems}</div>`;
}

/**
 * @param {HTMLElement} container
 * @param {{onSearch:()=>void, onApply:(id:string)=>void}} handlers
 */
export function createStairwellVariantsPanel(container, { onSearch, onApply }) {
  const panel = document.createElement('div');
  panel.id = 'stairwell-variants';
  panel.hidden = true;
  container.appendChild(panel);
  panel.addEventListener('click', (e) => {
    const apply = e.target?.closest?.('[data-variant-apply]');
    if (apply) onApply(apply.dataset.variantApply);
    if (e.target?.closest?.('[data-variant-search]')) onSearch();
    if (e.target?.closest?.('[data-variant-close]')) panel.hidden = true;
  });
  return panel;
}

/**
 * @param {HTMLElement} panel
 * @param {ReturnType<import('../designer/stairwellVariants.js').generateStairwellVariants>|null} result
 * @param {{appliedId?:string|null, userWidth:number, ms?:number, stale?:boolean}} state
 */
export function renderStairwellVariants(panel, result, { appliedId = null, userWidth, ms = null, stale = false } = {}) {
  if (!result) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const head = `<div class="sv-title"><b>Warianty schodów w klatce</b><span><button type="button" data-variant-search title="Policz ponownie dla obecnej klatki">↻</button><button type="button" data-variant-close title="Zamknij listę">×</button></span></div>`;
  const req = result.required ? `<div class="sv-note">Wejście i wyjście wymagają: <b>${escapeHtml(result.required.label)}</b>${ms !== null ? ` · ${ms} ms` : ''}</div>` : '';
  const staleNote = stale ? '<div class="sv-problem">Klatka, otwór albo parametry zmieniły się po wyszukaniu — lista może być nieaktualna (↻).</div>' : '';
  const message = result.message ? `<div class="sv-problem">${escapeHtml(result.message)}</div>` : '';
  const rejected = (result.rejected || []).map((r) => `<div class="sv-problem">${escapeHtml(r)}</div>`).join('');
  const cards = result.variants.map((v) => card({ ...v, userWidth }, v.id === appliedId)).join('');
  panel.innerHTML = head + req + staleNote + message + cards + rejected;
}
