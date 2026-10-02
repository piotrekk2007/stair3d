// Export wiring (DOM downloads): the 1:1 DXF drawings of posts, treads and the balustrade, the takeoff as CSV/TXT,
// and the OBJ/DAE geometry. Every drawing/serialisation is done by the pure exporters (export/dxfExport.js,
// takeoff/export, export/objExporter.js, export/daeExporter.js); this module only picks the current models and names
// the files.

import { treadJointsByStep } from '../geometry/jointSolver.js';
import { buildPostDXF, buildAllPostsDXF, buildTreadDXF, buildAllTreadsDXF, buildRailingDXF } from '../export/dxfExport.js';
import { exportStaircaseToOBJ } from '../export/objExporter.js';
import { exportStaircaseToDAE } from '../export/daeExporter.js';
import { downloadTextFile } from '../export/downloadTextFile.js';
import { takeoffToCSV, takeoffToTextReport } from '../takeoff/index.js';

/** The file-name stem of a project's exports: its name with anything but letters, digits, _ and - made "_". */
export function projectFileBaseName(projectName) {
  const slug = String(projectName ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'schody';
}

/**
 * @param {Object} opts
 * @param {() => Object|null} opts.getModels      the current buildStaircase() result
 * @param {() => Object|null} opts.getTakeoff     the current priced takeoff
 * @param {() => number} opts.getWaivedCount      how many findings were accepted (a takeoff report must say so)
 * @param {() => string} opts.getProjectName
 * @param {() => Object|null} opts.getRoot        the rendered stair (OBJ/DAE)
 * @param {Object} opts.exportSelection           which element groups go into OBJ/DAE
 * @param {(fn: () => void) => void} opts.withCleanMaterials  runs `fn` with the selection highlight removed
 */
export function createExports(opts) {
  const base = () => projectFileBaseName(opts.getProjectName());
  const dxf = (text, name) => downloadTextFile(text, `${base()}_${name}.dxf`, 'application/dxf');

  return {
    postDXF(postId) {
      const m = opts.getModels();
      const post = m?.allPostModels?.find((p) => p.postId === postId);
      const j = m?.joints;
      const text = post ? buildPostDXF(post, j?.pocketsByPost?.[post.postId] || [], { holes: j?.holesByPost?.[post.postId] || [], weakening: j?.postWeakening?.[post.postId] || null }) : null;
      if (text) dxf(text, `slup_${postId}`);
    },
    allPostsDXF() {
      const m = opts.getModels();
      const j = m?.joints;
      const text = m?.postModels ? buildAllPostsDXF(m.postModels, j?.pocketsByPost || {}, { holesByPost: j?.holesByPost || {}, postWeakening: j?.postWeakening || {} }) : null;
      if (text) dxf(text, 'slupy');
    },
    treadDXF(stepId) {
      const m = opts.getModels();
      const tread = m?.treadModels?.find((t) => t.stepId === stepId);
      const text = tread ? buildTreadDXF(tread, treadJointsByStep(m?.joints, m?.postModels)[tread.stepId] || null) : null;
      if (text) dxf(text, stepId);
    },
    allTreadsDXF() {
      const m = opts.getModels();
      const text = m?.treadModels ? buildAllTreadsDXF(m.treadModels, treadJointsByStep(m?.joints, m?.postModels)) : null;
      if (text) dxf(text, 'stopnie');
    },
    // The whole balustrade (handrail pieces with their cuts + the baluster cut list) on one 1:1 sheet. Nothing to draw
    // (no balustrade / no valid section) -> a message instead of an empty file.
    railingDXF() {
      const m = opts.getModels();
      const text = m?.railingModel ? buildRailingDXF(m.railingModel, { balusterSizeMm: m.fullConfig.railingBalusterSizeMm }) : null;
      if (text) dxf(text, 'balustrada');
      else window.alert('Brak balustrady do narysowania — włącz balustradę i dodaj odcinek.');
    },
    takeoff(kind) {
      const takeoff = opts.getTakeoff();
      if (!takeoff || takeoff.status === 'BLOCKED') return;
      if (kind === 'csv') downloadTextFile(takeoffToCSV(takeoff.items), `${base()}_zestawienie.csv`, 'text/csv');
      else {
        // A report leaving the application must say it was computed despite accepted validation findings.
        const waived = opts.getWaivedCount();
        const caveat = waived > 0 ? ` (UWAGA: policzono mimo ${waived} zaakceptowanych wyjątków walidacji)` : '';
        downloadTextFile(takeoffToTextReport(takeoff.items, { title: `Zestawienie materiałowe — ${opts.getProjectName() || 'schody'}${caveat}` }), `${base()}_zestawienie.txt`, 'text/plain');
      }
    },
    // OBJ/DAE always from clean materials (no selection highlight) — the view and an export never affect each other.
    obj() {
      opts.withCleanMaterials(() => exportStaircaseToOBJ(opts.getRoot(), 'schody.obj', opts.exportSelection));
    },
    dae() {
      opts.withCleanMaterials(() => exportStaircaseToDAE(opts.getRoot(), 'schody.dae', opts.exportSelection));
    },
  };
}
