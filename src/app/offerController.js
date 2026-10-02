// The "Oferta" tab wiring (DOM): offer settings (PROJECT data — saved in the project file, outside config and the
// model history), company data (a COMPANY setting — kept in this browser, like the presentation logo), the live
// preview and printing to PDF. Lines and sums come from offer/offerModel.js out of what the takeoff already priced;
// this module only gathers the inputs and pictures.

import { buildOffer, stairFacts, separableCategories, createDefaultOfferSettings, sanitizeOfferSettings, sanitizeCompany, suggestOfferNumber } from '../offer/offerModel.js';
import { buildOfferHTML } from '../offer/offerDocument.js';
import { createOfferPanel, fillOfferForm, updateOfferPanel } from '../ui/offerPanel.js';
import { summarizeByCategory } from '../ui/takeoffView.js';

const COMPANY_STORAGE_KEY = 'stair3d.company';

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {() => Object|null} opts.getTakeoff        the current priced takeoff
 * @param {() => Object|null} opts.getModels         the current buildStaircase() result
 * @param {() => Object} opts.getTakeoffSettings     prices, board pricing, manual items
 * @param {() => Set<string>} opts.getWinderStepIds  winder treads (their own summary category)
 * @param {() => string|null} opts.getLogoDataUrl
 * @param {() => string} opts.getProjectName
 * @param {() => string|null} opts.renderImage3D      the 3D picture (presentation look, iso view) as a data URL
 * @param {() => string|null} opts.renderPlanSVG      the plan picture (whole stair, no edit layers)
 */
export function createOfferController(opts) {
  let settings = createDefaultOfferSettings();
  let company = (() => {
    try {
      return sanitizeCompany(JSON.parse(localStorage.getItem(COMPANY_STORAGE_KEY) || 'null'));
    } catch {
      return sanitizeCompany(null);
    }
  })();

  function current() {
    const takeoff = opts.getTakeoff();
    if (!takeoff) return null;
    const summary = summarizeByCategory(takeoff.items, { winderStepIds: opts.getWinderStepIds() });
    return {
      summary,
      offer: buildOffer({ summary, manualItems: opts.getTakeoffSettings().manualItems, settings, blocked: takeoff.status === 'BLOCKED' }),
    };
  }

  function refresh() {
    const c = current();
    if (!c) return;
    updateOfferPanel(panel, { offer: c.offer, categories: separableCategories(c.summary), settings });
  }

  function generatePDF() {
    const c = current();
    const models = opts.getModels();
    if (!c || !models) return;
    if (c.offer.lines.length === 0) {
      window.alert(c.offer.warnings[0] || 'Brak pozycji do wyceny.');
      return;
    }
    const bp = opts.getTakeoffSettings().boardPricing || {};
    const html = buildOfferHTML({
      offer: c.offer,
      facts: stairFacts(models.fullConfig, models.derived, { material: [bp.species, bp.cls].filter(Boolean).join(', ') }),
      settings,
      company,
      logoDataUrl: opts.getLogoDataUrl(),
      image3d: opts.renderImage3D(),
      planSvg: opts.renderPlanSVG(),
      projectName: opts.getProjectName(),
    });
    // Printed through a hidden frame: the browser's print dialog -> "Save as PDF" (no PDF library; Polish letters and
    // pictures work as they are). The document title is the default file name.
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  }

  const panel = createOfferPanel(opts.container, {
    onSettings: (patch) => {
      settings = sanitizeOfferSettings({ ...settings, ...patch, client: { ...settings.client, ...(patch.client || {}) } });
      refresh();
    },
    onCompany: (patch) => {
      company = sanitizeCompany({ ...company, ...patch });
      try {
        localStorage.setItem(COMPANY_STORAGE_KEY, JSON.stringify(company));
      } catch {
        // no browser storage — the company data works until the tab is closed
      }
    },
    onSuggestNumber: () => {
      settings = { ...settings, offerNumber: suggestOfferNumber() };
      fillOfferForm(panel, settings, company);
      refresh();
    },
    onGenerate: () => generatePDF(),
  });
  fillOfferForm(panel, settings, company);

  /** Replaces the project's offer settings (new project: defaults; loaded file: its `offer`). */
  function load(value) {
    settings = value === undefined ? createDefaultOfferSettings() : sanitizeOfferSettings(value);
    fillOfferForm(panel, settings, company);
  }

  return { refresh, load, settings: () => settings };
}
