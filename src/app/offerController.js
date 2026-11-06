// The "Oferta" tab wiring (DOM): offer settings (PROJECT data — saved in the project file, outside config and the
// model history), company data (a COMPANY setting — kept in this browser, like the presentation logo), the live
// preview and printing to PDF. Lines and sums come from offer/offerModel.js out of what the takeoff already priced;
// this module only gathers the inputs and pictures.

import { buildOffer, stairFacts, separableCategories, createDefaultOfferSettings, sanitizeOfferSettings, sanitizeCompany, suggestOfferNumber } from '../offer/offerModel.js';
import { buildOfferHTML } from '../offer/offerDocument.js';
import { buildModernOfferHTML, HERO_BACKGROUND, HERO_FULL_MM } from '../offer/offerDocumentModern.js';
import { createOfferPanel, fillOfferForm, updateOfferPanel, setOfferHeroStatus } from '../ui/offerPanel.js';
import { summarizeByCategory } from '../ui/takeoffView.js';
import { printHtml } from './printHtml.js';

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
 * @param {(o?: {width, height, background, fit, slab, fill}) => string|null} opts.renderImage3D  the 3D picture
 *   (presentation look, iso view) as a data URL — the modern style asks for its strip over the sheet's whole height on
 *   its studio background, with the slab, framed half way between the whole stair and the strip's height
 * @param {() => string|null} opts.renderPlanSVG      the plan picture (whole stair, no edit layers)
 */
export function createOfferController(opts) {
  let settings = createDefaultOfferSettings();
  // the modern hero's own picture (an AI render from the presentation mode, or a file) — this session only, not the
  // project (test, 2026-11-06): {img (data URL), full (the whole sheet's height, else the 84 × 150 box), source}
  let hero = null;
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
    const modern = settings.offerStyle === 'modern';
    const input = {
      offer: c.offer,
      facts: facts(),
      // (the modern hero over the sheet's whole height — user decision 2026-11-06)
      settings: modern ? { ...settings, heroFull: hero ? hero.full : true } : settings,
      company,
      logoDataUrl: opts.getLogoDataUrl(),
      // (the modern hero: the render at the strip's ratio, on its background, with the slab, framed half way)
      image3d: modern && hero ? hero.img : modern ? opts.renderImage3D({ width: 960, height: Math.round((960 * HERO_FULL_MM.height) / HERO_FULL_MM.width), background: HERO_BACKGROUND, fit: true, slab: true, fill: 0.5 }) : opts.renderImage3D(),
      planSvg: opts.renderPlanSVG(),
      projectName: opts.getProjectName(),
    };
    printHtml(modern ? buildModernOfferHTML(input) : buildOfferHTML(input));
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
    onHeroFile: (file) => {
      const r = new FileReader();
      r.onload = () => setHeroImage({ img: String(r.result), full: true, source: 'file' });
      r.readAsDataURL(file);
    },
    onHeroRemove: () => setHeroImage(null),
    onClientModel: (kind) => opts.onClientModel?.(kind),
  });
  fillOfferForm(panel, settings, company);

  /** Replaces the project's offer settings (new project: defaults; loaded file: its `offer`). */
  function load(value) {
    settings = value === undefined ? createDefaultOfferSettings() : sanitizeOfferSettings(value);
    fillOfferForm(panel, settings, company);
  }

  /** The offer's facts (the same rows the offer prints) — also the AI render's prompt. */
  function facts() {
    const models = opts.getModels();
    if (!models) return null;
    const bp = opts.getTakeoffSettings().boardPricing || {};
    return stairFacts(models.fullConfig, models.derived, { material: [bp.species, bp.cls].filter(Boolean).join(', ') });
  }
  function setHeroImage(h) {
    hero = h && h.img ? { img: h.img, full: h.full !== false, source: h.source || 'ai' } : null;
    setOfferHeroStatus(panel, hero);
  }

  return { refresh, load, settings: () => settings, facts, setHeroImage, heroImage: () => hero };
}
