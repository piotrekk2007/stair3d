// Export wiring (DOM downloads): the 1:1 DXF drawings of posts, treads and the balustrade, the takeoff as CSV/TXT,
// and the OBJ/DAE geometry. Every drawing/serialisation is done by the pure exporters (export/dxfExport.js,
// takeoff/export, export/objExporter.js, export/daeExporter.js); this module only picks the current models and names
// the files.

import { treadJointsByStep } from '../geometry/jointSolver.js';
import { buildPostDXF, buildAllPostsDXF, buildTreadDXF, buildAllTreadsDXF, buildRailingDXF, buildMetalDXF, buildOpeningTrimDXF } from '../export/dxfExport.js';
import { exportStaircaseToOBJ } from '../export/objExporter.js';
import { exportStaircaseToDAE } from '../export/daeExporter.js';
import { downloadTextFile } from '../export/downloadTextFile.js';
import { takeoffToCSV, takeoffToTextReport } from '../takeoff/index.js';
import { buildPartList } from '../production/partCodes.js';
import { labelSheetHTML } from '../production/labelSheet.js';
import { printHtml } from './printHtml.js';
import { buildClientScene, sceneToGLB, sceneToUSDZ, arrayBufferToBase64, clientViewerHTML, clientFacts } from '../export/clientModelExport.js';

function downloadBinary(buffer, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
 * @param {() => THREE.Object3D[]} [opts.getRoom]   the stairwell's walls and the slab (the client's model, 'room' layer)
 * @param {() => string|null} [opts.getLogoDataUrl] the company logo (the client's HTML)
 */
export function createExports(opts) {
  const base = () => projectFileBaseName(opts.getProjectName());
  const dxf = (text, name) => downloadTextFile(text, `${base()}_${name}.dxf`, 'application/dxf');

  return {
    // The parts' labels (production/labelSheet.js) on an A4 sheet of stickers, printed like the offer (printHtml.js); also with design errors (the codes do not depend on the gate) — the sheet says so on screen.
    labels(layout = '3x8') {
      const m = opts.getModels();
      if (!m || m.fullConfig?.stairPending) return;
      const blocked = opts.getTakeoff()?.status === 'BLOCKED';
      const html = labelSheetHTML({
        parts: buildPartList(m).parts,
        projectName: opts.getProjectName() || '',
        layout,
        date: new Date().toLocaleDateString('pl-PL'),
        warning: blocked ? 'Uwaga: projekt ma błędy (Walidacja) — kosztorys jest zablokowany; etykiety pokazują elementy w obecnym stanie.' : null,
      });
      printHtml(html);
    },
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
      const text = tread ? buildTreadDXF(tread, treadJointsByStep(m?.joints, m?.postModels)[tread.stepId] || null, { led: m?.led }) : null;
      if (text) dxf(text, stepId);
    },
    allTreadsDXF() {
      const m = opts.getModels();
      const text = m?.treadModels ? buildAllTreadsDXF(m.treadModels, treadJointsByStep(m?.joints, m?.postModels), { led: m?.led }) : null;
      if (text) dxf(text, 'stopnie');
    },
    // The whole balustrade (handrail pieces with their cuts + the baluster cut list) on one 1:1 sheet. Nothing to draw
    // (no balustrade / no valid section) -> a message instead of an empty file.
    railingDXF() {
      const m = opts.getModels();
      const text = m?.railingModel ? buildRailingDXF(m.railingModel, { balusterSizeMm: m.fullConfig.railingBalusterSizeMm, config: m.fullConfig, led: m.led }) : null;
      if (text) dxf(text, 'balustrada');
      else window.alert('Brak balustrady do narysowania — włącz balustradę i dodaj odcinek.');
    },
    // The steel of a metal stair (beams with their supports / toothed flat bars) on one 1:1 sheet.
    metalDXF() {
      const text = buildMetalDXF(opts.getModels()?.metalStructure);
      if (text) dxf(text, 'konstrukcja_stalowa');
      else window.alert('Brak konstrukcji stalowej do narysowania — wybierz konstrukcję metalową (wanga na profilu albo płaskowniki).');
    },
    // The ceiling opening's trim ("fajka"): every piece's plan with its end cuts + the profile, on one 1:1 sheet.
    trimDXF() {
      const text = buildOpeningTrimDXF(opts.getModels()?.openingTrim);
      if (text) dxf(text, 'fajka_otworu');
      else window.alert('Brak obróbki otworu do narysowania — włącz „Obróbka otworu (fajka)” w folderze „4. Otwór w stropie”.');
    },
    // The model for the CLIENT (export/clientModelExport.js): 'html' — the self-contained viewer with a tape measure,
    // 'glb' — Windows / Android / any 3D program, 'usdz' — iPhone / iPad (3D and AR). Only geometry and its look.
    async clientModel(kind) {
      const m = opts.getModels();
      if (!m || !opts.getRoot()) return;
      let scene = null;
      opts.withCleanMaterials(() => {
        scene = buildClientScene({ root: opts.getRoot(), room: opts.getRoom ? opts.getRoom() : [] });
      });
      const name = base();
      if (kind === 'usdz') {
        downloadBinary(await sceneToUSDZ(scene), `${name}_model_3d.usdz`, 'model/vnd.usdz+zip');
        return;
      }
      const glb = await sceneToGLB(scene);
      if (kind === 'glb') {
        downloadBinary(glb, `${name}_model_3d.glb`, 'model/gltf-binary');
        return;
      }
      const { default: runtime } = await import('virtual:client-viewer-runtime');
      const title = opts.getProjectName() || 'Schody';
      const html = clientViewerHTML({ glbBase64: arrayBufferToBase64(glb), title, logo: opts.getLogoDataUrl ? opts.getLogoDataUrl() : null, facts: clientFacts(m), runtime });
      downloadTextFile(html, `${name}_model_3d.html`, 'text/html');
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
